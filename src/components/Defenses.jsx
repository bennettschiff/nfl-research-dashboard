// ── Defenses tab ─────────────────────────────────────────────────────────────
// Extracted from App.jsx and rebuilt around what actually persists.
//
// The old tab ranked defenses by SEASON-AVERAGE man rate, coverage shell and
// EPA. build_def_priors_2026.mjs measured that most of those do not carry year
// to year — season-average man rate persists at r=0.006, box at 0.016, defensive
// pass EPA at 0.094 — so at the 2026 flip every one of them is the league mean
// and the tab rendered 32 identical rows.
//
// What DOES carry is blitz (0.538), pressure (0.417), rush EPA (0.201), and the
// SITUATIONAL deltas (median r ~0.33): who blitzes on third-and-long, who plays
// man on early downs. That is also the more interesting read. So the tab now
// leads with the carried traits, labels the league-mean placeholders as such
// rather than presenting them as measurements, and puts the situational grid —
// previously built and never rendered anywhere — in front.
import { useMemo, useState } from "react";
import SITUATIONAL from "../../scripts/out/def_situational_app.json";
import { S, C, MON, readable, alpha } from "../lib/theme.js";
import { pct } from "../lib/format.js";
import { Tag, Empty, Pill } from "./ui.jsx";

const DOWN_LABEL = { 1: "1st", 2: "2nd", 3: "3rd" };
const DIST_LABEL = { short: "short", med: "medium", long: "long" };

const TRAITS = [
  { key: "blitz", label: "Blitz", hint: "5+ pass rushers. Persists year to year at r=0.54 — the most stable defensive trait measured." },
  { key: "pressure", label: "Pressure", hint: "Share of dropbacks pressured. Persists at r=0.42." },
  { key: "is_man", label: "Man", hint: "Man coverage rate. The SEASON AVERAGE does not persist at all (r=0.006), but the situational pattern does (median r=0.33) — which is why this is shown per situation and not as a team number." },
  { key: "box", label: "Box", hint: "Defenders in the box. Season average does not persist (r=0.016)." },
];

/** Colour a delta vs league: red = does more of it, blue = less. */
function deltaColor(v, scale) {
  if (v == null) return "transparent";
  const t = Math.max(-1, Math.min(1, v / scale));
  if (t > 0) return alpha(C.bad, 0.12 + Math.abs(t) * 0.55);
  return alpha(C.accent, 0.12 + Math.abs(t) * 0.55);
}

const SCALE = { blitz: 0.12, pressure: 0.10, is_man: 0.15, box: 0.5 };

function SituationalGrid({ cells, trait }) {
  // down x distance, averaging the two shotgun looks so the grid stays readable.
  const grid = useMemo(() => {
    const acc = {};
    for (const c of cells) {
      const k = `${c.down}|${c.dist}`;
      (acc[k] ||= []).push(c);
    }
    return acc;
  }, [cells]);

  const scale = SCALE[trait];

  // The legend lives once above the grid, not inside each card — repeated 32
  // times it was more text than data.
  return (
    <div style={{ display: "grid", gridTemplateColumns: "40px repeat(3,1fr)", gap: 3, fontSize: 9 }}>
      <div />
      {["short", "med", "long"].map((d) => (
        <div key={d} style={{ textAlign: "center", ...S.sectionLabel }}>{DIST_LABEL[d]}</div>
      ))}
      {[1, 2, 3].map((down) => (
        <Row key={down} down={down} grid={grid} trait={trait} scale={scale} />
      ))}
    </div>
  );
}

function Row({ down, grid, trait, scale }) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", ...S.sectionLabel }}>{DOWN_LABEL[down]}</div>
      {["short", "med", "long"].map((dist) => {
        const cs = grid[`${down}|${dist}`] || [];
        const n = cs.reduce((a, c) => a + (c.n || 0), 0);
        const d = n ? cs.reduce((a, c) => a + (c[`${trait}_delta`] ?? 0) * (c.n || 0), 0) / n : null;
        const raw = n ? cs.reduce((a, c) => a + (c[trait] ?? 0) * (c.n || 0), 0) / n : null;
        return (
          <div key={dist}
            title={n ? `${DOWN_LABEL[down]} & ${DIST_LABEL[dist]} — ${trait === "box" ? raw?.toFixed(2) : pct(raw)} vs league ${d > 0 ? "+" : ""}${trait === "box" ? d?.toFixed(2) : `${(d * 100).toFixed(1)}pp`} · ${n} plays` : "no sample"}
            style={{
              background: deltaColor(d, scale), borderRadius: 4, padding: "6px 2px", textAlign: "center",
              fontFamily: MON, fontSize: 11, color: C.txt, border: `1px solid ${C.lineSoft}`,
            }}>
            {d == null ? "—" : trait === "box" ? d.toFixed(2) : `${d > 0 ? "+" : ""}${(d * 100).toFixed(0)}`}
          </div>
        );
      })}
    </>
  );
}

function traitField(trait) {
  return { blitz: "blitz_rate", pressure: "pressure_rate", is_man: "man_rate", box: "avg_box" }[trait];
}

export function Defenses({ d }) {
  const [trait, setTrait] = useState("blitz");
  const [dir, setDir] = useState("desc");
  const [q, setQ] = useState("");
  const active = TRAITS.find((t) => t.key === trait);

  const byTeam = useMemo(() => {
    const acc = {};
    for (const c of SITUATIONAL.cells) (acc[c.team_abbr] ||= []).push(c);
    return acc;
  }, []);

  const list = Object.values(d.defense);
  if (!list.length) return <Empty>No defensive profiles loaded for {d.year}.</Empty>;

  // Sort by how extreme the team is on the selected trait, so the tab opens on
  // something meaningful rather than alphabetically.
  const sorted = [...list]
    .sort((a, b) => ((b[traitField(trait)] ?? 0) - (a[traitField(trait)] ?? 0)) * (dir === "asc" ? -1 : 1))
    .filter((def) => {
      if (!q) return true;
      const name = d.teams[def.team_abbr]?.full_name || "";
      return def.team_abbr.toLowerCase().includes(q.toLowerCase()) || name.toLowerCase().includes(q.toLowerCase());
    });

  return (
    <div style={S.card}>
      <div style={S.cardHead}>
        <div style={S.cardTitle}>Defensive Schemes</div>
        <span style={S.cardMeta}>
          {sorted.length} teams · situational profile from {SITUATIONAL.season} · ranked by {active?.label.toLowerCase()}
        </span>
      </div>

      <div style={S.propTabs}>
        {TRAITS.map((t) => (
          <Pill key={t.key} active={trait === t.key} onClick={() => setTrait(t.key)}>{t.label}</Pill>
        ))}
        {/* This grid has no column headers to click, so the ranking carries its
            own direction control — the least-blitzing defense is as much of a
            read as the most. */}
        <button style={{ ...S.btnGhost, marginLeft: "auto" }}
          onClick={() => setDir((v) => (v === "desc" ? "asc" : "desc"))}
          title={`Ranked ${dir === "desc" ? "highest" : "lowest"} ${active?.label.toLowerCase()} first — click to reverse`}>
          {dir === "desc" ? "▼ most" : "▲ least"} {active?.label.toLowerCase()}
        </button>
      </div>

      <div style={S.searchWrap}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search team…" style={S.searchIn} />
      </div>

      <div style={{ padding: "10px 14px", borderBottom: `1px solid ${C.lineSoft}` }}>
        <div style={{ fontSize: 11, color: C.muted }}>{active?.hint}</div>
        <div style={{ fontSize: 10, color: C.faintest, marginTop: 5, display: "flex",
          alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          Each cell is {active?.label.toLowerCase()} rate vs the league in the same down &amp; distance.
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 18, height: 9, borderRadius: 2, background: deltaColor(SCALE[trait], SCALE[trait]) }} />
            more
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 18, height: 9, borderRadius: 2, background: deltaColor(-SCALE[trait], SCALE[trait]) }} />
            less
          </span>
        </div>
      </div>

      <div style={{ padding: 12, display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(272px,1fr))", gap: 10 }}>
        {sorted.map((def) => {
          const cells = byTeam[def.team_abbr] || [];
          const basis = def?.basis?.[trait === "is_man" ? "is_man" : trait];
          return (
            <div key={def.team_abbr} style={{ ...S.inset, padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                {d.teams[def.team_abbr]?.logo && (
                  <img src={d.teams[def.team_abbr].logo} alt="" style={{ width: 22, height: 22 }} />
                )}
                <b style={{ fontSize: 13, color: readable(d.teams[def.team_abbr]?.color) }}>{def.team_abbr}</b>
                <span style={{ marginLeft: "auto", display: "flex", gap: 4, flexWrap: "wrap" }}>
                  <Tag color={C.warn}>{pct(def.blitz_rate)} BLITZ</Tag>
                  {def.def_rush_epa != null && (
                    <Tag color={def.def_rush_epa < 0 ? C.good : C.bad}
                      title="Rush EPA/play allowed. Persists at r=0.20, so it is carried into 2026 at that weight.">
                      {def.def_rush_epa > 0 ? "+" : ""}{def.def_rush_epa.toFixed(3)} RU EPA
                    </Tag>
                  )}
                </span>
              </div>

              {basis && basis.trust === 0 && (
                <div style={{ fontSize: 9.5, color: C.warn, marginBottom: 8, fontFamily: MON }}>
                  league average — this trait does not carry year to year
                  {basis.r != null ? ` (r=${basis.r.toFixed(3)})` : ""}
                </div>
              )}

              {cells.length
                ? <SituationalGrid cells={cells} trait={trait} />
                : <div style={{ fontSize: 11, color: C.faintest }}>No situational profile.</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
