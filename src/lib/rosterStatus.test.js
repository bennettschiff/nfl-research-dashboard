// ── The roster overlay: the fast half of a player's identity ─────────────────
// The bug this whole module exists to prevent is silent and total — a player
// projected into the wrong team's game — so the tests pin the overlay's effect
// on the three fields that decide that, plus the failure mode that would be
// worse than the bug: a half-written artifact emptying the board.
import { describe, it, expect } from "vitest";
import { applyRosterStatus, rosterStatusFor, hasRosterStatus, depthContextFor } from "./rosterStatus.js";
import { playerPriorFor } from "./playerPriors.js";

const BOUTTE = "00-0038608";      // NE in the frozen priors, traded to HOU in August
const STEVENSON = "00-0036875";   // never moved

describe("the shipped overlay", () => {
  it("is healthy", () => {
    expect(hasRosterStatus(2026)).toBe(true);
    expect(hasRosterStatus(2025)).toBe(false);
  });

  it("moves a traded player to his real team", () => {
    // The regression that started all of this: the board spent week 1 showing
    // Boutte as a Patriot and projecting him into New England's target pool.
    expect(rosterStatusFor(2026, BOUTTE).team_abbr).toBe("HOU");
    expect(playerPriorFor(2026, BOUTTE).team_abbr).toBe("HOU");
  });

  it("recomputes changed_team against the LIVE team, not the frozen one", () => {
    // Not bookkeeping: changed_team selects the ~4x faster weaning schedule in
    // CARRYOVER. Boutte's carried rates describe a New England role; trusting
    // them at the same-team rate in Houston trusts them four times too long.
    const p = playerPriorFor(2026, BOUTTE);
    expect(p.prior_team).toBe("NE");
    expect(p.changed_team).toBe(true);
    expect(playerPriorFor(2026, STEVENSON).changed_team).toBe(false);
  });
});

describe("applyRosterStatus", () => {
  const prior = { player_id: "00-1", team_abbr: "NE", prior_team: "NE", position: "WR", depth_rank: 1 };

  it("never mutates the shared artifact row", () => {
    const before = { ...prior };
    applyRosterStatus(2026, prior);
    expect(prior).toEqual(before);
  });

  it("nulls the depth rank of a player who is on no roster", () => {
    // isProjectable() reads a null rank as "not playing". Leaving August's rank
    // in place for a man who has since been cut is the failure this prevents.
    const out = applyRosterStatus(2026, prior);
    expect(out.depth_rank).toBe(null);
    expect(out.off_roster).toBe(true);
  });

  it("passes the prior through untouched for a season with no overlay", () => {
    expect(applyRosterStatus(2025, prior)).toBe(prior);
  });
});

describe("depthContextFor", () => {
  it("supplies both ranks for a player the chart and the prior season both know", () => {
    const d = depthContextFor(2026, STEVENSON, 2025);
    expect(d.rank).toBeGreaterThan(0);
    expect(d.rankEarned).toBeGreaterThan(0);
  });

  it("refuses to compare against a season whose chart schema differs", () => {
    // nflverse rewrote the depth-chart format between 2024 and 2025: the old
    // file lists the top three at each position, the new one lists the whole
    // room. Differencing a 2024 rank against a 2026 one measures the schema
    // change, not a role change, so there must be no comparison at all.
    expect(depthContextFor(2026, STEVENSON, 2024).rankEarned).toBe(null);
    expect(depthContextFor(2026, STEVENSON, null).rankEarned).toBe(null);
  });
});
