// ── Player profile card ──────────────────────────────────────────────────────
// The NFL analog of the MLB lab's Statcast card: percentile bars, position-
// relative, grouped so that read top-to-bottom the card is a scouting report.
//
// THE PERCENTILE IS THE POINT. "TPRR 0.24" is unreadable; "TPRR 0.24, 88th among
// WRs" is information. Percentiles are computed server-side among QUALIFIED
// players at the position (scripts/build_player_profiles.py) — ranking a WR5
// with 11 routes against every starter is how a card starts lying.
//
// HONESTY RULES THIS COMPONENT ENFORCES:
//   · a metric with no percentile renders its value with NO bar, not a grey one
//     at zero — absence of a rank is not a bad rank
//   · the card states which season it describes and how many games it covers,
//     because at a season flip this is LAST year's profile
//   · metrics where low is good (drops, interceptions) are flipped upstream so a
//     high bar always means good; the hint says so
import { useMemo } from "react";
import { populatedTiles } from "../lib/profileTiles.js";
import { S, C, MON, alpha } from "../lib/theme.js";
import { Empty } from "./ui.jsx";
import { SeasonSwitch } from "./GameLog.jsx";

const rankColor = (r) => r == null ? C.faintest
  : r >= 80 ? C.good : r >= 60 ? "light-dark(#65a30d, #a3e635)" : r >= 40 ? C.warn : r >= 20 ? "light-dark(#ea580c, #fb923c)" : C.bad;

function PctBar({ rank }) {
  if (rank == null) {
    return (
      <div style={{ height: 6, borderRadius: 3, background: "repeating-linear-gradient(90deg,var(--line) 0 4px,transparent 4px 8px)" }}
        title="Not enough volume to rank this against the position" />
    );
  }
  const col = rankColor(rank);
  return (
    <div style={{ position: "relative", height: 6, borderRadius: 3, background: C.inset, overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, width: `${Math.max(2, Math.min(100, rank))}%`,
        background: col, borderRadius: 3 }} />
    </div>
  );
}

function Row({ row, value, rank }) {
  const col = rankColor(rank);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 62px 34px", gap: 10, alignItems: "center", padding: "5px 0" }}
      title={row.hint}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, color: C.txt, marginBottom: 4, whiteSpace: "nowrap",
          overflow: "hidden", textOverflow: "ellipsis" }}>{row.label}</div>
        <PctBar rank={rank} />
      </div>
      <div style={{ fontFamily: MON, fontSize: 12, fontWeight: 700, textAlign: "right" }}>
        {row.fmt(value) ?? "—"}
      </div>
      <div style={{ fontFamily: MON, fontSize: 10, textAlign: "right", color: col, fontWeight: 700 }}>
        {rank == null ? "—" : Math.round(rank)}
      </div>
    </div>
  );
}

export function PlayerProfile({ profile, position, seasonLabel, seasons, onSeason }) {
  const groups = useMemo(
    () => populatedTiles(position, profile?.data),
    [position, profile]);

  if (!profile) {
    return <Empty>No research profile for this player yet — it is built from a completed season.</Empty>;
  }
  if (!groups.length) {
    return <Empty>No profile metrics available for {position || "this position"}.</Empty>;
  }

  const d = profile.data || {};
  const pct = profile.pct || {};
  const unranked = !profile.qualified;

  return (
    <div className="fade-in">
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, color: C.muted, fontFamily: MON }}>
          {seasonLabel || `${profile.season} profile`}
          {profile.games ? ` · ${profile.games} ${profile.games === 1 ? "game" : "games"}` : ""}
          {d.routes ? ` · ${d.routes} routes` : ""}
        </span>
        {seasons && <SeasonSwitch seasons={seasons} onSeason={onSeason} />}
        <span style={{ marginLeft: "auto", fontSize: 10, color: C.faintest, fontFamily: MON }}>
          percentile vs {position === "QB" ? "QBs" : position === "RB" || position === "FB" ? "RBs" : `${position}s`}
        </span>
      </div>

      {unranked && (
        <div style={{ ...S.inset, padding: "8px 12px", marginBottom: 12, fontSize: 11, color: C.warn,
          borderColor: alpha(C.warn, 0.35) }}>
          Below the volume bar to be ranked against the position — values shown, no percentiles.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(264px,1fr))", gap: 10 }}>
        {groups.map((g) => (
          <div key={g.group} style={{ ...S.inset, padding: 12 }}>
            <div style={{ ...S.sectionLabel, marginBottom: 8 }}>{g.group}</div>
            {g.rows.map((r) => (
              <Row key={r.key} row={r} value={d[r.key]} rank={pct[r.key]} />
            ))}
          </div>
        ))}
      </div>

      <div style={{ fontSize: 10, color: C.faintest, marginTop: 10, lineHeight: 1.6 }}>
        Bars are percentiles among qualified players at the position{profile.data?.season_through_week < 17
          ? ", with the volume bar prorated to the weeks played — an early-season rank is a small sample" : ""}.
        Drop rate, INT rate and 8+ box rate are inverted, so a high bar is always good. Routes and man/zone
        come from participation data published after the season, so an in-progress season has none.
        Hover any row for what the metric means.
      </div>
    </div>
  );
}
