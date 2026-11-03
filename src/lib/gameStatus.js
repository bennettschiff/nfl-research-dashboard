// ── Game status: upcoming / live / final ─────────────────────────────────────
// The board had no idea a game had been played. Its only notion of "final" was
// WeekSlate's `gameday < today` — a label on a slate card, never a filter — so
// on the Saturday after the week-1 opener every Seattle and New England prop was
// still on the board, projected and priced, two days after it had been decided.
//
// There is no score on the `games` row (nflverse's schedule is loaded before the
// season and the ETL does not re-pull it on game night), so status is a CLOCK
// question: kickoff in US Eastern — which is what nflverse's `gametime` is — plus
// a window long enough to cover overtime. Pure; no I/O.

/**
 * Minutes after kickoff a game is treated as over. A regulation NFL game runs
 * ~3h05m and an overtime one rarely past 3h45m; four hours keeps a late
 * overtime game on the board until it has actually ended rather than dropping
 * it during the extra period.
 */
export const GAME_WINDOW_MIN = 240;

/** Kickoff assumed when the schedule has a date but no time: the 1pm ET window. */
const DEFAULT_TIME = "13:00";

/** America/New_York's offset from UTC at an instant, in minutes (−240 in EDT). */
function easternOffsetMin(utcMs) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (t) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((asUtc - utcMs) / 60000);
}

/**
 * Kickoff as a real instant. `gameday` is YYYY-MM-DD and `gametime` HH:MM, both
 * Eastern — including the international games, which nflverse lists in ET.
 * Resolving through Intl rather than a hard-coded −4 keeps the November games
 * after the DST change an hour right.
 */
export function kickoffAt(g) {
  if (!g?.gameday) return null;
  const [y, m, d] = g.gameday.split("-").map(Number);
  const [hh, mm] = (g.gametime || DEFAULT_TIME).split(":").map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  // Two passes: the offset at a first guess, then at the corrected instant.
  let off = easternOffsetMin(naive + 4 * 3600e3);
  off = easternOffsetMin(naive - off * 60000);
  return new Date(naive - off * 60000);
}

/** "upcoming" | "live" | "final". A game with no date is always upcoming. */
export function gameStatus(g, now = new Date()) {
  const k = kickoffAt(g);
  if (!k) return "upcoming";
  const t = now.getTime();
  if (t < k.getTime()) return "upcoming";
  return t < k.getTime() + GAME_WINDOW_MIN * 60000 ? "live" : "final";
}

export const isFinal = (g, now) => gameStatus(g, now) === "final";
