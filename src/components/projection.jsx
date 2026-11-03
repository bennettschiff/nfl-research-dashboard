// ── Projection UI ────────────────────────────────────────────────────────────
// The scheme-matchup hero panel + per-prop projection cards. Pure presentation
// of the model output (math lives in lib/models.js + lib/scheme.js).
import { useState } from "react";
import { coverageMatchup, boxMatchup, pressureMatchup, LG } from "../lib/scheme.js";
import { S, C, MON, alpha } from "../lib/theme.js";
import { fmtOdds, pct, propShort } from "../lib/format.js";
import { Bar, Tag, MultTxt } from "./ui.jsx";
import { ModelBreakdown } from "./ModelBreakdown.jsx";

// ── scheme matchup panel (the hero) ──────────────────────────────────────────
export function SchemeMatchup({ season, splits, def }) {
  if (!def) return null;
  // QB → pressure/blitz panel (their rushing is scrambles, not RB box work)
  if (season.position === "QB") {
    const press = pressureMatchup(def);
    const maxP = 0.45;
    return (
      <Panel title="Pressure matchup" sub="pass game × defense's pressure & blitz" mult={press.passMult}>
        <Row2
          left={<MZBar label="PRESSURE RATE" ypt={press.defPressureRate * 100} t={`lg ${(LG.pressureRate * 100).toFixed(0)}%`} max={maxP * 100} color={C.bad} defRate={press.defPressureRate} defLabel="of dropbacks" unit="%" tunit="" />}
          right={<MZBar label="BLITZ RATE" ypt={press.defBlitzRate * 100} t={`lg ${(LG.blitzRate * 100).toFixed(0)}%`} max={maxP * 100} color={C.warn} defRate={press.defBlitzRate} defLabel="5+ rushers" unit="%" tunit="" />}
        />
        <Note>
          {press.defPressureRate > LG.pressureRate
            ? <>Pressures at <b style={{ color: C.txt }}>{pct(press.defPressureRate)}</b> (above the {pct(LG.pressureRate)} average) — passing yards shaded down (<MultTxt m={press.passMult} />), sack risk up.</>
            : <>Generates pressure at <b style={{ color: C.txt }}>{pct(press.defPressureRate)}</b> (below the {pct(LG.pressureRate)} average) — a cleaner pocket (<MultTxt m={press.passMult} /> pass yards).</>}
        </Note>
      </Panel>
    );
  }
  const isRusher = season.position === "RB" || season.position === "FB";
  if (!isRusher && splits && (splits.man_targets || splits.zone_targets)) {
    const cov = coverageMatchup(splits, def);
    const manY = splits.man_ypt, zoneY = splits.zone_ypt;
    const maxY = Math.max(manY || 0, zoneY || 0, 12);
    return (
      <Panel title="Coverage matchup" sub="receiver efficiency × defense's coverage mix" mult={cov.mult} lean={cov.lean}>
        <Row2
          left={<MZBar label="VS MAN" ypt={manY} t={splits.man_targets} max={maxY} color={C.bad} defRate={def.man_rate} defLabel="plays man" />}
          right={<MZBar label="VS ZONE" ypt={zoneY} t={splits.zone_targets} max={maxY} color={C.accent} defRate={def.zone_rate} defLabel="plays zone" />}
        />
        <Note>
          This defense plays <b style={{ color: C.txt }}>{pct(def.man_rate)} man</b> / {pct(def.zone_rate)} zone.
          Weighting his per-coverage yards/target by that mix → expected <b style={{ color: C.txt }}>{cov.expYpt} yd/target</b> vs
          his {cov.baseYpt} baseline (<MultTxt m={cov.mult} />).
        </Note>
      </Panel>
    );
  }
  if (isRusher && splits && (splits.light_box_att || splits.heavy_box_att)) {
    const box = boxMatchup(splits, def);
    const maxY = Math.max(splits.light_box_ypc || 0, splits.heavy_box_ypc || 0, 6);
    return (
      <Panel title="Box matchup" sub="rushing efficiency × defense's box counts" mult={box.mult}>
        <Row2
          left={<MZBar label="LIGHT BOX (≤6)" ypt={splits.light_box_ypc} t={splits.light_box_att} max={maxY} color={C.good} defRate={def.light_box_rate} defLabel="light box" unit="yd/carry" tunit="att" />}
          right={<MZBar label="HEAVY BOX (≥8)" ypt={splits.heavy_box_ypc} t={splits.heavy_box_att} max={maxY} color={C.warn} defRate={def.heavy_box_rate} defLabel="heavy box" unit="yd/carry" tunit="att" />}
        />
        <Note>
          This defense stacks the box (≥8) on <b style={{ color: C.txt }}>{pct(def.heavy_box_rate)}</b> of rushes and goes light (≤6) on {pct(def.light_box_rate)}.
          {box.expYpc != null
            ? <> Expected <b style={{ color: C.txt }}>{box.expYpc} yd/carry</b> vs {box.baseYpc} baseline (<MultTxt m={box.mult} />).</>
            : <> Limited box-split sample — no matchup tilt applied.</>}
        </Note>
      </Panel>
    );
  }
  return null;
}

function Panel({ title, sub, mult, lean, children }) {
  return (
    <div style={{ ...S.inset, overflow: "hidden" }}>
      <div style={{ ...S.cardHead, padding: "9px 12px", background: alpha(C.deep, 0.6) }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13 }}>{title}</div>
          <div style={{ fontSize: 10, color: C.faint }}>{sub}</div>
        </div>
        <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
          {lean && <Tag color={lean.includes("man") ? C.bad : lean.includes("zone") ? C.accent : C.faint}>{lean}</Tag>}
          {mult != null && (
            <Tag color={mult > 1.01 ? C.good : mult < 0.99 ? C.bad : C.faint}>
              {mult > 1 ? "+" : ""}{((mult - 1) * 100).toFixed(0)}% MATCHUP
            </Tag>
          )}
        </div>
      </div>
      <div style={{ padding: 12 }}>{children}</div>
    </div>
  );
}

function Row2({ left, right }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(196px,1fr))", gap: 10 }}>{left}{right}</div>;
}

function Note({ children }) {
  return <div style={{ marginTop: 12, fontSize: 12, color: C.muted, lineHeight: 1.55 }}>{children}</div>;
}

function MZBar({ label, ypt, t, max, color, defRate, defLabel, unit = "yd/target", tunit = "tgt" }) {
  return (
    <div style={{ background: alpha(C.panelSolid, 0.6), border: `1px solid ${C.line}`, borderRadius: 8, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ ...S.sectionLabel, color }}>{label}</span>
        <span style={{ fontSize: 10, color: C.faint, fontFamily: MON }}>{t || 0} {tunit}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, fontFamily: MON }}>
        {ypt != null ? ypt.toFixed(1) : "—"}
        <span style={{ fontSize: 11, color: C.muted, fontWeight: 400 }}> {unit}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
        <Bar value={ypt || 0} max={max} color={color} h={6} />
      </div>
      <div style={{ fontSize: 10, color: C.faint, marginTop: 8, fontFamily: MON }}>
        defense: <b style={{ color: C.txt }}>{pct(defRate)}</b> {defLabel}
      </div>
    </div>
  );
}

// ── projection card ──────────────────────────────────────────────────────────
export function ProjCard({ p, onTrack }) {
  const [open, setOpen] = useState(false);
  const [tracked, setTracked] = useState(null); // null | "saving" | "ok" | "err"
  const track = async (e) => {
    e.stopPropagation();
    if (!onTrack || tracked === "saving" || tracked === "ok") return;
    setTracked("saving");
    try { await onTrack(p); setTracked("ok"); }
    catch { setTracked("err"); }
  };
  return (
    // An open breakdown needs room — two multiplier chains side by side do not
    // fit a 216px grid cell, and cramming them wraps every label onto three
    // lines. The expanded card spans the whole grid row instead.
    <div style={{ ...S.inset, padding: 12, ...(open ? { gridColumn: "1 / -1" } : null) }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div>
          <div style={S.sectionLabel}>{propShort(p.prop_type, p.label)}</div>
          <div style={{ fontSize: 10, color: C.faint, fontFamily: MON, marginTop: 3 }}>line o{p.line}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 24, fontWeight: 800, fontFamily: MON, lineHeight: 1.1 }}>{p.proj_mean}</div>
          {p.proj_floor != null && (
            <div style={{ fontSize: 10, color: C.faint, fontFamily: MON }}>{p.proj_floor}–{p.proj_ceiling}</div>
          )}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Tag color={p.prob_over >= 0.5 ? C.good : C.bad}>{pct(p.prob_over)} OVER</Tag>
        <Tag color={C.faint}>FAIR {fmtOdds(p.fair_line)}</Tag>
        <div style={{ marginLeft: "auto", display: "flex", gap: 5 }}>
          {onTrack && (
            <button onClick={track} title="save this pick to the Results tracker" style={{
              ...S.btnGhost, padding: "3px 8px",
              color: tracked === "ok" ? C.good : tracked === "err" ? C.bad : C.muted,
            }}>{tracked === "ok" ? "✓ tracked" : tracked === "saving" ? "…" : tracked === "err" ? "✕ retry" : "＋ track"}</button>
          )}
          <button onClick={() => setOpen(!open)} style={{ ...S.btnGhost, padding: "3px 8px" }}>
            {open ? "hide" : "factors"}
          </button>
        </div>
      </div>
      {open && <ModelBreakdown prop={p} />}
    </div>
  );
}
