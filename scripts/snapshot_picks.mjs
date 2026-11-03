#!/usr/bin/env node
// ── Freeze the board's picks before kickoff ──────────────────────────────────
// Rebuilds the board exactly as the site builds it (src/lib/boardRows.js over
// src/lib/seasonData.js) and writes every priced row into nfl.nfl_picks as a
// pick — see src/lib/pickLedger.js for what counts and why nothing is gated.
//
// THE FREEZE IS KICKOFF. Only games that have not started are touched. Each run
// upserts on pick_key, so the ledger holds the board's LAST pre-kickoff state:
// a Tuesday line that moved by Sunday morning is recorded at Sunday's number,
// and a player ruled out on Saturday leaves the ledger rather than being graded
// as a void. Once a game kicks off no run can reach its picks again — which is
// the property that makes the record a record rather than a backfill.
//
// A game whose snapshot produces NO picks keeps whatever it already had. An
// empty odds read or a transient failure must never be able to wipe a slate.
//
// …EXCEPT THE PRICE STOPS MOVING WHEN THE CLOSE CAPTURE BEGINS. A close pull
// (odds-pull.yml, game day) writes the `close` rows CLV is graded against AND
// refreshes the `live` rows this script prices from, from the same payload, and
// then runs this script. Re-pricing at that point froze every pick at its own
// closing number: through week 4 of 2026, 3,281 decided picks had odds_at equal
// to their close to the millisecond, CLV +0.0, and the Results tab read "100%
// beat close" off a single moved price. So once a game has a close capture
// inside its game-day window, the picks it already has are HELD at the price
// the board showed before it (Friday's refresh, for a Sunday game) and only rows
// new to the ledger are added — a sack market or a yardage line that first
// appeared in that pull. Those are priced at the close and say so on the Results
// tab (pickLedger.js closeIsCapture) rather than posing as an unmoved line.
// Pruning still runs: a player ruled out on game morning leaves the ledger.
//
//   node --env-file=.env.local scripts/snapshot_picks.mjs              # dry run
//   node --env-file=.env.local scripts/snapshot_picks.mjs --write
//   … --within 30    only games kicking off inside 30 hours (default 36)
//   … --season 2026
//   … --backfill 2026_01_NE_SEA,2026_01_SF_LA
//
// BACKFILL is for games that were played before this ledger existed, and it is
// labelled `source = 'backfill'` so the Results tab never mixes it into the live
// record. It prices the board at each game's last pre-kickoff CLOSE snapshot,
// with today's model code and roster overlay — honest about the market, but not
// a record of what the board showed at the time, which is exactly why it is
// kept apart.
import { loadSeasonNode, loadCloseIndex, sbClient } from "./lib/season.mjs";
import { buildBoardRows } from "../src/lib/boardRows.js";
import { buildSackRows } from "../src/lib/sackRows.js";
import { pickFromRow } from "../src/lib/pickLedger.js";
import { buildGameRows, pickFromGameRow, GAME_PROPS, isGameProp } from "../src/lib/gameMarkets.js";
import { marketStanding, officialColumns } from "../src/lib/officialPicks.js";
import { underTodaysRules } from "../src/lib/rescoreView.js";
import { readRescored } from "./lib/rescored.mjs";
import { gameStatus, kickoffAt } from "../src/lib/gameStatus.js";

const argv = process.argv.slice(2);
const arg = (k, dflt) => { const i = argv.indexOf(k); return i === -1 ? dflt : argv[i + 1]; };
const WRITE = argv.includes("--write");
const SEASON = Number(arg("--season", 2026));
const WITHIN_H = Number(arg("--within", 36));
const BACKFILL = arg("--backfill", null)?.split(",").filter(Boolean) ?? null;
const CHUNK = 500;
// A close pull prices games kicking off within 16 hours (odds-pull.yml), and
// GitHub delivers it up to ~4 late; anything earlier was a hand-dispatched pull.
const CLOSE_WINDOW_H = 24;

async function main() {
  const now = new Date();
  const db = sbClient();
  const { d, oddsAt, gameOddsAt } = await loadSeasonNode(SEASON, db);

  const horizon = now.getTime() + WITHIN_H * 3600e3;
  const games = (BACKFILL
    ? d.games.filter((g) => BACKFILL.includes(g.game_id))
    : d.games.filter((g) => gameStatus(g, now) === "upcoming" && kickoffAt(g).getTime() <= horizon))
    .sort((a, b) => kickoffAt(a) - kickoffAt(b));
  if (BACKFILL) {
    const kicks = Object.fromEntries(games.map((g) => [g.game_id, kickoffAt(g)]));
    d.odds = await loadCloseIndex(SEASON, games.map((g) => g.game_id), kicks, db);
    const closeAt = await db.selectAll("odds_events",
      `select=game_id,last_close_at&game_id=in.(${games.map((g) => `"${g.game_id}"`).join(",")})`, "event_id");
    for (const e of closeAt) oddsAt[e.game_id] = e.last_close_at;
    console.log(`[picks] BACKFILL ${games.map((g) => g.game_id).join(", ")} at their closing lines`);
  }
  console.log(`[picks] ${now.toISOString()} · ${games.length} ${BACKFILL ? "backfill" : "upcoming"} games inside ${WITHIN_H}h`);
  if (!games.length) return;

  // Market standing from everything already graded, so a market that earned its
  // way onto the official card this week is official from this snapshot on —
  // and the verdict freezes with the pick, so it never rewrites an earlier week.
  // See src/lib/officialPicks.js.
  //
  // The weeks before the baseline count AS TODAY'S RULES RE-SCORE THEM
  // (src/lib/rescore.js, scripts/out/rescored_<season>.json), not as frozen.
  // Frozen, they are picks the board no longer makes — the model's raw side, a
  // Yes on every one-sided row — and on 2026 they benched rushing yards after
  // week 5 (45.7% in band) on sides today's calibration would not have taken
  // (re-scored: 51.9%, core). Pushes are read too: a push on the frozen side can
  // be a win or a loss on the re-scored one.
  const standing = marketStanding(underTodaysRules(await db.selectAll("nfl_picks",
    `select=id,pick_key,season,week,source,prop_type,direction,proj_mean,sigma,line,mkt_prob,outcome,profit&season=eq.${SEASON}&outcome=in.(win,loss,push)`,
    "id", { keyset: true }), readRescored(SEASON)));

  // The defensive market is recorded with the others. A sack row is the same row
  // (src/lib/sackRows.js), so pickFromRow, the official verdict and the grader
  // all reach it with no special case — which is the whole reason sacks moved off
  // their own tab. Before this they were graded only as a projection, and the
  // ledger had no idea the market existed.
  const rows = [...buildBoardRows(d, games), ...buildSackRows(d, games)];
  const byKey = new Map();
  for (const r of rows) {
    const p = pickFromRow(r, { now, kickoffAt: kickoffAt(r.game), oddsAt: oddsAt[r.game.game_id] ?? null });
    if (!p) continue;
    const rec = { ...p, ...officialColumns(p, standing, BACKFILL ? "retro" : "pre-kickoff") };
    byKey.set(p.pick_key, BACKFILL ? { ...rec, source: "backfill" } : rec);
  }
  // GAME MARKETS (2026-10-14): spread, total, moneyline and team total, priced
  // by the game engine against the game lines (src/lib/gameMarkets.js). Same
  // freeze, same grade, same official rule — on probation, so none is official
  // until its own in-band record earns it in. Not backfilled: the engine's
  // numbers for a past week are the live ones, and the lines it would need are
  // only the close.
  if (!BACKFILL) {
    for (const prop of GAME_PROPS) {
      for (const r of buildGameRows(d, games, prop)) {
        const p = pickFromGameRow(r, { now, kickoffAt: kickoffAt(r.game), oddsAt: gameOddsAt[r.game.game_id] ?? null });
        if (p) byKey.set(p.pick_key, { ...p, ...officialColumns(p, standing, "pre-kickoff") });
      }
    }
  }
  let picks = [...byKey.values()];

  // Hold every game whose close capture has begun — see the header. The window
  // is the game day so that a hand-dispatched close pull days out cannot freeze
  // a week at Tuesday's prices.
  let held = 0;
  if (!BACKFILL) {
    const ids = games.map((g) => `"${g.game_id}"`).join(",");
    const kick = Object.fromEntries(games.map((g) => [g.game_id, kickoffAt(g).getTime()]));
    const closing = new Set((await db.selectAll("odds_events",
      `select=game_id,last_close_at&last_close_at=not.is.null&game_id=in.(${ids})`, "event_id"))
      .filter((e) => kick[e.game_id] - new Date(e.last_close_at).getTime() <= CLOSE_WINDOW_H * 3600e3)
      .map((e) => e.game_id));
    if (closing.size) {
      const have = new Set((await db.selectAll("nfl_picks",
        `select=pick_key&source=eq.auto&game_id=in.(${[...closing].map((x) => `"${x}"`).join(",")})`, "pick_key"))
        .map((e) => e.pick_key));
      const before = picks.length;
      picks = picks.filter((p) => !(closing.has(p.game_id) && have.has(p.pick_key)));
      held = before - picks.length;
      console.log(`[picks] close capture begun for ${closing.size} game(s): ${held} existing picks held at their pre-close price`);
    }
  }

  const perGame = new Map(games.map((g) => [g.game_id, []]));
  for (const p of picks) perGame.get(p.game_id).push(p);
  for (const g of games) {
    const ps = perGame.get(g.game_id);
    const tiers = ps.reduce((a, p) => ((a[p.conf_tier] = (a[p.conf_tier] || 0) + 1), a), {});
    console.log(`  ${g.game_id.padEnd(16)} ${kickoffAt(g).toISOString().slice(5, 16)}Z  ` +
      `${String(ps.length).padStart(4)} picks  odds@${(oddsAt[g.game_id] || "none").slice(0, 16)}  ` +
      `high ${tiers.high || 0} · med ${tiers.medium || 0} · low ${tiers.low || 0} · official ${ps.filter((p) => p.official).length}`);
  }
  const byProp = picks.reduce((a, p) => ((a[p.prop_type] = (a[p.prop_type] || 0) + 1), a), {});
  const passes = picks.filter((p) => p.direction === "no").length;
  console.log(`[picks] ${rows.length} board rows → ${picks.length - passes} priced picks · ${picks.filter((p) => p.official).length} official` +
    ` · ${passes} one-sided NO (frozen as passes, never graded)`);
  console.log(`[picks] by market ${Object.entries(byProp).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v}`).join(" ")}`);
  console.log(`[picks] standing ${Object.entries(standing).map(([k, v]) => `${k}=${v.status}(${v.n})`).join(" ")}`);

  if (!WRITE) { console.log("[picks] dry run — pass --write to record"); return; }

  for (let i = 0; i < picks.length; i += CHUNK) {
    await db.sb("nfl_picks?on_conflict=pick_key", {
      method: "POST", body: picks.slice(i, i + CHUNK), prefer: "resolution=merge-duplicates,return=minimal",
    });
  }

  // Prune: an auto pick for a still-upcoming game that this snapshot no longer
  // produces (ruled out since, or the market came down). Only for games that
  // produced picks this run — see the header. Held picks count as produced: a
  // game whose picks were all held still drops the ones no longer on the board.
  const produced = new Set([...byKey.values()].map((p) => p.game_id));
  const live = games.filter((g) => produced.has(g.game_id)).map((g) => g.game_id);
  let pruned = 0;
  if (live.length) {
    const ids = live.map((x) => `"${x}"`).join(",");
    const existing = await db.selectAll("nfl_picks",
      `select=id,pick_key,prop_type,game_id&source=eq.${BACKFILL ? "backfill" : "auto"}&outcome=in.(pending,pass)&game_id=in.(${ids})`, "id", { keyset: true });
    // A game pick is only stale if this run actually READ that game's lines: a
    // game-lines read that failed (it degrades to no rows) must not wipe the
    // game picks of every game whose props did load.
    const gameLinesRead = new Set(Object.keys(gameOddsAt));
    const stale = existing.filter((e) => !byKey.has(e.pick_key))
      .filter((e) => !isGameProp(e.prop_type) || gameLinesRead.has(e.game_id)).map((e) => e.id);
    for (let i = 0; i < stale.length; i += 200) {
      await db.sb(`nfl_picks?id=in.(${stale.slice(i, i + 200).join(",")})`, { method: "DELETE" });
    }
    pruned = stale.length;
  }
  console.log(`[picks] recorded ${picks.length} · held ${held} · pruned ${pruned} no longer on the board`);
}

main().catch((e) => { console.error(`[picks] FAILED: ${e.stack || e}`); process.exit(1); });
