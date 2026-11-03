// ── Player deep-dive panel ───────────────────────────────────────────────────
// Header (headshot / pos / usage) + sub-tabs: Projection · Profile · Game Log ·
// Splits · Matchup. Reused by the Matchup Lab, the Games tab, and the Board
// drill-in, so it is the one surface that has to look right in three contexts.
import { useMemo, useState } from "react";
import { projectPlayer, teamOpportunityBudget, teamVolume, applyBudget } from "../lib/models.js";
import { teamPriorFor } from "../lib/teamPriors.js";
import { depthContextFor } from "../lib/rosterStatus.js";
import { projectableRoster } from "../lib/depthPromotion.js";
import { recentBaseline } from "../lib/aggregate.js";
import { withSnapWeeks } from "../lib/snapWeekly.js";
import { savePick, buildPick } from "../lib/picks.js";
import { S, C, MON, POS_COLORS, readable, alpha } from "../lib/theme.js";
import { headshotOf, logoOf } from "../lib/headshots.js";
import { pct } from "../lib/format.js";
import { Tag, Empty, BaselineChip, Headshot, TeamLogo } from "./ui.jsx";
import { SchemeMatchup, ProjCard } from "./projection.jsx";
import { PlayerProfile } from "./PlayerProfile.jsx";
import { GameLog } from "./GameLog.jsx";
import { MatchupContext } from "./MatchupContext.jsx";

/**
 * Games behind the rates shown beside it.
 *
 * A carried baseline has 0 games THIS season but its rates were earned over a
 * full prior one, and "0 g · 10.4 tgt/g" reads like a rate computed from
 * nothing. Show what the number actually rests on.
 */
function gamesLabel(season) {
  const c = season._carryover;
  const live = season.games || 0;
  if (!c || live > 0) return `${live} g`;
  if (c.prior_games) return `${c.prior_games} g in ${c.prior_season ?? "prior yr"}`;
  return `${live} g`;
}

function syntheticGame(team, opp) {
  return { spread_line: 0, total_line: 44, home_implied: 22, away_implied: 22, home_team: team, away_team: opp };
}

const SUBTABS = [["proj", "Projection"], ["profile", "Profile"], ["log", "Game Log"],
  ["splits", "Splits"], ["matchup", "Matchup"]];

export function PlayerPanel({ d, playerId, oppAbbr, game, side }) {
  const [sub, setSub] = useState("proj");
  const [profSeason, setProfSeason] = useState(null);   // null = newest available
  const [logSeason, setLogSeason] = useState(null);
  const season = d.seasonById[playerId];
  const splits = d.splits[playerId];
  const def = d.defense[oppAbbr];
  const allWeeks = d.weeksByPlayer?.[playerId];
  const props = useMemo(() => {
    if (!season) return [];
    // The same opportunity budget the board applies, rebuilt for this player's
    // team. Without it the panel and the board would print DIFFERENT numbers for
    // the same prop — the panel is where you go to check the board, so the two
    // have to be computed the same way.
    const roster = projectableRoster(d, season.team_abbr, game);
    const budget = teamOpportunityBudget(roster, teamVolume(
      roster, d.offense[season.team_abbr], teamPriorFor(game?.season ?? season.season, season.team_abbr)));

    return projectPlayer({
      player: d.players[playerId], season: applyBudget(season, budget.get(playerId)), splits,
      recent: recentBaseline(allWeeks, game?.week ?? Infinity),
      depth: depthContextFor(game?.season ?? season.season, playerId, season._carryover?.prior_season),
      teamOff: d.offense[season.team_abbr], oppOff: d.offense[oppAbbr], oppDef: def,
      // Matchup Lab builds a synthetic game with no season, so fall back to the
      // season the player's own aggregate came from.
      teamPrior: teamPriorFor(game?.season ?? season.season, season.team_abbr),
      oppPrior: teamPriorFor(game?.season ?? season.season, oppAbbr),
      game: game || syntheticGame(season.team_abbr, oppAbbr), side: side || "home",
    });
  }, [playerId, oppAbbr, game, side, season, splits, def, allWeeks, d]);

  if (!season) return null;
  const pl = d.players[playerId] || {};
  const teamHex = d.teams?.[season?.team_abbr]?.color || null;
  // Display log — NOT `allWeeks`, which is current-season-only because the
  // model consumes it. Defaults to the newest season he has games in, and the
  // switch reaches every season on file: at week 2 a one-game 2026 log and the
  // full 2025 one answer different questions, and both are worth one click.
  const history = d.historyByPlayer?.[playerId] || [];
  const logSeasons = [...new Set(history.map((w) => w.season))].sort((a, b) => b - a);
  const logYear = logSeason ?? logSeasons[0] ?? null;
  // Snaps off the bundled per-week artifact, which pull_roster.mjs rewrites
  // within a day of a game — the week row's own stamped value waits on the
  // weekly ETL. A season with no bundled file passes through untouched.
  const logWeeks = withSnapWeeks(
    history.filter((w) => w.season === logYear).sort((a, b) => b.week - a.week), logYear);
  const profiles = d.profilesByPlayer?.[playerId] || {};
  const profSeasons = Object.keys(profiles).map(Number).sort((a, b) => b - a);
  const profYear = profSeason ?? profSeasons[0] ?? null;
  const profile = profYear != null ? profiles[profYear] : d.profiles?.[playerId];

  const onTrack = (prop) => savePick(buildPick({
    season: d.year ?? season.season, week: game?.week ?? null, game,
    player: { player_id: playerId, full_name: pl.full_name }, position: season.position,
    team: season.team_abbr, opp: oppAbbr, prop,
  }));

  const usage = [
    season.targets_pg ? `${(+season.targets_pg).toFixed(1)} tgt/g` : null,
    season.carries_pg ? `${(+season.carries_pg).toFixed(1)} car/g` : null,
    season.pass_att_pg ? `${(+season.pass_att_pg).toFixed(1)} att/g` : null,
  ].filter(Boolean);

  return (
    <div className="fade-in" style={S.card}>
      {/* The profile header: a big face on a wash of his club's color, the club
          logo as a watermark. The raw team color is right for a translucent wash
          in either theme; text marks go through readable(). */}
      <div style={{ ...S.cardHead, padding: "18px 18px", position: "relative", overflow: "hidden",
        background: `linear-gradient(120deg, ${alpha(teamHex || C.accent, 0.22)} 0%, ${alpha(teamHex || C.accent, 0.04)} 55%, transparent 100%), ${C.panelDeep}` }}>
        {logoOf(d, season.team_abbr) && (
          <img src={logoOf(d, season.team_abbr)} alt="" aria-hidden
            style={{ position: "absolute", right: -20, top: "50%", transform: "translateY(-50%)", width: 190, height: 190,
              objectFit: "contain", opacity: 0.1, pointerEvents: "none" }} />
        )}
        <div style={{ display: "flex", gap: 16, alignItems: "center", minWidth: 0, position: "relative" }}>
          <Headshot src={headshotOf(d, playerId)} logo={logoOf(d, season.team_abbr)} name={pl.full_name}
            size={96} ring={readable(teamHex)} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 24, color: C.txt, lineHeight: 1.15 }}>{pl.full_name || playerId}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, flexWrap: "wrap",
              fontSize: 11, color: C.faint, fontFamily: MON }}>
              <TeamLogo src={logoOf(d, season.team_abbr)} size={20} />
              <Tag color={POS_COLORS[season.position]}>{season.position}</Tag>
              <span style={{ color: readable(d.teams?.[season.team_abbr]?.color), fontWeight: 700 }}>
                {season.team_abbr}
              </span>
              <span>· {gamesLabel(season)}</span>
              {usage.length > 0 && <span>· {usage.join(" · ")}</span>}
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>· vs <TeamLogo src={logoOf(d, oppAbbr)} size={16} /><b style={{ color: C.txt }}>{oppAbbr}</b></span>
              {season._carryover && <BaselineChip c={season._carryover} />}
            </div>
          </div>
        </div>
      </div>

      <div style={S.propTabs}>
        {SUBTABS.map(([k, label]) => (
          <button key={k} onClick={() => setSub(k)} style={S.propTab(sub === k)}>{label}</button>
        ))}
      </div>

      <div style={{ padding: 14 }}>
        {sub === "proj" && (
          <>
            <MatchupContext season={game?.season ?? d.year} team={season.team_abbr} opp={oppAbbr}
              prop={props[0]} teams={d.teams} />
            <SchemeMatchup season={season} splits={splits} def={def} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(216px,1fr))", gap: 10, marginTop: 12 }}>
              {props.map((p) => <ProjCard key={p.prop_type} p={p} onTrack={onTrack} />)}
            </div>
            {props.length === 0 && <Empty>Not enough volume to project this player.</Empty>}
          </>
        )}
        {sub === "matchup" && (
          <>
            <SchemeMatchup season={season} splits={splits} def={def} />
            {!def && <Empty>No scheme profile for {oppAbbr}.</Empty>}
          </>
        )}
        {sub === "profile" && (
          <PlayerProfile
            profile={profile}
            position={season.position}
            seasons={profSeasons.length > 1 ? profSeasons.map((y) => ({ season: y, active: y === profYear })) : null}
            onSeason={setProfSeason}
            seasonLabel={(() => {
              if (!profile) return null;
              const through = profile.data?.season_through_week;
              if (profile.season === d.year) return `${profile.season} profile · through week ${through ?? "?"}`;
              return `${profile.season} profile (full season)`;
            })()}
          />
        )}
        {sub === "log" && (
          <GameLog weeks={logWeeks} pos={season.position}
            seasons={logSeasons.length > 1 ? logSeasons.map((y) => ({ season: y, active: y === logYear })) : null}
            onSeason={setLogSeason}
            seasonLabel={logYear == null ? null
              : logYear === d.year ? `${logYear}` : `${logYear} (full season)`} />
        )}
        {sub === "splits" && <Splits splits={splits} pos={season.position} />}
      </div>
    </div>
  );
}

// ── Splits — the raw per-scheme efficiency the model leans on ─────────────────
function Splits({ splits, pos }) {
  if (!splits) return <Empty>No scheme splits for this player.</Empty>;
  const isRush = pos === "RB" || pos === "FB";
  const rows = isRush
    ? [
        ["Light box (≤6)", splits.light_box_att, splits.light_box_ypc, "att", "yd/car"],
        ["Heavy box (≥8)", splits.heavy_box_att, splits.heavy_box_ypc, "att", "yd/car"],
      ]
    : [
        ["vs Man", splits.man_targets, splits.man_ypt, "tgt", "yd/tgt", splits.man_success],
        ["vs Zone", splits.zone_targets, splits.zone_ypt, "tgt", "yd/tgt", splits.zone_success],
      ];
  const hasAny = rows.some((r) => r[1]);
  if (!hasAny) return <Empty>Not enough volume for {isRush ? "box" : "coverage"} splits.</Empty>;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
      {rows.map(([label, n, eff, nunit, eunit, succ]) => (
        <div key={label} style={{ ...S.inset, padding: 14 }}>
          <div style={{ ...S.sectionLabel, marginBottom: 6 }}>{label}</div>
          <div style={{ fontSize: 24, fontWeight: 800, fontFamily: MON }}>
            {eff != null ? eff.toFixed(1) : "—"}
            <span style={{ fontSize: 11, color: C.muted, fontWeight: 400 }}> {eunit}</span>
          </div>
          <div style={{ fontSize: 10, color: C.faint, marginTop: 6, fontFamily: MON }}>
            {n || 0} {nunit}{succ != null ? ` · ${pct(succ)} success` : ""}
          </div>
        </div>
      ))}
    </div>
  );
}
