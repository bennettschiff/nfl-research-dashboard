// ── Team abbreviation normalisation (JS mirror of scripts/nflteams.py) ───────
// CANONICAL FORM IS WHATEVER teams.json AND THE STATS FILES USE, and for the
// Rams that is "LA" — not "LAR". Getting this backwards is silently destructive:
// a Rams player written as "LAR" joins to no game, no defensive profile and no
// team prior, so all 28 of them vanish from the board with no error anywhere.
//
// This mirror exists because the Node scripts had each grown their own map and
// two of them had it inverted (pull_injuries.mjs mapped LA→LAR, plus six
// abbreviations — WSH, ARZ, BLT, CLV, HST, JAC — that nflverse has not emitted
// in years and that the Python map deliberately does not carry).
//
// Keep this in step with scripts/nflteams.py. Add to the map rather than
// special-casing at a call site.
export const TEAM_ALIASES = {
  AZ: "ARI",     // some roster releases only; every other source says ARI
  LAR: "LA",     // stats files use LA
  OAK: "LV",     // relocation
  SD: "LAC",     // relocation
  STL: "LA",     // relocation
};

/** Canonicalise one abbreviation. Passes through null and unknown values. */
export function normTeam(t) {
  if (t == null) return null;
  const s = String(t).trim().toUpperCase();
  if (!s) return null;
  return TEAM_ALIASES[s] || s;
}
