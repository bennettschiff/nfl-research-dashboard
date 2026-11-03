// ── /api/lab — the header's status line and its Model Refresh button ─────────
//
// GET  → lab_status: odds-API credit usage, the last odds pull and model run,
//        and the next scheduled run of each. CDN-cached for a minute so every
//        open board collapses to about one database call a minute.
//        `?t=` busts the cache; only the page that just started a refresh sends it.
// POST {password} → lab_refresh: the password check, throttle and workflow
//        dispatch live in Postgres functions (not included in this public copy),
//        so nothing secret is in this route or the browser bundle.
//
// Both functions are callable with the publishable (anon) key.

const SUPA = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const LAB = "nfl";

async function rpc(fn, body) {
  const r = await fetch(`${SUPA}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`${fn} → ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

export default async function handler(req, res) {
  try {
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      const out = await rpc("lab_refresh", { p_lab: LAB, p_password: String(body.password ?? "") });
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json(out);
    }
    const out = await rpc("lab_status", { p_lab: LAB });
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json(out);
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).json({ error: String(e.message || e) });
  }
}
