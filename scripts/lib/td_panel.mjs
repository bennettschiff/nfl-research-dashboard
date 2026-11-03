// ── The touchdown backtest panel ─────────────────────────────────────────────
// One builder, shared by backtest_td_props.mjs and fit_td_calibration.mjs, so a
// harness and the fit it validates can never be looking at different rows —
// which is the quiet way a "validated" recalibration turns out to have been
// fitted on a panel the backtest never saw.
//
// SPENDS NOTHING: player_week_stats + player_rzgl_weekly are ETL output, the
// anytime-TD prices are the July archive already paid for, and implied team
// points come from the closing total/spread in the free nflverse schedules cache.
//
// NO LOOKAHEAD: every player aggregate for week W is built from weeks < W only.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { oddsToImplied } from "../../src/lib/models.js";
import { buildNameIndex, resolveName } from "../../src/lib/names.js";

const num = (x) => (x === "" || x == null || x === "NA" ? null : Number(x));

export function buildPanel(ROOT, minWeek = 4, season = 2025) {
  const OUT = join(ROOT, "scripts", "out");
  const rd = (f) => JSON.parse(readFileSync(join(OUT, f), "utf8"));
  const weeks = rd("player_week_stats.json").filter((r) => r.season === season);
  const players = rd("players.json");
  const rzgl = rd("player_rzgl_weekly.json");
  const odds = rd("historical_odds_2025.json");

  // Market implied team points from the closing line.
  const raw = readFileSync(join(ROOT, "scripts", "cache", "schedules__games.csv"), "utf8").trim().split("\n");
  const ix = Object.fromEntries(raw[0].split(",").map((h, i) => [h, i]));
  const implied = new Map();
  for (const l of raw.slice(1)) {
    const c = l.split(",");
    if (c[ix.game_type] !== "REG") continue;
    const tl = num(c[ix.total_line]), sl = num(c[ix.spread_line]);
    if (tl == null || sl == null) continue;
    const hp = (tl + sl) / 2;
    implied.set(`${c[ix.season]}|${c[ix.week]}|${c[ix.home_team]}`, hp);
    implied.set(`${c[ix.season]}|${c[ix.week]}|${c[ix.away_team]}`, tl - hp);
  }

  const byPlayer = new Map();
  for (const r of weeks) {
    if (!byPlayer.has(r.player_id)) byPlayer.set(r.player_id, []);
    byPlayer.get(r.player_id).push(r);
  }
  for (const v of byPlayer.values()) v.sort((a, b) => a.week - b.week);

  const rzglBy = new Map();
  for (const r of rzgl) rzglBy.set(`${r.player_id}|${r.through_week}`, r);

  function priorAgg(pid, week) {
    const gs = (byPlayer.get(pid) || []).filter((g) => g.week < week);
    if (!gs.length) return null;
    const n = gs.length;
    const sum = (f) => gs.reduce((a, g) => a + (f(g) || 0), 0);
    const rz = rzglBy.get(`${pid}|${week - 1}`) || {};
    return {
      games: n,
      position: gs[gs.length - 1].position,
      team_abbr: gs[gs.length - 1].team_abbr,
      carries_pg: sum((g) => g.carries) / n,
      targets_pg: sum((g) => g.targets) / n,
      rush_td_pg: sum((g) => g.rush_tds) / n,
      rec_td_pg: sum((g) => g.rec_tds) / n,
      total_td_pg: (sum((g) => g.rush_tds) + sum((g) => g.rec_tds)) / n,
      pass_att_pg: sum((g) => g.pass_att) / n,
      pass_td_pg: sum((g) => g.pass_tds) / n,
      rz_carries_pg: rz.rz_carries_pg ?? null,
      rz_targets_pg: rz.rz_targets_pg ?? null,
      gl_carries_pg: rz.gl_carries_pg ?? null,
      gl_targets_pg: rz.gl_targets_pg ?? null,
    };
  }

  // ── anytime TD, one row per priced prop that we can grade ──────────────────
  const nameIx = buildNameIndex(players);
  const atdRows = [];
  let unmatched = 0;
  for (const m of odds) {
    if (m.prop_type !== "player_anytime_td" || m.name !== "Yes") continue;
    if (m.week < minWeek) continue;
    const pid = resolveName(nameIx, m.player_name);
    if (!pid) { unmatched++; continue; }
    const agg = priorAgg(pid, m.week);
    if (!agg) continue;
    const played = (byPlayer.get(pid) || []).find((g) => g.week === m.week);
    if (!played) continue;                     // inactive → nothing to grade
    const impliedPts = implied.get(`${season}|${m.week}|${played.team_abbr}`);
    if (impliedPts == null) continue;
    atdRows.push({
      week: m.week, player: m.player_name, agg, impliedPts, odds: m.odds,
      mktP: oddsToImplied(m.odds),
      hit: ((played.rush_tds || 0) + (played.rec_tds || 0)) > 0 ? 1 : 0,
    });
  }

  // ── quarterback starts ────────────────────────────────────────────────────
  const qbRows = [];
  for (const [pid, gs] of byPlayer) {
    for (const g of gs) {
      if (g.week < minWeek || g.position !== "QB" || (g.pass_att || 0) < 10) continue;
      const agg = priorAgg(pid, g.week);
      if (!agg || agg.pass_att_pg < 10) continue;
      const impliedPts = implied.get(`${season}|${g.week}|${g.team_abbr}`);
      if (impliedPts == null) continue;
      qbRows.push({ week: g.week, agg, impliedPts, actual: g.pass_tds || 0 });
    }
  }

  return { atdRows, qbRows, unmatched, priorAgg, implied, byPlayer };
}
