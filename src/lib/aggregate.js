// ── Weekly → season-shaped aggregation ───────────────────────────────────────
// Shared by the app (build a "recent form" baseline from player_week_stats) and
// the validation harness (rebuild a strictly through-(N-1) baseline). One
// implementation so both compute the recent-form blend the same way.

// Aggregate an array of player_week_stats rows into a player_season_agg-shaped
// object (per-game rates + efficiencies). Order-independent.
export function aggregateWeeks(rows) {
  if (!rows || !rows.length) return null;
  const g = rows.length;
  const sum = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
  const last = rows[rows.length - 1];
  const tgt = sum("targets"), rec = sum("receptions"), recyd = sum("rec_yards");
  const car = sum("carries"), ruyd = sum("rush_yards");
  const att = sum("pass_att"), cmp = sum("completions"), pyd = sum("pass_yards");
  return {
    position: last.position, team_abbr: last.team_abbr, games: g,
    target_share: rows.reduce((s, r) => s + (r.target_share || 0), 0) / g,
    targets_pg: tgt / g, rec_pg: rec / g, rec_yards_pg: recyd / g,
    ypt: tgt ? recyd / tgt : null, catch_rate: tgt ? rec / tgt : null,
    rec_td_pg: sum("rec_tds") / g,
    carries_pg: car / g, rush_yards_pg: ruyd / g, ypc: car ? ruyd / car : null,
    rush_td_pg: sum("rush_tds") / g,
    // player_season_agg carries total_td_pg and the anytime-TD model prefers it
    // over re-deriving the sum, so a row built here has to carry it too — without
    // it a live/recent baseline silently fell through to the prior-season value
    // in the carryover blend and never weaned.
    total_td_pg: (sum("rush_tds") + sum("rec_tds")) / g,
    pass_att_pg: att ? att / g : null, comp_pct: att ? cmp / att : null,
    ypa: att ? pyd / att : null, pass_yards_pg: att ? pyd / g : null,
    pass_td_pg: att ? sum("pass_tds") / g : null,
  };
}

// Build a recent-form baseline from a player's weekly rows: the last `n` games
// strictly before `beforeWeek` (pass Infinity for "most recent n of the season").
export function recentBaseline(rows, beforeWeek = Infinity, n = 4) {
  if (!rows || !rows.length) return null;
  const prior = rows
    .filter((r) => r.week < beforeWeek)
    .sort((a, b) => a.week - b.week)
    .slice(-n);
  return prior.length ? aggregateWeeks(prior) : null;
}
