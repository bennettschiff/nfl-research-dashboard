// SchiffPicks lab switcher — the logo button in the header opens a dropdown to
// hop between the sport labs (MLB / WNBA / NFL / NHL / NBA) that share the schiffpicks.com
// domain. Each lab is its own Vercel project + subdomain; this is purely a
// cross-link, no shared state. Unwired sports (no subdomain yet) render disabled
// with a "soon" badge so there are never dead links.
//
// This is the NFL copy of the switcher: `current` is flipped to nfl so every
// other sport is a live link out. Keep the SPORTS list in sync with the WNBA
// lab's src/components/SportSwitcher.jsx — only `current` differs.
import { useState, useEffect, useRef } from "react";
import { C, alpha } from "../lib/theme.js";

const SPORTS = [
  { key: "mlb",  emoji: "⚾", label: "MLB",  sub: "Research", url: "https://schiffpicks.com",      status: "live",      wired: true, current: false },
  { key: "wnba", emoji: "🏀", label: "WNBA", sub: "Research", url: "https://wnba.schiffpicks.com", status: "live",      wired: true, current: false },
  { key: "nfl",  emoji: "🏈", label: "NFL",  sub: "Research", url: "https://nfl.schiffpicks.com",  status: "offseason", wired: true, current: true  },
  { key: "nhl",  emoji: "🏒", label: "NHL",  sub: "Research", url: "https://nhl.schiffpicks.com",  status: "offseason", wired: true, current: false },
  { key: "nba",  emoji: "🏀", label: "NBA",  sub: "Research", url: "https://nba.schiffpicks.com",  status: "live", wired: true, current: false },
];

const CURRENT_EMOJI = (SPORTS.find((s) => s.current) || SPORTS[0]).emoji;

export default function SportSwitcher({ isMobile = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const size = isMobile ? 28 : 36;

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Switch sport lab"
        style={{
          width: size, height: size, borderRadius: 10,
          background: open ? "linear-gradient(135deg, #3b82f6, #1d4ed8)" : "linear-gradient(135deg, #4a9eff, #2563eb)",
          border: open ? "1px solid rgba(74,158,255,0.6)" : "1px solid transparent",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: isMobile ? 14 : 18, fontWeight: 700, color: "#fff", cursor: "pointer",
          boxShadow: open ? "0 0 0 3px rgba(74,158,255,0.2)" : "none",
        }}
      >{CURRENT_EMOJI}</button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 8px)", left: 0,
          background: alpha(C.panelSolid, 0.97), backdropFilter: "blur(20px)",
          border: `1px solid ${alpha(C.accent2, 0.25)}`, borderRadius: 12,
          boxShadow: `0 16px 48px ${alpha(C.shadow, 0.6)}`, padding: 6, minWidth: 210, zIndex: 999,
        }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: C.faint, letterSpacing: 1, textTransform: "uppercase", padding: "4px 10px 8px" }}>
            SchiffPicks Labs
          </div>
          {SPORTS.map((s) => {
            const navigable = s.wired && !s.current;
            const inner = (
              <>
                <span style={{ fontSize: 18, lineHeight: 1, opacity: navigable || s.current ? 1 : 0.5 }}>{s.emoji}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: s.current ? C.accent2 : navigable ? C.txt : C.faint }}>
                    {s.label} <span style={{ fontSize: 10, fontWeight: 400, color: C.faint }}>{s.sub}</span>
                  </div>
                </div>
                <span style={{
                  fontSize: 8, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", padding: "2px 6px", borderRadius: 4,
                  background: s.status === "live" ? alpha(C.good, 0.15) : alpha(C.line, 0.3),
                  color: s.status === "live" ? C.good : C.faint,
                  border: `1px solid ${s.status === "live" ? alpha(C.good, 0.25) : alpha(C.line, 0.4)}`,
                }}>
                  {s.current ? "here" : s.status}
                </span>
              </>
            );
            const baseStyle = {
              display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
              borderRadius: 8, textDecoration: "none", marginBottom: 2, transition: "background 0.12s",
              background: s.current ? alpha(C.accent2, 0.1) : "transparent",
              border: s.current ? `1px solid ${alpha(C.accent2, 0.2)}` : "1px solid transparent",
            };
            if (!navigable) {
              return <div key={s.key} style={{ ...baseStyle, cursor: s.current ? "default" : "not-allowed" }}>{inner}</div>;
            }
            return (
              <a
                key={s.key}
                href={s.url}
                style={{ ...baseStyle, cursor: "pointer" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = alpha(C.txt, 0.04); }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                {inner}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
