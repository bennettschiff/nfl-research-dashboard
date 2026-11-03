// ── Results: the pick list ───────────────────────────────────────────────────
// Every pick in the slice the tab is pointed at, with the Result pills (Won /
// Lost / Pending …) as the first control, because "show me the winners" is the
// question people open this table with.
//
// The default columns answer "what was the bet and how did it go". The market
// diagnostics — de-vigged market probability, edge, confidence, the close and
// CLV — are one toggle away, so the table reads at a glance and is still the
// full ledger for anyone auditing it.
//
// ITS FILTERS SIT ON IT. Week, prop, side and a player search live in the
// table's own toolbar and narrow only this list; they used to be a free-floating
// bar between the weekly table and the breakdown that silently re-scoped both.
// The Results tab owns the filter state because a click on a weekly prop row or
// a breakdown row sets it too ("show me those picks"); position and confidence
// only arrive that way, so they show as removable chips.
import { useMemo, useState } from "react";
import { cmp } from "../lib/boardSort.js";
import { propRank, PROP_ORDER, isOneSided } from "../lib/props.js";
import { S, C, MON, POS_COLORS, goodBad } from "../lib/theme.js";
import { fmtOdds, pct, propShort, weekLabel, units } from "../lib/format.js";
import { Tag, SortBtn, Headshot } from "./ui.jsx";
import { Dropdown, Field } from "./FilterBar.jsx";
import { headshotOf, logoOf } from "../lib/headshots.js";
import { isGameProp, gamePickText } from "../lib/gameMarkets.js";

const SIDE_LABEL = { over: "Over", under: "Under", yes: "Yes" };
const TIER_LABEL = { high: "High conf", medium: "Med conf", low: "Low conf" };

/** Each pick-list filter as the test a pick must pass (an unset one passes all). */
const FILTER_TEST = {
  week: (p, v) => p.week === v,
  prop: (p, v) => p.prop_type === v,
  side: (p, v) => (v === "yes" ? isOneSided(p.prop_type) : !isOneSided(p.prop_type) && p.direction === v),
  pos: (p, v) => p.position === v,
  tier: (p, v) => p.conf_tier === v,
  q: (p, v) => (p.player_name || p.player_id || "").toLowerCase().includes(v.trim().toLowerCase()),
};
const passes = (p, f) => Object.entries(f).every(([k, v]) => v == null || v === "" || FILTER_TEST[k](p, v));
const CHIP_LABEL = { pos: (v) => v, tier: (v) => TIER_LABEL[v] || v };

const ROW_CAP = 300;
const OUTCOME_COLOR = { win: C.good, loss: C.bad, push: C.warn, void: C.faint, pending: C.muted };
const OUTCOME_TEXT = { win: "WON", loss: "LOST", push: "PUSH", void: "VOID", pending: "PENDING" };
const TIER_COLOR = { high: C.good, medium: C.warn, low: C.faint };
const TIER_ORDER = { high: 0, medium: 1, low: 2 };

const RESULTS = [["all", "All"], ["win", "Won"], ["loss", "Lost"], ["pending", "Pending"], ["push", "Push"], ["void", "Void"]];

const num = (x) => (x == null ? null : Number(x));
const signedPts = (x) => (x == null ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}`);

/**
 * What the pick IS. Anytime TD is a Yes at a fixed 0.5, so the number says
 * nothing and is left off. A sack pick is one-sided too, but its number is the
 * whole point — the rung decides what has to happen — so it is printed.
 */
const sideText = (p) => (isGameProp(p.prop_type) ? gamePickText(p) : p.prop_type === "anytime_td" ? "YES"
  : p.direction === "under" ? `u${p.line}` : `o${p.line}`);

// A re-scored pick (src/lib/rescore.js) is on today's card, not the stamped one.
const CARD_TAG = { "pre-kickoff": "OFFICIAL", retro: "RETRO", rules: "RE-SCORED" };

const SORT_VAL = {
  kick: (p) => p.kickoff_at || p.pick_date || "",
  name: (p) => (p.player_name || "").toLowerCase(),
  prop: (p) => propRank(p.prop_type),
  odds: (p) => p.book_odds ?? null,
  model: (p) => num(p.side_prob),
  proj: (p) => num(p.proj_mean),
  actual: (p) => num(p.actual),
  result: (p) => p.outcome || "",
  units: (p) => num(p.profit),
  card: (p) => (p.official ? (p.official_basis === "pre-kickoff" ? 2 : 1) : p.official === false ? 0 : null),
  mkt: (p) => num(p.mkt_prob),
  edge: (p) => num(p.edge),
  conf: (p) => (p.conf_tier == null ? null : 3 - TIER_ORDER[p.conf_tier]),
  close: (p) => num(p.close_line),
  clv: (p) => (p.clv_prob != null ? Number(p.clv_prob) : p.clv_line != null ? Number(p.clv_line) / 100 : null),
};

const BASIC = [["prop", "Pick"], ["odds", "Price"], ["model", "Win%"], ["proj", "Proj"], ["actual", "Actual"],
  ["result", "Result"], ["units", "Units"], ["card", "Card"]];
const DETAIL = [["mkt", "Mkt"], ["edge", "Edge"], ["conf", "Conf"], ["close", "Close"], ["clv", "CLV"]];

/**
 * @param picks     the record in view (official card / every pick), unfiltered
 * @param f         the pick-list filters { week, prop, side, pos, tier, q }, owned by Results
 * @param setFilter (key, value) → void; null / "" clears one
 * @param weeks     the weeks the Week dropdown offers
 */
export function PicksTable({ picks, f, setFilter, onClear, weeks, resultF, onResult, d, cardRef }) {
  const [sort, setSort] = useState({ col: "kick", dir: "desc" });
  const [detail, setDetail] = useState(false);
  const onSort = (col) => setSort((s) => (s.col === col ? { col, dir: s.dir === "desc" ? "asc" : "desc" } : { col, dir: "desc" }));

  const filtered = useMemo(() => picks.filter((p) => passes(p, f)), [picks, f]);
  const props = useMemo(() => { const have = new Set(picks.map((p) => p.prop_type)); return PROP_ORDER.filter((t) => have.has(t)); }, [picks]);
  const counts = useMemo(() => filtered.reduce((a, p) => ((a[p.outcome] = (a[p.outcome] || 0) + 1), a), { all: filtered.length }), [filtered]);
  const shown = useMemo(() => {
    const get = SORT_VAL[sort.col] || SORT_VAL.kick;
    const dir = sort.dir === "asc" ? 1 : -1;
    return filtered.filter((p) => resultF === "all" || p.outcome === resultF)
      .sort((a, b) => cmp(get(a), get(b), dir) || cmp(SORT_VAL.name(a), SORT_VAL.name(b), 1));
  }, [filtered, resultF, sort]);
  const cols = detail ? [...BASIC, ...DETAIL] : BASIC;
  const anyFilter = Object.values(f).some((v) => v != null && v !== "");
  const chips = Object.entries(CHIP_LABEL).filter(([k]) => f[k] != null);

  return (
    <div style={S.card} ref={cardRef}>
      <div style={S.cardHead}>
        <div style={S.cardTitle}>Picks</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={S.cardMeta}>{shown.length > ROW_CAP ? `showing ${ROW_CAP} of ${shown.length}` : `${shown.length} shown`}</span>
          <button type="button" style={S.btnGhost} onClick={() => setDetail((d) => !d)}>
            {detail ? "Fewer columns" : "Market columns"}
          </button>
        </div>
      </div>
      <div style={{ ...S.filterBar, marginBottom: 0, padding: "10px 12px", borderBottom: `1px solid ${C.line}` }}>
        <Dropdown label="Week" selected={f.week ?? "ALL"} changed={f.week != null}
          display={f.week == null ? "All weeks" : weekLabel(f.week)}
          onChange={(v) => setFilter("week", v === "ALL" ? null : v)}
          options={[{ value: "ALL", label: "All weeks" }, ...weeks.map((w) => ({ value: w, label: weekLabel(w) }))]} />
        <Dropdown label="Prop" selected={f.prop ?? "ALL"} changed={f.prop != null}
          display={f.prop == null ? "All props" : propShort(f.prop)}
          onChange={(v) => setFilter("prop", v === "ALL" ? null : v)}
          options={[{ value: "ALL", label: "All props" }, ...props.map((t) => ({ value: t, label: propShort(t) }))]} />
        <Dropdown label="Side" selected={f.side ?? "ALL"} changed={f.side != null}
          display={f.side == null ? "Both" : SIDE_LABEL[f.side]}
          onChange={(v) => setFilter("side", v === "ALL" ? null : v)}
          options={[{ value: "ALL", label: "Both" }, { value: "over", label: "Over" }, { value: "under", label: "Under" }, { value: "yes", label: "Yes (one-sided)" }]} />
        <Field label="Player" grow>
          <input value={f.q} onChange={(e) => setFilter("q", e.target.value)} placeholder="Search player…" type="search"
            style={{ ...S.searchIn, padding: "8px 10px", borderRadius: 7, background: C.panel, maxWidth: 320 }} />
        </Field>
        {chips.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setFilter(k, null)} title="Remove this filter"
            style={{ ...S.chipTab(true), fontFamily: "inherit", fontSize: 10.5, marginBottom: 6 }}>
            {label(f[k])} ✕
          </button>
        ))}
        {anyFilter && (
          <button type="button" style={{ ...S.btnGhost, marginBottom: 1 }} onClick={onClear}>Clear filters</button>
        )}
      </div>
      <div style={S.propTabs}>
        {RESULTS.filter(([k]) => k === "all" || counts[k] || resultF === k).map(([k, l]) => (
          <button key={k} type="button" style={{ ...S.propTab(resultF === k), ...(resultF === k ? {} : { color: k === "win" ? C.good : k === "loss" ? C.bad : undefined }) }}
            onClick={() => onResult(k)}>
            {l} <span style={{ fontFamily: MON, opacity: 0.75, marginLeft: 3 }}>{counts[k] || 0}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <div style={{ padding: 24, textAlign: "center", color: C.muted, fontSize: 13 }}>No picks match these filters.</div>
      ) : (
        <div style={S.tblWrap}>
          <table style={S.tbl}>
            <thead>
              <tr>
                <th style={S.thLeft}><SortBtn col="kick" sort={sort} onSort={onSort} align="left">Week</SortBtn></th>
                <th style={{ ...S.thLeft, minWidth: 170 }}><SortBtn col="name" sort={sort} onSort={onSort} align="left">Player</SortBtn></th>
                {cols.map(([k, l]) => (
                  <th key={k} style={S.th}><SortBtn col={k} sort={sort} onSort={onSort}>{l}</SortBtn></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, ROW_CAP).map((p) => <PickRow key={p.id} p={p} detail={detail} d={d} />)}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ padding: "10px 14px", fontSize: 10, color: C.faint, borderTop: `1px solid ${C.lineSoft}`, lineHeight: 1.6 }}>
        A pick is the side the model was on, at the best price for that side on the row’s line, frozen before kickoff
        and graded from nflverse box scores. Units are a 1u stake at that price. Win% is the model’s probability for
        the side, calibrated to the price. Card: OFFICIAL was on the card before kickoff; RETRO is the rule applied
        afterwards; otherwise the reason it was not. Market columns: Mkt is the book’s probability, de-vigged
        (* = one-sided, the hold is still in it); CLV is the later close minus the captured price, in points.
      </div>
    </div>
  );
}

function PickRow({ p, detail, d }) {
  const clvLine = num(p.clv_line);
  const won = p.outcome === "win";
  return (
    <tr className="row-hover">
      <td style={{ ...S.tdLeft, color: C.faint, fontFamily: MON, fontSize: 10.5, whiteSpace: "nowrap" }}>
        {p.week != null ? `${weekLabel(p.week)} · ` : ""}{(p.kickoff_at || p.pick_date || "").slice(5, 10)}
      </td>
      <td style={{ ...S.tdLeft, borderLeft: `3px solid ${POS_COLORS[p.position] || C.line}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Headshot src={headshotOf(d, p.player_id)} logo={logoOf(d, p.team)} name={p.player_name} size={30} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 12.5 }}>{p.player_name || p.player_id}</div>
            <div style={{ fontSize: 9.5, color: C.faint, fontFamily: MON, marginTop: 1 }}>
              <span style={{ color: POS_COLORS[p.position] }}>{p.position}</span>
              {" · "}{p.team}{p.opp ? ` vs ${p.opp}` : ""}{p.avail ? ` · ${p.avail}` : ""}
            </div>
          </div>
        </div>
      </td>
      <td style={{ ...S.td, whiteSpace: "nowrap" }}>
        <span style={{ color: C.muted, fontSize: 10.5, fontFamily: "inherit" }}>{propShort(p.prop_type)} </span>
        <b>{sideText(p)}</b>
      </td>
      <td style={{ ...S.td, color: C.muted }} title={p.book || ""}>{fmtOdds(p.book_odds)}</td>
      <td style={{ ...S.td, fontWeight: 700 }}>{pct(num(p.side_prob))}</td>
      <td style={{ ...S.td, color: C.muted }}>{p.proj_mean ?? "—"}</td>
      <td style={{ ...S.td, fontWeight: 700 }}>{p.actual ?? "—"}</td>
      <td style={S.td}><Tag color={OUTCOME_COLOR[p.outcome]}>{OUTCOME_TEXT[p.outcome] || String(p.outcome).toUpperCase()}</Tag></td>
      <td style={{ ...S.td, fontWeight: won ? 700 : 400, color: p.profit == null ? C.faint : goodBad(num(p.profit)) }}>
        {p.profit == null ? "—" : units(num(p.profit))}
      </td>
      <td style={S.td} title={p.official_note || ""}>
        {p.official
          ? <Tag color={p.official_basis === "pre-kickoff" ? C.accent : C.purple}>{CARD_TAG[p.official_basis] || "OFFICIAL"}</Tag>
          : p.official === false ? <span style={{ fontSize: 9.5, color: C.faint }}>{p.official_note}</span> : "—"}
      </td>
      {detail && <>
        <td style={{ ...S.td, color: C.muted }}>{pct(num(p.mkt_prob))}{p.devigged === false ? "*" : ""}</td>
        <td style={{ ...S.td, color: goodBad(num(p.edge)) }}>{signedPts(num(p.edge))}</td>
        <td style={S.td}>{p.conf_tier ? <Tag color={TIER_COLOR[p.conf_tier]}>{p.conf_tier.toUpperCase()}</Tag> : "—"}</td>
        <td style={{ ...S.td, color: C.muted }}>
          {p.close_odds == null ? "—" : `${p.prop_type === "anytime_td" ? "" : `${p.close_line} `}${fmtOdds(p.close_odds)}`}
        </td>
        <td style={{ ...S.td, color: p.clv_prob != null ? goodBad(num(p.clv_prob)) : goodBad(clvLine) }}>
          {p.clv_prob != null ? signedPts(num(p.clv_prob)) : clvLine ? `${clvLine > 0 ? "+" : ""}${clvLine} ln` : "—"}
        </td>
      </>}
    </tr>
  );
}
