// ── Game markets: spread, total, moneyline, team total ───────────────────────
// The engine (scripts/build_game_engine.py, src/lib/gameEngine.js) predicts the
// SCORE. This module turns that score into the board's game rows and the pick
// ledger's game picks: which side the engine is on, at which book's line, at
// what probability, and how a frozen pick settles.
//
// ── WHAT THE BACKTEST SAID (research/game-engine-2026-10-14/backtest_markets.py)
// The engine is a real predictor of the score — 63-64% straight-up winners held
// out, ~9 points of separation between its low and high total terciles — and it
// is NOT ahead of the closing price. Graded against nflverse's closing lines with
// their juice, the moderate 0.15-0.45 band that holds up on yardage props:
//
//                  dev 2018-24          2025 (held out)      2026 wk1-5
//   spread         700  52.7%  +1.8%    116  41.4% −21.0%     31  54.8%  +5.6%
//   total          748  49.1%  −5.2%     97  51.5%  −1.5%     39  35.9% −31.5%
//   moneyline      715  41.7%  −3.9%    116  44.8% −17.0%     32  56.2% +37.1%
//
// No band that dev liked survived 2025. So every game market starts on
// PROBATION (officialPicks.js): every priced game is frozen and graded like a
// prop, and none is official until its own in-band record earns it in. Team
// totals have no historical line at all and start there by definition.
//
// ── WIN% IS CALIBRATED TO THE PRICE (CLAUDE.md) ─────────────────────────────
//   logit(P) = logit(P_mkt) + c + k · (logit(P_engine) − logit(P_mkt))
// fitted on 2025 closing lines, dev seasons alongside for stability:
//   spread     2025 k −0.30 (grid edge)   dev k +0.05   → k 0: the price is the forecast
//   moneyline  2025 k −0.30 (grid edge)   dev k −0.14   → k 0
//   total      2025 k +0.12               dev k +0.19   → k 0.12
// The lean c flipped sign between dev and 2025 on every market (totals +0.08 vs
// −0.07), which is a season, not a bias, so c is 0. Team totals borrow nothing:
// no evidence, k 0. A game row's Win% therefore sits within a point or two of
// the de-vigged price, and that is the honest number — the engine's own
// Φ(gap/σ) was printing 60%+ on sides that won under half the time in 2025.
//
// THE SIDE IS THE ENGINE'S, not the calibrated probability's. With k = 0 the
// calibrated number is the market's, and "the side over 50%" would just be the
// side with less juice on it. The engine picks the side (its score against the
// line); the calibrated probability is what that side is worth.
//
// ── SCORE SPACE (CLAUDE.md) ─────────────────────────────────────────────────
// The official score is the engine's gap to the line in its own spread units,
// read off the frozen pick: (side margin + handicap) / σ for a spread, |total −
// line| / σ for the totals, and for a moneyline the same margin gap measured
// against the margin the price implies, Φ⁻¹(P_engine) − Φ⁻¹(P_mkt). A pricing
// recalibration cannot move it.
//
// Pure. No React, no I/O.
import { calibrateToMarket, calcEV, normalCDF } from "./models.js";
import { devig, BOOK_PREF, payout } from "./odds.js";
import { betslipUrl } from "./betslip.js";
import { engineFor } from "./gameEngine.js";
import { tagPick } from "../modelVersions.js";

/** The board's game markets, in menu order. */
export const GAME_PROPS = ["spread", "total", "moneyline", "team_total"];
export const isGameProp = (t) => GAME_PROPS.includes(t);

/** Odds API market key → our prop_type. `team_totals` is per-event; the rest come from the slate call. */
export const ODDS_MARKET = { spreads: "spread", totals: "total", h2h: "moneyline", team_totals: "team_total" };

/** Price calibration — see the header. Fitted by backtest_markets.py on 2025. */
export const GAME_CAL = {
  spread: { c: 0, k: 0 },
  total: { c: 0, k: 0.12 },
  moneyline: { c: 0, k: 0 },
  team_total: { c: 0, k: 0 },
};

/** The `position` a game pick is filed under in the ledger. */
export const GAME_POSITION = "GAME";

const round = (x, d = 4) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

/** Inverse standard normal CDF (Acklam), for the margin a moneyline price implies. */
export function normInv(p) {
  if (!(p > 0 && p < 1)) return p <= 0 ? -Infinity : Infinity;
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - lo) return -normInv(1 - p);
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q
    / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// ── indexing the stored lines ────────────────────────────────────────────────

/**
 * nfl.game_lines rows → game_id → book → market → sides.
 *
 *   spread      { home: {line, odds}, away: {line, odds} }   line = that side's handicap
 *   total       { over: {line, odds}, under: {line, odds} }
 *   moneyline   { home: {odds}, away: {odds} }
 *   team_total  { home: {over, under}, away: {over, under} }
 *
 * row_key carries the LINE, so a line that moved leaves its old row behind with
 * an older capture time. The newest capture of each (book, market, side) wins —
 * the same "last pull before the read" rule loadCloseIndex applies to props.
 *
 * @param gamesById  game_id → { home_team, away_team }, to name a team's side
 */
export function indexGameLines(rows, gamesById, books = BOOK_PREF) {
  const latest = new Map();
  for (const r of rows || []) {
    if (!books.includes(r.book)) continue;
    const prop = ODDS_MARKET[r.market];
    if (!prop || r.odds == null) continue;
    const k = [r.game_id, r.book, prop, r.outcome, r.team ?? ""].join("|");
    const cur = latest.get(k);
    if (!cur || String(r.captured_at ?? "") >= String(cur.captured_at ?? "")) latest.set(k, r);
  }
  const out = new Map();
  for (const r of latest.values()) {
    const g = gamesById?.[r.game_id];
    if (!g) continue;
    const prop = ODDS_MARKET[r.market];
    const at = { line: r.line == null ? null : Number(r.line), odds: Number(r.odds),
      at: r.captured_at ?? null, link: r.link ?? null, sid: r.sid ?? null };
    const sideOfTeam = (t) => (t === g.home_team ? "home" : t === g.away_team ? "away" : null);
    const book = ((out.get(r.game_id) || out.set(r.game_id, {}).get(r.game_id))[r.book] ||= {});
    const mkt = (book[prop] ||= {});
    if (prop === "total") mkt[r.outcome === "Over" ? "over" : "under"] = at;
    else if (prop === "team_total") {
      const s = sideOfTeam(r.team);
      if (s) (mkt[s] ||= {})[r.outcome === "Over" ? "over" : "under"] = at;
    } else {
      const s = sideOfTeam(r.outcome);
      if (s) mkt[s] = at;
    }
  }
  return out;
}

// ── one market, one book ─────────────────────────────────────────────────────

/**
 * A book's two-sided pair for a market, as { line, a, b }: `a` is the HOME side
 * (spread, moneyline) or the OVER (totals), `line` is in a's terms. Null when the
 * book does not post both sides, or posts a spread whose two handicaps disagree.
 */
function pairOf(prop, rec, team) {
  if (!rec) return null;
  if (prop === "spread") {
    const h = rec.spread?.home, a = rec.spread?.away;
    if (!h || !a || h.line == null || a.line == null || h.line !== -a.line) return null;
    return { line: h.line, a: h, b: a };
  }
  if (prop === "total") {
    const o = rec.total?.over, u = rec.total?.under;
    if (!o || !u || o.line == null || o.line !== u.line) return null;
    return { line: o.line, a: o, b: u };
  }
  if (prop === "moneyline") {
    const h = rec.moneyline?.home, a = rec.moneyline?.away;
    return h && a ? { line: null, a: h, b: a } : null;
  }
  const t = rec.team_total?.[team];
  if (!t?.over || !t?.under || t.over.line == null || t.over.line !== t.under.line) return null;
  return { line: t.over.line, a: t.over, b: t.under };
}

/**
 * The engine's expectation for the market's A side: the mean and spread it is
 * read from, and P(A wins) at a line. Margin is HOME-positive.
 */
function engineView(prop, eng, sigma, team) {
  if (prop === "spread" || prop === "moneyline") return { mean: eng.margin, sd: sigma.margin };
  if (prop === "total") return { mean: eng.total, sd: sigma.total };
  return { mean: team === "home" ? eng.home_pts : eng.away_pts, sd: sigma.team };
}
const pA = (prop, v, line) => (prop === "spread" ? normalCDF((v.mean + line) / v.sd)
  : prop === "moneyline" ? normalCDF(v.mean / v.sd)
  : normalCDF((v.mean - line) / v.sd));

/**
 * Price one game market against every book that posts it.
 *
 * The reference line is the first BOOK_PREF book's, exactly as for props
 * (odds.js priceAgainstMarket): a book on a different number is shown with its
 * own line and is not eligible to be the row's best price, because it is not the
 * same bet. A moneyline has no line, so every book is on it.
 */
export function priceGame(prop, eng, sigma, rec, { team = null, books = BOOK_PREF } = {}) {
  if (!eng || !sigma) return null;
  const v = engineView(prop, eng, sigma, team);
  const posted = books.filter((bk) => pairOf(prop, rec?.[bk], team));
  if (!posted.length) return null;
  const ref = pairOf(prop, rec[posted[0]], team);

  // The engine's side, at the reference line. A moneyline takes the team the
  // engine likes better than the price does.
  const refMkt = devig(ref.a.odds, ref.b.odds).prob;
  const refRaw = pA(prop, v, ref.line);
  const sideA = prop === "spread" ? v.mean + ref.line > 0
    : prop === "moneyline" ? refRaw > refMkt
    : v.mean > ref.line;

  const out = {};
  for (const bk of posted) {
    const p = pairOf(prop, rec[bk], team);
    const raw = pA(prop, v, p.line);
    const mktA = devig(p.a.odds, p.b.odds).prob;
    const calA = calibrateToMarket(prop, raw, mktA, true, GAME_CAL);
    const s = sideA ? p.a : p.b;
    const prob = sideA ? calA : 1 - calA;
    out[bk] = {
      line: p.line == null ? null : sideA || prop !== "spread" ? p.line : -p.line,
      offLine: p.line !== ref.line,
      odds: s.odds, otherOdds: (sideA ? p.b : p.a).odds,
      rawProb: sideA ? raw : 1 - raw, prob, mktProb: sideA ? mktA : 1 - mktA,
      ev: calcEV(prob, s.odds), url: betslipUrl(bk, s), at: s.at,
    };
  }
  const best = Object.entries(out).filter(([, b]) => !b.offLine)
    .reduce((x, y) => (payout(y[1].odds) > payout(x[1].odds) ? y : x))[0];
  return { sideA, refLine: ref.line, best, books: out, bookOrder: books, mean: v.mean, sd: v.sd };
}

// ── board rows ───────────────────────────────────────────────────────────────

const SIDE = {
  spread: (a) => (a ? "home" : "away"),
  moneyline: (a) => (a ? "home" : "away"),
  total: (a) => (a ? "over" : "under"),
  team_total: (a) => (a ? "over" : "under"),
};

const signed = (x) => (x == null ? "" : x === 0 ? "PK" : `${x > 0 ? "+" : "−"}${Math.abs(x)}`);

/** What the row is a bet ON, the way a slip prints it. */
export function pickLabel(r) {
  if (!r.side) return null;
  if (r.prop_type === "spread") return `${r.team} ${signed(r.line)}`;
  if (r.prop_type === "moneyline") return `${r.team} ML`;
  if (r.prop_type === "total") return `${r.side === "over" ? "O" : "U"} ${r.line}`;
  return `${r.team} ${r.side === "over" ? "o" : "u"}${r.line}`;
}

/** A FROZEN game pick the way a slip prints it — the ledger-side twin of pickLabel. */
export function gamePickText(p) {
  const line = p.line == null ? null : Number(p.line);
  if (p.prop_type === "spread") return `${p.team} ${signed(line)}`;
  if (p.prop_type === "moneyline") return `${p.team} ML`;
  if (p.prop_type === "total") return `${p.direction === "under" ? "u" : "o"}${line}`;
  return `${p.team} ${p.direction === "under" ? "u" : "o"}${line}`;
}

/**
 * One row per game (spread, total, moneyline) or per TEAM (team total), carrying
 * the same top-level fields a prop row does where they mean the same thing, so
 * the sort, the Win%/EV cells and the ledger read it without a special case:
 * `proj`, `probLine` (= `line`), `win`, `diff`, `priced`, `game`.
 *
 * In a row's own terms:
 *   line   the side's handicap (spread), the total, or null (moneyline)
 *   proj   the engine's FAIR number for the side — a handicap for spread and
 *          moneyline ("DEN +0.5" means the engine has Denver losing by half a
 *          point), points for the totals
 *   diff   points of value in the pick's favour: line − fair handicap, or the
 *          engine total minus the line on the over (reversed on the under). For
 *          a moneyline, the engine's margin minus the margin the price implies.
 *   score  diff / σ — the official card's score-space distance
 */
export function buildGameRows(d, games, prop, { engine = engineFor(d.year), lines = d.gameLines, books = BOOK_PREF } = {}) {
  const rows = [];
  for (const g of games) {
    const eng = engine?.byGame.get(g.game_id) || null;
    const rec = lines?.get?.(g.game_id) || null;
    const teams = prop === "team_total" ? ["home", "away"] : [null];
    for (const t of teams) {
      const priced = eng && rec ? priceGame(prop, eng, engine.sigma, rec, { team: t, books }) : null;
      rows.push(gameRow(prop, g, eng, engine?.sigma, priced, t));
    }
  }
  return rows;
}

function gameRow(prop, g, eng, sigma, priced, tt) {
  const key = `${g.game_id}|${prop}${tt ? `|${tt}` : ""}`;
  const base = { key, prop_type: prop, game: g, home: g.home_team, away: g.away_team, eng, sigma: null,
    priced: null, side: null, team: tt ? g[`${tt}_team`] : null, ttSide: tt };
  // The engine's own number, priced or not: an unpriced game still shows what
  // the engine thinks, and a game it has not rated yet (a week past the next)
  // shows the market alone.
  const fairHome = eng ? -eng.margin : null;
  if (!priced) {
    const proj = !eng ? null : prop === "total" ? eng.total
      : prop === "team_total" ? (tt === "home" ? eng.home_pts : eng.away_pts) : fairHome;
    return { ...base, proj: proj == null ? null : round(proj, 2), line: null, probLine: null, win: null, diff: null, score: null };
  }
  const side = SIDE[prop](priced.sideA);
  const b = priced.books[priced.best];
  const team = prop === "spread" || prop === "moneyline" ? g[`${side}_team`] : base.team;
  const sideMargin = side === "home" ? eng.margin : -eng.margin;
  let line, proj, diff;
  if (prop === "spread") { line = b.line; proj = -sideMargin; diff = line - proj; }
  else if (prop === "moneyline") {
    line = null; proj = -sideMargin;
    diff = sideMargin - priced.sd * normInv(b.mktProb);
  } else {
    line = priced.refLine; proj = priced.mean;
    diff = side === "over" ? proj - line : line - proj;
  }
  return {
    ...base, priced, side, team, line, probLine: line ?? 0, sigma: priced.sd,
    proj: round(proj, 2), diff: round(diff, 2), score: round(diff / priced.sd),
    win: b.prob, rawProb: b.rawProb, mktProb: b.mktProb, ev: b.ev, edge: b.prob - b.mktProb,
    book: priced.best, odds: b.odds,
  };
}

// ── the ledger ───────────────────────────────────────────────────────────────

/** The ledger key's player slot: one game pick per market, one team total per team. */
export const gamePickSlot = (prop, team) => (prop === "team_total" ? `team:${team}` : "game");

/**
 * A game row → an nfl_picks record, or null when it is not a pick (no price).
 *
 * Stored in the ledger's own columns, in the SIDE's terms, so the official
 * score and the grader read it off the row with nothing else:
 *   line       side handicap (spread), the line (totals), 0 (moneyline: win outright)
 *   proj_mean  side's expected margin (spread, moneyline), engine points (totals)
 *   direction  home | away (spread, moneyline), over | under (totals)
 *   team       the side's team; null on a game total
 */
export function pickFromGameRow(r, { now = new Date(), kickoffAt = null, oddsAt = null } = {}) {
  if (!r?.priced || !r.side || !r.eng) return null;
  const g = r.game;
  const b = r.priced.books[r.book];
  const sideMargin = r.side === "home" ? r.eng.margin : r.side === "away" ? -r.eng.margin : null;
  const proj = r.prop_type === "spread" || r.prop_type === "moneyline" ? sideMargin : r.priced.mean;
  const team = r.team;
  const opp = team == null ? null : team === g.home_team ? g.away_team : g.home_team;
  // pickKey in pickLedger.js, inlined: that module imports this one's neighbours.
  const pick_key = `${g.season}|${g.game_id}|${gamePickSlot(r.prop_type, team)}|${r.prop_type}`;
  return {
    pick_key, source: "auto",
    pick_date: now.toISOString().slice(0, 10),
    season: g.season, week: g.week, game_id: g.game_id,
    kickoff_at: kickoffAt ? kickoffAt.toISOString() : null,
    player_id: null, player_name: `${g.away_team} @ ${g.home_team}`, position: GAME_POSITION,
    team, opp,
    prop_type: r.prop_type, line: r.prop_type === "moneyline" ? 0 : r.line, direction: r.side,
    outcome: "pending",
    proj_mean: round(proj, 2), sigma: round(r.sigma, 3),
    prob_over: round(r.priced.sideA ? r.win : 1 - r.win), side_prob: round(r.win),
    fair_line: null, matchup_tilt: null,
    book: r.book, book_odds: r.odds, mkt_prob: round(r.mktProb), devigged: true,
    edge: round(r.edge), ev: round(r.ev),
    conf_tier: null, conf_score: null, avail: null,
    model_version: tagPick(r.prop_type),
    captured_at: now.toISOString(),
    odds_at: oddsAt ?? b?.at ?? null,
    signals: {
      engine: { total: r.eng.total, margin: r.eng.margin, home_pts: r.eng.home_pts, away_pts: r.eng.away_pts,
        points_total: r.eng.points_total, points_margin: r.eng.points_margin, parts: r.eng.parts, qb: r.eng.qb },
      raw_prob: round(r.rawProb), diff: r.diff,
      books: Object.fromEntries(Object.entries(r.priced.books).map(([bk, x]) =>
        [bk, { line: x.line, odds: x.odds, other: x.otherOdds }])),
    },
  };
}

/**
 * The official card's score-space distance, off a frozen game pick. Signed in
 * the pick's favour; officialPicks.js reads it for the four game markets.
 */
export function gameOfficialScore(p) {
  const proj = p.proj_mean == null ? null : Number(p.proj_mean);
  const sd = p.sigma == null ? null : Number(p.sigma);
  if (proj == null || !(sd > 0)) return null;
  if (p.prop_type === "moneyline") {
    const mkt = p.mkt_prob == null ? null : Number(p.mkt_prob);
    if (!(mkt > 0 && mkt < 1)) return null;
    return proj / sd - normInv(mkt);
  }
  const line = p.line == null ? null : Number(p.line);
  if (line == null) return null;
  if (p.prop_type === "spread") return (proj + line) / sd;
  return (p.direction === "under" ? line - proj : proj - line) / sd;
}

/**
 * Settle a game pick from the final score. Null until the game has one.
 * @param score  { home_team, away_team, home_score, away_score }
 */
export function gradeGamePick(pick, score) {
  if (score?.home_score == null || score?.away_score == null || score.home_score === "" || score.away_score === "") return null;
  const h = Number(score.home_score), a = Number(score.away_score);
  const forTeam = (t) => (t === score.home_team ? h - a : a - h);
  const forTeamPts = (t) => (t === score.home_team ? h : a);
  let actual, v;
  if (pick.prop_type === "spread") { actual = forTeam(pick.team); v = actual + Number(pick.line); }
  else if (pick.prop_type === "moneyline") { actual = forTeam(pick.team); v = actual; }
  else {
    actual = pick.prop_type === "total" ? h + a : forTeamPts(pick.team);
    v = pick.direction === "under" ? Number(pick.line) - actual : actual - Number(pick.line);
  }
  const outcome = v > 0 ? "win" : v < 0 ? "loss" : "push";
  const odds = pick.book_odds == null ? null : Number(pick.book_odds);
  const profit = outcome === "push" ? 0 : odds == null ? null
    : outcome === "loss" ? -1 : round(odds > 0 ? odds / 100 : 100 / Math.abs(odds));
  return { outcome, actual, profit };
}

/**
 * The closing number for a game pick, from an indexGameLines() record of CLOSE
 * rows: the pick's own book when it priced the close, else the first BOOK_PREF
 * book that did. CLV in probability only on the same line; `clv_line` is the
 * line move in the pick's favour (an over at 44.5 that closes 46.5 is +2, a
 * +3 dog that closes +2 is +1). A close inside 15 minutes of the pick's own price
 * is the same pull, not a later one, and earns no CLV (pickLedger.js closeIsCapture
 * — passed in as `isCapture` to keep this module free of the ledger's imports).
 */
export function closeGameFor(pick, closeRec, homeTeam, isCapture = () => false) {
  if (!closeRec) return null;
  const tt = pick.prop_type === "team_total" ? (pick.team === homeTeam ? "home" : "away") : null;
  const bk = pairOf(pick.prop_type, closeRec[pick.book], tt) ? pick.book
    : BOOK_PREF.find((b) => pairOf(pick.prop_type, closeRec[b], tt));
  const p = bk && pairOf(pick.prop_type, closeRec[bk], tt);
  if (!p) return null;
  const sideA = pick.direction === "home" || pick.direction === "over";
  const s = sideA ? p.a : p.b;
  const { prob } = devig(p.a.odds, p.b.odds);
  const closeProb = sideA ? prob : 1 - prob;
  const closeLine = pick.prop_type === "moneyline" ? 0
    : pick.prop_type === "spread" ? (sideA ? p.line : -p.line) : p.line;
  const close_at = s.at ?? null;
  const measured = !isCapture({ ...pick, close_at });
  const pl = Number(pick.line);
  const lineMove = pick.prop_type === "moneyline" ? null
    : pick.prop_type === "spread" ? pl - closeLine
    : pick.direction === "under" ? pl - closeLine : closeLine - pl;
  return {
    close_line: closeLine, close_odds: s.odds, close_prob: round(closeProb), close_at,
    clv_prob: measured && closeLine === pl && pick.mkt_prob != null ? round(closeProb - Number(pick.mkt_prob)) : null,
    clv_line: measured && lineMove != null ? round(lineMove, 1) : null,
  };
}
