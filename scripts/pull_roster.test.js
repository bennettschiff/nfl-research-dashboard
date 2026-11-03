// ── Roster pull: CSV → overlay rows ──────────────────────────────────────────
// This pull runs unattended and the board reads its output as the truth about
// who is on which team, so the failures worth pinning are the SILENT ones: a
// team abbreviation normalised the wrong way (all 28 Rams vanish), a special
// teams row read as an offensive role, and a depth rank of null being dropped
// instead of written.
import { describe, it, expect } from "vitest";
import { toRosterRows, toDepthRows, toSnapRows, mergeOverlay, SKILL } from "./pull_roster.mjs";
import { normTeam } from "./lib/teams.mjs";

const roster = (over = {}) => ({
  gsis_id: "00-1", full_name: "A Player", position: "WR", team: "NE",
  status: "ACT", status_description_abbr: "A01", jersey_number: "13",
  headshot_url: "http://x/y.png", years_exp: "3", pfr_id: "PlayA00", ...over,
});
const chart = (over = {}) => ({
  dt: "2026-09-09T12:06:21Z", team: "NE", gsis_id: "00-1",
  pos_grp: "3WR 1TE", pos_abb: "WR", pos_rank: "2", ...over,
});

describe("toRosterRows", () => {
  it("keeps only the positions the model prices", () => {
    const out = toRosterRows([roster(), roster({ gsis_id: "00-2", position: "T" })]);
    expect(Object.keys(out)).toEqual(["00-1"]);
    expect([...SKILL].sort()).toEqual(["FB", "QB", "RB", "TE", "WR"]);
  });

  it("carries pfr_id — snap counts have no gsis_id to join on", () => {
    expect(toRosterRows([roster()])["00-1"].pfr_id).toBe("PlayA00");
  });

  it("lets the last row win, so a practice-squad elevation does not stick", () => {
    const out = toRosterRows([roster({ status: "DEV" }), roster({ status: "ACT" })]);
    expect(out["00-1"].status).toBe("ACT");
  });

  it("drops rows with no gsis_id — they cannot reach a player", () => {
    expect(Object.keys(toRosterRows([roster({ gsis_id: "" })]))).toHaveLength(0);
  });
});

describe("team normalisation", () => {
  // CANONICAL IS "LA". teams.json, games.json and every stats file say LA, so a
  // Rams player written LAR joins to no game, no defense and no team prior, and
  // drops off the board with no error. This ran the wrong way once already.
  it("canonicalises the Rams to LA, never LAR", () => {
    expect(toRosterRows([roster({ team: "LAR" })])["00-1"].team_abbr).toBe("LA");
    expect(normTeam("LA")).toBe("LA");
  });

  it("passes through what nflverse actually emits", () => {
    for (const t of ["ARI", "WAS", "BAL", "CLE", "HOU", "JAX", "LA"]) {
      expect(normTeam(t)).toBe(t);
    }
  });
});

describe("toDepthRows", () => {
  it("ignores the special-teams chart", () => {
    // DeMario Douglas is New England's WR3 and its punt returner, ranked 2 on
    // special teams. Reading the return rank as a receiving role is exactly the
    // trap build_depth_weekly.py falls into by taking a minimum across charts.
    const out = toDepthRows([
      chart({ pos_grp: "Special Teams", pos_abb: "PR", pos_rank: "2" }),
      chart({ pos_grp: "3WR 1TE", pos_abb: "WR", pos_rank: "3" }),
    ]);
    expect(out["00-1"]).toEqual({ depth_rank: 3, depth_pos: "WR", depth_team: "NE" });
  });

  it("keeps the better rank when a player holds two spots in the same group", () => {
    const out = toDepthRows([chart({ pos_rank: "4" }), chart({ pos_rank: "2" })]);
    expect(out["00-1"].depth_rank).toBe(2);
  });
});

describe("toSnapRows", () => {
  const snap = (over = {}) => ({
    game_type: "REG", pfr_player_id: "PlayA00", week: "1", team: "NE",
    offense_snaps: "42", offense_pct: "0.61", ...over,
  });

  it("joins to gsis_id through pfr_id", () => {
    const [r] = toSnapRows([snap()], 2026, { PlayA00: "00-1" });
    expect(r).toMatchObject({ player_id: "00-1", season: 2026, week: 1, off_pct: 0.61, off_snaps: 42 });
  });

  it("drops a player the roster does not carry rather than guessing", () => {
    expect(toSnapRows([snap({ pfr_player_id: "Nobody00" })], 2026, { PlayA00: "00-1" })).toHaveLength(0);
  });

  it("ignores preseason and postseason rows", () => {
    expect(toSnapRows([snap({ game_type: "POST" })], 2026, { PlayA00: "00-1" })).toHaveLength(0);
  });
});

describe("mergeOverlay", () => {
  it("writes depth_rank: null for a player who is off the chart", () => {
    // Load-bearing: isProjectable() reads null as "do not project him". Writing
    // the field only when a rank exists would leave a stale rank underneath and
    // defeat the whole refresh.
    const { players } = mergeOverlay(toRosterRows([roster()]), {}, 2026, {});
    expect(players[0].depth_rank).toBe(null);
    expect(players[0].depth_pos).toBe(null);
  });

  it("merges the chart onto the roster row", () => {
    const { players, meta } = mergeOverlay(
      toRosterRows([roster()]), toDepthRows([chart()]), 2026, { fetched_at: "t" });
    expect(players[0]).toMatchObject({ team_abbr: "NE", depth_rank: 2, depth_pos: "WR" });
    expect(meta).toMatchObject({ season: 2026, players: 1, fetched_at: "t" });
  });
});
