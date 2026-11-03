// ── Projection breakdown ─────────────────────────────────────────────────────
// Turns a prop's flat `factors` bag into the CHAIN that actually produced the
// number: a volume leg and an efficiency leg, each a base times an ordered list
// of multipliers, multiplied together.
//
// The old UI dumped `factors` as an unordered key/value list. Every input was
// visible and the STRUCTURE was not, so you could not see that rec_yards is
//
//     (targets/g x game script x pace x vacancy) x (yd/target x coverage x def strength)
//
// nor which term actually moved the projection. This encodes the same chain
// models.js evaluates, so the running total lands on the shipped mean.
//
// Pure — no rendering, no I/O. If a chain here drifts from models.js the
// reconciliation test in breakdown.test.js fails, which is the point: this file
// is a claim about how the model works and must be checked against it.

const pctMult = (m) => `${m > 1 ? "+" : ""}${((m - 1) * 100).toFixed(1)}%`;

/**
 * @returns {null | {legs: Array<{name, base, baseLabel, unit, steps: Array<{key,label,mult,hint}>, total}>,
 *                   total: number, prop: string}}
 */
export function breakdownFor(prop) {
  const f = prop?.factors;
  if (!f) return null;

  if (prop.prop_type === "rec_yards") {
    return assemble(prop, [
      {
        name: "Volume", unit: "targets", base: f.baseTargets, baseLabel: "Season targets / game",
        steps: [
          { key: "passVolMult", label: "Game script", mult: f.passVolMult, hint: "Spread-driven pass lean — trailing teams throw more" },
          { key: "paceMult", label: "Pace", mult: f.paceMult, hint: "Both offenses' plays per game vs league" },
          { key: "targetTotalMult", label: "Implied total", mult: f.targetTotalMult, hint: "Low-total lean — the model over-projects rock fights, so a below-average implied team total shades targets down. Never shades up" },
          { key: "vacancyMult", label: "Teammates out", mult: f.vacancyMult, hint: "Targets vacated by inactive teammates. Measured but currently damped to zero effect" },
        ],
      },
      {
        name: "Efficiency", unit: "yd/target", base: f.baseYpt, baseLabel: "Yards / target (regressed)",
        steps: [
          { key: "coverageMult", label: "Coverage matchup", mult: f.coverageMult, hint: "His per-coverage efficiency weighted by this defense's man/zone mix" },
          { key: "defStrengthMult", label: "Defense strength", mult: f.defStrengthMult, hint: "Defense's EPA/play allowed vs league" },
        ],
      },
    ]);
  }

  if (prop.prop_type === "rush_yards") {
    return assemble(prop, [
      {
        name: "Volume", unit: "carries", base: f.baseCarries, baseLabel: "Season carries / game",
        steps: [
          { key: "rushVolMult", label: "Game script", mult: f.rushVolMult, hint: "Spread-driven run lean — leading teams run more" },
          { key: "paceMult", label: "Pace", mult: f.paceMult, hint: "Both offenses' plays per game vs league" },
          { key: "vacancyMult", label: "Teammates out", mult: f.vacancyMult, hint: "Carries vacated by inactive teammates. Measured but currently damped to zero effect" },
        ],
      },
      {
        name: "Efficiency", unit: "yd/carry", base: f.baseYpc, baseLabel: "Yards / carry (regressed)",
        steps: [
          { key: "boxMult", label: "Box matchup", mult: f.boxMult, hint: "His light/heavy-box efficiency weighted by this defense's box counts" },
          { key: "defStrengthMult", label: "Defense strength", mult: f.defStrengthMult, hint: "Defense's rush EPA/play allowed vs league" },
        ],
      },
    ]);
  }

  if (prop.prop_type === "pass_yards") {
    return assemble(prop, [
      {
        name: "Volume", unit: "attempts", base: f.attBase, baseLabel: "Attempts / game (regressed)",
        steps: [
          { key: "passVolMult", label: "Game script", mult: f.passVolMult, hint: "Spread-driven pass lean" },
          { key: "paceMult", label: "Pace", mult: f.paceMult, hint: "Both offenses' plays per game vs league" },
          { key: "totalMult", label: "Implied total", mult: f.totalMult, hint: "Shootout lean — a high implied team total means more drives" },
        ],
      },
      {
        name: "Efficiency", unit: "yd/attempt", base: f.ypa, baseLabel: "Yards / attempt (regressed)",
        steps: [
          { key: "pressureMult", label: "Pressure matchup", mult: f.pressureMult, hint: "Defense's pressure and blitz rates vs league" },
          { key: "defStrengthMult", label: "Defense strength", mult: f.defStrengthMult, hint: "Defense's pass EPA/play allowed vs league" },
        ],
      },
    ]);
  }

  return null;
}

function assemble(prop, legs) {
  const built = [];
  for (const leg of legs) {
    if (leg.base == null) return null;             // chain not reconstructable
    let running = leg.base;
    const steps = [];
    for (const s of leg.steps) {
      if (s.mult == null) continue;               // model did not compute it at all
      const before = running;
      running *= s.mult;
      // A multiplier of exactly 1 is KEPT, not dropped. The model really did
      // evaluate it and really did apply no tilt — usually because the matchup
      // read had no sample (coverageMatchup returns a hard 1.0 with no splits or
      // no defense). Hiding it would make the chain look like the term does not
      // exist; `neutral` lets the UI dim it and say so instead.
      steps.push({
        ...s, before, after: running, delta: running - before,
        pct: pctMult(s.mult), neutral: s.mult === 1,
      });
    }
    built.push({ ...leg, steps, total: running });
  }
  return {
    prop: prop.prop_type,
    legs: built,
    total: built.reduce((a, l) => a * l.total, 1),
  };
}

/**
 * The board's "tilt" column: the COMBINED matchup effect — every multiplier that
 * depends on the opponent, multiplied together.
 *
 * This previously returned only the scheme term (coverage / box / pressure) and
 * ignored defStrengthMult entirely. That was survivable on a finished season
 * where scheme carried real signal, and wrong at the 2026 flip: scheme is mostly
 * league-mean there (man/zone and box do not persist year over year) while
 * rush-defence EPA does, so the column read "—" for every player while the
 * projection was genuinely moving.
 */
export function tiltOf(p) {
  const f = p?.factors || {};
  const scheme = f.coverageMult ?? f.boxMult ?? f.pressureMult ?? 1;
  return scheme * (f.defStrengthMult ?? 1);
}

/**
 * The step that moved the projection most, in absolute yards. What a reader
 * actually wants to know: of everything the model did, what mattered?
 */
export function dominantStep(bd) {
  if (!bd?.legs?.length) return null;
  let best = null;
  for (const leg of bd.legs) {
    // A volume step's effect on the FINAL number is its own delta scaled by every
    // other leg's total; comparing raw deltas across legs would compare targets
    // to yards-per-target.
    const others = bd.legs.filter((l) => l !== leg).reduce((a, l) => a * l.total, 1);
    for (const s of leg.steps) {
      const impact = Math.abs(s.delta * others);
      if (impact > 0.05 && (!best || impact > best.impact)) {
        best = { ...s, leg: leg.name, impact, signed: s.delta * others };
      }
    }
  }
  return best;
}
