// ── In-season weaning of a carried defensive EPA prior ───────────────────────
import { describe, it, expect } from "vitest";
import { weanDefenseEpa, weanPressure, DEF_EPA_WEAN_K, PRESSURE_WEAN_K, PRESSURE_MAP, defensePriorFor } from "./defensePriors.js";

const prior = {
  team_abbr: "BUF", def_pass_epa: 0.06, def_rush_epa: -0.08,
  basis: { def_pass_epa: { league_mean: 0.06 }, def_rush_epa: { league_mean: -0.06 } },
};
const live = (games, pass, rush, lg = { def_pass_epa: 0.10, def_rush_epa: -0.10 }) =>
  ({ league: lg, teams: { BUF: { games, def_pass_epa: pass, def_rush_epa: rush } } });

describe("weanDefenseEpa", () => {
  it("leaves the prior untouched before a game is played", () => {
    expect(weanDefenseEpa(prior, live(0, 0.5, 0.5), "BUF")).toBe(prior);
    expect(weanDefenseEpa(prior, null, "BUF")).toBe(prior);
  });

  it("weights live data n/(n+K), in deviation-from-league space", () => {
    const out = weanDefenseEpa(prior, live(1, 0.35, -0.10), "BUF");
    const w = 1 / (1 + DEF_EPA_WEAN_K);
    // pass: prior dev 0, live dev +0.25 → league 0.06 + w·0.25
    expect(out.def_pass_epa).toBeCloseTo(0.06 + w * 0.25, 5);
    // rush: prior dev −0.02, live dev 0 (league-average week) → shrinks toward league
    expect(out.def_rush_epa).toBeCloseTo(-0.06 + (1 - w) * -0.02, 5);
    expect(out.live_games).toBe(1);
  });

  it("does not read league-wide drift as a team trait", () => {
    // Every team allowed +0.10 more this week; this one matched the league.
    const out = weanDefenseEpa(prior, live(8, 0.16, -0.06, { def_pass_epa: 0.16, def_rush_epa: -0.06 }), "BUF");
    expect(out.def_pass_epa).toBeCloseTo(0.06, 5);
  });
});

describe("weanPressure", () => {
  const p = { team_abbr: "BUF", pressure_rate: 0.31, basis: { pressure: { league_mean: 0.29 } } };
  const lv = (games, proxy, lg = 0.24) => ({ league: { pressure_proxy: lg }, teams: { BUF: { games, pressure_proxy: proxy } } });

  it("returns null with nothing to blend", () => {
    expect(weanPressure(p, lv(0, 0.3), "BUF")).toBe(null);
    expect(weanPressure(p, { league: {}, teams: { BUF: { games: 1, pressure_proxy: 0.3 } } }, "BUF")).toBe(null);
  });

  it("maps PFR's scale onto participation's before blending, at n/(n+K)", () => {
    const out = weanPressure(p, lv(2, 0.34), "BUF");
    const w = 2 / (2 + PRESSURE_WEAN_K);
    expect(out.value).toBeCloseTo(0.29 + w * PRESSURE_MAP.b * 0.10 + (1 - w) * 0.02, 5);
    expect(out.weight).toBeCloseTo(w, 3);
  });

  it("feeds pressureMatchup's field on the season's priors", () => {
    const d = defensePriorFor(2026, "BUF");
    expect(d.pressure_rate).toBe(d.pressure);
    expect(d.live_pressure_weight).toBeGreaterThan(0);
  });
});
