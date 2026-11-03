// ── Availability: the injury report + the active roster ──────────────────────
// Two different questions that both answer "will this man take a snap":
//
//   ROSTER STATUS — is he on the team at all? `players.status` from the nflverse
//     roster file (ACT / RES / CUT / INA / DEV / RET). Already loaded by
//     loadData.js and, until now, never read. A carried-forward baseline does not
//     know its owner was cut in August, so the board was projecting released
//     players next to starters with no visible difference between them.
//
//   REPORT STATUS — is he hurt? The club's filed game-status designation for THIS
//     WEEK, from nfl.player_injuries (scripts/pull_injuries.mjs).
//
// Both are facts, not opinions, and both are in the closing line long before we
// see it — which is exactly the asymmetry scripts/build_availability_weekly.py
// identified as one of the few places the model can gain ground on the market.
//
// The report is the club's LAST FILED designation, not a game-time verdict:
// nflverse does not carry the 90-minute inactives list. So the board reports what
// was filed and says so, rather than implying a certainty it does not have.
//
// PURE — no I/O, no Supabase. The table read lives with the other loaders in
// loadData.js, and it lives there for a load-bearing reason: this module is
// imported by src/lib/depthPromotion.js, which is imported by the Node grading
// harness (scripts/lib/grade.mjs). A supabase.js import here reads
// `import.meta.env` at module scope and takes every script in scripts/ down with
// a TypeError before it can grade anything.

/**
 * Severity, high to low. Drives both the sort and which rows the board hides by
 * default. `null` (on the report, no designation) is deliberately ranked BELOW
 * "not on the report at all" — appearing on the participation report is mild
 * information, and flattening it to nothing throws that away.
 */
export const AVAIL_RANK = { OUT: 4, DOUBTFUL: 3, QUESTIONABLE: 2, LIMITED: 1, OK: 0 };

/** Roster statuses that mean he is not available to play for this club. */
const OFF_ROSTER = { RES: "IR", CUT: "CUT", RET: "RET", INA: "INA", E14: "PUP" };

/** Rows → Map keyed `player_id|week`. */
export function indexInjuries(rows) {
  const m = new Map();
  for (const r of rows || []) m.set(`${r.player_id}|${r.week}`, r);
  return m;
}

const norm = (s) => (s || "").trim().toUpperCase();

/**
 * One player's availability for one week.
 *
 * @returns { level, label, tone, detail } — `level` is an AVAIL_RANK key,
 *          `label` is the 3-4 char chip, `tone` is "bad" | "warn" | null, and
 *          `detail` is the tooltip. Returns level "OK" with a null label when
 *          there is nothing to say, so the cell renders empty rather than
 *          asserting good health we have not checked.
 */
export function availabilityOf(index, playerId, week, rosterStatus) {
  const rs = norm(rosterStatus);
  if (OFF_ROSTER[rs]) {
    return {
      level: "OUT", label: OFF_ROSTER[rs], tone: "bad",
      detail: `Roster status ${rs} — not on the active roster. His baseline is carried from games he played when he was.`,
    };
  }

  const r = index?.get(`${playerId}|${week}`);
  if (!r) return { level: "OK", label: null, tone: null, detail: null };

  const st = norm(r.report_status);
  const body = r.injury ? ` (${r.injury})` : "";
  if (st === "OUT") return { level: "OUT", label: "OUT", tone: "bad", detail: `Ruled OUT${body}` };
  if (st === "DOUBTFUL") return { level: "DOUBTFUL", label: "DOUB", tone: "bad", detail: `Doubtful${body}` };
  if (st === "QUESTIONABLE") return { level: "QUESTIONABLE", label: "QUES", tone: "warn", detail: `Questionable${body}` };

  // On the report with no game-status designation. Whether that is worth a chip
  // depends on the practice line behind it: a full participant is noise, a DNP
  // three days before kickoff is not.
  const p = norm(r.practice_status);
  if (p.startsWith("DID NOT")) {
    return { level: "LIMITED", label: "DNP", tone: "warn", detail: `Did not practise${body} — no game-status designation filed` };
  }
  if (p.startsWith("LIMITED")) {
    return { level: "LIMITED", label: "LTD", tone: "warn", detail: `Limited in practice${body} — no game-status designation filed` };
  }
  return { level: "OK", label: null, tone: null, detail: null };
}

/** The designation string confidence.js understands, or null. */
export function statusFor(avail) {
  if (!avail) return null;
  if (avail.level === "OUT") return "Out";
  if (avail.level === "DOUBTFUL") return "Doubtful";
  if (avail.level === "QUESTIONABLE" || avail.level === "LIMITED") return "Questionable";
  return null;
}

/** Ruled out, or off the roster — the rows the board hides unless asked. */
export const isRuledOut = (avail) => avail?.level === "OUT" || avail?.level === "DOUBTFUL";
