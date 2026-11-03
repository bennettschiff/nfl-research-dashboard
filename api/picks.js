// ── /api/picks — serverless relay for nfl_picks ──────────────────────────────
// The browser reads picks directly via the anon key, but WRITES go through here
// so the service-role key never ships to the client. Mirrors the MLB lab's
// api/picks.js. Runs in dev via the devApiPlugin in vite.config.js.
//
//   GET   /api/picks?season=2026&week=3   → every pick (optional filters: outcome,
//                                          official=1, plays=1 — the official card
//                                          plus every game-line pick), paged
//                                          server-side and CDN-cached 5 minutes
//   POST  /api/picks   body: pick | [picks] → insert, returns the rows
//   PATCH /api/picks?id=123  body: { outcome, actual } → grade a pick
import { PICK_LIST_COLS, PICK_PAGE } from "../src/lib/pickColumns.js";
import { sbRequest } from "../scripts/lib/sb.mjs";

const TABLE = "nfl_picks";
// src/lib/gameMarkets.js GAME_PROPS, restated: this function must not import the
// engine's bundled JSON to learn four strings.
const GAME_MARKETS = ["spread", "total", "moneyline", "team_total"];

// A READ gets a deadline and two quick retries. The shared instance stalls in
// bursts that have nothing to do with this table: on 2026-10-12, while a board
// load had ~20 reads in flight, five statements that normally run in
// milliseconds hit their statement timeouts inside the same 26 seconds — one of
// them a keyset page of this walk, which turned the whole response into a 500.
// A bare fetch also has no deadline, so a connection that never answers holds
// the function open. 15 s sits well above the service role's 8 s statement
// timeout, so a page that is merely slow still lands; a retried GET repeats the
// same cursor and reads the same rows. Writes keep the plain fetch — an insert
// that timed out on our side may still commit.
const READ_TIMEOUT_MS = 15_000;
const READ_BACKOFF_MS = [1_000, 3_000];

function getEnv(name) {
  const v = globalThis.process?.env?.[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

function parseBody(body) {
  if (body == null) return null;
  if (typeof body === "string") return body.length ? JSON.parse(body) : null;
  return body;
}

async function relay(method, query = "", body) {
  const url = getEnv("SUPABASE_URL");
  const key = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const qs = query ? `?${query}` : "";
  const init = {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      // nfl_picks lives in the `nfl` schema of the shared host project.
      "Accept-Profile": "nfl",
      "Content-Profile": "nfl",
      Prefer: method === "PATCH" ? "return=representation" : "return=representation",
    },
    body: body == null ? undefined : JSON.stringify(body),
  };
  const target = `${url}/rest/v1/${TABLE}${qs}`;
  const res = method === "GET"
    ? await sbRequest(target, init, { label: `GET nfl.${TABLE}`, timeoutMs: READ_TIMEOUT_MS, backoff: READ_BACKOFF_MS })
    : await fetch(target, init);
  if (res.status === 204) return { status: 204, data: null };
  const text = await res.text();
  if (!res.ok) throw new Error(text || `Supabase request failed (${res.status})`);
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

export default async function handler(req, res) {
  try {
    const q = req.query || {};
    if (req.method === "GET") {
      // A season is ~16 games × ~45 picks a week, well past PostgREST's
      // 1000-row page, so page here: one request from the browser however large
      // the ledger grows. KEYSET on the PK (`id > last`), never OFFSET — see
      // walkPicks in src/lib/picks.js for the measured reason.
      const filters = [`select=${PICK_LIST_COLS}`, "order=id.asc", `limit=${PICK_PAGE}`];
      if (q.season) filters.push(`season=eq.${encodeURIComponent(q.season)}`);
      if (q.week) filters.push(`week=eq.${encodeURIComponent(q.week)}`);
      if (q.outcome) filters.push(`outcome=eq.${encodeURIComponent(q.outcome)}`);
      if (q.official) filters.push("official=is.true");
      // The Official Plays tab: every official pick, and every game-market pick
      // (they are on probation, so none is official yet, and the tab shows the
      // engine's in-band ones as tracked). ~30 + ~70 rows a week, not ~1,000.
      if (q.plays) filters.push(`or=(official.is.true,prop_type.in.(${GAME_MARKETS.join(",")}))`);
      const all = [];
      for (let after = null; ;) {
        const page = after == null ? filters : [...filters, `id=gt.${after}`];
        const { data } = await relay("GET", page.join("&"));
        all.push(...(data || []));
        if (!data || data.length < PICK_PAGE) break;
        after = data[data.length - 1].id;
      }
      // The ledger moves when a snapshot or a grading pass runs — a few times a
      // day — so five minutes at the CDN costs nothing in freshness and turns
      // every repeat visit into zero database reads.
      res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
      return res.status(200).json({ picks: all });
    }
    if (req.method === "POST") {
      const body = parseBody(req.body);
      const rows = Array.isArray(body) ? body : [body];
      const { data } = await relay("POST", "", rows);
      return res.status(201).json({ picks: data || [] });
    }
    if (req.method === "PATCH") {
      if (!q.id) return res.status(400).json({ error: "id required" });
      const body = parseBody(req.body);
      const { data } = await relay("PATCH", `id=eq.${encodeURIComponent(q.id)}`, body);
      return res.status(200).json({ picks: data || [] });
    }
    return res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    res.setHeader?.("Cache-Control", "no-store");
    return res.status(500).json({ error: e.message || String(e) });
  }
}
