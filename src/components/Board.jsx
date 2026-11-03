// ── Projections Board ────────────────────────────────────────────────────────
// The headline view: for a chosen week, project every projectable player vs
// their ACTUAL scheduled opponent and rank the slate. Matchup "tilt" is the
// scheme multiplier (coverage / box / pressure) the model applies vs that
// defense — the football analog of the MLB board's edge column.
//
// LAYOUT NOTES (the 2026 design pass):
//   · The separate "sort" pill row is gone. Every numeric column sorts from its
//     own header, so the control and the thing it orders are the same object.
//   · Position, team and opponent live INSIDE the player cell as a sub-line.
//     Four columns became one, which is what buys the row density.
//   · A row expands in place instead of navigating away. The old click threw you
//     onto a full-page panel and lost your scroll position and your filters;
//     the expansion answers "why this number" without leaving the board, and
//     still offers the full panel behind one more click.
//
// ── THE ROW IS NOW (PLAYER, PROP), NOT (PLAYER) ──────────────────────────────
// It used to be one row per player, showing the single prop `headlineProp()`
// picked for his position. Every other market the model prices was reachable
// only by expanding the row, which meant the whole anytime-TD board — the market
// with the most positions in it — could not be looked at as a board at all, and
// "show me every ATD on the slate, sorted" was not a question the page could
// answer. Props are now toggles (src/lib/props.js) and each selected prop is its
// own sortable row. The board OPENS on anytime TD alone, in the Odds section:
// one market every position shares, ranked by price-adjacent belief, rather than
// six markets stacked into six rows per player.
//
// ── FINISHED GAMES LEAVE THE BOARD; THE FILTERS ARE A BAR (2026-09-12) ───────
// The board never knew a game had been played: on the Saturday after the opener
// every Seattle and New England prop was still on it. Game status is now a
// clock read (src/lib/gameStatus.js) and a final game's rows are hidden unless
// you pick that game or ask for finished games back. A live game stays, tagged.
//
// The controls moved to a props.cash-style filter bar of labelled dropdowns
// (Week · Sections · Games · Position · Props · Team · Player · Include), and
// the table's columns come in sections — Model, Hit Rates, Odds — over a shared
// core. See BoardColumns.jsx.
//
// ── ONE MARKET, AND THE DEFENCE IS ONE OF THEM (2026-09-18) ─────────────────
// The Props dropdown was a multi-select, so clicking a second market ADDED it:
// picking REC YDS while the board was on ANY TD gave you both, doubled the row
// count and left a table nothing could be ranked across. It is one market now.
//
// And sacks are one of the markets. They had a tab — a second board with its own
// week picker, its own filter bar and its own table, for a single market — which
// is also what kept them out of the pick ledger and off the Results tab. A sack
// row (src/lib/sackRows.js) is now the same row as a receiving row: a line, a
// projection, a probability at that line, a price. The Odds section's book
// columns still follow the market through SACK_BOOKS — which today aliases
// BOOK_PREF, so the same three headers stand on every market and Hard Rock
// simply reads as a dash on a sack row. The frozen projection record moves in
// beside the table it describes.
//
// ── THE OFFICIAL CARD (2026-09-16) ───────────────────────────────────────────
// Every priced row is still a graded pick. A row the ledger stamped official
// (src/lib/officialPicks.js) carries an OFFICIAL tag, and the Card filter narrows
// the board to them. The tag is read from the ledger, not recomputed here, so it
// is exactly the card the official record grades.
import { Fragment, useEffect, useMemo, useState } from "react";
import { defaultWeek } from "../lib/roster.js";
import { BOOK_PREF, SACK_BOOKS } from "../lib/odds.js";
import { buildBoardRows } from "../lib/boardRows.js";
import { buildSackRows } from "../lib/sackRows.js";
import { propMenuFor, defaultPropFor, isDefProp } from "../lib/props.js";
import { GAME_PROPS, isGameProp } from "../lib/gameMarkets.js";
import { engineFor } from "../lib/gameEngine.js";
import { comparatorFor } from "../lib/boardSort.js";
import { gameStatus } from "../lib/gameStatus.js";
import { withSnapWeeks } from "../lib/snapWeekly.js";
import { pickKey } from "../lib/pickLedger.js";
import { loadOfficialCard } from "../lib/picks.js";
import { S, C, MON, POS_COLORS, alpha, readable } from "../lib/theme.js";
import { headshotOf, logoOf } from "../lib/headshots.js";
import { pct, propShort, weekLabel, fmtOdds, kickoff } from "../lib/format.js";
import { BOOK_NAMES } from "../lib/betslip.js";
import { Tag, SortBtn, AvailChip, Headshot, TeamLogo } from "./ui.jsx";
import { Dropdown, Field } from "./FilterBar.jsx";
import { SECTIONS, columnsFor } from "./BoardColumns.jsx";
import { WeekSlate } from "./WeekSlate.jsx";
import { GameBoard } from "./GameBoard.jsx";
import { ModelBreakdown } from "./ModelBreakdown.jsx";
import { MatchupContext } from "./MatchupContext.jsx";
import { GameLog } from "./GameLog.jsx";
import { RoleCard } from "./RoleCard.jsx";
import { SnapRoom } from "./SnapCounts.jsx";
import { SackRecord } from "./SackRecord.jsx";
import { SackDetail } from "./SackDetail.jsx";

/**
 * The position filter, offence then defence.
 *
 * The defensive entries are position GROUPS as nflverse charts them and as the
 * sack model keeps its rates (DL / LB / DB, not DE / OLB / CB), and picking one
 * switches the board to the only market they have — see `onPos`.
 */
const POS_FILTERS = [["ALL", "All", null], ["QB", "QB", null], ["RB", "RB", null],
  ["WR", "WR", null], ["TE", "TE", null],
  ["DL", "DL", "Defensive line — sacks"], ["LB", "LB", "Linebackers — sacks"],
  ["DB", "DB", "Secondary — sacks"]];
/**
 * The board opens on the Odds section: the prices are the reason to look, and
 * the model's own reads (tilt, conviction, baseline) are context for a price
 * rather than the headline. Falls back to Model when the week has no lines
 * pulled yet — see `effSection`, which is what the dropdown actually shows.
 */
const DEFAULT_SECTION = "odds";
const ROW_CAP = 250;
const ALL = "ALL";

const STATUS_TAG = {
  live: { text: "LIVE", color: C.good },
  final: { text: "FINAL", color: C.faint },
};

/** "2026-09-13" → "Sep 13". */
const monthDay = (gameday) => {
  if (!gameday) return "";
  const [y, m, d] = gameday.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};

/**
 * A clock that ticks once a minute, so a game that ends while the tab is open
 * leaves the board without a reload.
 */
function useNow(ms = 60_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function Board({ d, onPick }) {
  const now = useNow();
  const weeks = useMemo(() => [...new Set(d.games.map((g) => g.week))].sort((a, b) => a - b), [d]);
  const [wk, setWk] = useState(() => defaultWeek(d.games));
  const [section, setSection] = useState(DEFAULT_SECTION);
  const [posF, setPosF] = useState(ALL);
  // ONE market, not a set. See the header.
  const [prop, setProp] = useState(() => defaultPropFor(ALL));
  const [sort, setSort] = useState({ col: "win", dir: "desc" });
  const [q, setQ] = useState("");
  const [teamF, setTeamF] = useState(ALL);
  const [showOut, setShowOut] = useState(false);
  const [showFinal, setShowFinal] = useState(false);
  const [game, setGame] = useState(null);       // slate filter
  const [openRow, setOpenRow] = useState(null); // inline expansion
  const [cardF, setCardF] = useState(ALL);
  const [card, setCard] = useState({ key: null, map: new Map() });

  const weekGames = useMemo(
    () => d.games.filter((g) => g.week === wk)
      .sort((a, b) => `${a.gameday} ${a.gametime}`.localeCompare(`${b.gameday} ${b.gametime}`)),
    [d, wk]);

  const engine = useMemo(() => engineFor(d.year), [d.year]);

  // game_id → upcoming | live | final, re-read every tick of the clock.
  const statusOf = useMemo(
    () => Object.fromEntries(d.games.map((g) => [g.game_id, gameStatus(g, now)])),
    [d, now]);
  const finalGames = weekGames.filter((g) => statusOf[g.game_id] === "final");

  // The week's official card, from the ledger. A failed read leaves the board
  // exactly as it was — no tags, and the Card filter says it has nothing.
  useEffect(() => {
    let live = true;
    const key = `${d.year}|${wk}`;
    loadOfficialCard({ season: d.year, week: wk })
      .then((map) => { if (live) setCard({ key, map }); })
      .catch(() => { if (live) setCard({ key, map: new Map() }); });
    return () => { live = false; };
  }, [d.year, wk]);
  const officialMap = card.key === `${d.year}|${wk}` ? card.map : new Map();
  const officialOf = (r) => officialMap.get(pickKey(r.game.season, r.game.game_id, r.player_id, r.prop_type)) || null;

  // One row per (player, prop) — see src/lib/boardRows.js, which the pick
  // ledger shares so the record it keeps is of exactly these rows. The defensive
  // market arrives the same way (src/lib/sackRows.js) and is concatenated rather
  // than special-cased: from here down a sack row is just a row.
  const rows = useMemo(
    () => [...buildBoardRows(d, weekGames), ...buildSackRows(d, weekGames)],
    [d, weekGames]);

  // THE CONDITIONAL COLUMNS ARE SCOPED TO THE SELECTED MARKET, because that is
  // the table they describe. A sack row carries no baseline provenance, so the
  // Baseline column on a sack board would be a column of dashes; and a market
  // with no lines pulled has no Odds section even when another market does.
  const rowsFor = (t) => rows.filter((r) => r.prop_type === t);
  const propRows = useMemo(() => rowsFor(prop),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rowsFor reads exactly these
    [rows, prop]);
  // Only surface the provenance column once baselines are actually carried —
  // on a finished season every row is measured and the column is noise.
  const anyCarryover = propRows.some((r) => r.carryover);
  // Same rule for the market columns: before the week's pull they are all blank.
  const anyMarket = propRows.some((r) => r.priced);
  // …and for availability: no report filed yet means an empty column.
  const anyAvail = propRows.some((r) => r.avail.label);
  const outCount = anyAvail ? new Set(propRows.filter((r) => r.ruledOut).map((r) => r.player_id)).size : 0;
  // The Odds section's price columns follow the MARKET, not the board.
  const books = isDefProp(prop) ? SACK_BOOKS : BOOK_PREF;

  const teamOptions = useMemo(
    () => [...new Set(rows.map((r) => r.team))].sort(), [rows]);

  const propMenu = useMemo(() => propMenuFor(posF), [posF]);

  // A final game is hidden unless the reader asked for finished games back, or
  // picked that game on purpose — clicking a FINAL slate card is a request to
  // look at it, and answering it with an empty board would read as broken.
  const visibleGame = (r) => showFinal || game?.game_id === r.game.game_id || statusOf[r.game.game_id] !== "final";

  // Everything EXCEPT the market choice. (The Week Leaders strip used to read
  // this and sat above the table; it was dropped 2026-10-14 as more cumbersome
  // than useful — the sortable columns answer "who tops the week" directly.)
  const scoped = useMemo(() => rows
    .filter(visibleGame)
    .filter((r) => posF === ALL || r.pos === posF)
    .filter((r) => teamF === ALL || r.team === teamF)
    .filter((r) => !game || r.game.game_id === game.game_id)
    .filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()))
    .filter((r) => showOut || !r.ruledOut)
    .filter((r) => cardF === ALL || !!officialOf(r)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- visibleGame and officialOf read exactly these
    [rows, posF, teamF, game, q, showOut, showFinal, statusOf, cardF, card]);

  const filtered = useMemo(
    () => scoped.filter((r) => r.prop_type === prop).sort(comparatorFor(sort.col, sort.dir === "asc" ? 1 : -1)),
    [scoped, prop, sort]);

  const effSection = section === "odds" && !anyMarket ? "model" : section;   // no lines pulled → no Odds section to show
  const cols = columnsFor(effSection, { anyCarryover, anyMarket, year: d.year, books });

  const onSort = (col) => setSort((s) =>
    s.col === col ? { col, dir: s.dir === "desc" ? "asc" : "desc" } : { col, dir: "desc" });

  const onSection = (k) => {
    setSection(k);
    // A sort on a column the new section does not show would order the table by
    // something invisible. Keep it if it is still on screen, else the section's own.
    const next = columnsFor(k, { anyCarryover, anyMarket, year: d.year, books }).map((c) => c.key);
    if (![...next, "name", "pos", "avail"].includes(sort.col)) {
      setSort({ col: SECTIONS.find((x) => x.key === k)?.defaultSort || "win", dir: "desc" });
    }
  };
  const onPos = (k) => {
    setPosF(k);
    // Each position opens on its own market, and for a defensive group that is
    // the only one it has — picking DL is a request to look at sacks.
    const next = defaultPropFor(k);
    if (next) setProp(next);
    setOpenRow(null);
  };
  const onProp = (t) => {
    setProp(t);
    setOpenRow(null);
    // A game market is its own table (GameBoard) with its own sort; nothing
    // below applies to it.
    if (isGameProp(t)) return;
    // Switching market can take the sorted column off the table — DraftKings
    // does not post sacks, and a defensive row has no hit rates — and a table
    // ordered by a column nobody can see reads as unsorted. Same guard as
    // onSection, resolved against the market being switched TO.
    const next = rowsFor(t);
    const sec = isDefProp(t) && section === "hits" ? "model" : section;
    if (sec !== section) setSection(sec);
    const keys = columnsFor(sec === "odds" && !next.some((r) => r.priced) ? "model" : sec, {
      anyCarryover: next.some((r) => r.carryover),
      anyMarket: next.some((r) => r.priced),
      year: d.year,
      books: isDefProp(t) ? SACK_BOOKS : BOOK_PREF,
    }).map((c) => c.key);
    if (![...keys, "name", "pos", "avail"].includes(sort.col)) {
      setSort({ col: SECTIONS.find((x) => x.key === sec)?.defaultSort || "win", dir: "desc" });
    }
  };
  const pickGame = (g) => { setGame(g); setOpenRow(null); };

  const shown = filtered.slice(0, ROW_CAP);
  // Player column + spec columns + the chevron.
  const colCount = cols.length + 2;

  // ── filter bar options ──────────────────────────────────────────────────────
  const weekOptions = weeks.map((w) => {
    const gs = d.games.filter((g) => g.week === w);
    const st = gs.map((g) => statusOf[g.game_id]);
    const tag = st.length && st.every((x) => x === "final") ? STATUS_TAG.final
      : st.includes("live") ? STATUS_TAG.live : null;
    const first = gs.map((g) => g.gameday).filter(Boolean).sort()[0];
    return { value: w, label: weekLabel(w), sub: tag?.text || monthDay(first), subColor: tag?.color };
  });

  const byStatus = (k) => weekGames.filter((g) => statusOf[g.game_id] === k);
  const gameOption = (g) => {
    const st = statusOf[g.game_id];
    return {
      value: g.game_id, label: `${g.away_team} @ ${g.home_team}`,
      sub: STATUS_TAG[st]?.text || kickoff(g.gameday, g.gametime), subColor: STATUS_TAG[st]?.color,
    };
  };
  const gameOptions = [
    { value: ALL, label: "All Games", sub: `${weekGames.length - (showFinal ? 0 : finalGames.length)}` },
    ...[["live", "Live"], ["upcoming", "Upcoming"], ["final", showFinal ? "Final" : "Final · hidden unless picked"]]
      .flatMap(([k, cap]) => {
        const gs = byStatus(k);
        return gs.length ? [{ section: cap }, ...gs.map(gameOption)] : [];
      }),
  ];

  const propChanged = prop !== defaultPropFor(posF);
  // Spread / total / moneyline / team total: a game-level board in place of the
  // player table. The filters that describe a PLAYER (sections, injuries) have
  // nothing to act on there and step aside.
  const gameMode = isGameProp(prop);
  const gameRowsFor = weekGames.filter((g) => showFinal || game?.game_id === g.game_id || statusOf[g.game_id] !== "final")
    .filter((g) => !game || g.game_id === game.game_id);

  const include = new Set([...(showFinal ? ["final"] : []), ...(showOut ? ["out"] : [])]);
  const includeDisplay = include.size === 0 ? "Active only"
    : [showFinal && "Final", showOut && "Out"].filter(Boolean).join(" + ");

  const allFinal = weekGames.length > 0 && finalGames.length === weekGames.length;

  return (
    <div>
      <div style={S.filterBar}>
        <Dropdown label="Week" display={weekLabel(wk)} selected={wk} options={weekOptions}
          onChange={(w) => { setWk(w); setGame(null); setOpenRow(null); }} />
        {!gameMode && <Dropdown label="Sections" display={SECTIONS.find((x) => x.key === effSection)?.label}
          selected={effSection} changed={section !== DEFAULT_SECTION} onChange={onSection}
          options={SECTIONS.map((x) => ({
            value: x.key, label: x.label,
            // A defensive row has no game log to count hits over — the only
            // sack history the app bundles is this season's actuals — so the
            // section is closed rather than shown as a wall of dashes.
            disabled: (x.key === "odds" && !anyMarket) || (x.key === "hits" && isDefProp(prop)),
            sub: x.key === "odds" && !anyMarket ? "no lines yet"
              : x.key === "hits" && isDefProp(prop) ? "offense only" : null,
          }))} />}
        <Dropdown label="Games" selected={game?.game_id ?? ALL} options={gameOptions} changed={!!game}
          display={game ? `${game.away_team} @ ${game.home_team}` : "All Games"}
          onChange={(id) => pickGame(id === ALL ? null : weekGames.find((g) => g.game_id === id))} />
        <Dropdown label="Card" selected={cardF} changed={cardF !== ALL}
          display={cardF === ALL ? "All Picks" : "Official"} onChange={(v) => { setCardF(v); setOpenRow(null); }}
          options={[
            { value: ALL, label: "All Picks", title: "Every row the model prices — all of them are graded" },
            { value: "official", label: "Official", sub: `${officialMap.size}`,
              title: "The rows the engine stands behind: a core or earned market, a moderate gap to the line, a price, no injury designation" },
          ]} />
        <Dropdown label="Position" selected={posF} changed={posF !== ALL}
          display={posF === ALL ? "All" : posF} onChange={onPos}
          options={POS_FILTERS.map(([k, l, title]) => ({ value: k, label: l, title }))} />
        <Dropdown label="Props" selected={prop} display={propShort(prop)} changed={propChanged}
          onChange={onProp}
          options={[...propMenu.map(({ type, on }) => ({
            value: type, label: propShort(type),
            sub: on ? "default" : isDefProp(type) ? "defense" : null,
            title: isDefProp(type)
              ? "The one defensive market the model prices. One-sided: the line is a rung (0.25 / 0.5 / 0.75 / 1.0) and Win% is the chance he clears it."
              : undefined,
          })), ...GAME_PROPS.map((type) => ({
            value: type, label: propShort(type), sub: "game",
            title: "Priced by the game engine against the game lines. On probation: graded, not official.",
          }))]} />
        <Dropdown label="Team" selected={teamF} changed={teamF !== ALL}
          display={teamF === ALL ? "All Teams" : teamF} onChange={setTeamF}
          options={[{ value: ALL, label: "All Teams" }, ...teamOptions.map((t) => ({ value: t, label: t }))]} />
        <Field label="Player" grow>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search player…"
            style={{ ...S.searchIn, padding: "8px 10px", borderRadius: 7, background: C.panel }} />
        </Field>
        <Dropdown label="Include" multi selected={include} display={includeDisplay} changed={include.size > 0}
          onChange={(k) => (k === "final" ? setShowFinal((v) => !v) : setShowOut((v) => !v))}
          options={[
            { value: "final", label: "Finished games", sub: `${finalGames.length}`,
              title: "Games that have ended. Their props are settled — hidden by default." },
            { value: "out", label: "Ruled out / inactive", sub: `${outCount}`, disabled: outCount === 0,
              title: "Players ruled Out or Doubtful, and players not on the active roster — their carried baseline describes games they are not going to play." },
          ]} />
      </div>

      <WeekSlate games={weekGames} teams={d.teams} week={wk} selected={game} statusOf={statusOf}
        engine={engine} onSelect={pickGame} />

      {/* The sack model's frozen record, beside the board it describes. It is a
          PROJECTION record — every defender the board carried, graded on bias
          and on whether each rung landed at its stated rate — which is a
          different question from the pick ledger's, and the only one a market
          almost nobody prices can answer. See scripts/snapshot_sacks.mjs. */}
      {isDefProp(prop) && <SackRecord season={d.year} />}

      {gameMode && (
        <GameBoard d={d} games={gameRowsFor} prop={prop} statusOf={statusOf} teamF={teamF} q={q}
          officialMap={officialMap} cardOnly={cardF !== ALL}
          hiddenFinal={!showFinal && !game ? finalGames.length : 0} onShowFinal={() => setShowFinal(true)} />
      )}

      {!gameMode && <div style={S.card}>
        <div style={S.cardHead}>
          <div style={S.cardTitle}>
            {isDefProp(prop) ? "Sack Board" : "Projection Board"}
            <span style={S.badge()}>{weekLabel(wk)}</span>
            {finalGames.length > 0 && !showFinal && !game && (
              <span style={{ fontSize: 10, color: C.faint, fontFamily: MON, fontWeight: 400 }}>
                {finalGames.length} final {finalGames.length === 1 ? "game" : "games"} hidden
              </span>
            )}
          </div>
          <span style={S.cardMeta}>
            {filtered.length} props{filtered.length > ROW_CAP ? ` · showing ${ROW_CAP}` : ""} · click a row to expand
          </span>
        </div>

        {shown.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: C.muted, fontSize: 13 }}>
            {allFinal && !showFinal && !game ? (
              <>
                Every {weekLabel(wk)} game is final.{" "}
                <button style={{ ...S.btn, marginLeft: 6 }} onClick={() => setShowFinal(true)}>Show finished games</button>
              </>
            ) : cardF !== ALL && officialMap.size === 0 ? "No official picks on this week's card yet — books post most props later in the week."
              : isDefProp(prop) ? "No projectable pass rushers match these filters."
              : "No projectable players match these filters."}
          </div>
        ) : (
          <div style={S.tblWrap}>
            <table style={S.tbl}>
              <thead>
                <tr>
                  <th style={{ ...S.thLeft, minWidth: 186 }}>
                    {/* Two sorts on one column, because position lives inside the
                        player cell as a sub-line rather than in a column of its
                        own — the density decision that must not cost the sort. */}
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <SortBtn col="name" sort={sort} onSort={onSort} align="left">Player</SortBtn>
                      <span style={{ color: C.faintest }}>·</span>
                      <SortBtn col="pos" sort={sort} onSort={onSort} align="left">Pos</SortBtn>
                      {anyAvail && <>
                        <span style={{ color: C.faintest }}>·</span>
                        <SortBtn col="avail" sort={sort} onSort={onSort} align="left">Inj</SortBtn>
                      </>}
                    </span>
                  </th>
                  {cols.map((c) => (
                    <th key={c.key} style={{ ...S.th, width: c.width }} title={c.title}>
                      <SortBtn col={c.key} sort={sort} onSort={onSort}>{c.label}</SortBtn>
                    </th>
                  ))}
                  <th style={{ ...S.th, width: 26 }} />
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const open = openRow === r.key;
                  const st = STATUS_TAG[statusOf[r.game.game_id]];
                  return (
                    <Fragment key={r.key}>
                    <tr className="row-hover"
                      onClick={() => setOpenRow(open ? null : r.key)}
                      style={{ cursor: "pointer", background: open ? alpha(C.accent, 0.06) : undefined,
                        opacity: r.ruledOut || statusOf[r.game.game_id] === "final" ? 0.55 : 1 }}>
                      <td style={{ ...S.tdLeft, borderLeft: `3px solid ${POS_COLORS[r.pos] || C.line}` }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <Headshot src={headshotOf(d, r.player_id)} logo={logoOf(d, r.team)} name={r.name} size={32} />
                        <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 12.5, color: C.txt, display: "flex",
                          alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                          {r.name}<AvailChip a={r.avail} />
                          {officialOf(r) && <Tag color={C.accent} title="On the official card">OFFICIAL</Tag>}
                          {st && <Tag color={st.color}>{st.text}</Tag>}
                        </div>
                        <div style={{ fontSize: 9.5, color: C.faint, fontFamily: MON, marginTop: 1 }}>
                          <span style={{ color: POS_COLORS[r.pos] }}>{r.pos}</span>
                          {" · "}{r.team} {r.side === "home" ? "vs" : "@"} {r.opp}
                        </div>
                        </div>
                        </div>
                      </td>
                      {cols.map((c) => <Fragment key={c.key}>{c.td(r)}</Fragment>)}
                      <td style={{ ...S.td, color: C.faint, padding: "9px 6px" }}>{open ? "▾" : "▸"}</td>
                    </tr>
                    {/* The detail is a sibling row spanning every column, so it
                        opens where you clicked instead of at the foot of 250
                        rows, and its own layout is free of the column widths. */}
                    {open && (
                      <tr>
                        <td colSpan={colCount} style={{ padding: 0 }}>
                          {isDefProp(r.prop_type)
                            ? <SackDetail r={r} d={d} onClose={() => setOpenRow(null)} />
                            : <RowDetail r={r} d={d} onPick={onPick} onClose={() => setOpenRow(null)} />}
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

        <div style={{ padding: "10px 14px", fontSize: 10, color: C.faint, borderTop: `1px solid ${C.lineSoft}`,
          lineHeight: 1.6 }}>
          Line is the book's number when one is posted, the model's own otherwise; Diff is projection
          minus that line, and Win% is the probability of the side the model is on at it.
          {isDefProp(prop) && " On a sack row the line is a RUNG and a Yes wins only when his credit is OVER it:"
            + " 0.25 needs half a sack, 0.5 and 0.75 a whole one (a half on 0.5 pushes), 1.0 one and a half."
            + " Win% is the chance he clears the rung this row is"
            + " priced at and Diff is blank — a rate minus a rung is not a number anybody shops on."
            + " Proj is expected credited sacks, a half sack counting a half. Tilt is the opposing line's"
            + " sacks-allowed multiplier, the only matchup term this model has."
            + " Edge is blank for defensive backs: their projection is unbiased across the population and"
            + " still runs ~46% hot on the rows that reach a board, so the price is shown and the edge is"
            + " not claimed. Most rushers have no line at all — this is a projection board that shows a"
            + " market where one exists, not a card."}
          {effSection === "model" && !isDefProp(prop) && " Conf is distance from a coin flip, not likelihood of the over; it is a label, never a filter. Tilt is the scheme matchup multiplier vs that defense."}
          {effSection === "model" && isDefProp(prop) && " Conf is distance from a coin flip, not likelihood of the over; it is a label, never a filter."}
          {effSection === "hits" && ` Hit rates count the games before this week that went over the row's line — L5/L10/L20 across seasons, ${d.year} and ${d.year - 1} by season, H2H against this opponent. Pushes are excluded; a sample under three games is dimmed. Display only — the model does not read them.`}
          {effSection === "odds" && ` ${books.map((b) => BOOK_NAMES[b]).join(" / ")} are each book's live price for the over —`
            + " click one to open that book's bet slip. The best price on the row's line is highlighted;"
            + " a book posting a DIFFERENT line shows it in amber and is not eligible to be best, because it is not the same bet."
            + " Edge is model probability minus the best book's de-vigged probability, in points"
            + " (* = one-sided market, vig not removable)."}
          {effSection === "odds" && isDefProp(prop) && " PrizePicks and Underdog are DFS pick'em rather"
            + " than sportsbooks, so their price is the payout rather than a two-sided market, and the"
            + " rungs they post are the same belief at different numbers — each book's column shows the"
            + " rung our projection likes best of the ones it posted."}
          {" OFFICIAL marks the card the engine stands behind: a validated market, a projection 0.15–0.45 spread units from the line (the band that held up on 2025 — bigger gaps lost), a price, no injury designation. Every row is still graded."}
          {isDefProp(prop) && " Sacks are a market on PROBATION: every priced row is frozen and graded like"
            + " any other, and none of them can be official until the ledger's own record says the band"
            + " works here (src/lib/officialPicks.js)."}
          {" Finished games are hidden once kickoff is four hours past; a game in progress stays, tagged LIVE."}
          {anyAvail && " Availability chips are the club's last FILED designation — nflverse does not carry the 90-minute inactives list."}
        </div>
      </div>}
    </div>
  );
}

// ── inline row detail ────────────────────────────────────────────────────────
// WHAT HE HAS ACTUALLY DONE COMES FIRST. The order is deliberate: his role, his
// game log and his position room's snap counts, THEN every prop the model
// produced for him, who is coaching both sides and the factor chain behind the
// prop this row is about. The evidence reads before the model's answer, which is
// the order you check a number in — the projection cards used to sit on top and
// the log was three scrolls down.
function RowDetail({ r, d, onPick, onClose }) {
  // THIS season's weeks only, before the row's week — the log beside a week-2
  // projection should show what he has done in 2026, not last year.
  //
  // Snaps come off the bundled per-week artifact rather than the week row's own
  // stamped value: pull_roster.mjs rewrites it within a day of a game, the week
  // rows wait on the weekly ETL, and the snap room below reads the same file. A
  // game log and a snap table in the same expanded row must not disagree about
  // which games have been played.
  const weeks = withSnapWeeks(
    (d.weeksByPlayer?.[r.player_id] || []).filter((w) => w.week < r.game.week), d.year);
  return (
    <div className="fade-in" style={{ background: C.inset, borderTop: `1px solid ${C.line}`,
      borderBottom: `1px solid ${C.line}`, padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <Headshot src={headshotOf(d, r.player_id)} logo={logoOf(d, r.team)} name={r.name} size={56}
          ring={readable(d.teams?.[r.team]?.color)} />
        <span style={{ fontSize: 15, fontWeight: 700 }}>{r.name}</span>
        <Tag color={POS_COLORS[r.pos]}>{r.pos}</Tag>
        <span style={{ fontSize: 11, color: C.muted, fontFamily: MON, display: "inline-flex", alignItems: "center", gap: 4 }}>
          <TeamLogo src={logoOf(d, r.team)} size={18} />{r.team} {r.side === "home" ? "vs" : "@"}
          <TeamLogo src={logoOf(d, r.opp)} size={18} />{r.opp}
        </span>
        <AvailChip a={r.avail} />
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button style={S.btn} onClick={(e) => { e.stopPropagation(); onPick(r); }}>Full profile →</button>
          <button style={S.btnGhost} onClick={(e) => { e.stopPropagation(); onClose(); }}>Close</button>
        </div>
      </div>

      <RoleCard weeks={weeks} pos={r.pos} playerId={r.player_id} season={d.year}
        profilesByPlayer={d.profilesByPlayer} />

      <div style={{ marginBottom: 12 }}>
        <GameLog weeks={weeks} pos={r.pos} seasonLabel={`${d.year}`}
          emptyText={`No ${d.year} games before ${weekLabel(r.game.week)} yet — the full profile has last season's log.`} />
      </div>

      <SnapRoom d={d} team={r.team} pos={r.pos} playerId={r.player_id} />

      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fill,minmax(148px,1fr))", marginBottom: 12 }}>
        {r.props.map((p) => {
          const isRow = p.prop_type === r.prop_type;
          return (
            <div key={p.prop_type} style={{ background: alpha(C.panelSolid, 0.6),
              border: `1px solid ${isRow ? alpha(C.accent, 0.4) : C.line}`, borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ ...S.sectionLabel, marginBottom: 4, color: isRow ? C.accent : C.faint }}>
                {propShort(p.prop_type, p.label)}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span style={{ fontSize: 17, fontWeight: 800, fontFamily: MON }}>{p.proj_mean}</span>
                <span style={{ fontSize: 10, color: C.muted, fontFamily: MON }}>o{p.line}</span>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 5, fontSize: 10, fontFamily: MON }}>
                <span style={{ color: p.prob_over >= 0.5 ? C.good : C.bad, fontWeight: 700 }}>{pct(p.prob_over)}</span>
                <span style={{ color: C.faint }}>fair {fmtOdds(p.fair_line)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <MatchupContext season={r.game.season} team={r.team} opp={r.opp} prop={r.headline} teams={d.teams} />

      <div style={{ ...S.sectionLabel, marginBottom: 2 }}>How the {r.propShort} number was built</div>
      <ModelBreakdown prop={r.headline} />
    </div>
  );
}
