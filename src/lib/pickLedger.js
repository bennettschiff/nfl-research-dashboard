// ── The pick ledger: what a pick IS, and how it is scored ────────────────────
// Every row the board prices against a real market line is a pick: the model
// has a side (the over or the under — only the Yes on a one-sided market) at a
// line a book will actually take. scripts/snapshot_picks.mjs freezes those rows
// into nfl.nfl_picks before kickoff; scripts/grade_picks.mjs scores them from
// nflverse's box scores and attaches the closing line. This module is the rule
// book both of them follow, and the Results tab summarises with it.
//
// WHAT IS NOT A PICK
//   · A row with no market line. The model's own median is not a bet anyone can
//     place, and a record against it would grade a coin flip by construction.
//   · A player ruled Out or Doubtful. The board hides him by default, and a book
//     voids a prop on a player who does not play.
//
// NO GATE. Every priced row is recorded — the high-confidence plays AND the coin
// flips — because the record has to be able to answer "does the model's
// conviction mean anything?", which needs the rows it was not confident about.
// Slicing (tier, edge, prop) happens when the ledger is READ, never when it is
// written. CLAUDE.md keeps gates out of probability space; a ledger that only
// kept `win >= X` would silently change what it tracks whenever calibration moved.
//
// ── SACKS ARE A PICK LIKE ANY OTHER (2026-09-18) ────────────────────────────
// The sack market used to be graded only as a PROJECTION (the frozen weekly
// record, scripts/snapshot_sacks.mjs) because no odds were bought for it. They
// are bought now, so a priced sack row is a pick and is recorded here with every
// other market: same freeze, same grade, same Results tab, same calibration.
//
// ── ONE-SIDED CALLS (2026-10-07) ────────────────────────────────────────────
// Anytime TD and sacks post only a Yes. Until 2026-10-07 every priced one-sided
// row was booked as a Yes bet, including the players the model priced well
// under the book — so the "all picks" record was really "bet every Yes into a
// 15-30% hold", and weeks 1-4 lost 281 of their 382 units there (ATD 215-755,
// sacks 63-323). Now the model makes a CALL (confidence.js oneSidedCall): YES
// when the calibrated probability makes the posted Yes +EV, NO otherwise. A YES
// is a pick like any other. A NO is frozen with direction "no" and outcome
// "pass" — kept so the row is on record, graded for its actual, never counted in
// a W/L or a unit, and filtered out of the Results tab (picks.js). The weeks
// frozen before this rule keep the Yes they were booked as; no old week is
// re-decided.
//
// Two things about sacks are not like the others, and both are handled rather
// than papered over:
//
//   IT IS ONE-SIDED. Nobody bets the under on half a sack, and most of the
//   market is DFS pick'em, which posts one price for both sides. So the
//   direction is always "over" (props.js ONE_SIDED_PROPS) and `side_prob` is
//   P(he clears the rung), not a distance from a coin flip.
//
//   THE LINE IS A RUNG, AND WHICH RUNG DECIDES WHAT HAS TO HAPPEN. 0.25 and 0.5
//   both need half a sack; 0.75 and 1.0 both need a whole one. The rung is
//   recorded on the pick and the grader settles against it — and because a sack
//   credit comes in halves, a 0.5 and a 1.0 can PUSH where a 0.25 and a 0.75
//   cannot. outcomeOf() already gets that right; see the note on it.
//
// Pure. No React, no I/O.
import { calcEV } from "./models.js";
import { devig, BOOK_PREF } from "./odds.js";
import { sideOf } from "./confidence.js";
import { isOneSided } from "./props.js";
import { tagPick } from "../modelVersions.js";

export const pickKey = (season, gameId, playerId, propType) => `${season}|${gameId}|${playerId}|${propType}`;

const round = (x, d = 4) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

/**
 * The side's price at every book on the row's own line, best payout first.
 * `priced.books` carries both sides per book (src/lib/odds.js priceAgainstMarket);
 * a book on a different line is not the same bet and is never eligible.
 *
 * The book list comes off the record when it carries one, via
 * `priced.bookOrder`, rather than being assumed here. The sack market names its
 * own list (SACK_BOOKS, today the same three); iterating BOOK_PREF here is what
 * once found no price on a sack row and dropped it from the ledger with a
 * market sitting right on it.
 */
export function sidePrice(priced, side) {
  if (!priced?.books) return null;
  let best = null;
  for (const bk of priced.bookOrder || BOOK_PREF) {
    const b = priced.books[bk];
    if (!b || b.offLine) continue;
    const odds = side === "under" ? b.underOdds : b.overOdds;
    if (odds == null) continue;
    const { prob: overFair, devigged } = devig(b.overOdds, b.underOdds);
    const mktProb = side === "under" ? (devigged ? 1 - overFair : null) : overFair;
    const pay = odds > 0 ? odds / 100 : 100 / Math.abs(odds);
    if (!best || pay > best.pay) best = { book: bk, odds, mktProb, devigged, pay };
  }
  return best;
}

/**
 * A board row → an nfl_picks record, or null when the row is not a pick.
 *
 * @param r    a row from buildBoardRows()
 * @param now  capture instant (Date)
 */
export function pickFromRow(r, { now = new Date(), kickoffAt = null, oddsAt = null } = {}) {
  if (!r?.priced || r.ruledOut || r.prob == null || r.probLine == null) return null;
  const oneSided = isOneSided(r.prop_type);
  // A one-sided row the model would not take at its price is a NO: frozen like
  // every other row, but as a pass — there is no No to bet, so nothing about it
  // is scored. See ONE-SIDED CALLS above.
  const side = oneSided ? (r.call === "yes" ? "over" : "no") : sideOf(r.prob);
  const sideProb = side === "over" ? r.prob : 1 - r.prob;
  const px = side === "no" ? null : sidePrice(r.priced, side);
  // A credit that lands ON a sack rung pushes, handing the stake back.
  const push = side === "over" ? (r.pushProb ?? 0) : 0;
  const c = r.carryover;

  return {
    pick_key: pickKey(r.game.season, r.game.game_id, r.player_id, r.prop_type),
    source: "auto",
    pick_date: now.toISOString().slice(0, 10),
    season: r.game.season, week: r.game.week, game_id: r.game.game_id,
    kickoff_at: kickoffAt ? kickoffAt.toISOString() : null,
    player_id: r.player_id, player_name: r.name, position: r.pos, team: r.team, opp: r.opp,
    prop_type: r.prop_type, line: r.probLine, direction: side,
    // Written, not defaulted: a row can flip between yes and no from one
    // pre-kickoff snapshot to the next, and the upsert must flip it back.
    outcome: side === "no" ? "pass" : "pending",
    proj_mean: r.proj, sigma: r.headline?.sigma ?? null,
    prob_over: round(r.prob), side_prob: round(sideProb),
    fair_line: r.headline?.fair_line ?? null,
    matchup_tilt: r.tilt ?? null,
    // An under nobody posts on the row's line is still the model's call and is
    // still graded W/L — it just has no price, so no profit and no edge.
    book: px?.book ?? null, book_odds: px?.odds ?? null,
    mkt_prob: round(px?.mktProb), devigged: px?.devigged ?? null,
    edge: px?.mktProb == null ? null : round(sideProb - px.mktProb),
    ev: px ? round(calcEV(sideProb, px.odds) + push) : null,
    conf_tier: r.conf?.tier ?? null, conf_score: round(r.conf?.score),
    avail: r.avail?.label || null,
    model_version: tagPick(r.prop_type),
    captured_at: now.toISOString(),
    odds_at: oddsAt,
    signals: {
      factors: r.headline?.factors ?? null,
      depth: r.depth ?? null,
      carryover: c ? {
        prior_source: c.prior_source ?? null, live_weight: c.live_weight ?? null,
        changed_team: c.changed_team ?? null, depth_rank: c.depth_rank ?? null,
        promoted_from: c.promoted_from ?? null, play_rate: c.play_rate ?? null,
        retargeted_att: c.retargeted_att ?? null,
      } : null,
      books: Object.fromEntries(Object.entries(r.priced.books).map(([bk, b]) =>
        [bk, { line: b.line, over: b.overOdds, under: b.underOdds ?? null }])),
    },
  };
}

// ── grading ──────────────────────────────────────────────────────────────────

/**
 * prop_type → the actual from an nflverse stats_player_week row.
 *
 * Anytime TD counts every touchdown the player SCORES — rushing, receiving, a
 * return or a fumble recovery — and not the ones he throws, which is how
 * FanDuel, DraftKings and Hard Rock all settle the market.
 */
export const ACTUAL_OF = {
  rec_yards: (s) => num(s.receiving_yards),
  receptions: (s) => num(s.receptions),
  rush_yards: (s) => num(s.rushing_yards),
  rush_att: (s) => num(s.carries),
  pass_yards: (s) => num(s.passing_yards),
  completions: (s) => num(s.completions),
  pass_tds: (s) => num(s.passing_tds),
  anytime_td: (s) => num(s.rushing_tds) + num(s.receiving_tds) + num(s.special_teams_tds) + num(s.fumble_recovery_tds),
  // Credited sacks, halves included: nflverse writes 0.5 for a split sack, which
  // is how the league credits it and how every book settles it. The column is
  // `def_sacks` — `sacks_suffered` on the same row is the quarterback's, which is
  // a different market we deliberately do not price (see MARKET_TO_PROP).
  def_sacks: (s) => num(s.def_sacks),
};
const num = (v) => (v == null || v === "" || v === "NA" ? 0 : Number(v) || 0);

/**
 * win | loss | push for a side at a line.
 *
 * The equality test is what makes the sack rungs settle correctly, and it does
 * so without a special case: a credit of exactly 0.5 lands ON a 0.5 line and
 * pushes, while at 0.25 or 0.75 it cannot, because a sack credit is a multiple
 * of a half and can never equal a quarter line. That is the real rule — 0.25 and
 * 0.5 are the same question at two prices, and only one of them can push.
 */
export function outcomeOf(side, line, actual) {
  if (actual === line) return "push";
  const over = actual > line;
  return (side === "under" ? !over : over) ? "win" : "loss";
}

/** Units won on a 1-unit stake at American odds. Null when there was no price. */
export function profitOf(outcome, odds) {
  if (outcome === "push" || outcome === "void" || outcome === "pass") return 0;
  if (odds == null) return null;
  if (outcome === "loss") return -1;
  return round(odds > 0 ? odds / 100 : 100 / Math.abs(odds));
}

/**
/**
 * Minutes a close must postdate the pick's price to count as a later one.
 *
 * A close pull writes its `close` and `live` rows from the same payload a few
 * milliseconds apart, and the snapshot that follows it stamps the pick with the
 * live rows' time — so "close after odds_at" by a hair is the SAME pull. Two
 * real pulls of one game are never closer than the pull's 90-minute re-buy
 * guard.
 */
export const CLOSE_AFTER_MIN = 15;

/** When the price a pick was frozen at was pulled. Hand-tracked rows have no odds_at. */
const pricedAt = (p) => p.odds_at ?? p.captured_at ?? null;

/**
 * The pick's "close" is the very price it was captured at — no later pull of
 * the game happened before kickoff, so there is no closing line to beat.
 *
 * Through week 4 of 2026 this was EVERY pick: the last pre-kickoff odds pull was
 * always a close pull, it refreshed the `live` rows the board reads from the
 * same payload, and the snapshot step right behind it re-froze every pick at
 * that number. 3,281 decided picks, CLV +0.0, "100% beat close" on one moved
 * price. snapshot_picks.mjs now holds a game's picks once its close capture has
 * begun; this is how the ledger tells the picks priced before that apart from
 * the ones that never were.
 */
export function closeIsCapture(p) {
  const at = pricedAt(p);
  if (p.close_at == null || at == null) return false;
  return new Date(p.close_at) - new Date(at) <= CLOSE_AFTER_MIN * 60e3;
}

/**
 * The closing number for a pick, from an indexOdds() record of CLOSE rows.
 *
 * The pick's own book when it priced the close, else the first BOOK_PREF book
 * that did. `clv_prob` is only defined when the close is on the SAME line — a
 * probability at 48.5 and one at 45.5 are different bets. `clv_line` is the
 * line move in the pick's favour (an over at 45.5 that closes 48.5 is +3).
 *
 * `close_at` is when that closing price was pulled, and CLV is only written when
 * it is a LATER price than the one the pick was frozen at (see closeIsCapture).
 */
export function closeFor(pick, closeMkt) {
  if (!closeMkt?.books) return null;
  const bk = closeMkt.books[pick.book] ? pick.book : BOOK_PREF.find((b) => closeMkt.books[b]);
  const b = bk && closeMkt.books[bk];
  if (!b) return null;
  const line = b.line ?? (pick.prop_type === "anytime_td" ? 0.5 : null);
  if (line == null) return null;
  const side = pick.direction;
  const odds = side === "under" ? b.underOdds ?? null : b.overOdds;
  const { prob: overFair, devigged } = devig(b.overOdds, b.underOdds);
  const prob = side === "under" ? (devigged ? 1 - overFair : null) : overFair;
  const sameLine = Number(line) === Number(pick.line);
  const close_at = b.at ?? null;
  const measured = !closeIsCapture({ ...pick, close_at });
  return {
    close_line: line, close_odds: odds, close_prob: round(prob), close_at,
    clv_prob: measured && sameLine && prob != null && pick.mkt_prob != null ? round(prob - Number(pick.mkt_prob)) : null,
    clv_line: !measured || pick.prop_type === "anytime_td" ? null
      : round(side === "under" ? Number(pick.line) - line : line - Number(pick.line), 1),
  };
}

/**
 * The closing number for a SACK pick, from an indexSackOdds() record.
 *
 * A ladder market cannot use closeFor(). Two reasons, and they are both about
 * comparing the same bet with itself:
 *
 *   THE BOOK. Most of this market is PrizePicks and Underdog, which are DFS
 *   pick'em — one price, both sides, a payout rather than a market. Reading a
 *   PrizePicks pick's close off FanDuel, which closeFor()'s BOOK_PREF fallback
 *   would do, compares a pick'em payout with a sportsbook price and calls the
 *   difference line movement.
 *
 *   THE RUNG. A book posts the same man at 0.25 and at 2.5. Those are different
 *   bets, so the close has to be the same rung, not the same player.
 *
 * So: the pick's own book, at the pick's own rung, or nothing. `clv_line` is
 * always null — a ladder does not move, its rungs are all posted at once, and a
 * rung "moving" is just a different rung.
 */
export function closeSackFor(pick, closeRec) {
  const ladder = closeRec?.books?.[pick.book];
  if (!ladder) return null;
  const rung = ladder.find((x) => Number(x.line) === Number(pick.line));
  if (!rung || rung.overOdds == null) return null;
  // A one-sided close still has the hold in it, exactly as the captured price
  // did, so the two are comparable even though neither is a fair number.
  const { prob } = devig(rung.overOdds, rung.underOdds);
  const close_at = rung.at ?? null;
  const measured = !closeIsCapture({ ...pick, close_at });
  return {
    close_line: rung.line, close_odds: rung.overOdds, close_prob: round(prob), close_at,
    clv_prob: measured && prob != null && pick.mkt_prob != null ? round(prob - Number(pick.mkt_prob)) : null,
    clv_line: null,
  };
}

/**
 * Grade one pick against the week's box scores.
 *
 * @param pick      an nfl_picks row
 * @param statsRow  his stats_player_week row for this game, or null
 * @param ctx.gameInStats  the stats file already carries this game
 * @param ctx.played       true / false from the game's snap counts, or null when
 *                         snap counts for the game are not published yet
 * @returns the fields to PATCH, or null while the pick cannot be settled yet
 *
 * nflverse's weekly stats list only players who RECORDED a stat, so absence from
 * the box score is not absence from the game: a receiver who ran 20 routes and
 * drew no target is missing too, and a book settles his over as a loss and his
 * under as a win. Only a player who took NO snap — offense or special teams — is
 * a void. When the snap counts have not landed, an absent player stays pending
 * rather than being guessed either way.
 */
export function gradePick(pick, statsRow, { gameInStats, played = null } = {}) {
  if (!gameInStats) return null;
  const get = ACTUAL_OF[pick.prop_type];
  if (!get) return null;
  if (!statsRow) {
    if (played === false) return { outcome: "void", actual: null, profit: 0 };
    if (played !== true) return null;
  }
  const actual = get(statsRow || {});
  // A NO on a one-sided market was never a bet: record what happened, score nothing.
  if (pick.direction === "no") return { outcome: "pass", actual, profit: 0 };
  const outcome = outcomeOf(pick.direction || "over", Number(pick.line), actual);
  return { outcome, actual, profit: profitOf(outcome, pick.book_odds) };
}

// ── reading the ledger ───────────────────────────────────────────────────────

/**
 * The BASELINE: the first week graded under every rule the ledger runs on today.
 *
 * 2026-10-07 (the four-week audit, modelVersions.js) changed what a pick IS, not
 * just how well it is made: one-sided markets stopped booking every Yes (ATD and
 * sacks went from "bet every row into the hold" to a +EV call), the sack rung
 * was priced as the bet the book settles, Win% was calibrated to the price, and
 * CLV started measuring against a LATER price instead of the pick's own. Weeks
 * 1-4 and week 5 on are therefore two different books, and one running total
 * across them describes neither. The Results tab opens on the baseline; the full
 * season and the pre-fix weeks are one click away and never deleted.
 */
export const BASELINE = { season: 2026, week: 5, date: "2026-10-07" };

/** On or after the baseline week. A row with no week (a hand-tracked pick) is not. */
export const inBaseline = (p) => p.season > BASELINE.season
  || (p.season === BASELINE.season && p.week != null && p.week >= BASELINE.week);

/** A row that is a bet — everything but a one-sided NO (see ONE-SIDED CALLS). */
export const isBet = (p) => p.direction !== "no";

/** Record, units and CLV over a set of picks. Pending and void rows are counted, not scored; passes are not picks. */
export function summarize(picks) {
  picks = picks.filter(isBet);
  const s = { n: picks.length, win: 0, loss: 0, push: 0, void: 0, pending: 0,
    staked: 0, profit: 0, clvN: 0, clvSum: 0, clvBeat: 0, clvLost: 0, atClose: 0, brierN: 0, brierSum: 0 };
  for (const p of picks) {
    s[p.outcome] = (s[p.outcome] ?? 0) + 1;
    if (p.outcome === "win" || p.outcome === "loss") {
      if (p.profit != null) { s.staked += 1; s.profit += Number(p.profit); }
      if (p.side_prob != null) {
        const y = p.outcome === "win" ? 1 : 0;
        s.brierN += 1; s.brierSum += (Number(p.side_prob) - y) ** 2;
      }
    }
    // Priced at the close itself: no CLV to measure, and counted so the Results
    // tab can say so rather than reading the absence as an unmoved line.
    if (closeIsCapture(p)) s.atClose += 1;
    else if (p.clv_prob != null) {
      const v = Number(p.clv_prob);
      s.clvN += 1; s.clvSum += v;
      if (v > 0) s.clvBeat += 1; else if (v < 0) s.clvLost += 1;
    }
  }
  const decided = s.win + s.loss;
  return {
    ...s,
    winPct: decided ? s.win / decided : null,
    roi: s.staked ? s.profit / s.staked : null,
    avgClv: s.clvN ? s.clvSum / s.clvN : null,
    // Of the picks whose price MOVED, the share it moved toward. An unmoved close
    // is neither, and a pick priced at the close itself (closeIsCapture — a
    // backfill, or any pick frozen by the game's last pull) is not a CLV sample
    // at all: it is `atClose`, never an "unmoved" tie.
    beatClose: s.clvBeat + s.clvLost ? s.clvBeat / (s.clvBeat + s.clvLost) : null,
    brier: s.brierN ? s.brierSum / s.brierN : null,
  };
}

/**
 * Model probability vs how often it happened, in 5-point bands of the SIDE's
 * probability. The honest test of whether a 65% call wins 65% of the time.
 */
export function calibration(picks, width = 0.05) {
  const bins = new Map();
  for (const p of picks) {
    if ((p.outcome !== "win" && p.outcome !== "loss") || p.side_prob == null) continue;
    const pr = Number(p.side_prob);
    // The epsilon is load-bearing: 0.6 / 0.05 is 11.999… in floating point, and
    // without it every pick sitting exactly on a band edge lands one band low.
    const lo = Math.min(Math.floor(pr / width + 1e-9) * width, 1 - width);
    const k = lo.toFixed(2);
    const b = bins.get(k) || { lo, hi: lo + width, n: 0, wins: 0, probSum: 0 };
    b.n += 1; b.probSum += pr; if (p.outcome === "win") b.wins += 1;
    bins.set(k, b);
  }
  return [...bins.values()].sort((a, b) => a.lo - b.lo)
    .map((b) => ({ ...b, expected: b.probSum / b.n, actual: b.wins / b.n }));
}

/** summarize() per group, largest group first. `keyOf` returns the group key. */
export function splitBy(picks, keyOf) {
  const groups = new Map();
  for (const p of picks) {
    const k = keyOf(p);
    if (k == null) continue;
    (groups.get(k) || groups.set(k, []).get(k)).push(p);
  }
  return [...groups.entries()].map(([key, ps]) => ({ key, ...summarize(ps) }))
    .sort((a, b) => b.n - a.n);
}
