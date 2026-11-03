// ── Shared no-lookahead grading pipeline ─────────────────────────────────────
// Every harness (backtest, skew calibration, coach screen) must grade the SAME
// records the SAME way, or their numbers aren't comparable and a "win" in one
// script can be an artifact of a different join. So the join lives here once.
//
// For each FanDuel prop we pulled: rebuild the player's baseline from weeks
// strictly BEFORE the game, project, and attach the real line + real outcome.
// Deliberately returns the RAW projection (mean, sigma, line) rather than a
// baked probability, so downstream callers can swap in any P(over) variant and
// compare them on identical records.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectPlayer, oddsToImplied, probOverSkewed, SKEW_W_BY_PROP,
  teamOpportunityBudget, teamVolume, applyBudget } from "../../src/lib/models.js";
import { aggregateWeeks } from "../../src/lib/aggregate.js";
import { blendPlayerSeason, isProjectable, roleBaselineFor } from "../../src/lib/playerPriors.js";
import { promoteDepthRooms } from "../../src/lib/depthPromotion.js";
import { hasRole } from "../../src/lib/roster.js";
import { parseCsv } from "./csv.mjs";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "out");
export const readJson = (n) =>
  JSON.parse(fs.readFileSync(path.join(OUT, `${n}.json`), "utf8").replace(/\bNaN\b/g, "null"));

export const SEASON = 2025, FROM_WEEK = 4, MIN_PRIOR = 3;
export const PROP_MAP = {
  player_reception_yds: "rec_yards", player_rush_yds: "rush_yards",
  player_pass_yds: "pass_yards", player_anytime_td: "anytime_td",
};
export const ACTUAL = { rec_yards: "rec_yards", rush_yards: "rush_yards", pass_yards: "pass_yards" };
export const YARD_PROPS = ["rec_yards", "rush_yards", "pass_yards"];

export const SEGMENTS = [
  { key: "in-sample", label: "IN-SAMPLE wk4-10", lo: 4, hi: 10, note: "tuned here — optimistic" },
  { key: "holdout", label: "HOLDOUT   wk11-16", lo: 11, hi: 16, note: "never seen — the honest number" },
  { key: "late", label: "LATE      wk17-18", lo: 17, hi: 18, note: "resting starters — not trusted" },
  { key: "all", label: "ALL       wk4-18", lo: 4, hi: 18, note: "" },
];

// Weeks 1-3 only exist in the carryover run — with no carried baseline a player
// has 0-2 prior games and MIN_PRIOR discards him. Kept as a separate segment
// list so the default run's numbers stay directly comparable to the research log.
export const SEGMENTS_ALL = [
  { key: "opening", label: "OPENING   wk1-3", lo: 1, hi: 3, note: "carryover only — no live baseline exists" },
  { key: "in-sample", label: "IN-SAMPLE wk4-10", lo: 4, hi: 10, note: "tuned here — optimistic" },
  { key: "holdout", label: "HOLDOUT   wk11-16", lo: 11, hi: 16, note: "never seen — the honest number" },
  { key: "late", label: "LATE      wk17-18", lo: 17, hi: 18, note: "resting starters — not trusted" },
  { key: "all", label: "FULL      wk1-18", lo: 1, hi: 18, note: "" },
];

const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[.'’-]/g, "").replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").replace(/\s+/g, " ").trim();

// ── Prior-season rows, for the carryover path ────────────────────────────────
// build_player_priors_2026.py emits priors for ONE season (2026). To grade the
// carryover layer against 2025 outcomes we need the same thing for 2025, built
// from 2024 — so this reproduces that artifact's shape from player_season_multi,
// which carries every season back to 2021.
//
// `team_abbr` is deliberately the CURRENT-season team (matching the real artifact,
// where it is the 2026 team and not where the player finished 2025) because
// `changed_team` — which selects the ~4x faster weaning schedule — is exactly the
// comparison between the two.
export function buildPriorRows(season, teamBySeasonPlayer) {
  const multi = readJson("player_season_multi");
  const bySeason = {};
  for (const r of multi) (bySeason[r.season] ||= {})[r.player_id] = r;

  const priors = {};
  const players = new Set();
  for (const yr of Object.keys(bySeason)) if (+yr < season) for (const pid in bySeason[yr]) players.add(pid);

  for (const pid of players) {
    // Most recent season strictly before the target — one back is a live prior,
    // anything older is stale and weans on the faster schedule.
    let src = null;
    for (let yr = season - 1; yr >= season - 4; yr--) { if (bySeason[yr]?.[pid]) { src = bySeason[yr][pid]; break; } }
    if (!src) continue;
    const curTeam = teamBySeasonPlayer[pid] ?? src.team_abbr;
    priors[pid] = {
      ...src,
      season,
      prior_season: src.season,
      prior_team: src.team_abbr,
      team_abbr: curTeam,
      changed_team: src.team_abbr !== curTeam,
      prior_source: src.season === season - 1 ? "prior-season" : "stale-prior",
    };
  }
  return priors;
}

export function buildGraded(opts = {}) {
  const odds = readJson("historical_odds_2025");
  const weeks = readJson("player_week_stats").filter((w) => w.season === SEASON);
  const games = readJson("games").filter((g) => g.season === SEASON);
  const players = readJson("players");
  const splits = Object.fromEntries(readJson("player_scheme_splits").filter((x) => x.season === SEASON).map((x) => [x.player_id, x]));
  const offense = Object.fromEntries(readJson("team_offense_profile").filter((x) => x.season === SEASON).map((x) => [x.team_abbr, x]));
  const defense = Object.fromEntries(readJson("team_defense_scheme").filter((x) => x.season === SEASON).map((x) => [x.team_abbr, x]));
  // Teammate availability for the game week. This is pre-game public information
  // (Friday report + 90-minute inactives) and our odds snapshot is kickoff-45min,
  // so it is in the closing line already — reading it is not lookahead.
  const availability = {};
  try {
    for (const r of readJson("player_availability_weekly")) availability[`${r.player_id}|${r.week}`] = r;
  } catch { /* availability is optional — grade without it */ }

  // ── who was actually ruled out ──────────────────────────────────────────────
  // NOT from player_availability_weekly. That artifact is keyed on players who
  // appear in the week's STATS, so a man who was ruled out has no row in it at
  // all — its own_status column contains 203 Questionables and not one single
  // "Out" across the whole 2025 season. Anything built on it to answer "is he
  // out" silently answers "no, always". The injury report is the source.
  const outByWeek = new Set();
  try {
    const csv = fs.readFileSync(path.join(OUT, "..", "cache", `injuries_${SEASON}.csv`), "utf8");
    for (const r of parseCsv(csv)) {
      if (r.season_type !== "REG" || !r.gsis_id) continue;
      if (r.report_status === "Out" || r.report_status === "Doubtful") {
        outByWeek.add(`${r.gsis_id}|${Number(r.week)}`);
      }
    }
  } catch { /* no injury file — grade with nobody ruled out */ }

  const activeIds = new Set(weeks.map((w) => w.player_id));
  const nameToIds = {};
  for (const p of players) if (activeIds.has(p.player_id)) (nameToIds[norm(p.full_name)] ||= []).push(p);

  const sched = {};
  for (const g of games) {
    sched[`${g.home_team}|${g.week}`] = { opp: g.away_team, side: "home", game: g };
    sched[`${g.away_team}|${g.week}`] = { opp: g.home_team, side: "away", game: g };
  }
  const wkByPlayer = {};
  for (const w of weeks) (wkByPlayer[w.player_id] ||= []).push(w);
  for (const k in wkByPlayer) wkByPlayer[k].sort((a, b) => a.week - b.week);

  // ── carryover mode ──────────────────────────────────────────────────────────
  // Default (false) reproduces the historical harness exactly: a from-scratch
  // season-to-date baseline, which does not exist before week 4. With carryover
  // the baseline is blendPlayerSeason(prior 2024, live 2025) — the SHIPPED 2026
  // path — so week 1 is projectable and every week's baseline changes.
  const useCarry = !!opts.carryover;
  const fromWeek = opts.fromWeek ?? (useCarry ? 1 : FROM_WEEK);
  let priorRows = null;

  // The weekly depth chart is loaded UNCONDITIONALLY, not just in carryover
  // mode. isProjectable() needs it only at a season flip, but roleShiftMult()
  // needs it on every track: it reads the rank the player holds this week
  // against the rank he held while his baseline was being earned, and that
  // comparison exists mid-season too. Loading it only under `carryover` is what
  // made the layer ungradeable on the default weeks 4-18 track.
  let depthByWeek = {};
  // The whole ROOM, not just the man: "is every quarterback this club charts
  // above him ruled out" is a question about his teammates, and the promotion
  // path in src/lib/depthPromotion.js cannot be graded without them.
  const roomByTPW = {};
  try {
    for (const r of readJson(`player_depth_weekly_${SEASON}`)) {
      depthByWeek[`${r.player_id}|${r.week}`] = r;
      if (r.depth_rank != null && r.depth_rank <= 90) {
        (roomByTPW[`${r.depth_team}|${r.depth_pos}|${r.week}`] ||= []).push(r);
      }
    }
  } catch { depthByWeek = {}; }

  // ── the live baseline's RED-ZONE / GOAL-LINE role ───────────────────────────
  // aggregateWeeks() builds from player_week_stats, which has no notion of where
  // on the field a carry happened — so a baseline built here carried no rz/gl and
  // anytimeTdLambda's role term was null on every graded record. The APP's
  // mid-season baseline (player_season_agg) does carry it, so the harness was
  // grading a strictly weaker model than the one that ships, and any judgement
  // about the role term was being made against an empty column.
  //
  // player_rzgl_weekly is cumulative THROUGH week T, so week W reads T = W-1 and
  // the no-lookahead discipline holds.
  const rzglByWeek = {};
  try {
    for (const r of readJson("player_rzgl_weekly")) {
      if (r.season !== SEASON) continue;
      rzglByWeek[`${r.player_id}|${r.through_week}`] = r;
    }
  } catch { /* no artifact — role term stays null, as it was before */ }
  const RZGL = ["rz_carries_pg", "rz_targets_pg", "gl_carries_pg", "gl_targets_pg"];
  const withRzgl = (row, pid, week) => {
    if (!row) return row;
    const z = rzglByWeek[`${pid}|${week - 1}`];
    if (!z) return row;
    for (const f of RZGL) row[f] = z[f];
    return row;
  };

  /**
   * The rank a player held over the weeks his baseline was measured on.
   *
   * Averaged rather than taken from any single week: a club refiles its chart
   * several times a week and one Wednesday's snapshot is noisier than the role
   * it is standing in for. Only ranks at the player's OWN position count — the
   * chart lists him at his return role too, and a WR3 who is also the punt
   * returner is not a rank-2 receiver (the same trap build_depth_weekly.py
   * falls into by taking a minimum across every chart).
   */
  const rankEarnedOver = (pid, priorWeeks, pos) => {
    const ranks = [];
    for (const w of priorWeeks) {
      const d = depthByWeek[`${pid}|${w.week}`];
      if (!d || d.depth_rank == null || d.depth_rank > 90) continue;
      if (pos && d.depth_pos && d.depth_pos !== pos) continue;
      ranks.push(d.depth_rank);
    }
    if (ranks.length < 2) return null;            // too little to call it a role
    return ranks.reduce((a, b) => a + b, 0) / ranks.length;
  };

  if (useCarry) {
    const teamOf = {};
    for (const pid in wkByPlayer) teamOf[pid] = wkByPlayer[pid][wkByPlayer[pid].length - 1].team_abbr;
    priorRows = buildPriorRows(SEASON, teamOf);
  }

  // ── team opportunity budget, per (team, week) ───────────────────────────────
  // OFF by default (pass `budget: true`), because the layer itself is off — see
  // BUDGET in src/lib/models.js for what was measured and why it did not ship.
  // Kept here so the evidence can be reproduced without rebuilding the wiring.
  // Built lazily and cached:
  // one budget serves every graded prop belonging to that team-week.
  //
  // NOT NO-LOOKAHEAD IN ONE RESPECT, and it is the harness's existing compromise
  // rather than a new one: `offense` is the full-season team profile, so a week-6
  // budget is sized with a pool that saw week 17. buildGraded already hands the
  // same row to projectPlayer as teamOff, so using a different source here would
  // make the budget disagree with the projection it is scaling. It moves the
  // pool by a few percent against a cap that only fires past 12%.
  const budgetCache = new Map();
  const budgetFor = (team, week) => {
    const key = `${team}|${week}`;
    if (budgetCache.has(key)) return budgetCache.get(key);
    const rows = [];
    for (const pid in wkByPlayer) {
      const prior = wkByPlayer[pid].filter((r) => r.week < week);
      if (!prior.length) continue;
      // The team he was on going INTO this week, not where he ended the season.
      if (prior[prior.length - 1].team_abbr !== team) continue;
      const base = aggregateWeeks(prior);
      if (!base) continue;
      base.position = base.position || players.find((p) => p.player_id === pid)?.position;
      if (!hasRole(base, "board")) continue;
      rows.push({ ...base, player_id: pid });
    }
    // Ruled out by the club's own filed designation for THIS week — pre-game
    // public information, so reading it is not lookahead.
    const isOut = (pid) => outByWeek.has(`${pid}|${week}`);
    const b = rows.length
      ? teamOpportunityBudget(rows, {
        ...teamVolume(rows, offense[team], null),
        isOut,
        ...(opts.budgetDamp != null ? { damp: opts.budgetDamp } : {}),
      })
      : new Map();
    budgetCache.set(key, b);
    return b;
  };

  const recs = {};
  for (const r of odds) {
    const mt = PROP_MAP[r.prop_type]; if (!mt) continue;
    const k = `${r.game_id}|${r.player_name}|${mt}`;
    (recs[k] ||= { game_id: r.game_id, week: r.week, player_name: r.player_name, mtype: mt, line: r.line }).line ??= r.line;
    const rr = recs[k];
    if (r.name === "Over" || r.name === "Yes") { rr.overOdds = r.odds; rr.line = r.line ?? rr.line; }
    else if (r.name === "Under" || r.name === "No") rr.underOdds = r.odds;
  }

  const resolvePid = (rec) => {
    const cands = nameToIds[norm(rec.player_name)];
    if (!cands || !cands.length) return null;
    if (cands.length === 1) return cands[0].player_id;
    const g = games.find((x) => x.game_id === rec.game_id);
    const teams = g ? [g.home_team, g.away_team] : [];
    return (cands.find((c) => teams.includes(c.team_abbr)) || cands[0]).player_id;
  };

  const graded = [];
  const counts = { total: 0, nomatch: 0, noweek: 0, nobaseline: 0, noproj: 0, nomkt: 0, noactual: 0, graded: 0 };

  for (const k in recs) {
    const rec = recs[k];
    counts.total++;
    if (rec.week < fromWeek) continue;
    const pid = resolvePid(rec); if (!pid) { counts.nomatch++; continue; }
    const rows = wkByPlayer[pid]; if (!rows) { counts.noweek++; continue; }
    const prior = rows.filter((r) => r.week < rec.week);
    if (!useCarry && prior.length < MIN_PRIOR) continue;
    const wkRow = rows.find((r) => r.week === rec.week);
    if (!wkRow || !sched[`${wkRow.team_abbr}|${rec.week}`]) { counts.noweek++; continue; }
    const s = sched[`${wkRow.team_abbr}|${rec.week}`];

    const live = withRzgl(aggregateWeeks(prior), pid, rec.week);
    // The carried baseline is the shipped blend; without a prior row the player
    // is a rookie/street signing and only live games can carry him, which is the
    // same judgement isProjectable() makes on the real board.
    let priorRow = useCarry ? (priorRows[pid] || null) : null;
    if (priorRow) {
      const d = depthByWeek[`${pid}|${rec.week}`];
      priorRow = { ...priorRow, depth_rank: d?.depth_rank ?? null, depth_pos: d?.depth_pos ?? null, depth_team: d?.depth_team ?? null };
    }
    // `roleCellFor` is the seam scripts/screen_backup_baseline.mjs uses to inject
    // WALK-FORWARD role cells. The shipped table is keyed 2026 <- 2025, so with
    // nothing injected roleBaselineFor(2025, ...) returns null and the depth
    // layer is inert here — which is what keeps the default track's numbers
    // directly comparable to the research log.
    // Bound to THIS record's week, so a caller can hand back a cell built only
    // from weeks strictly before it.
    const roleCellFor = opts.roleCellFor && ((position, rank) => opts.roleCellFor(position, rank, rec.week));
    let season = useCarry ? blendPlayerSeason(priorRow, live, { roleCellFor, roleW: opts.roleW }) : live;
    if (!season) { counts.nobaseline++; continue; }
    // ── the promotion path ────────────────────────────────────────────────────
    // Off unless asked for, because it ADDS records the default run has never
    // had: a quarterback whose club filed everyone above him Out has no row at
    // all today (isProjectable gates QBs on depth_rank === 1), so turning this on
    // changes the graded set rather than a number inside it.
    if (useCarry && opts.promote) {
      const d0 = depthByWeek[`${pid}|${rec.week}`];
      const room = d0 ? (roomByTPW[`${d0.depth_team}|${d0.depth_pos}|${rec.week}`] || []) : [];
      if (room.length > 1) {
        // Everyone in the room gets a baseline built the same way this player's
        // was, so the vacated starter's attempt rate is the same number the
        // board would have shown for him.
        const rows = [];
        for (const m of room) {
          if (m.player_id === pid) { rows.push(season); continue; }
          // A ROOKIE has no row in buildPriorRows — it only emits players who
          // already have a season — and leaving him out silently shortens the
          // room. That is not a cosmetic gap: with a rookie QB1 absent, a QB3
          // whose QB2 is ruled out looks like the last man standing and gets
          // promoted over a starter who is playing. He enters as the same
          // rookie-shaped prior the real artifact emits.
          let mp = priorRows?.[m.player_id]
            || { player_id: m.player_id, season: SEASON, prior_season: null,
              prior_team: null, changed_team: false, prior_source: "rookie",
              position: m.depth_pos, team_abbr: m.depth_team };
          mp = { ...mp, depth_rank: m.depth_rank, depth_pos: m.depth_pos, depth_team: m.depth_team };
          const mLive = withRzgl(aggregateWeeks((wkByPlayer[m.player_id] || []).filter((r) => r.week < rec.week)), m.player_id, rec.week);
          const mRow = blendPlayerSeason(mp, mLive, { roleCellFor, roleW: opts.roleW });
          // A charted man with no baseline at all still OCCUPIES the slot above
          // him. Pushing a bare marker keeps `above.every(isOut)` honest.
          rows.push(mRow || { player_id: m.player_id, position: m.depth_pos,
            _carryover: { depth_rank: m.depth_rank, depth_pos: m.depth_pos } });
        }
        const after = promoteDepthRooms(rows, {
          isOut: (id) => outByWeek.has(`${id}|${rec.week}`),
          qb1Cell: roleCellFor ? roleCellFor("QB", 1) : roleBaselineFor(SEASON, "QB", 1),
        });
        season = after.find((r) => r.player_id === pid) || season;
      }
    }
    // `noScoringCarry` reproduces the pre-2026-09-09 blend, which carried volume
    // and efficiency across the season break and dropped the scoring role
    // entirely. It is the A side of the A/B in calibrate_atd.mjs --carryover;
    // see SCORING_CARRYOVER in src/lib/playerPriors.js.
    if (useCarry && opts.noScoringCarry) {
      season = { ...season, _effN: { ...(season._effN || {}) } };
      for (const f of ["total_td_pg", "rush_td_pg", "rec_td_pg",
        "rz_carries_pg", "rz_targets_pg", "gl_carries_pg", "gl_targets_pg"]) {
        if (!live || live[f] == null) delete season[f];
      }
      delete season._effN.total_td_pg;
    }
    if (opts.budget) {
      season = applyBudget(season, budgetFor(wkRow.team_abbr, rec.week).get(pid)) || season;
    }
    if (useCarry && !isProjectable(season)) { counts.nobaseline++; continue; }
    const recent = prior.length ? aggregateWeeks(prior.slice(-4)) : null;
    const props = projectPlayer({
      player: {}, season, splits: splits[pid], recent,
      teamOff: offense[season.team_abbr], oppOff: offense[s.opp], oppDef: defense[s.opp],
      game: s.game, side: s.side,
      availability: opts.noAvailability ? null : availability[`${pid}|${rec.week}`],
      depth: opts.noDepth ? null : {
        rank: depthByWeek[`${pid}|${rec.week}`]?.depth_rank ?? null,
        rankEarned: rankEarnedOver(pid, prior, season.position),
      },
      ...(opts.projectExtra || {}),
    });
    const prop = props.find((x) => x.prop_type === rec.mtype);
    if (!prop) { counts.noproj++; continue; }
    if (rec.mtype !== "anytime_td" && rec.line == null) { counts.nomkt++; continue; }

    let mktP;
    const io = oddsToImplied(rec.overOdds), iu = oddsToImplied(rec.underOdds);
    if (io != null && iu != null) mktP = io / (io + iu);
    else if (io != null) mktP = io;              // ATD is Yes-only on FanDuel — vig-inclusive
    else { counts.nomkt++; continue; }

    let hit, actualVal = null;
    if (rec.mtype === "anytime_td") hit = ((wkRow.rush_tds || 0) + (wkRow.rec_tds || 0)) >= 1 ? 1 : 0;
    else {
      actualVal = wkRow[ACTUAL[rec.mtype]];
      if (actualVal == null) { counts.noactual++; continue; }
      hit = actualVal > rec.line ? 1 : 0;
    }

    graded.push({
      mtype: rec.mtype, week: rec.week, player: rec.player_name, player_id: pid,
      team: wkRow.team_abbr, opp: s.opp, side: s.side,
      mktP, hit, overOdds: rec.overOdds, underOdds: rec.underOdds,
      projMean: prop.proj_mean, sigma: prop.sigma, line: rec.line, actual: actualVal,
      // What the SHIPPED model says at the REAL market line. Note prop.prob_over
      // is computed at the model's own invented line (deliberately set below the
      // mean), so it is ~always >0.5 and is useless as a market comparison — it
      // must be recomputed here against rec.line.
      // Uses the PER-PROP skew weight, matching what the app ships. Calling
      // probOverSkewed() without a w silently falls back to the pooled default
      // and understates the receiving fix.
      shippedP: rec.mtype === "anytime_td" ? prop.prob_over
        : probOverSkewed(prop.proj_mean, prop.sigma, rec.line, SKEW_W_BY_PROP[rec.mtype] ?? 0),
      naiveMean: actualVal == null ? null : (season[`${ACTUAL[rec.mtype]}_pg`] ?? null),
      liveGames: prior.length, carryover: season._carryover ?? null,
      factors: prop.factors, season,
      // The player's own week-by-week OPPORTUNITY counts in the games before this
      // one. Needed to estimate how volatile HIS usage is — a bell-cow back and a
      // committee back can share a mean while having completely different spread,
      // and a single pooled dispersion cannot tell them apart.
      priorOpp: prior.map((r) => (
        rec.mtype === "rush_yards" ? (r.carries ?? 0)
        : rec.mtype === "pass_yards" ? (r.pass_att ?? 0)
        : (r.receptions ?? 0)
      )),
    });
    counts.graded++;
  }
  return { graded, counts };
}

// ── shared metrics ────────────────────────────────────────────────────────────
export const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
export const brierOf = (a, pf) => mean(a.map((x) => (pf(x) - x.hit) ** 2));
export const loglossOf = (a, pf) => mean(a.map((x) => {
  const p = Math.min(0.999, Math.max(0.001, pf(x)));
  return -(x.hit * Math.log(p) + (1 - x.hit) * Math.log(1 - p));
}));
export function corr(xs, ys) {
  const mx = mean(xs), my = mean(ys);
  let n = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) { n += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  return dx && dy ? n / Math.sqrt(dx * dy) : 0;
}
export const segOf = (graded, key) => {
  const S = SEGMENTS.find((x) => x.key === key);
  return graded.filter((x) => x.week >= S.lo && x.week <= S.hi);
};
export const pad = (s, n) => String(s).padEnd(n);
export const padL = (s, n) => String(s).padStart(n);
export const pct = (x, d = 1) => (x * 100).toFixed(d) + "%";
export const sgn = (x, d = 1) => (x >= 0 ? "+" : "") + x.toFixed(d);
