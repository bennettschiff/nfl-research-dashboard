// ── nfl_picks paging ─────────────────────────────────────────────────────────
// Both walks of the ledger — the anon fallback (walkPicks) and /api/picks — page
// by `id > last`. OFFSET there sorts offset+1000 wide rows per page and spills
// to temp; on 2026-10-12 that was the anon role's 3 s statement timeout.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PICK_LIST_COLS, PICK_PAGE } from "./pickColumns.js";

const calls = [];
let respond = () => ({ data: [], error: null });

vi.mock("./supabase.js", () => {
  const builder = () => {
    const state = { table: null, cols: null, filters: {}, gt: null, limit: null, range: null };
    const b = {
      from(t) { state.table = t; return b; },
      select(c) { state.cols = c; return b; },
      eq(k, v) { state.filters[k] = v; return b; },
      gt(k, v) { state.gt = [k, v]; return b; },
      order() { return b; },
      limit(n) { state.limit = n; return b; },
      range(a, z) { state.range = [a, z]; return b; },
      then(resolve, reject) {
        calls.push({ ...state });
        return Promise.resolve(respond(calls.length - 1)).then(resolve, reject);
      },
    };
    return b;
  };
  return { supabase: { from: (t) => builder().from(t) } };
});

const { walkPicks } = await import("./picks.js");
const { default: handler } = await import("../../api/picks.js");

// ids start at 10 and skip, like the real table after deletes — a cursor must
// come from the last ROW, not from a count.
const rows = (n, start) => Array.from({ length: n }, (_, i) => ({ id: start + i * 3 }));

beforeEach(() => {
  calls.length = 0;
  respond = () => ({ data: [], error: null });
});

describe("walkPicks (anon fallback)", () => {
  it("pages by the last id, never by an offset", async () => {
    respond = (i) => ({ data: i < 2 ? rows(PICK_PAGE, 10 + i * 5000) : rows(7, 20000), error: null });

    const out = await walkPicks(2026);

    expect(out).toHaveLength(2007);
    expect(calls).toHaveLength(3);
    expect(calls[0].gt).toBeNull();
    expect(calls[1].gt).toEqual(["id", 10 + 999 * 3]);
    expect(calls[2].gt).toEqual(["id", 5010 + 999 * 3]);
    expect(calls.every((c) => c.limit === PICK_PAGE && c.range == null)).toBe(true);
    expect(calls.every((c) => c.filters.season === 2026)).toBe(true);
  });

  it("reads the same columns /api/picks serves — not signals", async () => {
    respond = () => ({ data: rows(3, 1), error: null });
    await walkPicks(2026);
    expect(calls[0].cols).toBe(PICK_LIST_COLS);
    expect(PICK_LIST_COLS.split(",")).not.toContain("signals");
  });

  it("throws on an error rather than returning a partial ledger", async () => {
    respond = (i) => (i === 0 ? { data: rows(PICK_PAGE, 1), error: null }
      : { data: null, error: { message: "canceling statement due to statement timeout" } });
    await expect(walkPicks(2026)).rejects.toThrow(/statement timeout/);
  });
});

describe("GET /api/picks", () => {
  const urls = [];
  beforeEach(() => {
    urls.length = 0;
    vi.stubEnv("SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "k");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("pages by id=gt.<last>, never offset=", async () => {
    let n = 0;
    vi.stubGlobal("fetch", async (url) => {
      urls.push(new URL(url));
      const data = n++ < 2 ? rows(PICK_PAGE, 10 + (n - 1) * 5000) : rows(4, 20000);
      return { ok: true, status: 200, text: async () => JSON.stringify(data) };
    });
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };

    await handler({ method: "GET", query: { season: "2026" } }, res);

    expect(res.code).toBe(200);
    expect(res.body.picks).toHaveLength(2004);
    expect(urls).toHaveLength(3);
    expect(urls.every((u) => !u.searchParams.has("offset"))).toBe(true);
    expect(urls[0].searchParams.get("id")).toBeNull();
    expect(urls[1].searchParams.get("id")).toBe(`gt.${10 + 999 * 3}`);
    expect(urls[2].searchParams.get("id")).toBe(`gt.${5010 + 999 * 3}`);
    expect(urls.every((u) => u.searchParams.get("season") === "eq.2026" && u.searchParams.get("order") === "id.asc")).toBe(true);
  });

  it("retries a page the instance timed out instead of failing the walk", async () => {
    // 57014 is what a stalled shared instance answers. The retry must repeat
    // the SAME cursor — a retried page that advanced would drop 1000 picks.
    let n = 0;
    vi.stubGlobal("fetch", async (url, init) => {
      urls.push(new URL(url));
      expect(init.signal).toBeDefined();               // every read has a deadline
      n += 1;
      if (n === 2) return { ok: false, status: 500, text: async () => '{"code":"57014","message":"canceling statement due to statement timeout"}' };
      const data = n === 1 ? rows(PICK_PAGE, 1) : rows(5, 9000);
      return { ok: true, status: 200, text: async () => JSON.stringify(data) };
    });
    const res = { setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };

    await handler({ method: "GET", query: { season: "2026" } }, res);

    expect(res.code).toBe(200);
    expect(res.body.picks).toHaveLength(PICK_PAGE + 5);
    expect(urls).toHaveLength(3);
    expect(urls[1].searchParams.get("id")).toBe(urls[2].searchParams.get("id"));
  });
});
