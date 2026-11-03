#!/usr/bin/env node
/**
 * pull_injuries.mjs — the weekly injury report, into nfl.player_injuries.
 *
 * WHY THIS IS A SEPARATE SCRIPT FROM etl.py
 *
 * The ETL is a heavy, mostly-idempotent rebuild: it downloads seasons of
 * play-by-play, recomputes every scheme profile, and is run when the underlying
 * season data moves. The injury report moves on a completely different clock —
 * Wednesday's first practice, Thursday, Friday's designation, and the 90-minute
 * inactives — and each of those changes who is on the board TODAY. Coupling a
 * 90-second-to-refresh fact to a multi-minute rebuild means it is refreshed at
 * the rebuild's cadence, which is to say rarely. This runs in a few seconds and
 * can sit on the same cron as pull_live_odds.mjs.
 *
 * ── WHY nflverse AND NOT ROTOWIRE ────────────────────────────────────────────
 * The MLB lab scrapes Rotowire because baseball's thing-we-need — today's
 * confirmed starting pitcher and batting order — is not published as data
 * anywhere official until first pitch, so the lineup card has to be read off a
 * page. Football's equivalent IS published as data: the NFL requires every club
 * to file a participation report Wed/Thu/Fri and a game-status designation, and
 * nflverse mirrors all of it as a season CSV within minutes. Scraping a page for
 * something that exists as a maintained dataset buys a fragile DOM dependency
 * and nothing else.
 *
 * What nflverse does NOT carry is the 90-minute inactives list and breaking
 * beat-reporter news, so `report_status` is the club's last FILED designation,
 * not a game-time verdict. The board says so rather than implying otherwise:
 * a Questionable is shown as Questionable, and confidence is capped for it (see
 * src/lib/confidence.js).
 *
 * ── WHAT IT WRITES ───────────────────────────────────────────────────────────
 * One row per (player, season, week) with the club's designation, the practice
 * participation behind it, and the body part. `report_status` is blank for most
 * rows — a player can appear on the report as a limited practice participant and
 * still carry no game-status designation, which means he is expected to play.
 * That blank is meaningful and is stored as null rather than dropped.
 *
 * USAGE
 *   node --env-file=.env.local scripts/pull_injuries.mjs            # dry run
 *   node --env-file=.env.local scripts/pull_injuries.mjs --live
 *   node --env-file=.env.local scripts/pull_injuries.mjs --season 2026 --live
 */
import { sbRequest } from "./lib/sb.mjs";
import { parseCsv } from "./lib/csv.mjs";
import { normTeam } from "./lib/teams.mjs";

const SEASON = Number(argOf("--season") || 2026);
const LIVE = process.argv.includes("--live");
const REL = "https://github.com/nflverse/nflverse-data/releases/download";

const SUPA = process.env.SUPABASE_URL;
const SKEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function argOf(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}
function die(msg) { console.error("ERROR: " + msg); process.exit(1); }

// The CSV parser moved to scripts/lib/csv.mjs when pull_roster.mjs needed the
// same RFC-4180 handling (and a streaming variant for the 48 MB depth-chart
// file). Re-exported here so this module's public surface — and its test — is
// unchanged.
export { parseCsv };

const blank = (v) => (v == null || v === "" || v === "NA" ? null : v);

/** CSV rows → nfl.player_injuries rows. Exported for the unit test. */
export function toRows(csvRows, season) {
  const out = [];
  for (const r of csvRows) {
    const pid = blank(r.gsis_id);
    // blank() first: Number("") is 0, not NaN, so a missing week would sail
    // through Number.isFinite and land every such row under week 0.
    const wk = blank(r.week);
    const week = wk == null ? NaN : Number(wk);
    if (!pid || !Number.isFinite(week)) continue;      // no join key / no week — unusable
    out.push({
      player_id: pid,
      season,
      week,
      team_abbr: normTeam(r.team),
      position: blank(r.position),
      full_name: blank(r.full_name),
      // The club's game-status designation. Blank for most of the report, and
      // that blank means "on the report, expected to play" — a real state.
      report_status: blank(r.report_status),
      practice_status: blank(r.practice_status),
      injury: blank(r.practice_primary_injury) || blank(r.report_primary_injury),
    });
  }
  // A club can file the same player twice in a week (a corrected report). Keep
  // the LAST row, which is the correction.
  const byKey = new Map();
  for (const row of out) byKey.set(`${row.player_id}|${row.week}`, row);
  return [...byKey.values()];
}

async function sb(path, { method = "GET", body, prefer } = {}) {
  const headers = {
    apikey: SKEY, Authorization: `Bearer ${SKEY}`, "Content-Type": "application/json",
    ...(method === "GET" ? { "Accept-Profile": "nfl" } : { "Content-Profile": "nfl" }),
    ...(prefer ? { Prefer: prefer } : {}),
  };
  const res = await sbRequest(`${SUPA}/rest/v1/${path}`,
    { method, headers, body: body ? JSON.stringify(body) : undefined },
    { idempotent: true, label: `${method} nfl.${path.split("?")[0]}` });
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function main() {
  const url = `${REL}/injuries/injuries_${SEASON}.csv`;
  console.log(`↓ ${url}`);
  const res = await fetch(url, { headers: { "User-Agent": "nfl-research-dashboard" } });
  if (!res.ok) die(`nflverse returned ${res.status} for injuries_${SEASON}.csv`);
  const rows = toRows(parseCsv(await res.text()), SEASON);

  const byWeek = {};
  const byStatus = {};
  for (const r of rows) {
    byWeek[r.week] = (byWeek[r.week] || 0) + 1;
    const s = r.report_status || "(no designation)";
    byStatus[s] = (byStatus[s] || 0) + 1;
  }
  console.log(`  ${rows.length} report rows · weeks ${Object.keys(byWeek).join(",") || "—"}`);
  for (const [s, n] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(5)}  ${s}`);
  }

  if (!LIVE) {
    console.log("\nDry run. Re-run with --live to upsert into nfl.player_injuries.");
    return;
  }
  if (!SUPA || !SKEY) die("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — run with --env-file=.env.local");

  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    await sb("player_injuries?on_conflict=player_id,season,week", {
      method: "POST", body: chunk, prefer: "resolution=merge-duplicates,return=minimal",
    });
    console.log(`  ↑ ${Math.min(i + 500, rows.length)}/${rows.length}`);
  }
  console.log("Done.");
}

// Importable for the test without running the pull.
if (process.argv[1] && process.argv[1].endsWith("pull_injuries.mjs")) {
  main().catch((e) => die(e.message || String(e)));
}
