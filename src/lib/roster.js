// ── Role filters ─────────────────────────────────────────────────────────────
// The "does this player have enough of a role to be worth showing" test, which
// used to be copy-pasted into the Board, the Matchup Lab and the Games tab with
// three slightly different thresholds. Pure predicates, no I/O.
//
// This is deliberately SEPARATE from isProjectable() in playerPriors.js. They
// answer different questions and got conflated in the original inline filters:
//
//   hasRole()       — is he used enough to matter?      (a ROLE question)
//   isProjectable() — do we have a baseline for him?    (a SAMPLE question)
//
// The old `games >= 3` clause was doing the second job badly, and at a season
// flip it is unsatisfiable: in week 1 nobody has three games and the board is
// empty even though every returning starter has a perfectly good prior.
import { isFinal } from "./gameStatus.js";

// Volume floors per surface. The Lab is stricter because it is a browse-one
// -player view, the board wants the whole slate.
//
// ── THESE MOVED WHEN THE UNIT UNDER THEM MOVED (2026-09-10) ─────────────────
// They used to be 2 / 4 / 15 and they were round numbers, never fitted. The
// rates they test are no longer the same quantity: a baseline is now a
// PER-SCHEDULED-GAME expectation rather than a per-game-PLAYED rate (see DEPTH
// in src/lib/playerPriors.js), so "4 carries a game" silently became a stricter
// test than the one anybody chose — it now means four carries in an average
// week rather than four in a week he plays.
//
// Refitted no-lookahead on 2025 (scripts/screen_backup_baseline.mjs --floor),
// scoring a floor the only way a floor can be scored: the share of the league's
// real opportunity the qualifying rows COVER, against how many rows a reader has
// to look at to get it. The rule is the TIGHTEST floor that preserves the
// board's existing coverage — not the loosest one that fits somebody on.
//
//   RB   4 on the old unit    799 rows, 93.9% of carries
//        3.5 on the new       623 rows, 94.7%     +0.8pp of coverage, 176 FEWER rows
//   WR   2 on the old unit   1254 rows, 94.6% of targets
//        1.25 on the new     1111 rows, 96.5%     +2.0pp, 143 fewer rows
//   TE   2 on the old unit    704 rows, 82.1% of targets
//        1.25 on the new      735 rows, 88.1%     +6.0pp, 31 more rows
//
// More coverage from fewer rows, at every position, because the baseline that
// feeds the floor is a better ranker than the one that used to. WR and TE want
// the same number, so there is still one target floor rather than two.
//
// pass_att_pg is UNCHANGED at 15 and was not refitted: a charted QB1 plays 97%
// of his club's games, so the unit barely moved for the only players this clause
// ever admitted. The backup quarterback it now has to judge is settled by
// src/lib/depthPromotion.js instead — unpromoted he projects 3.6 attempts and
// belongs nowhere near a board, promoted he projects 27 and clears 15 easily.
export const ROLE_TIERS = {
  board: { targets_pg: 1.25, carries_pg: 3.5, pass_att_pg: 15 },
  // Moved by the same ratios rather than separately fitted. The Lab's job — be
  // stricter than the board — is unchanged, and the coverage argument above is
  // about a slate view, not a browse-one-player one.
  lab:   { targets_pg: 1.9, carries_pg: 4.4, pass_att_pg: 15 },
};

export function hasRole(s, tier = "lab") {
  if (!s) return false;
  const t = ROLE_TIERS[tier] || ROLE_TIERS.lab;
  return (s.targets_pg || 0) >= t.targets_pg
    || (s.carries_pg || 0) >= t.carries_pg
    || (s.pass_att_pg || 0) >= t.pass_att_pg;
}

/** Sort key: rough total offensive involvement, passing discounted to compare with skill players. */
export function roleScore(s, passDivisor = 3) {
  if (!s) return 0;
  return (s.rec_yards_pg || 0) + (s.rush_yards_pg || 0) + (s.pass_yards_pg || 0) / passDivisor;
}

/**
 * The week a board should open on: the earliest week that has not finished yet,
 * falling back to the last week once the season is over.
 *
 * The boards used to open on `weeks[weeks.length - 1]`, which is right for a
 * COMPLETED season (you want the last week played) and wrong for a live one — on
 * a fresh 2026 schedule every week already exists, so it opened on Week 18, four
 * months of games away.
 */
export function defaultWeek(games, now = new Date()) {
  const weeks = [...new Set(games.map((g) => g.week))].sort((a, b) => a - b);
  if (!weeks.length) return 1;
  for (const w of weeks) {
    // A week is still live if any of its games is not final. Status is a clock
    // question (src/lib/gameStatus.js); the old `gameday >= today` compare used
    // the UTC date, which rolls over during every Sunday-night game.
    const unplayed = games.some((g) => g.week === w && !isFinal(g, now));
    if (unplayed) return w;
  }
  return weeks[weeks.length - 1];
}
