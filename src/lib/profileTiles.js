// ── Profile tile definitions ─────────────────────────────────────────────────
// Which metrics a profile card shows, grouped, per position. Pure config + a
// couple of formatters — no rendering, no I/O, so the groupings are testable and
// the component stays dumb.
//
// The grouping is the argument the card makes: ROLE (does he get on the field),
// USAGE (what is he asked to do), FINISHING (what happens when the ball comes),
// SCORING (is he near the end zone). Read top to bottom that is a scouting
// report, which is the point — the raw numbers alone are unreadable.

const pct1 = (v) => (v == null ? null : `${(v * 100).toFixed(1)}%`);
const pct0 = (v) => (v == null ? null : `${Math.round(v * 100)}%`);
const num2 = (v) => (v == null ? null : v.toFixed(2));
const num1 = (v) => (v == null ? null : v.toFixed(1));
const num3 = (v) => (v == null ? null : v.toFixed(3));
const signed1 = (v) => (v == null ? null : `${v > 0 ? "+" : ""}${v.toFixed(1)}`);

// key       — field in profile.data / profile.pct
// label     — what it is called on the card
// fmt       — value formatter
// hint      — the one-line explanation, shown on hover; these metrics are not
//             self-explanatory and an unexplained number invites a wrong read
const RECEIVING = [
  {
    group: "Role",
    rows: [
      { key: "route_pct", label: "Route share", fmt: pct0, hint: "Share of the team's dropbacks he ran a route on — the cleanest read on whether he is an every-down receiver" },
      { key: "snap_pct_cum", label: "Snap share", fmt: pct0, hint: "Share of the offense's snaps he was on the field for" },
      { key: "passdown_snap_pct", label: "Pass-down snaps", fmt: pct0, hint: "Snap share specifically on passing downs — separates receiving backs from early-down grinders" },
      { key: "routes_pg", label: "Routes / game", fmt: num1, hint: "Routes run per game" },
    ],
  },
  {
    group: "Usage",
    rows: [
      { key: "targets_pg", label: "Targets / game", fmt: num1, hint: "Targets per game" },
      { key: "target_share", label: "Target share", fmt: pct0, hint: "Share of his team's targets" },
      { key: "tprr", label: "TPRR", fmt: num3, hint: "Targets per route run — how often he is looked at when he actually runs a route. Independent of how much he plays" },
      { key: "adot", label: "aDOT", fmt: num1, hint: "Average depth of target, in yards past the line" },
      { key: "screen_pct", label: "Screen rate", fmt: pct0, hint: "Share of his charted targets that were screens" },
    ],
  },
  {
    group: "Finishing",
    rows: [
      { key: "yprr", label: "YPRR", fmt: num2, hint: "Yards per route run — the standard all-in receiving efficiency number" },
      { key: "ypt", label: "Yards / target", fmt: num2, hint: "Receiving yards per target" },
      { key: "catch_rate", label: "Catch rate", fmt: pct0, hint: "Receptions per target" },
      { key: "catchable_pct", label: "Catchable %", fmt: pct0, hint: "Share of his targets FTN charted as catchable — how well he is being thrown to, not how well he catches" },
      { key: "contested_pct", label: "Contested %", fmt: pct0, hint: "Share of targets charted as contested" },
      { key: "created_pct", label: "Created %", fmt: pct0, hint: "Share of targets FTN charted as created by the receiver" },
      { key: "drop_pct", label: "Drop rate", fmt: pct1, hint: "Charted drops per target — lower is better, and the bar is flipped so a high bar is always good" },
    ],
  },
  {
    group: "Scoring role",
    rows: [
      { key: "rz_targets_pg", label: "Red-zone tgt/g", fmt: num2, hint: "Targets per game inside the 20" },
      { key: "gl_targets_pg", label: "Goal-line tgt/g", fmt: num2, hint: "Targets per game inside the 5" },
    ],
  },
  {
    group: "Tracking (Next Gen Stats)",
    rows: [
      { key: "ngs_separation", label: "Separation", fmt: num1, hint: "NGS: yards between him and the nearest defender at the catch or incompletion" },
      { key: "ngs_cushion", label: "Cushion", fmt: num1, hint: "NGS: yards between him and the defender across from him at the snap. Style, not quality — never ranked" },
      { key: "ngs_tay", label: "Targeted air yds", fmt: num1, hint: "NGS: average intended air yards on his targets" },
      { key: "ngs_tay_share", label: "Air-yard share", fmt: pct0, hint: "NGS: his share of the team's intended air yards" },
      { key: "ngs_yac_oe", label: "YAC over expected", fmt: signed1, hint: "NGS: yards after catch above what tracking expected, per reception" },
    ],
  },
];

const RUSHING = [
  {
    group: "Role",
    rows: [
      { key: "snap_pct_cum", label: "Snap share", fmt: pct0, hint: "Share of the offense's snaps he was on the field for" },
      { key: "passdown_snap_pct", label: "Pass-down snaps", fmt: pct0, hint: "Snap share on passing downs — the difference between a two-down back and a every-down one" },
      { key: "route_pct", label: "Route share", fmt: pct0, hint: "Share of team dropbacks he ran a route on" },
    ],
  },
  {
    group: "Usage",
    rows: [
      { key: "carries_pg", label: "Carries / game", fmt: num1, hint: "Carries per game" },
      { key: "targets_pg", label: "Targets / game", fmt: num1, hint: "Targets per game" },
      { key: "tprr", label: "TPRR", fmt: num3, hint: "Targets per route run" },
    ],
  },
  {
    group: "Finishing",
    rows: [
      { key: "ypc", label: "Yards / carry", fmt: num2, hint: "Rushing yards per carry" },
      { key: "yprr", label: "YPRR", fmt: num2, hint: "Yards per route run" },
    ],
  },
  {
    group: "Scoring role",
    rows: [
      { key: "rz_carries_pg", label: "Red-zone car/g", fmt: num2, hint: "Carries per game inside the 20" },
      { key: "gl_carries_pg", label: "Goal-line car/g", fmt: num2, hint: "Carries per game inside the 5 — the single best predictor of rushing touchdowns" },
      { key: "rz_targets_pg", label: "Red-zone tgt/g", fmt: num2, hint: "Targets per game inside the 20" },
    ],
  },
  {
    group: "Tracking (Next Gen Stats)",
    rows: [
      { key: "ngs_ryoe_att", label: "RYOE / carry", fmt: signed1, hint: "NGS: rushing yards over what tracking expected from the blocking and defenders, per carry" },
      { key: "ngs_stacked_box_pct", label: "8+ box rate", fmt: pct0, hint: "NGS: share of carries into 8 or more defenders in the box — lower is easier, and the bar is flipped so a high bar is always good" },
      { key: "ngs_time_to_los", label: "Time to LOS", fmt: (v) => (v == null ? null : `${v.toFixed(2)}s`), hint: "NGS: seconds behind the line before crossing it. Style, not quality — never ranked" },
    ],
  },
];

const PASSING = [
  {
    group: "Volume",
    rows: [
      { key: "pass_att_pg", label: "Attempts / game", fmt: num1, hint: "Pass attempts per game" },
    ],
  },
  {
    group: "Efficiency",
    rows: [
      { key: "ypa", label: "Yards / attempt", fmt: num2, hint: "Passing yards per attempt" },
      { key: "comp_pct", label: "Completion %", fmt: pct1, hint: "Completions per attempt" },
      { key: "cpoe", label: "CPOE", fmt: signed1, hint: "Completion percentage over expected — completion rate adjusted for the difficulty of the throws he actually made" },
      { key: "int_rate", label: "INT rate", fmt: pct1, hint: "Interceptions per attempt — lower is better, and the bar is flipped so a high bar is always good" },
    ],
  },
  {
    group: "Rushing",
    rows: [
      { key: "carries_pg", label: "Carries / game", fmt: num1, hint: "Rushing attempts per game" },
      { key: "ypc", label: "Yards / carry", fmt: num2, hint: "Rushing yards per carry" },
    ],
  },
  {
    group: "Tracking (Next Gen Stats)",
    rows: [
      { key: "ngs_cpoe", label: "xCOMP +/-", fmt: signed1, hint: "NGS: completion % above the tracking model's expected completion %" },
      { key: "ngs_ayts", label: "Air yds to sticks", fmt: signed1, hint: "NGS: how far past (or short of) the first-down marker he throws, on average" },
      { key: "ngs_time_to_throw", label: "Time to throw", fmt: (v) => (v == null ? null : `${v.toFixed(2)}s`), hint: "NGS: seconds from snap to throw. Style, not quality — never ranked" },
      { key: "ngs_aggressiveness", label: "Aggressiveness", fmt: (v) => (v == null ? null : `${v.toFixed(1)}%`), hint: "NGS: share of throws into a tight window (defender within a yard). Style, not quality — never ranked" },
    ],
  },
];

/** The tile groups for a position, or null when we have no profile shape for it. */
export function tilesFor(position) {
  if (position === "QB") return PASSING;
  if (position === "RB" || position === "FB") return RUSHING;
  if (position === "WR" || position === "TE") return RECEIVING;
  return null;
}

/** Groups with at least one populated row, so an empty section never renders. */
export function populatedTiles(position, data) {
  const groups = tilesFor(position);
  if (!groups || !data) return [];
  return groups
    .map((g) => ({ ...g, rows: g.rows.filter((r) => data[r.key] != null) }))
    .filter((g) => g.rows.length);
}
