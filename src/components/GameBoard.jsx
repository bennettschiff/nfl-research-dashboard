// ── The game-line board: spread, total, moneyline, team total ────────────────
// What the Board shows when the Props dropdown is on a game market. One row per
// game (one per TEAM for team totals), the engine's side of the line, and the
// same three books as every other market. A row expands into the matchup: the
// engine's score and what built it, both quarterbacks, the conditions, and every
// book's two-sided price.
//
// The engine predicts the score and does NOT beat the closing price — that was
// measured (src/lib/gameMarkets.js header), so the four markets are on probation
// and Win% is calibrated to the price. The footer says so; a reader should never
// have to find it in a code comment.
import { Fragment, useMemo, useState } from "react";
import { S, C, MON, alpha, readable } from "../lib/theme.js";
import { BOOK_PREF } from "../lib/odds.js";
import { BOOK_NAMES } from "../lib/betslip.js";
import { pct, pct1, fmtOdds, weekLabel, kickoff, propShort } from "../lib/format.js";
import { cmp } from "../lib/boardSort.js";
import { logoOf } from "../lib/headshots.js";
import { buildGameRows, pickLabel, pickFromGameRow, gamePickSlot } from "../lib/gameMarkets.js";
import { engineFor } from "../lib/gameEngine.js";
import { normalCDF } from "../lib/models.js";
import { officialVerdict, ZONE } from "../lib/officialPicks.js";
import { Tag, SortBtn, TeamLogo } from "./ui.jsx";
import { OddsCell, BookHead } from "./OddsCell.jsx";

const STATUS_TAG = { live: { text: "LIVE", color: C.good }, final: { text: "FINAL", color: C.faint } };

const signed = (x, d = 1) => (x == null ? "—" : `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(d)}`);
const handicap = (x) => (x == null ? "—" : x === 0 ? "PK" : signed(x, 1).replace(".0", ""));

/** How a line reads on each market, for the price cells. */
const LINE_TEXT = {
  spread: (l) => handicap(l),
  total: (l) => `${l}`,
  moneyline: () => "ML",
  team_total: (l) => `${l}`,
};

/** Every column sorts (CLAUDE.md). Missing values sink both ways via cmp(). */
const SORT_VAL = {
  game: (r) => `${r.game.gameday} ${r.game.gametime} ${r.away}`,
  pick: (r) => pickLabel(r),
  line: (r) => r.line,
  proj: (r) => r.proj,
  diff: (r) => r.diff,
  win: (r) => r.win,
  ev: (r) => r.ev,
  ...Object.fromEntries(BOOK_PREF.map((bk) => [bk, (r) => {
    const b = r.priced?.books?.[bk];
    return b ? (b.odds > 0 ? b.odds / 100 : 100 / -b.odds) : null;
  }])),
};

/** The engine's number in the row's own terms, the way the row is a bet. */
function engineText(r) {
  if (r.proj == null) return "—";
  if (r.prop_type === "spread" || r.prop_type === "moneyline") {
    // A priced row's proj is the SIDE's fair handicap; an unpriced one has no
    // side, so it carries the home handicap and reads from the favourite.
    const [team, fair] = r.team ? [r.team, r.proj] : r.proj <= 0 ? [r.home, r.proj] : [r.away, -r.proj];
    return `${team} ${handicap(Number(fair.toFixed(1)))}`;
  }
  return r.proj.toFixed(1);
}

export function GameBoard({ d, games, prop, statusOf, teamF, q, officialMap, cardOnly, onShowFinal, hiddenFinal }) {
  const [sort, setSort] = useState({ col: "diff", dir: "desc" });
  const [open, setOpen] = useState(null);
  const onSort = (col) => setSort((s) => (s.col === col ? { col, dir: s.dir === "desc" ? "asc" : "desc" } : { col, dir: "desc" }));

  const all = useMemo(() => buildGameRows(d, games, prop), [d, games, prop]);
  const officialOf = (r) => officialMap.get(`${r.game.season}|${r.game.game_id}|${gamePickSlot(prop, r.team)}|${prop}`) || null;
  const rows = useMemo(() => {
    const needle = q.trim().toUpperCase();
    const get = SORT_VAL[sort.col] || SORT_VAL.diff;
    const dir = sort.dir === "asc" ? 1 : -1;
    return all
      .filter((r) => teamF === "ALL" || r.home === teamF || r.away === teamF)
      .filter((r) => !needle || `${r.away} ${r.home} ${d.teams[r.away]?.full_name || ""} ${d.teams[r.home]?.full_name || ""}`.toUpperCase().includes(needle))
      .filter((r) => !cardOnly || officialOf(r))
      .sort((a, b) => cmp(get(a), get(b), dir) || SORT_VAL.game(a).localeCompare(SORT_VAL.game(b)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- officialOf reads officialMap
  }, [all, teamF, q, sort, cardOnly, officialMap, d]);

  const anyPriced = rows.some((r) => r.priced);
  const cols = [
    { key: "pick", label: "Pick", title: "The side the engine is on, at the reference book's line." },
    { key: "line", label: "Line", title: "The reference book's number (FanDuel first, then Hard Rock, then DraftKings)." },
    { key: "proj", label: "Engine", title: "The engine's fair number for the side: a handicap on spreads and moneylines, points on totals." },
    { key: "diff", label: "Value", title: "Points of value in the pick's favour: the line against the engine's fair number." },
    { key: "win", label: "Win%", title: "The side's probability, calibrated to the price — within a point or two of the de-vigged market by design." },
    ...(anyPriced ? BOOK_PREF.map((bk) => ({ key: bk, label: <BookHead book={bk} />, title: `${BOOK_NAMES[bk]}'s price on the side` })) : []),
    { key: "ev", label: "EV", title: "Expected return per unit at the best price on the row's line." },
  ];

  return (
    <div style={S.card}>
      <div style={S.cardHead}>
        <div style={S.cardTitle}>
          Game Board · {propShort(prop)}
          {games[0] && <span style={S.badge()}>{weekLabel(games[0].week)}</span>}
          {hiddenFinal > 0 && (
            <span style={{ fontSize: 10, color: C.faint, fontFamily: MON, fontWeight: 400 }}>
              {hiddenFinal} final {hiddenFinal === 1 ? "game" : "games"} hidden
            </span>
          )}
        </div>
        <span style={S.cardMeta}>{rows.length} {prop === "team_total" ? "teams" : "games"} · click a row for the matchup</span>
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: 24, textAlign: "center", color: C.muted, fontSize: 13 }}>
          {cardOnly ? "No official game plays this week — every game market is on probation (see below)."
            : hiddenFinal ? <>Every game on this filter is final. <button style={{ ...S.btn, marginLeft: 6 }} onClick={onShowFinal}>Show finished games</button></>
            : "No games match these filters."}
        </div>
      ) : (
        <div style={S.tblWrap}>
          <table style={S.tbl}>
            <thead>
              <tr>
                <th style={{ ...S.thLeft, minWidth: 190 }}>
                  <SortBtn col="game" sort={sort} onSort={onSort} align="left">Matchup</SortBtn>
                </th>
                {cols.map((c) => (
                  <th key={c.key} style={S.th} title={c.title}>
                    <SortBtn col={c.key} sort={sort} onSort={onSort}>{c.label}</SortBtn>
                  </th>
                ))}
                <th style={{ ...S.th, width: 26 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isOpen = open === r.key;
                const st = STATUS_TAG[statusOf[r.game.game_id]];
                const b = r.priced?.books || {};
                return (
                  <Fragment key={r.key}>
                    <tr className="row-hover" onClick={() => setOpen(isOpen ? null : r.key)}
                      style={{ cursor: "pointer", background: isOpen ? alpha(C.accent, 0.06) : undefined,
                        opacity: statusOf[r.game.game_id] === "final" ? 0.55 : 1 }}>
                      <td style={{ ...S.tdLeft, borderLeft: `3px solid ${readable(d.teams[r.team || r.home]?.color) || C.line}` }}>
                        <MatchupCell r={r} d={d} st={st} official={!!officialOf(r)} />
                      </td>
                      <td style={{ ...S.td, fontWeight: 700, whiteSpace: "nowrap" }}>{pickLabel(r) || "—"}</td>
                      <td style={S.td}>{r.prop_type === "moneyline" ? (r.odds != null ? fmtOdds(r.odds) : "—") : r.prop_type === "spread" ? handicap(r.line) : r.line ?? "—"}</td>
                      <td style={{ ...S.td, color: C.muted }}>{engineText(r)}</td>
                      <td style={{ ...S.td, fontWeight: 700, color: r.diff == null ? C.faintest : r.score >= ZONE.lo && r.score < ZONE.hi ? C.accent : C.txt }}
                        title={r.score == null ? undefined : `${r.score.toFixed(2)} engine spread units from the line — the official band is ${ZONE.lo}–${ZONE.hi}`}>
                        {r.diff == null ? "—" : signed(r.diff)}
                      </td>
                      <td style={S.td}>
                        {r.win == null ? <span style={{ color: C.faintest }}>—</span>
                          : <span title={`Calibrated to the price. The engine alone says ${pct1(r.rawProb)}; the de-vigged market ${pct1(r.mktProb)}.`}
                            style={{ fontWeight: 700, color: C.muted }}>{pct(r.win)}</span>}
                      </td>
                      {anyPriced && BOOK_PREF.map((bk) => (
                        <td key={bk} style={S.td}>
                          <OddsCell book={bk} best={r.book === bk} refLine={r.prop_type === "spread" ? r.line : r.priced?.refLine}
                            lineText={LINE_TEXT[prop]}
                            p={b[bk] && { overOdds: b[bk].odds, line: r.prop_type === "moneyline" ? null : b[bk].line, offLine: b[bk].offLine,
                              modelProb: b[bk].prob, mktProb: b[bk].mktProb, rawProb: b[bk].rawProb, devigged: true, url: b[bk].url }} />
                        </td>
                      ))}
                      <td style={{ ...S.td, color: r.ev == null ? C.faintest : r.ev > 0 ? C.good : C.bad, fontWeight: 600 }}>
                        {r.ev == null ? "—" : `${r.ev > 0 ? "+" : ""}${(r.ev * 100).toFixed(1)}%`}
                      </td>
                      <td style={{ ...S.td, color: C.faint, padding: "9px 6px" }}>{isOpen ? "▾" : "▸"}</td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={cols.length + 2} style={{ padding: 0 }}>
                          <GameDetail r={r} d={d} onClose={() => setOpen(null)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ padding: "10px 14px", fontSize: 10, color: C.faint, borderTop: `1px solid ${C.lineSoft}`, lineHeight: 1.6 }}>
        The engine predicts the score — the points rating, the starting quarterbacks, weather and per-play efficiency
        (research/game-engine-2026-10-14) — and picks its side of each line. Held out it picks 63–64% of straight-up
        winners, and it does NOT beat the closing price: against 2025's closing lines its 0.15–0.45 band went
        41% on spreads, 52% on totals and 45% on moneylines. So Win% is calibrated to the price (it sits on the
        de-vigged market, a touch toward the engine on totals), EV is honest about the juice, and all four game
        markets are on PROBATION: every priced game is frozen before kickoff and graded, and none is official until
        its own in-band record earns it in (≥100 picks, ≥53%, positive ROI). Value is shaded when it sits in that band.
        Team totals have no line history at all; DraftKings and Hard Rock post them later in the week than FanDuel.
      </div>
    </div>
  );
}

function MatchupCell({ r, d, st, official }) {
  const g = r.game;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <TeamLogo src={logoOf(d, r.away)} size={22} />
      <TeamLogo src={logoOf(d, r.home)} size={22} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 12.5, color: C.txt, display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
          {r.away} @ {r.home}
          {r.ttSide && <span style={{ color: readable(d.teams[r.team]?.color), fontFamily: MON, fontSize: 11 }}>· {r.team}</span>}
          {official && <Tag color={C.accent} title="On the official card">OFFICIAL</Tag>}
          {st && <Tag color={st.color}>{st.text}</Tag>}
        </div>
        <div style={{ fontSize: 9.5, color: C.faint, fontFamily: MON, marginTop: 1 }}>
          {kickoff(g.gameday, g.gametime)}
          {r.eng && <> · engine {r.away} {r.eng.away_pts.toFixed(1)}–{r.eng.home_pts.toFixed(1)} {r.home}</>}
        </div>
      </div>
    </div>
  );
}

// ── the matchup ──────────────────────────────────────────────────────────────

const PART_LABEL = { baseline: "League baseline", points: "Points ratings", qb: "Starting QBs",
  weather: "Weather", efficiency: "Per-play efficiency" };

function GameDetail({ r, d, onClose }) {
  const e = r.eng;
  const g = r.game;
  const pick = pickFromGameRow(r);
  const sigma = engineFor(d.year)?.sigma;
  const verdict = pick ? officialVerdict(pick, {}) : null;
  const tc = (t) => readable(d.teams[t]?.color);
  return (
    <div className="fade-in" style={{ background: C.inset, borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}`, padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <TeamLogo src={logoOf(d, r.away)} size={34} />
        <span style={{ fontSize: 15, fontWeight: 700 }}>
          <span style={{ color: tc(r.away) }}>{r.away}</span> @ <span style={{ color: tc(r.home) }}>{r.home}</span>
        </span>
        <TeamLogo src={logoOf(d, r.home)} size={34} />
        <span style={{ fontSize: 11, color: C.muted, fontFamily: MON }}>
          {kickoff(g.gameday, g.gametime)} · {conditions(g, e)}
        </span>
        <div style={{ marginLeft: "auto" }}>
          <button style={S.btnGhost} onClick={(ev) => { ev.stopPropagation(); onClose(); }}>Close</button>
        </div>
      </div>

      {!e ? (
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
          The engine rates the next week once its matchups are set; this game is further out than that.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", marginBottom: 12 }}>
          <Panel title="Engine score">
            <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
              {[["away", r.away, e.away_pts], ["home", r.home, e.home_pts]].map(([k, t, pts]) => (
                <span key={k} style={{ fontFamily: MON }}>
                  <span style={{ color: tc(t), fontWeight: 700 }}>{t}</span>{" "}
                  <span style={{ fontSize: 22, fontWeight: 800 }}>{pts.toFixed(1)}</span>
                </span>
              ))}
            </div>
            <Kv k="Total" v={e.total.toFixed(1)} sub={`points rating alone ${e.points_total.toFixed(1)}`} />
            <Kv k="Margin" v={`${e.margin >= 0 ? r.home : r.away} by ${Math.abs(e.margin).toFixed(1)}`}
              sub={`points rating alone ${e.points_margin >= 0 ? r.home : r.away} by ${Math.abs(e.points_margin).toFixed(1)}`} />
            {sigma && <Kv k={`${r.home} wins`} v={pct(normalCDF(e.margin / sigma.margin))}
              sub="the engine alone, before the price" />}
          </Panel>
          <Panel title="What built it">
            {["total", "margin"].map((t) => (
              <div key={t} style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 9, color: C.faint, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>
                  {t === "total" ? "Total" : `Margin (${r.home} +)`}
                </div>
                {Object.entries(e.parts[t]).map(([k, v]) => (
                  <Kv key={k} k={PART_LABEL[k] || k} v={k === "baseline" ? v.toFixed(1) : signed(v)}
                    color={k === "baseline" ? C.txt : v > 0.05 ? C.good : v < -0.05 ? C.bad : C.muted} />
                ))}
              </div>
            ))}
          </Panel>
          <Panel title="Quarterbacks">
            {["away", "home"].map((s) => {
              const qb = e.qb[s];
              const team = s === "home" ? r.home : r.away;
              return (
                <div key={s} style={{ marginBottom: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 12 }}>
                    <span style={{ color: tc(team) }}>{team}</span> {qb.name || "TBD"}
                    {!qb.known && <Tag color={C.warn} title="No dropbacks on file in the engine's window: rated as an unknown passer, below average.">NEW</Tag>}
                  </div>
                  <div style={{ fontSize: 10, color: C.muted, fontFamily: MON }}>
                    EPA/dropback {signed(qb.epa_db, 3)} vs league · {signed(qb.vs_team, 3)} vs the passers {team}'s ratings were built on
                  </div>
                </div>
              );
            })}
            <div style={{ fontSize: 10, color: C.faint, lineHeight: 1.5 }}>
              The starter is the one input beyond the points rating that clearly earns its place — the difference
              column is what a points rating cannot see: a backup starting, a rookie taking over.
            </div>
          </Panel>
          <Panel title="Efficiency (opponent-adjusted expectation)">
            <Kv k={`${r.away} EPA/play`} v={signed(e.efficiency.away_epa, 3)} />
            <Kv k={`${r.home} EPA/play`} v={signed(e.efficiency.home_epa, 3)} />
            <Kv k={`${r.away} success`} v={pct1(e.efficiency.away_sr)} />
            <Kv k={`${r.home} success`} v={pct1(e.efficiency.home_sr)} />
          </Panel>
        </div>
      )}

      <BookTable r={r} d={d} />

      {verdict && (
        <div style={{ fontSize: 11, color: C.muted, marginTop: 10, fontFamily: MON }}>
          {pickLabel(r)} · {r.score.toFixed(2)} engine spread units from the {r.prop_type === "moneyline" ? "price" : "line"} ·{" "}
          {r.score >= ZONE.lo && r.score < ZONE.hi ? "in the official band" : r.score < ZONE.lo ? "too close to the line" : "gap too large to trust"}
          {" · "}market on probation — frozen and graded, not official
        </div>
      )}
    </div>
  );
}

function conditions(g, e) {
  const w = e?.weather;
  const bits = [];
  if (w?.dome || g.roof === "dome" || g.roof === "closed") bits.push("dome");
  else {
    const temp = w?.temp ?? g.temp, wind = w?.wind ?? g.wind;
    bits.push(temp != null ? `${temp}°` : "temp TBD");
    if (wind != null) bits.push(`${wind} mph`);
  }
  if (g.div_game) bits.push("division");
  if (g.away_rest != null && g.home_rest != null && (g.away_rest !== 7 || g.home_rest !== 7)) bits.push(`rest ${g.away_rest}/${g.home_rest}`);
  return bits.join(" · ");
}

/** Every book's two-sided price on this market, so the reference line is never a mystery. */
function BookTable({ r, d }) {
  const rec = d.gameLines?.get?.(r.game.game_id);
  const sides = r.prop_type === "spread" || r.prop_type === "moneyline" ? [["away", r.away], ["home", r.home]] : [["over", "Over"], ["under", "Under"]];
  const cell = (bk, s) => {
    const m = rec?.[bk]?.[r.prop_type];
    const x = r.prop_type === "team_total" ? m?.[r.ttSide]?.[s] : m?.[s];
    if (!x) return "—";
    const line = r.prop_type === "spread" ? `${handicap(x.line)} ` : r.prop_type === "moneyline" ? "" : `${x.line} `;
    return `${line}${fmtOdds(x.odds)}`;
  };
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ ...S.tbl, width: "auto" }}>
        <thead>
          <tr>
            <th style={S.thLeft}>{propShort(r.prop_type)}{r.ttSide ? ` · ${r.team}` : ""}</th>
            {BOOK_PREF.map((bk) => <th key={bk} style={S.th}><BookHead book={bk} /></th>)}
          </tr>
        </thead>
        <tbody>
          {sides.map(([s, label]) => (
            <tr key={s}>
              <td style={{ ...S.tdLeft, fontWeight: 600, color: r.side === s ? C.accent : C.txt }}>{label}{r.side === s ? " ◂ engine" : ""}</td>
              {BOOK_PREF.map((bk) => <td key={bk} style={{ ...S.td, fontFamily: MON }}>{cell(bk, s)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <div style={{ background: alpha(C.panelSolid, 0.6), border: `1px solid ${C.line}`, borderRadius: 8, padding: "9px 11px" }}>
      <div style={{ ...S.sectionLabel, marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}

function Kv({ k, v, sub, color }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, fontSize: 11, padding: "2px 0" }}>
      <span style={{ color: C.muted }}>{k}{sub && <span style={{ color: C.faint, fontSize: 9.5 }}> · {sub}</span>}</span>
      <span style={{ fontFamily: MON, fontWeight: 700, color: color || C.txt }}>{v}</span>
    </div>
  );
}
