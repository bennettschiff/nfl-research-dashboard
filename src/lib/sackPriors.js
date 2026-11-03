// ── Sack priors: the artifact, and the week's board off it ───────────────────
// scripts/out/sack_priors_<season>.json is built by scripts/build_sack_priors.py
// and bundled rather than fetched — it is ~160 KB, and the board's egress
// incident (CLAUDE.md) was request COUNT, so a new Supabase table to hold this
// would walk that back for nothing.
//
// The artifact holds EVIDENCE, never a projection: recency-weighted pass-rush
// opportunities, sacks and QB hits per player, sacks allowed per offensive line,
// and the league rates they shrink toward. All of the modelling is in sacks.js,
// so the board, the weekly freeze and the backtest cannot drift apart.
//
// A PLAYER'S TEAM IS NOT A PRIOR, AND NEITHER IS HIS ROSTER STATUS. The builder
// stamps both from the live nflverse roster at the moment it runs, which makes
// them as stale as its last run — the same mistake CLAUDE.md records for the
// skill-position priors, and it bit here in exactly the same way: Myles Garrett
// topped the week-2 board at 1.01 projected sacks while Los Angeles had him on
// RESERVE. src/lib/rosterDefense.js is the fast half, refreshed three times a
// week, and it is laid over every row below before anything is projected.
import SACK_2026 from "../../scripts/out/sack_priors_2026.json" with { type: "json" };
import { sackLambda, sackRungs, sackProbOver, sackPushProb, sackEvTrusted, sackOppAdj } from "./sacks.js";
import { bestSackOffer, sackRungCount } from "./odds.js";
import { applyDefenseRoster } from "./rosterDefense.js";
import { normName } from "./names.js";

const BY_SEASON = { 2026: SACK_2026 };

export const hasSackPriors = (season) => !!BY_SEASON[season];
export const sackPriors = (season) => BY_SEASON[season] || null;

/**
 * Below this a projection is not a prop — no book posts a 0.25 line on a man who
 * rushes the passer eight times a game, and carrying him only pads the board.
 * The frozen weekly record uses the same floor so the graded set is the shown one.
 */
export const SACK_BOARD_FLOOR = 0.10;

/**
 * Every projectable defender in a set of games.
 *
 * `games` are the week's rows from the season data (game_id, home_team,
 * away_team, spread_line — HOME-positive, nflverse convention).
 *
 * `sackOdds` is the ladder index from indexSackOdds (d.sackOdds). When it is
 * given, each row carries the rung our number likes best across every book that
 * posted him. It is optional: the board is a projection first and shows one with
 * or without a market, which is the whole point of a market nobody else prices.
 *
 * Returns [] rather than throwing when the season has no artifact, so a season
 * flip that has not built one yet shows an empty board instead of a stack trace.
 */
export function sackBoard(season, games, { floor = SACK_BOARD_FLOOR, sackOdds = null } = {}) {
  const art = sackPriors(season);
  if (!art || !games?.length) return [];

  // The live overlay first, the gate second — the order matters. A defender the
  // artifact has on the wrong club would otherwise be gated into the wrong
  // game before anything could move him, which is the skill board's bug.
  //
  // `rostered` from the artifact is NOT trusted on its own: the builder's own
  // allowlist counted RES (injured reserve) as rostered, so a man on IR carried
  // `rostered: true` and sat at the top of the board. The overlay's status is
  // the authority, and the frozen flag survives only as the fallback for a
  // season with no overlay built.
  const byTeam = new Map();
  for (const raw of art.players) {
    const p = applyDefenseRoster(season, raw);
    if (p.offRoster) continue;                     // IR, cut, retired, or gone
    if (!p.team) continue;
    if (!byTeam.has(p.team)) byTeam.set(p.team, []);
    byTeam.get(p.team).push(p);
  }

  const rows = [];
  for (const g of games) {
    for (const side of ["home", "away"]) {
      const team = side === "home" ? g.home_team : g.away_team;
      const opp = side === "home" ? g.away_team : g.home_team;
      // spread_line is home-positive, so the home side's own number is +line.
      const spread = g.spread_line == null ? 0 : (side === "home" ? g.spread_line : -g.spread_line);
      const line = art.offense[opp] || null;
      for (const p of byTeam.get(team) || []) {
        const lambda = sackLambda(p, line, art.league, spread);
        if (lambda == null || lambda < floor) continue;
        const mkt = sackOdds?.get(`${g.game_id}|${normName(p.name)}`) || null;
        rows.push({
          ...p, opp, spread, game_id: g.game_id, week: g.week, gameday: g.gameday,
          gametime: g.gametime, side, lambda, ...sackRungs(lambda),
          oppSackRateAllowed: line && line.dropbacks > 0 ? line.sacksAllowed / line.dropbacks : null,
          // The one matchup multiplier this model has, so a board row can show
          // the factor the projection actually used. See sackOppAdj().
          oppAdj: sackOppAdj(line, art.league),
          offer: mkt ? bestSackOffer(mkt, (ln) => sackProbOver(lambda, ln), (ln) => sackPushProb(lambda, ln)) : null,
          rungs: sackRungCount(mkt),
          evTrusted: sackEvTrusted(p.pos),
        });
      }
    }
  }
  return rows.sort((a, b) => b.lambda - a.lambda);
}
