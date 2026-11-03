// ── OFFSET walks order on the WHOLE primary key ──────────────────────────────
// Every OFFSET walk — api/season.js, scripts/lib/season.mjs, the nightly backup
// and loadData.js's browser fallback — must sort on a unique key, or rows tied
// on the sort can land on two pages or none. Each walker's real requests are
// captured here and their `order` compared against the primary keys PARSED OUT
// OF db/schema.sql, so reverting any of them to `order=player_id` fails, and so
// does a schema change that tableKeys.js was not told about.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { TABLE_PK, pkOf, pkOrder } from "./tableKeys.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** table -> PK columns, from `col type primary key` or `primary key (a, b)`. */
function schemaPks() {
  const sql = fs.readFileSync(path.join(ROOT, "db/schema.sql"), "utf8");
  const out = {};
  for (const m of sql.matchAll(/create table if not exists nfl\.(\w+)\s*\(([\s\S]*?)\n\);/g)) {
    const [, table, body] = m;
    const composite = body.match(/primary key\s*\(([^)]+)\)/);
    const inline = body.match(/^\s*(\w+)\s+[^,\n]*\bprimary key\b/m);
    out[table] = composite ? composite[1].split(",").map((c) => c.trim()) : inline ? [inline[1]] : null;
  }
  return out;
}

const SCHEMA_PK = schemaPks();
/** The PK a walk of `table` must sort on: schema.sql's, else tableKeys' own. */
const pkFor = (table) => SCHEMA_PK[table] ?? pkOf(table);
/** `order=player_id.asc,season.asc` -> ["player_id", "season"]. */
const orderCols = (u) => new URL(u).searchParams.get("order").split(",").map((c) => c.replace(/\.(asc|desc)$/, ""));
const tableOf = (u) => new URL(u).pathname.split("/").pop();

// supabase.js reads import.meta.env at module scope, so it is mocked: a builder
// that records every .order() column per request.
const sbCalls = [];
vi.mock("./supabase.js", () => {
  const builder = () => {
    const state = { table: null, order: [] };
    const b = {
      from(t) { state.table = t; return b; },
      select() { return b; }, eq() { return b; }, in() { return b; }, gt() { return b; },
      order(c) { state.order.push(c); return b; },
      limit() { return b; }, range() { return b; },
      then(resolve, reject) {
        sbCalls.push({ ...state, order: [...state.order] });
        return Promise.resolve({ data: [], error: null }).then(resolve, reject);
      },
    };
    return b;
  };
  return { supabase: { from: (t) => builder().from(t) } };
});

// The Node walkers go through scripts/lib/sb.mjs; record their URLs instead.
const nodeUrls = [];
vi.mock("../../scripts/lib/sb.mjs", () => ({
  sbRequest: async (url) => { nodeUrls.push(url); return { text: async () => "[]" }; },
  sbJson: async (url) => { nodeUrls.push(url); return []; },
}));

beforeEach(() => {
  sbCalls.length = 0;
  nodeUrls.length = 0;
  vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("TABLE_PK", () => {
  it("matches every primary key db/schema.sql declares", () => {
    for (const [table, pk] of Object.entries(TABLE_PK)) {
      // historical_odds has no DDL in the repo (PK `id`, read off the live
      // project); every other registered table must be in schema.sql.
      if (table === "historical_odds") continue;
      expect(SCHEMA_PK[table], `nfl.${table} in db/schema.sql`).toEqual(pk);
    }
  });

  it("covers every table schema.sql declares, so a new one cannot be paged unregistered", () => {
    expect(Object.keys(TABLE_PK).sort()).toEqual(expect.arrayContaining(Object.keys(SCHEMA_PK).sort()));
  });

  it("builds a PostgREST order over the whole key, and refuses an unknown table", () => {
    expect(pkOrder("player_week_stats")).toBe("player_id.asc,season.asc,week.asc");
    expect(() => pkOf("nope")).toThrow(/no primary key/);
  });
});

describe("api/season.js", () => {
  it("orders every table it pages on its whole primary key", async () => {
    const urls = [];
    vi.stubGlobal("fetch", async (u) => { urls.push(u); return { ok: true, json: async () => [] }; });
    const { default: handler } = await import("../../api/season.js");
    const res = { setHeader() {}, status() { return res; }, json() { return res; }, send() { return res; }, end() {} };

    await handler({ query: { season: 2091 } }, res);

    expect(urls.map(tableOf).sort()).toEqual([
      "games", "player_profiles", "player_scheme_splits", "player_season_agg", "player_week_stats",
      "players", "team_defense_scheme", "team_offense_profile", "teams",
    ]);
    for (const u of urls) expect(orderCols(u), tableOf(u)).toEqual(pkFor(tableOf(u)));
  });
});

describe("scripts/lib/season.mjs", () => {
  it("loadSeasonNode orders every OFFSET walk on the whole primary key", async () => {
    const { loadSeasonNode } = await import("../../scripts/lib/season.mjs");

    await loadSeasonNode(2091);

    const tables = nodeUrls.map(tableOf);
    expect(tables).toEqual(expect.arrayContaining(["player_week_stats", "player_profiles", "player_injuries", "live_odds"]));
    for (const u of nodeUrls) expect(orderCols(u), tableOf(u)).toEqual(pkFor(tableOf(u)));
  });

  it("keyset paging refuses a multi-column key rather than building a wrong cursor", async () => {
    const { sbClient } = await import("../../scripts/lib/season.mjs");
    await expect(sbClient().selectAll("player_week_stats", "select=*", pkOf("player_week_stats"), { keyset: true }))
      .rejects.toThrow(/one unique column/);
  });
});

describe("scripts/backup-to-drive.mjs", () => {
  it("dumps every table in its whole-primary-key order", async () => {
    const { TABLES, dumpTable } = await import("../../scripts/backup-to-drive.mjs");

    for (const [table, cfg] of Object.entries(TABLES)) {
      nodeUrls.length = 0;
      await dumpTable(table, cfg);
      expect(nodeUrls).toHaveLength(1);
      expect(orderCols(nodeUrls[0]), table).toEqual(pkFor(table));
    }
  });
});

describe("src/lib/loadData.js fallback", () => {
  it("orders every direct table read and the injury report on the whole primary key", async () => {
    // A failed /api/season sends loadSeason down the direct-read fallback.
    vi.stubGlobal("fetch", async () => ({ ok: false, json: async () => ({}) }));
    const { loadSeason } = await import("./loadData.js");

    await loadSeason(2091);

    const offsetWalks = sbCalls.filter((c) => c.table !== "live_odds");  // live_odds is keyset on row_key
    expect(offsetWalks.map((c) => c.table).sort()).toEqual([
      "games", "player_injuries", "player_profiles", "player_scheme_splits", "player_season_agg",
      "player_week_stats", "players", "team_defense_scheme", "team_offense_profile", "teams",
    ]);
    for (const c of offsetWalks) expect(c.order, c.table).toEqual(pkFor(c.table));
  });
});
