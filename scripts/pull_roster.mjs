#!/usr/bin/env node
/**
 * pull_roster.mjs — who is on which team, where he sits on the depth chart, and
 * how many snaps he actually played. The three facts the board was guessing at.
 *
 * ── THE BUG THIS EXISTS TO KILL ──────────────────────────────────────────────
 * A player's TEAM reached the board from scripts/out/player_priors_2026.json,
 * an artifact built once by build_player_priors_2026.py. It was built on
 * 2026-08-09 and nothing refreshed it, so the board spent the whole of week 1
 * showing Kayshon Boutte as a Patriot — he was traded to Houston in August —
 * and projecting him into New England's target pool, where he displaced targets
 * from receivers who are actually on the team.
 *
 * That is not a Boutte bug, it is a MISSING CLOCK. The priors artifact mixes two
 * kinds of fact with completely different half-lives:
 *
 *   SLOW  last season's per-game rates (targets_pg, ypc, adot...). These are
 *         measured over a finished season and never change again. A frozen
 *         artifact is exactly right for them.
 *   FAST  team, roster status, depth-chart rank. These change on waiver
 *         Wednesday, at the trade deadline, and every time a club refiles its
 *         chart. A frozen artifact is exactly WRONG for them.
 *
 * So this script owns the fast half, on its own cadence — the same split
 * pull_injuries.mjs already made for the injury report, and for the same reason.
 * src/lib/rosterStatus.js overlays what this writes on top of the frozen priors.
 *
 * ── WHY AN ARTIFACT AND NOT A SUPABASE TABLE ─────────────────────────────────
 * On 2026-09-08 the shared Supabase instance spent six hours I/O-throttled and
 * the fix (api/season.js) was to collapse the board's fourteen browser reads
 * into one CDN-cached request. Adding a table here would have walked part of
 * that back. The overlay is ~85 KB raw / ~15 KB gzipped for 921 skill players,
 * and the repo already ships player_priors_2026.json (729 KB) the same way — as
 * a bundled import served off the CDN with the rest of the build. So it costs
 * Supabase nothing at all: no rows, no requests, no egress. Google Drive was
 * considered and rejected for the same data: the Drive path in this repo is
 * rclone-in-CI against a personal account (scope=drive.file), which is a backup
 * sink, not something a Vercel function can read at request time without new
 * service-account credentials — and it would not be CDN-cached if it could.
 *
 * `--live` additionally upserts nfl.players so the database copy does not drift
 * from the artifact. That is a weekly ~3k-row WRITE, not egress, and it is opt-in.
 *
 * ── IT CARRIES THE DEFENCE TOO (2026-09-18) ──────────────────────────────────
 * The sack market is the one defensive market the model prices, and its priors
 * artifact (scripts/out/sack_priors_<season>.json) was carrying each defender's
 * roster status frozen at the moment the Python builder last ran — the exact
 * mistake this script exists to undo. It showed: Myles Garrett topped the week-2
 * sack board while the club had him on RESERVE, because the builder's "is he
 * rostered" allowlist counted RES as rostered and nothing refreshed it after.
 *
 * So the defensive groups (DL / LB / DB) get their own overlay, written beside
 * the skill one and kept deliberately lean — no headshot, no jersey, no depth
 * rank (nflverse charts only the offensive personnel groups). 1,426 defenders at
 * ~110 bytes each is ~160 KB raw, which belongs in the bundle by the same rule
 * the skill overlay does.
 *
 * ── SOURCES ──────────────────────────────────────────────────────────────────
 *   rosters/roster_{season}.csv        team, position, status, jersey, pfr_id
 *   depth_charts/depth_charts_{s}.csv  pos_rank within the offensive personnel
 *                                      group, from the NEWEST dated snapshot
 *   snap_counts/snap_counts_{s}.csv    offense_pct per played week (optional —
 *                                      it does not exist until week 1 is done)
 *
 * Snap counts key on `pfr_player_id`, not gsis_id, so they are joined through
 * the roster's own pfr_id column. A player the roster does not carry is dropped
 * rather than guessed at.
 *
 * USAGE
 *   node scripts/pull_roster.mjs                       # write artifacts
 *   node scripts/pull_roster.mjs --season 2026
 *   node --env-file=.env.local scripts/pull_roster.mjs --live   # + upsert nfl.players
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv, streamCsv } from "./lib/csv.mjs";
import { sbRequest } from "./lib/sb.mjs";
import { normTeam } from "./lib/teams.mjs";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "out");
const REL = "https://github.com/nflverse/nflverse-data/releases/download";
const UA = { "User-Agent": "nfl-research-dashboard" };

const SEASON = Number(argOf("--season") || 2026);
const LIVE = process.argv.includes("--live");

function argOf(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}
function die(msg) { console.error("ERROR: " + msg); process.exit(1); }

/** The positions the props model prices. Everyone else is noise in this artifact. */
export const SKILL = new Set(["QB", "RB", "FB", "WR", "TE"]);

const blank = (v) => (v == null || v === "" || v === "NA" ? null : v);
const num = (v) => { const n = Number(blank(v)); return Number.isFinite(n) ? n : null; };

// ── roster ───────────────────────────────────────────────────────────────────
/** Roster CSV rows → { player_id: {team, position, status, ...} } for skill players. */
export function toRosterRows(csvRows) {
  const out = {};
  for (const r of csvRows) {
    const pid = blank(r.gsis_id);
    const pos = blank(r.position);
    if (!pid || !SKILL.has(pos)) continue;
    // A club can carry the same gsis_id twice across a season file (practice
    // squad elevation, then the active roster). Last row wins, which is the
    // most recent state.
    out[pid] = {
      player_id: pid,
      full_name: blank(r.full_name),
      position: pos,
      team_abbr: normTeam(r.team),
      // ACT / RES (IR) / CUT / RET / INA / DEV (practice squad). src/lib/injuries.js
      // already knows how to read these; it just never had a fresh one.
      status: blank(r.status),
      status_abbr: blank(r.status_description_abbr),
      jersey: num(r.jersey_number),
      headshot_url: blank(r.headshot_url),
      years_exp: num(r.years_exp),
      // The join key for snap counts, which do not carry gsis_id.
      pfr_id: blank(r.pfr_id),
    };
  }
  return out;
}

/**
 * The defensive position GROUPS, exactly as the roster file writes them.
 *
 * nflverse's roster `position` column is already a group — DL, LB, DB, OL — not
 * DE / OLB / CB. That is the same unit src/lib/sacks.js keeps its rates on, so
 * no mapping is needed and none is invented.
 */
export const DEFENSE = new Set(["DL", "LB", "DB"]);

/**
 * Roster CSV rows → the lean defensive overlay.
 *
 * Only what the sack board actually needs: which club he is on, whether he can
 * play for it, the pfr id the snap counts join on, and his headshot — every
 * board row carries a photo now (src/lib/headshots.js), and a sack row with a
 * logo where every receiver has a face reads as a missing player. Jersey and
 * years stay out: this file is bundled.
 */
export function toDefenseRows(csvRows) {
  const out = {};
  for (const r of csvRows) {
    const pid = blank(r.gsis_id);
    const pos = blank(r.position);
    if (!pid || !DEFENSE.has(pos)) continue;
    // Last row wins, which is the most recent week the season file carries.
    out[pid] = {
      player_id: pid,
      full_name: blank(r.full_name),
      position: pos,
      team_abbr: normTeam(r.team),
      // ACT / RES (IR) / DEV (practice squad) / CUT / RET / INA / EXE.
      // src/lib/injuries.js owns which of those can take a snap.
      status: blank(r.status),
      pfr_id: blank(r.pfr_id),
    };
  }
  return out;
}

// ── depth chart ──────────────────────────────────────────────────────────────
// nflverse keeps every dated snapshot of the season in one 48 MB file. We want
// the newest, and only the OFFENSIVE personnel group.
//
// The group filter is load-bearing. Players appear on several charts at once:
// DeMario Douglas is New England's WR3 and also its punt returner, and the
// special-teams chart ranks him 2. build_depth_weekly.py takes the minimum rank
// across every row for a player, so it reads Douglas as a rank-2 PR — a return
// role scored as a receiving role. Only "3WR 1TE" describes who runs routes and
// carries the ball.
const OFF_GROUP = "3WR 1TE";

/** Rows of the newest snapshot → { player_id: {depth_rank, depth_pos, depth_team} }. */
export function toDepthRows(snapshotRows) {
  const out = {};
  for (const r of snapshotRows) {
    const pid = blank(r.gsis_id);
    const pos = (blank(r.pos_abb) || "").toUpperCase();
    if (!pid || !SKILL.has(pos)) continue;
    const rank = num(r.pos_rank);
    const prev = out[pid];
    // Within the offensive group a player can still hold two spots (a WR listed
    // at both X and slot). The better rank is the one that describes his role.
    if (prev && prev.depth_rank != null && (rank == null || rank >= prev.depth_rank)) continue;
    out[pid] = { depth_rank: rank, depth_pos: pos, depth_team: normTeam(r.team) };
  }
  return out;
}

/** Stream the depth-chart file, keeping only rows from the newest `dt`. */
async function latestDepthSnapshot(season) {
  const url = `${REL}/depth_charts/depth_charts_${season}.csv`;
  console.log(`↓ ${url}`);
  const res = await fetch(url, { headers: UA });
  if (!res.ok) { console.warn(`  ! ${res.status} — no depth chart for ${season}, skipping`); return { dt: null, rows: [] }; }

  let maxDt = "";
  let rows = [];
  let total = 0;
  for await (const r of streamCsv(res)) {
    total++;
    if (r.pos_grp !== OFF_GROUP) continue;
    const dt = r.dt || "";
    if (dt < maxDt) continue;
    // A newer snapshot supersedes everything held so far. Bounded memory: we
    // only ever hold one snapshot's worth of offensive rows (~950).
    if (dt > maxDt) { maxDt = dt; rows = []; }
    rows.push(r);
  }
  console.log(`  ${total.toLocaleString()} rows scanned · newest snapshot ${maxDt} (${rows.length} offensive rows)`);
  return { dt: maxDt || null, rows };
}

// ── snap counts ──────────────────────────────────────────────────────────────
/**
 * Snap CSV rows → weekly offensive snap share, joined to gsis_id via pfr_id.
 *
 * This is the "is he actually playing" signal the depth chart only gestures at.
 * A chart is a club's stated intention filed days early; a snap share is what
 * happened. When a starter goes down, the snap share of whoever replaced him is
 * the first hard evidence of the new role, and it lands the morning after.
 */
export function toSnapRows(csvRows, season, pfrToGsis) {
  const out = [];
  for (const r of csvRows) {
    if (blank(r.game_type) !== "REG") continue;
    const pid = pfrToGsis[blank(r.pfr_player_id)];
    const week = num(r.week);
    if (!pid || week == null) continue;
    const pct = num(r.offense_pct);
    if (pct == null) continue;
    out.push({
      player_id: pid, season, week,
      team_abbr: normTeam(r.team),
      // nflverse writes offense_pct as a 0-1 fraction.
      off_snaps: num(r.offense_snaps),
      off_pct: +pct.toFixed(4),
    });
  }
  // One row per player-week; a player traded mid-week cannot appear twice, but
  // a corrected file can.
  const byKey = new Map();
  for (const row of out) byKey.set(`${row.player_id}|${row.week}`, row);
  return [...byKey.values()];
}

// ── merge ────────────────────────────────────────────────────────────────────
/**
 * Roster + depth into one overlay row per player.
 *
 * `depth_rank: null` is MEANINGFUL and is written rather than dropped:
 * isProjectable() reads it as "not on the current chart, do not project him",
 * which is the whole point of having a fresh chart. Writing the field only when
 * we have a rank would leave the stale August rank in place underneath.
 */
export function mergeOverlay(roster, depth, season, meta) {
  const rows = [];
  for (const pid of Object.keys(roster)) {
    const r = roster[pid];
    const d = depth[pid] || null;
    rows.push({
      ...r,
      season,
      depth_rank: d?.depth_rank ?? null,
      depth_pos: d?.depth_pos ?? null,
      // A chart that disagrees with the roster about the club is a signal the
      // roster file is the fresher of the two (or that the chart is stale).
      // Kept so the mismatch is visible rather than silently resolved.
      depth_team: d?.depth_team ?? null,
    });
  }
  rows.sort((a, b) => a.player_id.localeCompare(b.player_id));
  return { meta: { season, ...meta, players: rows.length }, players: rows };
}

/**
 * Write an artifact, but ONLY if its payload actually changed.
 *
 * The scheduled job commits whatever this writes, and `meta.fetched_at` moves on
 * every single run — so writing unconditionally makes every run a one-line
 * timestamp commit and the workflow's "no roster movement" guard can never fire.
 * The first scheduled run proved it: a commit of +1/−1 for a roster that had not
 * moved at all.
 *
 * Comparing the PAYLOAD and leaving the file alone when it matches also gives
 * `fetched_at` an honest meaning — when this data last CHANGED, rather than when
 * a cron last ran — which is the more useful of the two anyway, and is the one
 * the git history would otherwise be lying about.
 */
function writeJson(name, data, payloadKey) {
  const dest = path.join(OUT, name);
  const rel = path.relative(process.cwd(), dest);
  const next = JSON.stringify(data);

  if (payloadKey && fs.existsSync(dest)) {
    try {
      const prev = JSON.parse(fs.readFileSync(dest, "utf8"));
      if (JSON.stringify(prev[payloadKey]) === JSON.stringify(data[payloadKey])
          && prev.meta?.depth_snapshot === data.meta?.depth_snapshot) {
        console.log(`  = ${rel} unchanged — not rewritten`);
        return false;
      }
    } catch { /* unreadable or malformed — fall through and rewrite it */ }
  }

  fs.writeFileSync(dest, next);
  console.log(`  → ${rel} (${(fs.statSync(dest).size / 1024).toFixed(0)} KB)`);
  return true;
}

async function upsertPlayers(rows) {
  const SUPA = process.env.SUPABASE_URL, SKEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPA || !SKEY) die("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — run with --env-file=.env.local");
  // Only the columns nfl.players actually has. The overlay's extra fields
  // (depth_rank, pfr_id, jersey) live in the artifact, not the table.
  const body = rows.map((r) => ({
    player_id: r.player_id, full_name: r.full_name, position: r.position,
    team_abbr: r.team_abbr, headshot_url: r.headshot_url, status: r.status,
  }));
  for (let i = 0; i < body.length; i += 500) {
    const chunk = body.slice(i, i + 500);
    await sbRequest(`${SUPA}/rest/v1/players?on_conflict=player_id`, {
      method: "POST",
      headers: { apikey: SKEY, Authorization: `Bearer ${SKEY}`, "Content-Type": "application/json",
        "Content-Profile": "nfl", Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(chunk),
    }, { idempotent: true, label: "POST nfl.players" });
    console.log(`  ↑ ${Math.min(i + 500, body.length)}/${body.length}`);
  }
}

async function main() {
  const fetchedAt = new Date().toISOString();

  // ---- roster ----
  const rosterUrl = `${REL}/rosters/roster_${SEASON}.csv`;
  console.log(`↓ ${rosterUrl}`);
  const rres = await fetch(rosterUrl, { headers: UA });
  if (!rres.ok) die(`nflverse returned ${rres.status} for roster_${SEASON}.csv`);
  const rosterCsv = parseCsv(await rres.text());
  const roster = toRosterRows(rosterCsv);
  const nTeams = new Set(Object.values(roster).map((r) => r.team_abbr)).size;
  console.log(`  ${Object.keys(roster).length} skill players across ${nTeams} teams`);

  // ---- depth chart ----
  const { dt, rows: snapRows } = await latestDepthSnapshot(SEASON);
  const depth = toDepthRows(snapRows);
  const charted = Object.keys(depth).length;
  const starters = Object.values(depth).filter((d) => d.depth_rank === 1).length;
  console.log(`  ${charted} skill players on the chart (${starters} rank-1)`);

  const overlay = mergeOverlay(roster, depth, SEASON, { fetched_at: fetchedAt, depth_snapshot: dt });
  writeJson(`roster_status_${SEASON}.json`, overlay, "players");

  // ---- the defence, for the sack board ----
  const defense = toDefenseRows(rosterCsv);
  const defRows = Object.values(defense).sort((a, b) => a.player_id.localeCompare(b.player_id));
  const byStatus = {};
  for (const r of defRows) byStatus[r.status || "?"] = (byStatus[r.status || "?"] || 0) + 1;
  console.log(`  ${defRows.length} defenders (${Object.entries(byStatus)
    .sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ")})`);
  writeJson(`roster_defense_${SEASON}.json`,
    { meta: { season: SEASON, fetched_at: fetchedAt, players: defRows.length }, players: defRows }, "players");

  // ---- snap counts (optional: no file until week 1 has been played) ----
  const pfrToGsis = {};
  for (const r of Object.values(roster)) if (r.pfr_id) pfrToGsis[r.pfr_id] = r.player_id;
  const snapUrl = `${REL}/snap_counts/snap_counts_${SEASON}.csv`;
  console.log(`↓ ${snapUrl}`);
  const sres = await fetch(snapUrl, { headers: UA });
  if (!sres.ok) {
    console.log(`  ${sres.status} — no snap counts for ${SEASON} yet (expected before week 1 is played)`);
  } else {
    const snaps = toSnapRows(parseCsv(await sres.text()), SEASON, pfrToGsis);
    const weeks = [...new Set(snaps.map((s) => s.week))].sort((a, b) => a - b);
    console.log(`  ${snaps.length} player-weeks · weeks ${weeks.join(",") || "—"}`);
    writeJson(`player_snaps_weekly_${SEASON}.json`, { meta: { season: SEASON, fetched_at: fetchedAt, weeks }, snaps }, "snaps");
  }

  // ---- movement report: the whole reason this runs ----
  // Diffed against the frozen priors so a run's log SAYS which players moved,
  // rather than leaving you to notice a wrong team on the board.
  try {
    const priors = JSON.parse(fs.readFileSync(path.join(OUT, `player_priors_${SEASON}.json`), "utf8"));
    const moved = [];
    for (const p of priors) {
      const r = roster[p.player_id];
      if (r && r.team_abbr && p.team_abbr && r.team_abbr !== p.team_abbr) {
        moved.push(`${p.player_name} (${p.position}) ${p.team_abbr} → ${r.team_abbr}`);
      }
    }
    const gone = priors.filter((p) => !roster[p.player_id] && (p.targets_pg > 2 || p.carries_pg > 4));
    console.log(`\n${moved.length} player(s) on a different team than the frozen priors say:`);
    for (const m of moved.slice(0, 40)) console.log(`  · ${m}`);
    if (moved.length > 40) console.log(`  … and ${moved.length - 40} more`);
    if (gone.length) {
      console.log(`\n${gone.length} rostered-role player(s) no longer on any roster (cut / retired / unsigned):`);
      for (const p of gone.slice(0, 20)) console.log(`  · ${p.player_name} (${p.position}, was ${p.team_abbr})`);
    }
  } catch { /* no priors artifact — nothing to diff against */ }

  if (LIVE) {
    console.log("\nUpserting nfl.players …");
    await upsertPlayers(Object.values(roster));
    console.log("Done.");
  } else {
    console.log("\nArtifacts written. Pass --live to also upsert nfl.players.");
  }
}

// Importable for the test without running the pull.
if (process.argv[1] && process.argv[1].endsWith("pull_roster.mjs")) {
  main().catch((e) => die(e.stack || e.message || String(e)));
}
