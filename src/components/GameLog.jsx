// ── Game log ─────────────────────────────────────────────────────────────────
// Was a flat stat table inside PlayerPanel.jsx. Three things it did not do, all
// of which change how a week reads:
//
//   1. OPPORTUNITY. It showed production only. A 3-target week means something
//      completely different at 20 snaps than at 60, and the log could not tell
//      you which. Snap share, opportunities per snap and — for a season whose
//      participation data has been published — routes are first-class columns
//      (scripts/build_week_roles.py derives them per week).
//   2. SHAPE. Sixteen rows of numbers hide the season's story. A bar per row,
//      scaled to the player's own best week, makes the shape legible at a glance.
//   3. A BASELINE. A number with nothing to compare it to is not information —
//      there is now a per-column average, and each cell is shaded against it.
import { useMemo, useState } from "react";
import { S, C, MON, alpha } from "../lib/theme.js";
import { pct } from "../lib/format.js";
import { Empty, SortBtn } from "./ui.jsx";

// key       — field on the week row, and the sort/average identity of the column
// label      — column header
// headline   — the stat the row's bar is scaled to (one per position)
// fmt        — cell formatter
// val        — derive the value from the whole row instead of reading `key`
// role       — an opportunity column, dropped when no week has a value for it
//
// OPP/SN is the column that answers "56% of snaps, but doing what?". Snap share
// says he was on the field; opportunities per snap says whether the offense
// pointed the ball at him while he was out there. A pass-blocking back and a
// feature back can post the same snap share and differ by an order of magnitude
// here. It is NOT a route rate — see the footnote, and the Profile tab, for why
// an in-progress season cannot have one.
const perSnapOpp = (r) => {
  const s = num(r.snaps_wk);
  if (!s) return null;
  return ((num(r.targets) || 0) + (num(r.carries) || 0)) / s;
};

const num2 = (v) => (v == null ? "—" : v.toFixed(2));

const COLS = {
  QB: [
    { key: "pass_att", label: "ATT" },
    { key: "completions", label: "CMP" },
    { key: "pass_yards", label: "YDS", headline: true },
    { key: "pass_tds", label: "TD" },
    { key: "ints", label: "INT", lowGood: true },
    { key: "sacks", label: "SK", lowGood: true },
    { key: "carries", label: "CAR" },
    { key: "rush_yards", label: "RU" },
    { key: "rush_tds", label: "RU TD" },
  ],
  RUSH: [
    { key: "snap_pct_wk", label: "SNP%", fmt: pct, role: true },
    { key: "opp_per_snap", label: "OPP/SN", fmt: num2, role: true, val: perSnapOpp },
    { key: "carries", label: "CAR" },
    { key: "rush_yards", label: "RU YD", headline: true },
    { key: "rush_tds", label: "RU TD" },
    { key: "routes_wk", label: "RTS", role: true },
    { key: "targets", label: "TGT" },
    { key: "target_share", label: "TS%", fmt: pct },
    { key: "receptions", label: "REC" },
    { key: "rec_yards", label: "REC YD" },
    { key: "rec_tds", label: "REC TD" },
  ],
  RECV: [
    { key: "snap_pct_wk", label: "SNP%", fmt: pct, role: true },
    { key: "opp_per_snap", label: "OPP/SN", fmt: num2, role: true, val: perSnapOpp },
    { key: "routes_wk", label: "RTS", role: true },
    { key: "route_pct_wk", label: "RT%", fmt: pct, role: true },
    { key: "targets", label: "TGT" },
    { key: "target_share", label: "TS%", fmt: pct },
    { key: "receptions", label: "REC" },
    { key: "rec_yards", label: "YDS", headline: true },
    { key: "rec_tds", label: "TD" },
    { key: "air_yards", label: "AIR" },
  ],
};

const colsFor = (pos) => pos === "QB" ? COLS.QB : (pos === "RB" || pos === "FB") ? COLS.RUSH : COLS.RECV;

const num = (v) => (v == null ? null : typeof v === "number" ? v : Number(v));

/** A column's value on one week row — a stored field, or a derived one. */
const cellVal = (c, row) => (c.val ? c.val(row) : num(row[c.key]));

/** Mean of the non-null values, so a missing week never drags an average down. */
function mean(rows, col) {
  const vals = rows.map((r) => cellVal(col, r)).filter((v) => v != null && Number.isFinite(v));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

export function GameLog({ weeks, pos, seasonLabel, emptyText, seasons, onSeason }) {
  const [sort, setSort] = useState({ col: "week", dir: "desc" });
  const cols = colsFor(pos);
  const headline = cols.find((c) => c.headline)?.key;

  const rows = useMemo(() => {
    const r = [...(weeks || [])];
    const dir = sort.dir === "asc" ? -1 : 1;
    const col = cols.find((c) => c.key === sort.col);
    if (sort.col === "week") r.sort((a, b) => (b.week - a.week) * dir);
    // Opponent is a text column, so it compares as text — sorting it as a
    // number would silently order every row as NaN and leave them untouched.
    else if (sort.col === "opponent") {
      r.sort((a, b) => String(b.opponent || "").localeCompare(String(a.opponent || "")) * dir);
    } else if (col) {
      r.sort((a, b) => ((cellVal(col, b) ?? -Infinity) - (cellVal(col, a) ?? -Infinity)) * dir);
    }
    return r;
  }, [weeks, sort, cols]);

  const onSort = (col) => setSort((s) =>
    s.col === col ? { col, dir: s.dir === "desc" ? "asc" : "desc" } : { col, dir: "desc" });

  const avgs = useMemo(() => {
    const out = {};
    for (const c of cols) out[c.key] = mean(weeks || [], c);
    return out;
  }, [weeks, cols]);

  const maxHeadline = useMemo(() => {
    if (!headline) return 0;
    return Math.max(0, ...(weeks || []).map((w) => num(w[headline]) ?? 0));
  }, [weeks, headline]);

  if (!weeks?.length) {
    return (
      <>
        {seasons && <SeasonSwitch seasons={seasons} onSeason={onSeason} />}
        <Empty>{emptyText || "No weekly game log for this player yet — it fills in as games are played."}</Empty>
      </>
    );
  }

  // A QB's column set has no role columns at all — he is on the field for every
  // dropback and "opportunities per snap" is not a question about him — so the
  // footnote below must not promise columns that are never coming.
  const hasRoleCols = cols.some((c) => c.role);
  const anyRole = hasRoleCols && weeks.some((w) => w.snap_pct_wk != null || w.routes_wk != null);
  // A role column with no value in ANY week is dropped rather than printed as a
  // column of dashes — in-season, snaps exist (snap_counts) but routes do not.
  const shown = (anyRole ? cols : cols.filter((c) => !c.role))
    .filter((c) => !c.role || weeks.some((w) => cellVal(c, w) != null));
  const anyRoutes = weeks.some((w) => w.routes_wk != null);

  // Shade a cell by how far it sits from the player's own average. Deliberately
  // his OWN average, not the league's — this table is about how a week compares
  // to his normal, which is the question a game log answers.
  const cellColor = (c, v) => {
    const a = avgs[c.key];
    if (v == null || a == null || !a) return C.txt;
    const d = (v - a) / Math.abs(a);
    const good = c.lowGood ? -d : d;
    if (good > 0.35) return C.good;
    if (good < -0.35) return C.bad;
    return C.txt;
  };

  return (
    <div className="fade-in" style={S.card}>
      <div style={S.cardHead}>
        <div style={S.cardTitle}>Game Log</div>
        <span style={{ ...S.cardMeta, display: "flex", alignItems: "center", gap: 8 }}>
          {seasonLabel ? `${seasonLabel} · ` : ""}{weeks.length} {weeks.length === 1 ? "game" : "games"} · shaded vs his own average
          {seasons && <SeasonSwitch seasons={seasons} onSeason={onSeason} />}
        </span>
      </div>

      <div style={S.tblWrap}>
        <table style={{ ...S.tbl, minWidth: 540 }}>
          <thead>
            <tr>
              <th style={{ ...S.thLeft, minWidth: 44 }}>
                <SortBtn col="week" sort={sort} onSort={onSort} align="left">Wk</SortBtn>
              </th>
              <th style={{ ...S.thLeft, minWidth: 48 }}>
                <SortBtn col="opponent" sort={sort} onSort={onSort} align="left">Opp</SortBtn>
              </th>
              {headline && <th style={{ ...S.th, width: 62 }} />}
              {shown.map((c) => (
                <th key={c.key} style={S.th}>
                  <SortBtn col={c.key} sort={sort} onSort={onSort}>{c.label}</SortBtn>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => {
              const hv = headline ? num(w[headline]) ?? 0 : 0;
              return (
                <tr key={w.week} className="row-hover">
                  <td style={{ ...S.tdLeft, fontWeight: 700, fontFamily: MON, fontSize: 12 }}>{w.week}</td>
                  <td style={{ ...S.tdLeft, color: C.faint, fontFamily: MON, fontSize: 11 }}>{w.opponent || "—"}</td>
                  {headline && (
                    <td style={{ ...S.td, width: 62 }}>
                      <div style={{ height: 5, borderRadius: 3, background: C.inset, overflow: "hidden" }}>
                        <div style={{ height: "100%", borderRadius: 3, background: C.accent,
                          width: maxHeadline ? `${Math.max(2, (hv / maxHeadline) * 100)}%` : "2%" }} />
                      </div>
                    </td>
                  )}
                  {shown.map((c) => {
                    const v = cellVal(c, w);
                    return (
                      <td key={c.key} style={{ ...S.td, color: cellColor(c, v) }}>
                        {v == null ? "—" : c.fmt ? c.fmt(v) : v}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: alpha(C.deep, 0.6) }}>
              <td style={{ ...S.tdLeft, ...S.sectionLabel, borderBottom: "none" }}>Avg</td>
              <td style={{ ...S.td, borderBottom: "none" }} />
              {headline && <td style={{ ...S.td, borderBottom: "none" }} />}
              {shown.map((c) => {
                const a = avgs[c.key];
                return (
                  <td key={c.key} style={{ ...S.td, fontWeight: 700, color: C.txt, borderBottom: "none" }}>
                    {a == null ? "—" : c.fmt ? c.fmt(a) : (Math.round(a * 10) / 10)}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>

      {hasRoleCols && (!anyRole || !anyRoutes) && (
        <div style={{ padding: "8px 14px", fontSize: 10, color: C.faintest, borderTop: `1px solid ${C.lineSoft}`,
          lineHeight: 1.6 }}>
          {!anyRole
            ? "Snap and opportunity columns appear once the role data is built for this season."
            : "OPP/SN is targets plus carries per offensive snap — the in-season read on whether the"
              + " snaps were the useful kind. ROUTES RUN has no in-season source: it comes from"
              + " participation data the league publishes after the season, so the route share, TPRR"
              + " and YPRR on the Profile tab describe the last completed season."}
        </div>
      )}
    </div>
  );
}

/** [{ season, active }] → a pill per season. Shared by the log and the profile. */
export function SeasonSwitch({ seasons, onSeason }) {
  return (
    <span style={{ display: "inline-flex", gap: 3 }}>
      {seasons.map((x) => (
        <button key={x.season} onClick={() => onSeason(x.season)} style={{ ...S.chipTab(x.active), padding: "2px 8px" }}>
          {x.season}
        </button>
      ))}
    </span>
  );
}
