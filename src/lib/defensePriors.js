// ── Season-flip defensive priors ─────────────────────────────────────────────
// The third leg of the season flip, after teamPriors.js (offense, keyed on the
// play-caller) and playerPriors.js (player baselines).
//
// Defensive scheme comes from pbp_participation, which does not exist for a
// season that has not kicked off. Without this, `d.defense` is empty at 2026
// week 1 and every scheme multiplier silently returns neutral — which is
//ARGUABLY right for coverage and definitely wrong for pressure and blitz, both
// of which are strongly persistent traits we do know something about.
//
// scripts/build_def_priors_2026.mjs measured year-over-year persistence for each
// trait and carries only what survives:
//
//     trait      YoY r     carried as
//     blitz       0.538    season average, deviation x0.538
//     pressure    0.417    season average, deviation x0.417
//     is_man      0.006    LEAGUE MEAN — not carried
//     box         0.016    LEAGUE MEAN — not carried
//
// The man/zone result is the load-bearing one and it overturns how the app has
// always treated coverage. A team's SEASON-AVERAGE man rate has no year-over-year
// signal (r=0.006), even though its per-situation man/zone deltas persist at
// ~0.33: the situational deltas offset across down-and-distance, so the
// aggregate collapses to league. A defense's man/zone PATTERN is a trait; its
// LEVEL is not.
//
// So coverageMatchup returns exactly 1.0 for every player until live 2026
// coverage data exists, and the UI says so rather than implying a matchup edge
// we do not have. Trust is `r`, the regression-to-the-mean slope.
//
// ── IN-SEASON: EPA WEANS ONTO THE LIVE SEASON (2026-09-16) ───────────────────
// The scheme traits above come from pbp_participation, which is published only
// after a season ends — so no live scheme profile ever arrives in-season, and
// as first written the prior was used unchanged all year. Defensive EPA comes
// from play-by-play, which IS live. scripts/calibrate_def_wean.py measured the
// walk-forward weaning rate on 2022-25 (2,046 team-weeks): w = n/(n+K) with
// K=24 is best for both pass and rush EPA, beating prior-forever by 0.8% / 0.7%
// MSE. Small, and it should be: a defense's single-week EPA is mostly noise
// (pure season-to-date, K=0, is 17% WORSE than the prior). The blend is done in
// deviation-from-league space so league-wide EPA drift is not read as a trait.
import DEF_PRIORS_2026 from "../../scripts/out/team_defense_priors_2026.json" with { type: "json" };
import DEF_LIVE_2026 from "../../scripts/out/team_defense_live_2026.json" with { type: "json" };

export const DEF_EPA_WEAN_K = 24;

// ── PRESSURE (2026-09-16c) ───────────────────────────────────────────────────
// pressure_rate is participation's was_pressure share, also post-season only.
// PFR's times_pressured (advstats, in-season) over the defense's dropbacks
// tracks it at r=0.667 per team-season / 0.494 per team-week on 2022-25, but on
// a different scale (mean .209 vs .290), so it is mapped first. Walk-forward
// (scripts/calibrate_pressure_wean.py), map fit out-of-season: K=16 best, MSE
// −1.33% vs prior-forever; pure live is +10% worse. pbp sacks + QB hits were
// the other candidate and lost at every K (+10% to +269%) — rejected. Next Gen
// Stats publishes no team pressure figure.
export const PRESSURE_WEAN_K = 16;
export const PRESSURE_MAP = { a: 0.1136, b: 0.8413 };   // participation rate ≈ a + b · PFR rate

/**
 * Wean a carried prior's EPA onto the live season. Pure; exported for tests.
 * `live` is { league: {def_pass_epa, def_rush_epa}, teams: {abbr: {...}} }.
 */
export function weanDefenseEpa(prior, live, teamAbbr, K = DEF_EPA_WEAN_K) {
  const t = live?.teams?.[teamAbbr];
  if (!prior || !t?.games) return prior;
  const w = t.games / (t.games + K);
  const out = { ...prior, live_games: t.games, live_epa_weight: +w.toFixed(3) };
  for (const key of ["def_pass_epa", "def_rush_epa"]) {
    const lgPrior = prior.basis?.[key]?.league_mean;
    const lgLive = live.league?.[key];
    if (t[key] == null || lgPrior == null || lgLive == null || prior[key] == null) continue;
    const priorDev = prior[key] - lgPrior;
    const liveDev = t[key] - lgLive;
    out[key] = +(lgPrior + w * liveDev + (1 - w) * priorDev).toFixed(5);
  }
  const pr = weanPressure(prior, live, teamAbbr);
  if (pr != null) {
    out.pressure = pr.value;
    out.pressure_rate = pr.value;
    out.live_pressure_weight = pr.weight;
  }
  return out;
}

/** The carried pressure rate weaned onto PFR's live pressures, or null when there is nothing to blend. */
export function weanPressure(prior, live, teamAbbr, K = PRESSURE_WEAN_K, map = PRESSURE_MAP) {
  const t = live?.teams?.[teamAbbr];
  const lgPrior = prior?.basis?.pressure?.league_mean;
  const priorRate = prior?.pressure_rate ?? prior?.pressure;
  const lgProxy = live?.league?.pressure_proxy;
  if (!t?.games || t.pressure_proxy == null || lgProxy == null || lgPrior == null || priorRate == null) return null;
  const w = t.games / (t.games + K);
  // Deviation from league on the participation scale: mapping is linear, so
  // map(team) − map(league) = b · (team − league).
  const liveDev = map.b * (t.pressure_proxy - lgProxy);
  const priorDev = priorRate - lgPrior;
  return { value: +(lgPrior + w * liveDev + (1 - w) * priorDev).toFixed(5), weight: +w.toFixed(3) };
}

const BY_SEASON = {
  2026: Object.fromEntries(DEF_PRIORS_2026.map((r) => [r.team_abbr, weanDefenseEpa(r, DEF_LIVE_2026, r.team_abbr)])),
};

/** The defensive prior for one team in one season, or null when we have none. */
export function defensePriorFor(season, teamAbbr) {
  return BY_SEASON[season]?.[teamAbbr] ?? null;
}

export function hasDefensePriors(season) {
  return !!BY_SEASON[season];
}

/**
 * The defensive profile to project against: the live one once the season has
 * produced scheme data, otherwise the carried prior.
 *
 * Live data always wins — a prior is what you use when you have nothing better,
 * and one game of real coverage tendency is not obviously better than a
 * persistence-weighted prior, but the ETL only writes a profile once games are
 * played, so anything present here is genuinely measured.
 */
export function defenseFor(season, teamAbbr, liveDefense) {
  const live = liveDefense?.[teamAbbr];
  if (live) return live;
  return defensePriorFor(season, teamAbbr);
}

/**
 * Which traits in a profile are real measurements vs league-mean placeholders.
 * The UI uses this so a 1.0 coverage multiplier reads as "we cannot know this
 * yet" rather than "this matchup is neutral".
 */
export function priorBasis(profile) {
  return profile?.basis ?? null;
}

export function isCarriedPrior(profile) {
  return !!profile?.basis;
}
