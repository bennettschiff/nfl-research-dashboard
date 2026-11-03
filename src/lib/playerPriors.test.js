// ── Player carryover / season-flip tests ─────────────────────────────────────
// The carryover path is otherwise unexercised until September, so these pin the
// behaviour the 2026 Week-1 board depends on. Constants come from
// scripts/calibrate_player_carryover.mjs — if one changes, re-run that harness
// and update the golden in the same commit.
import { describe, it, expect } from "vitest";
import { blendPlayerSeason, isProjectable, CARRYOVER, SCORING_CARRYOVER, roleBaselineFor, DEPTH, roleWeight } from "./playerPriors.js";
import { defaultWeek } from "./roster.js";
import { projectPlayer } from "./models.js";

const near = (a, b, eps = 1e-3) => expect(Math.abs(a - b)).toBeLessThan(eps);

// A prior-season WR: 100 targets over 16 games, 8.0 yd/tgt.
const wrPrior = (over = {}) => ({
  player_id: "p1", season: 2026, position: "WR", team_abbr: "KC",
  prior_season: 2025, prior_team: "KC", changed_team: false,
  prior_source: "prior-season", seasons_stale: 0,
  games: 16, targets_pg: 6.25, ypt: 8.0, targets: 100, catch_rate: 0.65,
  rec_yards_pg: 50, carries_pg: 0, ...over,
});

describe("cold start (no live games)", () => {
  it("carries prior VOLUME at face value — the measured trust is 1.0", () => {
    const r = blendPlayerSeason(wrPrior(), null);
    near(r.targets_pg, 6.25);
    expect(CARRYOVER.targets_pg.trust).toBe(1.0);
  });

  it("reports the 2026 team, not where the player finished last season", () => {
    const r = blendPlayerSeason(wrPrior({ team_abbr: "BUF", prior_team: "KC", changed_team: true }), null);
    expect(r.team_abbr).toBe("BUF");
    expect(r._carryover.prior_team).toBe("KC");
    expect(r._carryover.changed_team).toBe(true);
  });

  it("hands efficiency a DISCOUNTED sample, not the prior's real event count", () => {
    const r = blendPlayerSeason(wrPrior(), null);
    // A prior season's ypt is worth ~7.5 targets however many he actually had.
    near(r._effN.ypt, 7.5);
    expect(r._effN.ypt).toBeLessThan(wrPrior().targets);
  });

  it("reproduces the fitted cold-start trust through the model's own shrinkage", () => {
    // a = n/(n+K) with the shipped YPT_SHRINK_K = 30 must equal the fitted 0.20.
    const a = 7.5 / (7.5 + 30);
    near(a, CARRYOVER.ypt.trust, 1e-9);
  });

  it("keeps pass-attempt shrinkage ON at zero games", () => {
    // shrinkRate returns the raw rate when n=0, so without an effective sample
    // the largest shipped model win would silently switch off at week 1.
    const qb = blendPlayerSeason({
      player_id: "q1", season: 2026, position: "QB", team_abbr: "NYJ",
      prior_source: "prior-season", changed_team: false, prior_team: "NYJ",
      games: 17, pass_att_pg: 40.0, ypa: 7.5, pass_att: 680, carries_pg: 2,
    }, null);
    near(qb._effN.pass_att_pg, 4);
    near(4 / (4 + 6), CARRYOVER.pass_att_pg.trust, 1e-9);
  });
});

describe("in-season weaning", () => {
  const live = (games, over = {}) => ({
    player_id: "p1", season: 2026, position: "WR", team_abbr: "KC",
    games, targets_pg: 10.0, ypt: 10.0, ...over,
  });

  it("moves toward live data at the fitted rate for a player who stayed", () => {
    // kSame = 2 → after 2 games the live weight is exactly 1/2.
    const r = blendPlayerSeason(wrPrior(), live(2));
    near(r.targets_pg, 0.5 * 10.0 + 0.5 * 6.25);
  });

  it("weans a player who CHANGED TEAMS about 4x faster", () => {
    const stayed = blendPlayerSeason(wrPrior(), live(2));
    const moved = blendPlayerSeason(wrPrior({ team_abbr: "BUF", changed_team: true }), live(2, { team_abbr: "BUF" }));
    // kMoved = 0.5 → live weight 0.8 vs 0.5.
    near(moved.targets_pg, 0.8 * 10.0 + 0.2 * 6.25);
    expect(moved.targets_pg).toBeGreaterThan(stayed.targets_pg);
  });

  it("grows the efficiency sample as live evidence accrues", () => {
    const r = blendPlayerSeason(wrPrior(), live(4));
    // 7.5 prior-equivalent targets + 4 games x 10 targets.
    near(r._effN.ypt, 7.5 + 40);
  });

  it("converges on live data late in the season", () => {
    const r = blendPlayerSeason(wrPrior(), live(16));
    expect(r.targets_pg).toBeGreaterThan(9.5); // 16/(16+2) = 89% live
  });
});

describe("provenance and refusal to invent a baseline", () => {
  it("does not project a rookie with no live games", () => {
    expect(blendPlayerSeason({ player_id: "r1", prior_source: "rookie", team_abbr: "CHI", season: 2026 }, null)).toBe(null);
  });

  it("projects a rookie once he has played", () => {
    const r = blendPlayerSeason(
      { player_id: "r1", prior_source: "rookie", team_abbr: "CHI", season: 2026 },
      { player_id: "r1", games: 4, targets_pg: 5, ypt: 8, position: "WR" });
    expect(r).not.toBe(null);
    expect(r._carryover.prior_source).toBe("rookie");
  });

  it("weans a STALE prior on the fast schedule — it describes a role he lost", () => {
    const stale = blendPlayerSeason(
      wrPrior({ prior_source: "stale-prior", prior_season: 2023, seasons_stale: 2 }),
      { player_id: "p1", games: 2, targets_pg: 10.0, ypt: 10.0, position: "WR" });
    near(stale.targets_pg, 0.8 * 10.0 + 0.2 * 6.25); // kMoved, not kSame
  });

  it("tags every row with where its baseline came from", () => {
    expect(blendPlayerSeason(wrPrior(), null)._carryover.prior_source).toBe("prior-season");
  });

  it("returns null only when there is nothing at all", () => {
    expect(blendPlayerSeason(null, null)).toBe(null);
  });
});

describe("isProjectable", () => {
  it("keeps the pre-flip games>=3 gate for rows with no carryover", () => {
    expect(isProjectable({ games: 2 })).toBe(false);
    expect(isProjectable({ games: 3 })).toBe(true);
    expect(isProjectable(null)).toBe(false);
  });

  it("accepts a real prior season at zero games — the gate is unsatisfiable at a flip", () => {
    expect(isProjectable(blendPlayerSeason(wrPrior({ depth_rank: 1, depth_pos: "WR" }), null))).toBe(true);
  });

  it("still requires live games for a rookie", () => {
    const r = blendPlayerSeason(
      { player_id: "r1", prior_source: "rookie", team_abbr: "CHI", season: 2026 },
      { player_id: "r1", games: 2, targets_pg: 5, ypt: 8, position: "WR" });
    expect(isProjectable(r)).toBe(false);
  });

  it("drops a player who is not on the current depth chart at all", () => {
    expect(isProjectable(blendPlayerSeason(wrPrior({ depth_rank: null }), null))).toBe(false);
  });

  const qb = (rank, live = null) => blendPlayerSeason({
    player_id: "q1", season: 2026, position: "QB", team_abbr: "KC",
    prior_source: "prior-season", changed_team: false, prior_team: "KC",
    games: 17, pass_att_pg: 34, ypa: 7.2, pass_att: 578, carries_pg: 2,
    depth_rank: rank, depth_pos: "QB",
  }, live);

  it("projects only QB1 before any snaps are played", () => {
    expect(isProjectable(qb(1))).toBe(true);
    // The specific failure this fixes: backup QBs on the week-1 board.
    expect(isProjectable(qb(2))).toBe(false);
    expect(isProjectable(qb(3))).toBe(false);
  });

  it("lets live snaps override the depth chart — if he is playing, he is projectable", () => {
    const backupWhoIsPlaying = qb(2, {
      player_id: "q1", games: 4, pass_att_pg: 33, ypa: 7.0, position: "QB",
    });
    expect(isProjectable(backupWhoIsPlaying)).toBe(true);
  });

  it("does not gate non-QBs on depth rank — snaps there are shared", () => {
    expect(isProjectable(blendPlayerSeason(wrPrior({ depth_rank: 4, depth_pos: "WR" }), null))).toBe(true);
  });

  it("carries depth rank through for the UI to surface", () => {
    const r = blendPlayerSeason(wrPrior({ depth_rank: 4, depth_pos: "SWR" }), null);
    expect(r._carryover.depth_rank).toBe(4);
    expect(r._carryover.depth_pos).toBe("SWR");
  });
});

describe("the role cell follows the CHART SLOT, not the roster group", () => {
  // A fullback's roster position group is RB, so looking the cell up by group
  // gave FB1 the RUNNING BACK 1 cell: 14.49 carries a game against the FB1
  // cell's 0.185, and a TD rate of 0.582 against 0.074. The FB cells are built
  // from 163 player-seasons and were simply unreachable.
  const fb = (over = {}) => ({
    player_id: "fb1", season: 2026, position: "RB", team_abbr: "SF",
    prior_source: "rookie", depth_rank: 1, depth_pos: "FB", ...over,
  });

  it("gives a charted FB1 a fullback's baseline, not a feature back's", () => {
    const r = blendPlayerSeason(fb(), null);
    expect(r).not.toBeNull();
    // A real FB1 carries it well under once a game. The RB1 cell is 14.49.
    expect(r.carries_pg).toBeLessThan(1);
    expect(r.total_td_pg).toBeLessThan(0.1);
  });

  it("falls back to the roster group when the table has no cell for the slot", () => {
    // SWR/LWR and the like are real chart slots with no cell of their own; a
    // receiver listed there must still get a WR cell rather than nothing.
    const wr = blendPlayerSeason({
      player_id: "w1", season: 2026, position: "WR", team_abbr: "SF",
      prior_source: "rookie", depth_rank: 2, depth_pos: "SWR",
    }, null);
    expect(wr).not.toBeNull();
    expect(wr.targets_pg).toBeGreaterThan(0);
  });

  it("is unchanged when the slot and the roster group agree", () => {
    const a = blendPlayerSeason(fb({ position: "RB", depth_pos: "RB" }), null);
    const b = blendPlayerSeason(fb({ position: "RB", depth_pos: undefined }), null);
    expect(a.carries_pg).toBeCloseTo(b.carries_pg, 6);
    expect(a.carries_pg).toBeGreaterThan(10);   // this one really is an RB1
  });
});

describe("a ypa prior cannot assert more evidence than it was built on", () => {
  // Malik Willis's real numbers. 2025 Green Bay: 35 attempts across four
  // appearances, two of them a single throw in garbage time, 12.06 y/a. 2026
  // Miami, charted QB1, one real start: 27 attempts, 220 yards, 8.15 y/a.
  const thin = (over = {}) => ({
    player_id: "mw", season: 2026, position: "QB", team_abbr: "MIA",
    prior_source: "prior-season", changed_team: true, prior_team: "GB",
    games: 4, pass_att_pg: 8.75, ypa: 12.06, pass_att: 35, carries_pg: 5.5,
    depth_rank: 1, depth_pos: "QB", ...over,
  });
  const live = { player_id: "mw", games: 1, pass_att_pg: 27, ypa: 8.15, position: "QB" };

  it("weans a thin prior on ATTEMPTS, not on games", () => {
    const r = blendPlayerSeason(thin(), live);
    // Attempt-pooled: the prior is worth min(effN 45, its own 35) = 35 against
    // 27 live attempts, so the live start carries 27/62 = 44% of the number.
    expect(r.ypa).toBeCloseTo((35 * 12.06 + 27 * 8.15) / 62, 2);
    // The games schedule (kMoved 8, one live game) would have given that one
    // real start 1/9 = 11% and left the number up at 11.63.
    expect(r.ypa).toBeLessThan(11);
    expect(r._effN.ypa).toBeCloseTo(35 + 27, 2);
  });

  it("is the identity for a full prior season", () => {
    // 578 attempts is more than effN, so the prior is worth its fitted 45 and
    // nothing about a normal starter moves.
    const full = thin({ games: 17, pass_att_pg: 34, ypa: 7.2, pass_att: 578, changed_team: false, prior_team: "MIA" });
    const r = blendPlayerSeason(full, { player_id: "mw", games: 1, pass_att_pg: 30, ypa: 7.4, position: "QB" });
    expect(r._effN.ypa).toBeCloseTo(45 + 30, 2);
    expect(r.ypa).toBeCloseTo((45 * 7.2 + 30 * 7.4) / 75, 2);
  });

  it("pools catch_rate on targets instead of discarding the prior", () => {
    // Ja'Marr Chase's real numbers. 2025: 185 targets at .676. 2026 week 1: 2
    // catches on 4 targets. Before this, catch_rate had no CARRYOVER entry at
    // all, so the blended row simply kept the live value — four targets said
    // .500 and put the model UNDER his receptions line.
    const wr = {
      player_id: "jc", season: 2026, position: "WR", team_abbr: "CIN",
      prior_source: "prior-season", changed_team: false, prior_team: "CIN",
      games: 17, targets_pg: 10.9, targets: 185, catch_rate: 0.676, ypt: 9.1,
      depth_rank: 1, depth_pos: "WR",
    };
    const r = blendPlayerSeason(wr, {
      player_id: "jc", games: 1, targets_pg: 4, catch_rate: 0.5, ypt: 8, position: "WR",
    });
    // Prior worth min(effN 80, its own 185) = 80 targets against 4 live.
    expect(r.catch_rate).toBeCloseTo((80 * 0.676 + 4 * 0.5) / 84, 3);
    expect(r.catch_rate).toBeGreaterThan(0.66);
    expect(r._effN.catch_rate).toBeCloseTo(84, 2);
  });

  it("pools comp_pct on attempts", () => {
    const qbRow = {
      player_id: "qb9", season: 2026, position: "QB", team_abbr: "KC",
      prior_source: "prior-season", changed_team: false, prior_team: "KC",
      games: 17, pass_att_pg: 34, pass_att: 578, ypa: 7.2, comp_pct: 0.67,
      depth_rank: 1, depth_pos: "QB",
    };
    const r = blendPlayerSeason(qbRow, {
      player_id: "qb9", games: 1, pass_att_pg: 30, ypa: 7.4, comp_pct: 0.40, position: "QB",
    });
    expect(r.comp_pct).toBeCloseTo((120 * 0.67 + 30 * 0.40) / 150, 3);
    expect(r._effN.comp_pct).toBeCloseTo(150, 2);
  });

  it("falls back to the fitted worth when the prior carries no attempt total", () => {
    // Role-average priors and older artifacts have no `pass_att`; the previous
    // behaviour is what they must keep.
    const r = blendPlayerSeason(thin({ pass_att: undefined }), live);
    expect(r._effN.ypa).toBeCloseTo(45 + 27, 2);
  });
});

describe("defaultWeek", () => {
  const g = (week, gameday) => ({ week, gameday });

  it("opens on the first week that has not finished", () => {
    const games = [g(1, "2026-09-13"), g(2, "2026-09-20"), g(3, "2026-09-27")];
    expect(defaultWeek(games, new Date("2026-09-16T12:00:00Z"))).toBe(2);
  });

  it("opens on week 1 for a schedule where nothing has been played", () => {
    const games = [g(1, "2026-09-13"), g(2, "2026-09-20")];
    expect(defaultWeek(games, new Date("2026-08-09T12:00:00Z"))).toBe(1);
    // The bug this replaces: last-week-of-schedule opened four months early.
    expect(defaultWeek(games, new Date("2026-08-09T12:00:00Z"))).not.toBe(2);
  });

  it("falls back to the last week once the season is over", () => {
    const games = [g(1, "2025-09-07"), g(2, "2025-09-14")];
    expect(defaultWeek(games, new Date("2026-01-01T12:00:00Z"))).toBe(2);
  });

  it("handles an empty schedule", () => {
    expect(defaultWeek([], new Date("2026-09-01T12:00:00Z"))).toBe(1);
  });
});

describe("end to end: a carried-over row projects", () => {
  const game = { season: 2026, week: 1, home_team: "KC", away_team: "BUF",
    spread_line: -2.5, total_line: 47, home_implied: 24.75, away_implied: 22.25 };

  it("produces a receiving projection at week 1 with no live games", () => {
    const season = blendPlayerSeason(wrPrior(), null);
    const props = projectPlayer({
      player: { full_name: "Test WR" }, season, splits: null,
      teamOff: null, oppOff: null, oppDef: null, recent: null,
      game, side: "home",
    });
    const rec = props.find((p) => p.prop_type === "rec_yards");
    expect(rec).toBeTruthy();
    expect(rec.proj_mean).toBeGreaterThan(0);
    // ypt is pulled toward league because the prior carries only 7.5 targets of
    // evidence — it must NOT come through at the raw 8.0.
    expect(rec.factors.baseYpt).toBeLessThan(8.0);
    expect(rec.factors.baseYpt).toBeGreaterThan(7.5);
  });

});

// ── Role-average baselines: the rookie who is actually starting ──────────────
// blendPlayerSeason used to return null for a rookie with no snaps, which meant
// 53 rookies sat ACTIVE in their club's top three on the 2026 week-1 board and
// none of them appeared — including two listed RB1, while the backs behind them
// were projected. These pin the path that ended that.
describe("roleBaselineFor", () => {
  it("returns the measured cell for a position and rank", () => {
    const rb1 = roleBaselineFor(2026, "RB", 1);
    const rb2 = roleBaselineFor(2026, "RB", 2);
    expect(rb1.carries_pg).toBeGreaterThan(rb2.carries_pg);   // the ladder is monotone
    expect(rb1.position).toBe("RB");
  });

  it("falls back to the deepest measured cell rather than to nothing", () => {
    // A WR8 is not a different kind of player from a WR6, he is the same
    // marginal role — and the alternative is dropping him off the board.
    const deep = roleBaselineFor(2026, "WR", 12);
    expect(deep).not.toBe(null);
    expect(deep.targets_pg).toBeLessThan(roleBaselineFor(2026, "WR", 1).targets_pg);
  });

  it("has nothing to say without a rank, a position, or a known season", () => {
    expect(roleBaselineFor(2026, "RB", null)).toBe(null);
    expect(roleBaselineFor(2026, null, 1)).toBe(null);
    expect(roleBaselineFor(2025, "RB", 1)).toBe(null);
  });
});

describe("blendPlayerSeason — rookies", () => {
  const rookie = (over = {}) => ({
    player_id: "00-r", season: 2026, position: "RB", prior_source: "rookie",
    player_name: "A Rookie", depth_rank: 1, depth_pos: "RB", team_abbr: "SEA", ...over,
  });

  it("projects a charted rookie off what his ROLE is worth", () => {
    const row = blendPlayerSeason(rookie(), null);
    expect(row).not.toBe(null);
    expect(row._carryover.prior_source).toBe("role-average");
    expect(row.carries_pg).toBeGreaterThan(10);      // an RB1's workload
    expect(isProjectable(row)).toBe(true);
  });

  it("still refuses to project a rookie who is on no depth chart", () => {
    // The original judgement, preserved exactly where it was right: with no rank
    // there is genuinely no evidence, and inventing one would put every
    // practice-squad body on the board.
    const row = blendPlayerSeason(rookie({ depth_rank: null, depth_pos: null }), null);
    expect(row).toBe(null);
  });

  it("weans a role average onto live data on the FAST schedule", () => {
    // It describes a slot, not a man, so his own snaps must displace it quickly.
    const live = { games: 2, carries_pg: 4, targets_pg: 1, position: "RB", team_abbr: "SEA" };
    const row = blendPlayerSeason(rookie(), live);
    expect(row._carryover.changed_team).toBe(true);   // `moved` → kMoved, not kSame
    expect(row.carries_pg).toBeLessThan(roleBaselineFor(2026, "RB", 1).carries_pg);
  });

  it("does not claim a prior team he never had", () => {
    expect(blendPlayerSeason(rookie(), null)._carryover.prior_team).toBe(null);
  });
});

describe("a charted rookie survives his own first game", () => {
  // Regression: converting to a role average only when there were no live games
  // meant a rookie who PLAYED in week 1 fell back to the rookie branch in week 2,
  // where isProjectable demands three games. He would appear on the board, take
  // 15 carries, and then disappear from it.
  const rookie = { player_id: "00-r", season: 2026, position: "RB", prior_source: "rookie",
    player_name: "A Rookie", depth_rank: 1, depth_pos: "RB", team_abbr: "SEA" };

  it("stays projectable after one live game", () => {
    const row = blendPlayerSeason(rookie, { games: 1, carries_pg: 15, targets_pg: 2, position: "RB", team_abbr: "SEA" });
    expect(row._carryover.prior_source).toBe("role-average");
    expect(isProjectable(row)).toBe(true);
  });

  it("leans on his own game rather than the role average", () => {
    const role = roleBaselineFor(2026, "RB", 1).carries_pg;
    const row = blendPlayerSeason(rookie, { games: 1, carries_pg: 22, targets_pg: 2, position: "RB", team_abbr: "SEA" });
    expect(row.carries_pg).toBeGreaterThan(role);          // 22 pulls it up
    expect(row._carryover.live_weight).toBeGreaterThan(0.5); // fast schedule
  });
});

// ── the scoring role across the break ────────────────────────────────────────
// The 2026 week-1 failure these pin: blendPlayerSeason carried volume and
// efficiency and dropped the TD rate and the red-zone role, so anytimeTdLambda
// had nothing player-specific left and λ reduced to a function of the game's
// implied total. Two backs in the same room came out identical.
describe("scoring role carries across a season break", () => {
  const rbPrior = (over = {}) => ({
    player_id: "rb1", season: 2026, position: "RB", team_abbr: "LAC",
    prior_season: 2025, prior_team: "LAC", changed_team: false,
    prior_source: "prior-season", seasons_stale: 0, depth_rank: 1, depth_pos: "RB",
    games: 9, carries_pg: 13.78, targets_pg: 3.89, ypc: 4.4, ypt: 5.49,
    rush_td_pg: 0.444, rec_td_pg: 0.111, total_td_pg: 0.556,
    rz_carries_pg: 2.89, rz_targets_pg: 0.22, gl_carries_pg: 0.89, gl_targets_pg: 0.11,
    ...over,
  });

  // Pinned with the depth layer OFF, because that is what this block is about:
  // whether the scoring role survives the season break at all. The depth layer
  // then moves every one of these numbers by a couple of percent for an RB1 (it
  // shrinks him halfway toward the RB1 cell and scales by a 98% play rate), and
  // it has its own block below.
  it("carries the TD rate and the red-zone role at zero live games", () => {
    const r = blendPlayerSeason(rbPrior(), null, { noDepth: true });
    near(r.total_td_pg, 0.556);
    near(r.gl_carries_pg, 0.89);
    near(r.rz_carries_pg, 2.89);
  });

  it("still carries them with the depth layer on, composed the way DEPTH says", () => {
    const r = blendPlayerSeason(rbPrior(), null);
    const cell = roleBaselineFor(2026, "RB", 1);
    // Not a magic number: the shipped value IS playRate x (W x his + (1-W) x his
    // slot's), with W earned from the games behind his prior. The test states the
    // formula rather than a constant that has to be re-derived every time the
    // table is rebuilt.
    for (const k of ["total_td_pg", "gl_carries_pg", "rz_carries_pg"]) {
      const w = roleWeight(rbPrior().games);
      const want = cell.play_rate * (w * rbPrior()[k] + (1 - w) * cell[k]);
      near(r[k], want);
      expect(r[k]).toBeGreaterThan(0);          // the role still crosses the break
    }
  });

  it("declares what the carried TD rate is WORTH rather than letting it pass as measured", () => {
    const r = blendPlayerSeason(rbPrior(), null);
    // Pseudo-games, not the prior's real game count: the rate is a small count
    // on a noisy process and ATD_PARAMS.RATE_K shrinks it against that number.
    near(r._effN.total_td_pg, SCORING_CARRYOVER.total_td_pg.effN);
    expect(r._effN.total_td_pg).toBeLessThan(rbPrior().games);
  });

  it("fades the prior's pseudo-games out as live games displace it", () => {
    const live = { position: "RB", team_abbr: "LAC", games: 8, carries_pg: 10, targets_pg: 2,
      total_td_pg: 0.25, rush_td_pg: 0.25, rec_td_pg: 0 };
    const r = blendPlayerSeason(rbPrior(), live);
    // 8 live games at kSame=4 is a 2/3 live weight, so a third of the prior's
    // worth remains — plus the eight games that are actually measured.
    const w = 8 / (8 + SCORING_CARRYOVER.total_td_pg.kSame);
    near(r._effN.total_td_pg, SCORING_CARRYOVER.total_td_pg.effN * (1 - w) + 8);
    expect(r._effN.total_td_pg).toBeGreaterThan(8);
  });

  it("tells two backs in the same room apart at week 1", () => {
    const game = { season: 2026, week: 1, home_team: "LAC", away_team: "ARI",
      home_implied: 29, away_implied: 20, total_line: 49, spread_line: -9 };
    const td = (prior) => {
      const props = projectPlayer({
        player: {}, season: blendPlayerSeason(prior, null), game, side: "home",
      });
      return props.find((p) => p.prop_type === "anytime_td")?.proj_mean;
    };
    // The RB1 who took the goal-line work against the RB3 who did not.
    const rb1 = td(rbPrior());
    const rb3 = td(rbPrior({
      player_id: "rb3", games: 13, carries_pg: 11.92, targets_pg: 1.69,
      rush_td_pg: 0.231, rec_td_pg: 0.077, total_td_pg: 0.308,
      rz_carries_pg: 2.17, rz_targets_pg: 0.5, gl_carries_pg: 0.58, gl_targets_pg: 0.06,
      depth_rank: 3,
    }));
    expect(rb1).toBeGreaterThan(rb3);
    // Not a rounding difference — before the carry these were bit-identical.
    expect(rb1 - rb3).toBeGreaterThan(0.05);
  });
});
