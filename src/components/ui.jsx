// ── Shared UI primitives ─────────────────────────────────────────────────────
// Small, dumb, reusable building blocks. No model logic lives here.
import { useState } from "react";
import { S, C, MON, heat, alpha } from "../lib/theme.js";
import { pct, pct1, multPct, multColor } from "../lib/format.js";
import { BOOK_LABEL } from "../lib/odds.js";
import { sideOf, sideLetter, SIDE_ARROW, SIDE_LETTER } from "../lib/confidence.js";

// ── layout ───────────────────────────────────────────────────────────────────

/**
 * The standard panel: a titled head bar with right-aligned meta, then children.
 * Every section on every tab is one of these, which is what makes the tabs read
 * as one app rather than five.
 *
 * `flush` drops the body padding for a table (which supplies its own).
 */
export function Card({ title, meta, right, children, flush, style }) {
  return (
    <div style={{ ...S.card, ...style }}>
      {(title || meta || right) && (
        <div style={S.cardHead}>
          <div style={S.cardTitle}>{title}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {meta && <span style={S.cardMeta}>{meta}</span>}
            {right}
          </div>
        </div>
      )}
      <div style={flush ? undefined : S.cardBody}>{children}</div>
    </div>
  );
}

/** Small uppercase caption above a strip of cards. */
export function SectionLabel({ children, right }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
      <span style={S.sectionLabel}>{children}</span>
      {right}
    </div>
  );
}

export function Empty({ children }) {
  return <div style={{ ...S.card, padding: 24, textAlign: "center", color: C.muted, fontSize: 13 }}>{children}</div>;
}

// ── controls ─────────────────────────────────────────────────────────────────

/** Segmented control button. `size="chip"` is the compact run (week pills). */
export function Pill({ active, onClick, children, size, title }) {
  const st = size === "chip" ? S.chipTab(active) : S.propTab(active);
  return <button title={title} onClick={onClick} style={st}>{children}</button>;
}

/**
 * A sortable column header. Clicking the active column flips direction, which
 * is the behaviour every dense table here now shares.
 */
export function SortBtn({ col, sort, onSort, children, align = "center" }) {
  const active = sort.col === col;
  return (
    <button
      onClick={() => onSort(col)}
      style={{
        background: "none", border: "none", padding: 0, cursor: "pointer",
        color: active ? C.accent : "inherit", fontSize: 9, fontWeight: 600,
        textTransform: "uppercase", letterSpacing: "0.02em",
        display: "flex", alignItems: "center", gap: 2,
        justifyContent: align === "left" ? "flex-start" : "center",
        width: "100%", fontFamily: "inherit",
      }}>
      {children}
      <span style={{ opacity: active ? 1 : 0.35 }}>{active && sort.dir === "asc" ? "▲" : "▼"}</span>
    </button>
  );
}

// ── faces and logos ──────────────────────────────────────────────────────────
// URLs come from src/lib/headshots.js (headshotOf / logoOf). An image that
// fails to load is remembered BY URL, so a row that re-renders with a new
// player gets a fresh try instead of inheriting the last one's failure.

const initials = (name) => (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

/**
 * A player's face in a circle, his team's logo as a corner badge.
 *
 * Falls back to the team logo, then to initials — never a broken image. `ring`
 * draws a colored ring (the profile header uses the team color).
 */
export function Headshot({ src, logo, name, size = 32, badge = true, ring }) {
  const [badSrc, setBadSrc] = useState(null);
  const [badLogo, setBadLogo] = useState(null);
  const face = src && badSrc !== src ? src : null;
  const mark = logo && badLogo !== logo ? logo : null;
  const b = Math.max(12, Math.round(size * 0.42));
  return (
    <span style={{ position: "relative", width: size, height: size, flexShrink: 0, display: "inline-block" }}>
      <span style={{
        width: size, height: size, borderRadius: "50%", overflow: "hidden", display: "flex",
        alignItems: "center", justifyContent: "center", background: alpha(C.accent, 0.08),
        border: `${ring ? 2 : 1}px solid ${ring || C.line}`, boxSizing: "border-box",
      }}>
        {face ? (
          <img src={face} alt="" loading="lazy" onError={() => setBadSrc(src)}
            style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top" }} />
        ) : mark ? (
          <img src={mark} alt="" loading="lazy" onError={() => setBadLogo(logo)}
            style={{ width: "68%", height: "68%", objectFit: "contain" }} />
        ) : (
          <span style={{ fontSize: Math.round(size * 0.36), fontWeight: 700, color: C.muted }}>{initials(name)}</span>
        )}
      </span>
      {badge && face && mark && (
        <span style={{
          position: "absolute", right: -3, bottom: -3, width: b, height: b, borderRadius: "50%",
          background: C.panelSolid, border: `1px solid ${C.line}`, display: "flex",
          alignItems: "center", justifyContent: "center",
        }}>
          <img src={mark} alt="" loading="lazy" onError={() => setBadLogo(logo)}
            style={{ width: "80%", height: "80%", objectFit: "contain" }} />
        </span>
      )}
    </span>
  );
}

/** A team logo, or nothing at all when there is none or it fails to load. */
export function TeamLogo({ src, size = 18, title }) {
  const [bad, setBad] = useState(null);
  if (!src || bad === src) return null;
  return <img src={src} alt="" title={title} loading="lazy" onError={() => setBad(src)}
    style={{ width: size, height: size, objectFit: "contain", flexShrink: 0, verticalAlign: "middle" }} />;
}

// ── atoms ────────────────────────────────────────────────────────────────────

export function Bar({ value, max = 1, color, h = 8 }) {
  return (
    <div style={{ background: C.inset, borderRadius: 6, height: h, overflow: "hidden", flex: 1 }}>
      <div style={{ width: `${Math.min(100, Math.max(0, (value / max) * 100))}%`, height: "100%", background: color, borderRadius: 6 }} />
    </div>
  );
}

export function Chip({ children, color, title }) {
  const c = color || C.line;
  return (
    <span title={title} style={{
      fontSize: 10, padding: "2px 7px", borderRadius: 4, fontWeight: 600, whiteSpace: "nowrap",
      background: alpha(c, 0.133), color: color || C.muted, border: `1px solid ${alpha(c, 0.333)}`,
    }}>{children}</span>
  );
}

/** The tightest label — 9px, no border. For in-table position / team marks. */
export function Tag({ children, color, title }) {
  const c = color || C.faint;
  return <span title={title} style={S.tag(alpha(c, 0.133), c)}>{children}</span>;
}

/** A headline number with a caption. The KPI row on Results, the leader tiles. */
export function StatTile({ label, v, sub, color }) {
  return (
    <div style={{ ...S.card, marginBottom: 0, padding: "10px 14px", minWidth: 104, flex: "1 1 104px" }}>
      <div style={{ ...S.sectionLabel, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, fontFamily: MON, color: color || C.txt, lineHeight: 1.1 }}>{v}</div>
      {sub && <div style={{ fontSize: 10, color: C.faint, marginTop: 3, fontFamily: MON }}>{sub}</div>}
    </div>
  );
}

// signed-percent chip driven by a multiplier (e.g. matchup tilt)
export function MultChip({ mult, suffix }) {
  if (mult == null) return null;
  return <Chip color={mult > 1.01 ? C.good : mult < 0.99 ? C.bad : null}>{multPct(mult)}{suffix ? ` ${suffix}` : ""}</Chip>;
}

export function MultTxt({ m }) {
  return <span style={{ color: multColor(m), fontFamily: MON }}>{multPct(m)}</span>;
}

export function Stat({ label, v, good }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
      <span style={{ color: C.muted }}>{label}</span>
      <span style={{ color: good == null ? C.txt : good ? C.good : C.bad, fontWeight: 600, fontFamily: MON }}>{v ?? "—"}</span>
    </div>
  );
}

export function Label({ children }) {
  return <div style={{ ...S.sectionLabel, marginBottom: 5 }}>{children}</div>;
}

// ── data-honesty cells ───────────────────────────────────────────────────────

// Where a player's baseline came from, and how much of it is live data.
// At a season flip most "projections" rest on LAST season's usage; showing that
// as an unqualified number would present a carried-forward guess as a
// measurement. `c` is the `_carryover` block from src/lib/playerPriors.js.
export function BaselineChip({ c, depth }) {
  if (!c) return <span style={{ color: C.muted }}>—</span>;
  const live = Math.round((c.live_weight ?? 0) * 100);
  // PROMOTED outranks every other provenance, because it replaces the number
  // rather than qualifying it: the volume on this row is the man he is standing
  // in for, handed over because his club filed everyone above him Out. Saying
  // "LAST YR" here would be a straightforward lie about where the projection
  // came from. See src/lib/depthPromotion.js.
  if (c.promoted_from) {
    const rank = c.depth_pos && c.promoted_rank != null ? `${c.depth_pos}${c.promoted_rank}` : null;
    return (
      <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
        <Tag color={C.warn} title={`Promoted: his club has ruled out every ${c.depth_pos || "player"} listed above him, so the volume on this row is the STARTER'S carried rate, not his. Measured at 28.0 attempts against a healthy backup's 1.9. His efficiency and his rushing are still his own.`}>
          PROMOTED
        </Tag>
        {rank && <Tag color={C.faint} title="Where his club listed him before the promotion">{rank}</Tag>}
      </span>
    );
  }
  if (c.prior_source === "rookie") {
    return <Tag color={C.purple} title="No prior season — projected entirely from this year's games">ROOKIE</Tag>;
  }
  // A rookie with no games but a published depth-chart rank. He is projected off
  // what that ROLE averaged last season, not off anything he has done — so the
  // chip says so, and shows the rank the whole projection rests on.
  if (c.prior_source === "role-average") {
    const rank = c.depth_pos && c.depth_rank != null ? `${c.depth_pos}${c.depth_rank}` : null;
    return (
      <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
        <Tag color={C.purple} title={`No NFL history. Projected off the ${rank || "role"} league average from last season — a role, not a player. Weans onto his own games fast.`}>
          ROOKIE
        </Tag>
        {rank && <Tag color={C.faint} title="Where his club lists him on the current depth chart">{rank}</Tag>}
      </span>
    );
  }
  const label = live === 0
    ? (c.changed_team ? `${c.prior_team}→NEW` : "LAST YR")
    : `${live}% LIVE`;
  // A row that only exists because the rate was multiplied by a play rate is
  // making a different kind of claim from a starter's, and the tooltip is where
  // that gets said — the badge itself stays about the carried/live split.
  const pr = c.play_rate;
  const availNote = pr != null && pr < 0.9
    ? ` · scaled to ${Math.round(pr * 100)}% — the share of games a man his club charts at ${c.depth_pos || "this rank"}${c.depth_rank != null ? c.depth_rank : ""} actually plays`
    : "";
  const title = (live === 0
    ? `Baseline is entirely ${c.prior_team ? `his ${c.prior_team} ` : ""}prior season — no games played yet`
    : `${live}% of this baseline is ${c.live_games}-game current-season data, the rest carried forward`) + availNote;
  return (
    <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
      <Tag color={live >= 60 ? C.good : live > 0 ? C.warn : C.faint} title={title}>
        {label}{c.changed_team && live > 0 ? " ⇄" : ""}
      </Tag>
      <DepthMoveTag c={c} depth={depth} live={live} />
    </span>
  );
}

/**
 * The depth chart, shown as a MOVE rather than as a rank.
 *
 * This used to render a bare red "RB3" beside "LAST YR", and sitting in a column
 * headed Baseline that reads as a claim about where the baseline came from —
 * "his baseline is the RB3 role" — which is the opposite of what it means. It
 * means the club lists him RB3 NOW and his carried baseline was earned in a
 * bigger job. Kimani Vidal is the case: RB3 today, an average chart rank of 1.85
 * over the stretch of 2025 his numbers come from.
 *
 * So it renders the arrow when both ends are known (RB2→RB3), and the model now
 * acts on exactly that difference — see ROLE_SHIFT in src/lib/models.js. A rank
 * with no comparison keeps the bare form, because there is no move to show.
 */
function DepthMoveTag({ c, depth, live }) {
  const now = depth?.rank ?? c.depth_rank;
  if (now == null) return null;
  const earned = depth?.rankEarned ?? null;
  const pos = depth?.pos || c.depth_pos || "";
  // A demotion is worth flagging at any live weight; a rank on its own is only
  // interesting while the baseline is still mostly carried, because once he has
  // played the games ARE the role.
  const moved = earned != null && now - earned > 0.5;
  if (!moved && !(live === 0 && now > 2)) return null;

  // The LABEL rounds to whole ranks — "RB2→3" is the sentence a reader means.
  // The earned rank is an average over the chart snapshots the baseline was
  // measured across, so its fractional part belongs in the tooltip, where the
  // exact number is the thing being explained.
  const exact = (v) => (Number.isInteger(v) ? v : v.toFixed(1));
  return (
    <Tag color={C.bad}
      title={moved
        ? `Listed ${pos}${Math.round(now)} now; the carried baseline was earned at an average chart rank of `
          + `${exact(earned)} — a bigger job. Rushing volume and the anytime-TD projection are both cut for the move.`
        : `Listed ${pos}${Math.round(now)} on the current depth chart, and the baseline is entirely carried — `
          + "no 2026 snap has confirmed the role either way."}>
      {moved ? `${pos}${Math.round(earned)}→${Math.round(now)}` : `${pos || "DEPTH"}${Math.round(now)}`}
    </Tag>
  );
}

/**
 * Model probability minus the book's de-vigged probability, in points, at the
 * BEST price on the row's own line.
 *
 * "Best price" is not a detail here. The board shops three books and they
 * disagree — Kimani Vidal's week-1 anytime TD was +250 at FanDuel and +450 at
 * DraftKings, which is 28.6% implied against 18.2%, a ten-point difference in
 * the edge for the identical bet. Quoting the edge against a price you would not
 * take overstates or understates every row by however much the book you ignored
 * was better. See priceAgainstMarket().
 *
 * DISPLAY ONLY — never a gate. A gate written against this number silently
 * retunes the moment the probability calibration moves; gates belong in
 * score space (projection vs line). A one-sided market (anytime TD) is marked,
 * because its "edge" is measured against a price that still contains the vig
 * and so overstates the disagreement by roughly the hold.
 */
/**
 * Model probability minus the book's, in points.
 *
 * `trusted` is false for a projection we will show and will not price against a
 * market — today that is a defensive back's sack row, whose number is unbiased
 * across the population and still runs 1.46x hot on the rows that reach a board
 * (SACK_PARAMS.EV_POS). The cell says n/a rather than printing an edge we do not
 * stand behind, and boardSort sinks it so the column and the cell agree.
 */
export function EdgeCell({ p, trusted = true }) {
  if (!p) return <span style={{ color: C.faintest }}>—</span>;
  if (!trusted) return (
    <span style={{ color: C.faintest }}
      title="The price is shown and the edge is not claimed: this position group's projection is unbiased across the population and still runs ~46% hot on the rows that reach a board.">
      n/a
    </span>
  );
  const pts = p.edge * 100;
  const strong = Math.abs(pts) >= 3;
  return (
    <span style={{ color: pts > 0 ? C.good : pts < 0 ? C.bad : C.muted, fontWeight: strong ? 700 : 500 }}
      title={`model ${pct1(p.modelProb)} vs ${BOOK_LABEL[p.book] || p.book}'s ${pct1(p.mktProb)} at o${p.line}` +
        ` — the best of ${Object.keys(p.books || {}).length} book(s) on this line` +
        (p.rawProb != null && Math.abs(p.rawProb - p.modelProb) >= 0.0005
          ? `. Calibrated to the price; the projection alone says ${pct1(p.rawProb)}` : "") +
        (p.devigged ? "" : " (vig not removable — one-sided market)")}>
      {pts > 0 ? "+" : ""}{pts.toFixed(1)}
      {!p.devigged && <span style={{ color: C.muted, fontWeight: 400 }}>*</span>}
    </span>
  );
}

// ── side, win probability, confidence ────────────────────────────────────────
// See src/lib/confidence.js for why all three exist. The short version: a column
// of P(over) sorted descending buries every strong UNDER at the bottom of the
// board, and a confidence badge with no direction marker reads as "strong over"
// on rows that are strong unders.

/** One colour for the side wherever it appears, so O/U never means two things. */
const sideColor = (s) => (s === "over" ? C.good : s === "under" ? C.bad : C.muted);

/**
 * Probability that the model's SIDE hits, with the O/U tag saying which side.
 * Lives in [50%, 100%] by construction, so its colour breaks are not the 0-100
 * ones — 55% here is a coin flip, not a lean.
 */
export function WinCell({ prob, line, oneSided, call = null }) {
  if (prob == null) return <span style={{ color: C.faintest }}>—</span>;
  const side = oneSided ? "over" : sideOf(prob);
  const win = oneSided ? prob : Math.max(prob, 1 - prob);
  const p = Math.round(win * 100);
  // A one-sided row the model does not back: the only bet is the Yes, and at
  // this price we would not take it. Still on the board so he can be found;
  // never graded (src/lib/pickLedger.js, ONE-SIDED CALLS).
  const no = oneSided && call === "no";
  // No book has posted him: there is no Yes to take or pass on, so no tag.
  const unpriced = oneSided && call == null;
  const col = no ? C.faint : p >= 65 ? C.good : p >= 57 ? C.warn : C.muted;
  const tagCol = no ? C.faint : sideColor(side);
  return (
    <span title={no
      ? `The model gives him ${p}% to clear ${line}, and the posted Yes is not worth it at that number — a NO. Shown so you can find him; not a pick and not graded.`
      : unpriced
      ? `The model gives him ${p}% to clear ${line}. No book has posted him, so there is no Yes to take — not a pick.`
      : oneSided
      ? `One-sided market — the book posts only the Yes, so there is no under to take. ${p}% is the model's chance he clears ${line}, and at the posted price it is a Yes.`
      : `Model gives the ${side.toUpperCase()}${line != null ? ` ${line}` : ""} a ${p}% chance to hit (P(over) = ${Math.round(prob * 100)}%).`}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap", justifyContent: "center" }}>
      <span style={{ color: col, fontWeight: 700 }}>{p}%</span>
      {!unpriced && <span style={{
        fontSize: 8, fontWeight: 800, lineHeight: 1, padding: "2px 4px", borderRadius: 3,
        color: tagCol, background: alpha(tagCol, 0.122), border: `1px solid ${alpha(tagCol, 0.302)}`,
      }}>{no ? "NO" : oneSided ? "YES" : sideLetter(prob)}</span>}
    </span>
  );
}

const CONF_STYLE = {
  high:   { color: C.good, bg: alpha(C.good, 0.12), border: alpha(C.good, 0.25) },
  medium: { color: C.warn, bg: alpha(C.warn, 0.12), border: alpha(C.warn, 0.25) },
  low:    { color: C.muted, bg: alpha(C.muted, 0.10), border: alpha(C.muted, 0.2) },
};

/**
 * Conviction tier plus the side it is conviction ABOUT.
 *
 * DISPLAY ONLY. Nothing filters on it — a gate written against a probability
 * silently retunes when the calibration moves, which is why the ones that matter
 * live in score space (CLAUDE.md).
 */
export function ConfCell({ conf, line, capped }) {
  if (!conf?.side) return <span style={{ color: C.faintest }}>—</span>;
  const cs = CONF_STYLE[conf.tier] || CONF_STYLE.low;
  const where = line != null ? ` ${line}` : "";
  return (
    <span title={`${conf.tier.toUpperCase()} conviction on the ${conf.side.toUpperCase()}${where} — confidence measures distance from a coin flip, not how likely the over is.` +
      (capped ? " Capped: he carries an unresolved game-status designation, so whether he plays is the bigger unknown." : "")}
      style={{ fontSize: 8, fontWeight: 700, padding: "2px 5px", borderRadius: 3, background: cs.bg,
        color: cs.color, border: `1px solid ${cs.border}`, textTransform: "uppercase",
        letterSpacing: "0.04em", whiteSpace: "nowrap" }}>
      {conf.tier}
      <span style={{ marginLeft: 3, color: sideColor(conf.side), fontSize: 9 }}>
        {SIDE_ARROW[conf.side]}{SIDE_LETTER[conf.side]}
      </span>
      {capped && <span style={{ marginLeft: 2, color: C.warn }}>*</span>}
    </span>
  );
}

/**
 * The club's filed availability, or an off-roster status.
 *
 * Renders NOTHING when there is nothing to say. An "OK" chip on every healthy
 * row would assert a check we have not made — the report only lists players who
 * appear on it, and silence there is silence, not a clean bill of health.
 */
export function AvailChip({ a }) {
  if (!a?.label) return null;
  const c = a.tone === "bad" ? C.bad : C.warn;
  return <Tag color={c} title={a.detail}>{a.label}</Tag>;
}

// ── heat cells (the board's Diff and Hit Rates columns) ──────────────────────
// Each returns the whole <td>, because the heat wash fills the cell.

const cellDash = <span style={{ color: C.faintest }}>—</span>;

/** A rate cell: the percentage over a heat wash, with the record in the tooltip. */
export function HitTd({ h, line, what }) {
  if (!h || h.n === 0) return <td style={S.td}>{cellDash}</td>;
  const thin = h.n < 3;
  return (
    <td title={`${h.hits} of ${h.n} ${what} went over ${line}${thin ? " — thin sample" : ""}`}
      style={{ ...S.td, background: heat(h.rate, thin), color: thin ? C.muted : C.txt, fontWeight: 600 }}>
      {Math.round(h.rate * 100)}%
    </td>
  );
}

/** Projection minus line, washed by how big the gap is relative to the line. */
export function DiffTd({ r }) {
  if (r.diff == null) return <td style={S.td}>{cellDash}</td>;
  // A quarter of the line either way is a full-strength cell: 12 yards on a
  // 48.5 receiving line is a big disagreement, 12 on a 245.5 passing line is not.
  const rel = r.diff / Math.max(Math.abs(r.probLine), 1);
  const x = 0.5 + Math.max(-0.25, Math.min(0.25, rel)) * 2;
  return (
    <td title={`Projection ${r.proj} vs line ${r.probLine}`}
      style={{ ...S.td, background: heat(x), color: C.txt, fontWeight: 700 }}>
      {r.diff > 0 ? "+" : ""}{r.diff.toFixed(1)}
    </td>
  );
}

export function StreakTd({ k }) {
  if (!k) return <td style={S.td}>{cellDash}</td>;
  const over = k > 0;
  return (
    <td title={`${Math.abs(k)} straight game${Math.abs(k) === 1 ? "" : "s"} ${over ? "over" : "under"} this line`}
      style={{ ...S.td, color: over ? C.good : C.bad, fontWeight: 700 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {Math.abs(k)}
        <span style={{ fontSize: 8, fontWeight: 800, lineHeight: 1, padding: "2px 4px", borderRadius: 3,
          background: alpha(over ? C.good : C.bad, 0.122), border: `1px solid ${alpha(over ? C.good : C.bad, 0.302)}` }}>
          {over ? "O" : "U"}
        </span>
      </span>
    </td>
  );
}

// the coverage "pitch mix" stacked bar — used in Matchup Lab and Defenses
export function CoverageArsenal({ def, covKeys }) {
  if (!def) return null;
  const parts = covKeys.map(([k, label, c]) => ({ label, c, v: def[k] || 0 })).filter((p) => p.v > 0.01)
    .sort((a, b) => b.v - a.v);
  // Coverage SHELL does not carry year to year (see Defenses.jsx), so at a
  // season flip most teams have none. An empty bordered strip reads as broken
  // UI rather than as missing data — say which it is.
  if (!parts.length) {
    return (
      <div style={{ ...S.inset, padding: "8px 10px", fontSize: 10, color: C.faint, fontFamily: MON }}>
        No coverage-shell profile — the shell mix is not carried across seasons.
      </div>
    );
  }
  return (
    <div>
      <div style={{ display: "flex", height: 12, borderRadius: 6, overflow: "hidden", border: `1px solid ${C.line}` }}>
        {parts.map((p) => <div key={p.label} title={`${p.label} ${pct(p.v)}`} style={{ width: `${p.v * 100}%`, background: p.c }} />)}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
        {parts.slice(0, 5).map((p) => (
          <span key={p.label} style={{ fontSize: 10, color: C.muted, fontFamily: MON }}>
            <span style={{ display: "inline-block", width: 7, height: 7, background: p.c, borderRadius: 2, marginRight: 4 }} />
            {p.label} {pct(p.v)}
          </span>
        ))}
      </div>
    </div>
  );
}

export { S, C, MON };
