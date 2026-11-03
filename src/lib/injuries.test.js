// ── Availability ─────────────────────────────────────────────────────────────
// Two ways to be unavailable — hurt, or not on the roster — and one way to be
// merely worth flagging. The defect this guards against is a false NEGATIVE: a
// player who will not play showing a clean row, which is exactly what the board
// did before the report was wired in.
import { describe, it, expect } from "vitest";
import { indexInjuries, availabilityOf, statusFor, isRuledOut, AVAIL_RANK } from "./injuries.js";

const idx = indexInjuries([
  { player_id: "p-out", week: 1, report_status: "Out", injury: "Hamstring" },
  { player_id: "p-doubt", week: 1, report_status: "Doubtful", injury: "Ankle" },
  { player_id: "p-ques", week: 1, report_status: "Questionable", injury: "Knee" },
  { player_id: "p-dnp", week: 1, report_status: null, practice_status: "Did Not Participate In Practice", injury: "Knee" },
  { player_id: "p-ltd", week: 1, report_status: "", practice_status: "Limited Participation in Practice", injury: "Knee" },
  { player_id: "p-full", week: 1, report_status: null, practice_status: "Full Participation in Practice", injury: "Knee" },
  { player_id: "p-out", week: 2, report_status: null, practice_status: "Full Participation in Practice" },
]);

const at = (pid, week = 1, roster = "ACT") => availabilityOf(idx, pid, week, roster);

describe("availabilityOf", () => {
  it("reports the club's game-status designation", () => {
    expect(at("p-out").level).toBe("OUT");
    expect(at("p-out").label).toBe("OUT");
    expect(at("p-doubt").level).toBe("DOUBTFUL");
    expect(at("p-ques").level).toBe("QUESTIONABLE");
    expect(at("p-out").detail).toContain("Hamstring");
  });

  it("is WEEK-SCOPED — last week's designation is not this week's", () => {
    // The same player, cleared by week 2. Keying on player alone would carry the
    // Out chip forward for the rest of the season.
    expect(at("p-out", 1).level).toBe("OUT");
    expect(at("p-out", 2).level).toBe("OK");
  });

  it("reads the practice line when no designation was filed", () => {
    expect(at("p-dnp").label).toBe("DNP");
    expect(at("p-ltd").label).toBe("LTD");
    // A full participant with no designation is expected to play — no chip.
    expect(at("p-full").label).toBe(null);
  });

  it("says nothing at all about a player who is not on the report", () => {
    // Silence is silence, not a clean bill of health: an "OK" chip on every
    // healthy row would assert a check the report does not make.
    const a = at("p-unknown");
    expect(a.level).toBe("OK");
    expect(a.label).toBe(null);
  });

  it("catches the other way to be unavailable: off the active roster", () => {
    // A carried-forward baseline has no idea its owner was cut in August.
    expect(at("p-unknown", 1, "CUT").label).toBe("CUT");
    expect(at("p-unknown", 1, "RES").label).toBe("IR");
    expect(at("p-unknown", 1, "RET").label).toBe("RET");
    expect(at("p-unknown", 1, "CUT").level).toBe("OUT");
    expect(at("p-unknown", 1, "ACT").label).toBe(null);
    expect(at("p-unknown", 1, null).label).toBe(null);
  });

  it("survives an empty or missing index, because the table may not exist yet", () => {
    expect(availabilityOf(null, "p", 1, "ACT").level).toBe("OK");
    expect(availabilityOf(indexInjuries([]), "p", 1, "ACT").level).toBe("OK");
    expect(availabilityOf(indexInjuries(undefined), "p", 1, "ACT").level).toBe("OK");
  });
});

describe("statusFor / isRuledOut", () => {
  it("hands confidence.js the designation it understands", () => {
    expect(statusFor(at("p-out"))).toBe("Out");
    expect(statusFor(at("p-doubt"))).toBe("Doubtful");
    expect(statusFor(at("p-ques"))).toBe("Questionable");
    // A DNP with no filed designation is treated as Questionable for the
    // confidence cap: unresolved is unresolved.
    expect(statusFor(at("p-dnp"))).toBe("Questionable");
    expect(statusFor(at("p-full"))).toBe(null);
  });

  it("hides only the players who are actually not expected to play", () => {
    expect(isRuledOut(at("p-out"))).toBe(true);
    expect(isRuledOut(at("p-doubt"))).toBe(true);
    // Questionable is a coin flip, not an absence — it stays on the board with a
    // chip, the same call build_availability_weekly.py makes.
    expect(isRuledOut(at("p-ques"))).toBe(false);
    expect(isRuledOut(at("p-full"))).toBe(false);
  });
});

describe("AVAIL_RANK", () => {
  it("orders severity so the Inj sort puts the worst news first", () => {
    expect(AVAIL_RANK.OUT).toBeGreaterThan(AVAIL_RANK.DOUBTFUL);
    expect(AVAIL_RANK.DOUBTFUL).toBeGreaterThan(AVAIL_RANK.QUESTIONABLE);
    expect(AVAIL_RANK.QUESTIONABLE).toBeGreaterThan(AVAIL_RANK.LIMITED);
    expect(AVAIL_RANK.LIMITED).toBeGreaterThan(AVAIL_RANK.OK);
  });
});
