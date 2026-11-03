// ── The spread's sign ────────────────────────────────────────────────────────
// nflverse stores spread_line HOME-POSITIVE: a +4.5 means the HOME team is
// favoured by four and a half, so the home side's printed handicap is its
// NEGATIVE. Getting that backwards is not a subtle bug — the week slate prints
// it sixteen times at once, once per game, and every one of them would be
// inverted.
import { describe, it, expect } from "vitest";
import { sideSpread, spreadText } from "./format.js";

const MINUS = "−";                        // the typographic minus the cards use

describe("sideSpread", () => {
  const g = { spread_line: 4.5, home_team: "BUF", away_team: "DET" };

  it("gives the favourite the minus and the dog the plus", () => {
    expect(spreadText(g)).toBe("BUF -4.5");     // the home team is favoured
    expect(sideSpread(g, "home")).toBe(`${MINUS}4.5`);
    expect(sideSpread(g, "away")).toBe("+4.5");
  });

  it("flips with the line, so an away favourite is not printed as a dog", () => {
    const away = { spread_line: -3, home_team: "ATL", away_team: "CAR" };
    expect(spreadText(away)).toBe("CAR -3");
    expect(sideSpread(away, "away")).toBe(`${MINUS}3`);
    expect(sideSpread(away, "home")).toBe("+3");
  });

  it("says PK on both sides rather than printing a signed zero", () => {
    const pk = { spread_line: 0, home_team: "NYJ", away_team: "GB" };
    expect(sideSpread(pk, "home")).toBe("PK");
    expect(sideSpread(pk, "away")).toBe("PK");
  });

  it("is null when no spread is posted, so the card renders nothing", () => {
    expect(sideSpread({ home_team: "NYJ" }, "home")).toBeNull();
    expect(sideSpread(null, "home")).toBeNull();
    expect(spreadText({ home_team: "NYJ" })).toBeNull();
  });
});
