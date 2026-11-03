// ── Live market lines ────────────────────────────────────────────────────────
// Reads nfl.live_odds and prices the model against the real board: the market's
// line replaces the model's invented one, and the model's probability at THAT
// line is compared with the book's de-vigged probability.
//
// No model math lives here — probOverSkewed / probOverNormal / SKEW_W_BY_PROP
// come from src/lib/models.js, so a recalibration moves the board and this file
// at the same time.
//
// EDGE IS IN PROBABILITY POINTS, and it is a display quantity, not a gate. Any
// pick gate built on top of this belongs in score space (projection vs line),
// because a calibration change silently retunes anything written as `p >= X`.
import { probOverNormal, probOverSkewed, poissonGTE, SKEW_W_BY_PROP, oddsToImplied, calcEV, calibrateToMarket } from "./models.js";
import { betslipUrl } from "./betslip.js";

// NO supabase.js IMPORT, on purpose: this module is read by src/lib/boardRows.js,
// which the pick ledger scripts run in Node, and supabase.js reads import.meta.env
// at module scope. loadLiveOdds lives in loadData.js for that reason, next to
// loadInjuries, which moved there for the same one.

/**
 * Odds API market key → the model's prop_type.
 *
 * ALTERNATE LADDERS ARE DELIBERATELY ABSENT. A record carries one line per book
 * (see indexOdds), so mapping `*_alternate` in here would have a book's 1.5 and
 * 2.5 rungs overwrite its main line. They are pulled and stored; surfacing them
 * needs a ladder-shaped record, not this one.
 *
 * `player_sacks` IS AN OVERLOADED KEY UPSTREAM. For a defender it means sacks
 * RECORDED; for a quarterback the same key means sacks TAKEN — PrizePicks posts
 * Bryce Young at 2.5 on it. pull_live_odds.mjs rewrites the quarterback rows to
 * `player_sacks_taken`, which is intentionally not mapped here: it is a real
 * market and a different question, and letting it in would put a quarterback on
 * the defensive board at a line that means the opposite of what it says.
 */
export const MARKET_TO_PROP = {
  player_reception_yds: "rec_yards",
  player_rush_yds: "rush_yards",
  player_pass_yds: "pass_yards",
  player_receptions: "receptions",
  player_anytime_td: "anytime_td",
  player_pass_tds: "pass_tds",
  player_sacks: "def_sacks",
};

/**
 * Props the model prices with a Poisson count rather than a Normal/lognormal.
 *
 * They carry `sigma: null`, which used to make priceAgainstMarket() bail — so
 * anytime TD and passing TDs were pulled, stored and indexed, and then showed a
 * dash in the Market and Edge columns forever. A count prop has a perfectly good
 * probability at the book's line; it just is not a Gaussian one.
 */
const POISSON_PROPS = new Set(["anytime_td", "pass_tds"]);

/**
 * Anytime TD is a Yes/No market: most books post no point at all, and the API
 * returns `point: null`. That is not a missing line, it is the line — "one or
 * more" is over 0.5.
 */
const IMPLIED_LINE = { anytime_td: 0.5 };

/**
 * The books the board SHOWS, in order.
 *
 * This used to be a preference list — indexOdds kept the most preferred book
 * that had priced a prop and threw the rest away, so the board carried one
 * MARKET column and one price. That is the wrong shape for the thing it is
 * for. On the 2026 week-1 slate Kimani Vidal's anytime TD was +250 at FanDuel
 * and +450 at DraftKings: the same bet, an 80% difference in what it pays, and
 * the board showed one of them with no indication the other existed. Every one
 * of these is now kept and shown in its own column.
 *
 * The order is still the order: it decides which book's LINE is the reference
 * the row's probability is computed at, and it is the display order of the
 * columns. FanDuel and Hard Rock are the two we actually bet; DraftKings is the
 * sanity check and, measured on that same slate, beats FanDuel's price on 56.7%
 * of props. The pull stores all 14 books it gets for free, so widening this list
 * costs nothing but width.
 */
export const BOOK_PREF = ["fanduel", "hardrockbet", "draftkings"];

/**
 * The books the SACK market is priced and shown at — deliberately the same three.
 *
 * IT IS A SPORTSBOOK MARKET, AND THE FIRST MEASUREMENT OF IT WAS A CLOCK
 * READING. Measured Thursday 2026-09-18, two days out from the slate, `us`
 * returned FanDuel on one game of 29 and nothing else, and the conclusion drawn
 * was that sacks live in `us_dfs` (PrizePicks + Underdog) and the sportsbooks
 * do not post them. Re-measured Sunday 2026-09-20, ~3h to kickoff, over the 15
 * remaining week-2 events, `us` alone:
 *   fanduel      15 of 15 events, 3-10 players each, main key only
 *   draftkings   15 of 15, 2-8 main + 4-13 alternate rungs
 *   betonlineag  15 of 15, 1-13 main + the same alternates
 * Sportsbooks post defensive props LATE, not never. The DFS apps are gone from
 * the board and from what the pull buys: they were never books we bet, they are
 * one price on both sides (nothing to de-vig), and every player they covered is
 * covered by FanDuel and DraftKings in the region the core props already come
 * from.
 *
 * WHY THIS IS AN ALIAS AND NOT A SHORTER LIST. Hard Rock posts no sack line at
 * all and BetOnline is not a book we bet, so the honest content of this list is
 * "FanDuel and DraftKings". It is still BOOK_PREF, because the board's price
 * columns should not move when you change the market: the same three headers in
 * the same order, and Hard Rock's cell reads as a dash on a sack row exactly
 * the way it reads as a dash on a receiver nobody priced. A column that appears
 * and disappears under the Props dropdown is harder to read than a blank one.
 *
 * It stays a SEPARATE EXPORT rather than collapsing into BOOK_PREF at the call
 * sites, because every consumer reaching it (columnsFor, SORT_VAL, sidePrice,
 * loadLiveOdds) was hard-coding BOOK_PREF once and broke when the two lists
 * genuinely differed. The seam is what makes them able to differ again; today
 * they simply do not.
 */
export const SACK_BOOKS = BOOK_PREF;

export const BOOK_LABEL = {
  fanduel: "FD", hardrockbet: "HR", hardrockbet_fl: "HR", draftkings: "DK",
  prizepicks: "PP", underdog: "UD",
  betmgm: "MGM", betrivers: "BR", espnbet: "ESPN", williamhill_us: "CZR",
  fanatics: "FAN", bovada: "BOV", betonlineag: "BOL", betparx: "PARX",
  ballybet: "BALLY", fliff: "FLIFF",
};

/**
 * Name normaliser, identical to scripts/validate_market.mjs — books write
 * "D.K. Metcalf", "Marvin Harrison Jr.", "Amon-Ra St. Brown"; the roster writes
 * its own variants. Strip accents, punctuation and generational suffixes.
 */
export const normName = (s) => (s || "").toLowerCase().normalize("NFD")
  .replace(/[̀-ͯ]/g, "")
  .replace(/[.'’-]/g, "")
  .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
  .replace(/\s+/g, " ").trim();

/**
 * First initial + surname, e.g. "k|gainwell".
 *
 * normName cannot close the gap that actually loses markets, which is the
 * NICKNAME: FanDuel prices "Kenny Gainwell" and "Joshua Palmer" while the roster
 * says "Kenneth Gainwell" and "Josh Palmer". Measured on the Week 1 board, 9 of
 * 414 real priced players missed for exactly this reason (the other 32 misses
 * were team Defenses, which the model does not project and should not match).
 *
 * A nickname table would be a second thing to maintain and would still miss the
 * next one. This is used only as a FALLBACK, only within a single game, and only
 * when it resolves to exactly one player — an ambiguous key is dropped rather
 * than guessed, because a market silently attached to the wrong player is far
 * worse than a blank cell.
 */
export const looseName = (s) => {
  const parts = normName(s).split(" ").filter(Boolean);
  if (parts.length < 2) return null;
  return `${parts[0][0]}|${parts[parts.length - 1]}`;
};

/**
 * Collapse raw outcome rows into one record per (game, player, prop) carrying
 * EVERY shown book's two-sided price.
 *
 * Returns a Map keyed `game_id|normName|prop_type` →
 *   { key, propType, player_name, books: { <bookKey>: { line, overOdds, underOdds, link, sid, at } } }
 *
 * `at` is the captured_at of the Over/Yes row the price came from, when the rows
 * carry one. The grader needs it: a close is only a CLOSE if it was pulled after
 * the pick's price was (pickLedger.js closeFor), and rows folded oldest-first
 * leave each book holding its latest capture.
 *
 * A book with no Over/Yes is dropped: there is nothing on this board to bet.
 * A record with no surviving book is not emitted at all.
 */
export function indexOdds(rows, books = BOOK_PREF) {
  const shown = new Set(books);
  const byKey = new Map();

  for (const r of rows) {
    const propType = MARKET_TO_PROP[r.prop_type];
    if (!propType) continue;
    if (!shown.has(r.book)) continue;
    const k = `${r.game_id}|${normName(r.player_name)}|${propType}`;
    let rec = byKey.get(k);
    if (!rec) {
      rec = { key: k, propType, player_name: r.player_name, books: {} };
      byKey.set(k, rec);
    }
    const b = (rec.books[r.book] ||= { line: r.line ?? null, link: null, sid: null });
    // Anytime TD is a Yes-only market on most books — no Under to de-vig against.
    if (r.name === "Over" || r.name === "Yes") {
      b.overOdds = r.odds;
      b.line = r.line ?? b.line;
      b.at = r.captured_at ?? b.at ?? null;
      // The deep link belongs to the OVER: it is the side this board offers.
      b.link = r.link ?? b.link;
      b.sid = r.sid ?? b.sid;
    } else if (r.name === "Under" || r.name === "No") {
      b.underOdds = r.odds;
    }
  }

  const out = new Map();
  for (const rec of byKey.values()) {
    for (const [bk, b] of Object.entries(rec.books)) if (b.overOdds == null) delete rec.books[bk];
    if (Object.keys(rec.books).length) out.set(rec.key, rec);
  }

  // Second pass: the nickname fallback. Only unambiguous loose keys survive —
  // if two priced players in one game share first-initial + surname, neither
  // gets a loose entry and both simply fall back to the exact match.
  const looseOwners = new Map();
  for (const rec of out.values()) {
    const ln = looseName(rec.player_name);
    if (!ln) continue;
    const lk = `${rec.key.split("|")[0]}|~${ln}|${rec.propType}`;
    const cur = looseOwners.get(lk);
    if (cur === undefined) looseOwners.set(lk, rec);
    else if (cur && normName(cur.player_name) !== normName(rec.player_name)) looseOwners.set(lk, null);
  }
  for (const [lk, rec] of looseOwners) if (rec) out.set(lk, rec);

  return out;
}

/**
 * The sack market, indexed as a LADDER rather than a single line per book.
 *
 * indexOdds keeps one line per book because that is the shape of a yardage prop:
 * one number, two sides. The sack market is not that shape. PrizePicks posts
 * Jalen Carter at 0.5 AND 2.5 in the same slate, Underdog posts 0.5 with a real
 * two-sided price on some players and a lottery-ticket Over on others, and
 * FanDuel posts 0.5 Over alone. Collapsing that to one line silently throws away
 * the rung the model most wants, which is the whole reason the rungs exist.
 *
 * So each book keeps every rung it posted, sorted by line:
 *   Map `game_id|normName` → { player_name, books: { <book>: [rung, ...] } }
 * where a rung is { line, overOdds, underOdds, link, sid }.
 *
 * Alternate and main keys are folded together on purpose: the rungs above and
 * below the main number arrive under `player_sacks_alternate`, and on the
 * 2026-09-20 measurement DraftKings and BetOnline each posted MORE players
 * under the alternate key than the main one (13 vs 5 on CLE@TB). Treating it as
 * a different market throws away most of the ladder, which is the one thing the
 * sack model wants — the rung IS the bet.
 */
export function indexSackOdds(rows, books = SACK_BOOKS) {
  const shown = new Set(books);
  const byKey = new Map();
  for (const r of rows) {
    // `*_taken` is the quarterback's sacks-SUFFERED market under the same
    // upstream key — a different question. See MARKET_TO_PROP.
    if (r.prop_type !== "player_sacks" && r.prop_type !== "player_sacks_alternate") continue;
    if (!shown.has(r.book)) continue;
    if (r.line == null) continue;
    const k = `${r.game_id}|${normName(r.player_name)}`;
    let rec = byKey.get(k);
    if (!rec) { rec = { key: k, player_name: r.player_name, books: {} }; byKey.set(k, rec); }
    const ladder = (rec.books[r.book] ||= []);
    let rung = ladder.find((x) => x.line === r.line);
    if (!rung) { rung = { line: r.line, overOdds: null, underOdds: null, link: null, sid: null, at: null }; ladder.push(rung); }
    if (r.name === "Over" || r.name === "Yes") {
      rung.overOdds = r.odds;
      rung.at = r.captured_at ?? rung.at;
      rung.link = r.link ?? rung.link;
      rung.sid = r.sid ?? rung.sid;
    } else if (r.name === "Under" || r.name === "No") {
      rung.underOdds = r.odds;
    }
  }
  const out = new Map();
  for (const rec of byKey.values()) {
    for (const [bk, ladder] of Object.entries(rec.books)) {
      const kept = ladder.filter((x) => x.overOdds != null).sort((a, b) => a.line - b.line);
      if (kept.length) rec.books[bk] = kept; else delete rec.books[bk];
    }
    if (Object.keys(rec.books).length) out.set(rec.key, rec);
  }
  return out;
}

/**
 * The rung on the ladder our number likes best, across every book.
 *
 * `probOver(line)` is the model's P(over) at a line — sackProbOver bound to a
 * projection. Ranked on EV rather than on edge in probability points, because
 * the rungs pay differently by design: +450 at 0.5 and −120 at 0.25 are the same
 * belief at two prices, and a 2pp edge at +450 is worth more than a 6pp edge at
 * −300.
 *
 * `pushAt(line)` is the chance the credit lands ON the line (sackPushProb). A
 * push hands the stake back rather than losing it, so it is worth exactly its
 * probability in EV; leaving it out scores every 0.5 and 1.0 rung as if a half
 * sack lost.
 *
 * Returns null when no book posted this player, which is most of them.
 */
export const sackEv = (prob, odds, push = 0) => {
  const ev = calcEV(prob, odds);
  return ev == null ? null : ev + (push || 0);
};

export function bestSackOffer(rec, probOver, pushAt = null) {
  if (!rec) return null;
  let best = null;
  for (const [book, ladder] of Object.entries(rec.books)) {
    for (const rung of ladder) {
      const prob = probOver(rung.line);
      if (prob == null) continue;
      const ev = sackEv(prob, rung.overOdds, pushAt?.(rung.line));
      if (ev == null) continue;
      if (!best || ev > best.ev) {
        best = { book, line: rung.line, odds: rung.overOdds, underOdds: rung.underOdds,
          prob, implied: oddsToImplied(rung.overOdds), ev, link: rung.link, sid: rung.sid,
          // A price with no other side cannot be de-vigged, so `implied` is the
          // book's number INCLUDING its margin and the edge below is a floor.
          devigged: rung.underOdds != null };
      }
    }
  }
  return best;
}

/**
 * The ladder priced into the SHAPE the board's Odds section reads.
 *
 * priceAgainstMarket() returns one cell per book plus a reference line, and
 * every odds-section component — the per-book price cells, EdgeCell, the pick
 * ledger's sidePrice() — is written against that shape. The sack market is a
 * ladder rather than one line per book, so this collapses each book's ladder to
 * the single rung our number likes best and then presents the result as a
 * priceAgainstMarket record, so the sack prop needs no special cases downstream.
 *
 * THE REFERENCE LINE is the best rung's, and a book on any other rung is marked
 * `offLine` exactly as it is on the main board: a 0.25 and a 1.0 are not the
 * same bet, so the second one cannot be "a better price" for the first.
 *
 * `bookOrder` travels with the record because these are NOT the board's
 * sportsbooks (see SACK_BOOKS) — the ledger reads it rather than assuming
 * BOOK_PREF, which would silently find no price on a market only PrizePicks
 * and Underdog post.
 *
 * Returns null when no book posted this player, which is most of them.
 */
export function sackPriced(rec, probOver, books = SACK_BOOKS, pushAt = null) {
  const best = bestSackOffer(rec, probOver, pushAt);
  if (!best) return null;

  const out = {};
  const offers = [];
  for (const bk of books) {
    const ladder = rec.books[bk];
    if (!ladder) continue;
    // Each book's own best rung, by the same EV rule bestSackOffer uses — and
    // every rung it posted, kept for the row's expansion, which lays them out so
    // that "the best rung" is a claim the reader can check.
    let pick = null;
    for (const rung of ladder) {
      const prob = probOver(rung.line);
      if (prob == null) continue;
      const ev = sackEv(prob, rung.overOdds, pushAt?.(rung.line));
      if (ev == null) continue;
      const { prob: mktProb, devigged } = devig(rung.overOdds, rung.underOdds);
      offers.push({ book: bk, line: rung.line, odds: rung.overOdds,
        underOdds: rung.underOdds ?? null, prob, mktProb, devigged,
        implied: oddsToImplied(rung.overOdds), ev });
      if (!pick || ev > pick.ev) pick = { rung, prob, mktProb, devigged, ev };
    }
    if (!pick) continue;
    const { rung, prob, mktProb, devigged, ev } = pick;
    out[bk] = {
      line: rung.line, offLine: rung.line !== best.line,
      overOdds: rung.overOdds, underOdds: rung.underOdds ?? null,
      modelProb: prob, mktProb, devigged,
      edge: prob - mktProb, ev,
      url: betslipUrl(bk, rung),
      rungs: ladder.length,
    };
  }
  if (!out[best.book]) return null;                 // unreachable, defended anyway

  offers.sort((a, b) => b.ev - a.ev);
  return { ...out[best.book], line: best.line, book: best.book, best: best.book,
    books: out, bookOrder: books, offer: best, offers };
}

/** How many distinct rungs a record carries, for the board's tooltip. */
export const sackRungCount = (rec) =>
  rec ? Object.values(rec.books).reduce((n, l) => n + l.length, 0) : 0;

export const oddsKey = (gameId, playerName, propType) =>
  `${gameId}|${normName(playerName)}|${propType}`;

export const looseOddsKey = (gameId, playerName, propType) => {
  const ln = looseName(playerName);
  return ln ? `${gameId}|~${ln}|${propType}` : null;
};

/** Exact name first; fall back to first-initial + surname within the same game. */
export function lookupOdds(index, gameId, playerName, propType) {
  if (!index) return null;
  const exact = index.get(oddsKey(gameId, playerName, propType));
  if (exact) return exact;
  const lk = looseOddsKey(gameId, playerName, propType);
  return (lk && index.get(lk)) || null;
}

/**
 * The book's fair P(over) with the vig removed. Two-sided markets normalise the
 * pair; a one-sided market (anytime TD) has no counterpart, so its raw implied
 * probability is returned and `devigged` is false — it still carries the book's
 * hold and must not be read as a fair price.
 */
export function devig(overOdds, underOdds) {
  const o = oddsToImplied(overOdds);
  if (underOdds == null) return { prob: o, devigged: false };
  const u = oddsToImplied(underOdds);
  const total = o + u;
  return { prob: total > 0 ? o / total : o, devigged: true };
}

/**
 * Re-price one model prop against every book that posted it.
 *
 * The model invents a line from its own projection; the market's is the one that
 * can actually be bet, so the probability has to be recomputed there rather than
 * compared across two different lines — that comparison is what makes a model
 * look sharp when it is only looking at an easier number.
 *
 * ── THE REFERENCE LINE, AND WHY THERE HAS TO BE ONE ─────────────────────────
 * Books do not always post the same number. "Best price" across two different
 * lines is not a price comparison at all, so the row picks ONE line — the first
 * BOOK_PREF book that posted the prop — computes the model's probability there,
 * and that is the row's Line and Win%. Every book is still shown with its own
 * line and its own price and its own edge; a book on a different number is
 * marked as such and is NOT eligible to be the row's best price, because it is
 * not the same bet.
 *
 * @returns null, or
 *   { line, modelProb, book, overOdds, underOdds, mktProb, devigged, edge, ev,
 *     books: { <bookKey>: { line, offLine, overOdds, underOdds, modelProb,
 *                           mktProb, devigged, edge, ev, url } },
 *     best: <bookKey> }
 *   The flattened fields describe `best`, so a caller that wants one number gets
 *   the one it should want: the best price on the row's own line.
 */
export function priceAgainstMarket(prop, mkt, books = BOOK_PREF) {
  if (!mkt || !prop) return null;
  const posted = books.filter((b) => mkt.books?.[b]);
  if (!posted.length) return null;

  const implied = IMPLIED_LINE[prop.prop_type] ?? null;
  const refLine = mkt.books[posted[0]].line ?? implied;
  if (refLine == null) return null;

  const out = {};
  for (const bk of posted) {
    const b = mkt.books[bk];
    const line = b.line ?? implied;
    if (line == null) continue;
    const rawProb = modelProbAt(prop, line);
    if (rawProb == null) continue;
    const { prob: mktProb, devigged } = devig(b.overOdds, b.underOdds);
    // The board's number is the model calibrated against THIS book's price —
    // models.js calibrateToMarket says why. `rawProb` is kept for the row's
    // breakdown, never for Win% or EV.
    const modelProb = calibrateToMarket(prop.prop_type, rawProb, mktProb, devigged);
    out[bk] = {
      line, offLine: line !== refLine,
      overOdds: b.overOdds, underOdds: b.underOdds ?? null,
      modelProb, rawProb, mktProb, devigged,
      edge: modelProb - mktProb,             // probability points, display only
      ev: calcEV(modelProb, b.overOdds),
      url: betslipUrl(bk, b),
    };
  }
  if (!Object.keys(out).length) return null;

  // Best = the biggest payout among the books on the row's own line. Payout, not
  // implied probability: they are the same ordering, and the decimal is the
  // number a reader is actually choosing between.
  //
  // The reference book is always in this pool by construction — refLine is its
  // line — so there is no empty-pool case to defend against.
  const best = Object.entries(out).filter(([, v]) => !v.offLine)
    .reduce((a, b) => (payout(b[1].overOdds) > payout(a[1].overOdds) ? b : a))[0];

  return { ...out[best], line: refLine, book: best, books: out, best };
}

/** Decimal payout per unit staked, for ranking two American prices. */
export const payout = (american) =>
  (american == null ? -Infinity : american > 0 ? american / 100 : 100 / Math.abs(american));

/** The model's P(over) at a given line, or null when the prop has no spread. */
function modelProbAt(prop, line) {
  if (POISSON_PROPS.has(prop.prop_type)) {
    // proj_mean IS λ for these. "Over 1.5 TDs" and "at least 2 TDs" are the same
    // event, so the count that clears the line is ceil(line) — the identity
    // propPoisson() already uses when it invents its own line.
    return poissonGTE(prop.proj_mean, Math.ceil(line));
  }
  if (prop.sigma == null) return null;       // a continuous prop with no spread
  const skew = SKEW_W_BY_PROP[prop.prop_type] ?? 0;
  return skew > 0
    ? probOverSkewed(prop.proj_mean, prop.sigma, line, skew)
    : probOverNormal(prop.proj_mean, prop.sigma, line);
}
