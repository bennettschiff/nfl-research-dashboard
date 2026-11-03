// ── Season data loading ──────────────────────────────────────────────────────
// Pulled out of App.jsx so the season-flip logic has one home and is testable
// without rendering. Nothing here is a component.
//
// THE SEASON-FLIP PROBLEM this solves: player_season_agg only ever contains the
// season the ETL last built, aggregated from games that have been PLAYED. At
// week 1 of a new season it is empty, so every board that reads it renders
// nothing. src/lib/playerPriors.js supplies each player's carried-forward
// baseline; this module is where the two are married.
//
// At a season with no priors (2025 and earlier) `rosterFor` returns the live
// rows untouched, so the pre-flip surface is unchanged.
import { supabase } from "./supabase.js";
import { BOOK_PREF, SACK_BOOKS } from "./odds.js";
import { assembleSeason } from "./seasonData.js";
import { pkOf } from "./tableKeys.js";

// Re-exported: the pure half moved to seasonData.js so the Node pick ledger can
// build the same season object without importing supabase.js.
export { rosterFor, latestProfiles } from "./seasonData.js";

const PAGE = 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Order a query on the table's WHOLE primary key.
 *
 * OFFSET paging with no ORDER BY is not just slow, it is WRONG: Postgres makes
 * no ordering promise between two unordered scans, so a row can appear on two
 * pages or on none. Ordering on the leading PK column alone is the same bug
 * among its ties (player_week_stats has ~6 rows per player_id) — see
 * tableKeys.js. The whole key is the PK index's own order, so it costs nothing.
 */
const byPk = (q, table) => pkOf(table).reduce((acc, c) => acc.order(c, { ascending: true }), q);

/** Does this error look transient — worth another go — or permanent? */
const TRANSIENT = /timeout|canceling statement|fetch|network|failed to fetch|50[234]/i;

/**
 * Run one page, retrying the transient failures.
 *
 * The shared Supabase instance enforces a statement timeout, and ten parallel
 * full-table reads at mount is exactly the burst that trips it. The whole board
 * used to die on a single "canceling statement due to statement timeout" with
 * no way back — one slow page killed the app. A missing table or a bad column
 * fails identically every attempt, so only the transient class is retried.
 */
async function page(run, label, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    const { data, error } = await run();
    if (!error) return data;
    last = error;
    if (!TRANSIENT.test(error.message || "")) break;
    await sleep(400 * 2 ** i);
  }
  throw new Error(`${label}: ${last?.message || "request failed"}`);
}

/**
 * Run `jobs` with at most `limit` in flight.
 *
 * loadSeason used to Promise.all ten table loads, and several of those page —
 * player_week_stats alone is a dozen sequential requests. All ten starting at
 * once put ~25 reads on a shared Postgres at mount, which is what pushed pages
 * past the statement timeout and killed the load. Four at a time finishes just
 * as fast (the long poles still overlap) without the pile-up.
 */
async function mapLimit(jobs, limit = 4) {
  const out = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      out[i] = await jobs[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  return out;
}

/**
 * Page through a PostgREST table — it caps at 1000 rows per request.
 *
 * `eq` is an optional [column, value] filter applied SERVER-side. A table the
 * board only ever reads one season of should not ship every season it holds
 * across the wire to be thrown away in `loadSeason`: that is egress and shared-
 * instance read work spent on rows nobody looks at, and it grows with every
 * season the ETL adds. Pass it only where the whole result is season-filtered
 * downstream anyway — `player_week_stats` and `player_profiles` genuinely read
 * prior seasons for the flip fallbacks and must stay unfiltered.
 */
async function selectAll(table, cols = "*", eq = null) {
  const all = [];
  for (let from = 0; ; from += PAGE) {
    const rows = await page(() => {
      let q = supabase.from(table).select(cols);
      if (eq) q = q.eq(eq[0], eq[1]);
      return byPk(q, table).range(from, from + PAGE - 1);
    }, `${table}[${from}]`);
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

/**
 * Load one season's injury report.
 *
 * Lives here rather than in injuries.js because that module must stay free of
 * supabase.js: it is imported by depthPromotion.js, which the Node grading
 * harness imports, and a module-scope `import.meta.env` read takes every script
 * in scripts/ down before it can grade anything.
 *
 * Degrades to [] the way loadLiveOdds does: the table may not exist yet (run
 * db/schema.sql), and the board must render its projections regardless. An
 * availability layer that can take the whole page down is worse than none.
 */
export async function loadInjuries(season) {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const q = supabase
      .from("player_injuries")
      .select("player_id,week,team_abbr,report_status,practice_status,injury")
      .eq("season", season);
    const { data, error } = await byPk(q, "player_injuries").range(from, from + 999);
    if (error) return all;
    all.push(...data);
    if (data.length < 1000) break;
  }
  return all;
}

/**
 * The nine season tables, from /api/season — ONE request the CDN can answer.
 *
 * The board used to open with ten paged reads from the browser straight at
 * Supabase, ~14 round trips. The bytes were never the issue (the whole bundle
 * is ~0.34 MB gzipped); the request COUNT was, and request concurrency is what
 * left the shared instance I/O-throttled for six hours on 2026-09-08.
 *
 * Returns null on any failure so the caller falls back to reading the tables
 * directly. That fallback is not ceremony: it is the same "the board must
 * render regardless" rule the odds and injuries loaders already follow, and it
 * means a cold or broken function degrades to today's behaviour instead of an
 * empty board.
 */
async function loadSeasonBundle(season) {
  try {
    const res = await fetch(`/api/season?season=${season}`, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const body = await res.json();
    const t = body?.tables;
    // Guard on a table that is never legitimately absent. player_season_agg and
    // friends ARE empty at a season flip, so they cannot be the sentinel.
    if (!t || !Array.isArray(t.player_week_stats) || !Array.isArray(t.teams)) return null;
    return t;
  } catch {
    return null;
  }
}

/**
 * Live rows for a season, for the books the board can actually show.
 *
 * FILTERED SERVER-SIDE, and that is not a micro-optimisation. The pull stores
 * every book the API returns for free — 14 of them, ~10.5k rows for one slate —
 * and PostgREST caps a page at 1000, so fetching them all was 11 SEQUENTIAL
 * round trips and 11.9s, the single largest contributor to page load (measured
 * 2026-09-08). The three books indexOdds will look at are ~2.8k rows / 3 pages.
 * The rest stay in the table for best-line and consensus work in SQL, which is
 * where that analysis belongs anyway.
 *
 * Degrades to [] rather than throwing: before the week's pull there are no rows,
 * and the board must render its projections regardless.
 */
// link/sid carry the bet-slip deep links (src/lib/betslip.js). They are long
// URLs sharing a long prefix, so they cost close to nothing over the wire once
// gzipped, and nothing at all in REQUESTS — which is the axis the 2026-09-08
// egress incident was actually about.
//
// row_key is the PRIMARY KEY and is selected so the paging can key off it
// rather than count from the front — see the loop below for why that is a
// correctness matter and not a tuning one.
const COLS = "row_key,game_id,week,book,prop_type,player_name,name,line,odds";
const COLS_WITH_LINKS = `${COLS},link,sid`;

/**
 * PostgREST rejects the WHOLE query when a selected column does not exist, and
 * loadLiveOdds swallows errors by design — so a database that has not had the
 * link/sid migration applied would not show a broken bet-slip link, it would
 * show NO MARKET COLUMNS AT ALL, silently, on every row of the board. One
 * retry without them is the difference between a degraded feature and a blank
 * board, and it costs one request on exactly one deployment state.
 */
const MISSING_COLUMN = /42703|does not exist|column .* live_odds/i;

/**
 * KEYSET paging, not OFFSET, and a page that fails is retried rather than
 * quietly ending the fetch. Both of those replaced something that was actively
 * losing market rows.
 *
 * WHY NOT OFFSET. `offset=N` makes Postgres produce N+1000 rows and throw the
 * first N away, so page twelve costs twelve times page one. Worse, the odds
 * pull UPSERTS into this table while the board is paging it: a row inserted
 * ahead of the cursor shifts everything after it by one, so an OFFSET walk can
 * skip a line or return it twice. Keying off the last row_key seen is both
 * constant-cost and immune to that — the cursor is a position in the data, not
 * a count from the front.
 *
 * WHY THE RETRY. This is the query that was answering 500 on the live board:
 * `57014 canceling statement due to statement timeout`, reproduced 2026-09-22
 * with several loaders in flight. The old loop treated that as end-of-data and
 * returned the rows it happened to have — 5,000 of 11,656, a deterministic but
 * arbitrary 43% of the market, with no error anywhere. That is the worst shape
 * this failure can take: CLAUDE.md records that a row with no market on it gets
 * a synthetic line and a DIFF near +6 that floats it to the top of a
 * DIFF-sorted board, so a half-loaded market does not look broken, it looks
 * like edge. An exhausted retry therefore THROWS — loadSeason's catch turns
 * that into no market at all, which is uniformly and visibly wrong instead of
 * selectively and invisibly wrong.
 */
export async function loadLiveOdds(season, kind = "live", books = BOOK_PREF) {
  const all = [];
  let cols = COLS_WITH_LINKS;
  let after = null;

  for (;;) {
    const page = () => {
      let q = supabase
        .from("live_odds")
        .select(cols)
        .eq("season", season).eq("snapshot_kind", kind).in("book", books);
      if (after != null) q = q.gt("row_key", after);
      return q.order("row_key", { ascending: true }).limit(1000);
    };

    let data, error;
    for (let attempt = 0; attempt < 3; attempt++) {
      ({ data, error } = await page());
      if (error && cols === COLS_WITH_LINKS && MISSING_COLUMN.test(error.message || "")) {
        cols = COLS;                // pre-migration database — prices, no slip links
        ({ data, error } = await page());
      }
      if (!error || !TRANSIENT.test(error.message || "")) break;
      if (attempt < 2) await sleep(400 * 2 ** attempt);   // no backoff after the last try
    }

    // A table that does not exist yet is not a failure — before the week's pull
    // there are simply no rows, and the board renders its projections anyway.
    if (error && !all.length && !TRANSIENT.test(error.message || "")) return all;
    if (error) {
      throw new Error(`live_odds page after ${after ?? "start"} (${all.length} rows in hand): `
        + `${error.message || "request failed"}`);
    }

    all.push(...data);
    if (data.length < 1000) break;
    after = data[data.length - 1].row_key;
  }
  return all;
}

/**
 * This season's LIVE game lines (spread, total, moneyline, team total) for the
 * board's books, for games kicking off from five days ago on.
 *
 * The date window is what keeps it to one request: a live row is never pruned
 * from game_lines and a moved line leaves its old row behind, so the season's
 * live surface grows every week (~1.7k rows by week 6 across these books), while
 * the board only ever prices games that have not finished. A finished game's
 * game-line picks are read from the ledger, not from here.
 *
 * Degrades to [] like the other market loaders: no pull yet, no rows.
 */
export async function loadGameLines(season, sinceDays = 5) {
  const since = new Date(Date.now() - sinceDays * 86400e3).toISOString();
  const all = [];
  for (let after = null; ;) {
    // Built fresh per attempt: a query builder is mutated by .order(), so a
    // retried one would carry the sort twice.
    const run = () => {
      let q = supabase.from("game_lines")
        .select("row_key,game_id,week,book,market,outcome,team,line,odds,captured_at,link,sid")
        .eq("season", season).eq("snapshot_kind", "live").in("book", BOOK_PREF).gte("commence_time", since);
      if (after != null) q = q.gt("row_key", after);
      return q.order("row_key", { ascending: true }).limit(1000);
    };
    const data = await page(run, `game_lines[${after ?? "start"}]`);
    all.push(...data);
    if (data.length < 1000) break;
    after = data[data.length - 1].row_key;
  }
  return all;
}

export async function loadSeason(season) {
  // One cached request for the nine season tables; odds and injuries stay on
  // their own paths because they move on a different clock (odds in minutes,
  // injuries when clubs file) and are small enough not to be worth bundling.
  const bundle = await loadSeasonBundle(season);

  const seasonTables = bundle
    ? [
        () => bundle.player_week_stats,
        () => bundle.players,
        () => bundle.player_season_agg ?? [],
        () => bundle.player_scheme_splits ?? [],
        () => bundle.player_profiles ?? [],
        () => bundle.games ?? [],
        () => bundle.team_defense_scheme ?? [],
        () => bundle.team_offense_profile ?? [],
        () => bundle.teams,
      ]
    : [
        // FALLBACK: the pre-2026-09-08 direct path, unchanged.
        () => selectAll("player_week_stats"),
        () => selectAll("players"),
        () => selectAll("player_season_agg", "*", ["season", season]),
        () => selectAll("player_scheme_splits", "*", ["season", season]),
        // Research profiles are optional — the app predates the table and should
        // not fail to load if it is missing or empty.
        () => selectAll("player_profiles").catch(() => []),
        () => selectAll("games", "*", ["season", season]),
        () => selectAll("team_defense_scheme", "*", ["season", season]),
        () => selectAll("team_offense_profile", "*", ["season", season]),
        () => selectAll("teams"),
      ];

  const [weeks, players, seasonAgg, splits, profiles, games, defense, offense, teams, oddsRows, injuries, gameLineRows] =
    await mapLimit([
      ...seasonTables,
      // Market lines are optional: before the week's pull runs there are none,
      // and the board must render its projections regardless. loadLiveOdds
      // already swallows a missing table; this catch covers a transport failure.
      // One query for both book lists: the board's shown sportsbooks and the
      // sack market's, which is a different set (see SACK_BOOKS). Loading them
      // separately would be a second paged fetch for the same table.
      () => loadLiveOdds(season, "live", [...new Set([...BOOK_PREF, ...SACK_BOOKS])]).catch(() => []),
      // Availability is optional in exactly the way market lines are: the table
      // may not exist yet, and no week of a fresh season has a report until the
      // clubs file on Wednesday. loadInjuries already swallows a missing table;
      // this catch covers a transport failure.
      () => loadInjuries(season).catch(() => []),
      // Game lines, optional for the same reason the props' lines are.
      () => loadGameLines(season).catch(() => []),
    ]);

  return assembleSeason({ season, weeks, players, seasonAgg, splits, profiles, games, defense, offense, teams, oddsRows, injuries, gameLineRows });
}
