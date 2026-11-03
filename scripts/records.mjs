#!/usr/bin/env node
/**
 * THE RECORD — straight W-L and unit P/L per prop, over every week we have odds for.
 *
 * backtest.mjs answers "is the model good?" (MAE, Brier, calibration). This
 * answers the blunter question: if we had bet it, what would the sheet say?
 *
 * Two policies are scored over the same graded set, because they are different
 * claims and mixing them is how a model flatters itself:
 *
 *   EVERY PROP — bet the model's own side (Over iff P>50%) on every two-sided
 *     prop, 1 unit, at the real FanDuel price for that side. Price is used ONLY
 *     to settle, never to select. This is the honest record of the prediction
 *     engine: no filter can hide a bad call.
 *
 *   +EV ONLY — the shipped card: bet only where the model's probability beats
 *     the price. Selection is the product; this shows whether it adds anything.
 *
 * ANYTIME TD IS NOT IN THE EVERY-PROP TRACK. FanDuel prices only the Yes side,
 * so the model's overwhelmingly common "No" call has no price to settle against.
 * Grading it as if No were available at -110 would invent ~7k winning bets at a
 * price that never existed. It is reported on its Yes bets alone, labelled.
 *
 * WEEKS 1-3 require --carryover: with no carried baseline a player has 0-2 prior
 * games and the from-scratch harness discards him (grade.mjs MIN_PRIOR).
 *
 * Run:  node scripts/records.mjs              (wk4-18, baseline as historically graded)
 *       node scripts/records.mjs --carryover  (wk1-18, the shipped 2026 carryover baseline)
 */
import { buildGraded, SEGMENTS, SEGMENTS_ALL, YARD_PROPS, pad, padL, pct, sgn } from "./lib/grade.mjs";

const CARRY = process.argv.includes("--carryover");
const { graded, counts } = buildGraded({ carryover: CARRY });
const SEGS = CARRY ? SEGMENTS_ALL : SEGMENTS;

// American odds → profit on a 1-unit win.
const profit = (odds) => (odds > 0 ? odds / 100 : 100 / Math.abs(odds));

// The model's side, price never consulted.
const sideOver = (x) => x.shippedP > 0.5;

/**
 * Settle one prop as a 1-unit bet on the model's side.
 * Returns null when that side has no published price (nothing to settle).
 */
function settle(x) {
  const over = sideOver(x);
  const odds = over ? x.overOdds : x.underOdds;
  if (odds == null) return null;
  // A yards prop landing exactly on the number is a push: stake back, no W or L.
  if (x.actual != null && x.line != null && x.actual === x.line) return { push: true, units: 0, odds };
  const won = over ? x.hit === 1 : x.hit === 0;
  return { push: false, won, units: won ? profit(odds) : -1, odds };
}

function record(rows) {
  let w = 0, l = 0, p = 0, u = 0, staked = 0;
  for (const x of rows) {
    const s = settle(x);
    if (!s) continue;
    if (s.push) { p++; continue; }
    staked += 1; u += s.units;
    if (s.won) w++; else l++;
  }
  return { w, l, p, u, staked, n: w + l + p, roi: staked ? u / staked : 0 };
}

const fmtRec = (r) => `${r.w}-${r.l}${r.p ? `-${r.p}` : ""}`;
const winPct = (r) => (r.w + r.l ? r.w / (r.w + r.l) : 0);

const seg = (S) => graded.filter((x) => x.week >= S.lo && x.week <= S.hi);
const line = (n = 92) => console.log("─".repeat(n));

console.log("═".repeat(92));
console.log(`  THE RECORD · 2025 · FanDuel closing lines · ${CARRY ? "weeks 1-18 (carryover baseline)" : "weeks 4-18 (from-scratch baseline)"}`);
console.log("═".repeat(92));
console.log(`  graded ${counts.graded} / ${counts.total} offered props (${pct(counts.graded / counts.total)} coverage)`);
if (!CARRY) console.log("  weeks 1-3 excluded: no from-scratch baseline exists. Re-run with --carryover to include them.");
console.log("  break-even at -110 is 52.4%. Betting a coin flip into standard vig returns -4.5%.\n");

// ── 1. EVERY PROP ────────────────────────────────────────────────────────────
console.log("█".repeat(92));
console.log("  POLICY A — BET EVERY PROP, MODEL'S SIDE   (price settles, never selects)");
console.log("█".repeat(92) + "\n");

for (const S of SEGS) {
  const rows = seg(S);
  console.log(`${pad(S.label, 20)}${S.note ? `  ${S.note}` : ""}`);
  console.log(`${pad("", 20)}${pad("prop", 13)}${padL("W-L", 12)}${padL("win%", 9)}${padL("units", 10)}${padL("ROI", 9)}`);
  let tw = 0, tl = 0, tp = 0, tu = 0, ts = 0;
  for (const mt of YARD_PROPS) {
    const r = record(rows.filter((x) => x.mtype === mt));
    if (!r.n) continue;
    tw += r.w; tl += r.l; tp += r.p; tu += r.u; ts += r.staked;
    console.log(`${pad("", 20)}${pad(mt, 13)}${padL(fmtRec(r), 12)}${padL(pct(winPct(r)), 9)}${padL(sgn(r.u, 1) + "u", 10)}${padL(sgn(r.roi * 100, 1) + "%", 9)}`);
  }
  const T = { w: tw, l: tl, p: tp, u: tu, staked: ts };
  console.log(`${pad("", 20)}${pad("ALL YARDS", 13)}${padL(fmtRec(T), 12)}${padL(pct(winPct(T)), 9)}${padL(sgn(tu, 1) + "u", 10)}${padL(sgn(ts ? (tu / ts) * 100 : 0, 1) + "%", 9)}`);
  line();
}

// ── 2. +EV ONLY ──────────────────────────────────────────────────────────────
// The shipped card's selection, over the identical records.
const isPlusEV = (x) => {
  const over = sideOver(x);
  const odds = over ? x.overOdds : x.underOdds;
  if (odds == null) return false;
  const p = over ? x.shippedP : 1 - x.shippedP;
  return p * profit(odds) - (1 - p) > 0;
};

console.log("\n" + "█".repeat(92));
console.log("  POLICY B — +EV ONLY   (the shipped card's selection, same records)");
console.log("█".repeat(92) + "\n");

for (const S of SEGS) {
  const rows = seg(S).filter(isPlusEV);
  console.log(`${pad(S.label, 20)}${S.note ? `  ${S.note}` : ""}`);
  console.log(`${pad("", 20)}${pad("prop", 13)}${padL("W-L", 12)}${padL("win%", 9)}${padL("units", 10)}${padL("ROI", 9)}`);
  let tw = 0, tl = 0, tp = 0, tu = 0, ts = 0;
  for (const mt of YARD_PROPS) {
    const r = record(rows.filter((x) => x.mtype === mt));
    if (!r.n) continue;
    tw += r.w; tl += r.l; tp += r.p; tu += r.u; ts += r.staked;
    console.log(`${pad("", 20)}${pad(mt, 13)}${padL(fmtRec(r), 12)}${padL(pct(winPct(r)), 9)}${padL(sgn(r.u, 1) + "u", 10)}${padL(sgn(r.roi * 100, 1) + "%", 9)}`);
  }
  const T = { w: tw, l: tl, p: tp, u: tu, staked: ts };
  console.log(`${pad("", 20)}${pad("ALL YARDS", 13)}${padL(fmtRec(T), 12)}${padL(pct(winPct(T)), 9)}${padL(sgn(tu, 1) + "u", 10)}${padL(sgn(ts ? (tu / ts) * 100 : 0, 1) + "%", 9)}`);
  line();
}

// ── 3. ANYTIME TD ────────────────────────────────────────────────────────────
console.log("\n" + "█".repeat(92));
console.log("  ANYTIME TD — Yes bets only (FanDuel publishes no No price)");
console.log("█".repeat(92) + "\n");
console.log(`${pad("segment", 20)}${pad("policy", 16)}${padL("W-L", 12)}${padL("win%", 9)}${padL("units", 10)}${padL("ROI", 9)}`);
for (const S of SEGS) {
  const rows = seg(S).filter((x) => x.mtype === "anytime_td" && x.overOdds != null);
  const yes = (arr) => {
    let w = 0, l = 0, u = 0;
    for (const x of arr) { const won = x.hit === 1; u += won ? profit(x.overOdds) : -1; if (won) w++; else l++; }
    return { w, l, p: 0, u, staked: w + l, roi: w + l ? u / (w + l) : 0 };
  };
  const ev = yes(rows.filter((x) => x.shippedP * profit(x.overOdds) - (1 - x.shippedP) > 0));
  if (!ev.staked) continue;
  console.log(`${pad(S.label, 20)}${pad("+EV Yes", 16)}${padL(fmtRec(ev), 12)}${padL(pct(winPct(ev)), 9)}${padL(sgn(ev.u, 1) + "u", 10)}${padL(sgn(ev.roi * 100, 1) + "%", 9)}`);
}

// ── 4. GRAND TOTAL ───────────────────────────────────────────────────────────
const full = SEGS[SEGS.length - 1];
const allRows = seg(full);
const everyProp = record(allRows.filter((x) => YARD_PROPS.includes(x.mtype)));
const plusEV = record(allRows.filter((x) => YARD_PROPS.includes(x.mtype) && isPlusEV(x)));
console.log("\n" + "═".repeat(92));
console.log(`  BOTTOM LINE · ${full.label.trim()} · yards props`);
console.log("═".repeat(92));
console.log(`  every prop : ${fmtRec(everyProp)}  (${pct(winPct(everyProp))})   ${sgn(everyProp.u, 1)}u on ${everyProp.staked} bets   ROI ${sgn(everyProp.roi * 100, 1)}%`);
console.log(`  +EV only   : ${fmtRec(plusEV)}  (${pct(winPct(plusEV))})   ${sgn(plusEV.u, 1)}u on ${plusEV.staked} bets   ROI ${sgn(plusEV.roi * 100, 1)}%`);
console.log(`  a 52.4% win rate is break-even; ${pct(winPct(everyProp))} on ${everyProp.staked} bets is ${winPct(everyProp) >= 0.524 ? "above" : "below"} it.`);
