// ── App header ───────────────────────────────────────────────────────────────
// The sticky top bar: lab switcher, title, state badges, provenance subtitle,
// the status read (credits, last / next odds pull and model run), and the
// Model Refresh control. Extracted from App.jsx so the shell stays a router.
//
// The title used to be gradient-clipped text (`WebkitTextFillColor:
// transparent`), which rendered as nothing at all — the app's own name was
// invisible on every screenshot. It is flat accent-colored text now.
//
// The theme toggle lives here, not in App: it is chrome, it owns its own state,
// and flipping it is one attribute on <html> — every color is a CSS variable
// (src/lib/theme.js), so nothing has to re-render to re-color.
//
// Model Refresh replaced the plain Refresh button (which only re-read the
// season bundle and live odds): it buys fresh odds and re-runs the pick
// snapshot behind a password, then reloads the data when the run lands.
import { useState } from "react";
import SportSwitcher from "./SportSwitcher.jsx";
import { LabStatus, ModelRefresh } from "./LabStatus.jsx";
import { useLab } from "../lib/labStatus.js";
import { S, C, MON, savedTheme, applyTheme } from "../lib/theme.js";

/**
 * `status` is the season state — "live" once games are being played, otherwise
 * the offseason build. It drives the green/amber badge, the same way the WNBA
 * lab shows IN SEASON.
 */
export function Header({ season, status, source, loadedAt, onReload, busy }) {
  const live = status === "live";
  const [theme, setTheme] = useState(savedTheme);
  const flip = () => { const t = theme === "light" ? "dark" : "light"; applyTheme(t); setTheme(t); };
  const lab = useLab("NFL", onReload);
  return (
    <header style={S.header}>
      <div style={S.hRow} className="hdr-row">
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <SportSwitcher />
          <div style={{ minWidth: 0 }}>
            <div style={S.title} className="hdr-title">
              🏈 NFL Research Dashboard
              <span style={S.badge(live ? "live" : "#64748b")}>{live ? "IN SEASON" : "OFFSEASON"}</span>
              <span style={S.badge()}>{season}</span>
            </div>
            <div style={S.subtitle} className="hdr-sub">{source}</div>
          </div>
        </div>
        <LabStatus lab={lab} dataAt={loadedAt} onReload={onReload} className="hdr-status hdr-status-inline" />
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
          {loadedAt && (
            <span className="hdr-updated" style={{ fontSize: 9, color: C.faint, fontFamily: MON }}
              title="When this page last loaded its data">
              {busy ? "loading…" : `updated ${loadedAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`}
            </span>
          )}
          <button style={S.btnGhost} onClick={flip} title={`Switch to the ${theme === "light" ? "dark" : "light"} theme`}>
            <span>{theme === "light" ? "🌙" : "☀️"}</span>
            <span className="hdr-refresh-label">{theme === "light" ? "Dark" : "Light"}</span>
          </button>
          <ModelRefresh lab={lab} />
        </div>
      </div>
      <div style={S.hRow}>
        <LabStatus lab={lab} dataAt={loadedAt} onReload={onReload} className="hdr-status hdr-status-row" />
      </div>
    </header>
  );
}
