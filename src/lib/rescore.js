// ── Weeks frozen before the 2026-10-07 rules, re-scored under them ───────────
// The ledger's weeks 1-4 are a different book from week 5 on (pickLedger.js
// BASELINE): every one-sided Yes booked, sack rungs priced one rung generous,
// Win% the model alone. They stay exactly as they were frozen — this module
// never writes a pick. It answers a different question beside them: "if the
// rules the board runs TODAY had been running then, what would the card have
// been?" — so the season can be read as one book.
//
// ONLY FROZEN INPUTS. Every number this reads was on the pick before kickoff:
// the projection, the spread, and every book's price on the line, as
// `signals.books` captured them. No later stat, roster or price reaches it.
// What it applies after the fact is the RULE, which is why its record is
// labelled "today's rules" and never folded into the official one.
//
// WHAT TODAY'S RULES CHANGE, IN THE ORDER pickFromRow APPLIES THEM
//   1. Win% is the model calibrated to each book's price (models.js
//      calibrateToMarket). Receptions also get today's spread (receptionsSigma),
//      which is what the frozen probability was missing.
//   2. Two-sided: the side is the calibrated probability's, so a pick can flip
//      from over to under and is then graded, and paid, as the under.
//   3. One-sided: a call. Anytime TD is a Yes only when the calibrated
//      probability makes the best posted Yes +EV; otherwise it is a NO, which is
//      not a bet (pickLedger.js isBet).
//   4. Sacks: P(win) is P(credit > rung) with the push worth its probability in
//      EV, the rung is the best of those the books posted on the frozen row, and
//      a defensive back is never a Yes (SACK_PARAMS.EV_POS).
//   5. The official verdict (officialPicks.js) with the market standing as it
//      stands NOW — passed in, so the caller says which one.
//
// THE SACK LADDER IS PARTIAL. The live board picks a rung from every rung each
// book posted; a frozen pick kept one per book (the rung the old pricing liked).
// So a sack row here chooses among up to three rungs, not the full ladder, and
// can miss a Yes the board would have found on a rung no book row kept.
//
// Pure. No React, no I/O.
import { calibrateToMarket, calcEV, poissonGTE, probOverNormal, probOverSkewed, SKEW_W_BY_PROP, receptionsSigma } from "./models.js";
import { devig, BOOK_PREF } from "./odds.js";
import { sideOf } from "./confidence.js";
import { outcomeOf, profitOf } from "./pickLedger.js";
import { officialColumns } from "./officialPicks.js";
import { sackProbOver, sackPushProb, sackEvTrusted } from "./sacks.js";

export const RESCORE_RULES = "rules@2026-10-07";
/** The official_basis a re-scored verdict carries. Never 'pre-kickoff'. */
export const RESCORE_BASIS = "rules";

const LG_CATCH = 0.678;
const IMPLIED_LINE = { anytime_td: 0.5 };
const payout = (a) => (a == null ? -Infinity : a > 0 ? a / 100 : 100 / Math.abs(a));
const round = (x, d = 4) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const num = (x) => (x == null || x === "" ? null : Number(x));

/** The model's raw P(over) at `line`, as models.js / odds.js modelProbAt prices it today. */
function rawOverAt(p, line, sigma) {
  const proj = num(p.proj_mean);
  if (proj == null) return null;
  if (p.prop_type === "anytime_td" || p.prop_type === "pass_tds") return poissonGTE(proj, Math.ceil(line));
  if (sigma == null) return null;
  const w = SKEW_W_BY_PROP[p.prop_type] ?? 0;
  return w > 0 ? probOverSkewed(proj, sigma, line, w) : probOverNormal(proj, sigma, line);
}

/** Today's spread for the pick: receptions re-derived from its frozen target projection. */
function sigmaOf(p) {
  const f = p.signals?.factors;
  if (p.prop_type === "receptions" && f?.projTargets != null) return receptionsSigma(f.projTargets, f.catchRate ?? LG_CATCH);
  return num(p.sigma);
}

/** The frozen books, in BOOK_PREF order, each as { line, overOdds, underOdds }. */
function booksOf(p) {
  const b = p.signals?.books || {};
  return BOOK_PREF.filter((bk) => b[bk] && b[bk].over != null).map((bk) => ({
    book: bk, line: b[bk].line ?? IMPLIED_LINE[p.prop_type] ?? null, overOdds: b[bk].over, underOdds: b[bk].under ?? null,
  })).filter((x) => x.line != null);
}

/** Grade a re-scored side against the frozen actual, keeping a void a void and a pending pending. */
function regrade(p, side, line, odds) {
  if (p.outcome !== "win" && p.outcome !== "loss" && p.outcome !== "push") return { outcome: p.outcome, profit: num(p.profit) };
  const actual = num(p.actual);
  if (actual == null) return { outcome: p.outcome, profit: num(p.profit) };
  const outcome = outcomeOf(side, Number(line), actual);
  return { outcome, profit: profitOf(outcome, odds) };
}

/** A NO: on record, not a bet. */
const pass = (p) => ({ pick_key: p.pick_key, direction: "no", outcome: "pass", profit: 0 });

/** Two-sided yardage / receptions / pass TDs, priced the way priceAgainstMarket + pickFromRow do. */
function twoSided(p) {
  const books = booksOf(p);
  if (!books.length) return null;
  const refLine = books[0].line;
  const sigma = sigmaOf(p);
  const onLine = books.filter((b) => b.line === refLine).map((b) => {
    const raw = rawOverAt(p, refLine, sigma);
    const { prob: mktProb, devigged } = devig(b.overOdds, b.underOdds);
    return { ...b, mktProb, devigged, prob: raw == null ? null : calibrateToMarket(p.prop_type, raw, mktProb, devigged) };
  }).filter((b) => b.prob != null);
  if (!onLine.length) return null;
  // The row's probability is the best OVER price's book (priceAgainstMarket's `best`).
  const best = onLine.reduce((a, b) => (payout(b.overOdds) > payout(a.overOdds) ? b : a));
  const prob = best.prob;
  const side = sideOf(prob);
  const sideProb = side === "over" ? prob : 1 - prob;
  // The side's price: best payout on that side, on the line (pickLedger.js sidePrice).
  let px = null;
  for (const b of onLine) {
    const odds = side === "under" ? b.underOdds : b.overOdds;
    if (odds == null) continue;
    const mkt = side === "under" ? (b.devigged ? 1 - b.mktProb : null) : b.mktProb;
    if (!px || payout(odds) > payout(px.odds)) px = { book: b.book, odds, mktProb: mkt, devigged: b.devigged };
  }
  return { line: refLine, sigma, side, prob, sideProb, px, push: 0 };
}

/** Anytime TD: a Yes only when the calibrated probability makes the best posted Yes +EV. */
function anytimeTd(p) {
  const books = booksOf(p);
  if (!books.length) return null;
  const refLine = books[0].line;
  const onLine = books.filter((b) => b.line === refLine).map((b) => {
    const { prob: mktProb, devigged } = devig(b.overOdds, b.underOdds);
    const raw = rawOverAt(p, refLine, null);
    return { ...b, mktProb, devigged, prob: raw == null ? null : calibrateToMarket(p.prop_type, raw, mktProb, devigged) };
  }).filter((b) => b.prob != null);
  if (!onLine.length) return null;
  const best = onLine.reduce((a, b) => (payout(b.overOdds) > payout(a.overOdds) ? b : a));
  const ev = calcEV(best.prob, best.overOdds);
  if (!(ev > 0)) return { call: "no" };
  return { line: refLine, sigma: null, side: "over", prob: best.prob, sideProb: best.prob,
    px: { book: best.book, odds: best.overOdds, mktProb: best.mktProb, devigged: best.devigged }, push: 0 };
}

/** Sacks: the best-EV rung among the frozen books, priced as the book settles it. */
function sacks(p) {
  const lambda = num(p.proj_mean);
  if (lambda == null) return null;
  let best = null;
  for (const b of booksOf(p)) {
    const prob = sackProbOver(lambda, b.line);
    const push = sackPushProb(lambda, b.line);
    const ev = calcEV(prob, b.overOdds);
    if (ev == null) continue;
    if (!best || ev + push > best.ev + best.push) best = { ...b, prob, push, ev };
  }
  if (!best) return null;
  if (!sackEvTrusted(p.position) || !(best.ev + best.push > 0)) return { call: "no" };
  const { prob: mktProb, devigged } = devig(best.overOdds, best.underOdds);
  return { line: best.line, sigma: null, side: "over", prob: best.prob, sideProb: best.prob,
    px: { book: best.book, odds: best.overOdds, mktProb, devigged }, push: best.push };
}

/**
 * One frozen pick → the pick today's rules would have made from the same inputs.
 *
 * @param p         an nfl_picks row read with `signals`
 * @param standing  officialPicks.js marketStanding() — today's, by design
 * @returns the fields that differ from the frozen row (merge them over it), or
 *          null when the frozen row cannot be re-priced (no book on file); a NO
 *          comes back as direction 'no', outcome 'pass'
 */
export function rescorePick(p, standing) {
  const r = p.prop_type === "anytime_td" ? anytimeTd(p)
    : p.prop_type === "def_sacks" ? sacks(p)
    : twoSided(p);
  if (!r) return null;
  if (r.call === "no") return pass(p);

  const { outcome, profit } = regrade(p, r.side, r.line, r.px?.odds ?? null);
  const sideFlipped = r.side !== p.direction || Number(r.line) !== Number(p.line) || (r.px?.book ?? null) !== p.book;
  const rec = {
    pick_key: p.pick_key,
    direction: r.side, line: r.line, sigma: round(r.sigma),
    prob_over: round(r.prob), side_prob: round(r.sideProb),
    book: r.px?.book ?? null, book_odds: r.px?.odds ?? null,
    mkt_prob: round(r.px?.mktProb), devigged: r.px?.devigged ?? null,
    edge: r.px?.mktProb == null ? null : round(r.sideProb - r.px.mktProb),
    ev: r.px ? round(calcEV(r.sideProb, r.px.odds) + r.push) : null,
    outcome, profit,
  };
  // The close the grader stamped was for the frozen side, line and book. A
  // re-scored pick on a different one has no close of its own; it keeps close_at,
  // so it still reads as priced at the close (which every week-1-4 pick was).
  if (sideFlipped) Object.assign(rec, { close_line: null, close_odds: null, close_prob: null, clv_prob: null, clv_line: null });
  const v = officialColumns({ ...p, ...rec }, standing, RESCORE_BASIS);
  return { ...rec, ...v, official_rule: `${v.official_rule}+${RESCORE_RULES}` };
}
