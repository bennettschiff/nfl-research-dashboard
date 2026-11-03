// ── Snap counts by team ──────────────────────────────────────────────────────
// A team's skill players, week by week: snaps and share of the offense's snaps.
// The single most direct read on role — who is actually on the field — which is
// what an anytime-TD or a receiving line rests on, and what a box score hides (a
// zero-target week at 60 snaps is a different week from one at 12).
//
// SOURCES. The current season reads scripts/out/player_snaps_weekly_<season>.json
// (nflverse snap_counts, refreshed by pull_roster.mjs within a day of each game),
// bundled rather than fetched. It lists every skill player who took a snap,
// including weeks with no stat line. Last season reads the week rows' snaps_wk /
// snap_pct_wk (participation-derived), which exist only for weeks he recorded a
// stat — the card says so.
import { Fragment, useMemo, useState } from "react";
import { hasSnapWeeks, snapWeeksFor, withSnapWeeks } from "../lib/snapWeekly.js";
import { cmp } from "../lib/boardSort.js";
import { S, C, MON, POS_COLORS, readable, alpha } from "../lib/theme.js";
import { headshotOf, logoOf } from "../lib/headshots.js";
import { SortBtn, Empty, Headshot, TeamLogo, Tag } from "./ui.jsx";
import { GameLog, SeasonSwitch } from "./GameLog.jsx";

const GROUPS = [["QB", "Quarterbacks"], ["RB", "Running backs"], ["WR", "Wide receivers"], ["TE", "Tight ends"]];

/** player_id → { team, weeks: { week: { snaps, pct } } } for one season. */
function snapIndex(d, season) {
  const out = {};
  const add = (pid, team, week, snaps, pct) => {
    const p = (out[pid] ||= { team, weeks: {} });
    p.team = team || p.team;
    p.weeks[week] = { snaps, pct };
  };
  if (hasSnapWeeks(season)) {
    for (const [pid, weeks] of Object.entries(snapWeeksFor(season))) {
      for (const [week, s] of Object.entries(weeks)) add(pid, s.team, Number(week), s.snaps, s.pct);
    }
  } else {
    for (const [pid, rows] of Object.entries(d.historyByPlayer || {})) {
      for (const w of rows) {
        if (w.season !== season || (w.snaps_wk == null && w.snap_pct_wk == null)) continue;
        add(pid, w.team_abbr, w.week, w.snaps_wk, w.snap_pct_wk);
      }
    }
  }
  return out;
}

// `detail` (optional) — r → the expanded body under a clicked row. The Snaps tab
// passes one; the board's snap room does not, since the row it sits in already
// shows that player's log.
function GroupTable({ label, pos, rows, weeks, highlight, meta, detail }) {
  const [sort, setSort] = useState({ col: "avg", dir: "desc" });
  const [open, setOpen] = useState(null);
  const onSort = (col) => setSort((s) => (s.col === col ? { col, dir: s.dir === "desc" ? "asc" : "desc" } : { col, dir: "desc" }));
  const SORT_VAL = {
    name: (r) => r.name,
    total: (r) => r.total,
    avg: (r) => r.avg,
    ...Object.fromEntries(weeks.map((w) => [`w${w}`, (r) => r.weeks[w]?.pct ?? null])),
  };
  const sorted = [...rows].sort((a, b) => {
    const f = SORT_VAL[sort.col] || SORT_VAL.avg;
    return cmp(f(a), f(b), sort.dir === "asc" ? 1 : -1)
      || String(a.name).localeCompare(String(b.name));
  });
  if (!rows.length) return null;
  const cell = (v) => {
    if (!v) return <span style={{ color: C.faintest }}>—</span>;
    const col = v.pct >= 0.7 ? C.good : v.pct >= 0.4 ? C.txt : C.muted;
    return (
      <>
        <span style={{ fontWeight: 700, color: col }}>{v.pct == null ? "—" : `${Math.round(v.pct * 100)}%`}</span>
        <span style={{ color: C.faint, fontSize: 10 }}> {v.snaps ?? ""}</span>
      </>
    );
  };
  return (
    <div style={{ ...S.card, marginBottom: 10 }}>
      <div style={S.cardHead}>
        <div style={{ ...S.cardTitle, color: POS_COLORS[pos] }}>{label}</div>
        <span style={S.cardMeta}>{meta || "snap % · snaps"}</span>
      </div>
      <div style={S.tblWrap}>
        <table style={{ ...S.tbl, minWidth: 420 }}>
          <thead>
            <tr>
              <th style={{ ...S.thLeft, minWidth: 150 }}><SortBtn col="name" sort={sort} onSort={onSort} align="left">Player</SortBtn></th>
              {weeks.map((w) => (
                <th key={w} style={S.th}><SortBtn col={`w${w}`} sort={sort} onSort={onSort}>Wk {w}</SortBtn></th>
              ))}
              <th style={S.th}><SortBtn col="avg" sort={sort} onSort={onSort}>Avg %</SortBtn></th>
              <th style={S.th}><SortBtn col="total" sort={sort} onSort={onSort}>Snaps</SortBtn></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const mark = r.pid === highlight || r.pid === open;
              return (
                <Fragment key={r.pid}>
                  <tr className="row-hover"
                    onClick={detail ? () => setOpen((o) => (o === r.pid ? null : r.pid)) : undefined}
                    style={{ ...(mark ? { background: alpha(C.accent, 0.08) } : null),
                      ...(detail ? { cursor: "pointer" } : null) }}>
                    <td style={{ ...S.tdLeft, fontWeight: 600, color: mark ? C.accent : C.txt,
                      borderLeft: mark ? `3px solid ${C.accent}` : undefined }}>{r.name}</td>
                    {weeks.map((w) => <td key={w} style={{ ...S.td, fontFamily: MON }}>{cell(r.weeks[w])}</td>)}
                    <td style={{ ...S.td, fontFamily: MON, fontWeight: 700 }}>{r.avg == null ? "—" : `${Math.round(r.avg * 100)}%`}</td>
                    <td style={{ ...S.td, fontFamily: MON }}>{r.total}</td>
                  </tr>
                  {detail && r.pid === open && (
                    <tr>
                      <td colSpan={weeks.length + 3} style={{ padding: 0, textAlign: "left" }}>
                        {detail(r, () => setOpen(null))}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** pos → rows for one team's skill players, from a snapIndex. */
function groupByPos(idx, team, players) {
  const out = {};
  for (const [pid, p] of Object.entries(idx)) {
    if (p.team !== team) continue;
    const pl = players[pid] || {};
    const pos = pl.position === "FB" ? "RB" : pl.position;
    if (!GROUPS.some(([g]) => g === pos)) continue;
    const ws = Object.values(p.weeks);
    const pcts = ws.map((w) => w.pct).filter((v) => v != null);
    (out[pos] ||= []).push({
      pid, name: pl.full_name || pid, weeks: p.weeks,
      total: ws.reduce((a, w) => a + (w.snaps || 0), 0),
      avg: pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null,
    });
  }
  return out;
}

/**
 * One player's position room on his team, this season, with him highlighted —
 * for the board's expanded row. Who he shares the field with is the context a
 * snap share needs: 55% means one thing beside a 40% back, another beside 10%.
 * A player whose team took no snaps this season yet (a bye, week 1) gets nothing.
 */
export function SnapRoom({ d, team, pos, playerId }) {
  const idx = useMemo(() => snapIndex(d, d.year), [d]);
  const group = pos === "FB" ? "RB" : pos;
  const rows = useMemo(() => groupByPos(idx, team, d.players)[group] || [], [idx, team, d.players, group]);
  const weeks = useMemo(() => [...new Set(rows.flatMap((r) => Object.keys(r.weeks).map(Number)))]
    .sort((a, b) => a - b), [rows]);
  const label = GROUPS.find(([g]) => g === group)?.[1];
  if (!rows.length || !label) return null;
  return (
    <GroupTable label={`${team} ${label.toLowerCase()} · snaps`} pos={group} rows={rows} weeks={weeks}
      highlight={playerId} meta={`${d.year} · share of offensive snaps · raw snaps`} />
  );
}

/**
 * A clicked row on the Snaps tab: the board's expanded-row header (face, club,
 * position) and his game log for the season on screen. No snap room — the table
 * he was clicked out of is that.
 */
function PlayerDetail({ d, pid, team, season, onClose }) {
  const pl = d.players[pid] || {};
  const weeks = useMemo(() => withSnapWeeks(
    (d.historyByPlayer?.[pid] || []).filter((w) => w.season === season).sort((a, b) => b.week - a.week),
    season), [d.historyByPlayer, pid, season]);
  return (
    <div className="fade-in" style={{ background: C.inset, borderTop: `1px solid ${C.line}`,
      borderBottom: `1px solid ${C.line}`, padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <Headshot src={headshotOf(d, pid)} logo={logoOf(d, team)} name={pl.full_name} size={56}
          ring={readable(d.teams?.[team]?.color)} />
        <span style={{ fontSize: 15, fontWeight: 700 }}>{pl.full_name || pid}</span>
        {pl.position && <Tag color={POS_COLORS[pl.position]}>{pl.position}</Tag>}
        <span style={{ fontSize: 11, color: C.muted, fontFamily: MON, display: "inline-flex", alignItems: "center", gap: 4 }}>
          <TeamLogo src={logoOf(d, team)} size={18} />{team}
        </span>
        <button style={{ ...S.btnGhost, marginLeft: "auto" }} onClick={onClose}>Close</button>
      </div>
      <GameLog weeks={weeks} pos={pl.position}
        seasonLabel={season === d.year ? `${season}` : `${season} (full season)`}
        emptyText={`No ${season} game log for this player.`} />
    </div>
  );
}

export function SnapCounts({ d }) {
  const seasons = useMemo(() => [d.year, d.year - 1], [d.year]);
  const [season, setSeason] = useState(d.year);
  const idx = useMemo(() => snapIndex(d, season), [d, season]);
  const teams = useMemo(() => [...new Set(Object.values(idx).map((p) => p.team).filter(Boolean))].sort(), [idx]);
  const [team, setTeam] = useState(null);
  const tm = team && teams.includes(team) ? team : teams[0];

  const weeks = useMemo(() => [...new Set(Object.values(idx).flatMap((p) => Object.keys(p.weeks).map(Number)))]
    .sort((a, b) => a - b), [idx]);

  const byPos = useMemo(() => groupByPos(idx, tm, d.players), [idx, tm, d.players]);

  return (
    <div className="fade-in">
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {teams.map((t) => (
            <button key={t} onClick={() => setTeam(t)}
              style={{ ...S.chipTab(t === tm), color: t === tm ? readable(d.teams?.[t]?.color) : C.muted }}>{t}</button>
          ))}
        </div>
        <span style={{ marginLeft: "auto" }}>
          <SeasonSwitch seasons={seasons.map((y) => ({ season: y, active: y === season }))} onSeason={setSeason} />
        </span>
      </div>
      {!teams.length && <Empty>No snap counts for {season} yet.</Empty>}
      {GROUPS.map(([pos, label]) => (
        <GroupTable key={`${tm}-${season}-${pos}`} label={label} pos={pos} rows={byPos[pos] || []} weeks={weeks}
          detail={(r, close) => <PlayerDetail d={d} pid={r.pid} team={tm} season={season} onClose={close} />} />
      ))}
      <div style={{ fontSize: 10, color: C.faint, lineHeight: 1.6 }}>
        {hasSnapWeeks(season)
          ? "Offensive snaps and share of the team's offensive snaps, from nflverse snap counts — every week he took a snap, stat line or not."
          : "Last season's snaps come from participation data attached to box-score rows, so a week with a snap but no stat is not shown."}
      </div>
    </div>
  );
}
