// ── Results: the summary layer ───────────────────────────────────────────────
// What the Results tab says before anyone reads a table:
//
//   RecordCard  one record, big — W–L, win%, units, ROI. The tab shows two side
//               by side (the official card and every graded pick) and clicking
//               one points everything below it at that record.
//   Breakdown   "where is it winning": one record per market / side / position /
//               confidence / book / week, ranked by units with a diverging bar,
//               and a click on a row filters the pick list to it. EVERY group is
//               a row, losing or empty — a table that only listed the markets
//               with picks on the card read as one that only listed the winners.
import { useMemo, useState } from "react";
import { summarize } from "../lib/pickLedger.js";
import { propRank, PROP_ORDER } from "../lib/props.js";
import { S, C, MON, POS_COLORS, goodBad, alpha } from "../lib/theme.js";
import { pct1, propShort, weekLabel, units, roiTxt } from "../lib/format.js";
import { SortBtn } from "./ui.jsx";

const wl = (s) => `${s.win}–${s.loss}${s.push ? `–${s.push}` : ""}`;

/** One record as a headline card. `active` outlines it as the record in view. */
export function RecordCard({ title, blurb, s, active, onClick, tone = C.accent, foot }) {
  const decided = s.win + s.loss;
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      style={{
        ...S.card, marginBottom: 0, padding: "14px 16px 12px", textAlign: "left", cursor: "pointer",
        flex: "1 1 300px", minWidth: 0, color: C.txt, fontFamily: "inherit",
        border: `1px solid ${active ? tone : C.line}`,
        boxShadow: active ? `0 0 0 3px ${alpha(tone, 0.16)}, var(--card-shadow)` : undefined,
      }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
        <span style={{ ...S.sectionLabel, color: tone, fontSize: 10 }}>{title}</span>
        <span style={{ fontSize: 10, color: active ? tone : C.faint, fontWeight: 600 }}>
          {active ? "● showing below" : "show these picks →"}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
        <span style={{ fontSize: 30, fontWeight: 800, fontFamily: MON, lineHeight: 1 }}>
          {decided ? wl(s) : "—"}
        </span>
        <span style={{ fontSize: 18, fontWeight: 700, fontFamily: MON, color: C.muted }}>
          {s.winPct == null ? "" : pct1(s.winPct)}
        </span>
      </div>
      <div style={{ display: "flex", gap: 18, marginTop: 10, flexWrap: "wrap" }}>
        <Mini label="Units" v={s.staked ? units(s.profit) : "—"} color={s.staked ? goodBad(s.profit) : null} />
        <Mini label="ROI" v={roiTxt(s.roi)} color={goodBad(s.roi)} />
        <Mini label="Pending" v={s.pending} color={s.pending ? C.warn : C.faint} />
        {s.void ? <Mini label="Void" v={s.void} color={C.faint} /> : null}
      </div>
      <div style={{ fontSize: 11, color: C.faint, marginTop: 10, lineHeight: 1.45 }}>{blurb}</div>
      {foot}
    </button>
  );
}

function Mini({ label, v, color }) {
  return (
    <div>
      <div style={{ ...S.sectionLabel, fontSize: 8.5 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, fontFamily: MON, color: color || C.txt, marginTop: 2 }}>{v}</div>
    </div>
  );
}

const TIER_COLOR = { high: C.good, medium: C.warn, low: C.faint };

/**
 * The splits. `filter` names the pick-list filter a row click sets; a split
 * without one (book) is read-only. `every` is the groups listed even with no
 * pick in them; the rest come from the whole era's ledger (`universe`).
 */
const SPLITS = [
  { key: "prop", label: "Market", keyOf: (p) => p.prop_type, filter: "prop", every: PROP_ORDER },
  { key: "side", label: "Side", keyOf: (p, oneSided) => (oneSided(p.prop_type) ? "yes" : p.direction), filter: "side", every: ["over", "under", "yes"] },
  { key: "pos", label: "Position", keyOf: (p) => p.position, filter: "pos" },
  { key: "tier", label: "Confidence", keyOf: (p) => p.conf_tier, filter: "tier", every: ["high", "medium", "low"] },
  { key: "week", label: "Week", keyOf: (p) => p.week, filter: "week" },
  { key: "book", label: "Book", keyOf: (p) => p.book },
];

const rowLabel = (split, k) => (split === "prop" ? propShort(k) : split === "week" ? weekLabel(k)
  : split === "side" ? ({ over: "Over", under: "Under", yes: "Yes (one-sided)", home: "Home side (game)", away: "Away side (game)" }[k] || k)
  : split === "tier" ? `${String(k)[0].toUpperCase()}${String(k).slice(1)}` : String(k).toUpperCase());
const rowColor = (split, k) => (split === "tier" ? TIER_COLOR[k] : split === "pos" ? POS_COLORS[k] : C.txt);

const TIER_RANK = { high: 0, medium: 1, low: 2 };
const SORT_VAL = {
  key: (r, split) => (split === "prop" ? propRank(r.key) : split === "week" ? r.key
    : split === "tier" ? TIER_RANK[r.key] : String(r.key)),
  rec: (r) => r.win + r.loss || null,
  win: (r) => r.winPct,
  units: (r) => (r.staked ? r.profit : null),
  roi: (r) => r.roi,
  pend: (r) => r.pending,
};

/**
 * Record per group, ranked by units, each row a click-through to its picks.
 * `picks` is the record in view (official card or every pick); `universe` is the
 * whole era, so a group the card never touched still gets its row.
 */
export function Breakdown({ picks, universe = picks, isOneSided, active, onPick, cmp, emptyNote = "no picks", records, record, onRecord }) {
  const [split, setSplit] = useState("prop");
  const [sort, setSort] = useState({ col: "units", dir: "desc" });
  const onSort = (col) => setSort((s) => (s.col === col ? { col, dir: s.dir === "desc" ? "asc" : "desc" } : { col, dir: "desc" }));
  const def = SPLITS.find((s) => s.key === split);

  const rows = useMemo(() => {
    const keyOf = (p) => def.keyOf(p, isOneSided);
    const keys = new Set([...(def.every || []), ...universe.map(keyOf).filter((k) => k != null)]);
    const groups = new Map([...keys].map((k) => [k, []]));
    for (const p of picks) groups.get(keyOf(p))?.push(p);
    return [...groups.entries()].map(([key, ps]) => ({ key, ...summarize(ps) }));
  }, [picks, universe, def, isOneSided]);
  const get = SORT_VAL[sort.col];
  const sorted = [...rows].sort((a, b) => cmp(get(a, split), get(b, split), sort.dir === "asc" ? 1 : -1)
    || cmp(SORT_VAL.key(a, split), SORT_VAL.key(b, split), 1));
  const maxU = Math.max(1, ...rows.map((r) => Math.abs(r.profit || 0)));
  const hp = { sort, onSort };

  return (
    <div style={{ ...S.card, marginBottom: 0 }}>
      <div style={S.cardHead}>
        <div style={S.cardTitle}>Where it’s winning</div>
        <span style={S.cardMeta}>click a row to see its picks</span>
      </div>
      <div style={{ ...S.propTabs, flexWrap: "wrap" }}>
        {SPLITS.map((s) => (
          <button key={s.key} type="button" style={S.propTab(split === s.key)} onClick={() => setSplit(s.key)}>{s.label}</button>
        ))}
        {records && (
          <span style={{ marginLeft: "auto", display: "inline-flex", gap: 3 }}>
            {records.map(([k, l]) => (
              <button key={k} type="button" style={S.chipTab(record === k)} onClick={() => onRecord(k)}
                title="Same switch as the record cards above">{l}</button>
            ))}
          </span>
        )}
      </div>
      {sorted.length === 0 ? (
        <div style={{ padding: 20, textAlign: "center", color: C.muted, fontSize: 12 }}>Nothing graded in this slice yet.</div>
      ) : (
        <div style={S.tblWrap}>
          <table style={S.tbl}>
            <thead><tr>
              <th style={S.thLeft}><SortBtn col="key" {...hp} align="left">{def.label}</SortBtn></th>
              <th style={S.th}><SortBtn col="rec" {...hp}>Record</SortBtn></th>
              <th style={S.th}><SortBtn col="win" {...hp}>Win%</SortBtn></th>
              <th style={{ ...S.th, minWidth: 150 }}><SortBtn col="units" {...hp}>Units</SortBtn></th>
              <th style={S.th}><SortBtn col="roi" {...hp}>ROI</SortBtn></th>
              <th style={S.th}><SortBtn col="pend" {...hp}>Pend</SortBtn></th>
            </tr></thead>
            <tbody>
              {sorted.map((g) => {
                const on = def.filter && active?.[def.filter] === g.key;
                const u = g.staked ? g.profit : null;
                return (
                  <tr key={String(g.key)} className="row-hover"
                    onClick={def.filter ? () => onPick(def.filter, on ? null : g.key) : undefined}
                    style={{ cursor: def.filter ? "pointer" : "default", background: on ? alpha(C.accent, 0.08) : undefined }}>
                    <td style={{ ...S.tdLeft, fontWeight: 600, color: rowColor(split, g.key),
                      borderLeft: `3px solid ${on ? C.accent : "transparent"}` }}>
                      {rowLabel(split, g.key)}
                    </td>
                    <td style={{ ...S.td, color: g.n ? C.txt : C.faint, fontSize: g.n ? undefined : 10.5 }}>{g.n ? wl(g) : emptyNote}</td>
                    <td style={{ ...S.td, fontWeight: 700 }}>{g.winPct == null ? "—" : pct1(g.winPct)}</td>
                    <td style={{ ...S.td, padding: "6px 10px" }}>
                      <UnitsBar u={u} max={maxU} />
                    </td>
                    <td style={{ ...S.td, color: goodBad(g.roi) }}>{roiTxt(g.roi)}</td>
                    <td style={{ ...S.td, color: g.pending ? C.warn : C.faint }}>{g.pending}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** A diverging bar from a centre line: green right for profit, red left for loss. */
function UnitsBar({ u, max }) {
  if (u == null) return <span style={{ color: C.faint }}>—</span>;
  const w = `${Math.min(50, (Math.abs(u) / max) * 50)}%`;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ position: "relative", flex: 1, height: 8, minWidth: 70, background: C.inset, borderRadius: 4 }}>
        <div style={{ position: "absolute", left: "50%", top: -2, bottom: -2, width: 1, background: C.line }} />
        <div style={{ position: "absolute", top: 0, bottom: 0, borderRadius: 4, width: w,
          background: u >= 0 ? C.good : C.bad, opacity: 0.85,
          ...(u >= 0 ? { left: "50%" } : { right: "50%" }) }} />
      </div>
      <span style={{ color: goodBad(u), fontWeight: 700, minWidth: 58, textAlign: "right" }}>{units(u)}</span>
    </div>
  );
}
