import { describe, it, expect } from "vitest";
import { archivableGames } from "./prune_live_odds.mjs";

// Run on Tue 2026-10-13, the prune's own slot: the archive cutoff is Mon
// 2026-10-12, the window floor 2026-09-14.
const TODAY = "2026-10-13";
const g = (game_id, gameday) => ({ game_id, gameday });

describe("archivableGames", () => {
  it("takes the week through Sunday and holds Monday night", () => {
    const games = [g("thu", "2026-10-08"), g("sun", "2026-10-11"), g("mnf", "2026-10-12"), g("next", "2026-10-15")];
    expect(archivableGames(games, [], TODAY)).toEqual(["sun", "thu"]);
  });

  it("never archives a game that still has a pending pick, however old", () => {
    const games = [g("graded", "2026-10-11"), g("stuck", "2026-09-20")];
    expect(archivableGames(games, ["stuck"], TODAY)).toEqual(["graded"]);
  });

  it("probes only the window before the cutoff unless asked for more", () => {
    const games = [g("old", "2026-09-13"), g("inside", "2026-09-14")];
    expect(archivableGames(games, [], TODAY)).toEqual(["inside"]);
    expect(archivableGames(games, [], TODAY, { windowDays: 120 })).toEqual(["inside", "old"]);
  });

  it("honours a longer hold when one is asked for", () => {
    const games = [g("sun", "2026-10-11"), g("wk3", "2026-09-28")];
    expect(archivableGames(games, [], TODAY, { archiveDays: 14 })).toEqual(["wk3"]);
  });

  it("skips a game with no gameday rather than treating it as ancient", () => {
    expect(archivableGames([g("tbd", null)], [], TODAY)).toEqual([]);
  });
});
