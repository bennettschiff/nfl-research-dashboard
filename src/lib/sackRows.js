// ── Sack rows, in the board's own shape ──────────────────────────────────────
// The sack market used to have its own tab, its own filter bar, its own week
// picker and its own table — a second board, for one market. It is a market like
// the others, so it is now a row on the board (src/lib/props.js: def_sacks), and
// this module is the adapter: sackBoard()'s defender rows → exactly the row
// buildBoardRows() produces for a receiving prop.
//
// WHY AN ADAPTER AND NOT A BRANCH INSIDE buildBoardRows. The two sides share
// nothing upstream: a skill row comes from player priors, a team volume budget
// and a scheme cascade; a defender comes from pass-rush opportunity aggregates
// and an opposing line's sacks allowed. They converge at the ROW — one player,
// one market, a line, a projection, a probability at that line, a price — and
// that convergence is the whole point, because everything downstream of the row
// (the sort table, the columns, the pick ledger, the grader, the Results tab)
// then works on sacks without knowing sacks exist.
//
// ── THE LINE IS A RUNG, AND WHICH RUNG IS THE ANSWER ────────────────────────
// Books post 0.25 / 0.5 / 0.75 / 1.0. Those are four prices on TWO questions:
// half a sack, or a whole one. So the row's Line is the rung the price is on and
// its Win% is P(he clears THAT rung) — 0.5 and 1.0 are genuinely different bets
// and the row says which one it is. With no market posted the line is
// DEFAULT_RUNG, the number every book that does post this market posts.
//
// ONE-SIDED, like anytime TD (props.js ONE_SIDED_PROPS). There is no under here
// worth taking and most of the market is DFS pick'em, which posts one price for
// both sides; Win% is therefore P(over) unflipped, so a 12% row ranks as the
// longshot it is instead of an 88% lock on a bet nobody offers.
//
// Pure: no React, no I/O. scripts/snapshot_picks.mjs builds these rows too, so
// the ledger records the same sack rows the board shows.
import { sackBoard } from "./sackPriors.js";
import { sackProbOver, sackPushProb, sackRungs, SACK_LINES } from "./sacks.js";
import { probToAmericanOdds } from "./models.js";
import { sackPriced } from "./odds.js";
import { availabilityOf, statusFor, isRuledOut } from "./injuries.js";
import { confidenceOf, winProb, oneSidedCall } from "./confidence.js";
import { normName } from "./names.js";
import { propShort } from "./format.js";

export const SACK_PROP = "def_sacks";

/**
 * The rung the row carries when no book has posted this player.
 *
 * 0.5 is not a guess: FanDuel posted the week-2 slate's sacks at 0.5 and
 * Underdog posted all 66 of its players at 0.5. It is THE sack line, so a row
 * with no market is still priced at the number a market would arrive on.
 */
export const DEFAULT_RUNG = 0.5;

/** Every rung, with our probability and a fair price — the row's expansion. */
export function sackLadder(lambda) {
  return SACK_LINES.map((line) => {
    const prob = sackProbOver(lambda, line);
    return { line, prob, fair_line: probToAmericanOdds(prob) };
  });
}

/**
 * Every sack row for `games`, one per (defender, game).
 *
 * @param d      the season object assembleSeason() builds
 * @param games  the week's games, already filtered by the caller
 */
export function buildSackRows(d, games) {
  const rows = sackBoard(d.year, games, { sackOdds: d.sackOdds });
  const gameById = new Map(games.map((g) => [g.game_id, g]));
  const out = [];

  for (const r of rows) {
    const rungs = sackRungs(r.lambda);
    // The market first, because it decides the line the probability is computed
    // at — the board's rule everywhere (src/lib/boardRows.js): a model
    // probability at its own invented number beside a book's price is two
    // different bets in one row.
    const priced = sackPriced(d.sackOdds?.get(`${r.game_id}|${normName(r.name)}`) || null,
                              (line) => sackProbOver(r.lambda, line), undefined,
                              (line) => sackPushProb(r.lambda, line));
    const line = priced?.line ?? DEFAULT_RUNG;
    const prob = sackProbOver(r.lambda, line);

    // Availability is the same two questions it is for a skill player: is he on
    // the roster (the live defensive overlay, already applied by sackBoard —
    // `status` is what it found), and has his club filed a designation this week
    // (the injury report, which covers defenders exactly as it covers everyone).
    const avail = availabilityOf(d.injuries, r.pid, r.week, r.status);
    const status = statusFor(avail);
    const ruledOut = isRuledOut(avail);

    const headline = {
      prop_type: SACK_PROP, label: "Sacks",
      line, proj_mean: round2(r.lambda), prob_over: prob,
      // No sigma: the distribution is a compound negative binomial over
      // half-sack credits, not a normal, so a spread in yards has no meaning
      // here. officialPicks.js scores this market on the rate ratio instead.
      sigma: null, fair_line: probToAmericanOdds(prob),
      factors: { oppLineMult: r.oppAdj ?? null },
    };

    out.push({
      key: `${r.game_id}|${r.pid}|${SACK_PROP}`,
      player_id: r.pid, name: r.name,
      pos: r.pos, team: r.team, opp: r.opp,
      game: gameById.get(r.game_id), side: r.side,
      prop: "Sacks", propShort: propShort(SACK_PROP), prop_type: SACK_PROP,
      headline, props: [headline],
      proj: round2(r.lambda), probLine: line,
      prob, oneSided: true, win: winProb(prob, true),
      // Does the model take the Yes at this rung's price? A defensive back is
      // never a yes — his edge is not claimed (SACK_PARAMS.EV_POS).
      call: oneSidedCall(priced, r.evTrusted !== false),
      // The chance his credit lands ON the line: a push, which the ledger's EV
      // must count as stake returned rather than lost.
      pushProb: sackPushProb(r.lambda, line),
      conf: confidenceOf({ prob, carryover: null, status, oneSided: true }),
      // The opposing line's sacks-allowed multiplier — the only matchup term
      // this model has, in the column the board already uses for one.
      tilt: r.oppAdj ?? 1,
      priced,
      // Null, not zero: the projection is a rate over a half-sack ladder, so
      // "projection minus line" is not a number anybody shops on. Same rule as
      // anytime TD.
      diff: null,
      // No hit-rate columns. They would have to count how often a defender
      // cleared this rung, and the only sack history the app bundles is the
      // current season's actuals — six defender-games in week 2, which is not a
      // hit rate. The cells render "—" and the sort sinks them.
      hits: null,
      avail, ruledOut, carryover: null, depth: null,
      // ── sack-only fields, for the row's expansion and its EV cell ──────────
      lambda: r.lambda, rungs, ladder: sackLadder(r.lambda),
      snapPct: r.snapPct ?? null,
      oppSackRateAllowed: r.oppSackRateAllowed ?? null,
      spread: r.spread ?? null,
      games: r.games ?? null,
      rosterStatus: r.status ?? null,
      // Defensive backs are unbiased across the population and still run 1.46x
      // hot on the rows that reach a board, so their price is shown and no edge
      // is claimed. See SACK_PARAMS.EV_POS.
      evTrusted: r.evTrusted,
      offer: r.offer,
      offerRungs: r.rungs,
    });
  }
  return out;
}

const round2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
