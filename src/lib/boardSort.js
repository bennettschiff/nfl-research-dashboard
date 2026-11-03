// ── Board column sorting ─────────────────────────────────────────────────────
// Extracted from Board.jsx so the ordering rules are testable without rendering
// a table. Every labelled column on the board sorts (CLAUDE.md), and this is the
// one place that says how.
//
// THE RULE, and it is the one several columns got wrong at least once: an
// accessor must return exactly what the CELL SAYS, and null for a cell that says
// "—". `cmp` sinks null in BOTH directions, so an absent value is never mistaken
// for a small one — an unpriced prop is not a zero-edge prop, and a player with
// no market line is not a player the book hung a 0 on.
import { CONF_RANK } from "./confidence.js";
import { AVAIL_RANK } from "./injuries.js";
import { propRank, posRank } from "./props.js";
import { BOOK_PREF, SACK_BOOKS, payout } from "./odds.js";

/** The hit-rate windows, in column order. See src/lib/hitRates.js. */
export const HIT_COLS = ["h2h", "l5", "l10", "l20", "szn", "prev"];

export const SORT_VAL = {
  name: (r) => r.name.toLowerCase(),
  // Rank, not the label. Sorting the SHORT labels alphabetically puts "ANY TD"
  // first and drops "PASS TD" between "PASS YDS" and "REC" — an ordering that
  // looks like a bug because it is meaningless.
  prop: (r) => propRank(r.prop_type),
  pos: (r) => posRank(r.pos),
  proj: (r) => r.proj,
  line: (r) => r.probLine,
  // Win% is P(the side the model is on) — see confidence.js. Sorting raw P(over)
  // descending buried every high-conviction UNDER at the bottom of the board,
  // next to the coin flips.
  win: (r) => r.win,
  conf: (r) => CONF_RANK[r.conf?.tier] ?? 0,
  // TILT IS SIGNED. It used to rank on |tilt − 1|, i.e. distance from neutral,
  // which interleaves a −4% matchup with a +4% one and makes a descending sort
  // read as unordered — the reported bug. Distance-from-neutral is the right
  // ranking for the Leaders strip ("the strongest matchup read of the week is as
  // often a bad one as a good one") and the wrong one for a column you sort to
  // find the players a matchup HELPS. A neutral tilt renders "—" in the cell, so
  // it sorts as missing rather than as the middle of the range.
  tilt: (r) => (Math.abs(r.tilt - 1) > TILT_EPS ? r.tilt : null),
  // Sorting the baseline column on live_weight alone is a no-op at a season
  // flip — every player is 0% live, so all 315 rows tie and the click does
  // nothing. Rank on what the cell actually SAYS instead: how much of the
  // baseline is measured, then how much the carried part can be trusted (a
  // baseline earned on another team, or by someone now buried on the depth
  // chart, is a weaker claim), with rookies last as the least established.
  base: (r) => {
    const c = r.carryover;
    if (!c) return 2;                                     // nothing carried — fully measured
    if (c.prior_source === "rookie") return -1;
    let v = c.live_weight ?? 0;
    if (c.changed_team) v -= 0.25;
    if (c.depth_rank != null) v -= Math.max(0, c.depth_rank - 1) * 0.05;
    return v;
  },
  avail: (r) => AVAIL_RANK[r.avail?.level] ?? 0,
  // Projection minus line, as the cell prints it. Null on a one-sided market:
  // an anytime-TD "projection" is a Poisson rate against a fixed 0.5, and the
  // difference of the two is not a number anybody shops on.
  diff: (r) => r.diff ?? null,
  // Hit-rate columns rank on the RATE, with a zero-game cell null rather than 0%
  // — "never played him" is not "never went over against him".
  ...Object.fromEntries(HIT_COLS.map((k) => [k, (r) => r.hits?.[k]?.rate ?? null])),
  // The streak cell is signed (+3 = three straight overs), and so is its sort.
  // A zero streak renders "—", so it sorts as missing.
  stk: (r) => (r.hits?.streak ? r.hits.streak : null),
  // Unpriced rows return null, not 0 — "no line yet" and "no disagreement with
  // the line" are different states. A row whose EDGE WE DECLINE TO CLAIM is the
  // third such state and sorts as missing too: the cell prints "n/a" for a
  // defensive back's sack price (SACK_PARAMS.EV_POS), and a column that sorted
  // those as zero would put them in the middle of the board while the cell says
  // there is no number there.
  edge: (r) => (r.evTrusted === false ? null : r.priced?.edge ?? null),
  // One accessor per book column, on DECIMAL PAYOUT rather than the American
  // number printed in the cell. Sorting the American number is nonsense across
  // the zero: it puts +100 above +450 and both above −110, because −110 is
  // arithmetically the smallest. Payout is the ordering a reader means by
  // "sort by price", and it agrees with implied probability reversed.
  // The union of both book lists. They are the same three today (SACK_BOOKS
  // aliases BOOK_PREF), but the Odds section shows whichever set the SELECTED
  // prop is priced on, so the sort table keeps knowing every column either of
  // them can produce.
  ...Object.fromEntries([...new Set([...BOOK_PREF, ...SACK_BOOKS])].map((bk) => [bk,
    (r) => {
      const b = r.priced?.books?.[bk];
      return b ? payout(b.overOdds) : null;
    }])),
};

/** Below this the Tilt cell renders "—", so below this it sorts as missing. */
export const TILT_EPS = 0.005;

/**
 * Secondary keys, applied when the primary ties. `[column, direction]`.
 *
 * This is what makes "sort by prop, then by position within it" one click. With
 * one row per prop the Prop column has enormous ties, and leaving them in load
 * order meant an isolated ATD board was a scramble of quarterbacks, backs and
 * receivers. Position first (depth-chart order), then the biggest projection, so
 * picking a market and reading down it is a coherent act.
 */
export const SORT_CHAIN = {
  // Two books can hang the identical price on dozens of props, so a price sort
  // that leaves those in load order reads as unsorted. Fall back to the edge
  // at that price, which is what you were shopping for.
  ...Object.fromEntries([...new Set([...BOOK_PREF, ...SACK_BOOKS])].map((bk) => [bk, [["edge", -1]]])),
  prop: [["pos", 1], ["proj", -1]],
  pos: [["prop", 1], ["proj", -1]],
  conf: [["win", -1]],
  avail: [["win", -1]],
  base: [["proj", -1]],
  // Four of five and eight of ten are both 80%; the longer record wins the tie.
  ...Object.fromEntries(HIT_COLS.map((k) => [k, [["l20", -1], ["win", -1]]])),
  stk: [["l10", -1]],
  diff: [["win", -1]],
};

/** Compare with a fixed direction, always sinking missing values. */
export function cmp(av, bv, dir) {
  if (av == null && bv == null) return 0;
  if (av == null) return 1;                 // absent sorts last, ascending or descending
  if (bv == null) return -1;
  if (typeof av === "string") return av.localeCompare(bv) * dir;
  return (av - bv) * dir;
}

/**
 * The comparator for one column: its accessor, its tiebreak chain, then a stable
 * final fallback. Without the name fallback two rows equal on every key sit in
 * whatever order the projection loop produced, which changes when the slate
 * changes and makes the table look like it shuffles on its own.
 *
 * @param dir 1 ascending, -1 descending
 */
export function comparatorFor(col, dir, table = SORT_VAL, chains = SORT_CHAIN) {
  const get = table[col] || table.win;
  const chain = chains[col] || [];
  return (a, b) => {
    const c = cmp(get(a), get(b), dir);
    if (c !== 0) return c;
    for (const [k, d] of chain) {
      const r = cmp(table[k](a), table[k](b), d);
      if (r !== 0) return r;
    }
    return table.name(a).localeCompare(table.name(b));
  };
}

/** Every column key the board can sort on. Used by the header audit test. */
export const SORT_COLS = Object.keys(SORT_VAL);
