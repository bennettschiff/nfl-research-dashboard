// ── Profile card configuration + season selection ────────────────────────────
import { describe, it, expect } from "vitest";
import { tilesFor, populatedTiles } from "./profileTiles.js";
import { latestProfiles } from "./loadData.js";

describe("tilesFor", () => {
  it("gives each position group a distinct shape", () => {
    expect(tilesFor("QB").map((g) => g.group)).toEqual(["Volume", "Efficiency", "Rushing", "Tracking (Next Gen Stats)"]);
    expect(tilesFor("RB").map((g) => g.group)).toContain("Scoring role");
    expect(tilesFor("WR").map((g) => g.group)).toContain("Finishing");
    expect(tilesFor("TE")).toBe(tilesFor("WR"));
    expect(tilesFor("K")).toBe(null);
  });
});

describe("populatedTiles", () => {
  it("drops rows with no value and groups left empty", () => {
    const groups = populatedTiles("WR", { route_pct: 0.8, tprr: 0.25 });
    const keys = groups.flatMap((g) => g.rows.map((r) => r.key));
    expect(keys).toContain("route_pct");
    expect(keys).toContain("tprr");
    expect(keys).not.toContain("yprr");
    // "Scoring role" has no populated row here and must not render an empty box.
    expect(groups.map((g) => g.group)).not.toContain("Scoring role");
  });

  it("returns nothing for an unknown position or absent data", () => {
    expect(populatedTiles("K", { tprr: 0.2 })).toEqual([]);
    expect(populatedTiles("WR", null)).toEqual([]);
  });

  it("keeps a zero value — 0 is a measurement, not a missing one", () => {
    const keys = populatedTiles("WR", { drop_pct: 0 }).flatMap((g) => g.rows.map((r) => r.key));
    expect(keys).toContain("drop_pct");
  });

  it("formats a rate as a percentage and a rank stat to its own precision", () => {
    const rows = populatedTiles("WR", { route_pct: 0.789, tprr: 0.2345, yprr: 2.5 }).flatMap((g) => g.rows);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.route_pct.fmt(0.789)).toBe("79%");
    expect(byKey.tprr.fmt(0.2312)).toBe("0.231");   // TPRR carries 3 decimals
    expect(byKey.yprr.fmt(2.5)).toBe("2.50");       // YPRR carries 2
    expect(byKey.route_pct.fmt(null)).toBe(null);   // missing stays missing
  });
});

describe("latestProfiles", () => {
  const rows = [
    { player_id: "a", season: 2024 }, { player_id: "a", season: 2025 },
    { player_id: "b", season: 2025 }, { player_id: "c", season: 2026 },
  ];

  it("takes the newest profile at or before the season being viewed", () => {
    const got = latestProfiles(rows, 2026);
    expect(got.a.season).toBe(2025);
    expect(got.b.season).toBe(2025);
  });

  it("never shows a profile from a future season", () => {
    // A 2026 profile must not appear on the 2025 board — that is lookahead.
    expect(latestProfiles(rows, 2025).c).toBeUndefined();
    expect(latestProfiles(rows, 2026).c.season).toBe(2026);
  });

  it("falls back to an older season when the newest is missing", () => {
    expect(latestProfiles([{ player_id: "a", season: 2023 }], 2026).a.season).toBe(2023);
  });
});
