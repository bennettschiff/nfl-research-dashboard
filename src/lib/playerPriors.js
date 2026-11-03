// ── Season-flip player priors + in-season carryover ──────────────────────────
// The player analog of teamPriors.js. teamPriors resolves a team's offensive
// prior from its PLAY-CALLER and weans it onto live data at a measured rate;
// this does the same for an individual player's baseline.
//
// It exists because build_player_season aggregates only the CURRENT season, so
// at 2026 week 1 it emits zero rows and there is no board at all. A player needs
// a baseline before he has played a snap, and that baseline is last season's —
// but only to the degree last season actually predicts this one, which
// scripts/calibrate_player_carryover.mjs measured rather than assumed.
//
// ── WHAT WAS MEASURED (walk-forward, 2022→2025, 1,835 season transitions) ────
// Week W is predicted from weeks < W plus the prior season; never from week W.
//
// VOLUME CARRIES, EFFICIENCY DOES NOT. At week 1, against a positional league
// mean, the player's own prior season is:
//
//     targets_pg   26.9% BETTER      ypt    2.5% WORSE
//     carries_pg   37.1% BETTER      ypc    3.0% WORSE
//     pass_att_pg   0.9% WORSE       ypa    2.6% better
//
// A receiver's target count is a ROLE and roles persist across a season break.
// His yards-per-target is noise — last year's is literally worse than just using
// the positional league mean. This is the same split error_decomp.mjs found
// within a season (volume corr 0.58-0.66, efficiency 0.08-0.11), showing up
// again across the season boundary, and it is why efficiency is carried at a
// heavy discount below while volume is carried at face value.
//
// ── HOW THE TWO KNOBS COMPOSE ────────────────────────────────────────────────
// `trust` is the cold-start weight on the player's own prior versus the league
// mean. `k` is the weaning rate once live games exist: live weight = n/(n+k).
//
// For the stats the shipped model ALREADY regresses toward league (pass_att_pg
// via PASS_ATT_SHRINK_K, ypt/ypc/ypa via YP*_SHRINK_K), `trust` is NOT applied
// here — that would shrink twice. It is instead expressed as the EFFECTIVE
// SAMPLE that reproduces it through the existing shrinkRate:
//
//     a = n/(n+K)   →   n = a·K/(1-a)
//
// so league regression keeps happening in exactly one place. This also fixes a
// live defect: shrinkRate returns the raw rate when n=0, so at week 1 every
// shipped shrinkage — including the pass-attempt shrinkage that was the largest
// single model win — would silently switch OFF. Supplying an effective sample
// instead of zero is what keeps it on.
//
// ── SPLIT DISCIPLINE ─────────────────────────────────────────────────────────
// `k` splits on whether the player changed teams (measured on 4k-12k player-week
// observations, and the direction is consistent: a mover's prior describes a role
// he no longer holds, so live data displaces it ~4x faster). `trust` does NOT
// split — it is fitted per player-SEASON, so its subsamples run 44-258 rows and
// only 2 of 6 stats clear a 150-row bar. Pooled rather than fitted on noise.
import PRIORS_2026 from "../../scripts/out/player_priors_2026.json" with { type: "json" };
import { applyRosterStatus, hasRosterStatus } from "./rosterStatus.js";
import ROLE_BASELINE_2025 from "../../scripts/out/role_baseline_2025.json" with { type: "json" };

// Fitted by scripts/calibrate_player_carryover.mjs. `trust` is the cold-start
// weight on the prior; `effN` is that same trust expressed as pseudo-events for
// the shrinkage the model already applies (null = no downstream shrinkage, so
// the value passes through and `trust` is applied directly).
// `trust` is recorded for every stat because it is what was measured, but note
// that the two volume stats with no downstream anchor both fit at trust=1.0 —
// a player's prior-season target and carry volume is carried at FACE VALUE,
// with no regression toward a positional mean, because that is what scored best.
// The measured positional means live in out/player_carryover_calibration.json;
// nothing consults them today, and reintroducing one should follow a new fit
// rather than a guess.
export const CARRYOVER = {
  targets_pg:  { trust: 1.00, kSame: 2,  kMoved: 0.5, effN: null,  effUnit: null },
  carries_pg:  { trust: 1.00, kSame: 1,  kMoved: 0.5, effN: null,  effUnit: null },
  pass_att_pg: { trust: 0.40, kSame: 6,  kMoved: 0.5, effN: 4,     effUnit: "games" },
  ypt:         { trust: 0.20, kSame: 12, kMoved: 12,  effN: 7.5,   effUnit: "targets" },
  ypc:         { trust: 0.40, kSame: 6,  kMoved: 10,  effN: 26.7,  effUnit: "carries" },
  // ypa is blended by its own EVENTS rather than by games — see `poolBy` and the
  // note below. kSame/kMoved are the values calibrate_player_carryover fitted and
  // are no longer consulted for a poolBy key; they are left as the record of what
  // was measured.
  ypa:         { trust: 0.60, kSame: 5,  kMoved: 8,   effN: 45,    effUnit: "attempts",
                 poolBy: "pass_att" },

  // ── THE TWO RATES THAT WERE NOT CARRIED AT ALL ─────────────────────────────
  // blendPlayerSeason spreads `live` first and then overwrites only the keys in
  // this table, so a rate missing from it kept whatever the live season-to-date
  // held — no prior, no blend, no shrinkage. catch_rate and comp_pct were both
  // missing, and both feed a graded market.
  //
  // At week 2 that means ONE GAME. Measured on the 2026 week-2 board: all 205
  // receiver rows and all 33 quarterback rows carried a rate off a single game,
  // and 48 of the 167 priced receptions rows sat at or beyond 0.95 / 0.35 — a
  // full-season catch rate essentially never leaves 0.50-0.80. It was the whole
  // top of the receptions board:
  //
  //   Kendrick Bourne  8/8  -> 1.000  (2025: .698 on 53 tgt)  proj 5.9 vs line 2.5
  //   Keenan Allen     6/6  -> 1.000  (2025: .664 on 122)     proj 5.5 vs 3.5
  //   Ja'Marr Chase    2/4  ->  .500  (2025: .676 on 185)     proj 3.8 vs 6.5
  //   Jaylen Waddle    1/3  ->  .333  (2025: .640 on 100)     proj 1.3 vs 4.5
  //
  // Four targets were moving the model UNDER the market on Ja'Marr Chase. Both
  // are now pooled on their own events like ypa, and shrunk downstream toward a
  // league rate (models.js CATCH_SHRINK_K / COMP_SHRINK_K). Walk-forward
  // 2022-25, predicting at each game's ACTUAL targets/attempts so only the rate
  // is under test, tuned on 2022-23 and reported on 2024-25:
  //
  //   catch_rate -> receptions   n=5,482    RMSE 1.197 -> 1.058  (-11.6%)
  //     of which live sample <20 n=2,595    RMSE 1.205 -> 0.976  (-19.0%)
  //   comp_pct   -> completions  n=  974    RMSE 3.382 -> 2.813  (-16.8%)
  //     of which live sample <20 n=  129    RMSE 4.898 -> 2.524  (-48.5%)
  //
  // Bias improves in both (+0.026 -> -0.011 and +0.069 -> +0.045), and the
  // holdout is flat across the whole (effN, K) neighbourhood — every candidate
  // tried lands within 0.002 of RMSE, so neither pick is fragile.
  //
  // They carry no kSame/kMoved because they were never in the carryover fit;
  // `poolBy` is the only schedule they have ever had.
  catch_rate:  { effN: 80,  effUnit: "targets",  poolBy: "targets" },
  comp_pct:    { effN: 120, effUnit: "attempts", poolBy: "pass_att" },
};

// ── WHY ypa CARRIES `poolBy` AND THE OTHER RATES DO NOT ─────────────────────
// Stage 1 below weans a prior onto live data on a schedule counted in GAMES, and
// stage 2 declares the prior worth a flat `effN` events. Both constants describe
// a FULL prior season, and neither asks how much the prior actually contains.
//
// For a quarterback that gap is enormous. A starter's season is ~500 attempts;
// Malik Willis's 2025 was 35 — two of those four "games" were a single throw in
// garbage time — at 12.06 y/a. Carried into 2026 as MIA's charted QB1, the flat
// kMoved=8 gave that mop-up rate 89% of the weight against his one real start
// (27 attempts, 8.15 y/a), and the flat effN=45 told the downstream shrink he
// had MORE evidence than he had thrown. Blended 11.63, shrunk to 10.27, and the
// board opened him at 288 passing yards against a 185.5 line — the highest
// projection on the slate, for a backup on the league's worst offence.
//
// Fixed by blending ypa on the scale its evidence is actually measured in:
// attempts, with the prior weighted at min(effN, its own attempts) so it can
// never assert more than it contains. Walk-forward 2022-25, predicting at each
// start's ACTUAL attempts so only the rate is under test, tuned on 2022-23 and
// reported on 2024-25 (n=974 starts, 159 of them off a prior under 150
// attempts), paired with YPA_SHRINK_K 30 -> 120:
//
//                     RMSE            MAE           bias
//   ALL          55.74 -> 53.96   44.38 -> 43.15   -2.5 -> -1.7
//   thin prior   65.90 -> 57.23   52.39 -> 46.02   -3.4 -> +7.3
//   normal       53.53 -> 53.30   42.81 -> 42.59   -2.4 -> -3.4
//
// The thin band's BIAS is the honest cost and is stated rather than buried: a
// quarterback carrying a thin prior really does throw for less than the league
// (6.71 y/a against 7.15 on this population), so anchoring him at LG_YPA runs
// him ~8 yards hot. Conditioning the anchor on "thin" would be fitting a
// threshold this screen invented, so it is not done; RMSE and MAE both fall by
// more than 12% and that is the trade.
//
// NOT APPLIED TO ypt OR ypc, measured the same way on the same folds: ypt -2.6%
// RMSE on thin priors and +0.1% overall, ypc -1.4% and -0.7%. Both are inside
// the noise, and retuning a fitted constant on noise is how a calibration drifts.
// The asymmetry is real rather than arbitrary — a thin QB prior is 35 attempts
// against a starter's 500, a 14x gap, while a thin receiver prior is 30 targets
// against 100.
//
// ypc carries the same pathology in the ARTIFACT and it does not matter: a
// receiver with two jet sweeps carries a ypc of 40.5, and Adonai Mitchell's one
// carry for -4 yards gives him -4.00. Neither reaches a projection, because
// projectPlayer gates rushing on `carries_pg >= 3.0` and there are zero WR/TE
// rush_yards rows on the board. Left alone deliberately: the gate already does
// the job, and the fix measured as noise on the rows that clear it.

// ── the SCORING ROLE, which used not to cross the break at all ───────────────
// CARRYOVER above lists six stats and blendPlayerSeason copied exactly those.
// Everything else on a prior row was dropped, and "everything else" included the
// entire input to the anytime-TD model: the player's own TD/game rate and the
// red-zone / goal-line role that says where he was standing when touchdowns were
// available.
//
// THE FAILURE THAT FOUND IT (2026 week 1). With no TD rate and no role,
// anytimeTdLambda's rate term fell back to its own opportunity anchor and its
// role term went null, so λ reduced ALGEBRAICALLY to
//
//     λ = anchor × (1 + COMPRESS × (gameScale − 1)),   anchor = 0.50 for anyone
//                                                      with ≥8 touches/game
//
// — the player had cancelled out. Omarion Hampton (LAC RB1, 0.56 TD/g, 0.89
// goal-line carries a game) and Kimani Vidal (RB3, 0.31, 0.58) both came out at
// 0.605, as did Scott Matlock, as did every other Charger above the touch
// threshold. Across the slate 287 distinct λ values covered 565 players, and the
// distinct values were the 32 implied team totals. The anytime-TD board was a
// ranking of Vegas game totals wearing a projection's clothes.
//
// ── HOW THESE ARE CARRIED, AND WHY THE TWO HALVES DIFFER ────────────────────
// OPPORTUNITY (rz/gl carries and targets) is volume, and the fit above is
// unambiguous that volume carries: it is a role, and roles survive a season
// break. Carried on the same schedule as the carries and targets they are a
// subset of.
//
// CONVERSION (total_td_pg) is not. A TD rate over one season is a small count on
// a noisy process, which is the exact thing ATD_PARAMS.RATE_K already exists to
// shrink — so this does NOT shrink it a second time. It carries the rate and
// declares what the rate is WORTH, in pseudo-games, through the same `_effN`
// channel the ypt/ypc/ypa priors use; anytimeTdLambda reads that instead of the
// live game count, so a carried rate is shrunk exactly as hard as its evidence
// deserves and a live season displaces it as it accumulates.
//
// ── WHAT THIS BOUGHT, MEASURED (scripts/calibrate_atd.mjs --carryover) ───────
// 2025 weeks 1-3 graded off 2024 priors — the fold that reproduces a flip, 736
// anytime-TD props. A = the old blend, B = this one:
//
//   fold             n     A mean  bias   Brier  |  B mean  bias   Brier  actual
//   opening wk1-3   736    25.2%  +2.2pp  .1653  |  22.2%  −0.8pp  .1610  23.0%
//   wk4-10         1773    21.1%  −2.0pp  .1620  |  20.8%  −2.3pp  .1617  23.1%
//   wk11-16        1600    20.7%  −0.7pp  .1521  |  20.6%  −0.8pp  .1521  21.4%
//
// and rank correlation against the market 0.803 → 0.846 on the opening fold. The
// mid-season folds move by nothing to four decimals, which is the point: where a
// live baseline exists this layer has nothing to do, so it cannot be buying the
// flip at their expense.
//
// effN=4 IS A FLAT CHOICE AND IS LABELLED ONE. The grid runs 0→18 and the whole
// surface is Brier .1620→.1601 with rank correlation peaking at 4 (0.846) — the
// win above is the ROLE half, not the evidence weight on the rate half, which
// the effN=0 row (rank corr 0.841, still far above A's 0.803) says outright.
// Picked on rank correlation with Brier tied; do not read it as a fitted
// constant of the same standing as CARRYOVER's.
export const SCORING_CARRYOVER = {
  total_td_pg:   { kSame: 4, kMoved: 2,   effN: 4, effUnit: "games", fade: true },
  rush_td_pg:    { kSame: 4, kMoved: 2,   effN: null, effUnit: null },
  rec_td_pg:     { kSame: 4, kMoved: 2,   effN: null, effUnit: null },
  rz_carries_pg: { kSame: 1, kMoved: 0.5, effN: null, effUnit: null },
  rz_targets_pg: { kSame: 2, kMoved: 0.5, effN: null, effUnit: null },
  gl_carries_pg: { kSame: 1, kMoved: 0.5, effN: null, effUnit: null },
  gl_targets_pg: { kSame: 2, kMoved: 0.5, effN: null, effUnit: null },
};

/** Every field blendPlayerSeason carries, and how. */
export const CARRIED = { ...CARRYOVER, ...SCORING_CARRYOVER };

// The priors are frozen at build time; team, roster status and depth-chart rank
// are NOT — they move every week. rosterStatus.js lays the live values over the
// frozen row, so every consumer of a prior (the board, the audit view, the
// grading harness) reads one already-corrected row and no call site has to
// remember to refresh it. See src/lib/rosterStatus.js for why that split exists.
const BY_SEASON = {
  2026: Object.fromEntries(
    PRIORS_2026.map((r) => [r.player_id, applyRosterStatus(2026, r)]),
  ),
};

/** The 2026 prior row for one player, or null when the season has no priors. */
export function playerPriorFor(season, playerId) {
  return BY_SEASON[season]?.[playerId] ?? null;
}

/** Whether a season's priors are being corrected by a live roster pull. */
export function hasLiveRoster(season) {
  return hasRosterStatus(season);
}

/** Whether a season has player priors at all — lets the UI decide without a hardcoded year. */
export function hasPlayerPriors(season) {
  return !!BY_SEASON[season];
}

/** Every prior for a season, for the audit view. */
export function playerPriorsFor(season) {
  return BY_SEASON[season] ?? {};
}

// ── the depth chart as a statement about VOLUME, not just about movement ────
// scripts/out/role_baseline_<season>.json publishes, per (position, depth rank),
// what the slot produces PER GAME THE MAN PLAYS and how often a man charted
// there plays at all. Both halves are load-bearing and they are deliberately not
// pre-multiplied — see scripts/build_role_baseline.mjs.
//
// ── THE CONDITIONING DEFECT THIS FIXES ──────────────────────────────────────
// Every baseline in this file is a PER-APPEARANCE rate. aggregateWeeks() divides
// by games with a stat line; a carried prior season divides by games played; the
// role cell divides by games the slot played. The board then uses all three as
// an expectation for a game the club is SCHEDULED to play.
//
// For a starter those are the same number — a charted RB1 records a stat line in
// 98% of his club's games — so the error was invisible for as long as the board
// only carried starters. For a backup it is a factor of three to eight, and it
// is the entire reason the volume floor reads the way it does:
//
//   the floor sees              he actually gets      because he plays
//   RB4, 2.24 carries a game    0.28                  13% of weeks
//   QB2, 12.6 attempts a game   3.6                   28% of weeks
//   TE3, 1.31 targets a game    0.70                  53% of weeks
//
// Measured no-lookahead on 2025 (scripts/screen_backup_baseline.mjs), among rows
// the board ALREADY carries: at rank 1 the correction changes nothing (bias
// +0.08 → +0.00, MAE 4.34 → 4.22 on 1,437 player-weeks), and at rank 3+ it takes
// bias +4.44 → +0.57, RMSE 7.94 → 3.77 and correlation −0.160 → +0.145 on 1,071.
// A negative correlation is a projection that ranks deep players BACKWARDS, and
// that is what shipped.
//
// ── THE TWO TERMS ───────────────────────────────────────────────────────────
//   ROLE SHRINKAGE       a carried rate is half his, half his slot's. It is a
//                        measurement of the role he held THEN; the chart says
//                        what he holds NOW, and neither alone is the answer.
//   AVAILABILITY SCALING times the play rate of the rank he currently holds,
//                        which converts a per-appearance rate into the
//                        per-scheduled-game expectation the board wants.
//
// ── how much of him, and how much of his slot ───────────────────────────────
// The first cut of the role shrinkage was a FLAT half-and-half, and the fold
// that killed it was the one that matters most for not breaking things: run
// through the real harness against FanDuel closing lines, a flat 0.5 moved 27.4%
// of market-priced props and paid for it — receiving Brier .2547 → .2598 on the
// opening fold, rushing side accuracy 53.9% → 50.6%. It was regressing every
// starter toward his positional mean, which is a thing nobody asked for: a
// receiver with seventeen games behind his target rate does not need the league
// to tell him what a WR1 gets.
//
// So the weight is the codebase's own shrinkage idiom rather than a constant —
// W = n/(n+ROLE_K) in games behind the carried rate, the same shape shrinkRate()
// and the _effN channel already use everywhere else. A full prior season lands
// near 0.73 and barely moves; George Holani's five games as Seattle's RB4 land
// at 0.45 and move a long way, which is the correct relative statement about two
// baselines of very different weight.
//
// ROLE_K = 6, fitted 2025 (scripts/screen_backup_baseline.mjs § 5). It is where
// bias crosses zero on the rank-1 control (−0.014) while the dropped rows keep
// essentially all of the flat version's accuracy (RMSE 1.483 against 1.475,
// correlation 0.486 against 0.495). The surface between K=4 and K=10 is flat to
// 0.003 of RMSE on both folds.
export const DEPTH = { ROLE_K: 6 };

/** The weight a carried rate earns against its slot's, from the games behind it. */
export const roleWeight = (games, K = DEPTH.ROLE_K) =>
  (games > 0 ? games / (games + K) : 0);

// Per-game COUNTS, which are per-appearance and therefore need both terms. Rate
// fields beside them (ypt, ypc, ypa, catch_rate, adot, comp_pct, int_rate) are
// per-target / per-carry / per-attempt and are already unconditional — scaling
// them would be a straightforward unit error.
const PER_GAME = ["targets_pg", "rec_pg", "rec_yards_pg", "rec_td_pg",
  "carries_pg", "rush_yards_pg", "rush_td_pg", "pass_att_pg", "pass_yards_pg",
  "pass_td_pg", "total_td_pg", "rz_carries_pg", "rz_targets_pg",
  "gl_carries_pg", "gl_targets_pg"];

// ── fields the ROLE SHRINKAGE must not touch, because the model already does it
// This file's own header states the rule for the carryover `trust` weights:
// where the shipped model already regresses a stat toward a league anchor, doing
// it again here shrinks twice. The same rule binds this layer, and it is not
// hypothetical — the first cut of it applied to every field and cost pass_yards
// 0.8 of MAE on the in-sample fold and 1.7 on the late one, because a
// quarterback's attempts were pulled halfway to the QB1 cell (30.8) on top of
// PASS_ATT_SHRINK_K=6 already pulling them toward LG_PASS_ATT (33.0).
//
//   pass_att_pg  regressed by PASS_ATT_SHRINK_K toward the league mean, which is
//                what the QB1 cell essentially IS — the largest single model win
//                on record, and not something to apply twice.
//   pass_td_pg   passTdLambda already blends it 50/50 with an implied-total
//                expectation.
//
// The AVAILABILITY SCALING still applies to both: nothing downstream knows how
// often the man plays, so nothing downstream is doing that job twice. And a
// promoted quarterback's attempts are replaced outright rather than shrunk (see
// src/lib/depthPromotion.js), so a QB2 loses nothing by this exclusion.
const ROLE_SHRINK_SKIP = new Set(["pass_att_pg", "pass_td_pg"]);

// ── role-average baselines, for a player with no history at all ─────────────
// Keyed by the PRIOR season, because that is the season the rates were measured
// in — the same relationship every other carried baseline has to the season it
// is projecting. See scripts/build_role_baseline.mjs for the fit.
const ROLE_BASELINE = { 2025: ROLE_BASELINE_2025 };

// Which prior season a season's role baselines come from.
const PRIOR_SEASON_OF = { 2026: 2025 };

/**
 * The measured baseline for one (position, depth rank), or null.
 *
 * Ranks below the deepest measured cell fall back to that cell rather than to
 * nothing: a WR7 is not a different KIND of player from a WR6, he is the same
 * marginal role, and the alternative is dropping him off the board entirely —
 * which is the behaviour this whole path exists to end.
 */
export function roleBaselineFor(season, position, depthRank) {
  const table = ROLE_BASELINE[PRIOR_SEASON_OF[season]];
  if (!table || !position || depthRank == null) return null;
  const atPos = table.filter((c) => c.position === position);
  if (!atPos.length) return null;
  const exact = atPos.find((c) => c.depth_rank === Math.round(depthRank));
  if (exact) return exact;
  const deepest = atPos.reduce((a, b) => (b.depth_rank > a.depth_rank ? b : a));
  return Math.round(depthRank) > deepest.depth_rank ? deepest : null;
}

/**
 * How often a man his club charts at this rank actually records a stat line, in
 * [0, 1]. Null when the season has no table or the player is off the chart —
 * callers treat that as "no information" and leave the rate alone, which is the
 * pre-2026-09-10 behaviour.
 */
export function playRateFor(season, position, depthRank) {
  const cell = roleBaselineFor(season, position, depthRank);
  return cell?.play_rate ?? null;
}

/**
 * His own per-appearance rate against his current slot's, at weight `w`.
 *
 * `w` is REQUIRED and has no default on purpose: it is earned from the evidence
 * behind the rate (roleWeight above), and a default would silently apply one
 * player's weight to another's number.
 */
export const towardRole = (own, role, w) =>
  (own == null ? (role ?? null) : role == null ? own
    : !Number.isFinite(w) ? own : w * own + (1 - w) * role);

/** A per-appearance rate → a per-scheduled-game one. */
export const perScheduled = (v, playRate) =>
  (v == null || playRate == null ? v : v * playRate);

const liveWeight = (n, k) => (n > 0 ? n / (n + k) : 0);

/**
 * Blend a player's prior season with his live season-to-date into one
 * season-shaped row that projectPlayer can consume unchanged.
 *
 * @param prior  player_priors_2026 row (or null)
 * @param live   player_season_agg row for the current season (or null at week 1)
 * @param opts   `roleCellFor(position, rank)` overrides the shipped role table —
 *               the seam scripts/screen_backup_baseline.mjs uses to inject
 *               walk-forward cells, since the shipped one is keyed 2026←2025 and
 *               grading 2025 off it would be lookahead. `noDepth: true` skips the
 *               depth layer entirely and is the A side of that screen's A/B.
 *               `roleW: 1` keeps the availability scaling and turns the role
 *               shrinkage off, which is how that screen prices the two terms
 *               separately. It is an override, not the default — the default is
 *               DEPTH.ROLE_K weighted by the prior's own game count.
 * @returns a season row, or null when there is no basis to project at all
 *          (a rookie with no live games — see build_player_priors_2026.py).
 */
export function blendPlayerSeason(prior, live, opts = {}) {
  if (!prior && !live) return null;
  if (!prior) return live;                       // no prior: live is all we have
  const cellFor = opts.roleCellFor
    || ((position, rank) => roleBaselineFor(prior.season, position, rank));
  // ── THE CHART SLOT, NOT THE ROSTER GROUP ───────────────────────────────────
  // A player's role cell was looked up by his roster POSITION GROUP and his
  // depth rank, which throws away the one field that says what job he actually
  // holds. A fullback is listed FB1 and his roster group is RB, so FB1 resolved
  // to the RUNNING BACK 1 cell — 14.49 carries a game against the FB1 cell's
  // 0.185, and a TD rate of 0.582 against 0.074. The FB cells exist, are built
  // from 163 player-seasons, and were simply unreachable.
  //
  // On the 2026 week-2 board that was 14 players, and it put two rookie
  // fullbacks at the top of the anytime-TD board: Max Bredeson and DJ Herman at
  // 36% and 32% against a market of 2%, both carrying a feature back's 14.23
  // carries a game. Kyle Juszczyk's own 0.125 TD/game was pulled up to 0.245 by
  // being regressed toward a starting running back.
  //
  // So: the chart slot when the table knows it, the roster group otherwise.
  // Nothing else in the live overlay disagrees (13 RB<-FB, 1 TE<-FB, 1 RB<-TE),
  // and special-teams slots never reach here — pull_roster.mjs's SKILL set drops
  // PR/KR/LS before the overlay is written, so `depth_pos` is always a scrimmage
  // slot by the time a projection sees it.
  const slotCellFor = (rank) => (prior.depth_pos && prior.depth_pos !== prior.position
    ? cellFor(prior.depth_pos, rank) : null) ?? cellFor(prior.position || live?.position, rank);
  let isRookie = prior.prior_source === "rookie";
  if (isRookie) {
    // No NFL history — but the club has published where he plays, and a
    // depth-chart rank is a strong statement about volume (it accounts for 56%
    // of the squared error on targets and 69% on carries against a positional
    // mean; see scripts/build_role_baseline.mjs). Projecting him off what his
    // ROLE is worth is not inventing a baseline, it is using the only evidence
    // there is.
    //
    // Before this, blendPlayerSeason returned null here and isProjectable
    // dropped him: 53 rookies sat ACTIVE in their club's top three on the 2026
    // week-1 board and not one appeared, including two listed RB1 — so the board
    // was silent on the man taking the carries while projecting the back behind
    // him.
    //
    // The conversion runs whether or not he has played yet, and that matters:
    // gating it on `!live` meant a charted rookie who played in week 1 fell back
    // to the old rookie branch in week 2, where isProjectable demands three
    // games — so he would appear on the board, play, and then VANISH. Converting
    // unconditionally lets the normal blend wean the role average onto his own
    // games at the fast rate instead.
    const role = slotCellFor(prior.depth_rank);
    if (role) {
      prior = { ...prior, ...role, position: prior.position, season: prior.season,
        prior_source: "role-average", prior_team: null, games: role.games };
      isRookie = false;
    } else if (!live) {
      return null;            // off the chart AND no snaps — genuinely nothing to say
    }
  }
  // An uncharted rookie who is nonetheless playing: live snaps are all we have.
  if (isRookie) return { ...live, team_abbr: prior.team_abbr, _carryover: { prior_source: "rookie", live_games: live.games || 0, live_weight: 1 } };

  const n = live?.games || 0;
  // A stale prior (last played before 2025) describes a role the player no
  // longer holds for the same reason a team change does, so it weans on the
  // faster schedule. Not separately fitted — 60 players, mostly marginal — but
  // treating it as fresh would be plainly wrong in the other direction.
  // A role average describes a ROLE rather than a player, so live snaps should
  // displace it as fast as they displace a mover's prior — faster, if anything.
  const moved = !!prior.changed_team || prior.prior_source === "stale-prior"
    || prior.prior_source === "role-average";
  const pos = prior.position || live?.position;
  const depthOn = !opts.noDepth;

  const out = {
    ...(live || {}),
    player_id: prior.player_id,
    position: pos,
    team_abbr: prior.team_abbr,                  // 2026 team, not where he finished 2025
    season: prior.season,
    games: n,
  };

  // ── term 1: shrink the CARRIED opportunity halfway toward his current slot ─
  // Only the prior is shrunk, never the live season. Live games are a
  // measurement of the role he holds now and need no help from the chart, and
  // shrinking them too would fight the weaning schedule above rather than
  // compose with it. A role-average prior IS the cell, so this is the identity
  // there and the rookie path is left exactly as it was.
  const cell = depthOn ? slotCellFor(prior.depth_rank) : null;
  // Weighted by the evidence behind the PRIOR, not behind the blended row: the
  // live season gets its own weight from the weaning schedule below, and giving
  // it a second vote here would fight that fit rather than compose with it.
  const roleW = opts.roleW ?? roleWeight(prior.games);
  if (cell && roleW < 1 && prior.prior_source !== "role-average") {
    const shrunk = { ...prior };
    for (const key of PER_GAME) {
      if (ROLE_SHRINK_SKIP.has(key)) continue;
      if (prior[key] == null && cell[key] == null) continue;
      shrunk[key] = towardRole(prior[key], cell[key], roleW);
    }
    prior = shrunk;
  }

  const effN = {};
  for (const [key, cfg] of Object.entries(CARRIED)) {
    const pv = prior[key];
    const lv = live?.[key];
    if (pv == null && lv == null) continue;

    // Stage 1 — wean the prior onto live data at the measured rate. The prior is
    // carried at face value; all regression toward league happens downstream via
    // the effective sample in stage 2, so it is never applied twice.
    //
    // A `poolBy` key (ypa alone) is weaned on its own EVENTS instead of on
    // games, because the games schedule cannot tell a 500-attempt prior from a
    // 35-attempt one and hands both the same weight. See the note under
    // CARRYOVER.
    const liveEventsFor = (unit) => (unit === "games" ? n
      : unit === "targets" ? (live?.targets_pg || 0) * n
      : unit === "carries" ? (live?.carries_pg || 0) * n
      : (live?.pass_att_pg || 0) * n);
    // What the prior is worth: its fitted value, but never more than the events
    // it was actually built on. `prior[poolBy]` is the raw season total; it is
    // absent on a role-average prior and on older artifacts, and falling back to
    // the fitted value there is exactly the previous behaviour.
    const priorEvents = cfg.poolBy && prior[cfg.poolBy] != null
      ? Math.min(cfg.effN, prior[cfg.poolBy])
      : cfg.effN;
    if (cfg.poolBy) {
      const le = liveEventsFor(cfg.effUnit);
      const tot = priorEvents + le;
      out[key] = pv == null ? lv : lv == null || tot <= 0 ? pv
        : (priorEvents * pv + le * lv) / tot;
    } else {
      const k = moved ? cfg.kMoved : cfg.kSame;
      const w = liveWeight(n, k);
      out[key] = pv == null ? lv : lv == null ? pv : w * lv + (1 - w) * pv;
    }

    // Stage 2 — the evidence behind that number, for the model's shrinkage.
    // The prior contributes its fitted worth, NOT its real event count: a prior
    // season's ypt is worth ~7.5 targets no matter how many the player had. A
    // `poolBy` key is the exception — its worth is capped at what it contains,
    // for the reason above, and stage 1 already blended on that basis.
    if (cfg.effN != null) {
      const liveEvents = liveEventsFor(cfg.effUnit);
      // `fade` (scoring keys only): a prior contributes its pseudo-events only
      // while it is still IN the blended number, so they decay on the same
      // schedule the prior itself does. The four fitted keys above deliberately
      // do NOT fade — their effN was measured as a flat addition and changing
      // its shape here would silently retune calibrate_player_carryover's fit.
      const carried = cfg.fade
        ? cfg.effN * (pv == null ? 0 : 1 - liveWeight(n, moved ? cfg.kMoved : cfg.kSame))
        : priorEvents;
      effN[key] = carried + liveEvents;
    }
  }

  // ── term 2: a per-appearance rate → a per-scheduled-game expectation ──────
  // Applied to the BLENDED number rather than to either input, which is the same
  // thing: scaling is linear and commutes with the convex blend above. Every
  // input to it — the carried prior, the role cell and aggregateWeeks()' live
  // rates alike — divides by games the man appeared in, so one multiplier
  // converts all of them at once.
  const playRate = depthOn ? (cell?.play_rate ?? null) : null;
  if (playRate != null) for (const key of PER_GAME) out[key] = perScheduled(out[key], playRate);

  out._effN = effN;
  out._carryover = {
    play_rate: playRate,
    prior_source: prior.prior_source,
    prior_team: prior.prior_team,
    changed_team: moved,
    depth_rank: prior.depth_rank ?? null,
    depth_pos: prior.depth_pos ?? null,
    live_games: n,
    // The games the carried rates were actually earned over. Without this the
    // header reads "0 g · 10.4 tgt/g", which invites the reader to think the
    // rate is measured on nothing.
    prior_games: prior.games ?? null,
    prior_season: prior.prior_season ?? null,
    // The headline weight, for the UI: how much of this baseline is 2026 data.
    live_weight: +liveWeight(n, moved ? CARRYOVER.targets_pg.kMoved : CARRYOVER.targets_pg.kSame).toFixed(2),
  };
  return out;
}

/**
 * Whether a row has enough behind it to project. Replaces the raw `games >= 3`
 * gate the app used, which is unsatisfiable at a season flip — at week 1 every
 * player has 0 games and a perfectly good prior.
 */
export function isProjectable(row) {
  if (!row) return false;
  const c = row._carryover;
  if (!c) return (row.games || 0) >= 3;          // pre-flip behaviour, unchanged

  const live = c.live_games || 0;
  // Live snaps are the strongest possible evidence of a role and override every
  // depth-chart judgement below — if he is playing, he is projectable.
  if (live >= 3) return true;

  // Still "rookie" here means no depth-chart rank was found, so no role baseline
  // could be built — blendPlayerSeason converts every charted rookie to
  // "role-average" above. Without a rank there is genuinely nothing to project.
  if (c.prior_source === "rookie") return live >= 3;

  // Not on the current depth chart at all: a prior season is not evidence that
  // he will take a snap this year.
  if (c.depth_rank == null) return false;

  // QUARTERBACKS ARE A HARD GATE. Only one plays. Every other position splits
  // its snaps, so volume filters do reasonable work there, but a backup QB
  // carries a full starter's prior — this is what put Chris Oladokun, Trevor
  // Siemian and Case Keenum on the week-1 board next to Mahomes.
  //
  // The one way past it is the club saying so. When every quarterback charted
  // above him is filed Out or Doubtful, src/lib/depthPromotion.js stamps the row
  // and he IS the man who plays — measured at 28.0 attempts against a healthy
  // QB2's 1.9. The gate stays a hard one; it just now has the state it was
  // always implicitly asserting.
  if (row.position === "QB") return c.depth_rank === 1 || !!c.promoted_from;

  return true;
}
