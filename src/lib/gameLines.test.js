// ── Game-line and TD-model tests ─────────────────────────────────────────────
// These pin the two things that silently invert a model rather than break it:
// the sign convention on spread, and the direction of the shrinkage.
import { describe, it, expect } from "vitest";
import { fitRatings, predictGame, fromMarket, impliedTeamPoints } from "./gameLines.js";
import { passTdLambda, anytimeTdLambda, PASS_TD_PARAMS, ATD_PARAMS, poissonGTE } from "./models.js";
import { normName, looseName, buildNameIndex, resolveName } from "./names.js";
import * as odds from "./odds.js";

const near = (a, b, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

// A tiny league: STRONG beats WEAK repeatedly, at neutral sites and both homes.
const games = [];
for (let i = 0; i < 12; i++) {
  games.push({ home: "STRONG", away: "WEAK", homeScore: 31, awayScore: 13, date: `2025-09-${String(i + 1).padStart(2, "0")}` });
  games.push({ home: "WEAK", away: "STRONG", homeScore: 14, awayScore: 28, date: `2025-10-${String(i + 1).padStart(2, "0")}` });
  games.push({ home: "MID", away: "OTHER", homeScore: 21, awayScore: 21, date: `2025-09-${String(i + 1).padStart(2, "0")}` });
}

describe("fitRatings / predictGame", () => {
  const r = fitRatings(games, "2025-12-01", { halfLifeDays: 3650, maxLookbackDays: 3650 });

  it("ranks a team that scores more and allows less above one that does not", () => {
    expect(r.off.STRONG).toBeGreaterThan(r.off.WEAK);
    expect(r.def.STRONG).toBeLessThan(r.def.WEAK);   // def is points ALLOWED — lower is better
  });

  it("returns a HOME-POSITIVE margin, matching nflverse spread_line", () => {
    const p = predictGame(r, "STRONG", "WEAK");
    expect(p.margin).toBeGreaterThan(0);
    const flipped = predictGame(r, "WEAK", "STRONG");
    expect(flipped.margin).toBeLessThan(0);
  });

  it("keeps total = home + away", () => {
    const p = predictGame(r, "STRONG", "WEAK");
    near(p.total, p.homePts + p.awayPts, 1e-9);
  });

  it("EXCLUDES games on or after the as-of date — the whole point of walk-forward", () => {
    const early = fitRatings(games, "2025-09-02", { halfLifeDays: 3650, maxLookbackDays: 3650 });
    const late = fitRatings(games, "2025-12-01", { halfLifeDays: 3650, maxLookbackDays: 3650 });
    expect(early.sampleGames).toBeLessThan(late.sampleGames);
    // Nothing at all before the first game.
    expect(fitRatings(games, "2025-01-01", {})).toBe(null);
  });

  it("shrinks harder toward league average with a bigger prior", () => {
    const loose = fitRatings(games, "2025-12-01", { priorGames: 0, halfLifeDays: 3650, maxLookbackDays: 3650 });
    const tight = fitRatings(games, "2025-12-01", { priorGames: 50, halfLifeDays: 3650, maxLookbackDays: 3650 });
    expect(Math.abs(tight.off.STRONG)).toBeLessThan(Math.abs(loose.off.STRONG));
  });

  it("treats an unknown team as league average rather than throwing", () => {
    const p = predictGame(r, "STRONG", "EXPANSION");
    expect(Number.isFinite(p.total)).toBe(true);
  });
});

describe("fromMarket", () => {
  it("inverts total+spread back into the two team totals", () => {
    // 47.5 total, home favoured by 3.5 → home 25.5, away 22.
    const m = fromMarket(47.5, 3.5);
    near(m.homePts, 25.5);
    near(m.awayPts, 22);
    near(m.margin, 3.5);
    near(impliedTeamPoints(m, "home"), 25.5);
    near(impliedTeamPoints(m, "away"), 22);
  });

  it("handles a home dog (negative spread) without flipping sides", () => {
    const m = fromMarket(44, -6.5);
    near(m.homePts, 18.75);
    near(m.awayPts, 25.25);
    expect(m.homePts).toBeLessThan(m.awayPts);
  });
});

describe("passTdLambda", () => {
  const starter = { games: 8, pass_att_pg: 34, pass_td_pg: 1.5 };

  it("scales with the team's implied points — the measured signal", () => {
    const lo = passTdLambda(starter, { impliedTotal: 17 }).lambda;
    const hi = passTdLambda(starter, { impliedTotal: 28 }).lambda;
    expect(hi).toBeGreaterThan(lo);
  });

  it("lands near the league rate for a league-average starter", () => {
    // 22.4 implied pts × 0.1082 TD/pt × 0.614 thrown ≈ 1.49 team passing TDs.
    const r = passTdLambda(starter, { impliedTotal: 22.4 });
    expect(r.lambda).toBeGreaterThan(1.2);
    expect(r.lambda).toBeLessThan(1.8);
  });

  it("shrinks a low-volume passer toward a LOWER anchor, not the league starter", () => {
    // The failure this shape exists to prevent: a backup with a fluke TD rate
    // must not price like a starter.
    const backup = { games: 3, pass_att_pg: 9, pass_td_pg: 2.0 };
    const r = passTdLambda(backup, { impliedTotal: 22.4 });
    expect(r.lambda).toBeLessThan(passTdLambda(starter, { impliedTotal: 22.4 }).lambda);
  });

  it("returns null without an implied total rather than inventing one", () => {
    expect(passTdLambda(starter, {})).toBe(null);
    expect(passTdLambda(starter, { impliedTotal: 0 })).toBe(null);
  });

  it("prices over-1.5 as poissonGTE(λ, 2)", () => {
    const r = passTdLambda(starter, { impliedTotal: 22.4 });
    const p = poissonGTE(r.lambda, 2);
    expect(p).toBeGreaterThan(0.2);
    expect(p).toBeLessThan(0.7);
  });
});

describe("anytimeTdLambda after the 2026-09-08 recalibration", () => {

  it("still refuses to inflate a low-usage player off a fluke rate", () => {
    // Two scores in three games, but almost no touches: must stay a longshot.
    const bench = { games: 3, carries_pg: 1, targets_pg: 1, total_td_pg: 0.67,
      rush_td_pg: 0.33, rec_td_pg: 0.34 };
    const { lambda } = anytimeTdLambda(bench, { impliedTotal: 24 });
    expect(1 - Math.exp(-lambda)).toBeLessThan(0.30);
  });

});

describe("names.js is the single source of truth", () => {
  // src/lib/odds.js keeps its own copy for the browser path (it cannot import a
  // Node-friendly module without dragging the Supabase client into scripts).
  // If the two ever drift, a market silently attaches to the wrong player.
  const cases = ["Amon-Ra St. Brown", "Marvin Harrison Jr.", "Kenny Gainwell",
    "D.K. Metcalf", "Chidobe Awuzié", "Odell Beckham Jr", "Michael Pittman II", ""];
  it("agrees with odds.js on normName", () => {
    for (const c of cases) expect(normName(c)).toBe(odds.normName(c));
  });
  it("agrees with odds.js on looseName", () => {
    for (const c of cases) expect(looseName(c)).toBe(odds.looseName(c));
  });
});

describe("buildNameIndex / resolveName", () => {
  const roster = [
    { player_id: "1", full_name: "Kenneth Gainwell" },
    { player_id: "2", full_name: "Josh Palmer" },
    { player_id: "3", full_name: "Cam Brown" },
    { player_id: "4", full_name: "Chris Brown" },
  ];
  const ix = buildNameIndex(roster);

  it("resolves an exact name", () => expect(resolveName(ix, "Josh Palmer")).toBe("2"));
  it("resolves a nickname through the loose key", () => expect(resolveName(ix, "Kenny Gainwell")).toBe("1"));
  it("resolves the long form too", () => expect(resolveName(ix, "Joshua Palmer")).toBe("2"));

  it("refuses an ambiguous surname rather than guessing", () => {
    // Cam and Chris Brown both collapse to c|brown, so neither is usable loosely.
    expect(resolveName(ix, "Cameron Brown")).toBe(null);
    // ...but the exact spellings still resolve.
    expect(resolveName(ix, "Cam Brown")).toBe("3");
  });

  it("returns null for someone not on the roster", () => {
    expect(resolveName(ix, "Arizona Cardinals Defense")).toBe(null);
  });
});
