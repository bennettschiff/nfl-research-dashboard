// ── Lab status: data + formatting for the header's status read ──────────────
// useLab() polls /api/lab (lab_status() in the shared Supabase, Postgres functions, not in this copy)
// and drives a Model Refresh this page started; components/LabStatus.jsx draws it.
import { useCallback, useEffect, useRef, useState } from "react";

const POLL_MS = 5 * 60 * 1000;      // background status refresh while the tab is visible
const RUN_POLL_MS = 20 * 1000;      // while a refresh this page started is running
const RUN_GIVE_UP_MS = 25 * 60 * 1000;
export const RESERVE = 3000;               // every lab's pull refuses to go below this

export const n = (x) => (x == null ? "—" : Number(x).toLocaleString("en-US"));

/** "9:07 AM" today, "Sat 4:07 PM" this week, "10/24 4:07 PM" before that. */
export function clock(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const t = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const days = Math.abs(Date.now() - d.getTime()) / 864e5;
  if (d.toDateString() === new Date().toDateString()) return t;
  if (days < 6) return `${d.toLocaleDateString("en-US", { weekday: "short" })} ${t}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${t}`;
}

/** "in 23m" / "3h ago". */
export function rel(iso) {
  if (!iso) return "";
  const m = Math.round((Date.parse(iso) - Date.now()) / 60000);
  const a = Math.abs(m);
  const s = a < 1 ? "now" : a < 60 ? `${a}m` : a < 1440 ? `${Math.round(a / 60)}h` : `${Math.round(a / 1440)}d`;
  return a < 1 ? "now" : m > 0 ? `in ${s}` : `${s} ago`;
}

/** One field of a 5-field cron: *, n, a,b, a-b, *\/n. */
const cronOk = (f, v) => f === "*" || f.split(",").some((p) =>
  p.startsWith("*/") ? v % +p.slice(2) === 0
    : p.includes("-") ? v >= +p.split("-")[0] && v <= +p.split("-")[1]
      : +p === v);

/** The next time a UTC cron fires after `from` (ms), as an ISO string — null if not within 8 days. */
export function cronNext(expr, from = Date.now()) {
  const [mi, hr, dom, mon, dow] = String(expr).trim().split(/\s+/);
  const t = new Date(Math.floor(from / 60000) * 60000);
  for (let i = 0; i < 8 * 1440; i++) {
    t.setTime(t.getTime() + 60000);
    if (cronOk(mi, t.getUTCMinutes()) && cronOk(hr, t.getUTCHours()) && cronOk(dom, t.getUTCDate())
      && cronOk(mon, t.getUTCMonth() + 1) && cronOk(dow, t.getUTCDay())) return t.toISOString();
  }
  return null;
}

/** The soonest scheduled job of a kind ("odds" / "model") in lab_status's `schedule`: { at, label }. */
export function nextRun(schedule, kind, from = Date.now()) {
  let best = null;
  for (const s of schedule || []) {
    if (!s.kinds?.includes(kind)) continue;
    const at = cronNext(s.cron, from);
    if (at && (!best || at < best.at)) best = { at, label: s.label };
  }
  return best;
}

/**
 * Status + refresh state for the header. `name` labels this lab's spend ("NFL");
 * `onReload` re-reads the page's data, and runs when a refresh this page
 * started has landed.
 */
export function useLab(name, onReload) {
  const [status, setStatus] = useState(null);
  const [pending, setPending] = useState(null);   // requested_at of a refresh this page started
  const [note, setNote] = useState(null);         // { ok, text } — the last refresh outcome
  const reloadRef = useRef(onReload);
  useEffect(() => { reloadRef.current = onReload; });

  const load = useCallback((bust) =>
    fetch(bust ? `/api/lab?t=${Date.now()}` : "/api/lab")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => { if (s && !s.error) setStatus(s); return s; })
      .catch(() => null), []);

  useEffect(() => {
    load();
    const tick = setInterval(() => { if (document.visibilityState === "visible") load(); }, POLL_MS);
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(tick); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  // A refresh is running: poll until the model run lands after it, then reload.
  useEffect(() => {
    if (!pending) return undefined;
    const t0 = Date.parse(pending);
    const tick = setInterval(async () => {
      const s = await load(true);
      if (!s) return;
      if (s.refresh?.http && s.refresh.http !== 204) {
        setPending(null);
        setNote({ ok: false, text: `GitHub refused the run (HTTP ${s.refresh.http}).` });
      } else if (s.last_model && Date.parse(s.last_model) >= t0) {
        setPending(null);
        setNote({ ok: true, text: `Model updated ${clock(s.last_model)}.` });
        reloadRef.current?.();
      } else if (Date.now() - t0 > RUN_GIVE_UP_MS) {
        setPending(null);
        setNote({ ok: false, text: "The run has not reported back in 25 minutes — check the workflow." });
      }
    }, RUN_POLL_MS);
    return () => clearInterval(tick);
  }, [pending, load]);

  const start = useCallback(async (password) => {
    const r = await fetch("/api/lab", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }),
    }).then((x) => x.json()).catch((e) => ({ ok: false, message: String(e.message || e) }));
    if (r.ok) { setPending(r.requested_at); setNote(null); load(true); }
    return r;
  }, [load]);

  // The outcome note stands for ten seconds.
  useEffect(() => {
    if (!note) return undefined;
    const t = setTimeout(() => setNote(null), 10_000);
    return () => clearTimeout(t);
  }, [note]);

  return { name, status, pending, note, start };
}
