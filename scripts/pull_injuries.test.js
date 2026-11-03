// ── Injury pull: CSV → rows ──────────────────────────────────────────────────
// The pull runs unattended and the board reads whatever it wrote, so the two
// things that can silently corrupt availability are pinned here: quoted fields
// (an injury of "Knee, Ankle" shifts every column after it if you split on ",")
// and the meaning of a blank designation.
import { describe, it, expect } from "vitest";
import { parseCsv, toRows } from "./pull_injuries.mjs";

const HEAD = "season,season_type,team,week,gsis_id,position,full_name,report_status,practice_primary_injury,practice_status";

describe("parseCsv", () => {
  it("keeps a quoted comma inside its own field", () => {
    // Without this the body part lands in report_status and every player with
    // two injuries is marked with a designation nobody filed.
    const csv = `${HEAD}\n2026,REG,NE,1,00-1,WR,A Player,Questionable,"Knee, Ankle",Limited Participation in Practice`;
    const [r] = parseCsv(csv);
    expect(r.practice_primary_injury).toBe("Knee, Ankle");
    expect(r.report_status).toBe("Questionable");
    expect(r.practice_status).toBe("Limited Participation in Practice");
  });

  it("handles an escaped quote and a trailing newline", () => {
    const csv = `${HEAD}\n2026,REG,NE,1,00-1,WR,"A ""AJ"" Player",,Knee,Full Participation in Practice\n`;
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].full_name).toBe('A "AJ" Player');
  });

  it("returns [] for an empty file rather than throwing", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv(HEAD)).toEqual([]);
  });
});

describe("toRows", () => {
  const parse = (body) => toRows(parseCsv(`${HEAD}\n${body}`), 2026);

  it("keeps a blank designation as null, because the blank is meaningful", () => {
    // A limited practice participant with no game-status designation is expected
    // to play. Dropping the row would lose the practice line behind it.
    const [r] = parse("2026,REG,NE,1,00-1,WR,A Player,,Knee,Limited Participation in Practice");
    expect(r.report_status).toBe(null);
    expect(r.practice_status).toBe("Limited Participation in Practice");
    expect(r.injury).toBe("Knee");
  });

  // CANONICAL FORM IS "LA", NOT "LAR" — the direction this test used to assert
  // was backwards, and so was the map it was pinning. teams.json, games.json and
  // every stats file call the Rams "LA"; scripts/nflteams.py says so. Writing
  // "LAR" joins a Rams player to no game, no defensive profile and no team
  // prior, which drops all 28 of them off the board with no error anywhere.
  //
  // The old map also normalised WSH, ARZ, BLT, CLV, HST and JAC. nflverse emits
  // none of them: injuries_2025.csv and injuries_2026.csv both carry WAS, ARI,
  // BAL, CLE, HOU and JAX. So those clauses never fired, while the one clause
  // that did fire was the wrong way round.
  it("canonicalises the Rams to LA — the form every other artifact uses", () => {
    const [r] = parse("2026,REG,LAR,1,00-1,WR,A Player,Out,Knee,Did Not Participate In Practice");
    expect(r.team_abbr).toBe("LA");
  });

  it("passes through the abbreviations nflverse actually emits", () => {
    for (const t of ["WAS", "ARI", "BAL", "CLE", "HOU", "JAX", "LA"]) {
      const [r] = parse(`2026,REG,${t},1,00-1,WR,A Player,Out,Knee,DNP`);
      expect(r.team_abbr).toBe(t);
    }
  });

  it("drops rows with no join key or no week — they cannot reach a player", () => {
    expect(parse("2026,REG,NE,1,,WR,No Id,Out,Knee,DNP")).toHaveLength(0);
    expect(parse("2026,REG,NE,,00-1,WR,No Week,Out,Knee,DNP")).toHaveLength(0);
  });

  it("keeps the LAST filing for a player-week, which is the correction", () => {
    const rows = parse([
      "2026,REG,NE,1,00-1,WR,A Player,Questionable,Knee,Limited Participation in Practice",
      "2026,REG,NE,1,00-1,WR,A Player,Out,Knee,Did Not Participate In Practice",
    ].join("\n"));
    expect(rows).toHaveLength(1);
    expect(rows[0].report_status).toBe("Out");
  });

  it("keeps the same player in two different weeks", () => {
    const rows = parse([
      "2026,REG,NE,1,00-1,WR,A Player,Out,Knee,Did Not Participate In Practice",
      "2026,REG,NE,2,00-1,WR,A Player,,Knee,Full Participation in Practice",
    ].join("\n"));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.week).sort()).toEqual([1, 2]);
  });

  it("writes the season it was asked for, not the one in the file", () => {
    // The CSV is per-season by URL; trusting its column would let a stray row
    // from a season_type reshuffle land under the wrong key.
    const [r] = parse("2025,REG,NE,1,00-1,WR,A Player,Out,Knee,DNP");
    expect(r.season).toBe(2026);
  });
});
