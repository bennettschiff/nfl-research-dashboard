// ── loadLiveOdds paging ──────────────────────────────────────────────────────
// Two behaviours that were each a live bug, and neither of which any other test
// would notice, because a half-loaded market renders perfectly happily.
import { describe, expect, it, vi, beforeEach } from "vitest";

// supabase.js builds its client from import.meta.env at module scope, so it is
// mocked rather than configured. The mock is a query builder that records the
// call chain and resolves to whatever the current scenario says.
const calls = [];
let respond = () => ({ data: [], error: null });

vi.mock("./supabase.js", () => {
  const builder = () => {
    const state = { table: null, filters: {}, gt: null, limit: null };
    const b = {
      from(t) { state.table = t; return b; },
      select() { return b; },
      eq(k, v) { state.filters[k] = v; return b; },
      in(k, v) { state.filters[k] = v; return b; },
      gt(k, v) { state.gt = [k, v]; return b; },
      order() { return b; },
      limit(n) { state.limit = n; return b; },
      then(resolve, reject) {
        calls.push({ ...state });
        return Promise.resolve(respond(calls.length - 1)).then(resolve, reject);
      },
    };
    return b;
  };
  return { supabase: { from: (t) => builder().from(t) } };
});

const { loadLiveOdds } = await import("./loadData.js");

const rows = (n, prefix) =>
  Array.from({ length: n }, (_, i) => ({ row_key: `${prefix}${String(i).padStart(4, "0")}`, odds: -110 }));

beforeEach(() => {
  calls.length = 0;
  respond = () => ({ data: [], error: null });
});

describe("loadLiveOdds", () => {
  it("pages by the last row_key, never by an offset", async () => {
    // Two full pages then a short one. The index that makes this query fast is
    // (season, snapshot_kind, row_key), and the planner can only use it when
    // the page is expressed as `row_key > $last` — an OFFSET rewrite costs a
    // Seq Scan plus a top-N sort and puts the statement timeouts back.
    respond = (i) => ({ data: i < 2 ? rows(1000, `p${i}-`) : rows(7, "p2-"), error: null });

    const out = await loadLiveOdds(2026, "live", ["fanduel"]);

    expect(out).toHaveLength(2007);
    expect(calls).toHaveLength(3);
    expect(calls[0].gt).toBeNull();                       // first page has no cursor
    expect(calls[1].gt).toEqual(["row_key", "p0-0999"]);  // last key of page 1
    expect(calls[2].gt).toEqual(["row_key", "p1-0999"]);  // last key of page 2
    expect(calls.every((c) => c.limit === 1000)).toBe(true);
  });

  it("retries a statement timeout rather than ending the walk", async () => {
    // 57014 is what the live board was actually getting.
    const timeout = { message: "canceling statement due to statement timeout" };
    let n = 0;
    respond = () => (++n === 1 ? { data: null, error: timeout } : { data: rows(3, "ok-"), error: null });

    await expect(loadLiveOdds(2026, "live", ["fanduel"])).resolves.toHaveLength(3);
    expect(n).toBe(2);
  });

  it("THROWS rather than returning a half-loaded market", async () => {
    // The old loop returned the rows it happened to have. A row with no market
    // on it gets a synthetic line and a DIFF near +6 that floats it to the top
    // of a DIFF-sorted board, so a truncated market does not look broken — it
    // looks like edge. Failing loudly is the point.
    const timeout = { message: "canceling statement due to statement timeout" };
    respond = (i) => (i === 0 ? { data: rows(1000, "p0-"), error: null } : { data: null, error: timeout });

    await expect(loadLiveOdds(2026, "live", ["fanduel"])).rejects.toThrow(/1000 rows in hand/);
  });

  it("still degrades to [] when the table is not there yet", async () => {
    // Before the week's pull there are no rows, and the board must render its
    // projections anyway. That is absence, not failure.
    respond = () => ({ data: null, error: { message: 'relation "live_odds" does not exist' } });
    await expect(loadLiveOdds(2026, "live", ["fanduel"])).resolves.toEqual([]);
  });
});
