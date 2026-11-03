// ── Lab status line + Model Refresh ──────────────────────────────────────────
// The header's operations read, the same block on the NFL, NBA and NHL labs:
//   · Odds API credits — the shared key's month, and what THIS lab spent today
//     and this month (odds_credit_log, one row per live pull)
//   · odds  — the last pull, and the next scheduled one
//   · model — the last time the pipeline re-projected and froze its picks, and
//     the next scheduled run
// and the Model Refresh button, which buys fresh odds and re-runs the model on
// demand behind a password. Everything comes from /api/lab → lab_status() /
// lab_refresh() in the shared Supabase (Postgres functions, not in this copy): the schedule, the
// password check and the throttle all live there, none of it here.
import { useEffect, useRef, useState } from "react";
import { S, C, alpha } from "../lib/theme.js";
import { RESERVE, n, clock, rel, nextRun } from "../lib/labStatus.js";

const B = ({ children, color }) => <b style={{ color: color || C.txt, fontWeight: 600 }}>{children}</b>;

/**
 * The two-column status read. `lab` is useLab()'s state; `dataAt` (a Date) is
 * when the page's data loaded. A job still on GitHub's cron, which delivers
 * late, says so in its own schedule label. The header draws it twice — inline,
 * and as its own row under the bar — and index.css shows one by width.
 */
export function LabStatus({ lab, dataAt, onReload, className }) {
  const { status } = lab;
  if (!status) return null;
  const nextOdds = nextRun(status.schedule, "odds");
  const nextModel = nextRun(status.schedule, "model");
  const c = status.credits || {};
  const low = c.remaining != null && c.remaining < RESERVE;
  const fresher = dataAt && status.last_model && Date.parse(status.last_model) > dataAt.getTime() + 60_000;
  const nextTip = (x) => (x ? `next: ${x.label}, ${new Date(x.at).toLocaleString("en-US")} (${rel(x.at)})` : "nothing scheduled in the next 8 days");
  return (
    <div style={S.hStatus} className={className}>
      <div title={`Shared Odds API key (NFL / NBA / NHL) — 20,000 a month, resets on the 1st. Pulls stop at a ${n(RESERVE)} reserve. As of ${c.as_of ? new Date(c.as_of).toLocaleString("en-US") : "?"}.`}>
        <div>odds api <B color={low ? C.bad : null}>{n(c.used)}</B> used · <B color={low ? C.bad : null}>{n(c.remaining)}</B> left</div>
        <div>{lab.name} <B>{n(status.lab_today)}</B> today · <B>{n(status.lab_month)}</B> this month</div>
      </div>
      <div>
        <div title={`Last paid odds pull: ${status.last_odds ? `${new Date(status.last_odds).toLocaleString("en-US")} (${rel(status.last_odds)})` : "none"}\n${nextTip(nextOdds)}`}>
          odds <B>{clock(status.last_odds)}</B> · next <B>{clock(nextOdds?.at)}</B>
        </div>
        <div title={`Model last re-projected and froze its picks: ${status.last_model ? `${new Date(status.last_model).toLocaleString("en-US")} (${rel(status.last_model)})` : "never"}\n${nextTip(nextModel)}`}>
          model <B>{clock(status.last_model)}</B> · next <B>{clock(nextModel?.at)}</B>
          {fresher && !lab.pending && (
            <button onClick={onReload} style={{ ...S.tag(alpha(C.accent, 0.12), C.accent), marginLeft: 6, border: "none", cursor: "pointer" }}
              title="A model run landed after this page loaded">new ↻</button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The Model Refresh button and its password popover. */
export function ModelRefresh({ lab }) {
  const { status, pending, note, start } = lab;
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const box = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const submit = async (e) => {
    e.preventDefault();
    if (!pw || busy) return;
    setBusy(true); setMsg(null);
    const r = await start(pw);
    setBusy(false);
    if (r.ok) { setPw(""); setOpen(false); } else setMsg(r.message || r.error || "Could not start the run.");
  };

  const ready = status?.refresh_ready !== false;
  const cost = status?.avg_pull ? `about ${n(status.avg_pull)} credits` : "Odds API credits";
  return (
    <div ref={box} style={{ position: "relative" }}>
      <button style={{ ...S.btn, opacity: pending ? 0.75 : 1 }} onClick={() => { setOpen((o) => !o); setMsg(null); }}
        title={pending ? `Refresh running since ${clock(pending)}` : "Buy fresh odds and re-run the model (password)"}>
        <span style={{ display: "inline-block", animation: pending ? "spin 1s linear infinite" : "none" }}>↻</span>
        <span className="hdr-refresh-label">{pending ? "Refreshing…" : "Model Refresh"}</span>
      </button>
      {open && (
        <form onSubmit={submit} style={S.popover}>
          <div style={{ ...S.cardTitle, marginBottom: 6 }}>Model Refresh</div>
          {pending ? (
            <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>
              Running since {clock(pending)} ({rel(pending)}). This page reloads when the model run lands.
            </div>
          ) : (
            <>
              <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5, marginBottom: 10 }}>
                Buys fresh odds ({cost}, from the shared key) and re-runs the model now. Takes 2–6 minutes.
              </div>
              {!ready && (
                <div style={{ fontSize: 11, color: C.warn, marginBottom: 8 }}>
                  Not connected yet: this lab&rsquo;s GitHub dispatch token is missing in Supabase.
                </div>
              )}
              <input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password"
                autoComplete="off" style={{ ...S.searchIn, width: "100%", boxSizing: "border-box", marginBottom: 8 }} />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" style={S.btnGhost} onClick={() => setOpen(false)}>Cancel</button>
                <button type="submit" style={{ ...S.btn, opacity: !pw || busy || !ready ? 0.5 : 1 }} disabled={!pw || busy || !ready}>
                  {busy ? "Starting…" : "Run"}
                </button>
              </div>
            </>
          )}
          {msg && <div style={{ fontSize: 11, color: C.bad, marginTop: 8 }}>{msg}</div>}
        </form>
      )}
      {note && !open && (
        <div role="status" style={{ ...S.popover, padding: "8px 12px", fontSize: 11, color: note.ok ? C.good : C.bad }}>
          {note.text}
        </div>
      )}
    </div>
  );
}
