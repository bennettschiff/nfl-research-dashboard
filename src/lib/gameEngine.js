// ── The game engine's numbers, as bundled ────────────────────────────────────
// scripts/build_game_engine.py writes scripts/out/game_engine_<season>.json: the
// engine's score for every played game of the season and the next week's slate,
// with the inputs behind it (points rating, starting quarterbacks, weather,
// per-play efficiency). It is a bundled artifact rather than a table for the
// reason every artifact under ~1 MB is (CLAUDE.md, "Scripts & env"): one more
// table is one more request on every board load.
//
// The engine predicts the SCORE. What it is worth against a price is a separate
// question with a measured answer — see src/lib/gameMarkets.js.
//
// Pure apart from the JSON import, which Node reads the same way the browser
// does (import attributes), so the pick ledger sees exactly what the board shows.
import ENGINE_2026 from "../../scripts/out/game_engine_2026.json" with { type: "json" };

const BY_SEASON = { 2026: ENGINE_2026 };

/**
 * The season's engine record: { season, sigma: {total, margin, team}, byGame }.
 * Null for a season the engine has not been run on — a game row then shows the
 * market with no engine number, rather than inventing one.
 */
export function engineFor(season) {
  const a = BY_SEASON[season];
  if (!a) return null;
  return { season: a.season, builtAt: a.built_at, nextWeek: a.next_week, sigma: a.sigma,
    byGame: new Map(a.games.map((g) => [g.game_id, g])) };
}
