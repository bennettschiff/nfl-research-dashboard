// ── Sack rows on the board ───────────────────────────────────────────────────
// Two failures this guards, and they are the ones that actually happened.
//
// A MAN ON INJURED RESERVE AT THE TOP OF THE BOARD. The sack priors artifact
// stamps each defender's roster status at build time, and its allowlist counted
// RES — injured reserve — as rostered. Myles Garrett opened the 2026 week-2
// board first at 1.01 expected sacks and Micah Parsons second at 0.86, both on
// reserve. It is a silent failure: the row looks exactly like a real one.
//
// A ROW PRICED AT THE WRONG RUNG. 0.25 and 0.5 need half a sack; 0.75 and 1.0
// need a whole one. A row whose Win% is computed at one rung and shown beside a
// price on another is two different bets printed as one.
import { describe, it, expect } from "vitest";
import { buildSackRows, sackLadder, DEFAULT_RUNG } from "./sackRows.js";
import { sackBoard, sackPriors } from "./sackPriors.js";
import { applyDefenseRoster, defenseRosterFor, hasDefenseRoster, isOffRoster } from "./rosterDefense.js";
import { sackProbOver } from "./sacks.js";
import { indexInjuries } from "./injuries.js";

const SEASON = 2026;

// One real game off the bundled schedule, so the test reads the same artifacts
// the board does rather than a fixture that can drift away from them.
const GAME = {
  game_id: "T_LA_NYG", season: SEASON, week: 2, gameday: "2026-09-21", gametime: "20:15",
  home_team: "LA", away_team: "NYG", spread_line: 3, total_line: 44.5,
};
const d = (over = {}) => ({ year: SEASON, sackOdds: new Map(), injuries: new Map(), teams: {}, ...over });

describe("the live roster overlay", () => {
  it("is present and healthy, or none of the rest of this means anything", () => {
    expect(hasDefenseRoster(SEASON)).toBe(true);
  });

  it("knows injured reserve is not a roster", () => {
    expect(isOffRoster("RES")).toBe(true);        // injured reserve — the bug
    expect(isOffRoster("INA")).toBe(true);
    expect(isOffRoster("CUT")).toBe(true);
    // The practice squad CAN be elevated on Saturday and play on Sunday. The
    // injury report is what says whether he will.
    expect(isOffRoster("DEV")).toBe(false);
    expect(isOffRoster("ACT")).toBe(false);
    expect(isOffRoster(null)).toBe(false);
  });

  it("overrides the artifact's frozen flag, in both directions", () => {
    // The artifact said `rostered: true` for a man on IR. The overlay is the
    // authority, so the frozen flag cannot put him back on the board…
    const onIr = { pid: "00-0033868", name: "Myles Garrett", team: "CLE", rostered: true };
    const live = defenseRosterFor(SEASON, onIr.pid);
    expect(live.status).toBe("RES");
    const applied = applyDefenseRoster(SEASON, onIr);
    expect(applied.offRoster).toBe(true);
    // …and his TEAM comes off the overlay too, not out of the artifact.
    expect(applied.team).toBe(live.team_abbr);
    expect(applied.team).not.toBe("CLE");
  });

  it("treats a defender the overlay has never heard of as off a roster", () => {
    // Absence from a healthy overlay is an answer: it carries every player on
    // any club's DL/LB/DB list.
    expect(applyDefenseRoster(SEASON, { pid: "00-0000000", team: "BUF" }).offRoster).toBe(true);
  });
});

describe("sackBoard", () => {
  const rows = sackBoard(SEASON, [GAME]);

  it("projects both defences and nobody else", () => {
    expect(rows.length).toBeGreaterThan(10);
    for (const r of rows) {
      expect(["LA", "NYG"]).toContain(r.team);
      expect(r.team === "LA" ? "NYG" : "LA").toBe(r.opp);
    }
  });

  it("leaves nobody on injured reserve on it", () => {
    const art = sackPriors(SEASON);
    const byPid = Object.fromEntries(art.players.map((p) => [p.pid, p]));
    expect(byPid["00-0033868"]).toBeTruthy();                    // he IS in the artifact
    expect(rows.some((r) => r.pid === "00-0033868")).toBe(false); // and not on the board
    for (const r of rows) expect(isOffRoster(r.status), `${r.name} ${r.status}`).toBe(false);
  });

  it("carries the opponent-line multiplier the projection actually used", () => {
    for (const r of rows) {
      expect(r.oppAdj).toBeGreaterThan(0.6);      // OPP_CAP is ±35%
      expect(r.oppAdj).toBeLessThan(1.4);
    }
  });
});

describe("buildSackRows", () => {
  const rows = buildSackRows(d(), [GAME]);

  it("prices an unposted row at the rung the market arrives on", () => {
    for (const r of rows) {
      expect(r.probLine).toBe(DEFAULT_RUNG);
      expect(r.prob).toBeCloseTo(sackProbOver(r.lambda, DEFAULT_RUNG), 12);
    }
  });

  it("is one-sided, so Win% is the chance he clears the rung and never its complement", () => {
    for (const r of rows) {
      expect(r.oneSided).toBe(true);
      expect(r.win).toBe(r.prob);
    }
    // A longshot must rank as a longshot: max(p, 1−p) would turn a 12% row into
    // an 88% "lock" on a bet nobody posts.
    const longest = rows.reduce((a, b) => (a.win < b.win ? a : b));
    expect(longest.win).toBeLessThan(0.5);
  });

  it("carries the fields every downstream consumer reads off a board row", () => {
    const r = rows[0];
    expect(r.key).toBe(`${GAME.game_id}|${r.player_id}|def_sacks`);
    expect(r.prop_type).toBe("def_sacks");
    expect(r.propShort).toBe("SACKS");
    expect(r.game.game_id).toBe(GAME.game_id);
    expect(r.diff).toBeNull();                    // a rate minus a rung is not a number
    expect(r.hits).toBeNull();
    expect(r.carryover).toBeNull();
    expect(r.conf.side).toBe("over");
    expect(r.headline.proj_mean).toBe(r.proj);
    expect(r.tilt).toBeCloseTo(r.headline.factors.oppLineMult, 12);
  });

  it("reads the week's injury report, which covers defenders like everyone else", () => {
    const [first] = rows;
    const hurt = d({ injuries: indexInjuries([
      { player_id: first.player_id, week: GAME.week, report_status: "Out", injury: "knee" },
    ]) });
    const [r] = buildSackRows(hurt, [GAME]).filter((x) => x.player_id === first.player_id);
    expect(r.ruledOut).toBe(true);
    expect(r.avail.label).toBe("OUT");
    // …and the designation costs him the top tier, the same way it does on the
    // offensive board: whether he plays is the bigger unknown.
    expect(r.conf.tier).not.toBe("high");
  });
});

describe("sackLadder", () => {
  it("is every rung a book posts, monotonically harder", () => {
    const l = sackLadder(0.8);
    expect(l.map((x) => x.line)).toEqual([0.25, 0.5, 0.75, 1]);
    for (const x of l) expect(x.fair_line).toBeTypeOf("number");
    // 0.5 and 0.75 are the SAME question at two prices — both need a whole sack
    // to win, and a half on 0.5 pushes — which is the thing the expansion exists
    // to make obvious. 0.25 needs only a half; 1.0 needs one and a half.
    expect(l[1].prob).toBe(l[2].prob);
    expect(l[0].prob).toBeGreaterThan(l[1].prob);
    expect(l[2].prob).toBeGreaterThan(l[3].prob);
  });
});
