// ── Side / win probability / confidence ──────────────────────────────────────
// The three defects this file exists to stop, all of which shipped on the WNBA
// board before they were fixed there:
//   1. a strong UNDER ranked as though it were a weak over
//   2. a HIGH badge with no direction, read as "strong over" on an under
//   3. a carried-forward baseline wearing the same badge as a measured one
import { describe, it, expect } from "vitest";
import {
  sideOf, sideArrow, sideLetter, winProb, baselineTrust, confidenceOf,
  CONF_BREAKS, CONF_RANK,
} from "./confidence.js";

describe("side", () => {
  it("splits at a coin flip, with 50% counted as the over", () => {
    expect(sideOf(0.51)).toBe("over");
    expect(sideOf(0.5)).toBe("over");
    expect(sideOf(0.49)).toBe("under");
    expect(sideOf(null)).toBe(null);
  });

  it("marks direction, so a badge is never read as the wrong side", () => {
    expect(sideArrow(0.86)).toBe("↑");
    expect(sideArrow(0.14)).toBe("↓");
    expect(sideLetter(0.86)).toBe("O");
    expect(sideLetter(0.14)).toBe("U");
    expect(sideLetter(null)).toBe("");
  });
});

describe("winProb", () => {
  it("is the probability of the side we are on, so it never drops below half", () => {
    expect(winProb(0.86)).toBeCloseTo(0.86);
    expect(winProb(0.14)).toBeCloseTo(0.86);
    expect(winProb(0.5)).toBeCloseTo(0.5);
  });

  it("does NOT flip a one-sided market, where there is no under to take", () => {
    // Anytime TD posts only the Yes. max(p, 1−p) turns "9% to score" into a 91%
    // conviction play on a bet that does not exist — which filled 204 of the top
    // 250 board rows with un-bettable unders before this existed.
    expect(winProb(0.09, true)).toBeCloseTo(0.09);
    expect(winProb(0.45, true)).toBeCloseTo(0.45);
    expect(winProb(0.09, false)).toBeCloseTo(0.91);
  });

  it("ranks a strong under level with an equally strong over — the whole point", () => {
    // Sorted on raw P(over) descending, the 14% row lands at the BOTTOM of the
    // board next to the coin flips, which is what buried every conviction under.
    const rows = [{ p: 0.86 }, { p: 0.52 }, { p: 0.14 }];
    const byWin = [...rows].sort((a, b) => winProb(b.p) - winProb(a.p)).map((r) => r.p);
    expect(byWin).toEqual([0.86, 0.14, 0.52]);
  });
});

describe("baselineTrust", () => {
  it("is full for a plain measured season aggregate", () => {
    expect(baselineTrust(null)).toBe(1);
  });

  it("rises with the share of the baseline that is live data", () => {
    const cold = baselineTrust({ live_weight: 0 });
    const warm = baselineTrust({ live_weight: 0.5 });
    const hot = baselineTrust({ live_weight: 1 });
    expect(cold).toBeLessThan(warm);
    expect(warm).toBeLessThan(hot);
    expect(hot).toBeCloseTo(1);
  });

  it("penalises the two provenance flags the Baseline chip already warns about", () => {
    const base = baselineTrust({ live_weight: 0 });
    expect(baselineTrust({ live_weight: 0, changed_team: true })).toBeLessThan(base);
    expect(baselineTrust({ live_weight: 0, depth_rank: 4 })).toBeLessThan(base);
    // …and never below zero, however many of them stack.
    expect(baselineTrust({ live_weight: 0, changed_team: true, depth_rank: 9 }))
      .toBeGreaterThanOrEqual(0);
  });
});

describe("confidenceOf", () => {
  it("is TWO-SIDED: a 14% over earns what an 86% over earns", () => {
    const over = confidenceOf({ prob: 0.86 });
    const under = confidenceOf({ prob: 0.14 });
    expect(over.tier).toBe(under.tier);
    expect(over.side).toBe("over");
    expect(under.side).toBe("under");
  });

  it("tiers on distance from a coin flip", () => {
    expect(confidenceOf({ prob: 0.5 }).tier).toBe("low");
    expect(confidenceOf({ prob: 0.5 + CONF_BREAKS.medium }).tier).toBe("medium");
    expect(confidenceOf({ prob: 0.5 + CONF_BREAKS.high }).tier).toBe("high");
  });

  it("lets provenance break a tie but never manufacture an edge", () => {
    const measured = confidenceOf({ prob: 0.60, carryover: null });
    const carried = confidenceOf({ prob: 0.60, carryover: { live_weight: 0, changed_team: true } });
    expect(measured.score).toBeGreaterThan(carried.score);
    // A coin flip stays low however well measured it is — the trust term is
    // worth at most a couple of points and must not lift a 50/50 off the floor.
    expect(confidenceOf({ prob: 0.5, carryover: null }).tier).toBe("low");
  });

  it("caps a HIGH badge when the club has not cleared him to play", () => {
    const clear = confidenceOf({ prob: 0.90 });
    const hurt = confidenceOf({ prob: 0.90, status: "Questionable" });
    expect(clear.tier).toBe("high");
    expect(clear.capped).toBe(false);
    expect(hurt.tier).toBe("medium");
    expect(hurt.capped).toBe(true);
  });

  it("does not mark `capped` when the cap changed nothing", () => {
    // A row that was only MEDIUM anyway is not demoted, so the asterisk that
    // explains a demotion must not appear on it.
    const r = confidenceOf({ prob: 0.60, status: "Questionable" });
    expect(r.tier).toBe("medium");
    expect(r.capped).toBe(false);
  });

  it("scores a one-sided market on P(over), never on distance from a coin flip", () => {
    // A 9% anytime TD is a longshot with little conviction behind it, not a
    // 91% lock. And the side is always the over, because that is the only bet.
    const longshot = confidenceOf({ prob: 0.09, oneSided: true });
    expect(longshot.tier).toBe("low");
    expect(longshot.side).toBe("over");
    expect(longshot.win).toBeCloseTo(0.09);
    // The same probability on a two-sided line IS a strong under.
    const twoSided = confidenceOf({ prob: 0.09 });
    expect(twoSided.tier).toBe("high");
    expect(twoSided.side).toBe("under");
  });

  it("still rewards a genuinely likely one-sided play", () => {
    const likely = confidenceOf({ prob: 0.68, oneSided: true });
    expect(likely.tier).toBe("high");
    expect(likely.side).toBe("over");
  });

  it("degrades to a low, sideless row rather than throwing on a missing price", () => {
    const r = confidenceOf({ prob: null });
    expect(r.tier).toBe("low");
    expect(r.side).toBe(null);
    expect(r.win).toBe(null);
  });

  it("ranks high above medium above low", () => {
    expect(CONF_RANK.high).toBeGreaterThan(CONF_RANK.medium);
    expect(CONF_RANK.medium).toBeGreaterThan(CONF_RANK.low);
  });
});

describe("baselineTrust — role averages", () => {
  it("ranks a role average BELOW a carried prior season", () => {
    // The distinction is the point: a carried prior is the player's own measured
    // year; a role average is the league's number for the slot his club happens
    // to list him in. Both are cold, one is colder.
    const carried = baselineTrust({ prior_source: "prior-season", live_weight: 0, depth_rank: 1 });
    const role = baselineTrust({ prior_source: "role-average", live_weight: 0, depth_rank: 1 });
    expect(role).toBeLessThan(carried);
    expect(role).toBeGreaterThan(0);
  });

  it("penalises a buried role average further", () => {
    const starter = baselineTrust({ prior_source: "role-average", live_weight: 0, depth_rank: 1 });
    const buried = baselineTrust({ prior_source: "role-average", live_weight: 0, depth_rank: 4 });
    expect(buried).toBeLessThan(starter);
  });

  it("rises as he plays his own games", () => {
    const cold = baselineTrust({ prior_source: "role-average", live_weight: 0, depth_rank: 1 });
    const warm = baselineTrust({ prior_source: "role-average", live_weight: 0.8, depth_rank: 1 });
    expect(warm).toBeGreaterThan(cold);
  });
});
