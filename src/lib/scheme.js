// ── Scheme-matchup engine ────────────────────────────────────────────────────
// The football analog of the MLB "arsenal matchup": weight a player's per-scheme
// efficiency by the opposing defense's actual scheme distribution, then express
// it as a clamped multiplier vs the player's own baseline. Pure math, no I/O.

// League baselines (2025, from the ETL aggregates — refresh if season changes).
export const LG = {
  manRate: 0.317, zoneRate: 0.683,
  ypt: 7.56,           // league yards per target
  ypc: 4.26,           // league yards per carry
  passEpa: 0.064, rushEpa: -0.062,
  pressureRate: 0.30, blitzRate: 0.274,
  lightBoxRate: 0.543, heavyBoxRate: 0.090,
};

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// Confidence ramp: a split needs sample to be trusted. Below `full` targets the
// signal is shrunk toward neutral (1.0), like MLB's bvp confidence.
function conf(sample, full) {
  if (!sample || sample <= 0) return 0;
  return Math.min(sample / full, 1.0);
}

// ── Coverage matchup (WR/TE/RB-receiving) ────────────────────────────────────
// splits: { man_ypt, man_targets, man_success, zone_ypt, zone_targets, zone_success }
// def:    { man_rate, zone_rate, def_pass_epa }
// Returns { mult, expYpt, baseYpt, lean, edge, coverage } where mult multiplies
// the player's projected yards-per-target.
export function coverageMatchup(splits, def) {
  if (!splits || !def) return { mult: 1.0, coverage: 0 };
  const mt = splits.man_targets || 0, zt = splits.zone_targets || 0;
  const totT = mt + zt;
  if (totT < 8) return { mult: 1.0, coverage: 0 };

  const manYpt = splits.man_ypt, zoneYpt = splits.zone_ypt;

  // defense coverage distribution (normalize man+zone to 1)
  let mr = def.man_rate, zr = def.zone_rate;
  if (mr == null || zr == null) return { mult: 1.0, coverage: 0 };
  const s = mr + zr; if (s > 0) { mr /= s; zr /= s; }

  // player's expected ypt under an arbitrary man/zone mix
  const underMix = (m, z) => {
    let e = 0, w = 0;
    if (manYpt != null)  { e += manYpt  * m; w += m; }
    if (zoneYpt != null) { e += zoneYpt * z; w += z; }
    return w > 0 ? e / w : null;
  };
  const expYpt = underMix(mr, zr);                      // vs THIS defense
  let lm = LG.manRate, lz = LG.zoneRate; const ls = lm + lz; lm /= ls; lz /= ls;
  const baseYpt = underMix(lm, lz);                     // vs a league-average defense
  if (expYpt == null || baseYpt == null || baseYpt <= 0) return { mult: 1.0, coverage: 0 };

  // tilt = how this defense's coverage mix helps/hurts vs an average defense
  const coverage = conf(totT, 40);
  let raw = 1.0 + (expYpt / baseYpt - 1.0) * coverage;  // confidence-shrunk
  const mult = clamp(raw, 0.85, 1.18);

  // which way the player leans, for display
  const lean = (manYpt != null && zoneYpt != null)
    ? (manYpt - zoneYpt > 1.0 ? "man-beater" : zoneYpt - manYpt > 1.0 ? "zone-beater" : "balanced")
    : null;
  return { mult, expYpt: +expYpt.toFixed(2), baseYpt: +baseYpt.toFixed(2),
           lean, defManRate: +mr.toFixed(2), coverage: +coverage.toFixed(2) };
}

// ── Box matchup (RB rushing) ─────────────────────────────────────────────────
// splits: { light_box_ypc, light_box_att, heavy_box_ypc, heavy_box_att }
// def:    { light_box_rate, heavy_box_rate, def_rush_epa }
export function boxMatchup(splits, def) {
  if (!splits || !def) return { mult: 1.0, coverage: 0 };
  const la = splits.light_box_att || 0, ha = splits.heavy_box_att || 0;
  const totA = la + ha;
  if (totA < 20) return { mult: 1.0, coverage: 0 };
  const lYpc = splits.light_box_ypc, hYpc = splits.heavy_box_ypc;
  // player's blended ypc on neutral-box plays ≈ overall split average
  const blendYpc = ((lYpc != null ? lYpc * la : 0) + (hYpc != null ? hYpc * ha : 0)) / totA || LG.ypc;

  // player's expected ypc under an arbitrary box distribution (light/heavy/neutral)
  const underBox = (lr, hr) => {
    const nr = Math.max(0, 1 - lr - hr);
    let e = blendYpc * nr, w = nr;
    if (lYpc != null) { e += lYpc * lr; w += lr; }
    if (hYpc != null) { e += hYpc * hr; w += hr; }
    return w > 0 ? e / w : blendYpc;
  };
  const expYpc = underBox(def.light_box_rate ?? LG.lightBoxRate, def.heavy_box_rate ?? LG.heavyBoxRate);
  const baseYpc = underBox(LG.lightBoxRate, LG.heavyBoxRate);   // vs league-average box rates

  const coverage = conf(totA, 80);
  let raw = baseYpc > 0 ? 1.0 + (expYpc / baseYpc - 1.0) * coverage : 1.0;
  const mult = clamp(raw, 0.88, 1.15);
  return { mult, expYpc: +expYpc.toFixed(2), baseYpc: +baseYpc.toFixed(2),
           defLightRate: +(def.light_box_rate ?? LG.lightBoxRate).toFixed(2), coverage: +coverage.toFixed(2) };
}

// ── Defensive strength multiplier (EPA-based, position-agnostic suppressor) ────
// A defense that allows strongly negative EPA/play suppresses output; positive
// EPA allowed inflates it. Clamped tight. Used on top of the scheme matchup.
export function defenseStrengthMult(def, kind /* 'pass' | 'rush' */) {
  if (!def) return 1.0;
  const epa = kind === "rush" ? def.def_rush_epa : def.def_pass_epa;
  if (epa == null) return 1.0;
  const lg = kind === "rush" ? LG.rushEpa : LG.passEpa;
  // ~0.15 EPA/play swing ≈ ±6%
  return clamp(1.0 + (epa - lg) * 0.40, 0.90, 1.12);
}

// ── Positional pass-defense multiplier ───────────────────────────────────────
// Some defenses are stout vs WRs but leaky vs TEs/RBs (and vice-versa). Uses the
// defense's EPA/target allowed to the receiver's position, relative to overall
// pass EPA, confidence-shrunk by target sample. Layers on top of the coverage
// matchup for the receiving path. Falls back to neutral when the split is thin
// or absent (pre-ETL-refresh data).
export function positionalPassDefMult(def, pos) {
  if (!def || !pos) return 1.0;
  const key = { WR: "epa_vs_wr", TE: "epa_vs_te", RB: "epa_vs_rb" }[pos];
  const tkey = { WR: "tgt_vs_wr", TE: "tgt_vs_te", RB: "tgt_vs_rb" }[pos];
  if (!key) return 1.0;
  const epa = def[key], n = def[tkey];
  if (epa == null) return 1.0;
  const base = def.def_pass_epa ?? LG.passEpa;            // this D's own overall pass EPA
  const c = Math.min((n || 0) / 60, 1.0);                 // 60 targets → full confidence
  // positional EPA above the defense's own baseline = soft spot for that position
  return clamp(1.0 + (epa - base) * 0.35 * c, 0.92, 1.10);
}

// ── Pressure matchup (QB passing / sacks) ────────────────────────────────────
// Without QB-vs-pressure splits we treat the defense's pressure+blitz tendency as
// a suppressor on pass yards and an inflator on sack props. Relative to league.
export function pressureMatchup(def) {
  if (!def) return { passMult: 1.0, sackMult: 1.0 };
  const pr = def.pressure_rate ?? LG.pressureRate;
  const br = def.blitz_rate ?? LG.blitzRate;
  const pdelta = (pr - LG.pressureRate) / LG.pressureRate;       // +ve = pressures more
  const bdelta = (br - LG.blitzRate) / LG.blitzRate;
  // more pressure → fewer pass yards (QB off-platform, shorter throws)
  const passMult = clamp(1.0 - pdelta * 0.10 - bdelta * 0.03, 0.90, 1.08);
  // more pressure → more sacks
  const sackMult = clamp(1.0 + pdelta * 0.45 + bdelta * 0.10, 0.75, 1.35);
  return { passMult: +passMult.toFixed(3), sackMult: +sackMult.toFixed(3),
           defPressureRate: +pr.toFixed(2), defBlitzRate: +br.toFixed(2) };
}
