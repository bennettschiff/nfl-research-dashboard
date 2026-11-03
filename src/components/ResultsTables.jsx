// ── Results: the record tables ───────────────────────────────────────────────
// Three views of the graded ledger that the Results tab composes:
//
//   WeeklyRecord    every graded pick AND the official card, week by week, with
//                   an all-time line under each — two records kept side by side,
//                   because the ledger grades everything and the card is a subset.
//                   A week row unfolds into its record per prop.
//   TierPropMatrix  record and units for every (prop, confidence tier) cell.
//   MarketStanding  where each market sits on the official card's earn-in ladder
//                   (src/lib/officialPicks.js): core, earned, probation, benched.
import { Fragment, useMemo, useState } from "react";
import { summarize } from "../lib/pickLedger.js";
import { EARN, BENCH, ZONE, isOfficialRetro, isOfficialCard } from "../lib/officialPicks.js";
import { cmp } from "../lib/boardSort.js";
import { propRank, PROP_ORDER } from "../lib/props.js";
import { S, C, MON, goodBad, alpha } from "../lib/theme.js";
import { pct1, propShort, weekLabel, units, roiTxt } from "../lib/format.js";
import { Tag, SortBtn } from "./ui.jsx";

const wl = (s) => (s.win + s.loss + s.push ? `${s.win}–${s.loss}${s.push ? `–${s.push}` : ""}` : "—");

const mono = { ...S.td, fontFamily: MON };
const TIERS = [["high", "High", C.good], ["medium", "Med", C.warn], ["low", "Low", C.faint]];

/** Record · Win% · Units · ROI, as four cells. */
function RecCells({ s, divider }) {
  const has = s.win + s.loss > 0;
  return (
    <>
      <td style={{ ...mono, ...(divider ? { borderLeft: `1px solid ${C.line}` } : {}) }}>{wl(s)}</td>
      <td style={mono}>{s.winPct == null ? "—" : pct1(s.winPct)}</td>
      <td style={{ ...mono, color: s.staked ? goodBad(s.profit) : C.muted }}>{s.staked ? units(s.profit) : "—"}</td>
      <td style={{ ...mono, color: goodBad(s.roi) }}>{has ? roiTxt(s.roi) : "—"}</td>
    </>
  );
}

/** A sortable header cell. */
function H({ col, sort, onSort, children }) {
  return <th style={S.th}><SortBtn col={col} sort={sort} onSort={onSort}>{children}</SortBtn></th>;
}

/** A matrix cell: record and win% over units. */
function Cell({ s }) {
  return (
    <td style={{ ...mono, lineHeight: 1.3 }}>
      {s.win + s.loss ? (
        <>
          <div>{wl(s)} <span style={{ color: C.faint, fontSize: 10 }}>{pct1(s.winPct)}</span></div>
          <div style={{ fontSize: 10, color: s.staked ? goodBad(s.profit) : C.faint }}>{s.staked ? units(s.profit) : "—"}</div>
        </>
      ) : <span style={{ color: C.faintest }}>—</span>}
    </td>
  );
}

const decided = (s) => s.win + s.loss || null;
const WEEK_SORT = {
  week: (r) => r.week,
  allRec: (r) => decided(r.all), all: (r) => (r.all.staked ? r.all.profit : null), allPct: (r) => r.all.winPct, allRoi: (r) => r.all.roi,
  offRec: (r) => decided(r.off), off: (r) => (r.off.staked ? r.off.profit : null), offPct: (r) => r.off.winPct, offRoi: (r) => r.off.roi,
};

/**
 * Week by week: every graded pick next to the official card.
 * A week whose card was tagged after it was played says RETRO; the all-time
 * official line counts only pre-kickoff cards, with retro weeks on their own line.
 *
 * Clicking a week unfolds it into one row per prop, the same eight columns, in
 * board order whatever the table is sorted by. Clicking a prop row hands
 * (week, prop) to `onProp` — the Results tab points the pick list at it.
 */
export function WeeklyRecord({ picks, onProp }) {
  const [sort, setSort] = useState({ col: "week", dir: "desc" });
  const [open, setOpen] = useState(() => new Set());
  const onSort = (col) => setSort((s) => (s.col === col ? { col, dir: s.dir === "desc" ? "asc" : "desc" } : { col, dir: "desc" }));
  const toggle = (w) => setOpen((o) => { const n = new Set(o); if (n.has(w)) n.delete(w); else n.add(w); return n; });

  const { rows, allTime, offLive, offRetro } = useMemo(() => {
    const byWeek = new Map();
    for (const p of picks) {
      if (p.week == null) continue;
      (byWeek.get(p.week) || byWeek.set(p.week, []).get(p.week)).push(p);
    }
    const rows = [...byWeek.entries()].map(([week, ps]) => {
      const off = ps.filter((p) => p.official === true);
      const props = [...new Set(ps.map((p) => p.prop_type))].sort((a, b) => propRank(a) - propRank(b))
        .map((prop) => {
          const pp = ps.filter((p) => p.prop_type === prop);
          return { prop, all: summarize(pp), off: summarize(pp.filter((p) => p.official === true)) };
        });
      return {
        week, props, all: summarize(ps), off: summarize(off),
        retro: off.length > 0 && off.every(isOfficialRetro),
        stamped: ps.some((p) => p.official_basis),
      };
    });
    return {
      rows, allTime: summarize(picks),
      offLive: summarize(picks.filter(isOfficialCard)), offRetro: summarize(picks.filter(isOfficialRetro)),
    };
  }, [picks]);

  const get = WEEK_SORT[sort.col];
  const sorted = [...rows].sort((a, b) => cmp(get(a), get(b), sort.dir === "asc" ? 1 : -1));
  const hp = { sort, onSort };

  return (
    <div style={{ ...S.card, marginBottom: 12 }}>
      <div style={S.cardHead}>
        <div style={S.cardTitle}>Weekly Record</div>
        <span style={S.cardMeta}>click a week for its record by prop</span>
      </div>
      <div style={S.tblWrap}>
        <table style={S.tbl}>
          <thead>
            <tr>
              <th style={S.thLeft} rowSpan={2}><SortBtn col="week" sort={sort} onSort={onSort} align="left">Week</SortBtn></th>
              <th style={{ ...S.th, color: C.accent }} colSpan={4}>Official card</th>
              <th style={{ ...S.th, color: C.muted, borderLeft: `1px solid ${C.line}` }} colSpan={4}>All picks</th>
            </tr>
            <tr>
              <H col="offRec" {...hp}>Record</H><H col="offPct" {...hp}>Win%</H><H col="off" {...hp}>Units</H><H col="offRoi" {...hp}>ROI</H>
              <th style={{ ...S.th, borderLeft: `1px solid ${C.line}` }}><SortBtn col="allRec" sort={sort} onSort={onSort}>Record</SortBtn></th>
              <H col="allPct" {...hp}>Win%</H><H col="all" {...hp}>Units</H><H col="allRoi" {...hp}>ROI</H>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const isOpen = open.has(r.week);
              return (
                <Fragment key={r.week}>
                  <tr className="row-hover" onClick={() => toggle(r.week)} aria-expanded={isOpen}
                    style={{ cursor: "pointer", background: isOpen ? alpha(C.accent, 0.08) : undefined }}>
                    <td style={{ ...S.tdLeft, fontFamily: MON, fontSize: 11, whiteSpace: "nowrap" }}>
                      <span style={{ display: "inline-block", width: 12, color: isOpen ? C.accent : C.faint }}>{isOpen ? "▾" : "▸"}</span>
                      {weekLabel(r.week)}{" "}
                      {r.retro && <Tag color={C.purple} title="Official card tagged after the week was played">RETRO</Tag>}
                      {!r.stamped && <Tag color={C.faint} title="Recorded before official picks existed">—</Tag>}
                    </td>
                    <RecCells s={r.off} />
                    <RecCells s={r.all} divider />
                  </tr>
                  {isOpen && r.props.map((x) => (
                    <tr key={`${r.week}:${x.prop}`} className="row-hover" style={{ background: C.inset, cursor: onProp ? "pointer" : "default" }}
                      onClick={onProp ? () => onProp(r.week, x.prop) : undefined}
                      title={onProp ? `Show ${weekLabel(r.week)} ${propShort(x.prop)} picks` : undefined}>
                      <td style={{ ...S.tdLeft, fontFamily: MON, fontSize: 10.5, paddingLeft: 36, color: C.sub, whiteSpace: "nowrap" }}>
                        {propShort(x.prop)}
                      </td>
                      <RecCells s={x.off} />
                      <RecCells s={x.all} divider />
                    </tr>
                  ))}
                </Fragment>
              );
            })}
            <tr style={{ background: C.panelDeep }}>
              <td style={{ ...S.tdLeft, fontWeight: 700, fontSize: 11 }}>Total</td>
              <RecCells s={offLive} />
              <RecCells s={allTime} divider />
            </tr>
            {offRetro.n > 0 && (
              <tr style={{ background: C.panelDeep }}>
                <td style={{ ...S.tdLeft, fontSize: 11, color: C.purple }} title="The official rule applied to weeks frozen before it existed — a test of the rule, never part of the official record">
                  Retro official
                </td>
                <RecCells s={offRetro} />
                <td style={{ ...mono, borderLeft: `1px solid ${C.line}` }} colSpan={4}>
                  <span style={{ color: C.faint, fontSize: 10 }}>← not in the official total</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Record and units per (prop, confidence tier). */
export function TierPropMatrix({ picks }) {
  const [sort, setSort] = useState({ col: "prop", dir: "asc" });
  const onSort = (col) => setSort((s) => (s.col === col ? { col, dir: s.dir === "desc" ? "asc" : "desc" } : { col, dir: "desc" }));

  const rows = useMemo(() => {
    const props = [...new Set(picks.map((p) => p.prop_type))].sort((a, b) => propRank(a) - propRank(b));
    const cell = (ps) => summarize(ps);
    return props.map((prop) => {
      const ps = picks.filter((p) => p.prop_type === prop);
      return { prop, all: cell(ps), ...Object.fromEntries(TIERS.map(([t]) => [t, cell(ps.filter((p) => p.conf_tier === t))])) };
    });
  }, [picks]);
  const total = useMemo(() => ({
    all: summarize(picks), ...Object.fromEntries(TIERS.map(([t]) => [t, summarize(picks.filter((p) => p.conf_tier === t))])),
  }), [picks]);

  const SORT_VAL = {
    prop: (r) => propRank(r.prop),
    ...Object.fromEntries(["all", ...TIERS.map(([t]) => t)].map((k) => [k, (r) => (r[k].staked ? r[k].profit : null)])),
  };
  const sorted = [...rows].sort((a, b) => cmp(SORT_VAL[sort.col](a), SORT_VAL[sort.col](b), sort.dir === "asc" ? 1 : -1));

  return (
    <div style={{ ...S.card, marginBottom: 0 }}>
      <div style={S.cardHead}>
        <div style={S.cardTitle}>By Prop × Confidence</div>
        <span style={S.cardMeta}>record · win% · units</span>
      </div>
      <div style={S.tblWrap}>
        <table style={S.tbl}>
          <thead><tr>
            <th style={S.thLeft}><SortBtn col="prop" sort={sort} onSort={onSort} align="left">Prop</SortBtn></th>
            {TIERS.map(([t, l, color]) => (
              <th key={t} style={{ ...S.th, color }}><SortBtn col={t} sort={sort} onSort={onSort}>{l}</SortBtn></th>
            ))}
            <th style={S.th}><SortBtn col="all" sort={sort} onSort={onSort}>All</SortBtn></th>
          </tr></thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.prop} className="row-hover">
                <td style={{ ...S.tdLeft, fontFamily: MON, fontSize: 11 }}>{propShort(r.prop)}</td>
                {TIERS.map(([t]) => <Cell key={t} s={r[t]} />)}
                <Cell s={r.all} />
              </tr>
            ))}
            <tr style={{ background: C.panelDeep }}>
              <td style={{ ...S.tdLeft, fontWeight: 700, fontSize: 11 }}>All</td>
              {TIERS.map(([t]) => <Cell key={t} s={total[t]} />)}
              <Cell s={total.all} />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

const STATUS = {
  core: { color: C.good, text: "CORE", title: "Validated on 2025 closing lines — official while its live record holds" },
  earned: { color: C.accent, text: "EARNED", title: "Promoted onto the official card by its live record" },
  probation: { color: C.warn, text: "PROBATION", title: "Graded, not official, until its in-band record earns it in" },
  benched: { color: C.bad, text: "BENCHED", title: "Taken off the official card by its live record" },
};
const segLabel = (k) => {
  const [prop, side] = k.split(":");
  return `${propShort(prop)}${side ? ` ${side === "over" ? "Over" : "Under"}` : ""}`;
};
const segRank = (k) => { const [prop, side] = k.split(":"); return propRank(prop) * 2 + (side === "over" ? 1 : 0); };
const STATUS_ORDER = { core: 0, earned: 1, probation: 2, benched: 3 };

/** Each market's place on the earn-in ladder, from the live ledger. */
export function MarketStanding({ standing }) {
  const [sort, setSort] = useState({ col: "status", dir: "asc" });
  const onSort = (col) => setSort((s) => (s.col === col ? { col, dir: s.dir === "desc" ? "asc" : "desc" } : { col, dir: "desc" }));
  const SORT_VAL = {
    market: ([k]) => segRank(k), status: ([k, v]) => STATUS_ORDER[v.status] * 100 + segRank(k) / 100,
    n: ([, v]) => v.n, win: ([, v]) => v.winPct, roi: ([, v]) => v.roi,
  };
  const known = new Set(PROP_ORDER);
  const rows = Object.entries(standing).filter(([k]) => known.has(k.split(":")[0]))
    .sort((a, b) => cmp(SORT_VAL[sort.col](a), SORT_VAL[sort.col](b), sort.dir === "asc" ? 1 : -1));

  return (
    <div style={{ ...S.card, marginBottom: 0 }}>
      <div style={S.cardHead}>
        <div style={S.cardTitle}>Official Card · Markets</div>
        <span style={S.cardMeta}>live in-band record</span>
      </div>
      <div style={S.tblWrap}>
        <table style={S.tbl}>
          <thead><tr>
            <th style={S.thLeft}><SortBtn col="market" sort={sort} onSort={onSort} align="left">Market</SortBtn></th>
            <th style={S.th}><SortBtn col="status" sort={sort} onSort={onSort}>Standing</SortBtn></th>
            <th style={S.th}><SortBtn col="n" sort={sort} onSort={onSort}>Graded</SortBtn></th>
            <th style={S.th}><SortBtn col="win" sort={sort} onSort={onSort}>Win%</SortBtn></th>
            <th style={S.th}><SortBtn col="roi" sort={sort} onSort={onSort}>ROI</SortBtn></th>
          </tr></thead>
          <tbody>
            {rows.map(([k, v]) => {
              const st = STATUS[v.status];
              const bar = v.status === "probation" || v.status === "earned" ? EARN.minN : BENCH.minN;
              return (
                <tr key={k} className="row-hover">
                  <td style={{ ...S.tdLeft, fontFamily: MON, fontSize: 11 }}>{segLabel(k)}</td>
                  <td style={S.td}><Tag color={st.color} title={st.title}>{st.text}</Tag></td>
                  <td style={{ ...mono, color: C.muted }}>{v.wins}–{v.n - v.wins} <span style={{ color: C.faint, fontSize: 10 }}>/ {bar}</span></td>
                  <td style={mono}>{v.winPct == null ? "—" : pct1(v.winPct)}</td>
                  <td style={{ ...mono, color: goodBad(v.roi) }}>{roiTxt(v.roi)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ padding: "8px 14px", fontSize: 10, color: C.faint, lineHeight: 1.6, borderTop: `1px solid ${C.lineSoft}` }}>
        In-band = projection {ZONE.lo}–{ZONE.hi} spread units from the line, the only band that held up on 2025.
        Probation markets go official at {EARN.minN} graded in-band picks winning ≥{Math.round(EARN.minWin * 100)}% with
        positive ROI; a core market is benched at {BENCH.minN} under {Math.round(BENCH.maxWin * 100)}%.
      </div>
    </div>
  );
}
