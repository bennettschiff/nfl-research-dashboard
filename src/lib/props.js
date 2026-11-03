// ── Which props a position offers, and in what order ─────────────────────────
// The board used to show ONE row per player: `headlineProp()` picked pass yards
// for a QB, rush yards for a back, receiving yards for everyone else, and every
// other prop the model produced was reachable only by expanding the row. So the
// anytime-TD market — the one with the most positions in it — had no board at
// all, and there was no way to ask "show me every ATD on the slate".
//
// The row unit is now (player, prop). This module is the pure part of that: it
// says which props belong to a position, which are on by default, and the order
// props sort in. No React, no model math.
//
// OPENING vs AVAILABLE is a deliberate split. The board opens on one market
// (anytime TD — see OPENING_PROPS); the rest are real props the model prices and
// are one click away in the Props dropdown, rather than being hidden behind a
// row expansion or all stacked on at once.
//
// ── ONE MARKET AT A TIME (2026-09-18) ───────────────────────────────────────
// The Props dropdown was a multi-select, and it read as a bug: clicking REC YDS
// while ANY TD was on gave you both, so picking a second market doubled the
// board instead of switching to it. It is now a single choice — the board shows
// one market, and the reason is the same one that made ANY TD the only opening
// market: a table with two markets in it is not comparable top to bottom.
// `defaultPropFor` is the singular the board holds; defaultPropsFor stays as the
// set form the tests and the menu read.
//
// ── SACKS ARE A PROP, NOT A TAB (2026-09-18) ────────────────────────────────
// `def_sacks` lived on its own tab, which put the one defensive market the model
// prices somewhere you had to go looking for it and gave it its own filter bar,
// its own week picker and its own table. It is a market like the others: it
// belongs in this menu, and the defensive position groups (DL / LB / DB) belong
// beside QB/RB/WR/TE in the Position filter. It is ONE-SIDED — see
// ONE_SIDED_PROPS: half a sack is the question, and nobody bets the under.

/**
 * Canonical prop order. Used by the Prop column's sort so that ordering means
 * something — an alphabetical sort of the SHORT labels puts "ANY TD" first and
 * interleaves "PASS TD" between "PASS YDS" and "REC", which reads as random.
 * Yardage first (the headline markets), then counting stats, then touchdowns.
 */
export const PROP_ORDER = [
  "pass_yards", "rush_yards", "rec_yards",
  "receptions", "rush_att", "completions",
  "pass_tds", "anytime_td", "def_sacks",
];

export const propRank = (t) => {
  const i = PROP_ORDER.indexOf(t);
  return i === -1 ? PROP_ORDER.length : i;
};

/**
 * position → every market the model prices for it, in any order (the menu is
 * sorted by `propRank`).
 */
export const POS_PROPS = {
  QB: ["pass_yards", "pass_tds", "anytime_td", "completions", "rush_yards"],
  RB: ["rush_yards", "anytime_td", "rec_yards", "receptions", "rush_att"],
  FB: ["rush_yards", "anytime_td", "rec_yards", "receptions", "rush_att"],
  WR: ["receptions", "rec_yards", "anytime_td"],
  TE: ["receptions", "rec_yards", "anytime_td"],
  // The defensive groups, which offer exactly one market. They are position
  // GROUPS as nflverse charts them (the roster file writes DL / LB / DB, not
  // DE / OLB / CB), which is also the unit the sack model's rates are kept on.
  DL: ["def_sacks"],
  LB: ["def_sacks"],
  DB: ["def_sacks"],
};

/** The positions whose only market is a defensive one. */
export const DEF_POSITIONS = ["DL", "LB", "DB"];
export const isDefPosition = (p) => DEF_POSITIONS.includes(p);

/** Markets the DEFENSIVE board prices. A row for one comes from sackRows.js. */
export const DEF_PROPS = new Set(["def_sacks"]);
export const isDefProp = (t) => DEF_PROPS.has(t);

/**
 * What the board OPENS on, out of everything a position offers.
 *
 * It used to open on every headline market for the position — three for a QB,
 * three for a receiver, and the union of all of them (six) on the All tab. That
 * is six rows per player before you have asked a question, and the top of the
 * board became a scroll through the same names carrying different props.
 *
 * Anytime TD alone is the opening board because it is the one market every
 * position shares, so the board is directly comparable top to bottom, and
 * because it is one-sided (see ONE_SIDED_PROPS): Win% is P(he scores), so the
 * default sort ranks the slate by the thing you actually came to see. Every
 * other market is one click away in the Props dropdown.
 */
export const OPENING_PROPS = ["anytime_td"];

const POSITIONS = ["QB", "RB", "WR", "TE", ...DEF_POSITIONS];

/**
 * The prop menu for a position filter, in canonical order.
 *
 * `posFilter` of "ALL" unions every position's menu, so the combined board can
 * reach every market any position offers.
 *
 * @returns Array<{ type: string, on: boolean }>
 */
export function propMenuFor(posFilter) {
  const src = posFilter === "ALL" ? POSITIONS : [posFilter];
  const all = new Set();
  for (const p of src) for (const t of POS_PROPS[p] || []) all.add(t);
  return [...all].sort((a, b) => propRank(a) - propRank(b))
    .map((type) => ({ type, on: OPENING_PROPS.includes(type) }));
}

/** Just the opening types for a position filter. */
export const defaultPropsFor = (posFilter) =>
  propMenuFor(posFilter).filter((p) => p.on).map((p) => p.type);

/**
 * THE market a position filter opens on — the board holds one, not a set.
 *
 * Anytime TD everywhere it is offered, because it is the market every offensive
 * position shares. A defensive group has no anytime TD, so it opens on the only
 * market it has; falls back to the first market on the menu so a position added
 * to POS_PROPS later cannot open on nothing.
 */
export function defaultPropFor(posFilter) {
  const menu = propMenuFor(posFilter);
  const opening = menu.find((p) => p.on);
  return (opening || menu[0])?.type ?? null;
}

/**
 * Markets with only one side on the board.
 *
 * Anytime TD is a Yes/No market: books post the Yes and, on most of them, no No
 * at all. So "P(he does not score) = 91%" is not a 91% play, it is arithmetic —
 * there is nothing to bet on the other side of it.
 *
 * This is not cosmetic. The board's Win% column is max(P(over), P(under)), which
 * is exactly right for a two-sided line and catastrophic here: because most
 * players do not score in most games, EVERY anytime-TD row scores 85-95% on the
 * under, and sorting by conviction filled 204 of the top 250 rows with them. The
 * one genuinely useful thing on that board — who is most likely to score — was
 * ranked dead last, upside down.
 *
 * For these props the model's side is the over by definition, and Win% is P(over)
 * as posted. A 9% anytime TD is then correctly a LOW-conviction longshot rather
 * than a 91% lock, which is what it always was.
 */
// Sacks join it for the same reason and one of its own: the rungs a book posts
// (0.25 / 0.5 / 0.75 / 1.0) are prices on "does he get half a sack" and "does he
// get a full one", the under is a bet on a man doing nothing, and on the DFS
// pick'em apps that price most of this market there is one number for both
// sides. So Win% on a sack row is P(he clears the rung), which is the only
// question, and a 12% row is correctly a longshot rather than an 88% lock.
export const ONE_SIDED_PROPS = new Set(["anytime_td", "def_sacks"]);
export const isOneSided = (t) => ONE_SIDED_PROPS.has(t);

/**
 * Position sort order. Alphabetical would read QB, RB, TE, WR — which splits the
 * two receiving positions around the backs. This is depth-chart order, offense
 * first and then the defensive groups front-to-back.
 */
export const POS_ORDER = ["QB", "RB", "FB", "WR", "TE", ...DEF_POSITIONS];
export const posRank = (p) => {
  const i = POS_ORDER.indexOf(p);
  return i === -1 ? POS_ORDER.length : i;
};
