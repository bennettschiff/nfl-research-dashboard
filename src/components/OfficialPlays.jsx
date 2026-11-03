// ── Official Plays ───────────────────────────────────────────────────────────
// The card, and nothing but the card: every pick the engine stands behind for a
// week, player props and game lines together, with how each one settled. The
// Board grades every priced row and shows them all; the Results tab is the
// record's audit; this is the answer to "what are the plays".
//
// READ FROM THE LEDGER, never recomputed. A verdict is frozen onto the pick
// before kickoff (src/lib/officialPicks.js, scripts/snapshot_picks.mjs), so a
// play shown here is exactly the one the official record grades — it moves when
// the snapshot does, after each odds pull and the injury pass.
//
// GAME LINES ARE ON PROBATION (src/lib/gameMarkets.js): against 2025's closing
// lines no band of the engine held up, so no spread, total, moneyline or team
// total is official until its own in-band record earns it in. They are shown in
// their own section as TRACKED — the engine's in-band plays, frozen and graded
// like the card, with each market's progress toward earning in — so the market
// can be watched without being mistaken for a play.
import { useEffect, useMemo, useState } from "react";
import { loadPlays } from "../lib/picks.js";
import { summarize, BASELINE, inBaseline } from "../lib/pickLedger.js";
import { isOfficialCard, marketStanding, inZone, officialScore, EARN, ZONE } from "../lib/officialPicks.js";
import { GAME_PROPS, isGameProp, gamePickText } from "../lib/gameMarkets.js";
import { isOneSided } from "../lib/props.js";
import { defaultWeek } from "../lib/roster.js";
import { cmp } from "../lib/boardSort.js";
import { S, C, MON, alpha, readable } from "../lib/theme.js";
import { pct, pct1, units, fmtOdds, weekLabel, propShort } from "../lib/format.js";
import { headshotOf, logoOf } from "../lib/headshots.js";
import { BOOK_ABBR, BOOK_COLORS } from "../lib/betslip.js";
import { Empty, StatTile, Tag, SortBtn, Headshot, TeamLogo } from "./ui.jsx";
import { Dropdown } from "./FilterBar.jsx";

const MARKETS = [["all", "All markets"], ["props", "Player props"], ["games", "Game lines"]];

/** A pick the way a slip prints it. */
function playLabel(p) {
  const line = p.line == null ? "" : Number(p.line);
  if (p.prop_type === "total") return `${p.direction === "under" ? "Under" : "Over"} ${line}`;
  if (isGameProp(p.prop_type)) return gamePickText(p);
  if (isOneSided(p.prop_type)) return p.prop_type === "anytime_td" ? "Yes" : `o${line}`;
  return `${p.direction === "under" ? "u" : "o"}${line}`;
}

/**
 * Does a two-sided player prop take the side the projection points AWAY from?
 * The side is the price-calibrated Win% (models.js calibrateToMarket), which is
 * the de-vigged price plus an under lean and a sixth of the model's view, so a
 * 61 into a 47.5 at a coin-flip price is an under. Since official@2026-10-15
 * such a play is never official (officialPicks.js sideWithProjection); cards
 * stamped before it — most of weeks 5 and 6 — still hold them, and say so.
 */
function againstEngine(p) {
  if (isGameProp(p.prop_type) || isOneSided(p.prop_type)) return false;
  const proj = Number(p.proj_mean), line = Number(p.line);
  if (p.proj_mean == null || p.line == null || proj === line) return false;
  return (proj > line ? "over" : "under") !== p.direction;
}

const SORT = {
  kick: (p) => p.kickoff_at,
  play: (p) => (p.player_name || "").toLowerCase(),
  market: (p) => propShort(p.prop_type),
  odds: (p) => (p.book_odds == null ? null : p.book_odds > 0 ? p.book_odds / 100 : 100 / -p.book_odds),
  win: (p) => (p.side_prob == null ? null : Number(p.side_prob)),
  ev: (p) => (p.ev == null ? null : Number(p.ev)),
  score: (p) => officialScore(p),
  result: (p) => ({ win: 3, push: 2, pending: 1, loss: 0, void: -1 })[p.outcome] ?? null,
};

export function OfficialPlays({ season, d }) {
  const [picks, setPicks] = useState(null);
  const [err, setErr] = useState(null);
  const [wk, setWk] = useState(() => defaultWeek(d.games));
  const [mkt, setMkt] = useState("all");

  useEffect(() => { loadPlays({ season }).then(setPicks).catch((e) => setErr(e.message || String(e))); }, [season]);

  const live = useMemo(() => (picks || []).filter((p) => p.source === "auto"), [picks]);
  const official = useMemo(() => live.filter(isOfficialCard), [live]);
  const gamePicks = useMemo(() => live.filter((p) => isGameProp(p.prop_type)), [live]);
  const weeks = useMemo(() => {
    const s = new Set(d.games.filter((g) => g.week <= Math.max(wk, defaultWeek(d.games))).map((g) => g.week));
    for (const p of live) s.add(p.week);
    return [...s].filter((w) => w != null).sort((a, b) => a - b);
  }, [live, d, wk]);

  const keepMkt = (p) => mkt === "all" || (mkt === "games") === isGameProp(p.prop_type);
  const card = useMemo(() => official.filter((p) => p.week === wk).filter(keepMkt),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keepMkt reads mkt
    [official, wk, mkt]);
  const tracked = useMemo(() => gamePicks
    .filter((p) => p.week === wk && !p.official && inZone(officialScore(p))), [gamePicks, wk]);
  // Each game market's standing on its own graded in-band record — the same
  // rule that decides when it earns onto the card.
  const standing = useMemo(() => marketStanding(gamePicks), [gamePicks]);

  const weekRec = summarize(card);
  const seasonRec = summarize(official.filter(inBaseline).filter(keepMkt));

  if (err && !picks) return <Empty>Couldn’t load the plays. <span style={{ color: C.faint }}>{err}</span></Empty>;
  if (!picks) return <Empty>Loading the card…</Empty>;

  return (
    <div>
      <div style={S.filterBar}>
        <Dropdown label="Week" display={weekLabel(wk)} selected={wk} onChange={setWk}
          options={weeks.map((w) => ({ value: w, label: weekLabel(w),
            sub: `${official.filter((p) => p.week === w).length} plays` }))} />
        <Dropdown label="Markets" display={MARKETS.find(([k]) => k === mkt)[1]} selected={mkt} changed={mkt !== "all"}
          onChange={setMkt} options={MARKETS.map(([value, label]) => ({ value, label }))} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8, marginBottom: 12 }}>
        <StatTile label={`${weekLabel(wk)} card`} v={`${card.length} plays`}
          sub={`${weekRec.pending} pending · ${weekRec.win}–${weekRec.loss}${weekRec.push ? `–${weekRec.push}` : ""}`} />
        <StatTile label={`${weekLabel(wk)} units`} v={units(weekRec.staked ? weekRec.profit : null)}
          color={weekRec.profit > 0 ? C.good : weekRec.profit < 0 ? C.bad : undefined}
          sub={weekRec.winPct == null ? "nothing settled yet" : `${pct1(weekRec.winPct)} won`} />
        <StatTile label={`Since week ${BASELINE.week}`} v={`${seasonRec.win}–${seasonRec.loss}`}
          sub={seasonRec.roi == null ? "official card" : `${units(seasonRec.profit)} · ROI ${pct1(seasonRec.roi)}`}
          color={seasonRec.profit > 0 ? C.good : seasonRec.profit < 0 ? C.bad : undefined} />
        <StatTile label="Game lines" v="Probation"
          sub={`${tracked.length} tracked in-band this week`} color={C.warn} />
      </div>

      <PlaysTable title="Official card" week={wk} rows={card} d={d}
        empty={mkt === "games"
          ? "No official game plays — every game market is on probation until its own record earns it in (below)."
          : "No official plays on this week's card yet — books post most props later in the week, and the card is re-stamped after every odds pull."}
        foot={`The plays the engine stands behind, frozen before kickoff: a core or earned market, a projection ${ZONE.lo}–${ZONE.hi} spread units from the line (the band that held up on 2025 — bigger gaps lost), a price, no injury designation, and a side the projection agrees with — the Win% calibrated to the price picks the side, and a play whose side runs against the engine's own number is not on the card (weeks stamped before 2026-10-15 can still hold one, tagged VS ENGINE). It is a thin edge. Every other priced row is still graded on the Results tab.`} />

      {mkt !== "props" && (
        <PlaysTable title="Game lines — tracked on probation" week={wk} rows={tracked} d={d} tracked
          header={<StandingStrip standing={standing} />}
          empty="No in-band game plays this week yet."
          foot={`The engine's spread, total, moneyline and team-total plays ${ZONE.lo}–${ZONE.hi} of its own spread units from the line. NOT official: against 2025's closing lines that band went 41% on spreads, 52% on totals and 45% on moneylines, and team totals have no line history at all. Each is frozen and graded like the card, and a market joins the card once its own graded in-band picks reach ${EARN.minN} at ${pct(EARN.minWin)}+ with positive ROI.`} />
      )}
    </div>
  );
}

function StandingStrip({ standing }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "8px 14px", borderBottom: `1px solid ${C.lineSoft}` }}>
      {GAME_PROPS.map((k) => {
        const s = standing[k] || { n: 0, wins: 0, status: "probation" };
        const earned = s.status === "earned";
        return (
          <span key={k} title={`${s.n} graded in-band picks of the ${EARN.minN} needed; it earns in at ${pct(EARN.minWin)}+ with positive ROI`}
            style={{ fontSize: 10, fontFamily: MON, padding: "3px 8px", borderRadius: 999,
              border: `1px solid ${alpha(earned ? C.good : C.warn, 0.35)}`, color: earned ? C.good : C.muted,
              background: alpha(earned ? C.good : C.warn, 0.08) }}>
            {propShort(k)} · {s.n}/{EARN.minN}{s.n ? ` · ${s.wins}–${s.n - s.wins}${s.roi != null ? ` ${s.roi >= 0 ? "+" : ""}${(s.roi * 100).toFixed(0)}%` : ""}` : ""}
            {earned ? " · EARNED" : ""}
          </span>
        );
      })}
    </div>
  );
}

function PlaysTable({ title, week, rows, d, empty, foot, header, tracked }) {
  const [sort, setSort] = useState({ col: "kick", dir: "asc" });
  const onSort = (col) => setSort((s) => (s.col === col ? { col, dir: s.dir === "desc" ? "asc" : "desc" } : { col, dir: col === "kick" || col === "play" ? "asc" : "desc" }));
  const sorted = useMemo(() => {
    const get = SORT[sort.col] || SORT.kick;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => cmp(get(a), get(b), dir) || cmp(SORT.kick(a), SORT.kick(b), 1));
  }, [rows, sort]);
  const cols = [["market", "Market"], ["kick", "Kickoff"], ["odds", "Price"], ["win", "Win%"], ["ev", "EV"],
    ["score", "Score"], ["result", "Result"]];
  return (
    <div style={S.card}>
      <div style={S.cardHead}>
        <div style={S.cardTitle}>{title}<span style={S.badge()}>{weekLabel(week)}</span>
          {tracked && <Tag color={C.warn}>NOT OFFICIAL</Tag>}</div>
        <span style={S.cardMeta}>{rows.length} {rows.length === 1 ? "play" : "plays"}</span>
      </div>
      {header}
      {rows.length === 0 ? (
        <div style={{ padding: 20, textAlign: "center", color: C.muted, fontSize: 12.5 }}>{empty}</div>
      ) : (
        <div style={S.tblWrap}>
          <table style={S.tbl}>
            <thead>
              <tr>
                <th style={{ ...S.thLeft, minWidth: 230 }}><SortBtn col="play" sort={sort} onSort={onSort} align="left">Play</SortBtn></th>
                {cols.map(([k, l]) => <th key={k} style={S.th}><SortBtn col={k} sort={sort} onSort={onSort}>{l}</SortBtn></th>)}
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => <PlayRow key={p.pick_key || p.id} p={p} d={d} />)}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ padding: "10px 14px", fontSize: 10, color: C.faint, borderTop: `1px solid ${C.lineSoft}`, lineHeight: 1.6 }}>{foot}</div>
    </div>
  );
}

function PlayRow({ p, d }) {
  const game = isGameProp(p.prop_type);
  const [away, home] = (p.player_name || "").split(" @ ");
  const score = officialScore(p);
  const res = p.outcome;
  const resColor = res === "win" ? C.good : res === "loss" ? C.bad : C.muted;
  const brand = BOOK_COLORS[p.book] ? readable(BOOK_COLORS[p.book]) : C.muted;
  return (
    <tr className="row-hover">
      <td style={{ ...S.tdLeft, borderLeft: `3px solid ${readable(d.teams[p.team || home]?.color) || C.line}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          {game ? (
            <span style={{ display: "inline-flex", gap: 2 }}>
              <TeamLogo src={logoOf(d, away)} size={22} /><TeamLogo src={logoOf(d, home)} size={22} />
            </span>
          ) : (
            <Headshot src={headshotOf(d, p.player_id)} logo={logoOf(d, p.team)} name={p.player_name} size={30} />
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 12.5 }}>
              {game ? playLabel(p) : <>{p.player_name} <span style={{ fontFamily: MON }}>{playLabel(p)}</span></>}
              {againstEngine(p) && <> <Tag color={C.warn}
                title={`The engine projects ${Number(p.proj_mean).toFixed(1)}, ${Number(p.proj_mean) > Number(p.line) ? "over" : "under"} the ${Number(p.line)} line. The projection only qualifies a play (how far it sits from the line); the side is the Win% calibrated to the price, which leans ${p.direction} here.`}>
                VS ENGINE</Tag></>}
            </div>
            <div style={{ fontSize: 9.5, color: C.faint, fontFamily: MON, marginTop: 1 }}>
              {game ? p.player_name : `${p.position} · ${p.team} vs ${p.opp}`}
              {p.proj_mean != null && ` · engine ${engineNote(p)}`}
            </div>
          </div>
        </div>
      </td>
      <td style={S.td}>{propShort(p.prop_type)}</td>
      <td style={{ ...S.td, color: C.muted, whiteSpace: "nowrap" }}>{p.kickoff_at ? kickoffOf(p.kickoff_at) : "—"}</td>
      <td style={{ ...S.td, whiteSpace: "nowrap" }}>
        <span style={{ fontFamily: MON, fontWeight: 700 }}>{fmtOdds(p.book_odds)}</span>
        {p.book && <span style={{ fontSize: 9, color: brand, marginLeft: 4 }}>{BOOK_ABBR[p.book] || p.book}</span>}
      </td>
      <td style={{ ...S.td, fontWeight: 700 }}>{pct(p.side_prob == null ? null : Number(p.side_prob))}</td>
      <td style={{ ...S.td, color: p.ev == null ? C.faintest : Number(p.ev) > 0 ? C.good : C.bad }}>
        {p.ev == null ? "—" : `${Number(p.ev) > 0 ? "+" : ""}${(Number(p.ev) * 100).toFixed(1)}%`}
      </td>
      <td style={{ ...S.td, color: C.muted }}>{score == null ? "—" : score.toFixed(2)}</td>
      <td style={{ ...S.td, fontWeight: 700, color: resColor, whiteSpace: "nowrap" }}
        title={p.actual != null ? `Actual ${p.actual}` : undefined}>
        {res === "pending" ? "pending" : res.toUpperCase()}
        {p.actual != null && res !== "pending" && <span style={{ color: C.faint, fontWeight: 400 }}> · {Number(p.actual)}</span>}
        {res !== "pending" && p.profit != null && <span style={{ color: resColor, fontWeight: 500 }}> {units(Number(p.profit))}</span>}
      </td>
    </tr>
  );
}

/** The engine's number behind a play: a winner and margin, or points. */
function engineNote(p) {
  const m = Number(p.proj_mean);
  if (p.prop_type !== "spread" && p.prop_type !== "moneyline") return m.toFixed(1);
  return m >= 0 ? `${p.team} by ${m.toFixed(1)}` : `${p.opp} by ${Math.abs(m).toFixed(1)}`;
}

/** A pick's kickoff instant → "Sun 1:00p" in Eastern, the way the slate prints it. */
function kickoffOf(iso) {
  const t = new Date(iso);
  const day = t.toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" });
  const time = t.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })
    .replace(" AM", "a").replace(" PM", "p");
  return `${day} ${time}`;
}
