// ── Player-name matching ─────────────────────────────────────────────────────
// Books, rosters and nflverse all spell the same player differently, and every
// consumer of odds data has to reconcile them: the board, the historical-odds
// backtest, and any future grader.
//
// This module has NO dependencies on purpose. src/lib/odds.js carries the same
// two functions for the browser path, but it imports the Supabase client at
// module load, so a Node script that only wants to normalise a name cannot
// import it without a configured browser client. Scripts import from here.
// src/lib/odds.test.js asserts the two implementations agree, so they cannot
// drift apart silently.

/**
 * Strip accents, punctuation and generational suffixes.
 * "Amon-Ra St. Brown" → "amonra st brown"
 */
export const normName = (s) => (s || "").toLowerCase().normalize("NFD")
  .replace(/[̀-ͯ]/g, "")
  .replace(/[.'’-]/g, "")
  .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
  .replace(/\s+/g, " ").trim();

/**
 * First initial + surname, e.g. "k|gainwell" — the nickname fallback.
 * Books write "Kenny Gainwell" and "Joshua Palmer" where the roster says
 * "Kenneth" and "Josh"; no amount of punctuation stripping closes that.
 *
 * Only ever a FALLBACK, and only when it resolves to exactly one player in the
 * scope being matched. A market silently attached to the wrong player is far
 * worse than an unmatched one.
 */
export const looseName = (s) => {
  const parts = normName(s).split(" ").filter(Boolean);
  if (parts.length < 2) return null;
  return `${parts[0][0]}|${parts[parts.length - 1]}`;
};

/**
 * Build name → id lookups from a roster, returning an exact map and a loose map
 * with every ambiguous loose key removed rather than arbitrarily resolved.
 */
export function buildNameIndex(players, { nameKey = "full_name", idKey = "player_id" } = {}) {
  const exact = new Map();
  const looseCounts = new Map();
  for (const p of players) {
    const n = normName(p[nameKey]);
    if (!n) continue;
    if (!exact.has(n)) exact.set(n, p[idKey]);
    const ln = looseName(p[nameKey]);
    if (!ln) continue;
    const cur = looseCounts.get(ln);
    if (cur === undefined) looseCounts.set(ln, p[idKey]);
    else if (cur !== p[idKey]) looseCounts.set(ln, null);   // ambiguous → unusable
  }
  const loose = new Map([...looseCounts].filter(([, v]) => v != null));
  return { exact, loose };
}

/** Exact match, then the unambiguous loose fallback. null when neither hits. */
export function resolveName(index, name) {
  const hit = index.exact.get(normName(name));
  if (hit != null) return hit;
  const ln = looseName(name);
  return (ln && index.loose.get(ln)) ?? null;
}
