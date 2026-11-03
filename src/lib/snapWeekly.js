// ── Per-week snaps, from the artifact that keeps the fastest time ────────────
// Snap counts reach the board on TWO paths, and they run at different speeds:
//
//   SLOW  build_week_roles.py stamps snaps_wk / snap_pct_wk onto the week rows
//         in nfl.player_week_stats, which only exist once etl.py has loaded the
//         week — a weekly cron.
//   FAST  scripts/out/player_snaps_weekly_<season>.json, rewritten by
//         pull_roster.mjs (Wed/Thu/Sat) straight from nflverse snap_counts,
//         which is published within a day of each game.
//
// On 2026-09-22 the snap room showed Jahmyr Gibbs at 83% in week 2 while his
// game log stopped at week 1: the snap artifact had Thursday's game, the week
// rows did not. Two tables in the same expanded row disagreeing about which
// games have been played is the kind of thing that reads as a bug.
//
// This module is the one index of the fast file, and `withSnapWeeks` lays it
// over week rows the way rosterStatus.js lays the roster over the priors: the
// artifact wins where it has a value, the row keeps what it had where it does
// not. It never INVENTS a week — a game with snaps but no stat line yet is not
// a game log row, it is a row of dashes pretending to be one.
import SNAPS_2026 from "../../scripts/out/player_snaps_weekly_2026.json" with { type: "json" };

const index = (doc) => {
  const out = {};
  for (const r of doc?.snaps || []) {
    if (!r.player_id) continue;
    (out[r.player_id] ||= {})[r.week] = { snaps: r.off_snaps, pct: r.off_pct, team: r.team_abbr };
  }
  return out;
};

const BY_SEASON = { 2026: index(SNAPS_2026) };

/** Is there a bundled per-week snap file for this season at all? */
export const hasSnapWeeks = (season) => BY_SEASON[season] != null;

/** player_id → { week: { snaps, pct, team } }, or {} for a season with no file. */
export const snapWeeksFor = (season) => BY_SEASON[season] || {};

/** One player's week, or null. */
export const snapWeek = (season, playerId, week) => BY_SEASON[season]?.[playerId]?.[week] || null;

/**
 * Week rows with snaps_wk / snap_pct_wk refreshed from the fast artifact.
 *
 * Rows from a season with no bundled file — every season before 2026, whose
 * snaps came from participation data once it was published — pass through
 * untouched, so the prior-season log keeps the columns it already had.
 */
export function withSnapWeeks(weeks, season) {
  const idx = BY_SEASON[season];
  if (!idx || !weeks?.length) return weeks || [];
  return weeks.map((w) => {
    const s = idx[w.player_id]?.[w.week];
    if (!s) return w;
    return {
      ...w,
      snaps_wk: s.snaps ?? w.snaps_wk ?? null,
      snap_pct_wk: s.pct ?? w.snap_pct_wk ?? null,
    };
  });
}
