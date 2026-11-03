#!/usr/bin/env node
/**
 * pull_live_odds.mjs — live player-prop lines for the current slate.
 *
 * The sibling of pull_historical_odds.mjs. That one buys a frozen archive at
 * 10x; this one reads the live board at 1x and keeps nfl.live_odds current so
 * the app can show a real line and a real edge next to each projection.
 *
 * ── COST MODEL (measured against the live API 2026-09-08, not read from docs) ──
 *   /events                                  → 0 credits, returns all 272 events
 *   /events/{id}/odds  regions=us,  6 markets → 6 credits   (1 per market/region)
 *   /events/{id}/odds  regions=us2, 6 markets → 6 credits
 *   markets that no book posts are NOT billed — only the ones that return data
 *
 * So a full 16-game slate, 6 core markets, both US regions = 192 credits.
 * (Was 128 at 4 markets; pass TDs and receptions are the two added since.)
 *
 * ── WHY THE REGION LIST IS THE ONLY COST LEVER ───────────────────────────────
 * Hard Rock Bet is NOT in `us`. Measured on the Week 1 opener:
 *   us  → draftkings fanduel fanatics betonlineag williamhill_us betrivers bovada
 *   us2 → hardrockbet hardrockbet_fl ballybet betparx espnbet fliff
 * FanDuel and DraftKings come from `us`; Hard Rock only from `us2`. Asking for
 * both DOUBLES the cost, and it is the only way to price Hard Rock.
 *
 * "Just pull FanDuel to save credits" saves NOTHING — billing is per region, not
 * per book, so FanDuel alone costs exactly what FanDuel + DraftKings + 5 others
 * costs. Measured on the Week 1 slate (637 props all three books priced):
 *   · DraftKings beats FanDuel's price on 56.7% of props — and is FREE
 *   · Hard Rock beats the best of FD/DK on 11.9%, and is STRICTLY best on 1.9%
 *   · Hard Rock is the only book pricing 1 prop out of 752
 *   · Hard Rock's implied probability averages 0.45-0.97pp WORSE than best(FD,DK)
 * So `us` is the default and the midweek board runs on it. The day-of pull adds
 * us2 (--regions us,us2) so the number you are actually about to bet carries
 * Hard Rock's, which is a "show me my book" argument rather than a price one.
 *
 * ── WHY NO bookmakers= FILTER ────────────────────────────────────────────────
 * `bookmakers=` is a RESPONSE filter — it does not reduce cost. The 2025 archive
 * pull sent `bookmakers=fanduel` and threw away four other books it had already
 * paid for. We ask unfiltered and store every book: best-line shopping and a
 * multi-book de-vig consensus are strictly better, and free.
 *
 * ── SAFETY ───────────────────────────────────────────────────────────────────
 * The Odds API key is SHARED with the MLB and WNBA labs on one 20,000/mo quota
 * that resets on the 1st and does not roll over. Two guards, both on by default:
 *   · dry run unless --live, printing exactly what --live would spend
 *   · --reserve (default 3000) — refuses to pull if it would take the account
 *     below that many credits, so an NFL pull can never starve MLB's daily cron
 * Every pull logs its own row to public.odds_credit_log (source `nfl_live`) from
 * the account-wide response headers, so the shared ledger stays truthful.
 *
 * USAGE
 *   node --env-file=.env.local scripts/pull_live_odds.mjs                  # dry run, next 8 days, us
 *   node --env-file=.env.local scripts/pull_live_odds.mjs --live
 *   node --env-file=.env.local scripts/pull_live_odds.mjs --week 1 --live
 *   node --env-file=.env.local scripts/pull_live_odds.mjs --within 16 --close --regions us,us2 --live
 *   node --env-file=.env.local scripts/pull_live_odds.mjs --map-only       # refresh event map, 0 credits
 *   node --env-file=.env.local scripts/pull_live_odds.mjs --alt --live     # + alternate ladders
 *   node --env-file=.env.local scripts/pull_live_odds.mjs --sacks-only --live
 *   node --env-file=.env.local scripts/pull_live_odds.mjs --game-lines-only --regions us,us2 --live
 *
 * FLAGS THAT COST OR SAVE MONEY
 *   --sacks-only              buy ONLY the sack market (~2/event, ~32 a slate)
 *   --game-lines-only         buy ONLY spreads/totals/moneylines (slate, 3/region) + team totals (1/event/region)
 *   --no-game-lines           skip every game market (slate call and team totals)
 *   --no-sacks                skip it
 *   --regions us | us,us2     the only cost lever; us2 exists to add Hard Rock
 *   --reserve N               refuse to drop the shared key below N (default 3000)
 *   --skip-fresher-than MIN   don't re-buy an event priced this recently (default 90)
 *   --force                   re-buy anyway
 */

import { sbRequest } from "./lib/sb.mjs";

const SEASON = Number(argOf("--season") || 2026);
const SPORT = "americanfootball_nfl";
const API = "https://api.the-odds-api.com/v4";

// Every market the model prices and the board can show. Alternate ladders are
// opt-in (--alt): they are ~6x the rows for the same credits, which is a storage
// question, not a cost one.
//
// player_receptions was the odd one out — projectPlayer() has produced a
// receptions projection since v1 and the board now gives receivers a REC toggle,
// but the pull never asked for the market, so every one of those rows showed a
// dash forever. Adding it costs 1 credit per event per region, the same as any
// other market, and only when a book actually posts it.
const CORE_MARKETS = ["player_anytime_td", "player_rush_yds", "player_reception_yds",
  "player_receptions", "player_pass_yds", "player_pass_tds"];

// GAME markets come from the SPORT-level endpoint, which is billed PER REQUEST
// rather than per event: spreads+totals for a whole 16-game slate costs
// markets × regions, not markets × regions × 16. That is the cheapest data on
// the board by an order of magnitude, and it is what the totals/spread model and
// every implied-team-points calculation downstream actually run on.
// Moneylines (h2h) joined on 2026-10-14 when the game engine started pricing
// them (src/lib/gameMarkets.js): one more market on the slate call, so +1 credit
// per region per pull — ~10 a week on the odds-pull.yml schedule.
const GAME_MARKETS = ["spreads", "totals", "h2h"];
// Team totals are NOT on the slate endpoint — they are an event-level market,
// billed like a player prop (1 per event per region, only when posted). They
// ride the per-event call the props already make and are stored in game_lines,
// not live_odds: they are a game market and the board reads them with the
// spreads. ~14-16 credits a slate per region.
const EVENT_GAME_MARKETS = ["team_totals"];
const ALT_MARKETS = ["player_pass_yds_alternate", "player_rush_yds_alternate", "player_reception_yds_alternate"];

// ── THE SACK MARKET IS BOUGHT IN ITS OWN PASS ────────────────────────────────
// It does not appear in the /markets catalogue for an event even when a book is
// posting it, so it has to be asked for by name.
//
// IT IS A SPORTSBOOK MARKET, AND THE FIRST MEASUREMENT OF IT WAS A CLOCK
// READING. Measured Thursday 2026-09-18, two days out, across all 29 events:
//   us      fanduel only, 1 of 29 events, 10 players
//   us_dfs  prizepicks (15 events, 102 players) + underdog (66 players)
// from which this pull concluded that sacks live in `us_dfs` and bought that
// region every slate. Re-measured Sunday 2026-09-20, ~3h to kickoff, over the
// 15 remaining events of the SAME slate, from `us` alone — 30 credits:
//   fanduel      15/15 events    draftkings  15/15    betonlineag  15/15
// Sportsbooks post defensive props LATE, not never. Thursday was measuring the
// calendar, and `us_dfs` was buying two DFS pick'em apps — one price on both
// sides, nothing to de-vig, and not books we bet — to cover players that FanDuel
// and DraftKings cover for free in the region the core props already come from.
//
// So: `us`, and `us_dfs` only if somebody deliberately asks for it.
//
// It stays a SEPARATE pass rather than joining CORE_MARKETS because of the
// quarterback rewrite below: `player_sacks` means sacks TAKEN for a passer, and
// those rows have to be renamed before they are stored. Same region, same
// per-market billing, so the split costs nothing.
const SACK_MARKETS = ["player_sacks", "player_sacks_alternate"];
const SACK_REGIONS = argOf("--sack-regions") || "us";

// Region list, and it is THE cost lever — see WHY BOTH REGIONS above. Defaults
// to `us` alone (FanDuel + DraftKings + 5 more) because Hard Rock did not earn
// its second region on the midweek board; the day-of pull passes --regions us,us2
// so the number you are about to bet includes Hard Rock's.
const REGIONS = argOf("--regions") || "us";

function argOf(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}
const has = (f) => process.argv.includes(f);

const LIVE = has("--live");
const MAP_ONLY = has("--map-only");
const CLOSE = has("--close");
const ALT = has("--alt");
const WEEK = argOf("--week") ? Number(argOf("--week")) : null;
const WITHIN_H = Number(argOf("--within") || 192);          // default 8 days = one full week's board
const RESERVE = Number(argOf("--reserve") || 3000);         // never leave the shared key below this
const MAX_EVENTS = Number(argOf("--max-events") || 32);
// Re-run guard: an event priced this recently is skipped rather than re-bought.
// The Odds API calls here have NO retry — a failed request warns and moves on,
// and an error response is not billed — so retries cannot burn credits. What CAN
// is re-running a workflow that died halfway: without this, the events it had
// already paid for get bought a second time. 0 disables.
const FRESH_MIN = Number(argOf("--skip-fresher-than") || 90);
const FORCE = process.argv.includes("--force");
const SKIP_GAME_LINES = process.argv.includes("--no-game-lines");
const SKIP_SACKS = process.argv.includes("--no-sacks");
// Buy the sack market and nothing else. The core props cost ~6 credits an event
// and the cron already holds them; sacks cost ~22 for a whole slate, so a
// targeted refresh should not have to re-buy 90 credits of lines to get them.
const SACKS_ONLY = process.argv.includes("--sacks-only");
// Buy ONLY the game markets: the slate call (spreads, totals, moneylines — 3 per
// region) plus each event's team totals (1 per event per region). ~17 credits a
// slate from `us`, ~34 with us2 for Hard Rock — for refreshing game lines
// without re-buying ~100 credits of player props.
const GAME_ONLY = process.argv.includes("--game-lines-only");

const KEY = process.env.THE_ODDS_API_KEY || process.env.ODDS_API_KEY;
const SUPA = process.env.SUPABASE_URL;
const SKEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) die("THE_ODDS_API_KEY / ODDS_API_KEY missing — run with --env-file=.env.local");
if (!SUPA || !SKEY) die("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — run with --env-file=.env.local");

function die(msg) { console.error("ERROR: " + msg); process.exit(1); }
const MARKETS = GAME_ONLY ? EVENT_GAME_MARKETS
  : [...(ALT ? [...CORE_MARKETS, ...ALT_MARKETS] : CORE_MARKETS), ...(SKIP_GAME_LINES ? [] : EVENT_GAME_MARKETS)];

// ── Supabase (nfl schema) ────────────────────────────────────────────────────
// Every request goes through scripts/lib/sb.mjs so this script shares the one
// retry/timeout policy the repo has — hand-rolling a fetch here is exactly the
// divergence scripts/lib/sb.guard.test.js fails the build over.
//
// An upsert is not idempotent by HTTP's rules, but ours is: every write below is
// a merge-duplicates POST keyed on a deterministic row_key, so replaying it
// writes the same rows. `idempotent: true` opts those into the retry ladder,
// which is the whole point during an instance stall.
async function sb(path, { method = "GET", body, profile = "nfl", prefer } = {}) {
  const headers = {
    apikey: SKEY, Authorization: `Bearer ${SKEY}`, "Content-Type": "application/json",
    ...(method === "GET" ? { "Accept-Profile": profile } : { "Content-Profile": profile }),
    ...(prefer ? { Prefer: prefer } : {}),
  };
  const res = await sbRequest(
    `${SUPA}/rest/v1/${path}`,
    { method, headers, body: body ? JSON.stringify(body) : undefined },
    { idempotent: true, label: `${method} nfl.${path.split("?")[0]}` },
  );
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

// ── The Odds API ─────────────────────────────────────────────────────────────
let creditsSpent = 0;
let creditsUsedTotal = null;
let creditsRemaining = null;

async function odds(path, qs) {
  const res = await fetch(`${API}${path}?apiKey=${KEY}&${qs}`);
  const last = Number(res.headers.get("x-requests-last") || 0);
  const used = res.headers.get("x-requests-used");
  const rem = res.headers.get("x-requests-remaining");
  if (used != null) creditsUsedTotal = Number(used);
  if (rem != null) creditsRemaining = Number(rem);
  creditsSpent += last;
  const txt = await res.text();
  if (!res.ok) throw new Error(`odds ${path} → ${res.status} ${txt.slice(0, 300)}`);
  return { json: JSON.parse(txt), cost: last };
}

// ── 1. event map (free) ──────────────────────────────────────────────────────
console.log(`[live-odds] season ${SEASON} · markets ${MARKETS.length} (${ALT ? "core+alt" : "core"}) · regions ${REGIONS}`);

// home_qb / away_qb are here for the sack pass: `player_sacks` means sacks
// RECORDED for a defender and sacks TAKEN for a quarterback, and the starters
// named on the schedule are how those rows get told apart.
const games = await sb(`games?select=game_id,season,week,gameday,home_team,away_team,home_qb,away_qb&season=eq.${SEASON}`);

// nfl.teams keeps relocated/aliased rows, so full_name is NOT unique: "Los
// Angeles Rams" is both LA (canonical, per scripts/nflteams.py) and LAR, and
// "Los Angeles Chargers" is both LAC and SD. Taking the last row silently
// mapped every Rams game to LAR and matched none of the 17 they play.
// The season's own schedule is the authority on which abbreviation is live, so
// resolve against it rather than hardcoding a second copy of the alias table.
const teams = await sb("teams?select=team_abbr,full_name");
const liveAbbrs = new Set(games.flatMap((g) => [g.home_team, g.away_team]));
const abbrOf = {};
for (const t of teams) {
  if (!t.full_name) continue;
  const cur = abbrOf[t.full_name];
  if (cur && liveAbbrs.has(cur) && !liveAbbrs.has(t.team_abbr)) continue;
  abbrOf[t.full_name] = t.team_abbr;
}

// (season, home, away) is unique in a regular season: a given pairing happens at
// a given home site at most once, so this needs no date tolerance.
const gameBy = new Map(games.map((g) => [`${g.home_team}|${g.away_team}`, g]));

const { json: events, cost: mapCost } = await odds(`/sports/${SPORT}/events`, "");
console.log(`[live-odds] /events → ${events.length} events, ${mapCost} credits`);

const eventRows = [];
const unmatched = [];
// event_id → the two starting quarterbacks, for the sack pass only. It is NOT
// put on eventRows: those are upserted into odds_events, and a column that table
// does not have would fail the write.
const qbBy = new Map();
for (const e of events) {
  const home = abbrOf[e.home_team];
  const away = abbrOf[e.away_team];
  const g = home && away ? gameBy.get(`${home}|${away}`) : null;
  if (!g) unmatched.push(`${e.away_team} @ ${e.home_team}`);
  eventRows.push({
    event_id: e.id, game_id: g?.game_id ?? null,
    season: g?.season ?? SEASON, week: g?.week ?? null,
    commence_time: e.commence_time, home_team: home ?? null, away_team: away ?? null,
    refreshed_at: new Date().toISOString(),
  });
  qbBy.set(e.id, [g?.home_qb, g?.away_qb].filter(Boolean));
}
if (unmatched.length) {
  console.warn(`[live-odds] WARNING ${unmatched.length} events did not match nfl.games:`);
  for (const u of unmatched.slice(0, 10)) console.warn(`    ${u}`);
}
for (let i = 0; i < eventRows.length; i += 500) {
  await sb("odds_events?on_conflict=event_id", {
    method: "POST", body: eventRows.slice(i, i + 500),
    prefer: "return=minimal,resolution=merge-duplicates",
  });
}
console.log(`[live-odds] event map upserted (${eventRows.length - unmatched.length}/${eventRows.length} matched)`);

if (MAP_ONLY) {
  console.log("[live-odds] --map-only: done, 0 credits spent on odds.");
  process.exit(0);
}

// ── 2. pick the events to price ──────────────────────────────────────────────
const now = Date.now();
const horizon = now + WITHIN_H * 3600 * 1000;
let targets = eventRows.filter((r) => r.game_id && new Date(r.commence_time).getTime() > now);
targets = WEEK != null
  ? targets.filter((r) => r.week === WEEK)
  : targets.filter((r) => new Date(r.commence_time).getTime() <= horizon);
targets.sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time));

if (targets.length > MAX_EVENTS) {
  console.warn(`[live-odds] ${targets.length} events in scope, capping at --max-events ${MAX_EVENTS}`);
  targets = targets.slice(0, MAX_EVENTS);
}

// Drop events we already bought recently at this snapshot_kind. This is what
// makes re-running a half-failed workflow cheap: it pays only for what it did
// not already get. The window is deliberately short (90 min) so the Sunday
// second close pass, seven hours after the first, is NOT suppressed by it.
// The stamp lives on odds_events (one row per event), NOT on live_odds. Asking
// live_odds "which of these games did we price recently" means filtering ~10k
// outcome rows to learn 16 booleans, and PostgREST caps a response at 1000 rows
// — the first version of this check read those 1000 rows, saw 2 of the 16 games
// they happened to cover, and cheerfully re-bought the other 14.
const KIND = CLOSE ? "close" : "live";
const STAMP = CLOSE ? "last_close_at" : "last_live_at";
// A close pull also refreshes the live surface the board reads — see the write
// loop below. A refresh pull only writes 'live'.
const KINDS = CLOSE ? ["close", "live"] : ["live"];
let skippedFresh = 0;
if (FRESH_MIN > 0 && !FORCE && targets.length) {
  const since = Date.now() - FRESH_MIN * 60_000;
  const rows = await sb(
    `odds_events?select=event_id,${STAMP}&event_id=in.(${targets.map((t) => t.event_id).join(",")})`,
  );
  const fresh = new Set(
    (rows || []).filter((r) => r[STAMP] && new Date(r[STAMP]).getTime() >= since).map((r) => r.event_id),
  );
  if (fresh.size) {
    skippedFresh = targets.filter((t) => fresh.has(t.event_id)).length;
    targets = targets.filter((t) => !fresh.has(t.event_id));
    console.log(`[live-odds] skipping ${skippedFresh} event(s) already priced within ${FRESH_MIN}m (--force to re-buy)`);
  }
}

// Cost is 1 per market per region per event, but markets no book posts are not
// billed — so this estimate is a CEILING, and the measured spend is printed at
// the end for comparison.
const nRegions = REGIONS.split(",").length;
// Player props bill per EVENT; the game-lines call bills once for the slate.
const estimate = (SACKS_ONLY ? 0 : targets.length * MARKETS.length * nRegions)
  + (SACKS_ONLY || SKIP_GAME_LINES || !targets.length ? 0 : GAME_MARKETS.length * nRegions)
  // Sacks now come from `us`, where three books post them on every game, so the
  // ceiling is close to the truth: 2 markets x 1 region x events, measured 30
  // on a 15-game slate.
  + (SKIP_SACKS || GAME_ONLY ? 0 : targets.length * SACK_MARKETS.length * SACK_REGIONS.split(",").length);
const targetIds = new Set(targets.map((t) => t.event_id));

console.log(`[live-odds] ${targets.length} events in scope${WEEK != null ? ` (week ${WEEK})` : ` (next ${WITHIN_H}h)`}`);
for (const t of targets) console.log(`    W${t.week} ${t.away_team} @ ${t.home_team}  ${t.commence_time}`);
console.log(`[live-odds] estimated cost: ${estimate} credits (ceiling) · snapshot_kind=${CLOSE ? "close" : "live"}`
  + (SKIP_SACKS ? "" : ` · includes sacks from ${SACK_REGIONS} (~2/event, measured)`));

if (!LIVE) {
  console.log("\n[live-odds] DRY RUN — no odds calls made. Re-run with --live to spend.");
  process.exit(0);
}

// ── 3. reserve guard: never starve the MLB cron on the shared key ────────────
if (creditsRemaining != null && creditsRemaining - estimate < RESERVE) {
  die(`reserve guard: ${creditsRemaining} credits remain, this pull needs up to ${estimate}, ` +
      `which would leave less than the --reserve floor of ${RESERVE}. ` +
      `Lower --reserve deliberately, narrow --week/--within, or wait for the 1st.`);
}

// ── 4. pull ──────────────────────────────────────────────────────────────────
const rows = [];
// Team totals come back in the per-event payload; they are game lines.
const teamTotalRows = [];
const pricedEvents = [];
let priced = 0;

for (const t of SACKS_ONLY ? [] : targets) {
  let payload;
  try {
    ({ json: payload } = await odds(
      `/sports/${SPORT}/events/${t.event_id}/odds`,
      // includeLinks/includeSids are FREE — billing is per market per region, and
      // these are response flags. They are what makes a price on the board
      // clickable: the app builds a bet slip from `link` (FanDuel, DraftKings)
      // or from `sid` (Hard Rock, whose link field is not usable).
      `regions=${REGIONS}&oddsFormat=american&markets=${MARKETS.join(",")}`
      + "&includeLinks=true&includeSids=true",
    ));
  } catch (err) {
    console.warn(`    ! ${t.away_team} @ ${t.home_team}: ${err.message}`);
    continue;
  }
  const books = payload.bookmakers || [];
  let n = 0;
  for (const bk of books) {
    for (const mkt of bk.markets || []) {
      if (EVENT_GAME_MARKETS.includes(mkt.key)) {
        // `description` names the team ("Seattle Seahawks"), `name` the side.
        for (const o of mkt.outcomes || []) {
          const team = abbrOf[o.description] || null;
          if (!team) continue;
          for (const kind of KINDS) {
            teamTotalRows.push({
              row_key: [t.game_id, bk.key, mkt.key, `${team}:${o.name}`, kind, o.point ?? ""].join("|"),
              game_id: t.game_id, season: t.season, week: t.week,
              book: bk.key, market: mkt.key, outcome: o.name, team,
              line: o.point ?? null, odds: o.price ?? null,
              link: o.link || mkt.link || bk.link || null, sid: o.sid || mkt.sid || bk.sid || null,
              snapshot_kind: kind, commence_time: t.commence_time,
              captured_at: new Date().toISOString(),
            });
          }
          n++;
        }
        continue;
      }
      for (const o of mkt.outcomes || []) {
        // `description` is the player on player-prop markets; `name` is the side.
        const player = o.description || o.name;
        if (!player) continue;
        const line = o.point ?? null;
        // A close pull writes BOTH kinds from the one payload it already paid
        // for. 'close' accumulates as the CLV substrate; 'live' is what the
        // board reads, and refreshing it is the only way the day-of number —
        // Hard Rock's included, since us2 is bought only here — actually reaches
        // the screen. Zero extra credits: same response, written twice.
        for (const kind of KINDS) {
          rows.push({
            row_key: [t.game_id, bk.key, mkt.key, player, o.name, kind, line ?? ""].join("|"),
            game_id: t.game_id, season: t.season, week: t.week,
            book: bk.key, prop_type: mkt.key, player_name: player,
            name: o.name, line, odds: o.price,
            // The API nests these three deep: bookmaker → market → outcome. The
            // outcome's own link is the one that lands on a filled slip; the
            // market's and the bookmaker's land on a page. Prefer the deepest
            // one present rather than assuming any of them is.
            link: o.link || mkt.link || bk.link || null,
            sid: o.sid || mkt.sid || bk.sid || null,
            snapshot_kind: kind, commence_time: t.commence_time,
            captured_at: new Date().toISOString(),
          });
        }
        n++;
      }
    }
  }
  priced++;
  pricedEvents.push(t.event_id);
  console.log(`    W${t.week} ${t.away_team} @ ${t.home_team} → ${books.length} books, ${n} rows`);
}

// ── 4b. sacks ────────────────────────────────────────────────────────────────
// A second pass over the same events, asking for the sack market by name from
// its own regions. See SACK_MARKETS above for why it is separate and what it
// costs (~22 credits for a full slate, because a market no book posts is not
// billed).
//
// THE QUARTERBACK PROBLEM. `player_sacks` carries two different questions under
// one key: for a defender it is sacks RECORDED, for a quarterback it is sacks
// TAKEN — PrizePicks posts Bryce Young at 2.5 next to Jaelan Phillips at 1.5.
// Stored under one prop_type they would join by name onto the same board and a
// quarterback would appear on it at a line meaning the opposite of what the
// column says. The starters named on the schedule are the discriminator, and a
// quarterback's rows are written as `player_sacks_taken`, which src/lib/odds.js
// deliberately does not map. It is a real market and we simply do not price it.
if (!SKIP_SACKS && !GAME_ONLY && targets.length) {
  const nameKey = (x) => String(x || "").toLowerCase().replace(/[^a-z ]/g, "").trim();
  let sackRows = 0, sackEvents = 0;
  const sackBooks = new Set();
  for (const t of targets) {
    let payload;
    try {
      ({ json: payload } = await odds(
        `/sports/${SPORT}/events/${t.event_id}/odds`,
        `regions=${SACK_REGIONS}&oddsFormat=american&markets=${SACK_MARKETS.join(",")}`
        + "&includeLinks=true&includeSids=true",
      ));
    } catch (err) {
      console.warn(`    ! sacks ${t.away_team} @ ${t.home_team}: ${err.message}`);
      continue;
    }
    const qbs = new Set((qbBy.get(t.event_id) || []).map(nameKey));
    let n = 0;
    for (const bk of payload.bookmakers || []) {
      for (const mkt of bk.markets || []) {
        if (!mkt.key.includes("sack")) continue;
        for (const o of mkt.outcomes || []) {
          const player = o.description || o.name;
          if (!player) continue;
          const key = qbs.has(nameKey(player)) ? `${mkt.key}_taken` : mkt.key;
          const line = o.point ?? null;
          for (const kind of KINDS) {
            rows.push({
              row_key: [t.game_id, bk.key, key, player, o.name, kind, line ?? ""].join("|"),
              game_id: t.game_id, season: t.season, week: t.week,
              book: bk.key, prop_type: key, player_name: player,
              name: o.name, line, odds: o.price,
              link: o.link || mkt.link || bk.link || null,
              sid: o.sid || mkt.sid || bk.sid || null,
              snapshot_kind: kind, commence_time: t.commence_time,
              captured_at: new Date().toISOString(),
            });
          }
          sackBooks.add(bk.key);
          n++;
        }
      }
    }
    if (n) { sackEvents++; sackRows += n; }
  }
  console.log(`[live-odds] sacks: ${sackRows} outcomes over ${sackEvents}/${targets.length} events`
            + ` from [${[...sackBooks].join(", ") || "no book"}]`);
}

// ── 5. store ─────────────────────────────────────────────────────────────────
// De-dupe within the batch: PostgREST rejects an upsert whose payload hits the
// same conflict target twice ("ON CONFLICT DO UPDATE command cannot affect row a
// second time"). Two books can post the same key only if the API repeats one, but
// alternate ladders do repeat points across a book's own rungs.
const seen = new Set();
const deduped = rows.filter((r) => (seen.has(r.row_key) ? false : (seen.add(r.row_key), true)));

for (let i = 0; i < deduped.length; i += 500) {
  await sb("live_odds?on_conflict=row_key", {
    method: "POST", body: deduped.slice(i, i + 500),
    prefer: "return=minimal,resolution=merge-duplicates",
  });
  process.stdout.write(`\r  upserted ${Math.min(i + 500, deduped.length)}/${deduped.length}`);
}
console.log("");

// Stamp only the events whose rows are now SAFELY STORED. Stamping at fetch time
// would let a run that priced an event and then died on the upsert mark it as
// done, and the re-run would skip the one event it most needs to redo.
// PATCH by key rather than an upsert: the rows already exist (the event map was
// written above), and a partial upsert payload is one schema change away from
// blanking the columns it omits.
// Stamp every kind this run actually wrote — a close pull refreshed the live
// surface too, so leaving last_live_at stale would let the Tuesday board re-buy
// games the Sunday close had already paid for.
// A game-lines-only run bought no props, so it must not stamp the events as
// priced — the re-run guard would then skip a props refresh inside 90 minutes.
if (pricedEvents.length && !GAME_ONLY) {
  const nowIso = new Date().toISOString();
  const stamps = Object.fromEntries(
    KINDS.map((k) => [k === "close" ? "last_close_at" : "last_live_at", nowIso]),
  );
  await sb(`odds_events?event_id=in.(${pricedEvents.join(",")})`, {
    method: "PATCH", body: stamps, prefer: "return=minimal",
  });
}

// ── 5b. game lines (spreads + totals) ────────────────────────────────────────
// One request for the WHOLE slate, billed markets × regions — 4 credits for both
// markets across both regions, however many games are on. These feed the
// totals/spread model AND every implied-team-points input the TD props hang off,
// so they are the highest value-per-credit thing this script buys.
// Nothing in scope means nothing to attach a game line to, and the slate call
// bills whether or not we can use the answer — so skip it rather than buy it.
let gameLineRows = 0;
if (!SKIP_GAME_LINES && !SACKS_ONLY && targets.length) {
  try {
    const { json: slate } = await odds(
      `/sports/${SPORT}/odds`,
      `regions=${REGIONS}&oddsFormat=american&markets=${GAME_MARKETS.join(",")}`
      + "&includeLinks=true&includeSids=true",
    );
    const byEvent = new Map(eventRows.map((e) => [e.event_id, e]));
    const glRows = [];
    for (const ev of slate || []) {
      const meta = byEvent.get(ev.id);
      if (!meta?.game_id) continue;                       // unmatched → nothing to key on
      // Only the games in scope for this pull, so a Tuesday board pull does not
      // also store lines for a game three weeks out that will move ten times.
      if (!targetIds.has(ev.id)) continue;
      for (const bk of ev.bookmakers || []) {
        for (const mkt of bk.markets || []) {
          for (const o of mkt.outcomes || []) {
            // Spreads name the SIDE with the book's full team name ("Seattle
            // Seahawks"); totals name it "Over"/"Under". Store our abbreviation
            // so the row joins to nfl.games without every reader re-deriving the
            // mapping — and so it survives the LA/LAR ambiguity resolved above.
            const outcome = abbrOf[o.name] || o.name;
            for (const kind of KINDS) {
              glRows.push({
                row_key: [meta.game_id, bk.key, mkt.key, outcome, kind, o.point ?? ""].join("|"),
                game_id: meta.game_id, season: meta.season, week: meta.week,
                book: bk.key, market: mkt.key, outcome, team: null,
                line: o.point ?? null, odds: o.price ?? null,
                link: o.link || mkt.link || bk.link || null, sid: o.sid || mkt.sid || bk.sid || null,
                snapshot_kind: kind, commence_time: meta.commence_time,
                captured_at: new Date().toISOString(),
              });
            }
          }
        }
      }
    }
    glRows.push(...teamTotalRows.splice(0));
    const glSeen = new Set();
    const glDeduped = glRows.filter((r) => (glSeen.has(r.row_key) ? false : (glSeen.add(r.row_key), true)));
    for (let i = 0; i < glDeduped.length; i += 500) {
      await sb("game_lines?on_conflict=row_key", {
        method: "POST", body: glDeduped.slice(i, i + 500),
        prefer: "return=minimal,resolution=merge-duplicates",
      });
    }
    gameLineRows = glDeduped.length;
    console.log(`[live-odds] game lines: ${gameLineRows} rows across ${new Set(glDeduped.map((r) => r.game_id)).size} games`);
  } catch (err) {
    // A failed game-lines call must not cost the player props their run — they
    // are already bought and in memory by this point.
    console.warn(`[live-odds] game lines skipped: ${err.message}`);
  }
}

// Team totals the slate block did not write — it was skipped, or its call failed
// after the per-event props (and these) were already bought.
if (teamTotalRows.length) {
  const seenTT = new Set();
  const tt = teamTotalRows.filter((r) => (seenTT.has(r.row_key) ? false : (seenTT.add(r.row_key), true)));
  for (let i = 0; i < tt.length; i += 500) {
    await sb("game_lines?on_conflict=row_key", {
      method: "POST", body: tt.slice(i, i + 500),
      prefer: "return=minimal,resolution=merge-duplicates",
    });
  }
  console.log(`[live-odds] team totals: ${tt.length} rows`);
}

// ── 6. log the spend to the SHARED ledger ────────────────────────────────────
// The ledger is only truthful if every consumer of the key writes to it. When
// only the MLB cron wrote, an NFL pull looked like MLB burn.
try {
  await sb("odds_credit_log", {
    method: "POST", profile: "public",
    body: [{
      game_date: new Date().toISOString().slice(0, 10),
      source: "nfl_live",
      credits_used: creditsUsedTotal,
      credits_remaining: creditsRemaining,
    }],
    prefer: "return=minimal",
  });
} catch (err) {
  console.warn(`[live-odds] could not write odds_credit_log: ${err.message}`);
}

const bookSet = [...new Set(deduped.map((r) => r.book))].sort();
console.log(`\n[live-odds] done — ${priced}/${targets.length} events priced, ${deduped.length} rows, ${bookSet.length} books`);
console.log(`[live-odds] books: ${bookSet.join(", ")}`);
console.log(`[live-odds] credits: spent ${creditsSpent} this run (estimate was ${estimate}) · account used ${creditsUsedTotal}, remaining ${creditsRemaining}`);
