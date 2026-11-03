// ── The frozen sack record ───────────────────────────────────────────────────
// scripts/out/sack_record_<season>.json is written by scripts/snapshot_sacks.mjs
// before each week kicks off and graded after it, and is never recomputed from
// today's priors — a projection scored with its own result in the inputs is not
// a record of anything. See the header of that script.
//
// `basis` on a week says where it came from: "live" is what the board actually
// showed before kickoff; "backfill" is a genuine no-lookahead projection (the
// aggregates are cut at that week's first kickoff) that was computed after the
// fact because the model did not exist yet. Both are honest; they are labelled
// because only one of them is a thing somebody could have acted on.
import RECORD_2026 from "../../scripts/out/sack_record_2026.json" with { type: "json" };
import ACTUALS_2026 from "../../scripts/out/sack_actuals_2026.json" with { type: "json" };

const BY_SEASON = {
  2026: { ...RECORD_2026, actuals: ACTUALS_2026 },
};

export const sackRecord = (season) => BY_SEASON[season] || null;
