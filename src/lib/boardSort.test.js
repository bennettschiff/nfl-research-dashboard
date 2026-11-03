// ── Board column sorting ─────────────────────────────────────────────────────
// "Every labelled column sorts" (CLAUDE.md) is only half the promise; the other
// half is that it sorts by what the cell SAYS. These tests pin both, and they
// exist because the Tilt column quietly broke the second half: it ranked on
// distance from neutral while the cell showed a signed percentage, so a
// descending sort read as unordered on the screen.
import { describe, it, expect } from "vitest";
import { SORT_VAL, SORT_CHAIN, SORT_COLS, HIT_COLS, cmp, comparatorFor, TILT_EPS } from "./boardSort.js";
import { BOOK_PREF, SACK_BOOKS } from "./odds.js";
import { confidenceOf } from "./confidence.js";
import { availabilityOf, indexInjuries } from "./injuries.js";

/** A board row with only the fields the sort table reads. */
function row(o = {}) {
  const prob = o.prob ?? 0.5;
  return {
    name: o.name ?? "Zed Zero", pos: o.pos ?? "WR", prop_type: o.prop_type ?? "rec_yards",
    proj: o.proj ?? 50, probLine: o.probLine ?? 45.5, prob,
    win: Math.max(prob, 1 - prob),
    conf: confidenceOf({ prob, carryover: o.carryover ?? null }),
    tilt: o.tilt ?? 1, carryover: o.carryover ?? null,
    avail: o.avail ?? availabilityOf(indexInjuries([]), "x", 1, "ACT"),
    priced: o.priced ?? null,
  };
}
const sortBy = (rows, col, dir = -1) => [...rows].sort(comparatorFor(col, dir));

describe("cmp", () => {
  it("sinks missing values in BOTH directions", () => {
    // An absent market line is not a zero one. If null sorted as small it would
    // top the ascending Edge column with a wall of dashes.
    expect(cmp(null, 5, -1)).toBe(1);
    expect(cmp(null, 5, 1)).toBe(1);
    expect(cmp(5, null, -1)).toBe(-1);
    expect(cmp(5, null, 1)).toBe(-1);
    expect(cmp(null, null, 1)).toBe(0);
  });

  it("orders numbers and strings by direction", () => {
    expect(cmp(1, 2, -1)).toBeGreaterThan(0);
    expect(cmp(1, 2, 1)).toBeLessThan(0);
    expect(cmp("a", "b", 1)).toBeLessThan(0);
    expect(cmp("a", "b", -1)).toBeGreaterThan(0);
  });
});

describe("tilt — the reported bug", () => {
  const rows = [
    row({ name: "Plus2", tilt: 1.02 }), row({ name: "Minus4", tilt: 0.96 }),
    row({ name: "Plus1", tilt: 1.01 }), row({ name: "Neutral", tilt: 1.0 }),
    row({ name: "Minus1", tilt: 0.99 }),
  ];

  it("descends by SIGNED tilt — the biggest help first, not the biggest swing", () => {
    // The old accessor ranked |tilt − 1|, so this came back Minus4, Plus2, …:
    // a −4% matchup ahead of a +2% one, which is what made the column look
    // unsorted on screen.
    expect(sortBy(rows, "tilt", -1).map((r) => r.name))
      .toEqual(["Plus2", "Plus1", "Minus1", "Minus4", "Neutral"]);
  });

  it("ascends to the worst matchups, still with neutral last", () => {
    expect(sortBy(rows, "tilt", 1).map((r) => r.name))
      .toEqual(["Minus4", "Minus1", "Plus1", "Plus2", "Neutral"]);
  });

  it("treats a tilt the cell renders as '—' as missing, not as the middle", () => {
    expect(SORT_VAL.tilt(row({ tilt: 1 }))).toBe(null);
    expect(SORT_VAL.tilt(row({ tilt: 1 + TILT_EPS / 2 }))).toBe(null);
    expect(SORT_VAL.tilt(row({ tilt: 1.02 }))).toBe(1.02);
  });
});

describe("win% and confidence", () => {
  it("ranks a strong under alongside a strong over", () => {
    const rows = [row({ name: "Over86", prob: 0.86 }), row({ name: "Flip", prob: 0.52 }),
      row({ name: "Under14", prob: 0.14 })];
    expect(sortBy(rows, "win", -1).map((r) => r.name)).toEqual(["Over86", "Under14", "Flip"]);
  });

  it("orders confidence tiers, breaking ties on win%", () => {
    const rows = [row({ name: "MedA", prob: 0.60 }), row({ name: "High", prob: 0.90 }),
      row({ name: "MedB", prob: 0.66 }), row({ name: "Low", prob: 0.51 })];
    expect(sortBy(rows, "conf", -1).map((r) => r.name)).toEqual(["High", "MedB", "MedA", "Low"]);
  });
});

describe("prop → position, the one-click drill", () => {
  const rows = [
    row({ name: "WR guy", prop_type: "anytime_td", pos: "WR", proj: 0.4 }),
    row({ name: "QB guy", prop_type: "pass_yards", pos: "QB", proj: 250 }),
    row({ name: "RB big", prop_type: "anytime_td", pos: "RB", proj: 0.6 }),
    row({ name: "RB small", prop_type: "anytime_td", pos: "RB", proj: 0.3 }),
    row({ name: "TE guy", prop_type: "anytime_td", pos: "TE", proj: 0.2 }),
  ];

  it("groups by prop, then walks the depth chart, then the biggest number", () => {
    // Ascending prop rank puts pass_yards (a yardage market) ahead of anytime_td,
    // and inside the ATD block: RB before WR before TE, big RB before small RB.
    expect(sortBy(rows, "prop", 1).map((r) => r.name))
      .toEqual(["QB guy", "RB big", "RB small", "WR guy", "TE guy"]);
  });

  it("sorts by position with prop as the inner grouping", () => {
    expect(sortBy(rows, "pos", 1).map((r) => r.pos)).toEqual(["QB", "RB", "RB", "WR", "TE"]);
  });

  it("uses prop RANK, not the alphabetised label", () => {
    // "ANY TD" < "PASS YDS" alphabetically, which would put touchdowns above
    // every yardage market for no reason a reader could name.
    expect(SORT_VAL.prop(row({ prop_type: "pass_yards" })))
      .toBeLessThan(SORT_VAL.prop(row({ prop_type: "anytime_td" })));
  });
});

describe("market columns", () => {
  const priced = { line: 60.5, edge: 0.04, books: { fanduel: { overOdds: -110 } } };
  const rows = [row({ name: "Priced", priced }), row({ name: "Unpriced" })];

  it("keeps unpriced rows at the bottom whichever way the column is clicked", () => {
    expect(sortBy(rows, "edge", -1).map((r) => r.name)).toEqual(["Priced", "Unpriced"]);
    expect(sortBy(rows, "edge", 1).map((r) => r.name)).toEqual(["Priced", "Unpriced"]);
    expect(sortBy(rows, "fanduel", 1).map((r) => r.name)).toEqual(["Priced", "Unpriced"]);
  });

  it("puts a row a book did not price below one it did, in that book's column", () => {
    // A book that skipped the prop is not a book offering a bad price on it.
    const both = row({ name: "Both", priced: { ...priced, books: {
      fanduel: { overOdds: -110 }, draftkings: { overOdds: 140 } } } });
    const fdOnly = row({ name: "FD only", priced });
    expect(sortBy([fdOnly, both], "draftkings", -1).map((r) => r.name)).toEqual(["Both", "FD only"]);
    expect(sortBy([fdOnly, both], "draftkings", 1).map((r) => r.name)).toEqual(["Both", "FD only"]);
  });

  it("ranks a book column by PAYOUT, not by the American number in the cell", () => {
    // +100 pays more than −110 and less than +450, an ordering the raw American
    // integers get exactly backwards across zero.
    const at = (odds, name) => row({ name, priced: { ...priced, books: { fanduel: { overOdds: odds } } } });
    expect(sortBy([at(-110, "short"), at(450, "long"), at(100, "even")], "fanduel", -1).map((r) => r.name))
      .toEqual(["long", "even", "short"]);
  });
});

describe("baseline provenance", () => {
  it("separates rows that all read 0% live, which live_weight alone cannot", () => {
    const measured = row({ name: "Measured", carryover: null });
    const clean = row({ name: "Clean", carryover: { live_weight: 0 } });
    const moved = row({ name: "Moved", carryover: { live_weight: 0, changed_team: true } });
    const rookie = row({ name: "Rookie", carryover: { prior_source: "rookie" } });
    expect(sortBy([rookie, moved, clean, measured], "base", -1).map((r) => r.name))
      .toEqual(["Measured", "Clean", "Moved", "Rookie"]);
  });
});

describe("stability", () => {
  it("falls back to name, so an all-ties column does not shuffle between renders", () => {
    const rows = [row({ name: "Charlie" }), row({ name: "alpha" }), row({ name: "Bravo" })];
    expect(sortBy(rows, "proj", -1).map((r) => r.name)).toEqual(["alpha", "Bravo", "Charlie"]);
  });
});

describe("the sort table itself", () => {
  it("has an accessor for every column the board sorts, and no dead ones", () => {
    // The board's headers, transcribed. A column added to Board.jsx without an
    // accessor silently falls back to Win%; an accessor with no header is dead
    // code that will drift out of step with the cell it claims to describe.
    // The book columns are generated from the book lists in both places, so they
    // are named from those here rather than transcribed — the point of the test
    // is to catch a HAND-WRITTEN column with no accessor. There are TWO lists:
    // the board's sportsbooks, and the books that post the sack market, because
    // the Odds section's columns follow the selected market (BoardColumns.jsx).
    const HEADERS = ["name", "pos", "avail", "prop", "base", "proj", "line",
      "win", "conf", "tilt", "edge", "diff", "stk", ...HIT_COLS,
      ...new Set([...BOOK_PREF, ...SACK_BOOKS])];
    expect([...SORT_COLS].sort()).toEqual([...HEADERS].sort());
  });

  it("chains only reference real columns", () => {
    for (const [col, chain] of Object.entries(SORT_CHAIN)) {
      expect(SORT_COLS, `chain key ${col}`).toContain(col);
      for (const [k, d] of chain) {
        expect(SORT_COLS, `${col} → ${k}`).toContain(k);
        expect([1, -1]).toContain(d);
      }
    }
  });

  it("never throws on a row with nothing filled in", () => {
    const bare = { name: "x", conf: {}, avail: {}, tilt: 1 };
    for (const col of SORT_COLS) expect(() => SORT_VAL[col](bare)).not.toThrow();
  });
});

describe("hit-rate and diff columns", () => {
  const hr = (rate, n = 10, streak = 0) => ({ l10: { rate, n }, l20: { rate, n }, streak });
  it("sinks a zero-game hit rate rather than ranking it as 0%", () => {
    const a = { ...row({ name: "A" }), hits: hr(0) };
    const b = { ...row({ name: "B" }), hits: { l10: { rate: null, n: 0 }, streak: 0 } };
    expect(sortBy([b, a], "l10", 1).map((r) => r.name)).toEqual(["A", "B"]);
  });
  it("sorts the streak signed, with no streak as missing", () => {
    const rows = [
      { ...row({ name: "Under" }), hits: hr(0.2, 10, -3) },
      { ...row({ name: "None" }), hits: hr(0.5, 10, 0) },
      { ...row({ name: "Over" }), hits: hr(0.8, 10, 4) },
    ];
    expect(sortBy(rows, "stk").map((r) => r.name)).toEqual(["Over", "Under", "None"]);
  });
  it("sorts diff on the printed value and sinks one-sided rows", () => {
    const rows = [{ ...row({ name: "TD" }), diff: null }, { ...row({ name: "Plus" }), diff: 6.5 },
      { ...row({ name: "Minus" }), diff: -4 }];
    expect(sortBy(rows, "diff").map((r) => r.name)).toEqual(["Plus", "Minus", "TD"]);
    expect(sortBy(rows, "diff", 1).map((r) => r.name)).toEqual(["Minus", "Plus", "TD"]);
  });
});
