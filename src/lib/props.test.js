// ── Prop menu ────────────────────────────────────────────────────────────────
// The board's row unit is (player, prop), so this table decides what a position
// tab actually shows. The failure it guards against is silent: a prop dropped
// from a position's menu does not error, it just stops appearing, and nobody
// notices a market is missing from a 250-row board.
import { describe, it, expect } from "vitest";
import {
  propMenuFor, defaultPropsFor, defaultPropFor, propRank, posRank, PROP_ORDER, POS_PROPS,
  isOneSided, ONE_SIDED_PROPS, isDefProp, DEF_POSITIONS,
} from "./props.js";
import { PROP_SHORT } from "./format.js";

describe("propMenuFor", () => {
  it("opens every position on anytime TD and nothing else", () => {
    // The board used to open on six markets at once on the All tab — six rows
    // per player before the reader has asked a question.
    for (const pos of ["QB", "RB", "WR", "TE", "ALL"]) {
      expect(defaultPropsFor(pos), pos).toEqual(["anytime_td"]);
    }
  });

  it("offers the position's other markets as unselected toggles", () => {
    const qb = propMenuFor("QB");
    expect(qb.find((p) => p.type === "completions").on).toBe(false);
    expect(qb.find((p) => p.type === "pass_yards").on).toBe(false);
    expect(qb.find((p) => p.type === "anytime_td").on).toBe(true);
    const rb = propMenuFor("RB");
    expect(rb.find((p) => p.type === "receptions").on).toBe(false);
  });

  it("unions every position for ALL, so every market stays reachable", () => {
    const types = propMenuFor("ALL").map((p) => p.type);
    for (const markets of Object.values(POS_PROPS)) {
      for (const t of markets) expect(types).toContain(t);
    }
    // rush_yards belongs to backs and to quarterbacks who run; the combined
    // board must not drop it.
    expect(types).toContain("rush_yards");
    expect(types).toContain("pass_yards");
    expect(types).toContain("receptions");
  });

  it("returns each prop once, in canonical order", () => {
    const types = propMenuFor("ALL").map((p) => p.type);
    expect(new Set(types).size).toBe(types.length);
    expect([...types].sort((a, b) => propRank(a) - propRank(b))).toEqual(types);
  });

  it("is empty rather than throwing for a position the model does not project", () => {
    expect(propMenuFor("K")).toEqual([]);
    expect(defaultPropsFor("K")).toEqual([]);
  });

  it("offers sacks to the defensive groups, and only to them", () => {
    for (const pos of DEF_POSITIONS) {
      expect(propMenuFor(pos).map((p) => p.type), pos).toEqual(["def_sacks"]);
    }
    for (const pos of ["QB", "RB", "WR", "TE"]) {
      expect(propMenuFor(pos).map((p) => p.type), pos).not.toContain("def_sacks");
    }
    // …and it stays reachable from the combined board.
    expect(propMenuFor("ALL").map((p) => p.type)).toContain("def_sacks");
  });
});

describe("defaultPropFor", () => {
  it("opens the offence on anytime TD — the one market they all share", () => {
    for (const pos of ["QB", "RB", "WR", "TE", "ALL"]) {
      expect(defaultPropFor(pos), pos).toBe("anytime_td");
    }
  });

  it("opens a defensive group on the only market it has", () => {
    // Picking DL is a request to look at sacks; there is nothing else to look at,
    // and opening on a market the position does not offer would show no rows.
    for (const pos of DEF_POSITIONS) expect(defaultPropFor(pos), pos).toBe("def_sacks");
  });

  it("is null for a position the model does not project, rather than undefined", () => {
    expect(defaultPropFor("K")).toBeNull();
  });
});

describe("ordering", () => {
  it("groups yardage before counts before touchdowns", () => {
    expect(propRank("pass_yards")).toBeLessThan(propRank("receptions"));
    expect(propRank("receptions")).toBeLessThan(propRank("anytime_td"));
  });

  it("sinks an unknown prop instead of sorting it first", () => {
    expect(propRank("kicking_points")).toBeGreaterThanOrEqual(PROP_ORDER.length);
    expect(posRank("K")).toBeGreaterThan(posRank("TE"));
  });

  it("orders positions down the depth chart, not alphabetically", () => {
    // Alphabetical would read QB, RB, TE, WR and split the two receiving
    // positions around the backs.
    expect(posRank("WR")).toBeLessThan(posRank("TE"));
    expect(posRank("QB")).toBeLessThan(posRank("RB"));
  });
});

describe("one-sided markets", () => {
  it("names anytime TD and sacks, and only markets that really have no other side", () => {
    expect(isOneSided("anytime_td")).toBe(true);
    // Nobody bets the under on half a sack, and most of the market is DFS
    // pick'em, which posts one price for both sides.
    expect(isOneSided("def_sacks")).toBe(true);
    // Passing TDs IS two-sided — books post under 0.5 / 1.5 / 2.5 — so a 75%
    // under there is a real play and must keep flipping.
    expect(isOneSided("pass_tds")).toBe(false);
    expect(isOneSided("rec_yards")).toBe(false);
    expect(isOneSided("receptions")).toBe(false);
  });

  it("only lists props the board actually offers", () => {
    const offered = new Set(propMenuFor("ALL").map((p) => p.type));
    for (const t of ONE_SIDED_PROPS) expect(offered).toContain(t);
  });
});

describe("defensive markets", () => {
  it("names the defensive props, and they are all on the combined menu", () => {
    expect(isDefProp("def_sacks")).toBe(true);
    expect(isDefProp("anytime_td")).toBe(false);
    const offered = new Set(propMenuFor("ALL").map((p) => p.type));
    for (const pos of DEF_POSITIONS) {
      for (const t of POS_PROPS[pos]) {
        expect(isDefProp(t), `${t} is offered to ${pos} and must be a defensive prop`).toBe(true);
        expect(offered).toContain(t);
      }
    }
  });

  it("sorts the defensive groups after the offence, front-to-back", () => {
    expect(posRank("DL")).toBeGreaterThan(posRank("TE"));
    expect(posRank("DL")).toBeLessThan(posRank("LB"));
    expect(posRank("LB")).toBeLessThan(posRank("DB"));
  });
});

describe("cross-checks against the rest of the app", () => {
  it("every prop on a menu has a short label, so no cell renders a raw key", () => {
    for (const { type } of propMenuFor("ALL")) {
      expect(PROP_SHORT[type], `no PROP_SHORT for ${type}`).toBeTruthy();
    }
  });

  it("every prop on a menu is in the canonical order table", () => {
    for (const { type } of propMenuFor("ALL")) expect(PROP_ORDER).toContain(type);
  });
});
