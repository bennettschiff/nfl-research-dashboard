// ── /api/season — the whole season bundle, in ONE cached request ─────────────
//
// WHY THIS EXISTS. loadSeason() used to open the board by firing ten paged
// table reads from the BROWSER straight at Supabase — ~14 round trips, four in
// flight at a time. The MLB lab never did this: it reads through api/ behind a
// cache, which is why its traffic shows up as a handful of small server-side
// calls while NFL's showed up as hundreds of chunked responses to a browser.
//
// On 2026-09-08 the shared instance spent six hours I/O-throttled after ~3,500
// requests in four hours against a 111/hr baseline. The bytes were not the
// problem — the bundle is only ~0.34 MB gzipped — the REQUEST COUNT was. This
// route turns one board load into one request, and lets the CDN answer most of
// them without touching Supabase at all.
//
// CACHING, in three tiers:
//   1. CDN (s-maxage) — the real win. Repeat loads inside the window never
//      reach this function, so they cost Supabase nothing at all.
//   2. stale-while-revalidate — a viewer after expiry gets the stale copy
//      instantly while one background request refreshes it. Nobody ever waits
//      on the ten table reads.
//   3. In-process memory — covers a warm instance whose CDN entry has expired.
//
// 30 minutes is set by how fast the underlying data actually moves:
// player_week_stats changes when a game finishes, profiles and games less
// often. Live odds are NOT in here — they move in minutes and stay on their own
// path (and are only ~0.02 MB gzipped, so they were never the cost).
//
// Payload: 3.36 MB raw / 0.34 MB gzipped, measured 2026-09-08. Vercel caps a
// function response at 4.5 MB, so this fits with room; if a future season pushes
// it close, split player_week_stats onto its own route rather than trimming
// columns blind — the flip fallbacks read more of them than you would guess.

import { pkOrder } from "../src/lib/tableKeys.js";

const SCHEMA = "nfl";
const PAGE = 1000;

// [table, extra filter]; each pages in full-primary-key order (pkOrder). The
// season-filtered ones are exactly the tables loadSeason only ever reads one
// season of; player_week_stats and player_profiles deliberately stay unfiltered
// because the season-flip fallbacks (logWeeksByPlayer, latestProfiles) read
// prior seasons.
const TABLES = (season) => [
  ["player_week_stats", ""],
  ["players", ""],
  ["player_profiles", ""],
  ["player_season_agg", `&season=eq.${season}`],
  ["player_scheme_splits", `&season=eq.${season}`],
  ["games", `&season=eq.${season}`],
  ["team_defense_scheme", `&season=eq.${season}`],
  ["team_offense_profile", `&season=eq.${season}`],
  ["teams", ""],
];

const TTL_MS = 30 * 60 * 1000;
// season -> { at, payload }. Survives across invocations on a warm Vercel
// instance. It will NEVER hit in `vite dev`: devApiPlugin re-imports this module
// with a cache-busting `?t=` on every request, so each call gets a fresh
// module. X-Cache: miss locally is expected, not a bug to chase.
const _mem = new Map();

function getEnv(name) {
  const v = globalThis.process?.env?.[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

/**
 * Page one table, ordered on its WHOLE primary key. OFFSET paging with no ORDER
 * BY is not merely slow, it is WRONG — Postgres promises no ordering between two
 * unordered scans, so a row can land on two pages or none — and ordering on the
 * leading PK column alone is the same bug among its ties (see tableKeys.js).
 */
async function selectAll(url, headers, table, filter) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(
      `${url}/rest/v1/${table}?select=*${filter}&order=${pkOrder(table)}&limit=${PAGE}&offset=${from}`,
      { headers },
    );
    if (!res.ok) {
      // Optional tables (player_profiles predates part of the app, the season
      // tables are empty before a flip) must not take the board down with them.
      throw new Error(`${table}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    }
    const batch = await res.json();
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}

async function buildBundle(season) {
  const url = getEnv("SUPABASE_URL");
  const key = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Accept-Profile": SCHEMA,
  };

  const specs = TABLES(season);
  const out = {};
  // Four at a time, matching the client's old mapLimit. Ten parallel full-table
  // reads at once is the burst that used to trip the statement timeout, and
  // moving the reads server-side does not change what the database feels.
  const LIMIT = 4;
  let next = 0;
  async function worker() {
    while (next < specs.length) {
      const [table, filter] = specs[next++];
      try {
        out[table] = await selectAll(url, headers, table, filter);
      } catch (e) {
        // A missing/empty optional table yields [] rather than failing the
        // bundle — the board renders from priors at a season flip.
        if (table === "player_profiles" || filter) out[table] = [];
        else throw e;
      }
    }
  }
  await Promise.all(Array.from({ length: LIMIT }, worker));
  return out;
}

export default async function handler(req, res) {
  const season = Number(req.query?.season) || new Date().getFullYear();

  try {
    const hit = _mem.get(season);
    let payload;
    if (hit && Date.now() - hit.at < TTL_MS) {
      payload = hit.payload;
      res.setHeader("X-Cache", "mem");
    } else {
      payload = await buildBundle(season);
      _mem.set(season, { at: Date.now(), payload });
      res.setHeader("X-Cache", "miss");
    }

    // The CDN directive is the point of this route. `public` is safe: the
    // bundle is the same for every viewer and carries nothing user-specific.
    res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=86400");
    res.setHeader("Content-Type", "application/json");
    res.status(200).json({ season, fetchedAt: new Date().toISOString(), tables: payload });
  } catch (e) {
    // No cache on an error, or the CDN would pin the failure for half an hour.
    res.setHeader("Cache-Control", "no-store");
    res.status(500).json({ error: String(e?.message || e) });
  }
}
