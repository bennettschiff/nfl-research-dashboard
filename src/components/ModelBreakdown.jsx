// ── Model breakdown ──────────────────────────────────────────────────────────
// Replaces the flat key/value dump behind the "factors" button. That view showed
// every input and no STRUCTURE, so you could not see that a receiving projection
// is two chains multiplied —
//
//     (targets/g x game script x pace x vacancy) x (yd/target x coverage x def strength)
//
// nor which term actually moved the number. This draws the chain models.js
// evaluates, with a running total that lands on the shipped mean
// (src/lib/breakdown.js, reconciled against the real model in its test).
//
// The headline is the DOMINANT step: of everything the model did, what mattered.
// Steps are compared in final units, so a volume multiplier and an efficiency
// multiplier are ranked on the same scale.
import { breakdownFor, dominantStep } from "../lib/breakdown.js";
import { S, C, MON, alpha } from "../lib/theme.js";
import { Tag } from "./ui.jsx";

const sign = (v, digits = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}`;

function Step({ s, unit }) {
  const up = s.delta > 0;
  const col = s.neutral ? C.faintest : up ? C.good : C.bad;
  return (
    <div title={s.hint} style={{
      display: "grid", gridTemplateColumns: "1fr 64px 74px", gap: 8, alignItems: "center",
      padding: "4px 0", opacity: s.neutral ? 0.55 : 1,
    }}>
      <span style={{ fontSize: 11, color: C.muted }}>
        {s.label}
        {s.neutral && <span style={{ fontSize: 9, marginLeft: 6, color: C.faintest }}>no read</span>}
      </span>
      <span style={{ fontFamily: MON, fontSize: 12, textAlign: "right", color: col }}>{s.pct}</span>
      <span style={{ fontFamily: MON, fontSize: 11, textAlign: "right", color: C.txt }}>
        {s.after.toFixed(2)} <span style={{ color: C.faintest, fontSize: 9 }}>{unit}</span>
      </span>
    </div>
  );
}

function Leg({ leg }) {
  return (
    <div style={{ background: alpha(C.panelSolid, 0.6), border: `1px solid ${C.line}`, borderRadius: 8, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span style={S.sectionLabel}>{leg.name}</span>
        <span style={{ fontFamily: MON, fontSize: 15, fontWeight: 800 }}>
          {leg.total.toFixed(2)} <span style={{ fontSize: 9, color: C.faintest, fontWeight: 400 }}>{leg.unit}</span>
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 64px 74px", gap: 8, padding: "4px 0",
        borderBottom: `1px solid ${C.lineSoft}`, marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: C.txt }}>{leg.baseLabel}</span>
        <span />
        <span style={{ fontFamily: MON, fontSize: 11, textAlign: "right", fontWeight: 700 }}>
          {leg.base.toFixed(2)}
        </span>
      </div>
      {leg.steps.map((s) => <Step key={s.key} s={s} unit={leg.unit} />)}
      {!leg.steps.length && (
        <div style={{ fontSize: 10, color: C.faintest, padding: "4px 0" }}>No adjustments applied.</div>
      )}
    </div>
  );
}

export function ModelBreakdown({ prop }) {
  const bd = breakdownFor(prop);

  // Props with no chain defined (receptions, rush_att, TDs) keep the old flat
  // view — better an unstructured list than a wrong structure.
  if (!bd) return <FactorList factors={prop.factors} />;

  const dom = dominantStep(bd);
  return (
    <div className="fade-in" style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.line}` }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 10 }}>
        {bd.legs.map((l) => <Leg key={l.name} leg={l} />)}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: C.muted, fontFamily: MON }}>
          {bd.legs.map((l) => l.total.toFixed(2)).join(" × ")} =
        </span>
        <span style={{ fontFamily: MON, fontSize: 16, fontWeight: 800 }}>{bd.total.toFixed(1)}</span>
        {dom && (
          <Tag color={dom.signed > 0 ? C.good : C.bad} title={`${dom.leg}: ${dom.hint}`}>
            BIGGEST MOVER: {dom.label} {sign(dom.signed)}
          </Tag>
        )}
      </div>

      <details style={{ marginTop: 8 }}>
        <summary style={{ fontSize: 10, color: C.faintest, cursor: "pointer" }}>all raw factors</summary>
        <FactorList factors={prop.factors} />
      </details>
    </div>
  );
}

/** The original flat dump — still the right fallback for props with no chain. */
function FactorList({ factors }) {
  if (!factors) return null;
  return (
    <div style={{ marginTop: 8, fontSize: 11, display: "grid",
      gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: "4px 14px" }}>
      {Object.entries(factors).filter(([, v]) => v != null).map(([k, v]) => (
        <div key={k} style={{ display: "flex", justifyContent: "space-between", color: C.muted }}>
          <span>{labelize(k)}</span>
          <span style={{ color: C.txt, fontFamily: MON }}>{fmtFactor(k, v)}</span>
        </div>
      ))}
    </div>
  );
}

function labelize(k) {
  return k.replace(/Mult$/, "").replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
}
function fmtFactor(k, v) {
  if (typeof v === "string") return v;
  if (typeof v !== "number") return String(v);
  if (/Mult$/.test(k) && v > 0 && v < 2) return `${v > 1 ? "+" : ""}${((v - 1) * 100).toFixed(0)}%`;
  if (/Rate|Share|Pct$/.test(k) && v >= 0 && v <= 1) return `${(v * 100).toFixed(1)}%`;
  return v;
}
