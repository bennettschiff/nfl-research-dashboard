import { describe, it, expect } from "vitest";
import { rescorePick, RESCORE_BASIS } from "./rescore.js";
import { underTodaysRules } from "./rescoreView.js";
import { calibrateToMarket, probOverSkewed } from "./models.js";
import { sackProbOver } from "./sacks.js";

const STANDING = { rush_yards: { status: "core" }, pass_yards: { status: "core" }, "rec_yards:under": { status: "benched" } };
const base = { pick_key: "k", source: "auto", season: 2026, week: 2, outcome: "win", profit: 0.91 };

describe("rescorePick — two-sided", () => {
  // A raw over the price disagrees with: calibration pulls it to the market's side.
  const p = { ...base, prop_type: "rush_yards", direction: "over", line: 60.5, proj_mean: 66, sigma: 25,
    actual: 50, outcome: "loss", profit: -1, book: "fanduel", book_odds: -110,
    signals: { books: { fanduel: { line: 60.5, over: 120, under: -150 }, draftkings: { line: 60.5, over: 115, under: -145 } } } };


  it("re-grades the frozen actual on the new side and drops the old side's close", () => {
    const r = rescorePick(p, STANDING);
    expect(r.outcome).toBe("win");
    expect(r.profit).toBeCloseTo(100 / 145, 3);
    expect(r.clv_prob).toBeNull();
  });

  it("stamps the verdict as re-scored, never pre-kickoff", () => {
    expect(rescorePick(p, STANDING).official_basis).toBe(RESCORE_BASIS);
  });

  it("leaves a void a void", () => {
    expect(rescorePick({ ...p, outcome: "void", profit: 0, actual: null }, STANDING).outcome).toBe("void");
  });
});

describe("rescorePick — one-sided calls", () => {
  it("an anytime TD the price does not justify is a NO, not a bet", () => {
    const p = { ...base, prop_type: "anytime_td", direction: "over", line: 0.5, proj_mean: 0.2, actual: 0, outcome: "loss",
      signals: { books: { fanduel: { line: null, over: 300, under: null } } } };
    expect(rescorePick(p, STANDING)).toMatchObject({ direction: "no", outcome: "pass", profit: 0 });
  });

  it("a defensive back is never a sack Yes, whatever the price", () => {
    const p = { ...base, prop_type: "def_sacks", position: "DB", direction: "over", line: 0.5, proj_mean: 0.9, actual: 1,
      signals: { books: { fanduel: { line: 0.5, over: 900, under: null } } } };
    expect(rescorePick(p, STANDING).direction).toBe("no");
  });

  it("a sack Yes is priced at P(credit > rung): a half sack on 0.5 is a push", () => {
    const p = { ...base, prop_type: "def_sacks", position: "DL", direction: "over", line: 0.5, proj_mean: 0.6, actual: 0.5,
      signals: { books: { fanduel: { line: 0.5, over: 400, under: null } } } };
    const r = rescorePick(p, STANDING);
    expect(r.prob_over).toBeCloseTo(sackProbOver(0.6, 0.5), 4);
    expect(r.outcome).toBe("push");
    expect(r.profit).toBe(0);
  });
});

describe("underTodaysRules", () => {
  it("overlays only pre-baseline auto rows, and drops a re-scored NO", () => {
    const picks = [
      { pick_key: "a", source: "auto", season: 2026, week: 2, direction: "over", outcome: "loss" },
      { pick_key: "b", source: "auto", season: 2026, week: 3, direction: "over", outcome: "loss" },
      { pick_key: "c", source: "auto", season: 2026, week: 5, direction: "over", outcome: "win" },
    ];
    const out = underTodaysRules(picks, { official_rule: "x", picks: {
      a: { direction: "under", outcome: "win" }, b: { direction: "no", outcome: "pass" }, c: { outcome: "loss" } } });
    expect(out.map((p) => p.pick_key)).toEqual(["a", "c"]);
    expect(out[0]).toMatchObject({ direction: "under", outcome: "win", official_basis: RESCORE_BASIS });
    expect(out[1].outcome).toBe("win");
  });
});
