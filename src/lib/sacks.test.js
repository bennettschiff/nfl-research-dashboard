// ── The sack model ───────────────────────────────────────────────────────────
// Golden values come from the walk-forward fit (scripts/backtest_sacks.mjs,
// tuned on 2022-23 and held out on 2024-25). If one of these moves because a
// parameter was intentionally refit, the same commit bumps src/modelVersions.js.
import { describe, it, expect } from "vitest";
import {
  SACK_PARAMS, shrunkRate, sackLambda, sackRungs, sackProbOver, sackPushProb, sackOutcome, SACK_LINES,
  sackEvTrusted,
} from "./sacks.js";

// League constants as of the 2026 priors artifact.
const LG = {
  sackRate: 0.005872, hitRate: 0.0139, teamSackRate: 0.064865, dropbacks: 37.21,
  byPos: {
    DL: { sackRate: 0.010473, hitRate: 0.025964 },
    LB: { sackRate: 0.008713, hitRate: 0.019855 },
    DB: { sackRate: 0.001087, hitRate: 0.002317 },
  },
};
const AVG_LINE = { dropbacks: 2000, sacksAllowed: 2000 * LG.teamSackRate };
// Myles Garrett's row in scripts/out/sack_priors_2026.json.
const elite = { pos: "LB", wOpps: 311.07, wSacks: 12.442, wHits: 22.14, snapPct: 0.7972 };
const rotational = { pos: "DL", wOpps: 180, wSacks: 1.0, wHits: 2.4, snapPct: 0.35 };

describe("shrunkRate", () => {
  it("is the league rate with no evidence and the raw rate with a lot", () => {
    expect(shrunkRate(0, 0, 0.006, 40)).toBeCloseTo(0.006, 10);
    expect(shrunkRate(40_000 * 0.02, 40_000, 0.006, 40)).toBeCloseTo(0.02, 4);
  });
  it("pulls a hot small sample most of the way back", () => {
    // Two sacks in 20 opportunities is a 10% rate; 40 opportunities of prior
    // weight must not let that stand.
    expect(shrunkRate(2, 20, 0.006, 40)).toBeLessThan(0.04);
  });
});

describe("sackLambda", () => {
  it("lands an elite edge rusher where a book posts him", () => {
    const l = sackLambda(elite, AVG_LINE, LG, 0);
    expect(l).toBeGreaterThan(0.6);
    expect(l).toBeLessThan(1.1);
  });

  it("scales a rotational rusher down, not to zero", () => {
    const l = sackLambda(rotational, AVG_LINE, LG, 0);
    expect(l).toBeGreaterThan(0.05);
    expect(l).toBeLessThan(0.3);
  });

  it("refuses a player with no snap share rather than calling him a zero", () => {
    expect(sackLambda({ ...elite, snapPct: 0 }, AVG_LINE, LG, 0)).toBeNull();
    expect(sackLambda(null, AVG_LINE, LG, 0)).toBeNull();
  });

  it("rewards a leaky line and caps how far a great one can push", () => {
    const leaky = { dropbacks: 2000, sacksAllowed: 2000 * LG.teamSackRate * 3 };
    const wall = { dropbacks: 2000, sacksAllowed: 0 };
    const base = sackLambda(elite, AVG_LINE, LG, 0);
    expect(sackLambda(elite, leaky, LG, 0) / base).toBeCloseTo(1 + SACK_PARAMS.OPP_CAP, 2);
    expect(sackLambda(elite, wall, LG, 0) / base).toBeCloseTo(1 - SACK_PARAMS.OPP_CAP, 2);
  });

  it("gives a favoured defence more dropbacks to rush, because the other side trails", () => {
    expect(sackLambda(elite, AVG_LINE, LG, 10)).toBeGreaterThan(sackLambda(elite, AVG_LINE, LG, -10));
  });

  it("a short sample leans on QB hits, so a hitless hot streak does not run away", () => {
    const lucky = { pos: "DL", wOpps: 60, wSacks: 4.0, wHits: 4.0, snapPct: 0.6 };  // all his hits were sacks
    const steady = { pos: "DL", wOpps: 60, wSacks: 1.0, wHits: 9.0, snapPct: 0.6 };
    // Four sacks in 60 chances is a 6.7% rate, 11x the league's; the hit term
    // and the shrinkage together must keep it under the pressure-backed player's
    // reach rather than crowning it.
    expect(sackLambda(lucky, AVG_LINE, LG, 0)).toBeLessThan(sackLambda(steady, AVG_LINE, LG, 0));
  });
});

describe("pressures (PFR-charted hurries + hits + sacks)", () => {
  // League pressure rates per opportunity, as the 2026 priors artifact writes them.
  const LGP = {
    ...LG, pressRate: 0.020195,
    byPos: {
      DL: { ...LG.byPos.DL, pressRate: 0.037568 },
      LB: { ...LG.byPos.LB, pressRate: 0.028441 },
      DB: { ...LG.byPos.DB, pressRate: 0.003748 },
    },
  };

  it("carry the rate when they are on file: a pressure-heavy rusher outranks a lucky finisher", () => {
    const finisher = { pos: "DL", wOpps: 200, wSacks: 4.0, wHits: 6.0, wPress: 10, snapPct: 0.6 };
    const rusher = { pos: "DL", wOpps: 200, wSacks: 1.5, wHits: 6.0, wPress: 30, snapPct: 0.6 };
    expect(sackLambda(rusher, AVG_LINE, LGP, 0)).toBeGreaterThan(sackLambda(finisher, AVG_LINE, LGP, 0));
  });

  it("an average pressure rate projects an average sack rate", () => {
    const avg = { pos: "DL", wOpps: 400, wSacks: 400 * LG.byPos.DL.sackRate, wHits: 400 * LG.byPos.DL.hitRate,
                  wPress: 400 * LGP.byPos.DL.pressRate, snapPct: 0.7 };
    const expected = 0.7 * LG.dropbacks * LG.byPos.DL.sackRate;
    expect(sackLambda(avg, AVG_LINE, LGP, 0)).toBeCloseTo(expected, 4);
  });

  it("fall back to the QB-hit blend for a row or a league block without them", () => {
    const noPress = { ...elite, wPress: undefined };
    const hitOnly = { ...SACK_PARAMS, PRESS_WEIGHT: 0, HIT_WEIGHT: SACK_PARAMS.HIT_WEIGHT_NO_PRESS };
    expect(sackLambda(noPress, AVG_LINE, LGP, 0)).toBeCloseTo(sackLambda(elite, AVG_LINE, LG, 0, hitOnly), 10);
    expect(sackLambda({ ...elite, wPress: 40 }, AVG_LINE, LG, 0)).toBeCloseTo(sackLambda(elite, AVG_LINE, LG, 0), 10);
  });
});

describe("the position group", () => {
  it("shrinks a safety toward a safety's rate, not a lineman's", () => {
    // Defensive linemen and linebackers take 88% of the league's sacks, so the
    // pooled rate IS a pass rusher's. Shrinking a blitzing safety toward it
    // projected defensive backs 59% high across 2024-25 held out.
    const p = { wOpps: 120, wSacks: 1.0, wHits: 2.0, snapPct: 0.9 };
    const db = sackLambda({ ...p, pos: "DB" }, AVG_LINE, LG, 0);
    const dl = sackLambda({ ...p, pos: "DL" }, AVG_LINE, LG, 0);
    expect(db).toBeLessThan(dl / 2);
  });

  it("regresses a safety harder than a lineman, because a blitz is a game plan", () => {
    expect(SACK_PARAMS.PRIOR_OPPS_BY_POS.DB).toBeGreaterThan(SACK_PARAMS.PRIOR_OPPS_BY_POS.DL);
    // How much of the way an 80-opportunity sample is allowed to carry a rate
    // from its group's anchor to what it actually saw. NOT the ratio of the two
    // projections: a defensive back's anchor is a tenth of a lineman's, so the
    // same evidence is always a bigger relative move for him even when it is
    // trusted far less.
    const carried = (pos) => {
      const g = LG.byPos[pos];
      const raw = 3.0 / 80;
      const shrunk = shrunkRate(3.0, 80, g.sackRate, SACK_PARAMS.PRIOR_OPPS_BY_POS[pos]);
      return (shrunk - g.sackRate) / (raw - g.sackRate);
    };
    expect(carried("DB")).toBeLessThan(carried("DL") / 2);
    expect(carried("DB")).toBeLessThan(0.3);
  });

  it("falls back to the pooled rate for a group it has never seen", () => {
    const p = { pos: "K", wOpps: 100, wSacks: 0.5, wHits: 1.0, snapPct: 0.5 };
    expect(sackLambda(p, AVG_LINE, LG, 0)).toBeGreaterThan(0);
    expect(sackLambda(p, AVG_LINE, { ...LG, byPos: undefined }, 0)).toBeCloseTo(
      sackLambda(p, AVG_LINE, LG, 0), 10);
  });

  it("will show a defensive back's projection and not claim an edge with it", () => {
    expect(sackEvTrusted("DL")).toBe(true);
    expect(sackEvTrusted("LB")).toBe(true);
    expect(sackEvTrusted("DB")).toBe(false);
  });
});

describe("sackRungs", () => {
  it("is a proper, ordered survival function", () => {
    const r = sackRungs(0.45);
    expect(r.p05).toBeGreaterThanOrEqual(r.p10);
    expect(r.p10).toBeGreaterThanOrEqual(r.p15);
    expect(r.p15).toBeGreaterThanOrEqual(r.p20);
    for (const v of Object.values(r)) expect(v).toBeGreaterThanOrEqual(0);
    expect(r.p05).toBeLessThanOrEqual(1);
  });

  it("matches the fitted distribution at a mid-board projection", () => {
    // Held-out 2024-25, projections in 0.40-0.50: observed 36.5% / 31.0%.
    const r = sackRungs(0.45);
    expect(r.p05).toBeCloseTo(0.3822, 3);
    expect(r.p10).toBeCloseTo(0.3198, 3);
  });

  it("keeps a full sack nearly as reachable as a half one", () => {
    // The whole point of the compound form: ~78% of credited sacks are whole,
    // so P(>=1) sits just under P(>=0.5). A Poisson on half-sack units put them
    // 3x apart and was wrong at both rungs.
    const r = sackRungs(0.45);
    expect(r.p10 / r.p05).toBeGreaterThan(0.75);
  });

  it("returns zeros rather than NaN for an absent projection", () => {
    expect(sackRungs(null)).toEqual({ p05: 0, p10: 0, p15: 0, p20: 0 });
    expect(sackRungs(0)).toEqual({ p05: 0, p10: 0, p15: 0, p20: 0 });
  });

  it("rises with the projection at every rung", () => {
    const lo = sackRungs(0.3), hi = sackRungs(0.9);
    for (const k of ["p05", "p10", "p15", "p20"]) expect(hi[k]).toBeGreaterThan(lo[k]);
  });
});

const r05 = (l) => sackRungs(l).p05;

describe("the rungs a book posts", () => {
  it("pays a line only when the credit is OVER it — a credit on the line is a push", () => {
    // 0.25 needs a half sack; 0.5 and 0.75 both need a whole one to WIN (a half
    // on 0.5 pushes); 1.0 needs one and a half. This is the grader's rule
    // (pickLedger.js outcomeOf), and until 2026-10-07 the price was not: 0.5
    // counted the push as a win and 2.5 was priced as if two sacks cashed it.
    const l = 0.45, r = sackRungs(l);
    expect(sackProbOver(l, 0.25)).toBe(r.p05);
    expect(sackProbOver(l, 0.5)).toBe(r.p10);
    expect(sackProbOver(l, 0.75)).toBe(r.p10);
    expect(sackProbOver(l, 1.0)).toBe(r.p15);
    expect(sackProbOver(l, 1.5)).toBe(r.p20);
    expect(sackProbOver(l, 2.5)).toBeLessThan(r.p20);   // needs THREE
    expect(sackProbOver(l, 2.5)).toBeCloseTo(0.0115, 4);
  });

  it("knows which lines can push, and how often", () => {
    const l = 0.45;
    expect(sackPushProb(l, 0.25)).toBe(0);
    expect(sackPushProb(l, 0.75)).toBe(0);
    expect(sackPushProb(l, 0.5)).toBeCloseTo(r05(l) - sackProbOver(l, 0.5), 10);
    // win + push + loss is everything
    for (const line of [0.5, 1, 1.5, 2.5]) {
      const lose = 1 - sackProbOver(l, line) - sackPushProb(l, line);
      expect(lose).toBeGreaterThan(0);
      expect(lose).toBeLessThan(1);
    }
  });

  it("offers exactly the four rungs the market posts", () => {
    expect(SACK_LINES).toEqual([0.25, 0.5, 0.75, 1.0]);
  });
});

describe("sackOutcome", () => {
  it("settles a yes/no rung without a push", () => {
    expect(sackOutcome(0.5, 0.25)).toBe("over");
    expect(sackOutcome(0.5, 0.5)).toBe("under");     // "over 0.5" needs more than 0.5
    expect(sackOutcome(1.0, 0.75)).toBe("over");
    expect(sackOutcome(0, 0.25)).toBe("under");
  });

  it("pushes a true over/under that lands on the number", () => {
    expect(sackOutcome(0.5, 0.5, "ou")).toBe("push");
    expect(sackOutcome(1.0, 1.0, "ou")).toBe("push");
    expect(sackOutcome(0.5, 0.25, "ou")).toBe("over");
  });

  it("says nothing about a game that has not been played", () => {
    expect(sackOutcome(null, 0.5)).toBeNull();
  });
});
