// ── The "Today's rules" view of the ledger ───────────────────────────────────
// scripts/rescore_weeks.mjs re-scores the weeks frozen before the baseline
// under the rules the board runs today (src/lib/rescore.js) and writes only
// what changed, per pick_key, to scripts/out/rescored_<season>.json. This lays
// that over the frozen rows for the Results tab. Nothing in nfl_picks moves.
//
// The file is imported lazily: it is only needed when someone opens the view,
// and it would otherwise ride in every page load's bundle.
import { inBaseline, isBet } from "./pickLedger.js";
import { RESCORE_BASIS } from "./rescore.js";

const FILES = { 2026: () => import("../../scripts/out/rescored_2026.json") };

/** The re-scored file for a season, or null when none was built. */
export async function loadRescored(season) {
  const load = FILES[season];
  if (!load) return null;
  const mod = await load();
  return mod.default ?? mod;
}

/**
 * The season as today's rules would have booked it: pre-baseline picks
 * re-scored (a one-sided NO drops out, exactly as it does from week 5 on),
 * baseline weeks as frozen. A pre-baseline row the file does not know keeps its
 * frozen form rather than vanishing.
 */
export function underTodaysRules(picks, rescored) {
  if (!rescored?.picks) return picks;
  const out = [];
  for (const p of picks) {
    if (p.source !== "auto" || inBaseline(p)) { out.push(p); continue; }
    const r = rescored.picks[p.pick_key];
    if (!r) { out.push(p); continue; }
    const q = { ...p, ...r, official_basis: RESCORE_BASIS, official_rule: rescored.official_rule, rescored: true };
    if (isBet(q)) out.push(q);
  }
  return out;
}
