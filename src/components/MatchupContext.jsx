// ── Staff + scheme strip ─────────────────────────────────────────────────────
// Two cards side by side — his offense, the defense across from it — then what
// the model did with the matchup for the prop in hand. Shared by the board's
// expanded row and the player panel. All the logic is in src/lib/staffScheme.js.
import { staffFor, tendencyFor, schemeTags, boostOf, multPct } from "../lib/staffScheme.js";
import { S, C, MON, readable } from "../lib/theme.js";
import { pct } from "../lib/format.js";
import { Tag } from "./ui.jsx";

const OFF_STATS = [
  ["neutral_pass_rate", "Neutral pass rate", pct],
  ["plays_pg", "Plays / game", (v) => v?.toFixed(1)],
  ["motion_rate", "Motion", pct],
  ["play_action_rate", "Play-action", pct],
];
const DEF_STATS = [
  ["blitz_rate", "Blitz rate", pct],
  ["pressure_rate", "Pressure (PFR)", pct],
  ["stacked_box_rate", "8+ box vs run", pct],
  ["light_box_rate", "≤6 box vs run", pct],
  ["pass_epa", "EPA / dropback", (v) => (v == null ? null : `${v > 0 ? "+" : ""}${v.toFixed(2)}`)],
];

function Person({ role, name, flag, sub }) {
  if (!name) return null;
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: 11, padding: "2px 0" }}>
      <span style={{ ...S.sectionLabel, minWidth: 64 }}>{role}</span>
      <span style={{ color: C.txt, fontWeight: 600 }}>{name}</span>
      {flag && <Tag color={C.warn} title={flag.title}>{flag.text}</Tag>}
      {sub && <span style={{ fontSize: 9.5, color: C.faint, fontFamily: MON }}>{sub}</span>}
    </div>
  );
}

function SideCard({ title, color, people, t, side, note }) {
  const tags = schemeTags(t, side);
  const stats = side === "off" ? OFF_STATS : DEF_STATS;
  return (
    <div style={{ ...S.inset, padding: 12, flex: "1 1 300px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 12.5, color }}>{title}</span>
        {t && (
          <span style={{ marginLeft: "auto", fontSize: 9.5, color: C.faint, fontFamily: MON }}
            title={`Blended: ${Math.round(t.weight * 100)}% this season (${t.games} g), the rest ${t.priorSeason}. ${t.changed ? "The owner of this tendency is new, so last season is discarded fast (K=3)." : "Same staff, so last season carries (K=16)."}`}>
            {t.games} g · {Math.round(t.weight * 100)}% this yr
          </span>
        )}
      </div>
      {people}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", margin: "8px 0" }}>
        {tags.map((x) => (
          <Tag key={x.key} color={x.good === true ? C.good : x.good === false ? C.bad : C.accent}>{x.text}</Tag>
        ))}
      </div>
      {t && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(128px,1fr))", gap: "2px 12px" }}>
          {stats.map(([k, label, fmt]) => t.values[k] != null && (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, padding: "2px 0" }}
              title={`League ${fmt(t.league[k]) ?? "—"}`}>
              <span style={{ color: C.muted }}>{label}</span>
              <span style={{ fontFamily: MON, color: C.txt }}>
                {fmt(t.values[k])} <span style={{ color: C.faintest }}>/ {fmt(t.league[k])}</span>
              </span>
            </div>
          ))}
        </div>
      )}
      {note && <div style={{ fontSize: 9.5, color: C.faint, marginTop: 6, lineHeight: 1.5 }}>{note}</div>}
    </div>
  );
}

export function MatchupContext({ season, team, opp, prop, teams }) {
  const off = staffFor(season, team), def = staffFor(season, opp);
  const tOff = tendencyFor(season, team, "off"), tDef = tendencyFor(season, opp, "def");
  if (!off && !def && !tOff && !tDef) return null;
  const b = prop ? boostOf(prop, season) : null;
  const tone = (m) => (m == null || Math.abs(m - 1) < 0.005 ? C.faint : m > 1 ? C.good : C.bad);

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <SideCard title={`${team} offense`} color={readable(teams?.[team]?.color)} side="off" t={tOff}
          people={off && <>
            <Person role="Head coach" name={off.head_coach} flag={off.hc_change ? { text: "NEW", title: "New head coach for this season" } : null} />
            <Person role="OC" name={off.offensive_coordinator} />
            <Person role="Play-caller" name={off.play_caller}
              sub={off.play_caller_confidence === "inferred" ? "inferred" : null}
              flag={tOff?.changed ? { text: "NEW CALLER", title: "Play-caller changed since last season — his old team's tendencies, not this team's, are the prior" } : null} />
          </>} />
        <SideCard title={`${opp} defense`} color={readable(teams?.[opp]?.color)} side="def" t={tDef}
          people={def && <>
            <Person role="Head coach" name={def.head_coach} flag={def.hc_change ? { text: "NEW", title: "New head coach for this season" } : null} />
            <Person role="DC" name={def.defensive_coordinator} sub={`since ${def.dc_since}`}
              flag={def.dc_change ? { text: "NEW DC", title: "New defensive coordinator — last season's tendencies belong to his predecessor" } : null} />
          </>}
          note="Man/zone and coverage shells have no in-season source (participation data is published after the season), so coverage is not shown for this year." />
      </div>

      {b && (
        <div style={{ ...S.inset, padding: "8px 12px", marginTop: 10, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <span style={S.sectionLabel}>Matchup boost · {prop.label}</span>
          <span style={{ fontFamily: MON, fontSize: 12 }}>
            <span style={{ color: C.muted, fontSize: 10.5 }}>scheme{b.schemeKind ? ` (${b.schemeKind})` : ""} </span>
            <b style={{ color: tone(b.scheme) }}>{b.scheme == null ? "—" : multPct(b.scheme)}</b>
          </span>
          <span style={{ fontFamily: MON, fontSize: 12 }}>
            <span style={{ color: C.muted, fontSize: 10.5 }}>defense strength </span>
            <b style={{ color: tone(b.defense) }}>{multPct(b.defense)}</b>
          </span>
          {b.pace != null && (
            <span style={{ fontFamily: MON, fontSize: 12 }}>
              <span style={{ color: C.muted, fontSize: 10.5 }}>pace </span>
              <b style={{ color: tone(b.pace) }}>{multPct(b.pace)}</b>
            </span>
          )}
          <Tag color={tone(b.total)}>
            {Math.abs(b.total - 1) < 0.005 ? "NO BOOST" : b.total > 1 ? `BOOST ${multPct(b.total)}` : `PENALTY ${multPct(b.total)}`}
          </Tag>
          {b.reason && <span style={{ fontSize: 10, color: C.faint, flexBasis: "100%" }}>{b.reason}.</span>}
        </div>
      )}
    </div>
  );
}
