// ── Picks persistence ────────────────────────────────────────────────────────
// The automatic ledger is WRITTEN by scheduled scripts (scripts/snapshot_picks.mjs,
// scripts/grade_picks.mjs). The one write from the browser is a hand-tracked
// pick off a player panel's "＋ track", which goes through /api/picks so the
// service-role key stays server-side, and is labelled source='manual'.
//
// Read through /api/picks first: one CDN-cached request however many pages the
// season's ledger spans, which is the request-count discipline api/season.js
// exists for. The anon client is the fallback, so a cold or missing function
// degrades to direct reads instead of an empty Results tab.
import { supabase } from "./supabase.js";
import { tagPick } from "../modelVersions.js";
import { sideOf } from "./confidence.js";
import { isOneSided } from "./props.js";
import { kickoffAt } from "./gameStatus.js";
import { isBet } from "./pickLedger.js";
import { PICK_LIST_COLS, PICK_PAGE } from "./pickColumns.js";
import { GAME_PROPS } from "./gameMarkets.js";

// A one-sided NO is on the ledger as a pass and is not a pick (pickLedger.js,
// ONE-SIDED CALLS), so the Results tab never sees it.
export async function loadPicks(opts = {}) {
  return (await loadAllPicks(opts)).filter(isBet);
}

/**
 * The Official Plays tab's slice of the ledger: every official pick of the
 * season and every game-line pick (on probation, so the tab can show the
 * engine's in-band game plays as tracked). One CDN-cached request.
 */
export async function loadPlays({ season }) {
  try {
    const res = await fetch(`/api/picks?season=${season}&plays=1`, { headers: { Accept: "application/json" } });
    if (res.ok) {
      const body = await res.json();
      if (Array.isArray(body?.picks)) return body.picks.filter(isBet);
    }
  } catch { /* fall through to the direct read */ }
  const all = [];
  for (let after = null; ;) {
    let q = supabase.from("nfl_picks").select(PICK_LIST_COLS).eq("season", season)
      .or(`official.is.true,prop_type.in.(${GAME_PROPS.join(",")})`);
    if (after != null) q = q.gt("id", after);
    const { data, error } = await q.order("id", { ascending: true }).limit(PICK_PAGE);
    if (error) throw error;
    all.push(...data);
    if (data.length < PICK_PAGE) break;
    after = data[data.length - 1].id;
  }
  return all.filter(isBet);
}

async function loadAllPicks({ season } = {}) {
  try {
    const res = await fetch(`/api/picks${season ? `?season=${season}` : ""}`, { headers: { Accept: "application/json" } });
    if (res.ok) {
      const body = await res.json();
      if (Array.isArray(body?.picks)) return body.picks;
    }
  } catch { /* fall through to the direct read */ }

  return walkPicks(season);
}

/**
 * The direct anon read: the same columns /api/picks serves, KEYSET-paged on id.
 *
 * WHY NOT OFFSET. Measured 2026-10-12 on 4,232 rows: the snapshot's upserts
 * rewrite every row each run, which scatters the table (id's physical
 * correlation −0.07), so for `season = $1 order by id offset N` the planner
 * picks a seq scan and SORTS the season to throw N rows away. With OFFSET that
 * sort must hold N+1000 rows; at ~1.2 KB a row (signals included) it outgrows
 * work_mem from the third page on and spills ~5 MB to temp on every request,
 * which on the shared instance's I/O budget was 1.4 s a page and the anon role's
 * 3 s statement timeout. `id > last` bounds every sort to 1000 rows whatever
 * plan wins, and with nfl_picks_season_id_idx it is an index range scan. A
 * cursor is also immune to the snapshot inserting rows mid-walk.
 */
export async function walkPicks(season) {
  const all = [];
  for (let after = null; ;) {
    let q = supabase.from("nfl_picks").select(PICK_LIST_COLS);
    if (season) q = q.eq("season", season);
    if (after != null) q = q.gt("id", after);
    const { data, error } = await q.order("id", { ascending: true }).limit(PICK_PAGE);
    if (error) throw error;
    all.push(...data);
    if (data.length < PICK_PAGE) break;
    after = data[data.length - 1].id;
  }
  return all;
}

/**
 * The official card for one week: pick_key → { direction, line, note }.
 *
 * The board reads the verdict the ledger STAMPED rather than recomputing it, so
 * the badge on a row is exactly what the official record will grade. It moves
 * when the snapshot does — after every odds pull and the injury pass.
 */
export async function loadOfficialCard({ season, week }) {
  const rows = await (async () => {
    try {
      const res = await fetch(`/api/picks?season=${season}&week=${week}&official=1`, { headers: { Accept: "application/json" } });
      if (res.ok) {
        const body = await res.json();
        if (Array.isArray(body?.picks)) return body.picks;
      }
    } catch { /* fall through to the direct read */ }
    const { data, error } = await supabase.from("nfl_picks")
      .select("pick_key,direction,line,official_basis").eq("season", season).eq("week", week).eq("official", true);
    if (error) throw error;
    return data;
  })();
  return new Map(rows.filter((p) => p.pick_key).map((p) => [p.pick_key, p]));
}

export async function savePick(pick) {
  const res = await fetch("/api/picks", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pick),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || res.statusText);
  return j.picks?.[0];
}

/**
 * A hand-tracked nfl_picks row from a projection card.
 *
 * It carries kickoff_at because the grader selects on it — a manual pick without
 * one is never graded — and the model's SIDE, because a card showing a 38% over
 * is a call on the under. The line is the model's own (a card has no market), so
 * it has no price and no units; it still grades W/L.
 */
export function buildPick({ season, week, game, player, position, team, opp, prop }) {
  const tilt = prop.factors?.coverageMult ?? prop.factors?.boxMult ?? prop.factors?.pressureMult ?? null;
  const side = isOneSided(prop.prop_type) ? "over" : sideOf(prop.prob_over);
  const k = game?.gameday ? kickoffAt(game) : null;
  return {
    source: "manual",
    pick_date: new Date().toISOString().slice(0, 10),
    season: season ?? null, week: week ?? null, game_id: game?.game_id ?? null,
    kickoff_at: k ? k.toISOString() : null,
    player_id: player?.player_id ?? null, player_name: player?.full_name ?? null,
    team: team ?? null, opp: opp ?? null, position: position ?? null,
    prop_type: prop.prop_type, line: prop.line, direction: side,
    proj_mean: prop.proj_mean, prob_over: prop.prob_over, sigma: prop.sigma ?? null,
    side_prob: prop.prob_over == null ? null : side === "under" ? 1 - prop.prob_over : prop.prob_over,
    fair_line: prop.fair_line,
    matchup_tilt: tilt, model_version: tagPick(prop.prop_type),
    outcome: "pending", signals: prop.factors ?? null,
    captured_at: new Date().toISOString(),
  };
}
