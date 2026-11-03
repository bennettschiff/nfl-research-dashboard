// ── Market layer tests ───────────────────────────────────────────────────────
// The odds pull runs unattended and the board reads whatever it wrote, so the
// three things that can silently corrupt the market column are pinned here:
// name matching, book preference, and de-vig. Golden values are hand-computed
// from the American-odds definition, not captured from this code.
import { describe, it, expect } from "vitest";
import { MARKET_CAL } from "./models.js";
import {
  normName, looseName, indexOdds, devig, priceAgainstMarket, oddsKey, lookupOdds,
  MARKET_TO_PROP, BOOK_PREF, SACK_BOOKS, indexSackOdds, bestSackOffer, sackRungCount,
} from "./odds.js";

const near = (a, b, eps = 1e-4) => expect(Math.abs(a - b)).toBeLessThan(eps);

const row = (over = {}) => ({
  game_id: "2026_01_NE_SEA", week: 1, book: "fanduel",
  prop_type: "player_reception_yds", player_name: "Amon-Ra St. Brown",
  name: "Over", line: 60.5, odds: -110, ...over,
});

describe("normName", () => {
  it("collapses the variants books and rosters disagree on", () => {
    // Same player, four spellings seen across FanDuel / DraftKings / nflverse.
    const forms = ["Amon-Ra St. Brown", "Amon-Ra St Brown", "amon-ra st. brown", "Amon‑Ra St. Brown".replace("‑", "-")];
    const normed = new Set(forms.map(normName));
    expect(normed.size).toBe(1);
  });

  it("drops generational suffixes, which books include and rosters often do not", () => {
    expect(normName("Marvin Harrison Jr.")).toBe(normName("Marvin Harrison"));
    expect(normName("Odell Beckham Jr")).toBe(normName("Odell Beckham"));
  });

  it("strips accents so a diacritic never splits one player into two", () => {
    expect(normName("Chidobe Awuzié")).toBe(normName("Chidobe Awuzie"));
  });

  it("deletes hyphens rather than spacing them, on both sides of the join", () => {
    // "amonra st brown", not "amon ra st brown" — the point is only that the
    // roster and the book normalise identically, so the rule is pinned here.
    expect(normName("Amon-Ra St. Brown")).toBe("amonra st brown");
  });

  it("does NOT merge genuinely different players", () => {
    expect(normName("Michael Thomas")).not.toBe(normName("Michael Pittman"));
  });
});

describe("devig", () => {
  it("removes the hold from a symmetric two-sided market", () => {
    // -110/-110 → implied 0.5238 each, total 1.0476, fair 0.5 exactly.
    const { prob, devigged } = devig(-110, -110);
    near(prob, 0.5);
    expect(devigged).toBe(true);
  });

  it("splits an asymmetric market in proportion to the two implied prices", () => {
    // -150 → 0.6, +130 → 0.434783; total 1.034783; fair over = 0.6/1.034783.
    const { prob } = devig(-150, 130);
    near(prob, 0.6 / (0.6 + 100 / 230));
  });

  it("flags a one-sided market instead of pretending the price is fair", () => {
    // Anytime TD is Yes-only on most books: there is no counterpart to
    // normalise against, so the number still carries the vig and must say so.
    const { prob, devigged } = devig(150, null);
    near(prob, 0.4);
    expect(devigged).toBe(false);
  });
});

const REC_KEY = oddsKey("2026_01_NE_SEA", "Amon-Ra St. Brown", "rec_yards");

describe("indexOdds", () => {
  it("pairs Over and Under into one record", () => {
    const idx = indexOdds([row(), row({ name: "Under", odds: -110 })]);
    const fd = idx.get(REC_KEY).books.fanduel;
    expect(fd.overOdds).toBe(-110);
    expect(fd.underOdds).toBe(-110);
    expect(fd.line).toBe(60.5);
  });

  it("keeps EVERY shown book, not just the most preferred one", () => {
    // The board used to carry one price. Vidal's anytime TD was +250 at FanDuel
    // and +450 at DraftKings in week 1 and only one of them was on screen.
    const rows = [
      row({ book: "draftkings", line: 60.5, odds: 120 }),
      row({ book: "hardrockbet", line: 60.5, odds: -105 }),
      row({ book: "fanduel", line: 60.5, odds: -110 }),
    ];
    const pick = (rs) => indexOdds(rs).get(REC_KEY);
    for (const order of [rows, [...rows].reverse()]) {
      expect(Object.keys(pick(order).books).sort()).toEqual(["draftkings", "fanduel", "hardrockbet"]);
      expect(pick(order).books.draftkings.overOdds).toBe(120);
    }
  });

  it("keeps each book's OWN line — they do not always agree", () => {
    const idx = indexOdds([
      row({ book: "fanduel", line: 60.5 }),
      row({ book: "draftkings", line: 62.5 }),
    ]);
    const rec = idx.get(REC_KEY);
    expect(rec.books.fanduel.line).toBe(60.5);
    expect(rec.books.draftkings.line).toBe(62.5);
  });

  it("carries the bet-slip link and sid from the OVER row", () => {
    const idx = indexOdds([
      row({ link: "https://sportsbook.fanduel.com/slip/abc", sid: "fd-1" }),
      row({ name: "Under", odds: -110, link: "https://sportsbook.fanduel.com/slip/under" }),
    ]);
    // The board offers the over; the under's link must not overwrite it.
    expect(idx.get(REC_KEY).books.fanduel.link).toBe("https://sportsbook.fanduel.com/slip/abc");
    expect(idx.get(REC_KEY).books.fanduel.sid).toBe("fd-1");
  });

  it("carries when the OVER's price was captured — the grader's test of a real close", () => {
    const idx = indexOdds([
      row({ captured_at: "2026-10-04T15:40:40Z" }),
      row({ name: "Under", odds: -110, captured_at: "2026-10-04T15:40:41Z" }),
    ]);
    expect(idx.get(REC_KEY).books.fanduel.at).toBe("2026-10-04T15:40:40Z");
    expect(indexOdds([row({})]).get(REC_KEY).books.fanduel.at).toBeNull();
  });

  it("ignores books outside the shown list", () => {
    const idx = indexOdds([row({ book: "fliff" })]);
    expect(idx.size).toBe(0);
  });

  it("drops a book with no Over side — there is nothing to bet", () => {
    expect(indexOdds([row({ name: "Under" })]).size).toBe(0);
    // …and only that book. The rest of the record survives.
    const idx = indexOdds([row({ name: "Under" }), row({ book: "draftkings" })]);
    expect(Object.keys(idx.get(REC_KEY).books)).toEqual(["draftkings"]);
  });

  it("keys anytime TD off Yes, which is the market's over", () => {
    const idx = indexOdds([row({ prop_type: "player_anytime_td", name: "Yes", line: null, odds: 150 })]);
    const rec = idx.get(oddsKey("2026_01_NE_SEA", "Amon-Ra St. Brown", "anytime_td"));
    expect(rec.books.fanduel.overOdds).toBe(150);
  });

  it("ignores markets the model does not project", () => {
    // player_receptions used to be the example here and is now a real market —
    // the alternate ladders are the ones the pull can fetch (--alt) and the board
    // has no column for.
    expect(indexOdds([row({ prop_type: "player_reception_yds_alternate" })]).size).toBe(0);
    expect(indexOdds([row({ prop_type: "player_field_goals" })]).size).toBe(0);
  });

  it("does index the receptions market, which the board now shows", () => {
    const idx = indexOdds([row({ prop_type: "player_receptions", line: 4.5 })]);
    expect(idx.get(oddsKey("2026_01_NE_SEA", "Amon-Ra St. Brown", "receptions")).books.fanduel.line).toBe(4.5);
  });
});

describe("nickname fallback", () => {
  // The real Week 1 misses: FanDuel says Kenny/Joshua, the roster says
  // Kenneth/Josh, and no amount of punctuation stripping closes that.
  it("matches a nickname to the roster's given name", () => {
    const idx = indexOdds([row({ player_name: "Kenny Gainwell", prop_type: "player_rush_yds" })]);
    const hit = lookupOdds(idx, "2026_01_NE_SEA", "Kenneth Gainwell", "rush_yards");
    expect(hit?.player_name).toBe("Kenny Gainwell");
  });

  it("matches the short form too", () => {
    const idx = indexOdds([row({ player_name: "Joshua Palmer" })]);
    expect(lookupOdds(idx, "2026_01_NE_SEA", "Josh Palmer", "rec_yards")?.player_name).toBe("Joshua Palmer");
  });

  it("prefers the EXACT match when both exist", () => {
    const idx = indexOdds([
      row({ player_name: "Mike Williams", line: 50.5 }),
      row({ player_name: "Michael Williams", line: 20.5 }),
    ]);
    // Both share m|williams, so the loose key is ambiguous and dropped; the
    // exact name still resolves, and must resolve to its OWN line.
    expect(lookupOdds(idx, "2026_01_NE_SEA", "Mike Williams", "rec_yards").books.fanduel.line).toBe(50.5);
    expect(lookupOdds(idx, "2026_01_NE_SEA", "Michael Williams", "rec_yards").books.fanduel.line).toBe(20.5);
  });

  it("refuses an ambiguous loose key rather than guessing a player", () => {
    // Two different players, same first initial + surname, same game. Attaching
    // a market to the wrong player is worse than showing no market at all.
    const idx = indexOdds([
      row({ player_name: "Cam Brown" }),
      row({ player_name: "Chris Brown" }),
    ]);
    expect(lookupOdds(idx, "2026_01_NE_SEA", "Cameron Brown", "rec_yards")).toBe(null);
  });

  it("does not leak a loose match across games", () => {
    const idx = indexOdds([row({ player_name: "Kenny Gainwell", game_id: "2026_01_TB_CIN" })]);
    expect(lookupOdds(idx, "2026_01_NE_SEA", "Kenneth Gainwell", "rec_yards")).toBe(null);
  });

  it("gives a single-token name no loose key at all", () => {
    expect(looseName("Ogbongbemiga")).toBe(null);
  });
});

// A market record in the shape indexOdds emits: one entry per book.
const mkt = (books) => ({ key: "k", propType: "x", player_name: "P", books });
const one = (book, b) => mkt({ [book]: b });

describe("priceAgainstMarket", () => {
  const prop = { prop_type: "pass_yards", proj_mean: 250, sigma: 50, line: 240.5 };

  it("re-prices the model at the MARKET line, not its own", () => {
    // pass_yards has skew weight 0, so this is the plain normal: at line ==
    // mean the model must be exactly 50%, whatever line it invented for itself.
    const out = priceAgainstMarket(prop, one("fanduel", { line: 250, overOdds: -110, underOdds: -110 }));
    near(out.modelProb, 0.5, 1e-3);
    near(out.mktProb, 0.5);
    near(out.edge, 0, 1e-3);
    expect(out.line).toBe(250);
  });

  it("reports a positive edge when the book's line is below the projection", () => {
    // Rush yards, so the calibration lets the model move the price (pass yards'
    // fitted k is 0: there the price IS the forecast, and the edge is only the lean).
    const rush = { ...prop, prop_type: "rush_yards", proj_mean: 80, sigma: 30 };
    const out = priceAgainstMarket(rush, one("fanduel", { line: 60.5, overOdds: -110, underOdds: -110 }));
    expect(out.modelProb).toBeGreaterThan(0.5);
    expect(out.edge).toBeGreaterThan(0);
    // ...but only a fraction of the way from the price to the projection's own read.
    expect(out.rawProb).toBeGreaterThan(out.modelProb);
  });


  it("returns null when there is no line to price against", () => {
    expect(priceAgainstMarket(prop, null)).toBe(null);
    expect(priceAgainstMarket(prop, mkt({}))).toBe(null);
    expect(priceAgainstMarket(prop, one("fanduel", { line: null, overOdds: -110 }))).toBe(null);
    // A prop with no sigma (a counting stat priced elsewhere) is not priceable here.
    expect(priceAgainstMarket({ ...prop, sigma: null }, one("fanduel", { line: 250, overOdds: -110 }))).toBe(null);
  });

  it("carries the one-sided flag through so the UI can mark it", () => {
    const out = priceAgainstMarket(prop, one("fanduel", { line: 250, overOdds: 150 }));
    expect(out.devigged).toBe(false);
  });
});

describe("priceAgainstMarket across books", () => {
  const prop = { prop_type: "pass_yards", proj_mean: 250, sigma: 50, line: 240.5 };

  it("prices every book that posted it", () => {
    // Rush yards: pass yards' calibration hands the price straight back (k = 0),
    // which would make every book's edge zero and say nothing about shopping.
    const out = priceAgainstMarket({ ...prop, prop_type: "rush_yards" }, mkt({
      fanduel: { line: 250, overOdds: -110, underOdds: -110 },
      draftkings: { line: 250, overOdds: 100, underOdds: -120 },
      hardrockbet: { line: 250, overOdds: -115, underOdds: -105 },
    }));
    expect(Object.keys(out.books).sort()).toEqual(["draftkings", "fanduel", "hardrockbet"]);
    // Same line, so the projection's own probability is one number across all
    // three; the calibrated one leans on each book's price, and the EDGE differs
    // because the prices do.
    const probs = new Set(Object.values(out.books).map((b) => b.rawProb));
    expect(probs.size).toBe(1);
    expect(out.books.draftkings.edge).toBeGreaterThan(out.books.fanduel.edge);
  });

  it("calls the biggest payout the best price, not the first book listed", () => {
    const out = priceAgainstMarket(prop, mkt({
      fanduel: { line: 250, overOdds: -110 },
      draftkings: { line: 250, overOdds: 130 },
    }));
    expect(out.best).toBe("draftkings");
    // The flattened fields describe `best` — a caller that wants one number
    // gets the one it should want.
    expect(out.overOdds).toBe(130);
    expect(out.book).toBe("draftkings");
  });

  it("uses the first shown book's line as the row's reference", () => {
    const out = priceAgainstMarket(prop, mkt({
      fanduel: { line: 245.5, overOdds: -110 },
      draftkings: { line: 250.5, overOdds: -110 },
    }));
    expect(out.line).toBe(245.5);
    expect(out.books.fanduel.offLine).toBe(false);
    expect(out.books.draftkings.offLine).toBe(true);
    // A book on its own number is priced at ITS number, not the reference — the
    // edge shown next to a price has to be the edge on that bet.
    expect(out.books.draftkings.modelProb).toBeLessThan(out.books.fanduel.modelProb);
  });

  it("will not call a price on a different line the best one", () => {
    // DraftKings pays more, but for an easier line it is not the same bet.
    const out = priceAgainstMarket(prop, mkt({
      fanduel: { line: 245.5, overOdds: -110 },
      draftkings: { line: 265.5, overOdds: 200 },
    }));
    expect(out.best).toBe("fanduel");
  });

  it("takes its reference from whichever shown book IS there", () => {
    // FanDuel is first in BOOK_PREF but does not price everything. The row is
    // still anchored on a real book rather than falling through to no line.
    const out = priceAgainstMarket(prop, mkt({ draftkings: { line: 252.5, overOdds: 105 } }));
    expect(out.best).toBe("draftkings");
    expect(out.line).toBe(252.5);
    expect(out.books.draftkings.offLine).toBe(false);
  });

  it("attaches a bet-slip URL per book, and null where the book gave nothing", () => {
    const out = priceAgainstMarket(prop, mkt({
      fanduel: { line: 250, overOdds: -110, link: "https://sportsbook.fanduel.com/slip/abc" },
      hardrockbet: { line: 250, overOdds: -110, sid: "hr-9" },
      draftkings: { line: 250, overOdds: -110 },
    }));
    expect(out.books.fanduel.url).toBe("https://sportsbook.fanduel.com/slip/abc");
    expect(out.books.hardrockbet.url).toContain("hardrock://betslip/hr-9");
    expect(out.books.draftkings.url).toBe(null);
  });
});

describe("count props (anytime TD, passing TDs)", () => {
  // These carry sigma: null — they are Poisson, not Normal — which used to make
  // priceAgainstMarket bail. So the pull bought anytime-TD lines, stored them,
  // indexed them, and the board showed a dash in Market and Edge forever.
  const atd = { prop_type: "anytime_td", proj_mean: 0.5, sigma: null, line: 0.5 };
  const passTd = { prop_type: "pass_tds", proj_mean: 1.8, sigma: null, line: 1.5 };

  it("prices an anytime TD even though the book posts no point", () => {
    // A Yes/No market returns point: null. That is not a missing line — "one or
    // more" IS over 0.5.
    const out = priceAgainstMarket(atd, one("fanduel", { line: null, overOdds: 120 }));
    expect(out).not.toBe(null);
    expect(out.line).toBe(0.5);
    // P(at least one) for a Poisson with λ=0.5 is 1 − e^-0.5 = 0.393469…
    near(out.rawProb, 1 - Math.exp(-0.5));
    // Win% is that blended with the book's price (models.js MARKET_CAL.anytime_td).
    const C = MARKET_CAL.anytime_td, lg = (p) => Math.log(p / (1 - p));
    near(out.modelProb, 1 / (1 + Math.exp(-(C.a + C.wm * lg(100 / 220) + C.wp * lg(1 - Math.exp(-0.5))))));
  });

  it("marks a one-sided TD market as un-de-vigged, so its edge is not read as fair", () => {
    const out = priceAgainstMarket(atd, one("fanduel", { line: null, overOdds: 120 }));
    expect(out.devigged).toBe(false);
    near(out.mktProb, 100 / 220);
  });

  it("shops an anytime TD across books, which is where the spread is widest", () => {
    // The real week-1 row: Kimani Vidal, +250 at FanDuel and +450 at DraftKings.
    const out = priceAgainstMarket(atd, mkt({
      fanduel: { line: null, overOdds: 250 },
      draftkings: { line: null, overOdds: 450 },
    }));
    expect(out.best).toBe("draftkings");
    expect(out.books.draftkings.edge).toBeGreaterThan(out.books.fanduel.edge);
    // Both are on the same 0.5, so neither is off-line.
    expect(out.books.draftkings.offLine).toBe(false);
  });

  it("re-prices passing TDs at the BOOK's rung, not the model's", () => {
    // λ=1.8 at over 2.5 is P(X ≥ 3) = 1 − e^-1.8(1 + 1.8 + 1.62) = 0.26938…
    const out = priceAgainstMarket(passTd, one("fanduel", { line: 2.5, overOdds: 150, underOdds: -190 }));
    expect(out.line).toBe(2.5);
    const e = Math.exp(-1.8);
    near(out.modelProb, 1 - e * (1 + 1.8 + 1.8 * 1.8 / 2));
    // …and that is a different number from the model's own 1.5 rung, which is
    // the whole reason the re-pricing exists.
    const at15 = priceAgainstMarket(passTd, one("fanduel", { line: 1.5, overOdds: -110, underOdds: -110 }));
    expect(at15.modelProb).toBeGreaterThan(out.modelProb);
  });

  it("treats 'over 1.5' and 'at least 2' as the same event", () => {
    const a = priceAgainstMarket(passTd, one("fanduel", { line: 1.5, overOdds: -110, underOdds: -110 }));
    const b = priceAgainstMarket(passTd, one("fanduel", { line: 1.2, overOdds: -110, underOdds: -110 }));
    near(a.modelProb, b.modelProb);
  });
});

describe("the sack ladder", () => {
  const row = (o) => ({ game_id: "G", season: 2026, week: 2, prop_type: "player_sacks_alternate",
    player_name: "Micah Parsons", name: "Over", line: 0.5, odds: 150, book: "draftkings", ...o });

  it("keeps every rung a book posts instead of collapsing to one line", () => {
    // DraftKings really does post the same player at several rungs in one slate.
    const idx = indexSackOdds([
      row({ line: 0.5, odds: 120 }),
      row({ line: 2.5, odds: 800 }),
      row({ line: 0.5, odds: -300, name: "Under" }),
    ]);
    const rec = idx.get("G|micah parsons");
    expect(rec.books.draftkings).toHaveLength(2);
    expect(rec.books.draftkings.map((r) => r.line)).toEqual([0.5, 2.5]);   // sorted
    expect(rec.books.draftkings[0].underOdds).toBe(-300);
    expect(sackRungCount(rec)).toBe(2);
  });

  it("carries the capture time of each rung's price, latest row winning", () => {
    const idx = indexSackOdds([
      row({ odds: 150, captured_at: "2026-10-04T15:40:40Z" }),
      row({ odds: 130, captured_at: "2026-10-04T20:54:50Z" }),
    ]);
    const rung = idx.get("G|micah parsons").books.draftkings[0];
    expect([rung.overOdds, rung.at]).toEqual([130, "2026-10-04T20:54:50Z"]);
  });

  it("reads the main and alternate keys as one market", () => {
    // DraftKings and BetOnline post more players under the alternate key than
    // the main one; splitting them throws away most of the ladder.
    const idx = indexSackOdds([
      row({ prop_type: "player_sacks", book: "fanduel", odds: 178 }),
      row({ prop_type: "player_sacks_alternate", book: "draftkings", odds: 210 }),
    ]);
    expect(Object.keys(idx.get("G|micah parsons").books).sort()).toEqual(["draftkings", "fanduel"]);
  });

  it("never lets a quarterback's sacks-TAKEN line onto the board", () => {
    // Same upstream key, opposite question. pull_live_odds.mjs renames them.
    const idx = indexSackOdds([row({ prop_type: "player_sacks_taken", player_name: "Jalen Hurts" }),
                              row({ prop_type: "player_sacks_alternate_taken", player_name: "Bo Nix" })]);
    expect(idx.size).toBe(0);
  });

  it("drops a book with no Over, and a player no book priced", () => {
    expect(indexSackOdds([row({ name: "Under", odds: -300 })]).size).toBe(0);
    expect(indexSackOdds([row({ book: "prizepicks" })]).size).toBe(0);   // not a shown book
    expect(indexSackOdds([row({ line: null })]).size).toBe(0);
  });

  it("picks the rung with the best EV, not the biggest probability edge", () => {
    // 0.25 at -300 is a 75% ask we make 80% — a 5pp edge worth +0.067 a unit.
    // 2.5 at +900 is a 10% ask we make 12% — a 2pp edge worth +0.20 a unit.
    // Ranking on probability points takes the first and leaves the better bet.
    const idx = indexSackOdds([row({ line: 0.25, odds: -300 }), row({ line: 2.5, odds: 900 })]);
    const probOver = (ln) => (ln === 0.25 ? 0.80 : 0.12);
    const best = bestSackOffer(idx.get("G|micah parsons"), probOver);
    expect(best.line).toBe(2.5);
    expect(best.ev).toBeGreaterThan(0.1);
    expect(best.devigged).toBe(false);          // one-sided, vig not removable
  });

  it("marks a two-sided rung as de-viggable", () => {
    const idx = indexSackOdds([row({ line: 0.5, odds: 115 }), row({ line: 0.5, odds: -300, name: "Under" })]);
    expect(bestSackOffer(idx.get("G|micah parsons"), () => 0.5).devigged).toBe(true);
  });

  it("says nothing rather than guessing when no book posted him", () => {
    expect(bestSackOffer(null, () => 0.5)).toBeNull();
    expect(sackRungCount(null)).toBe(0);
  });
});

describe("wiring invariants", () => {
  it("maps exactly the markets the pull buys", () => {
    expect(Object.keys(MARKET_TO_PROP).sort()).toEqual([
      "player_anytime_td", "player_pass_tds", "player_pass_yds",
      "player_reception_yds", "player_receptions", "player_rush_yds",
      "player_sacks",
    ]);
  });

  it("stays in step with scripts/pull_live_odds.mjs", async () => {
    // The two lists are edited in different files by different kinds of change —
    // a new market gets added to the pull and forgotten here (its rows are then
    // stored and silently dropped by indexOdds), or added here and never bought
    // (the column is blank forever). Both have happened.
    //
    // Sacks are bought in their own pass from their own regions, so the pull's
    // list is CORE_MARKETS plus SACK_MARKETS. The alternate keys are deliberately
    // not mapped: indexOdds keeps one line per book, and indexSackOdds is what
    // reads the sack ladder.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../../scripts/pull_live_odds.mjs", import.meta.url), "utf8");
    const listOf = (name) => {
      const block = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`).exec(src)?.[1] ?? "";
      return [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    };
    const core = listOf("CORE_MARKETS");
    const sacks = listOf("SACK_MARKETS");
    expect(core.length).toBeGreaterThan(0);
    expect(sacks).toContain("player_sacks");
    const bought = [...core, ...sacks].filter((m) => !m.endsWith("_alternate"));
    expect(bought.sort()).toEqual(Object.keys(MARKET_TO_PROP).sort());
  });

  it("buys the sack market only from books with a two-sided price", () => {
    // PrizePicks and Underdog are DFS pick'em: one price on both sides, nothing
    // to de-vig, and not books we bet. They were in SACK_BOOKS until a
    // 2026-09-20 re-measurement found FanDuel and DraftKings each posting sacks
    // on 15 of 15 games from `us` — the Thursday pull that put them there had
    // been measuring the calendar, not the region.
    for (const b of ["prizepicks", "underdog"]) {
      expect(BOOK_PREF).not.toContain(b);
      expect(SACK_BOOKS).not.toContain(b);
    }
    expect(SACK_BOOKS).toContain("fanduel");
    expect(SACK_BOOKS).toContain("draftkings");
  });

  it("shows the same three book columns on every market", () => {
    // The price columns must not move when the Props dropdown changes. Hard
    // Rock posts no sack line, so its cell is a dash on a sack row rather than
    // a column that vanishes — see SACK_BOOKS. columnsFor still takes the list
    // as a parameter: that seam is why the two CAN differ, not a claim they do.
    expect(SACK_BOOKS).toEqual(BOOK_PREF);
  });

  it("keeps FanDuel and Hard Rock in the preferred books", () => {
    // Hard Rock only exists in the us2 region — if it ever leaves this list,
    // scripts/pull_live_odds.mjs is paying for a region it does not use.
    expect(BOOK_PREF).toContain("fanduel");
    expect(BOOK_PREF).toContain("hardrockbet");
  });
});
