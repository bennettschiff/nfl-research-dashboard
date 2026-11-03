// ── A sack row, expanded ─────────────────────────────────────────────────────
// The board's normal expansion (RowDetail in Board.jsx) answers "why this
// number" for an offensive player: every prop the model priced for him, who is
// coaching both sides, his game log, his position room's snap counts, the factor
// chain. None of that exists for a defender — the bundled game log is offensive,
// the snap room is offensive, and the scheme cascade is a receiving model — so
// answering with a wall of empty panels would be worse than answering with the
// four things that actually built λ.
//
// WHAT THIS SHOWS, in the order the model computes it:
//
//   THE LADDER   every rung a book posts (0.25 / 0.5 / 0.75 / 1.0), our
//                probability at it and the fair price. This is the point of the
//                expansion: the row itself can only show the rung it is priced
//                at, and the reader's next question is always "what about the
//                other one". 0.5 and 0.75 are the same bet at two numbers
//                (both need a whole sack to WIN; a half on 0.5 pushes), and
//                laying them out side by side is what makes that obvious.
//
//   THE INPUTS   opportunities = snap share x dropbacks faced; the rate; the
//                opposing line's sacks allowed; the spread that moves the
//                dropbacks. See src/lib/sacks.js.
//
//   THE MARKET   every rung every book posted, with our number beside each one,
//                so "the best rung" is a claim the reader can check.
import { S, C, MON, POS_COLORS, readable, goodBad, alpha } from "../lib/theme.js";
import { pct1, fmtOdds } from "../lib/format.js";
import { BOOK_LABEL } from "../lib/odds.js";
import { Tag, AvailChip, SectionLabel, Headshot, TeamLogo } from "./ui.jsx";
import { headshotOf, logoOf } from "../lib/headshots.js";

const dash = <span style={{ color: C.faintest }}>—</span>;
const pctOf = (x) => (x == null ? "—" : `${(100 * x).toFixed(1)}%`);

export function SackDetail({ r, d, onClose }) {
  const ladder = r.ladder || [];
  // Every (book, rung) posted on him, best first — see sackPriced().
  const rungs = r.priced?.offers || [];

  return (
    <div className="fade-in" style={{ background: C.inset, borderTop: `1px solid ${C.line}`,
      borderBottom: `1px solid ${C.line}`, padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <Headshot src={headshotOf(d, r.player_id)} logo={logoOf(d, r.team)} name={r.name} size={56}
          ring={readable(d.teams?.[r.team]?.color)} />
        <span style={{ fontSize: 15, fontWeight: 700 }}>{r.name}</span>
        <Tag color={POS_COLORS[r.pos] || C.muted}>{r.pos}</Tag>
        <span style={{ fontSize: 11, color: C.muted, fontFamily: MON, display: "inline-flex", alignItems: "center", gap: 4 }}>
          <TeamLogo src={logoOf(d, r.team)} size={18} />
          <span style={{ color: readable(d.teams?.[r.team]?.color) || C.muted }}>{r.team}</span>
          {r.side === "home" ? " vs " : " @ "}
          <TeamLogo src={logoOf(d, r.opp)} size={18} />
          <span style={{ color: readable(d.teams?.[r.opp]?.color) || C.muted }}>{r.opp}</span>
        </span>
        <AvailChip a={r.avail} />
        <span style={{ fontSize: 11, color: C.faint, fontFamily: MON }}>
          {r.lambda.toFixed(2)} expected sacks
        </span>
        <div style={{ marginLeft: "auto" }}>
          <button style={S.btnGhost} onClick={(e) => { e.stopPropagation(); onClose(); }}>Close</button>
        </div>
      </div>

      {/* ── the ladder ─────────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fill,minmax(132px,1fr))",
        marginBottom: 12 }}>
        {ladder.map((x) => {
          const isRow = x.line === r.probLine;
          // What WINS the rung: a credit strictly over it (sacks.js sackProbOver).
          // 0.5 and 0.75 both need a whole sack; a half on 0.5 is a push. Saying
          // so on the tile is the whole reason the tile exists.
          const needs = x.line < 0.5 ? "needs half a sack" : x.line < 1 ? "needs a full sack"
            : x.line < 1.5 ? "needs a sack and a half" : x.line < 2 ? "needs two" : "needs three";
          const pushes = Math.abs(2 * x.line - Math.round(2 * x.line)) < 1e-9 ? `; ${x.line} exactly pushes` : "";
          return (
            <div key={x.line} style={{ background: alpha(C.panelSolid, 0.6),
              border: `1px solid ${isRow ? alpha(C.accent, 0.4) : C.line}`, borderRadius: 8, padding: "8px 10px" }}
              title={`o${x.line} ${needs}${pushes}${isRow ? " — the rung this row is priced at" : ""}`}>
              <div style={{ ...S.sectionLabel, marginBottom: 4, color: isRow ? C.accent : C.faint }}>
                o{x.line}
              </div>
              <div style={{ fontSize: 17, fontWeight: 800, fontFamily: MON,
                color: x.prob >= 0.5 ? C.good : C.txt }}>
                {pct1(x.prob)}
              </div>
              <div style={{ fontSize: 10, color: C.faint, fontFamily: MON, marginTop: 4 }}>
                fair {fmtOdds(x.fair_line)}
              </div>
              <div style={{ fontSize: 9, color: C.faintest, marginTop: 2 }}>{needs}</div>
            </div>
          );
        })}
      </div>

      {/* ── what built λ ───────────────────────────────────────────────────── */}
      <SectionLabel>How the number was built</SectionLabel>
      <div style={{ ...S.card, marginBottom: 12 }}>
        <div style={S.tblWrap}>
          <table style={S.tbl}>
            <tbody>
              <Factor label="Snap share"
                v={r.snapPct == null ? null : `${Math.round(r.snapPct * 100)}%`}
                note="of his defence's snaps, recency-weighted — his rate is per dropback he was on the field for, not per game" />
              <Factor label="Evidence" v={r.games == null ? null : `${r.games} games`}
                note="defender-games behind the rate, inside the lookback. The rate is 70% QB HITS converted into sack units, because a hit happens 2.4x as often and is the same skill one step earlier" />
              <Factor label="Opposing line"
                v={r.oppSackRateAllowed == null ? null : `${(100 * r.oppSackRateAllowed).toFixed(1)}%`}
                note={`sacks allowed per dropback by ${r.opp}, shrunk toward the league`} />
              <Factor label="Line multiplier" v={r.tilt == null ? null : `${r.tilt.toFixed(3)}x`}
                color={r.tilt == null ? null : goodBad(r.tilt - 1)}
                note="that rate against the league's, capped at ±35% — the only matchup term this model has" />
              <Factor label="Spread"
                v={r.spread == null ? null : `${r.spread > 0 ? "+" : ""}${r.spread}`}
                note="his own team's side of it. A favoured defence faces a trailing offence, which throws more, so it moves the dropbacks he gets to rush on" />
            </tbody>
          </table>
        </div>
      </div>

      {/* ── the market ─────────────────────────────────────────────────────── */}
      {rungs.length > 0 && (
        <>
          <SectionLabel right={
            <span style={{ fontSize: 9, color: C.faint, fontFamily: MON }}>
              {rungs.length} rung{rungs.length === 1 ? "" : "s"} posted
            </span>
          }>Every rung on the board</SectionLabel>
          <div style={S.card}>
            <div style={S.tblWrap}>
              <table style={S.tbl}>
                <thead>
                  <tr>
                    <th style={S.thLeft}>Book</th>
                    <th style={S.th}>Rung</th>
                    <th style={S.th}>Price</th>
                    <th style={S.th}>Implied</th>
                    <th style={S.th}>Model</th>
                    <th style={S.th}>EV</th>
                  </tr>
                </thead>
                <tbody>
                  {rungs.map((x) => {
                    const best = x.book === r.priced.book && x.line === r.priced.line;
                    return (
                    <tr key={`${x.book}|${x.line}`} className="row-hover"
                      style={{ background: best ? alpha(C.accent, 0.06) : undefined }}>
                      <td style={{ ...S.tdLeft, fontFamily: MON, fontSize: 11 }}>
                        {BOOK_LABEL[x.book] || x.book}
                        {best && <Tag color={C.accent} title="The rung our number likes best">BEST</Tag>}
                      </td>
                      <td style={{ ...S.td, fontFamily: MON, fontWeight: 600 }}>o{x.line}</td>
                      <td style={{ ...S.td, fontFamily: MON }}>
                        {fmtOdds(x.odds)}{x.devigged ? "" : <span style={{ color: C.muted }}>*</span>}
                      </td>
                      <td style={{ ...S.td, fontFamily: MON, color: C.muted }}>{pctOf(x.implied)}</td>
                      <td style={{ ...S.td, fontFamily: MON, fontWeight: 700 }}>{pctOf(x.prob)}</td>
                      <td style={{ ...S.td, fontFamily: MON,
                        color: r.evTrusted === false ? C.faintest : goodBad(x.ev) }}>
                        {r.evTrusted === false ? "n/a"
                          : `${x.ev > 0 ? "+" : ""}${(100 * x.ev).toFixed(1)}`}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ padding: "8px 14px", fontSize: 10, color: C.faint,
              borderTop: `1px solid ${C.lineSoft}`, lineHeight: 1.6 }}>
              A rung wins only when his credit is over it: 0.25 needs half a sack, 0.5 and 0.75 both need a
              whole one (a half on 0.5 pushes), 1.0 needs one and a half. A <span style={{ color: C.muted }}>*</span> marks a
              price with no other side, whose vig cannot be removed, so its implied number still has the
              hold in it.
              {r.evTrusted === false && " EV is withheld for this position group — see the board's footnote."}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** One input row: what it is, what it was, and why it is in the model. */
function Factor({ label, v, note, color }) {
  return (
    <tr>
      <td style={{ ...S.tdLeft, width: 132, color: C.muted, fontSize: 11 }}>{label}</td>
      <td style={{ ...S.td, width: 92, fontFamily: MON, fontWeight: 700, color: color || C.txt }}>
        {v == null ? dash : v}
      </td>
      <td style={{ ...S.tdLeft, color: C.faint, fontSize: 10, lineHeight: 1.5 }}>{note}</td>
    </tr>
  );
}
