// ── Coaching staff + scheme identity, for the board's matchup strip ──────────
// "Who is calling this offense, who is calling the defense across from it, what
// does each one actually do, and did the model give the player anything for it?"
// Pure: no React, no I/O. DISPLAY ONLY — the model's own scheme inputs are
// teamPriors.js (offense) and defensePriors.js (defense); nothing here feeds it.
//
// ── WHERE EACH NUMBER COMES FROM ─────────────────────────────────────────────
// Staff: scripts/out/coaching_staff_2026.json (play-callers from
// play_callers_2026.json, coordinators from the maintained Wikipedia lists).
//
// Tendencies: scripts/out/team_scheme_2026.json — FTN charting + pbp, last full
// season and this one to date (scripts/build_inseason_sources.py).
//
// ── WHY A TENDENCY IS BLENDED, AND AT WHICH RATE ─────────────────────────────
// One game of motion rate is noise; last season's is a different staff's if the
// staff changed. So the displayed value is this season's weighted by games
// played against last season's, with the prior discarded fast when the person
// who owns the tendency is new. The rates are the measured ones for offense
// (calibrate_season_blend.mjs: K=16 kept caller, K=3 new caller) and reused for
// the defense — not separately fitted, which the UI says.
import STAFF_2026 from "../../scripts/out/coaching_staff_2026.json" with { type: "json" };
import SCHEME_2026 from "../../scripts/out/team_scheme_2026.json" with { type: "json" };
import { teamPriorFor } from "./teamPriors.js";

const STAFF = { 2026: STAFF_2026.teams };
const SCHEME = { 2026: SCHEME_2026.seasons };

export const K_KEPT = 16;
export const K_NEW = 3;

export function staffFor(season, team) {
  return STAFF[season]?.[team] ?? null;
}

/** w = n/(n+K): the weight on this season's games. */
export function liveWeight(games, changed) {
  const n = games || 0;
  return n / (n + (changed ? K_NEW : K_KEPT));
}

function blend(cur, prior, w) {
  if (cur == null) return prior ?? null;
  if (prior == null) return cur;
  return w * cur + (1 - w) * prior;
}

/**
 * One side of one team, blended. `side` is "off" or "def".
 * Returns { values, league, games, weight, changed, priorSeason } or null.
 */
export function tendencyFor(season, team, side) {
  const seasons = SCHEME[season];
  if (!seasons) return null;
  const cur = seasons[String(season)]?.teams?.[team];
  const prev = seasons[String(season - 1)]?.teams?.[team];
  if (!cur && !prev) return null;
  const staff = staffFor(season, team);
  const changed = side === "off"
    ? !!teamPriorFor(season, team)?.play_caller_changed
    : !!staff?.dc_change;
  const games = cur?.games || 0;
  const w = liveWeight(games, changed);
  const keys = Object.keys((cur || prev)[side]);
  const values = {}, league = {};
  const lgCur = seasons[String(season)]?.league?.[side] || {};
  const lgPrev = seasons[String(season - 1)]?.league?.[side] || {};
  for (const k of keys) {
    values[k] = blend(cur?.[side]?.[k], prev?.[side]?.[k], w);
    league[k] = blend(lgCur[k], lgPrev[k], w);
  }
  // The offense's volume and pace are exactly what the MODEL already resolves
  // from the play-caller (teamPriors.js). Show its number, not a second opinion.
  if (side === "off") {
    const tp = teamPriorFor(season, team);
    if (tp?.neutral_pass_rate != null) values.neutral_pass_rate = tp.neutral_pass_rate;
    if (tp?.plays_per_game != null) values.plays_pg = tp.plays_per_game;
    if (tp?.shotgun_rate != null) values.shotgun_rate = tp.shotgun_rate;
  }
  return { values, league, games, weight: w, changed, priorSeason: season - 1,
    current: cur?.[side] || null, prior: prev?.[side] || null };
}

// Label rules: a tag fires on a clear departure from league average, measured in
// the metric's own units. Thresholds are display judgement, not fitted.
const OFF_RULES = [
  { key: "neutral_pass_rate", hi: 0.04, lo: -0.04, up: "Pass-heavy", down: "Run-heavy" },
  { key: "plays_pg", hi: 2.5, lo: -2.5, up: "Up-tempo", down: "Slow pace" },
  { key: "shotgun_rate", hi: 0.10, lo: -0.10, up: "Shotgun-heavy", down: "Under center" },
  { key: "motion_rate", hi: 0.08, lo: -0.08, up: "Motion-heavy", down: "Little motion" },
  { key: "play_action_rate", hi: 0.05, lo: -0.05, up: "Play-action heavy", down: "Little play-action" },
  { key: "rpo_rate", hi: 0.03, lo: null, up: "RPO-heavy", down: null },
  { key: "screen_rate", hi: 0.03, lo: null, up: "Screen-heavy", down: null },
];
const DEF_RULES = [
  { key: "blitz_rate", hi: 0.06, lo: -0.06, up: "Blitz-heavy", down: "Rarely blitzes" },
  { key: "pressure_rate", hi: 0.04, lo: -0.04, up: "Heavy pressure", down: "Little pressure", hurts: true },
  { key: "stacked_box_rate", hi: 0.035, lo: null, up: "Stacks the box", down: null },
  { key: "light_box_rate", hi: 0.07, lo: -0.07, up: "Light boxes", down: "Heavy boxes" },
  { key: "pass_epa", hi: 0.05, lo: -0.05, up: "Leaky vs pass", down: "Stingy vs pass", invert: true },
  { key: "rush_epa", hi: 0.04, lo: -0.04, up: "Leaky vs run", down: "Stingy vs run", invert: true },
];

/**
 * Tags for one side: [{ text, good }] where `good` is from the player's point of
 * view on the OFFENSE's side (a leaky defense is good for him).
 */
export function schemeTags(t, side) {
  if (!t) return [];
  const rules = side === "off" ? OFF_RULES : DEF_RULES;
  const out = [];
  for (const r of rules) {
    const v = t.values[r.key], lg = t.league[r.key];
    if (v == null || lg == null) continue;
    const d = v - lg;
    // `hurts`: a high value is bad for the offense (pressure). `invert`: a high
    // value is good for it (EPA allowed). Neither: descriptive, uncoloured.
    const tone = (up) => (side !== "def" ? null : r.invert ? up : r.hurts ? !up : null);
    if (r.hi != null && d >= r.hi) out.push({ text: r.up, key: r.key, good: tone(true) });
    else if (r.lo != null && r.down && d <= r.lo) out.push({ text: r.down, key: r.key, good: tone(false) });
  }
  if (!out.length) out.push({ text: side === "off" ? "League-average profile" : "League-average profile", key: "avg", good: null });
  return out;
}

/**
 * What the model actually did with the matchup, for one prop.
 *
 *   scheme   — coverage (receiving), box (rushing) or pressure (passing) mult
 *   defense  — the opposing defense's strength mult
 *   pace     — the game-pace mult
 *
 * `reason` explains a neutral scheme read, because "no boost" and "the model
 * could not look" are different statements and the strip must not blur them.
 */
export function boostOf(prop, season) {
  const f = prop?.factors || {};
  const schemeKind = f.coverageMult != null ? "coverage" : f.boxMult != null ? "box"
    : f.pressureMult != null ? "pressure" : null;
  const scheme = f.coverageMult ?? f.boxMult ?? f.pressureMult ?? null;
  const defense = f.defStrengthMult ?? null;
  const pace = f.paceMult ?? null;
  const total = (scheme ?? 1) * (defense ?? 1);
  let reason = null;
  if (scheme == null || Math.abs(scheme - 1) < 0.005) {
    if (schemeKind === "coverage" || schemeKind === "box") {
      reason = season >= 2026
        ? `No ${schemeKind} read: a defense's ${schemeKind === "coverage" ? "man/zone" : "box"} rate has no year-over-year signal, and there is no in-season source for it until nflverse publishes participation data`
        : `No ${schemeKind} read: not enough ${schemeKind === "coverage" ? "man/zone targets" : "box-split carries"} to trust his split`;
    } else if (schemeKind === "pressure") {
      reason = "Pressure matchup is league-average";
    } else {
      reason = "This market has no scheme multiplier";
    }
  }
  return { schemeKind, scheme, defense, pace, total, reason };
}

/** "+6%" / "−3%" / "±0%". */
export function multPct(m) {
  if (m == null) return "—";
  const p = Math.round((m - 1) * 100);
  return p > 0 ? `+${p}%` : p < 0 ? `−${Math.abs(p)}%` : "±0%";
}
