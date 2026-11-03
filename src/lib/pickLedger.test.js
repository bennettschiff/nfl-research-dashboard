import { describe, it, expect } from "vitest";
import { pickFromRow, sidePrice, outcomeOf, profitOf, closeFor, closeSackFor, closeIsCapture, gradePick, summarize, calibration, splitBy, ACTUAL_OF, isBet, inBaseline, BASELINE } from "./pickLedger.js";

const game = { season: 2026, week: 1, game_id: "2026_01_BUF_HOU" };
const books = {
  fanduel: { line: 1.5, offLine: false, overOdds: -122, underOdds: -108 },
  draftkings: { line: 1.5, offLine: false, overOdds: -120, underOdds: -106 },
  hardrockbet: { line: 2.5, offLine: true, overOdds: 150, underOdds: -190 },
};
const row = (over) => ({
  game, player_id: "p1", name: "A Player", pos: "RB", team: "HOU", opp: "BUF",
  prop_type: "receptions", proj: 1.3, headline: { sigma: 1.1, fair_line: 132, factors: {} },
  prob: over, probLine: 1.5, priced: { books }, conf: { tier: "low", score: 0.06 },
  avail: { label: null }, ruledOut: false, tilt: 1, carryover: null, depth: null,
});

describe("pickFromRow", () => {
  it("takes the under when P(over) < .5, priced at the best UNDER on the row's line", () => {
    const p = pickFromRow(row(0.43));
    expect(p.direction).toBe("under");
    expect(p.side_prob).toBeCloseTo(0.57, 4);
    expect(p.book).toBe("draftkings");            // -106 beats -108; Hard Rock is off-line
    expect(p.book_odds).toBe(-106);
    // DK -120/-106 de-vigs to a 48.54% under.
    expect(p.mkt_prob).toBeCloseTo(0.4854, 4);
    expect(p.edge).toBeCloseTo(0.57 - 0.4854, 4);
    expect(p.pick_key).toBe("2026|2026_01_BUF_HOU|p1|receptions");
  });
  it("is not a pick without a market, or for a ruled-out player", () => {
    expect(pickFromRow({ ...row(0.6), priced: null })).toBeNull();
    expect(pickFromRow({ ...row(0.6), ruledOut: true })).toBeNull();
  });
  it("a one-sided market is a Yes only when the model takes the price", () => {
    const priced = { books: { fanduel: { line: 0.5, offLine: false, overOdds: 600, underOdds: null } } };
    const p = pickFromRow({ ...row(0.16), prop_type: "anytime_td", call: "yes", priced });
    expect(p.direction).toBe("over");
    expect(p.outcome).toBe("pending");
    expect(p.side_prob).toBeCloseTo(0.16, 4);
    expect(p.devigged).toBe(false);
    expect(p.ev).toBeCloseTo(0.16 * 7 - 1, 4);
  });

  it("a one-sided NO is frozen as a pass: no side, no price, never graded", () => {
    // There is no No to bet. Before 2026-10-07 this row was booked as a Yes
    // at +600 on a man the model gave 12% — and so was every one like it.
    const priced = { books: { fanduel: { line: 0.5, offLine: false, overOdds: 600, underOdds: null } } };
    const p = pickFromRow({ ...row(0.12), prop_type: "anytime_td", call: "no", priced });
    expect(p.direction).toBe("no");
    expect(p.outcome).toBe("pass");
    expect(p.book).toBeNull();
    expect(p.book_odds).toBeNull();
    expect(p.ev).toBeNull();
    expect(gradePick(p, { rushing_tds: "1" }, { gameInStats: true })).toEqual({ outcome: "pass", actual: 1, profit: 0 });
    expect(isBet(p)).toBe(false);
    expect(summarize([p]).n).toBe(0);
  });
});

describe("sidePrice", () => {
  it("skips a book on a different line", () => {
    expect(sidePrice({ books }, "over").book).toBe("draftkings");
  });
  it("returns null when nobody posts that side", () => {
    expect(sidePrice({ books: { fanduel: { line: 0.5, overOdds: 300 } } }, "under")).toBeNull();
  });
  it("reads the record's OWN book list, not the board's", () => {
    // The sack market is posted by PrizePicks and Underdog, which are not in
    // BOOK_PREF. Iterating BOOK_PREF here found no price on a sack row and
    // dropped it from the ledger with a market sitting right on it.
    const sack = { bookOrder: ["fanduel", "prizepicks", "underdog"],
      books: { prizepicks: { line: 0.5, offLine: false, overOdds: 120, underOdds: null } } };
    expect(sidePrice(sack, "over").book).toBe("prizepicks");
    expect(sidePrice({ books: sack.books }, "over")).toBeNull();     // no bookOrder → BOOK_PREF → nothing
  });
});

describe("sacks", () => {
  const sackRow = (over, line = 0.5) => ({
    ...row(over), prop_type: "def_sacks", pos: "DL", proj: 0.66, probLine: line,
    oneSided: true, call: "yes", headline: { sigma: null, fair_line: -124, factors: {} },
    priced: { bookOrder: ["fanduel", "prizepicks", "underdog"],
      books: { prizepicks: { line, offLine: false, overOdds: 100, underOdds: null } } },
  });

  it("is the over at the RUNG the price is on, when the model takes it", () => {
    const p = pickFromRow(sackRow(0.55, 0.75));
    expect(p.direction).toBe("over");
    expect(p.line).toBe(0.75);
    expect(p.side_prob).toBeCloseTo(0.55, 4);
    expect(p.book).toBe("prizepicks");
    expect(p.devigged).toBe(false);          // one price, both sides — no vig to remove
    expect(p.pick_key).toBe("2026|2026_01_BUF_HOU|p1|def_sacks");
  });

  it("grades on credited sacks, halves included", () => {
    expect(ACTUAL_OF.def_sacks({ def_sacks: "0.5" })).toBe(0.5);
    expect(ACTUAL_OF.def_sacks({})).toBe(0);
    // sacks_suffered on the same row is the QUARTERBACK's market, not this one.
    expect(ACTUAL_OF.def_sacks({ sacks_suffered: "3" })).toBe(0);
  });

  it("pushes on a rung a half sack can land on, and cannot on one it cannot", () => {
    // 0.25 and 0.5 are the same question at two prices — and only one of them
    // can push, because a sack credit is a multiple of a half.
    expect(outcomeOf("over", 0.5, 0.5)).toBe("push");
    expect(outcomeOf("over", 0.25, 0.5)).toBe("win");
    expect(outcomeOf("over", 1, 1)).toBe("push");
    expect(outcomeOf("over", 0.75, 1)).toBe("win");
    expect(outcomeOf("over", 0.75, 0.5)).toBe("loss");
    expect(outcomeOf("over", 0.5, 0)).toBe("loss");
  });

  it("a rusher who played and recorded nothing is a loss, not a void", () => {
    // nflverse's weekly stats list only players who RECORDED a stat, so a pass
    // rusher with no sack is simply absent from the file.
    const p = pickFromRow(sackRow(0.55));
    expect(gradePick(p, null, { gameInStats: true, played: true }))
      .toEqual({ outcome: "loss", actual: 0, profit: -1 });
    expect(gradePick(p, null, { gameInStats: true, played: false }).outcome).toBe("void");
    expect(gradePick(p, null, { gameInStats: true, played: null })).toBeNull();
  });

  it("takes its close from the same book at the same rung, or not at all", () => {
    const p = { ...pickFromRow(sackRow(0.55)), mkt_prob: 0.5 };
    const rec = { books: {
      prizepicks: [{ line: 0.5, overOdds: -120, underOdds: null }, { line: 1.5, overOdds: 300, underOdds: null }],
      fanduel: [{ line: 0.5, overOdds: 400, underOdds: null }],
    } };
    const c = closeSackFor(p, rec);
    expect(c.close_line).toBe(0.5);
    expect(c.close_odds).toBe(-120);            // PrizePicks' own rung, not FanDuel's +400
    expect(c.close_prob).toBeCloseTo(0.5455, 4);
    expect(c.clv_prob).toBeCloseTo(0.0455, 4);
    expect(c.clv_line).toBeNull();              // a ladder does not move; a rung is a different bet
    // A book that did not close him, and a rung he was not taken at.
    expect(closeSackFor(p, { books: { underdog: [{ line: 0.5, overOdds: 110 }] } })).toBeNull();
    expect(closeSackFor({ ...p, line: 2.5 }, rec)).toBeNull();
  });
});

describe("outcome and profit", () => {
  it("settles both sides and pushes on the number", () => {
    expect(outcomeOf("over", 45.5, 46)).toBe("win");
    expect(outcomeOf("under", 45.5, 46)).toBe("loss");
    expect(outcomeOf("over", 3, 3)).toBe("push");
  });
  it("pays American odds on a one-unit stake", () => {
    expect(profitOf("win", 150)).toBe(1.5);
    expect(profitOf("win", -125)).toBe(0.8);
    expect(profitOf("loss", -125)).toBe(-1);
    expect(profitOf("push", -110)).toBe(0);
    expect(profitOf("win", null)).toBeNull();
  });
  it("counts every touchdown a player scores, not the ones he throws", () => {
    expect(ACTUAL_OF.anytime_td({ rushing_tds: "1", receiving_tds: "0", passing_tds: "3", special_teams_tds: "NA" })).toBe(1);
  });
});

describe("gradePick", () => {
  const pick = { prop_type: "rec_yards", direction: "under", line: 33.5, book_odds: -113 };
  it("stays pending until the game is in the box scores", () => {
    expect(gradePick(pick, null, { gameInStats: false, played: true })).toBeNull();
  });
  it("grades a player who played but recorded no stat on zeros — not a void", () => {
    expect(gradePick(pick, null, { gameInStats: true, played: true })).toMatchObject({ outcome: "win", actual: 0 });
  });
  it("voids only a player who took no snap", () => {
    expect(gradePick(pick, null, { gameInStats: true, played: false })).toEqual({ outcome: "void", actual: null, profit: 0 });
  });
  it("waits for snap counts rather than guessing an absent player's status", () => {
    expect(gradePick(pick, null, { gameInStats: true, played: null })).toBeNull();
  });
  it("grades from the stats row when there is one", () => {
    expect(gradePick(pick, { receiving_yards: "35" }, { gameInStats: true })).toMatchObject({ outcome: "loss", actual: 35, profit: -1 });
  });
});

describe("closeFor", () => {
  const pick = { prop_type: "rec_yards", direction: "over", line: 45.5, book: "fanduel", mkt_prob: 0.5 };
  it("measures CLV in probability only on the same line", () => {
    const c = closeFor(pick, { books: { fanduel: { line: 45.5, overOdds: -130, underOdds: 110 } } });
    expect(c.clv_prob).toBeGreaterThan(0);
    expect(c.clv_line).toBe(0);
  });
  it("reports a moved line as line CLV, in the pick's favour", () => {
    const c = closeFor(pick, { books: { fanduel: { line: 48.5, overOdds: -110, underOdds: -110 } } });
    expect(c.clv_prob).toBeNull();
    expect(c.clv_line).toBe(3);
    expect(closeFor({ ...pick, direction: "under" }, { books: { fanduel: { line: 48.5, overOdds: -110, underOdds: -110 } } }).clv_line).toBe(-3);
  });

  // Weeks 1-4 of 2026: the last pull before kickoff priced the pick AND was its
  // close, so every CLV was 0 and the tile read "100% beat close" off one row.
  const at = "2026-09-27T15:31:55.109Z";
  const sameLine = (at) => ({ books: { fanduel: { line: 48.5, overOdds: -130, underOdds: 110, at } } });
  it("withholds CLV when the close is the very pull the pick was priced at", () => {
    const p = { ...pick, line: 48.5, odds_at: at };
    // The close and live rows of one pull are stamped milliseconds apart.
    const c = closeFor(p, sameLine("2026-09-27T15:31:55.110Z"));
    expect(c.close_odds).toBe(-130);
    expect(c.close_at).toBe("2026-09-27T15:31:55.110Z");
    expect(c.clv_prob).toBeNull();
    expect(c.clv_line).toBeNull();
    expect(closeIsCapture({ ...p, ...c })).toBe(true);
  });
  it("measures CLV against a close pulled after the pick's price", () => {
    const p = { ...pick, line: 48.5, odds_at: "2026-09-25T17:37:24.000Z" };
    const c = closeFor(p, sameLine(at));
    expect(c.clv_prob).toBeGreaterThan(0);
    expect(c.clv_line).toBe(0);
    expect(closeIsCapture({ ...p, ...c })).toBe(false);
  });
  it("does the same for a sack rung", () => {
    const p = { prop_type: "def_sacks", direction: "over", line: 0.5, book: "fanduel", mkt_prob: 0.4, odds_at: at };
    const rec = (at) => ({ books: { fanduel: [{ line: 0.5, overOdds: 120, underOdds: null, at }] } });
    expect(closeSackFor(p, rec(at)).clv_prob).toBeNull();
    expect(closeSackFor(p, rec("2026-09-27T20:57:26.000Z")).clv_prob).toBeCloseTo(0.0545, 4);
  });
  it("keeps the old behaviour when either time is unknown", () => {
    expect(closeFor(pick, sameLine(at)).clv_line).toBe(3);   // the pick has no odds_at
    expect(closeIsCapture({ close_at: null, odds_at: at })).toBe(false);
  });
});

describe("summarize / calibration", () => {
  const picks = [
    { outcome: "win", profit: 0.9, side_prob: 0.6, clv_prob: 0.02 },
    { outcome: "loss", profit: -1, side_prob: 0.6, clv_prob: -0.01 },
    { outcome: "win", profit: 1.5, side_prob: 0.4, clv_prob: 0 },
    { outcome: "void", profit: 0 },
    { outcome: "pending" },
  ];
  it("scores decided picks only and reports units per unit staked", () => {
    const s = summarize(picks);
    expect([s.win, s.loss, s.void, s.pending]).toEqual([2, 1, 1, 1]);
    expect(s.roi).toBeCloseTo(1.4 / 3, 6);
    expect(s.beatClose).toBe(0.5);           // the unmoved close is not counted either way
    expect(s.clvN).toBe(3);
    expect(s.atClose).toBe(0);
  });
  it("counts a pick priced at the close apart from an unmoved one", () => {
    const at = "2026-10-04T15:40:40.000Z";
    const s = summarize([
      { outcome: "win", clv_prob: null, close_at: at, odds_at: at },
      // A legacy zero written before close_at existed is still not a sample.
      { outcome: "loss", clv_prob: 0, close_at: at, odds_at: at },
    ]);
    expect(s.atClose).toBe(2);
    expect(s.clvN).toBe(0);
    expect(s.beatClose).toBeNull();
  });
  it("bins by the side's probability", () => {
    const c = calibration(picks);
    expect(c.map((b) => [b.lo.toFixed(2), b.n, b.actual])).toEqual([["0.40", 1, 1], ["0.60", 2, 0.5]]);
  });
});

describe("splitBy", () => {
  it("summarizes each group and drops unkeyed rows", () => {
    const rows = [
      { prop_type: "rec_yards", outcome: "win", profit: 1 },
      { prop_type: "rec_yards", outcome: "loss", profit: -1 },
      { prop_type: "anytime_td", outcome: "loss", profit: -1 },
      { prop_type: null, outcome: "win", profit: 1 },
    ];
    const s = splitBy(rows, (p) => p.prop_type);
    expect(s.map((g) => [g.key, g.win, g.loss])).toEqual([["rec_yards", 1, 1], ["anytime_td", 0, 1]]);
  });
});

describe("inBaseline", () => {
  it("starts at the baseline week and runs forward, across seasons", () => {
    expect(inBaseline({ season: BASELINE.season, week: BASELINE.week })).toBe(true);
    expect(inBaseline({ season: BASELINE.season, week: BASELINE.week - 1 })).toBe(false);
    expect(inBaseline({ season: BASELINE.season + 1, week: 1 })).toBe(true);
    expect(inBaseline({ season: BASELINE.season - 1, week: 18 })).toBe(false);
  });
  it("leaves out a row with no week rather than guessing", () => {
    expect(inBaseline({ season: BASELINE.season, week: null })).toBe(false);
  });
});
