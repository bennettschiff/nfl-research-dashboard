// ── Bet-slip deep links ──────────────────────────────────────────────────────
// A price on the board is a thing you are about to bet, so it should be one tap
// from the slip that has it on already. The Odds API returns the link with the
// odds (includeLinks/includeSids are free response flags — see
// scripts/pull_live_odds.mjs), and the three books we shop do not agree on how
// to hand it over.
//
// Ported from the MLB lab's src/components/OddsLink.jsx, which learned each of
// these the hard way; the shapes are identical because it is the same API and
// the same three books.
//
// Pure — no DOM, no React. The UI layer is src/components/OddsCell.jsx.

/**
 * Brand colours, so a badge and its price never disagree about "FanDuel blue".
 *
 * The board shows the same three books on every market (BOOK_PREF, which
 * SACK_BOOKS now aliases), so these tables are those three.
 *
 * PrizePicks and Underdog stay in them even though nothing buys those books any
 * more: weeks 1-2 of 2026 have frozen sack picks priced at them in the ledger,
 * and a graded row must still be able to name and colour the book it was taken
 * at. Nothing new will ever be written at either.
 */
export const BOOK_COLORS = {
  fanduel: "#2062c8", draftkings: "#0f8a44", hardrockbet: "#c2570f", hardrockbet_fl: "#c2570f",
  prizepicks: "#6d3ff0", underdog: "#e0b012",
};
export const BOOK_ABBR = {
  fanduel: "FD", draftkings: "DK", hardrockbet: "HR", hardrockbet_fl: "HR",
  prizepicks: "PP", underdog: "UD",
};
export const BOOK_NAMES = {
  fanduel: "FanDuel", draftkings: "DraftKings", hardrockbet: "Hard Rock", hardrockbet_fl: "Hard Rock",
  prizepicks: "PrizePicks", underdog: "Underdog",
};

/**
 * Hard Rock, deliberately rebuilt from `sid` rather than used as given.
 *
 * The API DOES return a link for Hard Rock — measured on the week-1 pull, e.g.
 * `https://app.hardrock.bet/?deep_link_value=betslip/3889489306653426097`. That
 * form points straight at the app host and does not do the universal-link
 * handoff, so from a browser it lands on a page rather than on the slip. The
 * share host below does the handoff, and it is the same `sid` either way — this
 * is a rewrite of the link, not a substitute for a missing one.
 *
 * Ported from the MLB lab, where this scheme is the one that was found to work.
 * If Hard Rock's own link ever starts opening the slip, the fix is to delete
 * this function and fall through to `rec.link` like the other two books.
 */
const HARD_ROCK = (sid) => `https://share.hardrock.bet/Pt0T/bet?deep_link_value=hardrock://betslip/${sid}`;

/**
 * The URL that opens this outcome on the book's slip, or null.
 *
 * Returns NULL rather than a homepage when there is nothing to link to. A cell
 * that silently drops you on a book's front page is worse than one that is not
 * clickable: you tap it expecting the bet, and you get a casino.
 *
 * @param book  Odds API bookmaker key
 * @param rec   { link, sid } as stored on the odds row
 */
export function betslipUrl(book, rec) {
  if (!rec) return null;
  if (book === "hardrockbet" || book === "hardrockbet_fl") {
    // Its own link is the app host and does not open the slip — see HARD_ROCK.
    // Falling back to it would be worse than not linking at all.
    return rec.sid ? HARD_ROCK(rec.sid) : null;
  }
  return rec.link || null;
}

/** Whether a book's price on this board can be tapped through to a slip. */
export const hasBetslip = (book, rec) => betslipUrl(book, rec) != null;
