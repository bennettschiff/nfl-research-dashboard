// ── Game lines: totals and spreads ───────────────────────────────────────────
// Pure math for the game-level model, so the board, the backtest harness and any
// pick gate all evaluate the same numbers. Nothing here reads a file or a table.
//
// THE MODEL is a weighted off/def power rating fit on points:
//
//     home_pts = mu + off[home] + def[away] + hfa/2
//     away_pts = mu + off[away] + def[home] - hfa/2
//     total    = home_pts + away_pts
//     margin   = home_pts - away_pts        (home-positive, matching nflverse
//                                            spread_line, which is HOME-positive
//                                            — verified, not assumed)
//
// WHY POINTS AND NOT EPA. EPA per play is the better description of team quality
// and the worse predictor of a SCORE, because it has to be multiplied back
// through pace, red-zone conversion and special teams to become points, and each
// of those steps adds error. Points already contain all of it. EPA earns its
// place inside the player models, where the question is rate-shaped; here the
// question is "how many points", so the target and the feature are the same unit.
//
// ── THIS IS AN ANCHOR, NOT A SIGNAL (measured 2026-09-18) ────────────────────
// research/game-lines-2026-09-18/ builds the maximal version of this idea: the
// same off/def decomposition run over TWELVE metrics rather than points alone
// (EPA/play, success, explosive, turnovers, sack rate, plays, pace, PROE,
// red-zone TD rate, field position, points per drive), plus weather, rest,
// division and a shrunk starting-QB rating, ridge-fit walk-forward. On 816
// held-out games it is closer to the market than this model is and still loses
// to the closing line — total MAE 10.34 vs 10.12, spread 10.26 vs 9.74 — and
// picks the right side of the line 51.7% of the time on totals and 47.6% on
// spreads, against 52.38% break-even. Our deviation from the line explains 0.2%
// of the total line's error and 0.7% of the spread's, with a NEGATIVE slope on
// spreads out of sample.
//
// So: use this number where no line exists (a week-1 slate, a Matchup Lab
// hypothetical, an implied team total for a game the board has not priced). Do
// not read a disagreement with a posted line as an edge. The ceiling on adding
// more football to it is written down in that report, and it is close to zero.
//
// WHY SHRINKAGE IS LOAD-BEARING. Through week 3 a team has three games; an
// unshrunk offensive rating off a 3-game sample is mostly noise, and a model that
// believes it will hand you a 62-point total in September. Each rating is pulled
// toward zero by n/(n+PRIOR_GAMES), so an early-season team is mostly league
// average and earns its way off the mean.

/** Ratings shrink toward league average with this many games of prior weight. */
export const PRIOR_GAMES = 6;
/** Recency half-life in days. ~1 season, so last year is present but faded. */
export const HALF_LIFE_DAYS = 180;
/** Ignore anything older than this — a 5-year-old roster is not this team. */
export const MAX_LOOKBACK_DAYS = 900;
/** Coordinate-descent passes. It converges in well under this. */
const ITERS = 40;

const wmean = (pairs) => {
  let sw = 0, sx = 0;
  for (const [x, w] of pairs) { sw += w; sx += x * w; }
  return sw > 0 ? sx / sw : 0;
};

/**
 * Fit off/def ratings from completed games.
 *
 * `games` are {home, away, homeScore, awayScore, date}. `asOf` is the date the
 * prediction is being made for — every game on or after it is excluded, which is
 * what makes a walk-forward backtest honest rather than a description of games
 * the model has already seen.
 */
export function fitRatings(games, asOf, opts = {}) {
  const priorGames = opts.priorGames ?? PRIOR_GAMES;
  const halfLife = opts.halfLifeDays ?? HALF_LIFE_DAYS;
  const maxBack = opts.maxLookbackDays ?? MAX_LOOKBACK_DAYS;
  const cutoff = new Date(asOf).getTime();

  const used = [];
  for (const g of games) {
    const t = new Date(g.date).getTime();
    if (!(t < cutoff)) continue;                       // strict: no same-day leakage
    const daysBack = (cutoff - t) / 86400000;
    if (daysBack > maxBack) continue;
    used.push({ ...g, w: Math.pow(0.5, daysBack / halfLife) });
  }
  if (!used.length) return null;

  const mu = wmean(used.flatMap((g) => [[g.homeScore, g.w], [g.awayScore, g.w]]));
  const hfa = wmean(used.map((g) => [g.homeScore - g.awayScore, g.w]));

  const teams = new Set();
  for (const g of used) { teams.add(g.home); teams.add(g.away); }
  const off = {}, def = {};
  for (const t of teams) { off[t] = 0; def[t] = 0; }

  // Per-team game lists, built once — the inner loop runs ITERS times.
  const byTeam = {};
  for (const t of teams) byTeam[t] = [];
  for (const g of used) {
    byTeam[g.home].push({ opp: g.away, scored: g.homeScore, allowed: g.awayScore, edge: hfa / 2, w: g.w });
    byTeam[g.away].push({ opp: g.home, scored: g.awayScore, allowed: g.homeScore, edge: -hfa / 2, w: g.w });
  }

  for (let it = 0; it < ITERS; it++) {
    for (const t of teams) {
      const gs = byTeam[t];
      const n = gs.reduce((s, x) => s + x.w, 0);
      const rawOff = wmean(gs.map((x) => [x.scored - mu - def[x.opp] - x.edge, x.w]));
      const rawDef = wmean(gs.map((x) => [x.allowed - mu - off[x.opp] + x.edge, x.w]));
      off[t] = rawOff * (n / (n + priorGames));
      def[t] = rawDef * (n / (n + priorGames));
    }
  }
  return { mu, hfa, off, def, sampleGames: used.length };
}

/**
 * Predict one game. Unknown teams fall back to league average rather than
 * throwing — an expansion team or a mid-file abbreviation change should degrade
 * to "no opinion", not take the board down.
 */
export function predictGame(r, home, away) {
  if (!r) return null;
  const oh = r.off[home] ?? 0, dh = r.def[home] ?? 0;
  const oa = r.off[away] ?? 0, da = r.def[away] ?? 0;
  const homePts = r.mu + oh + da + r.hfa / 2;
  const awayPts = r.mu + oa + dh - r.hfa / 2;
  return {
    homePts, awayPts,
    total: homePts + awayPts,
    margin: homePts - awayPts,          // home-positive
  };
}

/**
 * Implied points for one side — the handoff from the game model to the player
 * models. A quarterback's touchdown expectation is a share of his own team's
 * points, so this is the number the prop models should hang off rather than
 * each re-deriving a team total from scratch.
 */
export function impliedTeamPoints(pred, side) {
  if (!pred) return null;
  return side === "home" ? pred.homePts : pred.awayPts;
}

/**
 * Convert a market total + spread into the same shape, so a model number and a
 * market number are directly comparable and the board can show either.
 * spreadLine is HOME-POSITIVE (nflverse convention).
 */
export function fromMarket(totalLine, spreadLine) {
  if (totalLine == null || spreadLine == null) return null;
  const homePts = (totalLine + spreadLine) / 2;
  return { homePts, awayPts: totalLine - homePts, total: totalLine, margin: spreadLine };
}
