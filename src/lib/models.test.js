// Tests for the public reference model (the production model is private).
import { describe, it, expect } from "vitest";
import {
  oddsToImplied, probToAmericanOdds, calcEV, calibrateToMarket, probOverNormal,
  probOverSkewed, poissonGTE, receptionsSigma, gameContext, teamOpportunityBudget,
  applyBudget, passTdLambda, anytimeTdLambda, projectPlayer,
} from "./models.js";

describe("odds and distributions", () => {
  it("round-trips odds and prices EV", () => {
    expect(oddsToImplied(-110)).toBeCloseTo(0.5238, 4);
    expect(probToAmericanOdds(0.6)).toBe(-150);
    expect(calcEV(0.5, 100)).toBe(0);
  });
  it("prices a line at the mean as a coin flip", () => {
    expect(probOverNormal(60, 20, 60)).toBeCloseTo(0.5, 6);
    expect(probOverSkewed(60, 20, 40)).toBeGreaterThan(0.5);
    expect(poissonGTE(0.5, 1)).toBeCloseTo(1 - Math.exp(-0.5), 6);
  });
  it("receptions spread grows with targets", () => {
    expect(receptionsSigma(9, 0.65)).toBeGreaterThan(receptionsSigma(3, 0.65));
  });
});

describe("market calibration", () => {
  it("pulls a two-sided price toward the book, never past it", () => {
    const p = calibrateToMarket("rec_yards", 0.70, 0.50, true);
    expect(p).toBeGreaterThan(0.5);
    expect(p).toBeLessThan(0.70);
  });
  it("leaves the model alone without a price", () => {
    expect(calibrateToMarket("rec_yards", 0.62, null, true)).toBe(0.62);
  });
});

describe("game script and budgets", () => {
  it("favorites run more and throw less", () => {
    const fav = gameContext({ spread_line: 7, total_line: 46 }, "home");
    expect(fav.rushVolMult).toBeGreaterThan(1);
    expect(fav.passVolMult).toBeLessThan(1);
  });
  it("scales players down to the team's pool, never up", () => {
    const rows = [
      { player_id: "a", position: "WR", targets_pg: 12 },
      { player_id: "b", position: "WR", targets_pg: 12 },
    ];
    const b = teamOpportunityBudget(rows, { targetPool: 18 });
    expect(b.get("a").targets_pg + b.get("b").targets_pg).toBeCloseTo(18, 6);
    const roomy = teamOpportunityBudget(rows, { targetPool: 40 });
    expect(roomy.get("a").targets_pg).toBe(12);
    expect(applyBudget(rows[0], b.get("a")).targets_pg).toBeCloseTo(9, 6);
  });
});

describe("projections", () => {
  const ctx = { impliedTotal: 24 };
  it("TD lambdas stay in a sane range", () => {
    expect(passTdLambda({ pass_att_pg: 34, pass_td_pg: 1.8, games: 10 }, ctx).lambda).toBeGreaterThan(0.8);
    const atd = anytimeTdLambda({ carries_pg: 18, targets_pg: 4, total_td_pg: 0.7, games: 10 }, ctx);
    expect(atd.lambda).toBeGreaterThan(0.2);
    expect(atd.lambda).toBeLessThanOrEqual(1.2);
  });
  it("projects the props a receiver is eligible for, with priced rows", () => {
    const rows = projectPlayer({
      season: { position: "WR", games: 10, targets_pg: 8, ypt: 9, catch_rate: 0.68, rec_td_pg: 0.5 },
      game: { spread_line: -3, total_line: 47 }, side: "home",
    });
    const types = rows.map((r) => r.prop_type);
    expect(types).toEqual(expect.arrayContaining(["rec_yards", "receptions", "anytime_td"]));
    for (const r of rows) {
      expect(r.prob_over).toBeGreaterThan(0);
      expect(r.prob_over).toBeLessThan(1);
    }
  });
});
