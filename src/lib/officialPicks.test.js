import { describe, it, expect } from "vitest";
import { officialScore, officialVerdict, marketStanding, segmentOf, officialColumns, ZONE, EARN, BENCH, OFFICIAL_RULE } from "./officialPicks.js";

const pick = (o = {}) => ({
  source: "auto", prop_type: "rush_yards", direction: "over", proj_mean: 60, sigma: 40, line: 50,
  book_odds: -113, avail: null, mkt_prob: 0.5, outcome: "pending", profit: null, ...o,
});

describe("officialScore", () => {
  it("is |proj − line| / sigma where the model has a spread", () => {
    expect(officialScore(pick())).toBeCloseTo(0.25, 6);
    expect(officialScore(pick({ proj_mean: 40 }))).toBeCloseTo(0.25, 6);
  });
  it("falls back to a Poisson spread for a count with no sigma", () => {
    expect(officialScore(pick({ prop_type: "pass_tds", sigma: null, proj_mean: 2.25, line: 1.5 }))).toBeCloseTo(0.5, 6);
  });
  it("scores anytime TD as a signed log rate ratio against the price", () => {
    // market 25% → λ = −ln(.75) = .28768; model λ .35 → ln(.35/.28768)
    expect(officialScore(pick({ prop_type: "anytime_td", sigma: null, proj_mean: 0.35, mkt_prob: 0.25 })))
      .toBeCloseTo(Math.log(0.35 / 0.287682), 4);
    expect(officialScore(pick({ prop_type: "anytime_td", sigma: null, proj_mean: 0.2, mkt_prob: 0.25 }))).toBeLessThan(0);
  });
  it("scores sacks against the rate the price implies AT THAT RUNG", () => {
    // A sack line is a rung, not a target: 0.25 and 0.5 need the same thing to
    // happen at two prices, so "projection minus line" would score the same
    // belief differently depending on which number the book printed it at. The
    // market's λ has no closed form here (compound negative binomial over
    // half-sack credits), so it is inverted numerically — see sackLambdaAt.
    const sack = (o) => officialScore(pick({ prop_type: "def_sacks", sigma: null, line: 0.5, ...o }));
    // A market at 50% on the 0.5 rung implies λ ≈ 0.8269: winning 0.5 takes a
    // whole sack (a half pushes), so it takes a bigger rate than the 0.25 rung's
    // 0.6617 at the same price.
    expect(sack({ proj_mean: 0.8269, mkt_prob: 0.5 })).toBeCloseTo(0, 3);
    expect(sack({ proj_mean: 0.6617, mkt_prob: 0.5, line: 0.25 })).toBeCloseTo(0, 3);
    expect(sack({ proj_mean: 0.9, mkt_prob: 0.5 })).toBeGreaterThan(0);
    // Signed: the over is the only side, so a rate BELOW the market's is not a
    // disagreement in the pick's favour and can never be official.
    expect(sack({ proj_mean: 0.4, mkt_prob: 0.5 })).toBeLessThan(0);
    // No price, no score — there is nothing to disagree with.
    expect(sack({ proj_mean: 0.66, mkt_prob: null })).toBeNull();
    expect(sack({ proj_mean: 0.66, mkt_prob: 1 })).toBeNull();
  });
});

describe("officialVerdict", () => {
  it("a core market inside the band is official", () => {
    expect(officialVerdict(pick()).official).toBe(true);
  });
  it("the band is half-open: lo in, hi out", () => {
    expect(officialVerdict(pick({ proj_mean: 50 + ZONE.lo * 40 })).official).toBe(true);
    expect(officialVerdict(pick({ proj_mean: 50 + ZONE.hi * 40 })).note).toBe("gap too large to trust");
    expect(officialVerdict(pick({ proj_mean: 52 })).note).toBe("too close to the line");
  });
  it("holds sacks off the card until the ledger earns them in", () => {
    // The 2025 odds pull never bought this market, so there is no held-out
    // record to stand on. It is on probation however far from the line it sits.
    const p = pick({ prop_type: "def_sacks", sigma: null, line: 0.5, proj_mean: 1.0, mkt_prob: 0.5 });
    expect(segmentOf(p)).toBe("def_sacks");
    expect(officialVerdict(p).note).toBe("market on probation");
    // …and it is a real earn-in, not a permanent ban.
    expect(officialVerdict(p, { def_sacks: { status: "earned" } }).official).toBe(true);
  });
  it("rec-yards overs and unproven markets start on probation", () => {
    expect(segmentOf(pick({ prop_type: "rec_yards", direction: "over" }))).toBe("rec_yards:over");
    expect(officialVerdict(pick({ prop_type: "rec_yards", direction: "over" })).note).toBe("market on probation");
    expect(officialVerdict(pick({ prop_type: "rec_yards", direction: "under", proj_mean: 40 })).official).toBe(true);
    expect(officialVerdict(pick({ prop_type: "receptions", proj_mean: 4.4, sigma: 1.6, line: 4 })).note).toBe("market on probation");
  });
  it("a two-sided side must be the side the projection is on", () => {
    // Projects 61.2 into a 47.5 and the calibrated side is the under: in the
    // band, and still not a play — the card cannot contradict its own board.
    const dobbins = pick({ proj_mean: 61.2, sigma: 48.7, line: 47.5, direction: "under" });
    expect(officialScore(dobbins)).toBeGreaterThan(ZONE.lo);
    expect(officialVerdict(dobbins).note).toBe("side disagrees with the projection");
    expect(officialVerdict({ ...dobbins, direction: "over" }).official).toBe(true);
    expect(officialVerdict(pick({ proj_mean: 40, direction: "under" })).official).toBe(true);
    expect(officialVerdict(pick({ proj_mean: 40, direction: "over" })).official).toBe(false);
  });
  it("disagreeing picks do not count toward a market's standing", () => {
    const bad = Array.from({ length: BENCH.minN }, () => pick({ direction: "under", outcome: "loss", profit: -1 }));
    expect(marketStanding(bad).rush_yards).toMatchObject({ status: "core", n: 0 });
  });
  it("a one-sided NO is never official, wherever its score sits", () => {
    const p = pick({ prop_type: "def_sacks", sigma: null, line: 0.5, proj_mean: 1.0, mkt_prob: 0.5, direction: "no" });
    expect(officialVerdict(p, { def_sacks: { status: "earned" } }).official).toBe(false);
  });
  it("an unpriced side, an injury designation, or a promoted backup is never official", () => {
    expect(officialVerdict(pick({ book_odds: null })).official).toBe(false);
    expect(officialVerdict(pick({ avail: "QUES" })).official).toBe(false);
    expect(officialVerdict(pick({ avail: "LTD" })).official).toBe(true);   // a practice note is not a designation
    expect(officialVerdict(pick({ signals: { carryover: { promoted_from: "x" } } })).official).toBe(false);
  });
});

describe("marketStanding", () => {
  const graded = (k, wins, o) => Array.from({ length: k }, (_, i) =>
    pick({ outcome: i < wins ? "win" : "loss", profit: i < wins ? 0.885 : -1, ...o }));

  it("promotes a probation market once its in-band record clears the bar", () => {
    const rec = { prop_type: "receptions", proj_mean: 4.4, sigma: 1.6, line: 4 };
    const n = EARN.minN, w = Math.ceil(EARN.minWin * n) + 2;   // enough to be positive at -113
    const st = marketStanding(graded(n, w, rec));
    expect(st.receptions.status).toBe("earned");
    expect(officialVerdict(pick(rec), st).official).toBe(true);
    expect(marketStanding(graded(n - 1, w, rec)).receptions.status).toBe("probation");
  });
  it("benches a core market that loses over a real sample", () => {
    const st = marketStanding(graded(BENCH.minN, 70));
    expect(st.rush_yards.status).toBe("benched");
    expect(officialVerdict(pick(), st).note).toBe("market benched");
  });
  it("counts only live, decided, in-band picks", () => {
    const st = marketStanding([
      ...graded(3, 3), ...graded(2, 2, { source: "backfill" }), ...graded(2, 2, { proj_mean: 90 }),
      pick({ outcome: "push", profit: 0 }),
    ]);
    expect(st.rush_yards.n).toBe(3);
  });
});

describe("officialColumns", () => {
  it("stamps the rule and the basis", () => {
    const c = officialColumns(pick(), {}, "retro");
    expect(c).toMatchObject({ official: true, official_rule: OFFICIAL_RULE, official_basis: "retro", official_note: null });
    expect(c.official_score).toBeCloseTo(0.25, 4);
  });
});

describe("job-volume rows", () => {
  it("a retargeted starter is held off the card like a promoted backup", () => {
    expect(officialVerdict(pick({ signals: { carryover: { retargeted_att: 8.5 } } })).note).toBe("starter volume assumed");
  });
});
