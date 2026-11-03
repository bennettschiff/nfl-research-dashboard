import { describe, it, expect } from "vitest";
import { hitRates, gamesBefore, streakOf, STAT_OF } from "./hitRates.js";

const w = (season, week, o = {}) => ({ season, week, opponent: "KC", rec_yards: 0, ...o });

describe("gamesBefore", () => {
  it("drops the row's own week and anything after it, newest first", () => {
    const rows = [w(2025, 17), w(2026, 1), w(2026, 2), w(2025, 18)];
    const out = gamesBefore(rows, { season: 2026, week: 2 });
    expect(out.map((r) => `${r.season}-${r.week}`)).toEqual(["2026-1", "2025-18", "2025-17"]);
  });
});

describe("hitRates", () => {
  const history = [
    w(2026, 1, { rec_yards: 80, opponent: "DEN" }),
    w(2025, 18, { rec_yards: 40 }),
    w(2025, 17, { rec_yards: 60 }),
    w(2025, 16, { rec_yards: 55.5 }),       // a push at 55.5
    w(2025, 15, { rec_yards: 90, opponent: "DEN" }),
    w(2024, 10, { rec_yards: 10 }),
  ];
  const game = { season: 2026, week: 2 };
  const hr = hitRates(history, "rec_yards", 55.5, game, "DEN");

  it("measures each window against the row's line, pushes excluded", () => {
    expect(hr.l5).toEqual({ hits: 3, n: 4, rate: 0.75 });
    expect(hr.l20).toEqual({ hits: 3, n: 5, rate: 0.6 });
  });
  it("splits this season, last season and head-to-head", () => {
    expect(hr.szn).toEqual({ hits: 1, n: 1, rate: 1 });
    expect(hr.prev).toEqual({ hits: 2, n: 3, rate: 2 / 3 });
    expect(hr.h2h).toEqual({ hits: 2, n: 2, rate: 1 });
  });
  it("returns null rates, not zeros, with no games", () => {
    const empty = hitRates([], "rec_yards", 55.5, game, "DEN");
    expect(empty.l10).toEqual({ hits: 0, n: 0, rate: null });
    expect(empty.streak).toBe(0);
  });
  it("returns null for an unknown prop or a missing line", () => {
    expect(hitRates(history, "longest_rec", 20.5, game, "DEN")).toBeNull();
    expect(hitRates(history, "rec_yards", null, game, "DEN")).toBeNull();
  });
  it("settles anytime TD on rushing plus receiving scores only", () => {
    expect(STAT_OF.anytime_td({ rush_tds: 0, rec_tds: 1, pass_tds: 3 })).toBe(1);
    expect(STAT_OF.anytime_td({ rush_tds: 0, rec_tds: 0, pass_tds: 3 })).toBe(0);
  });
});

describe("streakOf", () => {
  const s = (vals) => streakOf(vals.map((v) => ({ rec_yards: v })), STAT_OF.rec_yards, 50.5);
  it("is signed: + for overs, − for unders", () => {
    expect(s([60, 70, 40])).toBe(2);
    expect(s([20, 30, 30, 90])).toBe(-3);
  });
  it("ends at a push", () => {
    expect(streakOf([{ rec_yards: 60 }, { rec_yards: 50 }], STAT_OF.rec_yards, 50)).toBe(1);
  });
});
