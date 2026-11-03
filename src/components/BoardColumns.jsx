// ── Board columns, by section ────────────────────────────────────────────────
// The board's table used to carry every column at once: projection, model reads
// and one price column per book, with the conditional ones tracked by a
// hand-counted colSpan. After props.cash, the columns now come in SECTIONS the
// reader switches between — the model's read, the player's hit rates against the
// line, the market — over a fixed core (prop, line, projection, diff, win%) that
// every section shares.
//
// Each column is a spec, so the header, the cell and the expansion row's colSpan
// all come from one list and cannot drift apart. The player cell is not a spec:
// it carries three sorts and is rendered by the board itself.
import { S, C } from "../lib/theme.js";
import { BOOK_PREF } from "../lib/odds.js";
import { TILT_EPS } from "../lib/boardSort.js";
import { MultTxt, BaselineChip, EdgeCell, WinCell, ConfCell, HitTd, DiffTd, StreakTd } from "./ui.jsx";
import { OddsCell, BookHead } from "./OddsCell.jsx";

export const SECTIONS = [
  { key: "model", label: "Model", defaultSort: "win" },
  { key: "hits", label: "Hit Rates", defaultSort: "l10" },
  { key: "odds", label: "Odds", defaultSort: "edge" },
];

const dash = <span style={{ color: C.faintest }}>—</span>;

/**
 * The column specs for a section.
 *
 * `books` is the set of price columns the Odds section shows, and it stays a
 * PARAMETER even though both lists (BOOK_PREF and SACK_BOOKS) are the same
 * three today. Hard-coding BOOK_PREF here is what broke the sack board when
 * they genuinely differed, and the seam is the only reason they can differ
 * again; the caller names its list rather than this file assuming one.
 *
 * @param ctx { anyCarryover, anyMarket, year, books }
 * @returns [{ key, label, title?, width?, td: (r) => <td/> }]
 */
export function columnsFor(section, { anyCarryover, anyMarket, year, books = BOOK_PREF }) {
  const core = [
    { key: "prop", label: "Prop", td: (r) => <td style={{ ...S.td, color: C.muted, fontSize: 10 }}>{r.propShort}</td> },
    { key: "line", label: "Line", title: "The book's line when one is posted, the model's own otherwise.",
      td: (r) => <td style={{ ...S.td, color: C.txt, fontWeight: 600 }}>{r.probLine}</td> },
    { key: "proj", label: "Proj", td: (r) => <td style={{ ...S.td, fontWeight: 700, fontSize: 13, color: C.txt }}>{r.proj}</td> },
    { key: "diff", label: "Diff", title: "Projection minus line. Blank on anytime TD, where the projection is a rate, not a count.",
      td: (r) => <DiffTd r={r} /> },
    { key: "win", label: "Win%",
      title: "Probability the model's side hits — max(P(over), P(under)), calibrated to the book's price once one is posted (the projection alone has measured to be worth about a seventh of its own spread). The O/U tag is which side that is; on a one-sided market YES means the Yes is worth its price and NO means it is not — shown, never graded.",
      td: (r) => <td style={S.td}><WinCell prob={r.prob} line={r.probLine} oneSided={r.oneSided} call={r.call} /></td> },
  ];

  const model = [
    ...(anyCarryover ? [{ key: "base", label: "Baseline",
      td: (r) => <td style={S.td}><BaselineChip c={r.carryover} depth={r.depth} /></td> }] : []),
    { key: "conf", label: "Conf",
      title: "Conviction tier: how far the model sits from a coin flip, nudged by how much of the baseline is measured rather than carried. Display only — never a gate.",
      td: (r) => <td style={S.td}><ConfCell conf={r.conf} line={r.probLine} capped={r.conf.capped} /></td> },
    { key: "tilt", label: "Tilt", title: "The scheme matchup multiplier vs this defense.",
      td: (r) => <td style={S.td}>{Math.abs(r.tilt - 1) > TILT_EPS ? <MultTxt m={r.tilt} /> : dash}</td> },
    ...(anyMarket ? [{ key: "edge", label: "Edge",
      td: (r) => <td style={S.td}><EdgeCell p={r.priced} trusted={r.evTrusted !== false} /></td> }] : []),
  ];

  const hits = [
    { key: "stk", label: "Stk", title: "Current run of games over (O) or under (U) this line.",
      td: (r) => <StreakTd k={r.hits?.streak} /> },
    { key: "h2h", label: "H2H", title: "Hit rate against this opponent, every season on file.",
      td: (r) => <HitTd h={r.hits?.h2h} line={r.probLine} what={`games vs ${r.opp}`} /> },
    { key: "l5", label: "L5", td: (r) => <HitTd h={r.hits?.l5} line={r.probLine} what="recent games" /> },
    { key: "l10", label: "L10", td: (r) => <HitTd h={r.hits?.l10} line={r.probLine} what="recent games" /> },
    { key: "l20", label: "L20", td: (r) => <HitTd h={r.hits?.l20} line={r.probLine} what="recent games" /> },
    { key: "szn", label: String(year), td: (r) => <HitTd h={r.hits?.szn} line={r.probLine} what={`${year} games`} /> },
    { key: "prev", label: String(year - 1), td: (r) => <HitTd h={r.hits?.prev} line={r.probLine} what={`${year - 1} games`} /> },
  ];

  const odds = anyMarket ? [
    ...books.map((bk) => ({
      key: bk, label: <BookHead book={bk} />, width: 54,
      title: `${bk}'s price for this prop. Click a price to open that book's bet slip.`,
      td: (r) => (
        <td style={S.td}>
          <OddsCell p={r.priced?.books?.[bk]} book={bk} best={r.priced?.best === bk} refLine={r.priced?.line} />
        </td>
      ),
    })),
    { key: "edge", label: "Edge",
      td: (r) => <td style={S.td}><EdgeCell p={r.priced} trusted={r.evTrusted !== false} /></td> },
  ] : [];

  const extra = section === "hits" ? hits : section === "odds" ? odds : model;
  return [...core, ...extra];
}
