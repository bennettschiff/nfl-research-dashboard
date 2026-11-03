// ── The board's season object, built in Node ─────────────────────────────────
// The pick ledger must record the board people were SHOWN, so this reads the
// same tables api/season.js serves and hands them to the same assembleSeason()
// the browser uses (src/lib/seasonData.js). The only thing it adds is what a
// ledger needs and the board does not: when each game's odds were captured, and
// the closing rows for grading.
import { sbRequest } from "./sb.mjs";
import { assembleSeason } from "../../src/lib/seasonData.js";
import { indexOdds, indexSackOdds, BOOK_PREF, SACK_BOOKS } from "../../src/lib/odds.js";
import { indexGameLines } from "../../src/lib/gameMarkets.js";
import { pkOf } from "../../src/lib/tableKeys.js";

const PAGE = 1000;

/**
 * At most `limit` table reads in flight. Ten parallel full-table reads is the
 * burst that trips the shared instance's statement timeout (see loadData.js).
 */
async function mapLimit(jobs, limit = 4) {
  const out = new Array(jobs.length);
  let next = 0;
  const worker = async () => { while (next < jobs.length) { const i = next++; out[i] = await jobs[i](); } };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  return out;
}

export function sbClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");

  async function sb(path, { method = "GET", body, prefer } = {}) {
    const headers = {
      apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json",
      ...(method === "GET" ? { "Accept-Profile": "nfl" } : { "Content-Profile": "nfl" }),
      ...(prefer ? { Prefer: prefer } : {}),
    };
    // Every write this ledger makes is an upsert on pick_key or a PATCH by id,
    // so a retried request lands the same answer — idempotent is truthful.
    const res = await sbRequest(`${url}/rest/v1/${path}`,
      { method, headers, body: body ? JSON.stringify(body) : undefined },
      { idempotent: true, label: `${method} nfl.${path.split("?")[0]}` });
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
  }

  /**
   * Page a table in primary-key order (OFFSET without ORDER BY can skip rows).
   *
   * `order` is a column or an array of them, and for an OFFSET walk it must be
   * UNIQUE — the whole primary key (`pkOf(table)`), never its leading column:
   * rows tied on the sort can land on two pages or none (src/lib/tableKeys.js).
   *
   * `keyset: true` pages by `order > last` instead of OFFSET, and is only
   * correct when `order` is ONE unique column and selected. Use it on
   * nfl_picks: OFFSET there sorts offset+1000 wide rows per page and spills to
   * temp (see walkPicks in src/lib/picks.js); a cursor bounds every page to 1000.
   */
  async function selectAll(table, query, order, { keyset = false } = {}) {
    const cols = [].concat(order);
    const rows = [];
    if (keyset) {
      if (cols.length !== 1) throw new Error(`selectAll ${table}: keyset pages on one unique column, got ${cols}`);
      for (let after = null; ;) {
        const cursor = after == null ? "" : `&${order}=gt.${encodeURIComponent(after)}`;
        const batch = await sb(`${table}?${query}${cursor}&order=${order}.asc&limit=${PAGE}`);
        rows.push(...batch);
        if (batch.length < PAGE) break;
        after = batch[batch.length - 1][order];
        if (after == null) throw new Error(`selectAll ${table}: keyset column ${order} is not selected`);
      }
      return rows;
    }
    for (let from = 0; ; from += PAGE) {
      const batch = await sb(`${table}?${query}&order=${cols.map((c) => `${c}.asc`).join(",")}&limit=${PAGE}&offset=${from}`);
      rows.push(...batch);
      if (batch.length < PAGE) break;
    }
    return rows;
  }

  return { sb, selectAll };
}

/**
 * The books to READ, which is the union of two different lists.
 *
 * BOOK_PREF is what the board shows for the offensive markets and SACK_BOOKS
 * what it shows for the defensive one — the same three books today, but read as
 * a union because they have differed before and the ledger must record whatever
 * the board showed. The browser's loader already unioned them
 * (src/lib/loadData.js); this one did not, so the ledger rebuilt the board with
 * the sack market missing and recorded none of it. assembleSeason() splits them
 * apart again into `odds` and `sackOdds`.
 */
const READ_BOOKS = [...new Set([...BOOK_PREF, ...SACK_BOOKS])];
const books = `book=in.(${READ_BOOKS.join(",")})`;
const ODDS_COLS = "row_key,game_id,week,book,prop_type,player_name,name,line,odds,captured_at";
const GL_COLS = "row_key,game_id,week,book,market,outcome,team,line,odds,captured_at,link,sid";

/** The season object the board builds, plus odds capture times per game. */
export async function loadSeasonNode(season, db = sbClient()) {
  const { selectAll } = db;
  const opt = (p) => p.catch(() => []);
  const [weeks, players, profiles, seasonAgg, splits, games, defense, offense, teams, oddsRows, injuries, gameLineRows] =
    await mapLimit([
      () => selectAll("player_week_stats", "select=*", pkOf("player_week_stats")),
      () => selectAll("players", "select=*", pkOf("players")),
      () => opt(selectAll("player_profiles", "select=*", pkOf("player_profiles"))),
      () => opt(selectAll("player_season_agg", `select=*&season=eq.${season}`, pkOf("player_season_agg"))),
      () => opt(selectAll("player_scheme_splits", `select=*&season=eq.${season}`, pkOf("player_scheme_splits"))),
      () => selectAll("games", `select=*&season=eq.${season}`, pkOf("games")),
      () => opt(selectAll("team_defense_scheme", `select=*&season=eq.${season}`, pkOf("team_defense_scheme"))),
      () => opt(selectAll("team_offense_profile", `select=*&season=eq.${season}`, pkOf("team_offense_profile"))),
      () => selectAll("teams", "select=*", pkOf("teams")),
      () => selectAll("live_odds", `select=${ODDS_COLS}&season=eq.${season}&snapshot_kind=eq.live&${books}`, "row_key"),
      () => opt(selectAll("player_injuries",
        `select=player_id,week,team_abbr,report_status,practice_status,injury&season=eq.${season}`, pkOf("player_injuries"))),
      // The board's game lines, same window the browser reads (loadData.js loadGameLines).
      () => opt(selectAll("game_lines", `select=${GL_COLS}&season=eq.${season}&snapshot_kind=eq.live&${books}`
        + `&commence_time=gte.${new Date(Date.now() - 5 * 86400e3).toISOString()}`, "row_key")),
    ]);

  const d = assembleSeason({ season, weeks, players, seasonAgg, splits, profiles, games, defense, offense, teams, oddsRows, injuries, gameLineRows });

  const oddsAt = {};
  for (const r of oddsRows) if (!oddsAt[r.game_id] || r.captured_at > oddsAt[r.game_id]) oddsAt[r.game_id] = r.captured_at;
  // Game lines come from their own (cheaper) pull and have their own clock.
  const gameOddsAt = {};
  for (const r of gameLineRows) if (!gameOddsAt[r.game_id] || r.captured_at > gameOddsAt[r.game_id]) gameOddsAt[r.game_id] = r.captured_at;
  return { d, oddsAt, gameOddsAt };
}

/**
 * Closing lines for a set of games, indexed like the board's odds.
 *
 * A close pull that moves a line leaves BOTH rows (row_key carries the line), so
 * rows are folded oldest-first: the last capture before kickoff is what each
 * book's record ends up holding.
 */
export async function loadCloseIndex(season, gameIds, kickoffs, db = sbClient()) {
  const before = await closeRows(season, gameIds, kickoffs, db);
  return indexOdds(before);
}

/**
 * The same closing rows, indexed as a sack LADDER instead.
 *
 * indexOdds keeps one line per book, which is the wrong shape for a market whose
 * books post the same man at 0.25 and at 2.5 — and it reads only the board's
 * sportsbooks, so a PrizePicks close would not be in it at all. The grader needs
 * this one to give a sack pick its CLV against the rung it was actually taken at.
 */
export async function loadSackCloseIndex(season, gameIds, kickoffs, db = sbClient()) {
  const before = await closeRows(season, gameIds, kickoffs, db);
  return indexSackOdds(before);
}

/**
 * Closing GAME lines (spread, total, moneyline, team total) for a set of games,
 * indexed like the board's: the newest close capture at or before kickoff, per
 * book and side. `gamesById` names each team's side.
 */
export async function loadGameCloseIndex(season, gameIds, kickoffs, gamesById, db = sbClient()) {
  if (!gameIds.length) return new Map();
  const ids = gameIds.map((g) => `"${g}"`).join(",");
  const rows = await db.selectAll("game_lines",
    `select=${GL_COLS}&season=eq.${season}&snapshot_kind=eq.close&book=in.(${BOOK_PREF.join(",")})&game_id=in.(${ids})`, "row_key");
  return indexGameLines(rows.filter((r) => !kickoffs[r.game_id] || new Date(r.captured_at) <= kickoffs[r.game_id]), gamesById);
}

/** The close rows for a set of games, folded oldest-first. */
async function closeRows(season, gameIds, kickoffs, db) {
  if (!gameIds.length) return [];
  const ids = gameIds.map((g) => `"${g}"`).join(",");
  const rows = await db.selectAll("live_odds",
    `select=${ODDS_COLS}&season=eq.${season}&snapshot_kind=eq.close&${books}&game_id=in.(${ids})`, "row_key");
  const before = rows.filter((r) => !kickoffs[r.game_id] || new Date(r.captured_at) <= kickoffs[r.game_id]);
  before.sort((a, b) => String(a.captured_at).localeCompare(String(b.captured_at)));
  return before;
}
