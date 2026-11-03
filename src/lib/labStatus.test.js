import { describe, expect, it } from "vitest";
import { cronNext, nextRun } from "./labStatus.js";

// 2026-11-01 13:50 UTC — a Sunday
const AT = Date.parse("2026-11-01T13:50:00Z");

describe("cronNext", () => {
  it("fires later the same day", () => {
    expect(cronNext("7 14 * * *", AT)).toBe("2026-11-01T14:07:00.000Z");
  });
  it("rolls to the right weekday", () => {
    expect(cronNext("0 13 * * 5", AT)).toBe("2026-11-06T13:00:00.000Z");   // Friday
    expect(cronNext("0 19 * * 2-3", AT)).toBe("2026-11-03T19:00:00.000Z"); // Tuesday
  });
  it("is strictly after `from`", () => {
    expect(cronNext("50 13 * * *", AT)).toBe("2026-11-02T13:50:00.000Z");
  });
  it("handles steps and lists", () => {
    expect(cronNext("*/15 * * * *", AT)).toBe("2026-11-01T14:00:00.000Z");
    expect(cronNext("0 1,20 * * *", AT)).toBe("2026-11-01T20:00:00.000Z");
  });
});

describe("nextRun", () => {
  const schedule = [
    { cron: "7 14 * * *", kinds: ["odds", "model"], label: "board" },
    { cron: "23 22 * * *", kinds: ["model"], label: "final" },
  ];
  it("takes the soonest job of the kind", () => {
    expect(nextRun(schedule, "model", Date.parse("2026-11-01T14:08:00Z"))).toEqual({ at: "2026-11-01T22:23:00.000Z", label: "final" });
    expect(nextRun(schedule, "odds", AT)).toEqual({ at: "2026-11-01T14:07:00.000Z", label: "board" });
  });
  it("is null when nothing of the kind is scheduled", () => {
    expect(nextRun(schedule, "grade", AT)).toBeNull();
    expect(nextRun(null, "odds", AT)).toBeNull();
  });
});
