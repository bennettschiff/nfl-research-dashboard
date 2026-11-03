#!/usr/bin/env node
/**
 * Nightly Supabase backup dump (uploaded to Google Drive via rclone).
 *
 * Dumps each NFL table to a local folder — JSON for everything, plus CSV for
 * nfl_picks (the table you'd open in Sheets). Files over ~5 MB are gzipped. The
 * upload step is `rclone copy` (see .github/workflows/backup-to-drive.yml),
 * which uses YOUR Google account so backups live in (and count against) your
 * own Drive storage. Mirrors the MLB lab's backup script.
 *
 * --- One-time setup (reuse the MLB lab's rclone remote / RCLONE_CONF secret) ---
 * 1. Locally: `brew install rclone && rclone config create gdrive drive scope=drive.file`
 *    (opens a browser — log in with your Google account and click Allow).
 * 2. `gh secret set RCLONE_CONF < ~/.config/rclone/rclone.conf`
 *    (and SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY as repo secrets).
 *
 * --- Local run ---
 *   set -a; source .env.local; set +a
 *   node scripts/backup-to-drive.mjs --out-dir=backup-out [--tables=nfl_picks]
 *   rclone copy backup-out "gdrive:nfl-research-dashboard-backups/$(date +%F)"
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";
import { sbJson } from "./lib/sb.mjs";
import { pkOf } from "../src/lib/tableKeys.js";

// table -> { order: the FULL primary key (src/lib/tableKeys.js) — an OFFSET walk
//            on its leading column alone can double or drop rows tied on it,
//            page: rows per request,
//            keyset: page by `order > last` — only where the key is ONE column }
export const TABLES = {
  teams: { order: pkOf("teams"), page: 1000 },
  games: { order: pkOf("games"), page: 1000 },
  players: { order: pkOf("players"), page: 1000 },
  team_offense_profile: { order: pkOf("team_offense_profile"), page: 1000 },
  team_defense_scheme: { order: pkOf("team_defense_scheme"), page: 1000 },
  player_scheme_splits: { order: pkOf("player_scheme_splits"), page: 1000 },
  player_season_agg: { order: pkOf("player_season_agg"), page: 1000 },
  player_week_stats: { order: pkOf("player_week_stats"), page: 1000 },
  nfl_picks: { order: pkOf("nfl_picks"), page: 1000, keyset: true },
  // Pay-once Odds API data (~11k credits). The raw snapshots in
  // scripts/odds_cache/ are gitignored and local-only, so this table is the
  // only durable copy — it MUST stay in the nightly backup.
  historical_odds: { order: pkOf("historical_odds"), page: 1000 },
  // Also bought with Odds API credits, and it was not in this list at all until
  // 2026-09-22 — the season's whole market record, live and close, had never
  // been backed up. It matters more now that prune-live-odds.yml deletes the
  // played weeks' live rows on a schedule: that job keeps its own dump, but
  // this is the copy that covers the rows it deliberately does NOT touch.
  live_odds: { order: pkOf("live_odds"), page: 1000, keyset: true },
};

// Also export as CSV (in addition to JSON) — tables you'd open in Sheets.
const CSV_TABLES = new Set(["nfl_picks"]);

const GZIP_THRESHOLD = 5 * 1024 * 1024;

const TABLE_OVERRIDE = (process.argv.find((a) => a.startsWith("--tables=")) || "").split("=")[1];
const OUT_DIR = (process.argv.find((a) => a.startsWith("--out-dir=")) || "").split("=")[1];

function env(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

// A bare fetch here meant one transient 5xx threw away the whole night's backup.
// On 2026-09-05 the shared instance stalled hard enough that PostgREST's own
// `SET client_encoding` hit the statement timeout, and every request for ~8
// minutes came back 504 after 135–180 s at the gateway — this job died on
// `teams`, a 36-row table, and none of the other nine ever got dumped.
//
// The retry policy itself now lives in scripts/lib/sb.mjs, so it is one tested
// thing rather than a loop copied into each script (which is how the same stall
// managed to look like separate breakage in three repos). A nightly job can
// afford to wait, so it passes a longer per-request timeout than the default.
function fetchPage(table, order, limit, { offset, after }) {
  const page = after === undefined ? `offset=${offset}` : after === null ? "" : `${order[0]}=gt.${encodeURIComponent(after)}`;
  return sbJson(
    `${env("SUPABASE_URL")}/rest/v1/${table}?select=*&order=${order.map((c) => `${c}.asc`).join(",")}&limit=${limit}${page ? `&${page}` : ""}`,
    {
      headers: {
        apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
        Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`,
        // NFL tables live in the `nfl` schema of the shared host project.
        "Accept-Profile": "nfl",
      },
    },
    { label: table, timeoutMs: 120_000 },
  );
}

// OFFSET makes Postgres produce and discard every earlier row on every page —
// on nfl_picks that is a sort of offset+1000 wide rows that spills to temp, on
// live_odds a seq scan of the whole table. Keyset tables page from a cursor.
export async function dumpTable(table, { order, page, keyset }) {
  if (keyset && order.length !== 1) throw new Error(`${table}: keyset pages on one unique column, got ${order}`);
  const rows = [];
  for (let offset = 0, after = null; ; offset += page) {
    const batch = await fetchPage(table, order, page, keyset ? { after } : { offset });
    rows.push(...batch);
    if (batch.length < page) break;
    after = batch[batch.length - 1][order[0]];
  }
  return rows;
}

function toCsv(rows) {
  if (!rows.length) return "";
  const cols = Array.from(rows.reduce((set, r) => { Object.keys(r).forEach((k) => set.add(k)); return set; }, new Set()));
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

function writeJson(dir, table, rows) {
  const json = JSON.stringify(rows);
  if (Buffer.byteLength(json) > GZIP_THRESHOLD) {
    const file = path.join(dir, `${table}.json.gz`);
    fs.writeFileSync(file, zlib.gzipSync(json));
    return file;
  }
  const file = path.join(dir, `${table}.json`);
  fs.writeFileSync(file, json);
  return file;
}

async function main() {
  const tables = TABLE_OVERRIDE ? TABLE_OVERRIDE.split(",") : Object.keys(TABLES);
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  const outDir = OUT_DIR
    ? (fs.mkdirSync(OUT_DIR, { recursive: true }), OUT_DIR)
    : fs.mkdtempSync(path.join(os.tmpdir(), "sb-backup-"));
  console.log(`[backup] date=${today} tables=${tables.length} out=${outDir}`);

  const summary = { date: today, tables: {}, failed: {} };
  for (const t of tables) {
    const cfg = TABLES[t];
    if (!cfg) throw new Error(`Unknown table: ${t}`);
    process.stdout.write(`  ${t} … `);
    // One table that stays unreachable after every retry must not cost the other
    // nine their nightly copy — historical_odds especially, which is ~11k credits
    // of pay-once Odds API data with no other durable copy. Dump what we can,
    // record what we couldn't, and let the caller fail the job; the upload step
    // runs `if: always()` so the partial folder still reaches Drive.
    let rows;
    try {
      rows = await dumpTable(t, cfg);
    } catch (e) {
      summary.failed[t] = String(e.message || e);
      console.log(`FAILED — ${String(e.message || e).slice(0, 200)}`);
      continue;
    }
    const file = writeJson(outDir, t, rows);
    summary.tables[t] = { rows: rows.length, bytes: fs.statSync(file).size };
    if (CSV_TABLES.has(t)) fs.writeFileSync(path.join(outDir, `${t}.csv`), toCsv(rows));
    console.log(`${rows.length} rows`);
  }
  fs.writeFileSync(path.join(outDir, "_manifest.json"), JSON.stringify(summary, null, 2));

  const missing = Object.keys(summary.failed);
  if (missing.length) {
    console.error(
      `::error::Backup incomplete — ${missing.length}/${tables.length} table(s) could not be read after retries: ${missing.join(", ")}. ` +
      `The tables that did dump are in ${outDir} and still upload; see _manifest.json.`
    );
    process.exitCode = 1;
    return;
  }
  console.log(`[backup] dump complete: ${outDir}`);
}

// Run only as a script: tableKeys.test.js imports TABLES/dumpTable to check the
// walk orders, and an import must not start a backup.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
