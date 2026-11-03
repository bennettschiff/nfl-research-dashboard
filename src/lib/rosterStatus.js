// ── The fast half of a player's identity ─────────────────────────────────────
// scripts/out/player_priors_2026.json freezes two kinds of fact together, and
// they keep completely different time:
//
//   SLOW  last season's per-game rates. Measured over a finished season; they
//         will never change again. Freezing them is correct.
//   FAST  which team he is on, whether he is on a roster at all, and where the
//         club lists him on its depth chart. These move on waiver Wednesday,
//         at the deadline, and every time a club refiles.
//
// The priors artifact was built on 2026-08-09 and nothing refreshed it, so the
// board opened week 1 of 2026 with 65 players on the wrong team — Kayshon
// Boutte projected into New England's target pool three weeks after Houston
// traded for him, taking targets from receivers who are actually Patriots.
//
// scripts/pull_roster.mjs owns the fast half now and rewrites this artifact on
// its own cadence. This module lays it over the frozen priors.
//
// ── WHY THIS IS NOT A SUPABASE TABLE ─────────────────────────────────────────
// api/season.js exists because the board was making fourteen browser reads
// against a shared instance that then spent six hours I/O-throttled. This
// overlay is ~15 KB gzipped and is imported into the Vite build exactly the way
// player_priors_2026.json already is, so it is served from the CDN with the rest
// of the bundle and costs Supabase no rows, no requests and no egress.
import ROSTER_2026 from "../../scripts/out/roster_status_2026.json" with { type: "json" };
import PRIOR_DEPTH_2025 from "../../scripts/out/prior_depth_rank_2025.json" with { type: "json" };

const index = (doc) => ({
  meta: doc.meta || {},
  byId: Object.fromEntries((doc.players || []).map((r) => [r.player_id, r])),
  size: (doc.players || []).length,
});

const BY_SEASON = { 2026: index(ROSTER_2026) };

/**
 * Below this, treat the overlay as BROKEN and fall back to the frozen priors
 * wholesale rather than half-applying it.
 *
 * The dangerous failure is not a missing overlay, it is a TRUNCATED one: absence
 * from a healthy overlay means "not on an NFL roster", which drops the player
 * from the board. If a pull half-failed and wrote 40 players, that rule would
 * silently empty the board instead of erroring. 32 clubs carry ~900 skill
 * players between them; 500 is comfortably below any real roster state and
 * comfortably above any partial write.
 */
const MIN_HEALTHY = 500;

const healthy = (season) => (BY_SEASON[season]?.size ?? 0) >= MIN_HEALTHY;

/** Whether a season has a usable roster overlay at all. */
export function hasRosterStatus(season) {
  return healthy(season);
}

/** When the overlay was pulled, and which depth-chart snapshot it used. */
export function rosterStatusMeta(season) {
  return healthy(season) ? BY_SEASON[season].meta : null;
}

/** One player's live roster row, or null. */
export function rosterStatusFor(season, playerId) {
  if (!healthy(season)) return null;
  return BY_SEASON[season].byId[playerId] || null;
}

/**
 * Lay the live roster over one frozen prior row.
 *
 * Returns a NEW row; never mutates the artifact (it is a shared module-level
 * import, and mutating it would leak between callers and across tests).
 *
 * Three things change, and each of them is load-bearing:
 *
 *   team_abbr    what the board groups by. Wrong here and the player is
 *                projected into the wrong team's game entirely.
 *
 *   depth_rank   what isProjectable() gates on. A stale August chart keeps
 *                projecting a man who has since been buried or cut, and hides
 *                one who has since been promoted. `null` is written through
 *                deliberately: "not on the current chart" is the answer that
 *                gate wants, and leaving the August rank in place underneath
 *                would defeat the refresh.
 *
 *   changed_team RECOMPUTED against the live team, not read from the artifact.
 *                This one is a model change, not bookkeeping: changed_team
 *                selects the ~4x faster weaning schedule in CARRYOVER, on the
 *                reasoning that a mover's prior describes a role he no longer
 *                holds. Boutte's prior is a New England role. Carrying it into
 *                Houston at the SAME-team rate would trust it four times longer
 *                than the calibration says it deserves.
 */
export function applyRosterStatus(season, prior) {
  if (!prior || !healthy(season)) return prior;
  const live = BY_SEASON[season].byId[prior.player_id];

  if (!live) {
    // Not on any club's skill-position roster. He is not playing on Sunday, and
    // a null depth_rank is how isProjectable() is already told that.
    return { ...prior, depth_rank: null, depth_pos: null, roster_status: "OFF", off_roster: true };
  }

  const team = live.team_abbr || prior.team_abbr;
  return {
    ...prior,
    team_abbr: team,
    position: live.position || prior.position,
    depth_rank: live.depth_rank,
    depth_pos: live.depth_pos,
    depth_team: live.depth_team,
    roster_status: live.status,
    off_roster: false,
    // `prior_team` is where the carried rates were EARNED and must not be
    // overwritten — it is the other half of this comparison.
    changed_team: !!(prior.prior_team && team && prior.prior_team !== team),
  };
}

// ── the rank a carried baseline was EARNED at ────────────────────────────────
// The other half of roleShiftMult(): where the club listed him while the
// baseline was being measured, against where it lists him now. Built once per
// finished season by scripts/build_prior_depth.mjs.
const PRIOR_DEPTH = { 2025: Object.fromEntries(PRIOR_DEPTH_2025.map((r) => [r.player_id, r])) };

/**
 * The depth context projectPlayer() consumes: current rank, and the rank the
 * baseline was earned at.
 *
 * Returns nulls freely. roleShiftMult() treats a missing rank on either side as
 * "no information" and returns 1 — which is the right default, because the
 * alternative is inventing a role change out of a gap in the data.
 *
 * ONLY COMPARES LIKE WITH LIKE. nflverse rewrote the depth-chart format between
 * 2024 and 2025: the old one lists the top three at each position, the new one
 * lists the whole room, so a 2024 rank and a 2025 rank are not the same unit and
 * differencing them measures the schema change. 2025 and 2026 are both the new
 * format. `priorSeason` is checked against the seasons we hold rather than
 * assumed, so a baseline carried from further back yields no comparison instead
 * of a false one.
 *
 * @param season       the season being projected
 * @param playerId
 * @param priorSeason  the season the baseline was earned in (prior.prior_season)
 */
export function depthContextFor(season, playerId, priorSeason) {
  const live = rosterStatusFor(season, playerId);
  const earned = priorSeason != null ? PRIOR_DEPTH[priorSeason]?.[playerId] : null;
  const rank = live?.depth_rank ?? null;
  const rankEarned = earned?.prior_depth_rank ?? null;
  // A player charted at a different position last season (a receiver moved to
  // running back) has no comparable rank: the rooms are different sizes and the
  // comparison would be meaningless.
  if (rank != null && rankEarned != null && live?.depth_pos && earned?.prior_depth_pos
      && live.depth_pos !== earned.prior_depth_pos) {
    return { rank, rankEarned: null };
  }
  return { rank, rankEarned };
}
