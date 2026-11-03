// ── Official picks: the part of the ledger the engine actually stands behind ──
// The ledger records EVERY priced board row (src/lib/pickLedger.js). That is the
// right thing to grade and the wrong thing to bet: week 1 of 2026 put 26
// passing-yards picks on the record, most of them a projection two yards from
// the line. An official pick is the subset the evidence says the model is worth
// following on. There is no count cap. If a pick passes the rule, it is official,
// however many others do.
//
// ── WHAT "BELIEVES IN IT MOST" TURNED OUT TO MEAN ───────────────────────────
// Not the biggest disagreement with the line. On 2025 against FanDuel closing
// lines (scripts/lib/grade.mjs, both the in-season and the season-flip carryover
// harness), projections 0.45+ standard deviations from the line were the WORST
// bets on the board in every segment:
//
//   |z| ≥ 0.45        in-season  wk4-10 49.5% −6.5%   wk11-16 45.1% −14.8%
//                     carryover  wk4-10 45.5% −13.8%  wk11-16 45.8% −13.4%
//
// A projection that far from a sharp number is far more often the model being
// wrong about the player (a role it has not seen change, a stale baseline) than
// the market being wrong. The band that held up is the moderate one:
//
//   0.15 ≤ |z| < 0.45, yardage, no rec-yards overs
//                     in-season  wk4-10 51.6% −2.4%   wk11-16 55.9% +5.8%
//                     carryover  wk1-3  54.1% +2.3%   wk4-10 54.1% +2.4%   wk11-16 53.9% +1.9%
//
// It is a thin edge. Say so wherever it is shown. Receiving-yards OVERS lost in
// every period (2025 all weeks 49.2%, −6.9% on 921), which is why rec_yards is
// split by side below.
//
// ── SCORE SPACE, NEVER PROBABILITY SPACE (CLAUDE.md) ────────────────────────
// The gate reads the projection's distance from the line in its own spread
// units. A probability recalibration cannot move it. The confidence tier is not
// used either: it is a probability distance, and in week 1 HIGH went 49%.
//
// ── MARKETS EARN THEIR WAY IN, AND CAN LOSE IT ──────────────────────────────
// Only markets with 2025 odds history were testable: rush yards, pass yards and
// rec-yards unders are CORE. Everything else (receptions, pass TDs, anytime TD,
// rec-yards overs) starts on PROBATION and is promoted by the ledger itself once
// its in-band picks clear EARN. A core market whose in-band record falls under
// BENCH is benched the same way. Standing is computed at snapshot time from
// picks already graded, and the verdict is frozen onto the pick before kickoff,
// so a later promotion can never rewrite an earlier week's official record.
//
// The weeks graded before the 2026-10-07 rules (pickLedger.js BASELINE) count
// toward standing AS TODAY'S RULES RE-SCORE THEM (src/lib/rescore.js), not as
// frozen — the frozen rows are bets the board no longer makes, and they benched
// rushing yards after week 5 on sides today's calibration would not have taken.
// The callers (snapshot_picks.mjs, the Results ladder) apply that overlay;
// marketStanding itself only counts what it is given.
//
// ── THE SIDE MUST AGREE WITH THE PROJECTION (2026-10-15) ────────────────────
// The score above is UNSIGNED: it qualifies a row by how far the projection
// sits from the line, and says nothing about which side to take. The side is
// the Win% calibrated to the price (models.js calibrateToMarket) — mostly the
// de-vigged price plus an under lean — so through week 6 most of the card bet
// AGAINST the projection that put it there (26 of week 6's 30: J.K. Dobbins
// projected 61.2 and official under 47.5). A card that contradicts its own
// board cannot be trusted, and on 2025 the contradicting plays were also the
// losing ones (scripts/screen_side_sync.mjs, 2025 FanDuel closing lines, band
// on the mean, calibrated side):
//
//                    side agrees with projection    side against it
//   rush yards       197  58.4%  +10.3%             330  48.2%  −8.8%
//   pass yards       105  54.3%   +2.7%              86  48.8%  −7.6%
//   rec yards        330  54.2%   +2.6%            1023  50.6%  −4.3%
//
// (2026 weeks 1-5 ran the other way on a much smaller sample — rush + pass,
// 28-38 agreeing, 82-60 against — and pooled with 2025 agreement still leads.)
// So a two-sided player prop is official only when its side is the side the
// projection is on. Game markets are scored in the pick's own favour and the
// one-sided markets are signed, so both already agree by construction.
// marketStanding counts the same population: a market earns in, or is benched,
// on the plays the rule would actually put on the card.
//
// Pure. No React, no I/O.
import { sackLambdaAt } from "./sacks.js";
import { isGameProp, gameOfficialScore } from "./gameMarkets.js";
import { isOneSided } from "./props.js";

export const OFFICIAL_RULE = "official@2026-10-15";

/** The moderate-disagreement band, in the prop's own spread units. */
export const ZONE = { lo: 0.15, hi: 0.45 };

/**
 * Markets validated on 2025 closing lines.
 *
 * Sacks are deliberately NOT here and cannot be added by hand: the 2025 odds
 * pull never bought the market, so there is no held-out record of it and no
 * basis for standing behind it. It starts on probation like every other
 * unvalidated market and earns in from its own graded picks (EARN), or does not.
 */
// Game markets (spread, total, moneyline, team total) are not here either, and
// that was MEASURED rather than assumed: graded against 2025's closing lines,
// the engine's 0.15-0.45 band went 41.4% on spreads, 51.5% on totals and 44.8%
// on moneylines (research/game-engine-2026-10-14/backtest_markets.py; the dev
// seasons liked spreads, 2025 did not). They start on probation and earn in
// from their own graded picks like any other market. See src/lib/gameMarkets.js.
export const CORE = new Set(["rush_yards", "pass_yards", "rec_yards:under"]);

/** A probation market is promoted at ≥ minN graded in-band picks, ≥ minWin, and positive ROI. */
export const EARN = { minN: 100, minWin: 0.53 };
/** A core market is benched at ≥ minN graded in-band picks winning under maxWin. */
export const BENCH = { minN: 150, maxWin: 0.5 };

const INJURY_DESIGNATIONS = new Set(["QUES", "DOUB", "OUT"]);

/** The unit a market's standing is kept on. Receiving yards is split by side (see header). */
export function segmentOf(p) {
  return p.prop_type === "rec_yards" ? `rec_yards:${p.direction || "over"}` : p.prop_type;
}

const n = (x) => (x == null || x === "" ? null : Number(x));

/**
 * How far the projection sits from the line, in the prop's own spread units.
 *
 *   yardage / receptions   |proj − line| / sigma        (the model's own spread)
 *   pass TDs and counts    |proj − line| / √proj        (Poisson spread)
 *   anytime TD             ln(model λ / market λ)       (rate ratio against the price;
 *                                                        the market's λ is −ln(1 − p))
 *   sacks                  ln(model λ / market λ)       (same idea, inverted numerically:
 *                                                        the rung's distribution is a
 *                                                        compound negative binomial over
 *                                                        half-sack credits, so there is no
 *                                                        closed form — see sackLambdaAt)
 *
 * The one-sided scores are signed: the Yes is the only side, so a model rate
 * BELOW the market's is not a disagreement in the pick's favour.
 *
 * A SACK SCORE IS A RATE RATIO AND NOT A DISTANCE IN SACKS, and it has to be,
 * because the pick's line is a rung: 0.25 and 0.5 need the same thing to happen
 * at two different prices, so "projection minus line" would score the same belief
 * differently depending on which number the book chose to print it at. The rate
 * the price implies AT THAT RUNG is the only thing comparable to our own.
 */
export function officialScore(p) {
  const proj = n(p.proj_mean), line = n(p.line);
  if (proj == null) return null;
  // A game pick is scored by the engine's gap in its own spread units, signed
  // in the pick's favour — gameMarkets.js gameOfficialScore says how per market.
  if (isGameProp(p.prop_type)) return gameOfficialScore(p);
  if (p.prop_type === "anytime_td") {
    const mkt = n(p.mkt_prob);
    if (!(proj > 0) || mkt == null || !(mkt > 0 && mkt < 1)) return null;
    return Math.log(proj / -Math.log(1 - mkt));
  }
  if (p.prop_type === "def_sacks") {
    const mkt = n(p.mkt_prob);
    if (!(proj > 0) || line == null || mkt == null || !(mkt > 0 && mkt < 1)) return null;
    const mktLambda = sackLambdaAt(mkt, line);
    return mktLambda > 0 ? Math.log(proj / mktLambda) : null;
  }
  if (line == null) return null;
  const sigma = n(p.sigma);
  if (sigma > 0) return Math.abs(proj - line) / sigma;
  return proj > 0 ? Math.abs(proj - line) / Math.sqrt(proj) : null;
}

export const inZone = (score) => score != null && score >= ZONE.lo && score < ZONE.hi;

/**
 * Does the pick take the side its projection is on? Always true for a game
 * market or a one-sided prop (their scores are already signed in the pick's
 * favour); a two-sided player prop needs proj > line for an over and
 * proj < line for an under. A projection ON the line has no side.
 */
export function sideWithProjection(p) {
  if (isGameProp(p.prop_type) || isOneSided(p.prop_type)) return true;
  const proj = n(p.proj_mean), line = n(p.line);
  if (proj == null || line == null || proj === line) return false;
  return (proj > line ? "over" : "under") === p.direction;
}

/** In the band AND on the projection's side: the population the card is drawn from. */
export const inBand = (p) => inZone(officialScore(p)) && sideWithProjection(p);

/**
 * Each market segment's standing, from picks already graded.
 *
 * Counts every LIVE (`source = auto`) decided pick whose score sat in the band
 * on the projection's side (inBand), official or not, because a probation
 * market by definition has no official picks to count. The standing describes
 * the band's record, not the card's.
 *
 * @returns { [segment]: { status: core|benched|earned|probation, n, wins, winPct, roi } }
 */
export function marketStanding(picks) {
  const seg = {};
  for (const p of picks || []) {
    if (p.source !== "auto" || (p.outcome !== "win" && p.outcome !== "loss")) continue;
    if (p.profit == null || !inBand(p)) continue;
    const k = segmentOf(p);
    const s = seg[k] || (seg[k] = { n: 0, wins: 0, units: 0 });
    s.n += 1; s.units += Number(p.profit);
    if (p.outcome === "win") s.wins += 1;
  }
  const keys = new Set([...CORE, ...Object.keys(seg)]);
  const out = {};
  for (const k of keys) {
    const s = seg[k] || { n: 0, wins: 0, units: 0 };
    const winPct = s.n ? s.wins / s.n : null;
    const roi = s.n ? s.units / s.n : null;
    const status = CORE.has(k)
      ? (s.n >= BENCH.minN && winPct < BENCH.maxWin ? "benched" : "core")
      : (s.n >= EARN.minN && winPct >= EARN.minWin && roi > 0 ? "earned" : "probation");
    out[k] = { status, n: s.n, wins: s.wins, winPct, roi };
  }
  return out;
}

const ACTIVE = new Set(["core", "earned"]);

/**
 * Is this pick official? Reads only fields a frozen nfl_picks row carries, so a
 * live snapshot and a retro pass over an old week reach the same answer.
 *
 * @param p         an nfl_picks record (pickFromRow output, or a row read back)
 * @param standing  marketStanding() of the ledger as it stood before this pick
 * @returns { official, score, segment, note } — `note` says why not, in words
 */
export function officialVerdict(p, standing = {}) {
  const segment = segmentOf(p);
  const score = officialScore(p);
  const status = standing[segment]?.status ?? (CORE.has(segment) ? "core" : "probation");
  const no = (note) => ({ official: false, score, segment, note });

  if (p.direction === "no") return no("model does not take the Yes at this price");
  if (p.book_odds == null) return no("no price on the pick's side");
  if (INJURY_DESIGNATIONS.has(p.avail)) return no("injury designation");
  // Both carry a JOB's attempt volume rather than the man's own — defensible to
  // show (src/lib/depthPromotion.js), measured not to beat the market.
  if (p.signals?.carryover?.promoted_from) return no("promoted backup");
  if (p.signals?.carryover?.retargeted_att != null) return no("starter volume assumed");
  if (score == null) return no("no projection to score");
  if (score < ZONE.lo) return no("too close to the line");
  if (score >= ZONE.hi) return no("gap too large to trust");
  if (!sideWithProjection(p)) return no("side disagrees with the projection");
  if (!ACTIVE.has(status)) return no(status === "benched" ? "market benched" : "market on probation");
  return { official: true, score, segment, note: status === "earned" ? "earned market" : null };
}

/** On the official card, stamped before kickoff. */
export const isOfficialLive = (p) => p.official === true && p.official_basis === "pre-kickoff";
/** Official by the rule applied after the week was frozen — a test of the rule, not the record. */
export const isOfficialRetro = (p) => p.official === true && p.official_basis === "retro";
/**
 * On the card a VIEW counts as official: the stamped card, plus — only in the
 * Results tab's "Today's rules" view, the one place such rows exist — a pre-fix
 * week re-scored under today's rules (src/lib/rescore.js, basis 'rules'). Every
 * other view only ever holds pre-kickoff and retro rows, so there it is
 * isOfficialLive exactly.
 */
export const isOfficialCard = (p) => p.official === true && (p.official_basis === "pre-kickoff" || p.official_basis === "rules");

/** The columns a verdict writes onto an nfl_picks row. */
export function officialColumns(p, standing, basis) {
  const v = officialVerdict(p, standing);
  return {
    official: v.official,
    official_score: v.score == null ? null : Math.round(v.score * 1e4) / 1e4,
    official_note: v.note,
    official_rule: OFFICIAL_RULE,
    official_basis: basis,
  };
}
