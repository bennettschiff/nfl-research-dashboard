import { describe, it, expect } from "vitest";
import {
  indexGameLines, priceGame, buildGameRows, pickFromGameRow, pickLabel, gameOfficialScore,
  gradeGamePick, closeGameFor, normInv, GAME_CAL,
} from "./gameMarkets.js";
import { officialVerdict, marketStanding } from "./officialPicks.js";
import { normalCDF } from "./models.js";

const G = { game_id: "2026_06_SEA_DEN", season: 2026, week: 6, home_team: "DEN", away_team: "SEA" };
const byId = { [G.game_id]: G };
const row = (book, market, outcome, line, odds, extra = {}) =>
  ({ game_id: G.game_id, book, market, outcome, line, odds, captured_at: "2026-10-14T12:00:00Z", ...extra });

// SEA −2.5 at FanDuel, DEN favoured by nothing in the engine's eyes.
const LINES = [
  row("fanduel", "spreads", "DEN", 2.5, -104), row("fanduel", "spreads", "SEA", -2.5, -116),
  row("fanduel", "totals", "Over", 40.5, -110), row("fanduel", "totals", "Under", 40.5, -110),
  row("fanduel", "h2h", "DEN", null, 128), row("fanduel", "h2h", "SEA", null, -150),
  row("fanduel", "team_totals", "Over", 19.5, -122, { team: "DEN" }),
  row("fanduel", "team_totals", "Under", 19.5, -104, { team: "DEN" }),
  row("draftkings", "spreads", "DEN", 3, -120), row("draftkings", "spreads", "SEA", -3, 100),
  row("draftkings", "totals", "Over", 40.5, -105), row("draftkings", "totals", "Under", 40.5, -115),
];
const ENG = { game_id: G.game_id, total: 41.5, margin: -0.49, home_pts: 20.5, away_pts: 21.0,
  points_total: 44.3, points_margin: -2.4, parts: {}, qb: {} };
const SIGMA = { total: 13.28, margin: 13.06, team: 9.31 };
const engine = { sigma: SIGMA, byGame: new Map([[G.game_id, ENG]]) };

describe("indexGameLines", () => {
  it("files each side under home/away or over/under, team totals under the team", () => {
    const idx = indexGameLines(LINES, byId).get(G.game_id);
    expect(idx.fanduel.spread.home.line).toBe(2.5);
    expect(idx.fanduel.spread.away.line).toBe(-2.5);
    expect(idx.fanduel.total.over.odds).toBe(-110);
    expect(idx.fanduel.moneyline.away.odds).toBe(-150);
    expect(idx.fanduel.team_total.home.over.line).toBe(19.5);
  });
  it("keeps the newest capture when a moved line left its old row behind", () => {
    const old = row("fanduel", "totals", "Over", 41.5, -110, { captured_at: "2026-10-13T12:00:00Z" });
    const idx = indexGameLines([old, ...LINES], byId).get(G.game_id);
    expect(idx.fanduel.total.over.line).toBe(40.5);
  });
  it("ignores books the board does not show", () => {
    const idx = indexGameLines([row("betmgm", "totals", "Over", 40.5, -110)], byId);
    expect(idx.size).toBe(0);
  });
});

describe("priceGame / buildGameRows", () => {
  const d = { year: 2026, gameLines: indexGameLines(LINES, byId) };

  it("takes the engine's side of the spread and prices it at the reference line", () => {
    const [r] = buildGameRows(d, [G], "spread", { engine });
    // Engine: SEA by 0.49. Market: SEA by 2.5. The engine is on Denver +2.5.
    expect(r.side).toBe("home");
    expect(r.team).toBe("DEN");
    expect(r.line).toBe(2.5);
    expect(pickLabel(r)).toBe("DEN +2.5");
    expect(r.proj).toBeCloseTo(0.49, 2);          // fair handicap for Denver
    expect(r.diff).toBeCloseTo(2.01, 2);
    // DraftKings is on +3, a different bet — shown, never the best price.
    expect(r.priced.books.draftkings.offLine).toBe(true);
    expect(r.book).toBe("fanduel");
  });

  it("calibrates Win% to the price: k 0 on spreads is the de-vigged market", () => {
    const [r] = buildGameRows(d, [G], "spread", { engine });
    expect(GAME_CAL.spread.k).toBe(0);
    expect(r.win).toBeCloseTo(r.mktProb, 2);
    expect(r.rawProb).toBeCloseTo(normalCDF((-0.49 + 2.5) / 13.06), 6);
  });

  it("moves k of the way toward the engine on totals", () => {
    const [r] = buildGameRows(d, [G], "total", { engine });
    expect(r.side).toBe("over");
    expect(r.win).toBeGreaterThan(r.mktProb);
    expect(r.win).toBeLessThan(r.rawProb);
  });

  it("takes the moneyline the engine rates above the price", () => {
    const [r] = buildGameRows(d, [G], "moneyline", { engine });
    expect(r.side).toBe("home");                   // DEN +128 implies ~42%; the engine says ~48.5%
    expect(r.odds).toBe(128);
    expect(r.diff).toBeGreaterThan(0);
  });

  it("builds one team-total row per team, and an unpriced team shows the engine alone", () => {
    const rows = buildGameRows(d, [G], "team_total", { engine });
    expect(rows).toHaveLength(2);
    const den = rows.find((r) => r.ttSide === "home");
    const sea = rows.find((r) => r.ttSide === "away");
    expect(den.side).toBe("over");                  // 20.5 against 19.5
    expect(sea.priced).toBeNull();
    expect(sea.proj).toBe(21);
  });

  it("returns null when a book posts only one side", () => {
    const one = indexGameLines([row("fanduel", "totals", "Over", 40.5, -110)], byId).get(G.game_id);
    expect(priceGame("total", ENG, SIGMA, one)).toBeNull();
  });
});

describe("the ledger", () => {
  const d = { year: 2026, gameLines: indexGameLines(LINES, byId) };
  const pick = (prop) => pickFromGameRow(buildGameRows(d, [G], prop, { engine })[0], { now: new Date("2026-10-14T15:00:00Z") });

  it("stores a spread pick in the side's terms, keyed once per game", () => {
    const p = pick("spread");
    expect(p.pick_key).toBe("2026|2026_06_SEA_DEN|game|spread");
    expect(p).toMatchObject({ direction: "home", team: "DEN", opp: "SEA", line: 2.5, position: "GAME", player_id: null });
    expect(p.proj_mean).toBeCloseTo(-0.49, 2);     // Denver's expected margin
    expect(gameOfficialScore(p)).toBeCloseTo((2.5 - 0.49) / 13.06, 3);
  });

  it("keys a team total by team", () => {
    const tt = buildGameRows(d, [G], "team_total", { engine }).find((r) => r.priced);
    expect(pickFromGameRow(tt).pick_key).toBe("2026|2026_06_SEA_DEN|team:DEN|team_total");
  });

  it("scores a moneyline as the engine's margin against the margin the price implies", () => {
    const p = pick("moneyline");
    expect(p.line).toBe(0);
    // Denver loses by 0.49 in the engine's eyes; +128 prices it to lose by ~2.6.
    expect(p.proj_mean).toBeCloseTo(-0.49, 2);
    expect(gameOfficialScore(p)).toBeCloseTo(p.proj_mean / p.sigma - normInv(p.mkt_prob), 6);
    expect(gameOfficialScore(p)).toBeGreaterThan(0.15);
  });

  it("is never official while the market is on probation", () => {
    const p = pick("spread");
    const v = officialVerdict(p, marketStanding([]));
    expect(v.official).toBe(false);
    expect(v.note).toBe("market on probation");
  });

  it("grades a spread, a push on the number, a moneyline, a total and a team total", () => {
    const sc = { home_team: "DEN", away_team: "SEA", home_score: 20, away_score: 24 };
    expect(gradeGamePick({ prop_type: "spread", team: "DEN", line: 2.5, book_odds: -104 }, sc))
      .toEqual({ outcome: "loss", actual: -4, profit: -1 });
    expect(gradeGamePick({ prop_type: "spread", team: "DEN", line: 4, book_odds: -110 }, sc).outcome).toBe("push");
    expect(gradeGamePick({ prop_type: "moneyline", team: "SEA", line: 0, book_odds: -150 }, sc))
      .toEqual({ outcome: "win", actual: 4, profit: 0.6667 });
    expect(gradeGamePick({ prop_type: "total", direction: "over", line: 40.5, book_odds: -110 }, sc).outcome).toBe("win");
    expect(gradeGamePick({ prop_type: "team_total", team: "DEN", direction: "over", line: 19.5, book_odds: 100 }, sc))
      .toEqual({ outcome: "win", actual: 20, profit: 1 });
  });

  it("waits for a final score", () => {
    expect(gradeGamePick({ prop_type: "total", direction: "over", line: 40.5 }, { home_score: "", away_score: "" })).toBeNull();
  });

  it("measures CLV against a later close, in the side's terms", () => {
    const p = { ...pick("spread"), odds_at: "2026-10-14T12:00:00Z" };
    const closeRows = [
      row("fanduel", "spreads", "DEN", 1.5, -110, { captured_at: "2026-10-15T23:00:00Z" }),
      row("fanduel", "spreads", "SEA", -1.5, -110, { captured_at: "2026-10-15T23:00:00Z" }),
    ];
    const c = closeGameFor(p, indexGameLines(closeRows, byId).get(G.game_id), "DEN");
    expect(c.close_line).toBe(1.5);
    expect(c.clv_line).toBe(1);                    // took +2.5, it closed +1.5
    expect(c.clv_prob).toBeNull();                  // a different line is a different bet
  });
});

describe("normInv", () => {
  it("inverts the normal CDF", () => {
    for (const p of [0.01, 0.135, 0.5, 0.7, 0.99]) expect(normalCDF(normInv(p))).toBeCloseTo(p, 4);
  });
});
