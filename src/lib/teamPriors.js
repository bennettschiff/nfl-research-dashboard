// ── Season-flip team priors ──────────────────────────────────────────────────
// scripts/out/team_priors_2026.json is produced by scripts/resolve_2026_priors.mjs:
// each team's offensive prior resolved from its PLAY-CALLER rather than from the
// franchise, then weaned onto live season data at the measured rate (K=16 games
// where the caller is unchanged, K=3 where he is new).
//
// Imported as a build-time artifact rather than fetched. It is 32 rows that
// change at most weekly, so a table round-trip buys little; the cost is that
// refreshing mid-season means re-running the resolver and redeploying. If that
// becomes a chore, move it to an `nfl.team_priors` table and swap the loader —
// nothing downstream of `teamPriorFor` needs to know the difference.
//
// GATED ON SEASON. The priors describe 2026. At SEASON=2025 this returns null for
// every team and the projection falls back to the observed team profile, so
// nothing about the 2025 validation surface changes.
import PRIORS_2026 from "../../scripts/out/team_priors_2026.json" with { type: "json" };

// THE PRIOR'S OWN LEAGUE MEAN rides on every row. The caller priors count plays
// the way the coach-tendency builders do — pass and run snaps with an xpass
// value, ~61 a game — while models.js LG_PLAYS (63) is the ETL team profile's
// count, which keeps penalty-nullified snaps. Reading one against the other made
// every 2026 game 1.7% slower than average (paceMult averaged 0.981 on the
// ledger and topped out at 1.006). A team's pace is its distance from ITS OWN
// league, so the mean travels with the numbers it describes.
function withLeague(rows) {
  const ppg = rows.map((r) => r.plays_per_game).filter((v) => v > 0);
  const league = ppg.length ? ppg.reduce((a, b) => a + b, 0) / ppg.length : null;
  return Object.fromEntries(rows.map((r) => [r.team_abbr, { ...r, league_plays_per_game: league }]));
}

const BY_SEASON = { 2026: withLeague(PRIORS_2026) };

// The prior for one team in one season, or null when we have none for that year.
export function teamPriorFor(season, teamAbbr) {
  return BY_SEASON[season]?.[teamAbbr] ?? null;
}

// Every team's prior for a season, for the audit/board view.
export function teamPriorsFor(season) {
  return BY_SEASON[season] ?? {};
}

// Whether a season has priors at all — lets the UI decide whether to surface the
// "who is calling plays" column without hardcoding a year.
export function hasTeamPriors(season) {
  return !!BY_SEASON[season];
}
