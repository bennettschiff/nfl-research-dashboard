// ── The depth layer and the promotion path ───────────────────────────────────
// Pins the two things that decide whether a depth-charted backup has a board row
// at all, and what number is on it. Both are measured in
// scripts/screen_backup_baseline.mjs — if a constant here changes, re-run that
// harness and bump src/modelVersions.js in the same commit.
import { describe, it, expect } from "vitest";
import { blendPlayerSeason, isProjectable, roleBaselineFor, playRateFor, roleWeight, DEPTH } from "./playerPriors.js";
import { promoteDepthRooms, isPromoted } from "./depthPromotion.js";
import { baselineTrust, confidenceOf } from "./confidence.js";
import { hasRole } from "./roster.js";

const rb = (over = {}) => ({
  player_id: "p1", season: 2026, position: "RB", team_abbr: "SEA",
  prior_season: 2025, prior_team: "SEA", changed_team: false,
  prior_source: "prior-season", games: 5, depth_pos: "RB", depth_rank: 2,
  carries_pg: 2.2, targets_pg: 0.2, ypc: 4.0, ypt: 6.0,
  ...over,
});
const qb = (over = {}) => ({
  player_id: "q1", season: 2026, position: "QB", team_abbr: "SEA",
  prior_season: 2025, prior_team: "SEA", changed_team: false,
  prior_source: "prior-season", games: 8, depth_pos: "QB", depth_rank: 2,
  pass_att_pg: 1.0, ypa: 6.5, carries_pg: 2.0,
  ...over,
});

describe("the play rate the table publishes", () => {

  it("falls back to the deepest measured cell rather than to nothing", () => {
    // A WR9 is the same marginal role as a WR6, and dropping him is the exact
    // behaviour the role path exists to end.
    expect(playRateFor(2026, "WR", 9)).toBe(playRateFor(2026, "WR", 6));
  });

  it("is null off the chart — every caller treats that as no information", () => {
    expect(playRateFor(2026, "RB", null)).toBe(null);
    const off = blendPlayerSeason(rb({ depth_rank: null }), null);
    expect(off.carries_pg).toBe(2.2);
  });
});

describe("the depth layer on a carried baseline", () => {

  it("lifts a thin baseline toward the slot his club now lists him in", () => {
    // George Holani: 2.2 carries a game as Seattle's RB4 in 2025, charted RB2 in
    // 2026. His own five games are real but thin; the RB2 slot is worth 6.9.
    const row = blendPlayerSeason(rb(), null);
    expect(row.carries_pg).toBeGreaterThan(4);
    expect(hasRole(row, "board")).toBe(true);
    expect(isProjectable(row)).toBe(true);
  });

  it("weights his own rate by the games behind it, not by a flat constant", () => {
    // The same rate with more evidence behind it must move less. A flat weight
    // is what cost the market fold receiving Brier and rushing accuracy.
    const thin = blendPlayerSeason(rb({ games: 3 }), null);
    const thick = blendPlayerSeason(rb({ games: 17 }), null);
    expect(thin.carries_pg).toBeGreaterThan(thick.carries_pg);
    expect(roleWeight(3)).toBeLessThan(roleWeight(17));
    expect(roleWeight(0)).toBe(0);
  });

  it("shrinks toward the slot but never regresses what the model already does", () => {
    // pass_att_pg is regressed toward the league mean by PASS_ATT_SHRINK_K
    // downstream; shrinking it here too is the double-shrink this file's header
    // warns about, and it cost pass_yards 0.8 of MAE when it was in.
    const p = qb({ depth_rank: 1, games: 16, pass_att_pg: 40 });
    const row = blendPlayerSeason(p, null);
    const cell = roleBaselineFor(2026, "QB", 1);
    expect(row.pass_att_pg).toBeCloseTo(40 * cell.play_rate, 5);
  });

  it("does not touch a rate that is already unconditional", () => {
    // ypc is yards PER CARRY. Multiplying it by a play rate is a unit error.
    const row = blendPlayerSeason(rb({ depth_rank: 4 }), null);
    expect(row.ypc).toBe(4.0);
  });

  it("is the identity on a role-average prior, which already IS the slot", () => {
    const rookie = { player_id: "r1", season: 2026, position: "WR", team_abbr: "SEA",
      prior_source: "rookie", depth_pos: "WR", depth_rank: 3 };
    const cell = roleBaselineFor(2026, "WR", 3);
    const row = blendPlayerSeason(rookie, null);
    expect(row._carryover.prior_source).toBe("role-average");
    // Scaled by the play rate, but NOT shrunk toward itself a second time.
    expect(row.targets_pg).toBeCloseTo(cell.targets_pg * cell.play_rate, 5);
  });
});

describe("promotion", () => {
  const room = (over = {}) => {
    const starter = blendPlayerSeason(qb({ player_id: "starter", depth_rank: 1, games: 16, pass_att_pg: 30 }), null);
    const backup = blendPlayerSeason(qb({ player_id: "backup", depth_rank: 2, ...over }), null);
    return [starter, backup];
  };

  it("does nothing while the starter is healthy", () => {
    const out = promoteDepthRooms(room(), { isOut: () => false });
    expect(out.some(isPromoted)).toBe(false);
    // ...and the healthy backup stays off the board, which is the measured
    // answer: a charted QB2 whose starter plays throws 1.9 passes a game.
    expect(out.find((r) => r.player_id === "backup").pass_att_pg).toBeLessThan(5);
    expect(isProjectable(out.find((r) => r.player_id === "backup"))).toBe(false);
  });

  it("hands the job over when every man above him is ruled out", () => {
    const out = promoteDepthRooms(room(), { isOut: (id) => id === "starter" });
    const b = out.find((r) => r.player_id === "backup");
    expect(isPromoted(b)).toBe(true);
    expect(b._carryover.promoted_from).toBe("starter");
    // The vacated starter's attempts exactly — not his own 1.0, and not the
    // QB2 cell's 12.6.
    const starter = out.find((r) => r.player_id === "starter");
    expect(b.pass_att_pg).toBe(starter.pass_att_pg);
    expect(b.pass_att_pg).toBeGreaterThan(20);
    expect(hasRole(b, "board")).toBe(true);
    expect(isProjectable(b)).toBe(true);
  });

  it("promotes exactly one man, not the whole room", () => {
    const three = [
      blendPlayerSeason(qb({ player_id: "q1", depth_rank: 1, games: 16, pass_att_pg: 30 }), null),
      blendPlayerSeason(qb({ player_id: "q2", depth_rank: 2 }), null),
      blendPlayerSeason(qb({ player_id: "q3", depth_rank: 3 }), null),
    ];
    const out = promoteDepthRooms(three, { isOut: (id) => id === "q1" });
    expect(out.filter(isPromoted).map((r) => r.player_id)).toEqual(["q2"]);
  });

  it("promotes the QB3 when both men above him are out", () => {
    const three = [
      blendPlayerSeason(qb({ player_id: "q1", depth_rank: 1, games: 16, pass_att_pg: 30 }), null),
      blendPlayerSeason(qb({ player_id: "q2", depth_rank: 2 }), null),
      blendPlayerSeason(qb({ player_id: "q3", depth_rank: 3 }), null),
    ];
    const out = promoteDepthRooms(three, { isOut: (id) => id === "q1" || id === "q2" });
    expect(out.filter(isPromoted).map((r) => r.player_id)).toEqual(["q3"]);
  });

  it("does not promote a man who is himself ruled out", () => {
    const out = promoteDepthRooms(room(), { isOut: () => true });
    expect(out.some(isPromoted)).toBe(false);
  });

  it("takes the volume but not the efficiency or the legs", () => {
    const out = promoteDepthRooms(room({ ypa: 5.1, carries_pg: 6.0 }), { isOut: (id) => id === "starter" });
    const b = out.find((r) => r.player_id === "backup");
    expect(b.ypa).toBe(5.1);                     // his arm is his own
    // His rushing is his own too, merely un-discounted: a charted QB2's carries
    // were scaled by the 28% of weeks he plays, and this week he plays. It keeps
    // the role shrinkage it got at rank 2 — see promote()'s note.
    const before = room({ ypa: 5.1, carries_pg: 6.0 }).find((r) => r.player_id === "backup");
    expect(b.carries_pg).toBeGreaterThan(before.carries_pg * 3);
    expect(b.carries_pg).toBeGreaterThan(4);
  });

  it("never mutates the rows it was handed", () => {
    const rows = room();
    const before = rows.map((r) => r.pass_att_pg);
    promoteDepthRooms(rows, { isOut: (id) => id === "starter" });
    expect(rows.map((r) => r.pass_att_pg)).toEqual(before);
  });

  it("only promotes quarterbacks — every other room is redistribution", () => {
    // A vacated WR2 gains 43%, not 1,360%, and it lands on men who already have
    // a board row. That is vacancyMult's territory and vacancyMult is measured
    // and off (see VACATE_DAMP in models.js).
    const backs = [
      blendPlayerSeason(rb({ player_id: "rb1", depth_rank: 1, games: 16, carries_pg: 15 }), null),
      blendPlayerSeason(rb({ player_id: "rb2", depth_rank: 2 }), null),
    ];
    const out = promoteDepthRooms(backs, { isOut: (id) => id === "rb1" });
    expect(out.some(isPromoted)).toBe(false);
  });
});

describe("a promoted row says what it is", () => {
  const promotedC = { promoted_from: "starter", promoted_rank: 2, depth_pos: "QB", live_weight: 0, play_rate: 1 };

  it("ranks below every other provenance the board carries", () => {
    expect(baselineTrust(promotedC))
      .toBeLessThan(baselineTrust({ prior_source: "role-average", live_weight: 0, depth_rank: 2 }));
    expect(baselineTrust(promotedC))
      .toBeLessThan(baselineTrust({ prior_source: "prior-season", live_weight: 0 }));
  });

  it("cannot wear a HIGH badge no matter how far the edge is from a coin flip", () => {
    const plain = confidenceOf({ prob: 0.95, carryover: { prior_source: "prior-season", live_weight: 1 } });
    expect(plain.tier).toBe("high");
    const promoted = confidenceOf({ prob: 0.95, carryover: promotedC });
    expect(promoted.tier).toBe("medium");
    expect(promoted.capped).toBe(true);          // a real demotion, so the UI marks it
  });

  it("discounts a row that only exists because of a play rate", () => {
    const deep = { prior_source: "prior-season", live_weight: 0, depth_rank: 4, play_rate: 0.13 };
    const full = { prior_source: "prior-season", live_weight: 0, depth_rank: 4, play_rate: 1 };
    expect(baselineTrust(deep)).toBeLessThan(baselineTrust(full));
    // and a MISSING play rate is not a penalty — it is no information, so it
    // must land exactly where a full one does.
    expect(baselineTrust({ prior_source: "prior-season", live_weight: 0, depth_rank: 4 }))
      .toBe(baselineTrust(full));
  });
});

describe("DEPTH constants stay in step with the harness", () => {
  it("keeps ROLE_K where scripts/screen_backup_baseline.mjs put it", () => {
    expect(DEPTH.ROLE_K).toBe(6);
  });
});

describe("a charted QB1 carrying a backup's attempts", () => {
  const cell = roleBaselineFor(2026, "QB", 1);
  const row = (over) => ({ ...qb({ depth_rank: 1, pass_att_pg: 8.5 }), _carryover: { depth_rank: 1, depth_pos: "QB", live_games: 0, ...over } });

  it("takes the QB1 cell's attempts, and says so", () => {
    const [out] = promoteDepthRooms([row()], { isOut: () => false, qb1Cell: cell });
    expect(out.pass_att_pg).toBe(cell.pass_att_pg);
    expect(out._carryover.retargeted_att).toBe(8.5);
    expect(out.ypa).toBe(6.5);                       // efficiency stays his own
    expect(isPromoted(out)).toBe(false);
  });
  it("leaves a real starter, a starter with three live games, or a missing cell alone", () => {
    const starter = { ...row(), pass_att_pg: 31 };
    expect(promoteDepthRooms([starter], { isOut: () => false, qb1Cell: cell })[0]).toBe(starter);
    const played = row({ live_games: 3 });
    expect(promoteDepthRooms([played], { isOut: () => false, qb1Cell: cell })[0]).toBe(played);
    const r = row();
    expect(promoteDepthRooms([r], { isOut: () => false })[0]).toBe(r);
  });
});
