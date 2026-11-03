// ── The nfl_picks columns the Results tab reads ──────────────────────────────
// Everything but `signals`, the per-pick factor chain: ~800 of a row's ~1,200
// bytes, and read by nobody on that page. Shared by api/picks.js and the anon
// fallback in src/lib/picks.js so the two paths cannot drift — the fallback used
// to read `select=*`, which made it the widest, slowest read of the table and
// the one with the tightest statement timeout (anon: 3 s). Plain JS with no
// imports, because the serverless function loads it too.
export const PICK_LIST_COLS = [
  "id", "pick_key", "source", "pick_date", "season", "week", "game_id", "kickoff_at",
  "player_id", "player_name", "team", "opp", "position", "prop_type", "line", "direction",
  "proj_mean", "sigma", "prob_over", "side_prob", "mkt_prob", "devigged", "edge", "ev", "fair_line",
  "matchup_tilt", "conf_tier", "conf_score", "avail", "model_version", "book", "book_odds",
  "outcome", "actual", "profit", "close_line", "close_odds", "close_prob", "close_at", "clv_prob", "clv_line",
  "captured_at", "odds_at", "graded_at", "created_at",
  "official", "official_score", "official_note", "official_rule", "official_basis",
].join(",");

// PostgREST's default max-rows, and the page every walk of the ledger uses.
export const PICK_PAGE = 1000;
