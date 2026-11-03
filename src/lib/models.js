// ── NFL projection model (public reference implementation) ──────────────────
//
// The production model and its calibration are private. This file is a
// structural stand-in: it exports the functions the rest of the app imports,
// with the same inputs and output shapes, so the boards, ledger, settlement and
// tests run unchanged. The math is deliberately simple:
//
//   volume     = per-game opportunity (targets / carries / attempts),
//                scaled by game script from the betting line
//   efficiency = per-opportunity rate shrunk toward the league mean
//   pricing    = Normal / Normal-lognormal mix for yards, Poisson for TDs
//
// The odds / EV helpers and the distributions are textbook. Every constant
// below is illustrative, not fitted.

// ── Odds & EV ────────────────────────────────────────────────────────────────

export function oddsToImplied(a) {
  if (a == null) return null;
  return a > 0 ? 100 / (a + 100) : Math.abs(a) / (Math.abs(a) + 100);
}
export function probToAmericanOdds(p) {
  if (p == null || p <= 0 || p >= 1) return null;
  return p >= 0.5 ? Math.round(-(p / (1 - p)) * 100) : Math.round(((1 - p) / p) * 100);
}
/** Standard normal CDF (Abramowitz & Stegun 7.1.26). */
export function normalCDF(z) {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x);
  return (1 + sign * y) / 2;
}
export function calcEV(prob, american) {
  if (prob == null || american == null) return null;
  const payout = american > 0 ? american / 100 : 100 / Math.abs(american);
  return prob * payout - (1 - prob);
}

// ── Market calibration ───────────────────────────────────────────────────────
// Blend the model's probability with the book's (de-vigged) price in logit
// space. Two forms: a pull toward the market for two-sided props ({c, k}), and
// a weighted blend for one-sided props ({a, wm, wp}). Illustrative weights.
export const MARKET_CAL = {
  rec_yards:  { c: 0, k: 0.25 },
  receptions: { c: 0, k: 0.25 },
  rush_yards: { c: 0, k: 0.25 },
  pass_yards: { c: 0, k: 0.25 },
  anytime_td: { a: 0, wm: 0.75, wp: 0.25 },
};
const logit = (p) => { const q = Math.min(0.995, Math.max(0.005, p)); return Math.log(q / (1 - q)); };
const sigmoid = (z) => 1 / (1 + Math.exp(-z));

export function calibrateToMarket(propType, modelProb, mktProb, devigged, CAL = MARKET_CAL) {
  const k = CAL[propType];
  if (!k || modelProb == null || mktProb == null || !(mktProb > 0 && mktProb < 1)) return modelProb;
  if (k.wm != null) return sigmoid(k.a + k.wm * logit(mktProb) + k.wp * logit(modelProb));
  if (!devigged) return modelProb;
  const lm = logit(mktProb);
  return sigmoid(lm + k.c + k.k * (logit(modelProb) - lm));
}

// ── Distributions ────────────────────────────────────────────────────────────

export function probOverNormal(mean, sigma, line) {
  if (sigma <= 0) return mean > line ? 1 : 0;
  return 1 - normalCDF((line - mean) / sigma);
}
export function probOverLognormal(mean, sigma, line) {
  if (mean <= 0) return mean > line ? 1 : 0;
  if (line <= 0) return 1;
  const s2 = Math.log(1 + (sigma / mean) ** 2);
  const mu = Math.log(mean) - s2 / 2, s = Math.sqrt(s2);
  return 1 - normalCDF((Math.log(line) - mu) / s);
}
/** Yardage is right-skewed: mix a Normal with a moment-matched lognormal. */
export const SKEW_W = 0.25;
export const SKEW_W_BY_PROP = { rec_yards: 0.25, rush_yards: 0.25, pass_yards: 0 };
export function probOverSkewed(mean, sigma, line, w = SKEW_W) {
  return (1 - w) * probOverNormal(mean, sigma, line) + w * probOverLognormal(mean, sigma, line);
}
/** Poisson P(X >= k). */
export function poissonGTE(lambda, k) {
  if (!(lambda > 0)) return k <= 0 ? 1 : 0;
  let term = Math.exp(-lambda), cdf = 0;
  for (let i = 0; i < k; i++) { cdf += term; term *= lambda / (i + 1); }
  return Math.max(0, Math.min(1, 1 - cdf));
}

/** Receptions spread: binomial catch noise plus target-count noise. */
export const REC_TGT_VAR = { a: 2, b: 1 };
export function receptionsSigma(projTargets, catchRate, V = REC_TGT_VAR) {
  const T = Math.max(0, projTargets || 0), c = catchRate;
  return Math.max(1.1, Math.sqrt(T * c * (1 - c) + c * c * (V.a + V.b * T)));
}

// ── Game context ─────────────────────────────────────────────────────────────

const clampN = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** Script from the betting line: favorites run more, underdogs throw more. */
export function gameContext(game, side) {
  const margin = side === "home" ? (game?.spread_line || 0) : -(game?.spread_line || 0);
  const implied = side === "home" ? game?.home_implied : game?.away_implied;
  return {
    margin,
    impliedTotal: implied ?? (game?.total_line ? game.total_line / 2 : 22),
    total: game?.total_line,
    passVolMult: clampN(1.0 - margin * 0.005, 0.9, 1.1),
    rushVolMult: clampN(1.0 + margin * 0.01, 0.85, 1.15),
  };
}

// ── Team opportunity budget ──────────────────────────────────────────────────
// Individual per-game rates can sum to more targets/carries than a team will
// actually run. Size the team's pool, then scale players down to fit it.

const POOL = { targetsPerPassAtt: 0.95, carriesPerRushAtt: 0.85 };

export function teamVolume(rows, teamOff, teamPrior) {
  const passAtt = teamPrior?.plays_per_game > 0 && teamPrior?.neutral_pass_rate > 0
    ? teamPrior.plays_per_game * teamPrior.neutral_pass_rate
    : teamOff?.pass_att_pg;
  const rushAtt = teamPrior?.plays_per_game > 0 && teamPrior?.neutral_pass_rate > 0
    ? teamPrior.plays_per_game * (1 - teamPrior.neutral_pass_rate)
    : teamOff?.rush_att_pg;
  if (passAtt > 0 && rushAtt > 0) {
    return { targetPool: passAtt * POOL.targetsPerPassAtt, carryPool: rushAtt * POOL.carriesPerRushAtt };
  }
  const qb = (rows || []).filter((r) => r?.position === "QB")
    .sort((a, b) => (b.pass_att_pg || 0) - (a.pass_att_pg || 0))[0];
  const rbSum = (rows || []).filter((r) => r?.position !== "QB").reduce((a, r) => a + (r.carries_pg || 0), 0);
  return {
    targetPool: qb?.pass_att_pg > 0 ? qb.pass_att_pg * POOL.targetsPerPassAtt : null,
    carryPool: rbSum > 0 ? rbSum : null,
  };
}

/** Map player_id -> { targets_pg, carries_pg, budget } for available skill players. */
export function teamOpportunityBudget(rows, opts = {}) {
  const { targetPool = null, carryPool = null, isOut = () => false, cap = 1.0 } = opts;
  const out = new Map();
  const avail = (rows || []).filter((r) => r && r.position !== "QB" && !isOut(r.player_id));
  if (!avail.length) return out;
  const scaleFor = (key, pool) => {
    if (!pool) return 1;
    const ratio = avail.reduce((a, r) => a + (r[key] || 0), 0) / pool;
    return ratio > cap ? cap / ratio : 1; // never scales up
  };
  const tScale = scaleFor("targets_pg", targetPool);
  const cScale = scaleFor("carries_pg", carryPool);
  for (const r of avail) {
    out.set(r.player_id, {
      targets_pg: (r.targets_pg || 0) * tScale,
      carries_pg: (r.carries_pg || 0) * cScale,
      budget: { target_boost: 1, carry_boost: 1, target_scale: +tScale.toFixed(3), carry_scale: +cScale.toFixed(3) },
    });
  }
  return out;
}

/** Apply a budget entry to a season row, returning a NEW row. */
export function applyBudget(row, entry) {
  if (!row || !entry) return row;
  return { ...row, targets_pg: entry.targets_pg, carries_pg: entry.carries_pg, _budget: entry.budget };
}

// ── Touchdowns ───────────────────────────────────────────────────────────────

/** Team TDs ≈ implied points × TD_PER_POINT; a QB's share scales with attempts. */
export const PASS_TD_PARAMS = { TD_PER_POINT: 0.11, PASS_SHARE: 0.6, ATT_FULL: 30, RATE_K: 8, COMPRESS: 0.5 };

export function passTdLambda(season, ctx, P = PASS_TD_PARAMS) {
  const implied = ctx?.impliedTotal;
  if (implied == null || !(implied > 0)) return null;
  const teamPassTd = implied * P.TD_PER_POINT * P.PASS_SHARE;
  const share = clampN((season.pass_att_pg || 0) / P.ATT_FULL, 0, 1);
  const anchor = teamPassTd * share;
  const own = season.pass_td_pg ?? 0;
  const n = season.games || 0;
  const rate = n > 0 ? (own * n + anchor * P.RATE_K) / (n + P.RATE_K) : anchor;
  const lambda = anchor + (rate - anchor) * P.COMPRESS;
  return {
    lambda: clampN(lambda, 0, 5),
    anchor: +anchor.toFixed(3),
    teamPassTd: +teamPassTd.toFixed(3),
    attShare: +share.toFixed(3),
    ownRate: +own.toFixed(3),
  };
}

/** Anytime TD: own scoring rate shrunk toward an opportunity-based anchor, scaled by game total. */
export const ATD_PARAMS = { POP_ANCHOR: 0.4, OPP_FULL: 15, RATE_K: 8, COMPRESS: 0.5 };
export const ATD_PARAMS_QB = { ...ATD_PARAMS, OPP_FULL: 12 };
export const atdParamsFor = (pos) => (pos === "QB" ? ATD_PARAMS_QB : ATD_PARAMS);

export function anytimeTdLambda(season, ctx, P = ATD_PARAMS) {
  const gameScale = clampN((ctx?.impliedTotal ?? 22) / 22.0, 0.85, 1.2);
  const rawRate = season.total_td_pg ?? ((season.rush_td_pg || 0) + (season.rec_td_pg || 0));
  const opp = (season.carries_pg || 0) + (season.targets_pg || 0);
  const anchor = P.POP_ANCHOR * clampN(opp / P.OPP_FULL, 0, 1);
  const n = season.games || 0;
  const rateExp = n > 0 ? (rawRate * n + anchor * P.RATE_K) / (n + P.RATE_K) : anchor;
  let lambda = rateExp * gameScale * (ctx?.roleMult ?? 1);
  lambda = anchor + (lambda - anchor) * P.COMPRESS;
  return {
    lambda: clampN(lambda, 0.0, 1.2),
    rateExp: +rateExp.toFixed(3), rawRate: +rawRate.toFixed(3), roleExp: null,
    gameScale: +gameScale.toFixed(3), oppAnchor: +anchor.toFixed(3),
    rateEvidence: +n.toFixed(1), roleMult: +(ctx?.roleMult ?? 1).toFixed(3),
  };
}

// ── Player projection ────────────────────────────────────────────────────────

const LG = { ypt: 7.8, ypc: 4.3, ypa: 6.8, catch: 0.66, comp: 0.64 };
const shrink = (rate, n, anchor, K) => (rate == null || !(n > 0) ? anchor : (n * rate + K * anchor) / (n + K));

const roundHalf = (x) => Math.floor(x) + 0.5;
function recLine(mean) { return Math.max(0.5, roundHalf(mean - 4)); }
function passYdLine(m) { return Math.round((m - 6) / 5) * 5 + 0.5; }
function halfLine(mean) { return Math.max(0.5, Math.round(mean - 0.5) + 0.5); }

function prop(type, label, mean, sigma, line, factors, skew = 0) {
  const prob = skew > 0 ? probOverSkewed(mean, sigma, line, skew) : probOverNormal(mean, sigma, line);
  return {
    prop_type: type, label, proj_mean: +mean.toFixed(1), sigma: +sigma.toFixed(1),
    proj_floor: +Math.max(0, mean - sigma).toFixed(1), proj_ceiling: +(mean + sigma).toFixed(1),
    line, prob_over: +prob.toFixed(4), fair_line: probToAmericanOdds(prob), factors,
  };
}
function propPoisson(type, label, mean, line, factors) {
  const prob = poissonGTE(mean, Math.ceil(line));
  return {
    prop_type: type, label, proj_mean: +mean.toFixed(2), sigma: null,
    proj_floor: null, proj_ceiling: null,
    line, prob_over: +prob.toFixed(4), fair_line: probToAmericanOdds(prob), factors,
  };
}

/**
 * Project one player's props for one game. Returns an array of prop rows:
 * { prop_type, label, proj_mean, sigma, proj_floor, proj_ceiling, line,
 *   prob_over, fair_line, factors }.
 */
export function projectPlayer({ season, game, side }) {
  if (!season) return [];
  const ctx = gameContext(game || {}, side);
  const games = season.games || 0;
  const out = [];

  if ((season.targets_pg || 0) >= 1.0) {
    const projTargets = season.targets_pg * ctx.passVolMult;
    const ypt = shrink(season.ypt, season.targets_pg * games, LG.ypt, 30);
    const recMean = projTargets * ypt;
    const recSigma = Math.max(8, recMean * 0.6);
    out.push(prop("rec_yards", "Receiving Yards", recMean, recSigma, recLine(recMean), {
      baseTargets: +season.targets_pg.toFixed(2), projTargets: +projTargets.toFixed(1),
      baseYpt: +ypt.toFixed(2), passVolMult: +ctx.passVolMult.toFixed(3),
      impliedTotal: +ctx.impliedTotal.toFixed(1),
    }, SKEW_W_BY_PROP.rec_yards));
    const catchRate = shrink(season.catch_rate, season.targets_pg * games, LG.catch, 40);
    const recCt = projTargets * catchRate;
    out.push(prop("receptions", "Receptions", recCt, receptionsSigma(projTargets, catchRate), halfLine(recCt), {
      projTargets: +projTargets.toFixed(1), catchRate: +catchRate.toFixed(3),
    }));
  }

  if ((season.carries_pg || 0) >= 3.0) {
    const projCarries = season.carries_pg * ctx.rushVolMult;
    const ypc = shrink(season.ypc, season.carries_pg * games, LG.ypc, 40);
    const rushMean = projCarries * ypc;
    out.push(prop("rush_yards", "Rushing Yards", rushMean, Math.max(8, rushMean * 0.55), recLine(rushMean), {
      baseCarries: +season.carries_pg.toFixed(3), projCarries: +projCarries.toFixed(1),
      baseYpc: +ypc.toFixed(2), rushVolMult: +ctx.rushVolMult.toFixed(3),
    }, SKEW_W_BY_PROP.rush_yards));
    out.push(prop("rush_att", "Rush Attempts", projCarries, Math.max(2.0, Math.sqrt(projCarries) * 1.5), halfLine(projCarries), {
      projCarries: +projCarries.toFixed(1),
    }));
  }

  if ((season.pass_att_pg || 0) >= 15) {
    const projAtt = season.pass_att_pg * ctx.passVolMult;
    const ypa = shrink(season.ypa, season.pass_att_pg * games, LG.ypa, 120);
    const passMean = projAtt * ypa;
    out.push(prop("pass_yards", "Passing Yards", passMean, Math.max(35, passMean * 0.22), passYdLine(passMean), {
      projAtt: +projAtt.toFixed(1), ypa: +ypa.toFixed(2), passVolMult: +ctx.passVolMult.toFixed(3),
      impliedTotal: +ctx.impliedTotal.toFixed(1),
    }));
    const compPct = shrink(season.comp_pct, season.pass_att_pg * games, LG.comp, 160);
    const compMean = projAtt * compPct;
    out.push(prop("completions", "Completions", compMean, Math.max(3.0, Math.sqrt(projAtt) * 1.4), halfLine(compMean), {
      projAtt: +projAtt.toFixed(1), compPct: +compPct.toFixed(3),
    }));
    const td = passTdLambda(season, ctx);
    if (td) {
      out.push(propPoisson("pass_tds", "Passing TDs", td.lambda, 1.5, {
        playerRate: +(season.pass_td_pg || 0).toFixed(2), impliedExp: td.anchor, impliedTotal: +ctx.impliedTotal.toFixed(1),
      }));
    }
  }

  if ((season.targets_pg || 0) + (season.carries_pg || 0) >= 2) {
    const td = anytimeTdLambda(season, ctx, atdParamsFor(season.position));
    out.push(propPoisson("anytime_td", "Anytime TD", td.lambda, 0.5, {
      rateExp: td.rateExp, gameScale: td.gameScale, rawRate: td.rawRate,
      oppAnchor: td.oppAnchor, rateEvidence: td.rateEvidence,
      impliedTotal: +ctx.impliedTotal.toFixed(1),
    }));
  }
  return out;
}
