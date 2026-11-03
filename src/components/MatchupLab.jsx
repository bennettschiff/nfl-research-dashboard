// ── Matchup Lab — any player vs any defense ──────────────────────────────────
// Two pickers and a panel. The old version used a native `size={8}` multi-line
// <select> as its player list, which cannot be styled, ignores the palette, and
// on a Mac renders a white box in the middle of a dark app. It is a proper
// scrollable result list now, and the defense picker shows the scheme it is
// selecting rather than making you pick blind.
import { useMemo, useState } from "react";
import { isProjectable } from "../lib/playerPriors.js";
import { hasRole, roleScore } from "../lib/roster.js";
import { COV_KEYS, S, C, MON, POS_COLORS, readable, alpha } from "../lib/theme.js";
import { pct } from "../lib/format.js";
import { Tag, CoverageArsenal, Empty, Headshot } from "./ui.jsx";
import { headshotOf, logoOf } from "../lib/headshots.js";
import { PlayerPanel } from "./PlayerPanel.jsx";

export function MatchupLab({ d }) {
  const skill = useMemo(
    () => d.season.filter((s) => hasRole(s) && isProjectable(s)).sort((a, b) => roleScore(b) - roleScore(a)),
    [d]);
  const [pid, setPid] = useState(skill[0]?.player_id);
  const [opp, setOpp] = useState(() => d.teamList[0]?.team_abbr || "DEN");
  const [q, setQ] = useState("");

  const filtered = useMemo(() => skill.filter((s) =>
    (d.players[s.player_id]?.full_name || "").toLowerCase().includes(q.toLowerCase())).slice(0, 150),
    [skill, q, d.players]);

  const def = d.defense[opp];

  return (
    <div>
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(288px,1fr))", marginBottom: 12 }}>
        {/* player picker */}
        <div style={{ ...S.card, marginBottom: 0 }}>
          <div style={S.cardHead}>
            <div style={S.cardTitle}>Offensive Player</div>
            <span style={S.cardMeta}>{filtered.length} shown</span>
          </div>
          <div style={S.searchWrap}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search player…" style={S.searchIn} />
          </div>
          <div style={{ maxHeight: 226, overflowY: "auto" }}>
            {filtered.length === 0 && (
              <div style={{ padding: 16, textAlign: "center", color: C.muted, fontSize: 12 }}>No match.</div>
            )}
            {filtered.map((s) => {
              const on = s.player_id === pid;
              return (
                <button key={s.player_id} onClick={() => setPid(s.player_id)} className="row-hover"
                  style={{
                    display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
                    padding: "5px 12px", border: "none", background: on ? alpha(C.accent, 0.12) : "transparent",
                    borderLeft: `3px solid ${on ? C.accent : "transparent"}`,
                    borderBottom: `1px solid ${C.lineSoft}`, color: on ? C.txt : C.muted, fontSize: 12,
                  }}>
                  <Headshot src={headshotOf(d, s.player_id)} logo={logoOf(d, s.team_abbr)}
                    name={d.players[s.player_id]?.full_name} size={28} />
                  <Tag color={POS_COLORS[s.position]}>{s.position}</Tag>
                  <span style={{ flex: 1, fontWeight: on ? 700 : 500, overflow: "hidden",
                    textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {d.players[s.player_id]?.full_name || s.player_id}
                  </span>
                  <span style={{ fontSize: 10, fontFamily: MON, color: readable(d.teams[s.team_abbr]?.color) }}>
                    {s.team_abbr}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* defense picker */}
        <div style={{ ...S.card, marginBottom: 0 }}>
          <div style={S.cardHead}>
            <div style={S.cardTitle}>
              Opponent Defense
              {d.teams[opp]?.logo && <img src={d.teams[opp].logo} alt="" style={{ width: 18, height: 18 }} />}
            </div>
            <select value={opp} onChange={(e) => setOpp(e.target.value)} style={S.select}>
              {d.teamList.slice().sort((a, b) => a.team_abbr.localeCompare(b.team_abbr)).map((t) => (
                <option key={t.team_abbr} value={t.team_abbr}>{t.team_abbr} — {t.full_name}</option>
              ))}
            </select>
          </div>
          <div style={S.cardBody}>
            {def ? (
              <>
                <div style={{ ...S.sectionLabel, marginBottom: 8 }}>{opp} coverage arsenal</div>
                <CoverageArsenal def={def} covKeys={COV_KEYS} />
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 12 }}>
                  {/* A trait with no value is dropped, not rendered as "— MAN".
                      Several of these are genuinely absent at a season flip. */}
                  {[[C.bad, def.man_rate, "MAN"], [C.accent, def.zone_rate, "ZONE"],
                    [C.warn, def.blitz_rate, "BLITZ"], [C.purple, def.pressure_rate, "PRESSURE"],
                    [C.good, def.heavy_box_rate, "HEAVY BOX"]]
                    .filter(([, v]) => v != null)
                    .map(([col, v, label]) => <Tag key={label} color={col}>{pct(v)} {label}</Tag>)}
                </div>
              </>
            ) : <div style={{ color: C.muted, fontSize: 12 }}>No scheme profile for {opp}.</div>}
          </div>
        </div>
      </div>

      {pid ? <PlayerPanel d={d} playerId={pid} oppAbbr={opp} /> : <Empty>Pick a player to project.</Empty>}
    </div>
  );
}
