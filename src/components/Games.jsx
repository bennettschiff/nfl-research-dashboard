// ── Games tab — slate by week, drill into either offense ─────────────────────
// The old card showed two logos, two implied totals and a spread chip, and
// nothing else — while nflverse hands us kickoff, both starting QBs, the total,
// the roof, wind, temperature, rest days and whether it's a division game, all
// of which change how a game projects. The card now shows them.
import { useMemo, useState } from "react";
import { roleScore, defaultWeek } from "../lib/roster.js";
import { projectableRoster } from "../lib/depthPromotion.js";
import { S, C, MON, POS_COLORS, readable, alpha } from "../lib/theme.js";
import { kickoff, spreadText, weekLabel, lastName } from "../lib/format.js";
import { Pill, Tag, SectionLabel, Empty, Headshot } from "./ui.jsx";
import { headshotOf, headshotByName, logoOf } from "../lib/headshots.js";
import { PlayerPanel } from "./PlayerPanel.jsx";
import { engineFor } from "../lib/gameEngine.js";

/**
 * The game engine's score for a game, in a line: "engine SEA 21.0–20.5 DEN ·
 * 41.5". Null for a game it has not rated (it rates the next week only). The
 * full matchup — what built the number, both quarterbacks, every book — opens
 * from the Board's game markets (src/components/GameBoard.jsx).
 */
function engineLine(d, g) {
  const e = engineFor(d.year)?.byGame.get(g.game_id);
  if (!e) return null;
  return `engine ${g.away_team} ${e.away_pts.toFixed(1)}–${e.home_pts.toFixed(1)} ${g.home_team} · ${e.total.toFixed(1)}`;
}

export function Games({ d }) {
  const weeks = useMemo(() => [...new Set(d.games.map((g) => g.week))].sort((a, b) => a - b), [d]);
  const [wk, setWk] = useState(() => defaultWeek(d.games));
  const [sel, setSel] = useState(null);

  const games = useMemo(
    () => d.games.filter((g) => g.week === wk)
      .sort((a, b) => `${a.gameday} ${a.gametime}`.localeCompare(`${b.gameday} ${b.gametime}`)),
    [d, wk]);

  if (sel) return <GameDetail g={sel} d={d} onBack={() => setSel(null)} />;

  return (
    <div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
        <span style={{ ...S.sectionLabel, marginRight: 4 }}>Week</span>
        {weeks.map((w) => (
          <Pill key={w} size="chip" active={w === wk} onClick={() => { setWk(w); setSel(null); }}>
            {weekLabel(w)}
          </Pill>
        ))}
      </div>
      <SectionLabel>{weekLabel(wk)} · {games.length} {games.length === 1 ? "Game" : "Games"}</SectionLabel>
      {games.length === 0 ? <Empty>No games scheduled for {weekLabel(wk)}.</Empty> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(268px,1fr))", gap: 10 }}>
          {games.map((g) => <GameCard key={g.game_id} g={g} d={d} onClick={() => setSel(g)} />)}
        </div>
      )}
    </div>
  );
}

/** The environment line: what about this game is not on the scoreboard. */
function conditions(g) {
  const bits = [];
  if (g.roof === "dome" || g.roof === "closed") bits.push("dome");
  else {
    if (g.temp != null) bits.push(`${g.temp}°`);
    if (g.wind != null && g.wind >= 10) bits.push(`${g.wind}mph`);
  }
  if (g.div_game) bits.push("division");
  const rest = [g.away_rest, g.home_rest].filter((r) => r != null && r !== 7);
  if (rest.length) bits.push(`rest ${g.away_rest}/${g.home_rest}`);
  return bits.join(" · ");
}

function GameCard({ g, d, onClick }) {
  const spread = spreadText(g);
  const cond = conditions(g);
  return (
    <div onClick={onClick} className="row-hover" style={{ ...S.card, marginBottom: 0, cursor: "pointer" }}>
      <div style={{ ...S.cardHead, padding: "7px 12px" }}>
        <span style={{ fontSize: 10, color: C.accent, fontFamily: MON, fontWeight: 700 }}>
          {kickoff(g.gameday, g.gametime)}
        </span>
        <span style={{ fontSize: 9, color: C.faint, fontFamily: MON }}>
          {g.total_line != null ? `O/U ${g.total_line}` : ""}{spread ? ` · ${spread}` : ""}
        </span>
      </div>
      <div style={{ padding: "8px 12px" }}>
        {[["away", g.away_team, g.away_implied, g.away_qb], ["home", g.home_team, g.home_implied, g.home_qb]]
          .map(([sideKey, abbr, implied, qb]) => (
            <div key={sideKey} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
              {d.teams[abbr]?.logo && <img src={d.teams[abbr].logo} alt="" style={{ width: 24, height: 24 }} />}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div>
                  <span style={{ fontWeight: 700, fontSize: 13, color: readable(d.teams[abbr]?.color) }}>{abbr}</span>
                  <span style={{ fontSize: 8, color: C.faint, marginLeft: 5, letterSpacing: "0.05em" }}>
                    {sideKey === "away" ? "AWAY" : "HOME"}
                  </span>
                </div>
                {qb && <div style={{ fontSize: 10, color: C.faint, whiteSpace: "nowrap",
                  overflow: "hidden", textOverflow: "ellipsis", display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
                  <Headshot src={headshotByName(d, qb, abbr)} name={qb} size={18} badge={false} />{qb}</div>}
              </div>
              {implied != null && (
                <span style={{ fontSize: 16, fontWeight: 700, fontFamily: MON }} title="implied team total">{implied}</span>
              )}
            </div>
          ))}
      </div>
      {(cond || engineLine(d, g)) && (
        <div style={{ padding: "5px 12px", borderTop: `1px solid ${C.lineSoft}`, fontSize: 9,
          color: C.faint, fontFamily: MON }}>
          {[engineLine(d, g), cond].filter(Boolean).join(" · ")}
        </div>
      )}
    </div>
  );
}

function GameDetail({ g, d, onBack }) {
  const [team, setTeam] = useState(g.home_team);
  const opp = team === g.home_team ? g.away_team : g.home_team;
  const side = team === g.home_team ? "home" : "away";
  // Same rows the Board shows for this team-week, promotions and all — the two
  // views disagreeing about who is playing is exactly what this helper exists
  // to prevent.
  const roster = useMemo(() => projectableRoster(d, team, g)
    .sort((a, b) => roleScore(b, 4) - roleScore(a, 4))
    .slice(0, 10), [team, d, g]);
  // The selection is DERIVED, not synced: flipping the team side used to reset
  // `pid` from an effect, which rendered one frame of the old team's player
  // against the new roster. Falling back to the top of the roster whenever the
  // held id isn't on it does the same job during render instead.
  const [picked, setPicked] = useState(null);
  const pid = roster.some((s) => s.player_id === picked) ? picked : roster[0]?.player_id;

  return (
    <div className="fade-in">
      <button onClick={onBack} style={{ ...S.btnGhost, marginBottom: 12 }}>← back to games</button>

      <div style={S.card}>
        <div style={S.cardHead}>
          <div style={S.cardTitle}>
            {g.away_team} @ {g.home_team}
            <span style={S.badge()}>{weekLabel(g.week)}</span>
          </div>
          <span style={S.cardMeta}>
            {kickoff(g.gameday, g.gametime)}
            {g.total_line != null ? ` · O/U ${g.total_line}` : ""}
            {spreadText(g) ? ` · ${spreadText(g)}` : ""}
            {conditions(g) ? ` · ${conditions(g)}` : ""}
            {engineLine(d, g) ? ` · ${engineLine(d, g)}` : ""}
          </span>
        </div>

        <div style={S.propTabs}>
          {[g.away_team, g.home_team].map((t) => (
            <button key={t} onClick={() => setTeam(t)} style={{ ...S.propTab(t === team), display: "flex",
              alignItems: "center", gap: 6, padding: "5px 12px" }}>
              {d.teams[t]?.logo && <img src={d.teams[t].logo} alt="" style={{ width: 18, height: 18 }} />}
              <b>{t}</b>
              <span style={{ fontWeight: 400, opacity: 0.8 }}>offense</span>
            </button>
          ))}
          <span style={{ marginLeft: "auto", fontSize: 10, color: C.faint, fontFamily: MON }}>
            {team} implied {side === "home" ? g.home_implied : g.away_implied} · vs {opp} defense
          </span>
        </div>

        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", padding: "8px 12px",
          background: alpha(C.deep, 0.5) }}>
          {roster.map((s) => (
            <button key={s.player_id} onClick={() => setPicked(s.player_id)}
              style={{ ...S.chipTab(s.player_id === pid), fontFamily: "inherit", fontSize: 11,
                display: "inline-flex", gap: 6, alignItems: "center", padding: "3px 9px 3px 4px" }}>
              <Headshot src={headshotOf(d, s.player_id)} logo={logoOf(d, s.team_abbr)}
                name={d.players[s.player_id]?.full_name} size={24} badge={false} />
              {lastName(d.players[s.player_id]?.full_name)}
              <Tag color={POS_COLORS[s.position]}>{s.position}</Tag>
            </button>
          ))}
          {roster.length === 0 && (
            <span style={{ fontSize: 11, color: C.muted }}>No projectable players on this offense yet.</span>
          )}
        </div>
      </div>

      {pid && <PlayerPanel d={d} playerId={pid} oppAbbr={opp} game={g} side={side} />}
    </div>
  );
}
