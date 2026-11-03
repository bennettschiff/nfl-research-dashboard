// ── The live defensive roster ────────────────────────────────────────────────
// The sack model's evidence is frozen (scripts/out/sack_priors_<season>.json:
// recency-weighted pass-rush opportunities, sacks, QB hits). His CLUB and his
// ROSTER STATUS are not, and that artifact was carrying both anyway — set at
// whatever moment scripts/build_sack_priors.py last ran.
//
// It showed exactly the way CLAUDE.md says this always shows. Myles Garrett was
// the top row of the week-2 sack board, projected 1.01, while Los Angeles had
// him on RESERVE: the builder's allowlist counted RES as rostered, and nothing
// refreshed it afterwards. That is not a sack bug, it is the skill board's
// wrong-team bug (src/lib/rosterStatus.js) repeated on the defence.
//
// So this is the defensive half of the same split: scripts/pull_roster.mjs
// writes roster_defense_<season>.json three times a week (Wed/Thu/Sat, see
// .github/workflows/roster-pull.yml) and this module lays it over the frozen
// priors. Bundled, not fetched, for the reason rosterStatus.js is: the board's
// 2026-09-08 egress incident was request COUNT, and ~170 KB raw / ~20 KB
// gzipped rides the CDN with the rest of the build for nothing.
//
// Pure — a module-level JSON import and no I/O, so scripts/snapshot_sacks.mjs
// and the backtest read the same roster the board does.
import ROSTER_DEF_2026 from "../../scripts/out/roster_defense_2026.json" with { type: "json" };

const index = (doc) => ({
  meta: doc.meta || {},
  byId: Object.fromEntries((doc.players || []).map((r) => [r.player_id, r])),
  size: (doc.players || []).length,
});

const BY_SEASON = { 2026: index(ROSTER_DEF_2026) };

/**
 * Below this, treat the overlay as BROKEN and leave the priors alone.
 *
 * Same rule and same reasoning as rosterStatus.js MIN_HEALTHY: the dangerous
 * failure is a TRUNCATED overlay, because absence from a healthy one means "not
 * on an NFL roster" and drops the player. 32 clubs carry ~1,400 defenders
 * between them; 800 is comfortably below any real roster state and comfortably
 * above any partial write.
 */
const MIN_HEALTHY = 800;

const healthy = (season) => (BY_SEASON[season]?.size ?? 0) >= MIN_HEALTHY;

/** Whether a season has a usable defensive overlay at all. */
export const hasDefenseRoster = (season) => healthy(season);

/** When the overlay was pulled. */
export const defenseRosterMeta = (season) => (healthy(season) ? BY_SEASON[season].meta : null);

/** One defender's live roster row, or null. */
export function defenseRosterFor(season, playerId) {
  if (!healthy(season)) return null;
  return BY_SEASON[season].byId[playerId] || null;
}

/**
 * Lay the live roster over one frozen sack-prior row.
 *
 * Returns a NEW row (never mutates the bundled artifact) carrying:
 *
 *   team          the club he is on TODAY. Wrong here and he is projected into
 *                 a game his new club is not playing.
 *   status        the roster status src/lib/injuries.js reads — RES is IR, CUT
 *                 is cut, DEV is the practice squad. This is the field the
 *                 board turns into an availability chip and a default filter.
 *   offRoster     true when he cannot take a snap for this club.
 *
 * A defender the overlay does not carry at all is off-roster: the artifact holds
 * every player on any club's DL/LB/DB list, so absence is an answer. With no
 * healthy overlay the prior is returned untouched — the pre-overlay behaviour,
 * which is degraded rather than empty.
 */
export function applyDefenseRoster(season, prior) {
  if (!prior) return prior;
  if (!healthy(season)) return { ...prior, status: null, offRoster: !prior.rostered };

  const live = BY_SEASON[season].byId[prior.pid];
  if (!live) return { ...prior, team: prior.team, status: "OFF", offRoster: true };

  return {
    ...prior,
    team: live.team_abbr || prior.team,
    pos: live.position || prior.pos,
    status: live.status || null,
    offRoster: OFF_ROSTER.has((live.status || "").toUpperCase()),
  };
}

/**
 * Roster statuses that mean he is not available to play for this club.
 *
 * The same set src/lib/injuries.js OFF_ROSTER keys on, plus EXE (the exempt
 * list) and the synthetic OFF this module writes for a player who has left every
 * roster. DEV — the practice squad — is deliberately NOT here: a practice-squad
 * defender can be elevated on Saturday and play on Sunday, and the injury report
 * is what says whether he will.
 */
const OFF_ROSTER = new Set(["RES", "CUT", "RET", "INA", "E14", "EXE", "OFF"]);

/** Is this roster status one that keeps a man off the field? */
export const isOffRoster = (status) => OFF_ROSTER.has((status || "").toUpperCase());
