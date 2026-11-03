// ── Season assembly: raw tables → the object every board reads ───────────────
// The pure half of loadSeason(). Split out of loadData.js because that module
// imports supabase.js (import.meta.env at module scope), and the pick ledger —
// scripts/snapshot_picks.mjs — must build the SAME `d` the board builds, from
// the same tables, in Node. Two assemblies would drift, and the ledger would
// then be recording a board nobody was shown.
//
// No I/O here. loadData.js fetches in the browser, scripts/lib/season.mjs in Node.
import { blendPlayerSeason, playerPriorsFor, hasPlayerPriors } from "./playerPriors.js";
import { defensePriorFor, hasDefensePriors } from "./defensePriors.js";
import { indexOdds, indexSackOdds } from "./odds.js";
import { indexInjuries } from "./injuries.js";
import { indexGameLines } from "./gameMarkets.js";
import { rosterStatusFor, hasRosterStatus } from "./rosterStatus.js";

/**
 * The season's projectable player rows.
 *
 * Pre-flip: the live aggregates, exactly as before.
 * Post-flip: one row per player on a 2026 roster, each a blend of his prior
 * season and however much of the live season exists — so the board is populated
 * in week 1 and converges on live data at the measured rate.
 */
export function rosterFor(season, liveRows) {
  if (!hasPlayerPriors(season)) return liveRows;

  const liveById = Object.fromEntries(liveRows.map((r) => [r.player_id, r]));
  const priors = playerPriorsFor(season);
  const out = [];

  for (const [pid, prior] of Object.entries(priors)) {
    const row = blendPlayerSeason(prior, liveById[pid] || null);
    if (row) out.push(row);            // null = a rookie with no snaps yet
  }
  // A player with live rows but no prior (mid-season signing off the street,
  // or a roster file that lags a transaction) still belongs on the board.
  for (const [pid, live] of Object.entries(liveById)) {
    if (!priors[pid]) out.push(live);
  }
  return out;
}

/**
 * The most recent profile at or before `season`, per player.
 *
 * Profiles are built from played games, so in week 1 of a new season the only
 * one that exists is last year's. Taking the newest available — rather than
 * filtering to `season` and finding nothing — is what keeps the card populated
 * at a flip, and `season` on the returned row is what lets the UI label it
 * honestly.
 */
export function latestProfiles(rows, season) {
  const out = {};
  for (const r of rows) {
    if (r.season > season) continue;              // never show a future profile
    const cur = out[r.player_id];
    if (!cur || r.season > cur.season) out[r.player_id] = r;
  }
  return out;
}

/** player_id → { season: profile }, never a future season. */
export function profilesBySeason(rows, season) {
  const out = {};
  for (const r of rows) {
    if (r.season > season) continue;
    (out[r.player_id] ||= {})[r.season] = r;
  }
  return out;
}

/** Build the season object from its raw tables. See loadSeason() for what each is. */
export function assembleSeason({ season, weeks, players, seasonAgg, splits, profiles, games, defense, offense, teams, oddsRows, injuries, gameLineRows = [] }) {
  const byTeam = (arr) => Object.fromEntries(arr.map((x) => [x.team_abbr, x]));
  const byId = (arr) => Object.fromEntries(arr.map((x) => [x.player_id, x]));

  // TWO WEEK MAPS, and the distinction is load-bearing.
  //
  // `weeksByPlayer` is CURRENT SEASON ONLY and feeds the model — recentBaseline
  // blends recent form into the projection. Handing it last season's weeks at a
  // flip would blend a prior season in twice, since playerPriors.js already
  // carries exactly that, and would silently corrupt every projection.
  //
  // `logWeeksByPlayer` is for DISPLAY only and falls back to the most recent
  // season the player has games in. At a flip the current-season log is empty,
  // and an empty table is useless — a player's last-season log is precisely the
  // context you want beside a carried-forward projection.
  const weeksByPlayer = {};
  for (const w of weeks.filter((x) => x.season === season)) {
    (weeksByPlayer[w.player_id] ||= []).push(w);
  }

  const logSeasonByPlayer = {};
  for (const w of weeks) {
    if (w.season > season) continue;                    // never show a future season
    const cur = logSeasonByPlayer[w.player_id];
    if (cur == null || w.season > cur) logSeasonByPlayer[w.player_id] = w.season;
  }
  // `historyByPlayer` is every season at or before this one, for the board's
  // hit-rate columns (src/lib/hitRates.js), which need L20 and last season in
  // week 1. DISPLAY only, like logWeeksByPlayer — never hand it to the model.
  const historyByPlayer = {};
  for (const w of weeks) {
    if (w.season > season) continue;
    (historyByPlayer[w.player_id] ||= []).push(w);
  }

  const logWeeksByPlayer = {};
  for (const w of weeks) {
    if (w.season !== logSeasonByPlayer[w.player_id]) continue;
    (logWeeksByPlayer[w.player_id] ||= []).push(w);
  }

  const roster = rosterFor(season, seasonAgg.filter((x) => x.season === season));

  // Defensive scheme comes from pbp, so a season that has not kicked off has
  // none. Fall back per team rather than wholesale — mid-season, some teams will
  // have a live profile before others (byes, and the ETL's own cadence).
  const liveDefense = byTeam(defense.filter((x) => x.season === season));
  const defenseByTeam = { ...liveDefense };
  if (hasDefensePriors(season)) {
    for (const t of teams) {
      if (!defenseByTeam[t.team_abbr]) {
        const p = defensePriorFor(season, t.team_abbr);
        if (p) defenseByTeam[t.team_abbr] = p;
      }
    }
  }

  // Priors carry name/headshot for players the `players` table has never seen —
  // a rookie or a new signing has no row there until the ETL next runs.
  const priors = playerPriorsFor(season);
  const playerIndex = byId(players);
  for (const [pid, p] of Object.entries(priors)) {
    if (!playerIndex[pid]) {
      playerIndex[pid] = { player_id: pid, full_name: p.player_name, headshot_url: p.headshot_url };
    }
  }

  // ── roster STATUS has to come from the live overlay, not from `players` ─────
  // availabilityOf() reads `players.status` to decide whether a man is on IR,
  // cut or on the practice squad — and `players` is written by the Python ETL,
  // which last ran on 2026-08-09. So the check that exists precisely to keep
  // unavailable players off the board was reading a status four weeks stale and
  // waving everyone through.
  //
  // It showed: Seattle's Zach Charbonnet sat on the week-1 board with a market
  // line and a projection while the club had him on RESERVE. His row said ACT
  // because that is what he was in August.
  //
  // The overlay refreshes three times a week (.github/workflows/roster-pull.yml),
  // so it is the only source here that can be right. Team and position are taken
  // from it for the same reason.
  if (hasRosterStatus(season)) {
    for (const pid of Object.keys(playerIndex)) {
      const live = rosterStatusFor(season, pid);
      if (!live) continue;
      playerIndex[pid] = {
        ...playerIndex[pid],
        status: live.status,
        team_abbr: live.team_abbr || playerIndex[pid].team_abbr,
        position: live.position || playerIndex[pid].position,
        full_name: playerIndex[pid].full_name || live.full_name,
        headshot_url: playerIndex[pid].headshot_url || live.headshot_url,
      };
    }
  }

  const seasonGames = games.filter((g) => g.season === season);
  return {
    // `season` stays the ROW ARRAY the app has always consumed; the year is
    // `year`. Renaming the array would silently break every board that filters it.
    year: season,
    teams: byTeam(teams),
    teamList: teams.filter((t) => defenseByTeam[t.team_abbr]),
    games: seasonGames,
    defense: defenseByTeam,
    offense: byTeam(offense.filter((x) => x.season === season)),
    players: playerIndex,
    season: roster,
    seasonById: byId(roster),
    splits: byId(splits.filter((x) => x.season === season)),
    weeksByPlayer,
    logWeeksByPlayer,
    logSeasonByPlayer,
    historyByPlayer,
    // A research profile is built from a COMPLETED season, so at a flip the
    // newest one available describes last year. Keep the latest per player and
    // record which season it came from, so the card can say so rather than
    // implying it describes the season being projected.
    profiles: latestProfiles(profiles, season),
    // Every season's profile per player, for the panel's season switch — at
    // week 2 the current card is one game deep and last season's full card is
    // still the better scouting report, so both stay one click apart.
    profilesByPlayer: profilesBySeason(profiles, season),
    // Market layer: a Map keyed `game_id|normalisedName|prop_type`, already
    // collapsed to the most preferred book that priced each prop. Empty before
    // the week's odds pull has run, which every consumer must tolerate.
    odds: indexOdds(oddsRows),
    // The sack market is indexed separately: a different set of books (folding
    // PrizePicks and Underdog into the main index would put two DFS pick'em
    // prices in the board's sportsbook columns) and a different SHAPE — a ladder
    // of rungs per book rather than one line. See indexSackOdds.
    sackOdds: indexSackOdds(oddsRows),
    oddsWeeks: [...new Set(oddsRows.map((r) => r.week))].sort((a, b) => a - b),
    // Availability layer: a Map keyed `player_id|week`. Empty before the clubs
    // file the week's report, which every consumer must tolerate. Roster status
    // travels separately, on the `players` rows, because it is not week-scoped.
    injuries: indexInjuries(injuries),
    injuryWeeks: [...new Set(injuries.map((r) => r.week))].sort((a, b) => a - b),
    // Game lines (spread, total, moneyline, team total): game_id → book →
    // market → sides, the newest capture of each. Empty before a pull, which the
    // game rows tolerate by showing the engine alone. See src/lib/gameMarkets.js.
    gameLines: indexGameLines(gameLineRows, Object.fromEntries(seasonGames.map((g) => [g.game_id, g]))),
  };
}
