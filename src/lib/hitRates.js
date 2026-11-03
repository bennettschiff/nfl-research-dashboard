// ── Hit rates: how often a player has cleared THIS line ─────────────────────
// The props.cash view of a prop: last 5 / 10 / 20, this season, last season,
// head-to-head against tonight's opponent, and the current streak — every one
// measured against the row's own line, so "L10 70%" means seven of his last ten
// games went over the number on the board.
//
// It is DISPLAY, not model. Nothing in projectPlayer reads it, and nothing should
// gate on it: a hit rate is a small-sample empirical frequency against a line the
// book set for THIS week, and last year's games were played against different
// lines, roles and teammates. It answers "is the market's number where he usually
// lands", which is a question a bettor asks, not one the projection needs.
//
// NO LOOKAHEAD: only games strictly before the row's (season, week) count, so a
// finished week's board does not grade itself with its own result.

/** prop_type → the week-row stat it settles on. */
export const STAT_OF = {
  pass_yards: (w) => w.pass_yards,
  rush_yards: (w) => w.rush_yards,
  rec_yards: (w) => w.rec_yards,
  receptions: (w) => w.receptions,
  rush_att: (w) => w.carries,
  completions: (w) => w.completions,
  pass_tds: (w) => w.pass_tds,
  // Anytime TD settles on a rushing or receiving score. A passing TD is not his.
  anytime_td: (w) => (w.rush_tds ?? 0) + (w.rec_tds ?? 0),
};

/** A player's games before `game`, most recent first. */
export function gamesBefore(weeks, game) {
  if (!weeks?.length) return [];
  return weeks
    .filter((w) => w.season < game.season || (w.season === game.season && w.week < game.week))
    .sort((a, b) => (b.season - a.season) || (b.week - a.week));
}

/**
 * One rate over a slice of games. A game landing exactly ON the line is a push:
 * it is neither a hit nor a miss and leaves the denominator, the way the book
 * settles it.
 *
 * @returns {{hits:number, n:number, rate:number|null}}
 */
function rateOf(games, stat, line) {
  let hits = 0, n = 0;
  for (const w of games) {
    const v = stat(w);
    if (v == null || !Number.isFinite(Number(v))) continue;
    if (Number(v) === line) continue;
    n++;
    if (Number(v) > line) hits++;
  }
  return { hits, n, rate: n ? hits / n : null };
}

/**
 * Signed run of consecutive results from the most recent game: +3 is three
 * straight overs, −2 two straight unders, 0 no games. A push ends the run.
 */
export function streakOf(games, stat, line) {
  let k = 0;
  for (const w of games) {
    const v = Number(stat(w));
    if (!Number.isFinite(v) || v === line) break;
    const s = v > line ? 1 : -1;
    if (k === 0 || Math.sign(k) === s) k += s;
    else break;
  }
  return k;
}

/**
 * Every hit-rate cell for one board row.
 *
 * @param history  the player's week rows, any seasons (see gamesBefore)
 * @param propType the row's prop
 * @param line     the row's line — the book's when posted, the model's otherwise
 * @param game     the row's game ({ season, week })
 * @param opp      the row's opponent, for H2H
 * @returns null when the prop has no settling stat or the line is unknown
 */
export function hitRates(history, propType, line, game, opp) {
  const stat = STAT_OF[propType];
  if (!stat || line == null || !game) return null;
  const past = gamesBefore(history, game);
  return {
    l5: rateOf(past.slice(0, 5), stat, line),
    l10: rateOf(past.slice(0, 10), stat, line),
    l20: rateOf(past.slice(0, 20), stat, line),
    szn: rateOf(past.filter((w) => w.season === game.season), stat, line),
    prev: rateOf(past.filter((w) => w.season === game.season - 1), stat, line),
    h2h: rateOf(past.filter((w) => w.opponent === opp), stat, line),
    streak: streakOf(past, stat, line),
    games: past.length,
  };
}
