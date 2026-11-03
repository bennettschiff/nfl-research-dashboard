#!/usr/bin/env node
// ── Score the ledger ─────────────────────────────────────────────────────────
// Grades every pick in nfl.nfl_picks whose game has finished, from nflverse's
// published box scores (stats_player_week_<season>.csv — the same release family
// pull_roster.mjs and pull_injuries.mjs read), and attaches the closing number
// from nfl.live_odds' kept 'close' snapshots so every pick carries its CLV.
//
// A CLOSE IS A LATER PRICE. The close rows carry when they were pulled
// (close_at), and a pick whose last close is the same pull it was frozen at gets
// no CLV — see closeIsCapture() in src/lib/pickLedger.js. Until 2026-10-07 every
// pick was in that position, and the Results tab read it as "100% beat close".
//
// Scoring rules live in src/lib/pickLedger.js (gradePick, closeFor). This file
// is only the I/O around them.
//
// RE-GRADES RECENT WEEKS ON PURPOSE. nflverse republishes the file as the league
// issues stat corrections, so every pick from a game in the last --lookback days
// (default 10) is re-scored each run and written back only if something moved.
// A pick stays `pending` until its game is in the file — a late nflverse build
// just means the next run grades it.
//
//   node --env-file=.env.local scripts/grade_picks.mjs            # dry run
//   node --env-file=.env.local scripts/grade_picks.mjs --write
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sbClient, loadCloseIndex, loadSackCloseIndex, loadGameCloseIndex } from "./lib/season.mjs";
import { parseCsv } from "./lib/csv.mjs";
import { gradePick, closeFor, closeSackFor, closeIsCapture } from "../src/lib/pickLedger.js";
import { isGameProp, gradeGamePick, closeGameFor } from "../src/lib/gameMarkets.js";
import { lookupOdds, normName } from "../src/lib/odds.js";
import { GAME_WINDOW_MIN } from "../src/lib/gameStatus.js";

const argv = process.argv.slice(2);
const arg = (k, dflt) => { const i = argv.indexOf(k); return i === -1 ? dflt : argv[i + 1]; };
const WRITE = argv.includes("--write");
const SEASON = Number(arg("--season", 2026));
const LOOKBACK_D = Number(arg("--lookback", 10));
const REL = "https://github.com/nflverse/nflverse-data/releases/download";
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "out");

async function nflverseCsv(file) {
  const url = `${REL}/${file}`;
  const res = await fetch(url, { headers: { "User-Agent": "nfl-research-dashboard" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`nflverse returned ${res.status} for ${url}`);
  return parseCsv(await res.text());
}

/**
 * Who took a snap, per game — offense, DEFENSE or special teams.
 *
 * Snap counts come from PFR and carry pfr_player_id, not our gsis id. Both roster
 * overlays are read for the mapping (the skill one and the defensive one, which
 * exists because the sack market is now a graded pick); for a player neither can
 * map (no pfr_id on file) the fallback is name + team inside the game, which is
 * unambiguous in practice because the key includes the game.
 *
 * THE DEFENSIVE SNAP IS LOAD-BEARING. This function decides whether an absence
 * from the box score is a zero or a VOID, and it used to count only offensive
 * and special-teams snaps. A pass rusher who played 40 defensive snaps and
 * recorded nothing is missing from nflverse's weekly stats — it lists only
 * players who recorded a stat — so his sack over would have been voided instead
 * of graded as the loss it is.
 */
function participation(snapRows, season) {
  const pfrToGsis = {};
  for (const file of [`roster_status_${season}.json`, `roster_defense_${season}.json`]) {
    const p = path.join(OUT, file);
    if (!fs.existsSync(p)) continue;
    for (const r of JSON.parse(fs.readFileSync(p, "utf8")).players || []) {
      if (r.pfr_id) pfrToGsis[r.pfr_id] = r.player_id;
    }
  }
  const byId = new Set(), byName = new Set(), games = new Set();
  for (const r of snapRows || []) {
    games.add(r.game_id);
    if (!(Number(r.offense_snaps) > 0 || Number(r.defense_snaps) > 0 || Number(r.st_snaps) > 0)) continue;
    const gsis = pfrToGsis[r.pfr_player_id];
    if (gsis) byId.add(`${r.game_id}|${gsis}`);
    byName.add(`${r.game_id}|${r.team}|${normName(r.player)}`);
  }
  return (p) => {
    if (!games.has(p.game_id)) return null;
    return byId.has(`${p.game_id}|${p.player_id}`) || byName.has(`${p.game_id}|${p.team}|${normName(p.player_name)}`);
  };
}

const GRADE_COLS = ["outcome", "actual", "profit", "close_line", "close_odds", "close_prob", "close_at", "clv_prob", "clv_line"];
const same = (a, b) => (a == null && b == null) || (a != null && b != null && Number(a) === Number(b)) || a === b;

async function main() {
  const now = new Date();
  const db = sbClient();

  // Finished games only: kickoff plus the board's own final-game window.
  const doneBefore = new Date(now.getTime() - GAME_WINDOW_MIN * 60000).toISOString();
  const since = new Date(now.getTime() - LOOKBACK_D * 86400e3).toISOString();
  const picks = await db.selectAll("nfl_picks",
    `select=*&season=eq.${SEASON}&kickoff_at=lt.${doneBefore}` +
    `&or=(outcome.eq.pending,kickoff_at.gte.${since})`, "id", { keyset: true });
  console.log(`[grade] ${picks.length} picks from finished games (pending, or inside ${LOOKBACK_D}d)`);
  if (!picks.length) return;

  const stats = ((await nflverseCsv(`stats_player/stats_player_week_${SEASON}.csv`)) || [])
    .filter((r) => r.season_type === "REG" || r.season_type === "POST");
  const snaps = await nflverseCsv(`snap_counts/snap_counts_${SEASON}.csv`);
  const playedIn = participation(snaps, SEASON);
  const statByKey = new Map(stats.map((r) => [`${r.game_id}|${r.player_id}`, r]));
  const gamesInStats = new Set(stats.map((r) => r.game_id));
  console.log(`[grade] nflverse: ${stats.length} player-games across ${gamesInStats.size} games · ` +
    `snap counts for ${new Set((snaps || []).map((r) => r.game_id)).size} games`);

  const gameIds = [...new Set(picks.map((p) => p.game_id))];
  const kickoffs = Object.fromEntries(picks.map((p) => [p.game_id, new Date(p.kickoff_at)]));
  const close = await loadCloseIndex(SEASON, gameIds, kickoffs, db);
  // A ladder market cannot use the one-line-per-book close index — see
  // closeSackFor(). Only fetched when the ledger actually holds a sack pick.
  const anySack = picks.some((p) => p.prop_type === "def_sacks");
  const sackClose = anySack ? await loadSackCloseIndex(SEASON, gameIds, kickoffs, db) : new Map();

  // GAME picks settle from the final score, not a box score, and close against
  // the game lines. nflverse's schedule carries the score within hours of the
  // final whistle — the same release family, one small file.
  const gamePicks = picks.filter((p) => isGameProp(p.prop_type));
  const scoreOf = new Map();
  let gameClose = new Map();
  if (gamePicks.length) {
    const sched = (await nflverseCsv("schedules/games.csv")) || [];
    for (const g of sched) if (Number(g.season) === SEASON) scoreOf.set(g.game_id, g);
    const ids = [...new Set(gamePicks.map((p) => p.game_id))];
    const byId = Object.fromEntries(ids.filter((id) => scoreOf.has(id)).map((id) => [id, scoreOf.get(id)]));
    gameClose = await loadGameCloseIndex(SEASON, ids, kickoffs, byId, db);
    console.log(`[grade] game picks: ${gamePicks.length} across ${ids.length} games · ` +
      `${ids.filter((id) => scoreOf.get(id)?.home_score).length} with a final score`);
  }

  const updates = [];
  const tally = {};
  for (const p of picks) {
    if (isGameProp(p.prop_type)) {
      const sc = scoreOf.get(p.game_id);
      const g = gradeGamePick(p, sc);
      const c = closeGameFor(p, gameClose.get(p.game_id), sc?.home_team, closeIsCapture) || {};
      const next = { ...(g || {}), ...c };
      const changed = GRADE_COLS.some((k) => k in next && !same(next[k], p[k]));
      const outcome = next.outcome ?? p.outcome;
      tally[outcome] = (tally[outcome] || 0) + 1;
      if (changed) updates.push({ p, next: { ...next, ...(g ? { graded_at: now.toISOString() } : {}) } });
      continue;
    }
    const g = gradePick(p, statByKey.get(`${p.game_id}|${p.player_id}`),
      { gameInStats: gamesInStats.has(p.game_id), played: playedIn(p) });
    const c = (p.prop_type === "def_sacks"
      ? closeSackFor(p, sackClose.get(`${p.game_id}|${normName(p.player_name)}`))
      : closeFor(p, lookupOdds(close, p.game_id, p.player_name, p.prop_type))) || {};
    const next = { ...(g || {}), ...c };
    const changed = GRADE_COLS.some((k) => k in next && !same(next[k], p[k]));
    const outcome = next.outcome ?? p.outcome;
    tally[outcome] = (tally[outcome] || 0) + 1;
    if (!changed) continue;
    updates.push({ p, next: { ...next, ...(g ? { graded_at: now.toISOString() } : {}) } });
  }
  const moved = {};
  for (const { p, next } of updates) for (const k of GRADE_COLS) if (k in next && !same(next[k], p[k])) moved[k] = (moved[k] || 0) + 1;
  console.log(`[grade] outcomes ${JSON.stringify(tally)} · ${updates.length} rows to write · changed ${JSON.stringify(moved)}`);
  for (const { p, next } of updates.slice(0, 6)) {
    console.log(`  ${p.player_name} ${p.prop_type} ${p.direction} ${p.line} → ${next.outcome ?? p.outcome}` +
      ` (${next.actual ?? p.actual})  close ${next.close_line ?? "—"} ${next.close_odds ?? ""}`);
  }
  if (!WRITE) { console.log("[grade] dry run — pass --write to record"); return; }

  // Auto picks upsert in bulk on pick_key — one request per 500 instead of one
  // PATCH per pick. PostgREST needs identical keys on every object in a batch,
  // so each row carries every grade column, current value where unchanged.
  const keyed = updates.filter((u) => u.p.pick_key);
  const rows = keyed.map(({ p, next }) => ({
    pick_key: p.pick_key, prop_type: p.prop_type, direction: p.direction,
    ...Object.fromEntries(GRADE_COLS.map((k) => [k, k in next ? next[k] : p[k]])),
    graded_at: next.graded_at ?? p.graded_at,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    await db.sb("nfl_picks?on_conflict=pick_key", {
      method: "POST", body: rows.slice(i, i + 500), prefer: "resolution=merge-duplicates,return=minimal",
    });
  }
  // Hand-tracked picks predate pick_key and are addressed by id.
  for (const { p, next } of updates.filter((u) => !u.p.pick_key)) {
    await db.sb(`nfl_picks?id=eq.${p.id}`, { method: "PATCH", body: next, prefer: "return=minimal" });
  }
  console.log(`[grade] wrote ${updates.length}`);
}

main().catch((e) => { console.error(`[grade] FAILED: ${e.stack || e}`); process.exit(1); });
