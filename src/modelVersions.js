// Per-market model versions. Every saved pick is tagged `<market>@<version>` so
// calibration checks can tell "the league moved" apart from "we changed the
// model". Bump a market in the same commit as any behavioral change to it.
//
// Public build: one placeholder version for every market. The production
// version history is private.
const PUBLIC = "public-1";

export const MODEL_VERSIONS = {
  rec_yards: PUBLIC,
  receptions: PUBLIC,
  rush_yards: PUBLIC,
  rush_att: PUBLIC,
  pass_yards: PUBLIC,
  completions: PUBLIC,
  pass_tds: PUBLIC,
  def_sacks: PUBLIC,
  anytime_td: PUBLIC,
  spread: PUBLIC,
  total: PUBLIC,
  moneyline: PUBLIC,
  team_total: PUBLIC,
};

export function tagPick(propType) {
  const v = MODEL_VERSIONS[propType];
  return v ? `${propType}@${v}` : "untagged";
}
