// ── Primary keys of the tables the walkers page ──────────────────────────────
// Every OFFSET walk in this repo — api/season.js, scripts/lib/season.mjs,
// scripts/backup-to-drive.mjs and loadData.js's fallback — orders on the FULL
// primary key read from here, never on its leading column alone.
//
// WHY THE WHOLE KEY. `order=player_id&offset=N` on player_week_stats ties ~6
// rows per player, and Postgres promises nothing about the order of tied rows
// across two separate queries: a row can land on two pages or on none. It came
// out right on 2026-10-12 (7,577 walked / 7,577 counted) only because the
// planner happened to walk the (player_id, season, week) PK index, which breaks
// the ties for free. A seq scan + top-N sort — a different filter, fresher
// stats, a bigger table — breaks them however the heap falls, and a short or
// doubled board would not look broken. Ordering on the whole key is the same
// index walk today and correct under any plan tomorrow.
//
// Must match db/schema.sql (tableKeys.test.js parses it). historical_odds has no
// DDL in the repo; its PK is `id`, read off the live project on 2026-10-12.
export const TABLE_PK = {
  teams: ["team_abbr"],
  games: ["game_id"],
  players: ["player_id"],
  team_offense_profile: ["team_abbr", "season"],
  team_defense_scheme: ["team_abbr", "season"],
  player_scheme_splits: ["player_id", "season"],
  player_season_agg: ["player_id", "season"],
  player_week_stats: ["player_id", "season", "week"],
  player_profiles: ["player_id", "season"],
  player_injuries: ["player_id", "season", "week"],
  nfl_picks: ["id"],
  odds_events: ["event_id"],
  live_odds: ["row_key"],
  game_lines: ["row_key"],
  historical_odds: ["id"],
};

/** The table's primary-key columns. Throws on a table nobody registered. */
export function pkOf(table) {
  const pk = TABLE_PK[table];
  if (!pk) throw new Error(`tableKeys: no primary key registered for nfl.${table}`);
  return pk;
}

/** A PostgREST `order=` value over the whole key, e.g. `player_id.asc,season.asc,week.asc`. */
export function pkOrder(table) {
  return pkOf(table).map((c) => `${c}.asc`).join(",");
}
