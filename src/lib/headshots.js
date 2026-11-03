// ── Player headshots and team logos ──────────────────────────────────────────
// Both are nflverse fields that point at the league's own CDNs — headshots at
// static.www.nfl.com (roster `headshot_url`), logos at ESPN (`team_logo_espn`,
// scripts/etl.py → teams.logo). Hot-linked, never copied into the bundle.
//
// Skill players come off `d.players` (the ETL table, with the live roster
// overlay and the priors filling gaps — src/lib/seasonData.js). Defenders are
// not in that table; their headshot rides the defensive overlay
// (scripts/pull_roster.mjs toDefenseRows), so the sack board gets faces too.
//
// Pure lookups. A miss returns null and the component falls back to the logo,
// then initials — a broken image is never shown.
import { defenseRosterFor } from "./rosterDefense.js";

export function headshotOf(d, playerId) {
  if (!playerId) return null;
  return d?.players?.[playerId]?.headshot_url
    || defenseRosterFor(d?.year, playerId)?.headshot_url
    || null;
}

export const logoOf = (d, abbr) => (abbr ? d?.teams?.[abbr]?.logo || null : null);

/**
 * A headshot by NAME on a team, for the places that only carry a name — the
 * schedule's starting QBs (games.json has `away_qb`, no id). Matched on the club
 * so two players sharing a name cannot swap faces; a miss is null, never a guess.
 */
export function headshotByName(d, name, team) {
  if (!name || !d?.players) return null;
  for (const p of Object.values(d.players)) {
    if (p.full_name === name && (!team || p.team_abbr === team)) return p.headshot_url || null;
  }
  return null;
}
