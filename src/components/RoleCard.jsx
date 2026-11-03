// ── Role — what the snaps were FOR ───────────────────────────────────────────
// A snap share says he was on the field. It does not say the offense pointed
// the ball at him while he was out there: a sixth lineman and a feature back can
// post the same 56%, and one of them is blocking on every one of those snaps.
//
// Two halves, deliberately labelled with different seasons, because they keep
// different time:
//
//   THIS SEASON  snaps, snap share and opportunities per snap (targets +
//                carries, per offensive snap). All of it derivable from the
//                weekly box score and nflverse snap_counts, both of which are
//                published within a day of a game.
//   LAST SEASON  route share, TPRR and YPRR — the real answer to "is he out
//                there to run routes". These come from participation data,
//                which the league publishes AFTER a season ends, so an
//                in-progress season has none and this half says which year it
//                is describing rather than quietly implying it is this one.
//
// The card never fabricates the missing half. If neither exists it renders
// nothing at all rather than a row of dashes.
import { S, C, MON } from "../lib/theme.js";
import { pct } from "../lib/format.js";

const num2 = (v) => (v == null ? null : v.toFixed(2));
const num1 = (v) => (v == null ? null : v.toFixed(1));

/** This season's snap/opportunity totals across the weeks he has played. */
function liveRole(weeks) {
  const played = (weeks || []).filter((w) => w.snaps_wk != null || w.snap_pct_wk != null);
  if (!played.length) return null;
  const snaps = played.reduce((a, w) => a + (Number(w.snaps_wk) || 0), 0);
  const opp = played.reduce((a, w) => a + (Number(w.targets) || 0) + (Number(w.carries) || 0), 0);
  const pcts = played.map((w) => Number(w.snap_pct_wk)).filter((v) => Number.isFinite(v));
  return {
    games: played.length,
    snaps,
    snapPct: pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null,
    oppPerSnap: snaps ? opp / snaps : null,
    oppPerGame: opp / played.length,
  };
}

/**
 * The newest profile that actually carries route data.
 *
 * NOT simply the newest profile: the current season's card exists from week 1
 * and has every route field null, so taking the latest would render an empty
 * half and hide the completed season that answers the question.
 */
function routeProfile(profilesByPlayer, playerId) {
  const byYear = profilesByPlayer?.[playerId] || {};
  const years = Object.keys(byYear).map(Number).sort((a, b) => b - a);
  for (const y of years) {
    const d = byYear[y]?.data;
    if (d && d.route_pct != null) return { season: y, d };
  }
  return null;
}

function Stat({ label, value, hint, color }) {
  return (
    <div style={{ minWidth: 76 }} title={hint}>
      <div style={{ ...S.sectionLabel, marginBottom: 3 }}>{label}</div>
      <div style={{ fontFamily: MON, fontSize: 15, fontWeight: 800, color: color || C.txt }}>
        {value ?? "—"}
      </div>
    </div>
  );
}

function Half({ title, meta, children }) {
  return (
    <div style={{ ...S.inset, padding: "10px 12px", flex: "1 1 280px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <span style={{ ...S.sectionLabel, color: C.muted }}>{title}</span>
        <span style={{ fontSize: 10, color: C.faintest, fontFamily: MON, marginLeft: "auto" }}>{meta}</span>
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>{children}</div>
    </div>
  );
}

/**
 * `weeks` are this season's played weeks (already snap-overlaid), `pos` his
 * position and `profilesByPlayer` the season → profile map off the season
 * object.
 *
 * NOT RENDERED FOR QUARTERBACKS. Both halves are answers to "was he out there,
 * and was the ball pointed at him", which a starting quarterback answers with
 * 100% and nothing. Worse, the participation artifact counts a QB's DROPBACKS
 * as routes, so the pass-game half showed Jacoby Brissett on a 93% route share
 * with a TPRR of 0.000 — a real number attached to a question nobody asked.
 */
export function RoleCard({ weeks, pos, playerId, profilesByPlayer, season }) {
  if (pos === "QB") return null;
  const live = liveRole(weeks);
  const route = routeProfile(profilesByPlayer, playerId);
  if (!live && !route) return null;

  const oppColor = live?.oppPerSnap == null ? C.txt
    : live.oppPerSnap >= 0.35 ? C.good : live.oppPerSnap >= 0.15 ? C.txt : C.muted;

  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
      {live && (
        <Half title="Role · this season" meta={`${season} · ${live.games} ${live.games === 1 ? "game" : "games"}`}>
          <Stat label="Snap %" value={live.snapPct == null ? null : pct(live.snapPct)}
            hint="Average share of his offense's snaps in the weeks he played" />
          <Stat label="Snaps" value={live.snaps || null} hint="Offensive snaps this season" />
          <Stat label="Opp / snap" value={num2(live.oppPerSnap)} color={oppColor}
            hint="Targets plus carries per offensive snap — whether the ball came his way while he was out there. A blocking back and a feature back can share a snap share and differ tenfold here." />
          <Stat label="Opp / game" value={num1(live.oppPerGame)}
            hint="Targets plus carries per game" />
        </Half>
      )}
      {route && (
        <Half title="Pass-game role" meta={`${route.season} participation`}>
          <Stat label="Route share" value={route.d.route_pct == null ? null : pct(route.d.route_pct)}
            hint="Share of his team's dropbacks he ran a route on — the cleanest read on whether the snaps are pass-game snaps or blocking snaps" />
          <Stat label="Routes / g" value={num1(route.d.routes_pg)} hint="Routes run per game" />
          <Stat label="TPRR" value={route.d.tprr == null ? null : route.d.tprr.toFixed(3)}
            hint="Targets per route run — how often he is looked at when he actually runs a route, independent of how much he plays" />
          <Stat label="YPRR" value={num2(route.d.yprr)} hint="Yards per route run" />
        </Half>
      )}
      {!route && (
        <Half title="Pass-game role" meta="no source yet">
          <div style={{ fontSize: 11, color: C.faint, lineHeight: 1.6 }}>
            Routes run, route share and TPRR come from participation data the league publishes after
            the season ends — there is no in-season source, so Opp / snap above is the standing
            read on whether the snaps are productive ones.
          </div>
        </Half>
      )}
    </div>
  );
}
