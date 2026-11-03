#!/usr/bin/env node
/**
 * prune_live_odds.mjs — drop the 'live' odds rows for games that are over.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────
 * db/schema.sql says the live surface "stays the size of one slate however often
 * we refresh it". That is true WITHIN a slate and false ACROSS them: row_key
 * carries the line, so a line move writes a NEW row rather than updating one,
 * and every finished week stays in the table for good. Measured 2026-09-22,
 * two weeks into the season: 48,379 live rows, 11,656 of them in the three books
 * the board reads — and the board pages ALL of them on every load, for games
 * that finished days ago, to render one upcoming week. That grows ~11k
 * board-book rows a week for the whole season.
 *
 * Nothing reads a live row once its game has kicked off. The grader takes its
 * CLV from the kept 'close' snapshots (scripts/grade_picks.mjs via
 * loadCloseIndex), --backfill replaces d.odds with those same close rows
 * (snapshot_picks.mjs), and the board hides a finished game outright.
 *
 * ── WHAT IT WILL NOT DELETE ──────────────────────────────────────────────────
 * A live row is only deletable when a 'close' row exists for the SAME outcome —
 * (game_id, book, prop_type, player_name, name). That check is not decoration:
 * on 2026-09-22, 777 outcomes across all 17 books existed ONLY in live, because
 * a close pull never reached them. Deleting those would destroy the only record
 * this project has of a market it paid Odds API credits for. They stay.
 *
 * It never touches a game whose kickoff is less than --hours ago (default 6), so
 * a game in progress is out of scope.
 *
 * ── GRADED GAMES LEAVE THE TABLE ENTIRELY (--archive-days, default 1) ────────
 * The kept 'close' rows were the other half of the growth: ~20k a week, 98k by
 * week 5, on a 0.5 GB Nano shared with MLB/WNBA/NHL whose Postgres cache already
 * lived in swap (measured 2026-10-13: ~4 MB/s of swap reads at ~60 requests an
 * hour, and the Disk IO budget email). At that rate live_odds alone carries the
 * database past the free plan's 500 MB cap before the Super Bowl, and the nightly
 * backup walks every row of it. A close row is read by the grader the morning
 * after its game, and the grader stamps close_line/close_odds/clv onto the pick,
 * so once none of a game's picks is pending, nothing needs its odds again. Every row for such a game — close AND live, including
 * the live-only outcomes the rule above keeps — is dumped and removed.
 *
 * "Nothing pending" is the real gate, not the age. grade_picks.mjs re-checks
 * 10 days back for stat corrections, but a regrade that reaches an archived game
 * finds no close and leaves the stamped CLV alone (closeFor returns null) — it
 * needs the box score, not the odds. The first version held games 14 days to
 * clear that window; it bought nothing but a bigger table. The one day only
 * keeps a game out of the run on the day it is played. Run Tuesday 16:00 UTC,
 * after Tuesday's 12:00 grade, that archives everything through Sunday that is
 * fully graded; Monday night and anything still pending wait a week. To re-run
 * snapshot_picks.mjs --backfill on an archived week, upsert its rows back from
 * Drive first.
 *
 * Only games whose gameday is inside the last --window-days (default 28) before
 * that cutoff are probed, so a weekly run costs a few requests per recent game,
 * not one per game of the season. A run that misses more than a month leaves
 * stragglers: sweep them with a larger --window-days.
 *
 * ── THE DUMP IS NOT OPTIONAL ─────────────────────────────────────────────────
 * Every row is written to --out-dir as gzipped JSON BEFORE anything is deleted,
 * and the delete is addressed by the primary keys of exactly the rows that were
 * dumped — so what came out is what went away, and it can be restored with a
 * plain upsert. .github/workflows/prune-live-odds.yml uploads that file to
 * Google Drive and only then lets the delete run.
 *
 * ── RUN ──────────────────────────────────────────────────────────────────────
 *   set -a; source .env.local; set +a
 *   node scripts/prune_live_odds.mjs --season 2026                  # dry run
 *   node scripts/prune_live_odds.mjs --season 2026 --out-dir prune-out --write
 *   node scripts/prune_live_odds.mjs --season 2026 --window-days 120  # sweep stragglers
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";
import { sbClient } from "./lib/season.mjs";

const arg = (name, fallback = null) => {
  const hit = process.argv.find((a) => a === name || a.startsWith(`${name}=`));
  if (!hit) return fallback;
  if (hit.includes("=")) return hit.split("=").slice(1).join("=");
  const next = process.argv[process.argv.indexOf(hit) + 1];
  return next && !next.startsWith("--") ? next : true;
};

const SEASON = Number(arg("--season", 2026));
const HOURS = Number(arg("--hours", 6));
const OUT_DIR = arg("--out-dir", "prune-out");
const WRITE = Boolean(arg("--write", false));
const ARCHIVE_DAYS = Number(arg("--archive-days", 1));
const WINDOW_DAYS = Number(arg("--window-days", 28));

// The board's own columns plus everything needed to restore a row verbatim.
const ALL_COLS = "row_key,game_id,season,week,book,prop_type,player_name,name,line,odds,"
  + "link,sid,snapshot_kind,commence_time,captured_at";

// row_key is 90 characters at its longest, so a list of 60 keeps the URL near
// 6 KB — comfortably inside what the gateway will accept, and PostgREST has no
// other way to address a set of rows.
const DELETE_BATCH = 60;

/**
 * Page a live_odds query by PRIMARY KEY, never by offset.
 *
 * `order by row_key offset N` cannot use live_odds_season_kind_rowkey_idx — the
 * planner costs a Seq Scan of the whole table plus a top-N sort cheaper than
 * skipping N index entries, and takes it, which is what had the board answering
 * `57014 canceling statement due to statement timeout`. See db/schema.sql.
 */
async function selectByKey(db, query) {
  const rows = [];
  let after = null;
  for (;;) {
    const gt = after == null ? "" : `&row_key=gt.${encodeURIComponent(after)}`;
    const batch = await db.sb(`live_odds?${query}${gt}&order=row_key.asc&limit=1000`);
    rows.push(...batch);
    if (batch.length < 1000) break;
    after = batch[batch.length - 1].row_key;
  }
  return rows;
}

/**
 * The games whose every odds row can leave the table: played more than
 * `archiveDays` ago (by gameday), no more than `windowDays` before that, and
 * with no pick still pending. Dates are YYYY-MM-DD strings, compared as such.
 */
export function archivableGames(games, pendingGameIds, today, { archiveDays = 1, windowDays = 28 } = {}) {
  const day = (n) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86400e3).toISOString().slice(0, 10);
  const cutoff = day(archiveDays);
  const floor = day(archiveDays + windowDays);
  const pending = new Set(pendingGameIds);
  return games
    .filter((g) => g.gameday && g.gameday < cutoff && g.gameday >= floor && !pending.has(g.game_id))
    .map((g) => g.game_id)
    .sort();
}

/** Every odds row for one game, in row_key order (index on game_id, then a cursor). */
async function gameRows(db, gameId) {
  const rows = [];
  for (let after = null; ;) {
    const gt = after == null ? "" : `&row_key=gt.${encodeURIComponent(after)}`;
    const batch = await db.sb(`live_odds?select=${ALL_COLS}&season=eq.${SEASON}`
      + `&game_id=eq.${encodeURIComponent(gameId)}${gt}&order=row_key.asc&limit=1000`);
    rows.push(...batch);
    if (batch.length < 1000) return rows;
    after = batch[batch.length - 1].row_key;
  }
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Dump (and with --write, delete) every row of the graded games. Returns their ids. */
async function archivePlayedGames(db, stamp) {
  const today = new Date().toISOString().slice(0, 10);
  const games = await db.sb(`games?select=game_id,gameday&season=eq.${SEASON}&order=game_id.asc`);
  const pending = await db.sb(`nfl_picks?select=game_id&season=eq.${SEASON}&outcome=eq.pending`);
  const ids = archivableGames(games, pending.map((p) => p.game_id), today,
    { archiveDays: ARCHIVE_DAYS, windowDays: WINDOW_DAYS });
  console.log(`[archive] games played ${ARCHIVE_DAYS}-${ARCHIVE_DAYS + WINDOW_DAYS} days ago with nothing pending: ${ids.length}`);

  const byGame = new Map();
  for (const id of ids) {
    const rows = await gameRows(db, id);
    if (rows.length) byGame.set(id, rows);
    await pause(200);   // a weekly job; spread it out on the shared Nano
  }
  const all = [...byGame.values()].flat();
  if (!all.length) {
    console.log("[archive] nothing left to archive.");
    return ids;
  }
  const kinds = all.reduce((t, r) => ({ ...t, [r.snapshot_kind]: (t[r.snapshot_kind] || 0) + 1 }), {});
  console.log(`[archive]   ${all.length} rows across ${byGame.size} games ${JSON.stringify(kinds)}`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `live_odds_archived_${SEASON}_${stamp}.json.gz`);
  fs.writeFileSync(file, zlib.gzipSync(Buffer.from(JSON.stringify({
    meta: {
      table: "nfl.live_odds", season: SEASON, archived_at: new Date().toISOString(),
      archive_days: ARCHIVE_DAYS, games: [...byGame.keys()], rows: all.length, kinds,
      note: "Restore with an upsert on row_key. Every odds row (close and live) for games"
        + ` played over ${ARCHIVE_DAYS} days before archived_at with no pending pick.`,
    },
    rows: all,
  }))));
  console.log(`[archive] wrote ${file} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
  if (!WRITE) return ids;

  // Bounded by the newest capture that was dumped: a row a later pull writes
  // or re-stamps carries a newer captured_at and stays. What comes back must
  // be a subset of the dump, and the game must then be empty.
  let deleted = 0;
  for (const [id, rows] of byGame) {
    const dumped = new Set(rows.map((r) => r.row_key));
    const maxCap = rows.reduce((m, r) => (r.captured_at > m ? r.captured_at : m), "");
    const gone = await db.sb(`live_odds?season=eq.${SEASON}&game_id=eq.${encodeURIComponent(id)}`
      + `&captured_at=lte.${encodeURIComponent(maxCap)}&select=row_key`,
    { method: "DELETE", prefer: "return=representation" }) || [];
    const stray = gone.filter((r) => !dumped.has(r.row_key));
    if (stray.length) throw new Error(`${id}: deleted ${stray.length} rows that were not in the dump — restore from the run artifact`);
    const left = await db.sb(`live_odds?select=row_key&season=eq.${SEASON}&game_id=eq.${encodeURIComponent(id)}&limit=1`);
    if (left.length) throw new Error(`${id}: rows remain after the archive delete — a pull wrote to a game that is over and graded?`);
    deleted += rows.length;
    await pause(200);
  }
  console.log(`[archive] removed ${deleted} rows for ${byGame.size} games.`);
  return ids;
}

const outcomeKey = (r) => `${r.game_id}|${r.book}|${r.prop_type}|${r.player_name}|${r.name}`;

async function main() {
  const db = sbClient();
  const cutoff = new Date(Date.now() - HOURS * 3600e3).toISOString();
  // A file name must never repeat: the workflow copies into one dated Drive
  // folder, and on 2026-10-13 a second run that day replaced the first run's
  // archive there (recovered from its run artifact). Both steps of one run
  // share GITHUB_RUN_ID, so the uploaded dump and the delete describe one file.
  const stamp = `${new Date().toISOString().slice(0, 10)}_${process.env.GITHUB_RUN_ID
    || new Date().toISOString().slice(11, 19).replace(/:/g, "")}`;
  const archived = new Set(await archivePlayedGames(db, stamp));

  // Every outcome the kept record already covers. Read across the whole season
  // rather than per week: a close row is the record whatever week it came from.
  const closeRows = await selectByKey(db,
    `select=game_id,book,prop_type,player_name,name,row_key`
    + `&season=eq.${SEASON}&snapshot_kind=eq.close`);
  const covered = new Set(closeRows.map(outcomeKey));

  // Live rows whose game is comfortably over.
  // An archived game's rows went out whole above (a dry run leaves them in
  // place), so they are never dumped a second time here.
  const live = (await selectByKey(db,
    `select=${ALL_COLS}&season=eq.${SEASON}&snapshot_kind=eq.live`
    + `&commence_time=lt.${encodeURIComponent(cutoff)}`)).filter((r) => !archived.has(r.game_id));

  const doomed = live.filter((r) => covered.has(outcomeKey(r)));
  const orphans = live.filter((r) => !covered.has(outcomeKey(r)));

  console.log(`[prune] season ${SEASON} · kickoff older than ${HOURS}h (before ${cutoff})`);
  console.log(`[prune]   close rows on file      ${closeRows.length} (${covered.size} outcomes)`);
  console.log(`[prune]   live rows for over games ${live.length}`);
  console.log(`[prune]   deletable (close covers) ${doomed.length}`);
  console.log(`[prune]   KEPT, close never got them ${orphans.length}`
    + ` (${new Set(orphans.map(outcomeKey)).size} outcomes)`);

  if (!doomed.length) {
    console.log("[prune] nothing to do.");
    return;
  }

  // What may appear inside a double-quoted PostgREST `in.()` value, and what may
  // not. Checked against the live table 2026-09-22: an apostrophe round-trips
  // intact (Ja'Kobi Lane is a real row_key) and so does a period. A comma, a
  // paren, a double quote or a backslash would each change how the list parses,
  // and none of them occur — so rather than guess at an escaping rule that has
  // never been exercised, refuse the run and leave the data alone.
  const unsafe = doomed.find((r) => /["\\,()]/.test(r.row_key));
  if (unsafe) {
    throw new Error("row_key contains a character this script will not risk quoting: "
      + `${unsafe.row_key} — escape it deliberately before pruning`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `live_odds_pruned_${SEASON}_${stamp}.json.gz`);
  const payload = {
    meta: {
      table: "nfl.live_odds", season: SEASON, pruned_at: new Date().toISOString(),
      cutoff, hours: HOURS, rows: doomed.length,
      note: "Restore with an upsert on row_key. These are snapshot_kind='live' rows for"
        + " games already played, every one of which has a matching 'close' row.",
    },
    rows: doomed,
  };
  fs.writeFileSync(file, zlib.gzipSync(Buffer.from(JSON.stringify(payload))));
  const kb = (fs.statSync(file).size / 1024).toFixed(0);
  console.log(`[prune] wrote ${file} (${kb} KB, ${doomed.length} rows)`);

  if (!WRITE) {
    console.log("[prune] DRY RUN — pass --write to delete. Nothing was removed.");
    return;
  }

  // Addressed by the primary keys of exactly the rows just dumped, so the
  // backup and the delete can never describe different sets.
  const keys = doomed.map((r) => r.row_key);
  let done = 0;
  for (let i = 0; i < keys.length; i += DELETE_BATCH) {
    const slice = keys.slice(i, i + DELETE_BATCH);
    const list = slice.map((k) => `"${k}"`).join(",");
    await db.sb(`live_odds?row_key=in.(${encodeURIComponent(list)})`,
      { method: "DELETE", prefer: "return=minimal" });
    done += slice.length;
    if (done % 3000 < DELETE_BATCH) console.log(`[prune]   deleted ${done}/${keys.length}`);
  }

  const left = (await selectByKey(db,
    `select=row_key,game_id&season=eq.${SEASON}&snapshot_kind=eq.live`
    + `&commence_time=lt.${encodeURIComponent(cutoff)}`)).filter((r) => !archived.has(r.game_id));
  console.log(`[prune] deleted ${done} rows · ${left.length} live rows remain for finished games`
    + ` (expected ${orphans.length}, the ones close never captured)`);
  if (left.length !== orphans.length) {
    throw new Error(`expected ${orphans.length} rows left, found ${left.length} — inspect before rerunning`);
  }
  console.log("[prune] done.");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`[prune] ${e.message}`); process.exit(1); });
}
