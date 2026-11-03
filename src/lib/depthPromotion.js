// ── When the club rules the starter out, somebody takes the snaps ────────────
// The depth-chart layer in playerPriors.js prices a backup for an AVERAGE week:
// a charted QB2 gets his slot's 12.6 attempts discounted by the 28% of weeks a
// QB2 plays, and comes out at 3.6. That is the right unconditional number and it
// is a useless board row — no book prices a 3.6-attempt quarterback.
//
// It is useless because the quarterback is the one position whose backup is not
// a rate at all. Measured on 2025 (scripts/screen_backup_baseline.mjs § 6):
//
//   slot   starter healthy    every man above ruled Out    ratio
//   QB2      1.91 att              27.97 att               x14.6
//   RB2      6.23 car              14.33 car                x2.3
//   WR2      5.19 tgt               7.40 tgt                x1.4
//   TE2      1.81 tgt               2.44 tgt                x1.4
//
// A QB2 is in one of two states and there is almost nothing in between: he is
// taking a knee, or he is the starter. The club tells us which, on the injury
// report, before kickoff. So the row is built only in the state where it is
// worth having, and in that state it is worth everything.
//
// ── WHY THIS IS NOT THE DISABLED REDISTRIBUTION LAYER ───────────────────────
// vacancyMult() and BUDGET_DAMP in models.js are both wired at zero on 2025
// evidence: a vacated share, spread over the survivors in proportion to the
// shares they already hold, is a real correlation that does not convert into
// accuracy. Nothing here reopens either of them, and this is not a smaller
// version of them:
//
//   · It moves nobody who already has a board row. Every promoted player had NO
//     ROW AT ALL — isProjectable() gates quarterbacks on depth_rank === 1, so a
//     QB2 is not on the board to be redistributed to.
//   · There is no share to spread. A vacated quarterback's 30 attempts do not go
//     to the room pro rata; they go, entire, to exactly one man.
//   · The WR2/TE2/RB2 rows in the table above — the ones that ARE redistribution
//     — are deliberately left alone. Their 35-43% is what calibrate_vacancy.mjs
//     already measured and declined to ship.
//
// It is an EXISTENCE question, and it is settled without touching a disabled knob.
//
// ── WHOSE NUMBER DOES A PROMOTED QB CARRY? ──────────────────────────────────
// Not his own, and not his rank's. On 34 takeovers in 2025:
//
//   estimator                            MAE    bias    RMSE
//   his own carried attempts            12.37   -9.94   15.23
//   the QB2 role cell (per game played) 17.76  -16.56   20.21
//   the league QB1 cell                  9.28   +3.31   11.63
//   THE VACATED STARTER'S OWN ATTEMPTS   9.11   -1.48   11.72
//   his club's attempts per game to date 9.02   +2.47   11.39
//
// The two player-level estimators are ten attempts low, because a backup's own
// attempt rate describes mop-up duty. The three team-level ones cannot be told
// apart on 34 rows — 0.4 of RMSE between them — so the pick is made on bias and
// on what each one knows: the vacated starter's rate is the only one that knows
// a Raven throws less often than a 49er, and it is the only one that exists at a
// season flip, where nobody has attempted a pass yet.
//
// Graded against real FanDuel closing lines on the 30 of those takeovers that
// had a pass-yards market, through the shipped projection: MAE 62.8 against the
// line's 61.4, bias -3.2 against the line's -5.9, side accuracy 53.3% on both,
// Brier .2591 against .2500. The row does not beat the market. It is defensible
// enough to show, where today there is nothing at all.
//
// ── WHAT IS DELIBERATELY NOT CARRIED OVER ───────────────────────────────────
// Only the ATTEMPT VOLUME is replaced. His efficiency stays his own — a starter's
// yards per attempt is not transferable, and the model regresses ypa toward
// league by evidence anyway. His RUSHING stays his own too, merely un-discounted:
// quarterback carries are scrambles and designed keepers, which is a fact about
// the man rather than about the slot, and nothing here measured otherwise.
//
// Pure. No React, no I/O.
import { isProjectable, roleBaselineFor } from "./playerPriors.js";
import { availabilityOf, isRuledOut } from "./injuries.js";
import { hasRole } from "./roster.js";

// Only these positions promote. See the table above: everything else is
// redistribution, and redistribution is measured and off.
const PROMOTES = new Set(["QB"]);

// Per-game counts, the same list playerPriors.js scales. Kept local rather than
// imported so this module states its own contract.
const PER_GAME = ["targets_pg", "rec_pg", "rec_yards_pg", "rec_td_pg",
  "carries_pg", "rush_yards_pg", "rush_td_pg", "pass_att_pg", "pass_yards_pg",
  "pass_td_pg", "total_td_pg", "rz_carries_pg", "rz_targets_pg",
  "gl_carries_pg", "gl_targets_pg"];

// ── A CHARTED QB1 CARRYING A BACKUP'S VOLUME (2026-09-16) ──────────────────
// The other way a quarterback's attempts describe the wrong job. Malik Willis
// was Miami's QB1 in week 1 of 2026, and his carried baseline was his Green Bay
// backup work: 8.5 attempts a game. projectPlayer() builds no passing props below
// 10, so the board priced his rushing and said nothing about the passing market
// every book hung. He threw it all game.
//
// Nobody above him is out, so promotion never fires — but the fix is the same
// estimator for the same reason: the attempts belong to the job. With no vacated
// starter to inherit from, the job's number is the league QB1 cell. On 2025, the
// 22 charted QB1s whose carried rate was backup-level (or absent) before their
// third game: own carried rate MAE 24.2 attempts, bias −23.7; QB1 cell MAE 6.7,
// bias +4.9. Only the attempts move; efficiency and rushing stay his own.
//
// The floor is the attempt rate at which a quarterback owns his club's passing
// share (ATD ATT_FULL in models.js); a real starter's carried season sits well
// above it. Three live games displace the carried number on their own.
export const QB1_ATT_FLOOR = 18;

const rankOf = (row) => row?._carryover?.depth_rank ?? null;
const posOf = (row) => row?._carryover?.depth_pos ?? row?.position ?? null;

/**
 * Lay this week's injury report over one team's rows and promote whoever the
 * club has left holding a position.
 *
 * Returns a NEW array with NEW rows for anyone promoted; untouched rows are
 * passed through by reference. Never mutates — these rows are shared across
 * every surface that reads `d.season`.
 *
 * @param rows   one team's blended season rows (BEFORE the hasRole /
 *               isProjectable gates — a QB2 does not survive them)
 * @param isOut  (playerId) => true when the club has filed him Out or Doubtful
 *               for this week. Pre-game public information: it is in the closing
 *               line long before we see it.
 * @param qb1Cell the season's QB1 role cell (roleBaselineFor(season, "QB", 1)),
 *               for a charted starter whose carried attempts are a backup's.
 *               Omitted = that step is skipped.
 */
export function promoteDepthRooms(rows, { isOut, qb1Cell = null }) {
  if (!rows?.length || typeof isOut !== "function") return rows || [];

  // The room: everyone the club charts at the same position, by rank.
  const rooms = new Map();
  for (const r of rows) {
    const pos = posOf(r), rank = rankOf(r);
    if (!PROMOTES.has(pos) || rank == null) continue;
    if (!rooms.has(pos)) rooms.set(pos, []);
    rooms.get(pos).push(r);
  }

  const promoted = new Map();
  for (const room of rooms.values()) {
    for (const row of room) {
      if (rankOf(row) !== 1 || isOut(row.player_id)) continue;
      const out = retargetStarter(row, qb1Cell);
      if (out) promoted.set(row.player_id, out);
    }
    room.sort((a, b) => rankOf(a) - rankOf(b));
    for (const row of room) {
      const rank = rankOf(row);
      if (rank <= 1) continue;
      if (isOut(row.player_id)) continue;      // he is out too — promoting him is absurd
      const above = room.filter((x) => rankOf(x) < rank);
      // EVERY man above him, not merely the one directly ahead. A club that
      // rules QB1 out hands the job to QB2, not to QB3, and promoting both would
      // put two starting quarterbacks on one team's board.
      if (!above.length || !above.every((x) => isOut(x.player_id))) continue;
      const starter = above.reduce((a, b) =>
        ((b.pass_att_pg ?? 0) > (a.pass_att_pg ?? 0) ? b : a));
      const out = promote(row, starter);
      if (out) promoted.set(row.player_id, out);
    }
  }
  if (!promoted.size) return rows;
  return rows.map((r) => promoted.get(r.player_id) || r);
}

/**
 * One promoted row.
 *
 * Two things happen, and only two:
 *
 *   1. THE AVAILABILITY DISCOUNT COMES OFF. His per-game counts were multiplied
 *      by the play rate of the rank he holds — 28% for a QB2 — because in an
 *      average week he does not play. This week the club has said he does, so
 *      the discount is divided back out. Everything else about those numbers is
 *      still his own.
 *   2. THE ATTEMPT VOLUME BECOMES THE VACATED STARTER'S, exactly and unshrunk.
 *      That is the estimator the screen measured (bias -1.48 attempts) and
 *      graded against the market; blending it toward the league QB1 cell would
 *      be a middle nobody measured, and the cell's own bias is +3.31 the other
 *      way, so the middle is not obviously better than either end.
 *
 * WHAT THIS DOES NOT UNDO, stated rather than hidden: his other per-game counts
 * keep the role shrinkage they were given at his CHARTED rank, so a promoted
 * quarterback's rushing sits slightly nearer a QB2's 2.20 carries than a QB1's
 * 3.80. Re-targeting it would mean rebuilding the row from his prior, which the
 * board does not keep past blendPlayerSeason, and the direction is conservative.
 * It moves nothing but the anytime-TD line on a thin market.
 */
function promote(row, starter) {
  const held = row._carryover?.play_rate;
  const starterAtt = starter?.pass_att_pg;
  if (starterAtt == null) return null;               // nothing to promote him to

  const out = { ...row };
  // 1 — undo the discount. `held` is null on a row the depth layer never
  // touched (off the chart, or a season with no role table), and dividing by
  // nothing is the identity.
  if (held != null && held > 0) {
    for (const key of PER_GAME) if (out[key] != null) out[key] = out[key] / held;
  }
  // 2 — the attempts are the job's, not his.
  out.pass_att_pg = starterAtt;

  out._carryover = {
    ...(row._carryover || {}),
    promoted_from: starter.player_id,
    promoted_rank: rankOf(row),
    // The row's volume is now a statement about a JOB rather than about this
    // man, and confidence.js reads this to say so.
    play_rate: 1,
  };
  return out;
}

/**
 * A charted QB1 whose carried attempts are a backup's takes the QB1 cell's.
 * Null when he is already carrying a starter's volume, has three live games, or
 * there is no cell to take it from.
 */
function retargetStarter(row, cell) {
  const att = cell?.pass_att_pg;
  if (att == null || (row._carryover?.live_games ?? 0) >= 3) return null;
  if ((row.pass_att_pg ?? 0) >= QB1_ATT_FLOOR) return null;
  return {
    ...row,
    pass_att_pg: att,
    _carryover: { ...(row._carryover || {}), retargeted_att: row.pass_att_pg ?? null },
  };
}

/** Whether a row's baseline came from the man it replaced rather than from itself. */
export const isPromoted = (row) => !!row?._carryover?.promoted_from;

/**
 * The rows a board surface should show for one team in one week: the club's
 * promotions applied, then the shipped eligibility gates.
 *
 * Exists because the filter was copy-pasted into the Board, the Games detail and
 * the Player panel, and a promotion that only one of them knew about would make
 * the panel disagree with the board it exists to explain.
 *
 * @param d     the loaded season bundle (needs `season`, `injuries`, `players`)
 * @param team  team_abbr
 * @param game  the week's game row (needs `season` and `week`)
 */
export function projectableRoster(d, team, game) {
  const rows = d.season.filter((s) => s.team_abbr === team);
  const promoted = game
    ? promoteDepthRooms(rows, {
      isOut: (pid) => isRuledOut(availabilityOf(d.injuries, pid, game.week, d.players?.[pid]?.status)),
      qb1Cell: roleBaselineFor(game.season, "QB", 1),
    })
    : rows;
  return promoted.filter((s) => hasRole(s, "board") && isProjectable(s));
}
