// ── Side, win probability and confidence ─────────────────────────────────────
// Ported from the WNBA lab, which learned all three of these the hard way.
//
// 1. THE BOARD MUST RANK THE SIDE THE MODEL IS ON, NOT THE OVER. Sorting a
//    column of P(over) descending buries every high-conviction UNDER at the
//    bottom of the table, next to the coin flips. `winProb` — max(p, 1−p) — puts
//    a 14% over and an 86% over on the same belief scale, and `sideOf` says which
//    play that belief is about.
//
// 2. CONFIDENCE IS TWO-SIDED for the same reason: it scores DISTANCE FROM A COIN
//    FLIP, so a 14% P(over) earns the same badge as an 86% one. Without a
//    direction marker beside it the column reads as "strong over" on rows that
//    are in fact strong unders, which is why every confidence badge on this board
//    carries the O/U tag.
//
// 3. IT IS A DISPLAY LABEL, NEVER A GATE. CLAUDE.md: gates live in score space,
//    because anything written `prob >= X` silently retunes the day the
//    probability calibration moves. Nothing in this app filters on `tier` — it is
//    a legibility aid on top of the number, exactly like EdgeCell.
//
// Pure. No React, no I/O.

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export const sideOf = (p) => (p == null ? null : p >= 0.5 ? "over" : "under");

/**
 * The call on a ONE-SIDED row: "yes" when the model takes the posted Yes, "no"
 * when it would not, null when no book has priced him.
 *
 * Only the Yes can be bet, so the model's side is not "whichever is likelier"
 * (that would be No on nearly every anytime TD) — it is whether the Yes is worth
 * its price: EV > 0 on the calibrated probability (models.js calibrateToMarket),
 * push-aware on a sack rung. A "no" row stays on the board so the player can be
 * found, and the ledger keeps it as a pass that is never graded into the record.
 * `trusted` false (a position group whose edge the board declines to claim —
 * sacks.js EV_POS) is always a "no".
 */
export const oneSidedCall = (priced, trusted = true) =>
  (!priced ? null : trusted && priced.ev != null && priced.ev > 0 ? "yes" : "no");

// Keyed by SIDE, not by probability, because a confidence badge already knows
// its side and should not have to reconstruct a fake probability to draw itself.
export const SIDE_ARROW = { over: "↑", under: "↓" };
export const SIDE_LETTER = { over: "O", under: "U" };
export const sideArrow = (p) => SIDE_ARROW[sideOf(p)] || "";
export const sideLetter = (p) => SIDE_LETTER[sideOf(p)] || "";

/**
 * P(the side we're on). Lives in [0.5, 1] for a two-sided line.
 *
 * `oneSided` markets (anytime TD — see ONE_SIDED_PROPS) are the exception, and
 * an important one: the book posts only the Yes, so there is no under to be on
 * and max(p, 1−p) turns "9% to score" into a 91% conviction play. For those the
 * bettable probability IS P(over), unflipped.
 */
export const winProb = (p, oneSided = false) =>
  (p == null ? null : oneSided ? p : Math.max(p, 1 - p));

/**
 * How much of this row's baseline is actually MEASURED, in [0, 1].
 *
 * At a season flip almost every projection rests on last year's usage, and the
 * board already says so in the Baseline column. This turns that same provenance
 * into a confidence term, so a carried-forward number cannot wear the same badge
 * as one earned on games played this year. The two penalties are the ones the
 * Baseline chip already flags in the UI: a baseline earned on another team, and
 * one earned in a bigger role than the current depth chart gives him.
 *
 * `c` is the `_carryover` block from src/lib/playerPriors.js; a null block means
 * a plain current-season aggregate, which is fully measured.
 */
export function baselineTrust(c) {
  if (!c) return 1;
  // A PROMOTED row is the weakest thing the board shows, and it must say so.
  // Its volume is not a measurement of this player at all — it is the man he is
  // replacing, handed over because the club filed everyone above him Out (see
  // src/lib/depthPromotion.js). Graded against FanDuel on 2025 it lands within
  // 1.4 yards of the closing line's MAE, so it is a real number and not a guess;
  // but it is a number about a JOB, and a row that is right on average about a
  // job has said nothing about whether this man is the exception.
  if (c.promoted_from) return clamp(0.18 + 0.45 * (c.live_weight ?? 0), 0, 1);
  if (c.prior_source === "rookie") return 0.5;      // live snaps only, but very few
  if (c.prior_source === "role-average") {
    // The weakest baseline the board carries on its own, and it must rank below
    // a carried prior season: that is the player's OWN measured year, this is
    // the league's average for the role his club happens to list him in. Real,
    // and worth projecting off (56-69% of the squared error against a positional
    // mean), but it describes a slot rather than a man.
    let r = 0.22 + 0.65 * (c.live_weight ?? 0);
    if (c.depth_rank != null && c.depth_rank > 2) r -= 0.07;
    return clamp(r * availabilityTrust(c), 0, 1);
  }
  let t = 0.35 + 0.65 * (c.live_weight ?? 0);
  if (c.changed_team) t -= 0.10;
  if (c.depth_rank != null && c.depth_rank > 2) t -= 0.10;
  return clamp(t * availabilityTrust(c), 0, 1);
}

/**
 * How much of the row survives only because we multiplied it by a play rate.
 *
 * A charted RB4's baseline is his slot's rate times the 13% of weeks a man
 * charted there dresses and touches the ball. That row is correct in expectation
 * and it is a statement about a distribution that is 87% zero — which is a
 * different kind of claim from a starter's projection and should not wear the
 * same badge.
 *
 * REASONED, NOT FITTED, and deliberately gentle. The play rate itself is
 * measured (scripts/build_role_baseline.mjs); what a reader should DO about it
 * is not, and confidence is a display label rather than a gate — CLAUDE.md keeps
 * gates in score space precisely so a term like this cannot silently filter the
 * board. It only ever reduces: a play rate of 1 is the identity.
 */
function availabilityTrust(c) {
  const p = c?.play_rate;
  if (p == null || p >= 1) return 1;
  return clamp(0.55 + 0.45 * p, 0, 1);
}

// Tier breaks, in probability points away from a coin flip. Same values as the
// WNBA board so a HIGH badge means the same thing across the labs.
export const CONF_BREAKS = { high: 0.15, medium: 0.07 };
// What baseline provenance is worth, at most, in either direction. Deliberately
// small: it should break ties between two similar edges, never manufacture one.
const TRUST_WEIGHT = 0.05;

/**
 * Confidence for one projected prop.
 *
 * @param prob      model P(over) AT THE BETTABLE LINE (the market's when priced)
 * @param carryover the row's `_carryover` provenance block, or null
 * @param status    injury designation, if known ("Out" / "Doubtful" /
 *                  "Questionable" / null). A player the report has not cleared
 *                  cannot carry a HIGH badge no matter how far from 50% he sits —
 *                  the uncertainty is about whether he plays at all, which no
 *                  amount of projection edge answers.
 * @param oneSided  true for a market with no other side to take (anytime TD).
 *                  Conviction is then measured on P(over) itself rather than on
 *                  distance from a coin flip: a 9% anytime TD is a longshot you
 *                  have little conviction in, not a 91% lock on an under the book
 *                  does not post.
 * @returns { tier, score, side, win, capped } — `capped` is true only when a
 *          designation or a promotion actually COST the row a tier, so the UI's
 *          asterisk marks a real demotion rather than the mere presence of an
 *          injury chip.
 */
export function confidenceOf({ prob, carryover = null, status = null, oneSided = false } = {}) {
  if (prob == null) return { tier: "low", score: 0, side: null, win: null, capped: false };
  const edge = oneSided ? prob - 0.5 : Math.abs(prob - 0.5);
  const score = edge + TRUST_WEIGHT * (baselineTrust(carryover) - 0.5);
  const raw = score >= CONF_BREAKS.high ? "high" : score >= CONF_BREAKS.medium ? "medium" : "low";
  // Two things cap a HIGH, and they are the same kind of thing: an uncertainty
  // about WHETHER HE PLAYS THIS ROLE that no amount of projection edge answers.
  // A Questionable might not dress. A promoted backup has never held the job the
  // number describes — the club handed it to him on Friday.
  const capped = raw === "high" && (DOUBTFUL.has(status) || !!carryover?.promoted_from);
  return {
    tier: capped ? "medium" : raw,
    score,
    side: oneSided ? "over" : sideOf(prob),
    win: winProb(prob, oneSided),
    capped,
  };
}

const DOUBTFUL = new Set(["Questionable", "Doubtful"]);

/** Rank for sorting. High first when descending. */
export const CONF_RANK = { high: 3, medium: 2, low: 1 };
