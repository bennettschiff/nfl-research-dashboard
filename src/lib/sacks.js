// ── Sacks: the defensive prop ────────────────────────────────────────────────
// Pure math for the sack model, so the board, the weekly snapshot and the
// grading harness all read the same numbers. Nothing here opens a file.
//
// THE SHAPE
//
//     opportunities = snap share × dropbacks the defence faces
//     λ             = opportunities × player rate × opponent-line adjustment
//
// A player's rate is per DROPBACK HE WAS ON THE FIELD FOR, not per game and not
// per snap. Per game confuses a rotational end with a every-down one; per snap
// credits a nickel corner for the run downs he was standing on. Snap share ×
// dropbacks is the number of chances he actually got to rush a passer.
//
// ── WHY THE RATE IS PART QB HITS ─────────────────────────────────────────────
// A sack is a rare event — 0.12 per defender-game, 88% of defender-games are a
// zero — so a player's own sack history is a noisy read on his own pass rush. A
// QB hit happens 2.4x as often and is the same skill one step earlier. Blending
// the two (70% hits, converted into sack units by the league rate ratio) beats
// either alone on 2024-25 held out, and the gain is exactly where theory says it
// should be: biggest for players with the least history, reversing only for the
// handful with 700+ prior pass-rush snaps on file, where their own sacks are
// finally the better evidence. See scripts/backtest_sacks.mjs.
//
// ── AND NOW PRESSURES, WHICH BEAT HITS (2026-10-20) ──────────────────────────
// A PRESSURE (hurry + hit + sack, charted by PFR, published by nflverse as
// pfr_advstats within days of a game) is the same skill one step earlier again,
// and ~3x as frequent as a hit. Gridded on 2022-23 with hits and pressures
// sharing one budget, the fit drops hits to ZERO and puts 0.85 on pressures;
// held out on 2024-25 every group improves (RMSE 0.34821 -> 0.34753, corr
// 0.3715 -> 0.3756; DL 0.41545 -> 0.41426, LB 0.42958 -> 0.42918, DB 0.16132 ->
// 0.16106) and the rows that project into a book's range stop running hot
// (projected / actual 1.049 -> 1.015). On the 2026 ledger's 663 graded sack rows
// Brier .1560 -> .1551, and on the 436 with a posted price .1340 -> .1323 against
// the price's own .1339. The hit blend is kept as the FALLBACK for a player row
// that carries no pressure data, so a stale artifact degrades to the old model
// rather than to sacks alone.
//
// ── THE RATE IS SHRUNK TOWARD HIS POSITION GROUP, NOT THE LEAGUE ─────────────
// Defensive linemen and linebackers record 88% of the league's sacks, so a
// pooled league rate IS a pass rusher's rate, and shrinking a safety toward it
// hands him a lineman's prior. On 2024-25 held out the pooled version projected
// defensive backs 59% high overall and 75% high on the rows that actually reach
// the board, while linemen (+6%) and linebackers (-4%) were already right. The
// aggregate RMSE never showed it — defensive backs are a tenth of the sacks and
// most of the zeros. What showed it was the market: with sack odds pulled for
// the first time, every row at the top of the EV column was a cornerback at a
// price no book had mispriced.
//
// ── WHY THE DISTRIBUTION IS NOT A POISSON ────────────────────────────────────
// Books post 0.25 / 0.5 / 0.75 / 1.0. Those rungs only mean something if the
// model knows a sack CREDIT comes in whole and half units — 23% of the games in
// which a defender is credited contain a split sack. A Poisson laid over half-
// sack units treats 0.5 and 1.0 as equally reachable and is badly wrong at both
// rungs: fitted that way it said P(≥0.5)=52% / P(≥1.0)=18% where the truth was
// 37% / 32%. Sack EVENTS are the count; each event is worth 1.0 with probability
// q and 0.5 otherwise. Fitted q = 0.78 with mild overdispersion (φ = 5).
//
// ── GRADING THE RUNGS ────────────────────────────────────────────────────────
// A line WINS only when the credit is strictly over it. 0.25 needs a half sack;
// 0.5 and 0.75 both need a whole one to win, and a half sack on 0.5 is a push,
// not a win; 1.0 needs one and a half. A credit can land ON a 0.5 / 1.0 / 1.5
// line and push; it can never land on a 0.25 or 0.75. sackProbOver() is P(win)
// and sackPushProb() is the push, and the pick ledger grades by the same rule.

/** Tuned on 2022-23, held out on 2024-25. See scripts/backtest_sacks.mjs. */
export const SACK_PARAMS = {
  /** Shrinkage toward the group rate, in pass-rush opportunities. */
  PRIOR_OPPS: 40,
  /**
   * …and by position group, because the groups do not earn their rates the same
   * way. A lineman rushes on every dropback and his rate is a trait. A safety's
   * sacks come out of blitz packages, which are a game plan rather than a
   * player, so his own history is worth much less and has to be regressed much
   * harder. Tuned on 2022-23, held out on 2024-25: defensive-back RMSE 0.16223 →
   * 0.16132, and the over-projection on the rows that reach the board falls from
   * 1.69x actual to 1.46x. Linebackers wanted no change.
   */
  PRIOR_OPPS_BY_POS: { DL: 80, LB: 40, DB: 300 },
  /**
   * Position groups whose projection is good enough to price against a market.
   *
   * Defensive backs are unbiased in aggregate after the group-rate fix and still
   * run 46% hot on the subset that projects high enough to reach a board — the
   * blitz-package problem again, and shrinkage alone does not finish it. Their
   * projection is worth showing; an EV computed from it is not, so the board
   * shows their line and price and declines to claim an edge. They earn in when
   * the frozen record says they have.
   */
  EV_POS: ["DL", "LB"],
  /**
   * Share of the player rate carried by PFR-charted PRESSURES rather than his
   * own sacks, converted into sack units at his group's ratio. See the header.
   */
  PRESS_WEIGHT: 0.85,
  /** QB hits' share WHEN pressures are on file — the 2022-23 fit says none. */
  HIT_WEIGHT: 0,
  /** QB hits' share for a row with no pressure data: the pre-2026-10-20 model. */
  HIT_WEIGHT_NO_PRESS: 0.7,
  /** The opponent line's sack rate allowed can move λ by at most this much. */
  OPP_CAP: 0.35,
  /** Shrinkage for that opponent rate, in dropbacks. */
  OPP_PRIOR_DB: 350,
  /** Dropbacks faced per 10 points this defence's own team is favoured by. */
  SPREAD_K: 0.04,
  /** Probability a credited sack is a whole one rather than a split. */
  Q_WHOLE: 0.78,
  /** Negative-binomial dispersion on sack events; higher is closer to Poisson. */
  PHI: 5.0,
};

/** Weighted-count shrinkage toward a league rate. */
export const shrunkRate = (num, den, leagueRate, prior) =>
  den + prior > 0 ? (num + leagueRate * prior) / (den + prior) : leagueRate;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/**
 * The opposing offensive line's sacks-allowed multiplier, shrunk and capped.
 *
 * Hoisted out of sackLambda() because it is the only MATCHUP term the sack model
 * has, and the board shows it in the Tilt column — the same slot a receiving row
 * uses for its coverage multiplier. A row cannot print a factor the projection
 * did not use, so there is exactly one place that computes it.
 *
 * Returns 1 for an unknown opponent: no information, no adjustment.
 */
export function sackOppAdj(opp, lg, P = SACK_PARAMS) {
  if (!lg?.teamSackRate) return 1;
  const oppRate = shrunkRate(opp?.sacksAllowed ?? 0, opp?.dropbacks ?? 0,
                             lg.teamSackRate, P.OPP_PRIOR_DB);
  return clamp(oppRate / lg.teamSackRate, 1 - P.OPP_CAP, 1 + P.OPP_CAP);
}

/**
 * A defender's expected sacks.
 *
 * `p`   the player's pre-game aggregates: { wOpps, wSacks, wHits, wPress, snapPct }
 *       — recency-weighted sums from scripts/build_sack_priors.py.
 * `opp` the opposing OFFENSE's line: { dropbacks, sacksAllowed }
 * `lg`  league constants: { sackRate, hitRate, teamSackRate, dropbacks, byPos }.
 *       `byPos[p.pos]` is the position group's own sack and hit rate and is what
 *       the player term shrinks toward; the pooled pair is the fallback for a
 *       player whose group is unknown.
 * `spread` how much this defence's own team is favoured by (points, its side).
 *
 * Returns null when the player has no projectable snap share, rather than a
 * confident zero — a defender with no snap history is unknown, not bad.
 */
export function sackLambda(p, opp, lg, spread = 0, P = SACK_PARAMS) {
  if (!p || !(p.snapPct > 0)) return null;
  // His group's rates, falling back to the pooled pair when the group is absent.
  const grp = lg.byPos?.[p.pos];
  const lgSack = grp?.sackRate ?? lg.sackRate;
  const lgHit = grp?.hitRate ?? lg.hitRate;
  const prior = P.PRIOR_OPPS_BY_POS?.[p.pos] ?? P.PRIOR_OPPS;
  const sackRate = shrunkRate(p.wSacks, p.wOpps, lgSack, prior);
  const hitRate = shrunkRate(p.wHits, p.wOpps, lgHit, prior);
  // The hit term is converted into sack units at his GROUP's ratio: a safety's
  // hit is a blitz that mostly does not finish, a lineman's usually does.
  // Pressures when both the player and the league block carry them; otherwise
  // the hit blend this model shipped with.
  const lgPress = grp?.pressRate ?? lg.pressRate;
  const hasPress = lgPress > 0 && p.wPress != null;
  const pw = hasPress ? P.PRESS_WEIGHT : 0;
  const hw = hasPress ? P.HIT_WEIGHT : P.HIT_WEIGHT_NO_PRESS;
  const pressRate = pw ? shrunkRate(p.wPress, p.wOpps, lgPress, prior) : 0;
  const rate = hw * hitRate * (lgSack / lgHit)
             + pw * pressRate * (lgSack / (lgPress || 1))
             + (1 - hw - pw) * sackRate;

  const oppAdj = sackOppAdj(opp, lg, P);

  // A favoured defence faces a trailing offence, which throws more.
  const dropbacks = lg.dropbacks * (1 + P.SPREAD_K * (spread || 0) / 10);
  return p.snapPct * dropbacks * rate * oppAdj;
}

const MAX_EVENTS = 10;

/** Negative-binomial pmf over 0…MAX_EVENTS, by the recurrence (no logGamma). */
function eventPmf(mean, phi) {
  const out = new Array(MAX_EVENTS + 1).fill(0);
  if (!(mean > 0)) { out[0] = 1; return out; }
  if (!(phi > 0) || phi > 1e6) {                       // Poisson limit
    out[0] = Math.exp(-mean);
    for (let k = 1; k <= MAX_EVENTS; k++) out[k] = out[k - 1] * mean / k;
    return out;
  }
  const p = phi / (phi + mean);
  out[0] = Math.pow(p, phi);
  for (let k = 1; k <= MAX_EVENTS; k++) out[k] = out[k - 1] * ((k - 1 + phi) / k) * (1 - p);
  return out;
}

const BINOM = (() => {                                  // Pascal to MAX_EVENTS
  const t = [[1]];
  for (let n = 1; n <= MAX_EVENTS; n++) {
    const r = [1];
    for (let k = 1; k < n; k++) r.push(t[n - 1][k - 1] + t[n - 1][k]);
    r.push(1); t.push(r);
  }
  return t;
})();

/**
 * The distribution of a defender's sack CREDIT, from λ: index i holds
 * P(credit = i / 2).
 *
 * N sack events, each worth 1.0 with probability q and 0.5 otherwise, so a
 * credit of 0.5·(N + J) with J ~ Binomial(N, q).
 */
export function sackCreditPmf(lambda, P = SACK_PARAMS) {
  const out = new Array(2 * MAX_EVENTS + 1).fill(0);
  if (lambda == null || !(lambda > 0)) { out[0] = 1; return out; }
  const pmf = eventPmf(lambda / (0.5 + 0.5 * P.Q_WHOLE), P.PHI);
  const q = P.Q_WHOLE;
  out[0] = pmf[0];
  for (let n = 1; n <= MAX_EVENTS; n++) {
    if (!(pmf[n] > 0)) continue;
    for (let j = 0; j <= n; j++) out[n + j] += pmf[n] * BINOM[n][j] * Math.pow(q, j) * Math.pow(1 - q, n - j);
  }
  return out;
}

/** P(credit ≥ x), x on the half-sack grid. */
const atLeast = (pmf, x) => {
  let s = 0;
  for (let i = Math.max(0, Math.ceil(2 * x - 1e-9)); i < pmf.length; i++) s += pmf[i];
  return s;
};

/**
 * P(sack credit ≥ R) at the four credits a ladder is built from, from λ.
 * These are AT-LEAST probabilities, the model's own scale — what a line WINS
 * at is sackProbOver(), which is not the same thing on a half-sack line.
 *
 * @returns { p05, p10, p15, p20 } — at least a half, a full, one and a half, two.
 */
export function sackRungs(lambda, P = SACK_PARAMS) {
  if (lambda == null || !(lambda > 0)) return { p05: 0, p10: 0, p15: 0, p20: 0 };
  const pmf = sackCreditPmf(lambda, P);
  return { p05: atLeast(pmf, 0.5), p10: atLeast(pmf, 1.0), p15: atLeast(pmf, 1.5), p20: atLeast(pmf, 2.0) };
}

/**
 * Is this group's projection good enough to price a market against?
 * See SACK_PARAMS.EV_POS — a projection we will show is not automatically a
 * number we will claim an edge with.
 */
export const sackEvTrusted = (pos, P = SACK_PARAMS) => P.EV_POS.includes(pos);

/** The rungs a book posts, and what each one actually needs to happen. */
export const SACK_LINES = [0.25, 0.5, 0.75, 1.0];

/**
 * P(the Yes WINS) at a line: P(credit > line), exactly the rule the grader
 * settles by (pickLedger.js outcomeOf).
 *
 * A credit ON the line is a push, not a win. Until 2026-10-07 this returned
 * P(credit ≥ line's rung) — 0.5 read P(≥ 0.5), 1.5 read P(≥ 1.5) and 2.5 read
 * P(≥ 2.0) — which counted the push as a win on every half-sack line and, at
 * 2.5, priced the bet as if two sacks cashed it. On the 2026 weeks 1-4 ledger the
 * model said 21.4% where 15.8% happened, and the EV-maximising rung picker
 * walked straight to the 1.5 / 2.5 rungs (+700 to +1500) that the off-by-a-rung
 * number flattered most: those rows went 2-68. So:
 *
 *   0.25 → needs a half sack       0.5  → needs a whole one (a half pushes)
 *   0.75 → needs a whole one       1.0  → needs 1.5 (a whole one pushes)
 *   1.5  → needs two               2.5  → needs three
 */
export function sackProbOver(lambda, line, P = SACK_PARAMS) {
  if (line == null) return null;
  return atLeast(sackCreditPmf(lambda, P), Math.floor(2 * line + 1e-9) / 2 + 0.5);
}

/** P(credit lands exactly ON the line) — a push. Zero off the half-sack grid. */
export function sackPushProb(lambda, line, P = SACK_PARAMS) {
  if (line == null || Math.abs(2 * line - Math.round(2 * line)) > 1e-9) return 0;
  return sackCreditPmf(lambda, P)[Math.round(2 * line)] ?? 0;
}

/**
 * The λ a PRICE implies at a rung — sackProbOver run backwards.
 *
 * The official-pick gate has to live in score space, never probability space
 * (CLAUDE.md), and the score for a one-sided rate market is the log ratio of our
 * rate to the market's (src/lib/officialPicks.js, which does the same thing for
 * anytime TD). Anytime TD can invert its market in closed form because its
 * distribution is a Poisson: λ = −ln(1 − p). A sack rung cannot, because the
 * distribution is a compound negative binomial over half-sack credits — so this
 * bisects sackProbOver, which is monotone increasing in λ at every rung.
 *
 * Returns null for a probability outside (0, 1): a price that says a man is
 * certain to record half a sack does not imply a rate, it implies bad data.
 */
export function sackLambdaAt(prob, line, P = SACK_PARAMS) {
  if (prob == null || !(prob > 0) || !(prob < 1)) return null;
  let lo = 0, hi = 8;                       // 8 sacks is far past any real λ
  if (sackProbOver(hi, line, P) < prob) return hi;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (sackProbOver(mid, line, P) < prob) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Grade one line against a credited sack total.
 *
 * `style` "yes" is a book's "0.5+ sacks" yes/no market, which cannot push.
 * "ou" is a true over/under, where landing exactly on a whole or half line does.
 *
 * @returns "over" | "under" | "push"
 */
export function sackOutcome(credit, line, style = "yes") {
  if (credit == null) return null;
  if (style === "ou" && Math.abs(credit - line) < 1e-9) return "push";
  return credit > line ? "over" : "under";
}
