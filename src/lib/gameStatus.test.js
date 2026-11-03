import { describe, it, expect } from "vitest";
import { kickoffAt, gameStatus, GAME_WINDOW_MIN } from "./gameStatus.js";

// The 2026 opener: NE @ SEA, Wed 2026-09-09 8:20pm ET.
const opener = { gameday: "2026-09-09", gametime: "20:20" };

describe("kickoffAt", () => {
  it("reads gametime as US Eastern (EDT in September)", () => {
    expect(kickoffAt(opener).toISOString()).toBe("2026-09-10T00:20:00.000Z");
  });
  it("tracks the November DST change (EST)", () => {
    expect(kickoffAt({ gameday: "2026-11-15", gametime: "13:00" }).toISOString()).toBe("2026-11-15T18:00:00.000Z");
  });
  it("assumes the 1pm window when there is no time, and null with no date", () => {
    expect(kickoffAt({ gameday: "2026-09-13" }).toISOString()).toBe("2026-09-13T17:00:00.000Z");
    expect(kickoffAt({})).toBeNull();
  });
});

describe("gameStatus", () => {
  it("is upcoming before kickoff, live inside the window, final after it", () => {
    expect(gameStatus(opener, new Date("2026-09-10T00:19:00Z"))).toBe("upcoming");
    expect(gameStatus(opener, new Date("2026-09-10T03:30:00Z"))).toBe("live");
    const end = new Date(kickoffAt(opener).getTime() + GAME_WINDOW_MIN * 60000);
    expect(gameStatus(opener, end)).toBe("final");
  });
  it("calls the opener final by the following Saturday — the reported bug", () => {
    expect(gameStatus(opener, new Date("2026-09-12T16:00:00Z"))).toBe("final");
  });
  it("does not call a game final on its own calendar date in UTC", () => {
    // 11pm ET on game night is already the next day in UTC; the old
    // `gameday < today` check would have flipped it early.
    expect(gameStatus(opener, new Date("2026-09-10T03:00:00Z"))).toBe("live");
  });
  it("never marks an undated game played", () => {
    expect(gameStatus({}, new Date("2030-01-01T00:00:00Z"))).toBe("upcoming");
  });
});
