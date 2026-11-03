// ── Board rows: one per (player, prop), priced against the market ────────────
// Lifted out of Board.jsx so the board and the pick ledger read the SAME rows.
// scripts/snapshot_picks.mjs freezes these before kickoff and
// scripts/grade_picks.mjs scores them; if the ledger rebuilt its own version of
// this loop, the record it keeps would describe a model nobody was shown.
//
// Pure: no React, no I/O. `d` is the object loadSeason()/assembleSeason() build.
import { projectPlayer, teamOpportunityBudget, teamVolume, applyBudget } from "./models.js";
import { teamPriorFor } from "./teamPriors.js";
import { depthContextFor } from "./rosterStatus.js";
import { projectableRoster } from "./depthPromotion.js";
import { tiltOf } from "./breakdown.js";
import { recentBaseline } from "./aggregate.js";
import { lookupOdds, priceAgainstMarket } from "./odds.js";
import { availabilityOf, statusFor, isRuledOut } from "./injuries.js";
import { confidenceOf, winProb, oneSidedCall } from "./confidence.js";
import { isOneSided } from "./props.js";
import { hitRates } from "./hitRates.js";
import { propShort } from "./format.js";

/**
 * Every prop the model prices for `games`, one row per (player, prop).
 * Every prop is built here and the board's toggles filter afterwards, so
 * flipping a prop on is instant rather than a re-projection of the whole slate.
 */
export function buildBoardRows(d, games) {
  const out = [];
  for (const g of games) {
    for (const side of ["home", "away"]) {
      const team = side === "home" ? g.home_team : g.away_team;
      const opp = side === "home" ? g.away_team : g.home_team;
      // Promotions first, gates second. A backup quarterback whose club has
      // filed everyone above him Out is not on this board without that order:
      // isProjectable() gates quarterbacks on depth_rank === 1, so the man who
      // is actually starting is filtered out before anything can promote him.
      const roster = projectableRoster(d, team, g);

      // ── the team's share of the footballs, resolved ONCE per team-game ────
      // projectPlayer() prices one man at a time and cannot see that a club
      // only throws it so often. At a season flip that gap is not academic:
      // the 2026 week-1 board's summed target baselines average 1.089 times
      // each team's real pool, with 15 of 31 teams above the cap — against a
      // 2025 mid-season mean of 0.872 and 13 of 473 team-weeks above it. The
      // cause is arithmetic, not opinion: a club that signed two starting
      // receivers now carries their old teams' target rates on top of its
      // returning players'. See teamOpportunityBudget().
      //
      // Ruled-out teammates are passed in so their share leaves the pool
      // rather than being projected for a man who is inactive.
      const vol = teamVolume(roster, d.offense[team], teamPriorFor(g.season, team));
      const budget = teamOpportunityBudget(roster, {
        ...vol,
        isOut: (pid) => isRuledOut(availabilityOf(d.injuries, pid, g.week, d.players[pid]?.status)),
      });

      for (const s of roster) {
        // Where the club lists him NOW against where it listed him while the
        // carried baseline was earned. Hoisted out of the projectPlayer call
        // because the row needs it too: the Baseline column shows the move, and
        // a red "RB3" with no "from" reads as a claim about the baseline's
        // source rather than as the warning it is.
        const depth = depthContextFor(g.season, s.player_id, s._carryover?.prior_season);
        const props = projectPlayer({
          player: d.players[s.player_id], season: applyBudget(s, budget.get(s.player_id)),
          splits: d.splits[s.player_id],
          recent: recentBaseline(d.weeksByPlayer?.[s.player_id], g.week),
          teamOff: d.offense[team], oppOff: d.offense[opp], oppDef: d.defense[opp], game: g, side,
          // Rushing volume and the anytime-TD λ both act on it; receiving
          // does not. See ROLE_SHIFT in models.js for the fits.
          depth,
          // Season-flip priors: keyed on the play-caller, null before 2026, so
          // this is inert on the 2025 board.
          teamPrior: teamPriorFor(g.season, team), oppPrior: teamPriorFor(g.season, opp),
        });
        if (!props.length) continue;
        const name = d.players[s.player_id]?.full_name || s.player_id;
        const carryover = s._carryover || null;
        // Availability is a fact about the PLAYER and the week, so it is
        // resolved once and shared by every one of his prop rows.
        const avail = availabilityOf(d.injuries, s.player_id, g.week, d.players[s.player_id]?.status);
        const status = statusFor(avail);
        const ruledOut = isRuledOut(avail);

        for (const p of props) {
          // The market's line, when the week's odds pull has reached this
          // player. Priced at the BOOK's number, not the model's invented one —
          // comparing probabilities across two different lines flatters the
          // model, and the book's is the only one that can actually be bet.
          const mkt = lookupOdds(d.odds, g.game_id, name, p.prop_type);
          const priced = mkt ? priceAgainstMarket(p, mkt) : null;
          const prob = priced?.modelProb ?? p.prob_over;
          const oneSided = isOneSided(p.prop_type);
          const conf = confidenceOf({ prob, carryover, status, oneSided });
          const probLine = priced?.line ?? p.line;
          out.push({
            key: `${g.game_id}|${s.player_id}|${p.prop_type}`,
            player_id: s.player_id, name,
            pos: s.position, team, opp, game: g, side, props,
            prop: p.label, propShort: propShort(p.prop_type, p.label), prop_type: p.prop_type,
            headline: p,
            proj: p.proj_mean,
            // The line the probability is computed AT, which is the book's when
            // there is one. Showing the model's invented line beside a
            // market-priced probability would put two different numbers in one
            // row and call them the same bet.
            probLine,
            prob, oneSided, win: winProb(prob, oneSided), conf,
            // One-sided markets only: does the model take the Yes at this price?
            call: oneSided ? oneSidedCall(priced) : null,
            tilt: tiltOf(p), priced,
            // Projection minus the line it is priced at — and ONLY when a book
            // posted that line. Null on a one-sided market, whose projection is
            // a Poisson rate rather than a count.
            //
            // It used to fall back to the model's invented line with everything
            // else, and that is not a gap, it is a construction: recLine() is
            // `roundHalf(mean - 4)`, so an unpriced row reported a DIFF of about
            // +6 no matter who it was. On a DIFF-sorted board the entire top was
            // therefore the rows with no market on them — week 2 of 2026 opened
            // on eleven straight receivers at +5.7 to +6.0 — which reads as "the
            // odds pull is broken" even on the games it did reach. An absent
            // market line is not a zero one, and it is not a +6 one either:
            // cmp() sinks a null in both directions, which is the honest answer.
            diff: oneSided || !priced ? null : Math.round((p.proj_mean - probLine) * 10) / 10,
            // How often he has cleared THIS line before this week. Display
            // only — see src/lib/hitRates.js.
            hits: hitRates(d.historyByPlayer?.[s.player_id], p.prop_type, probLine, g, opp),
            avail, ruledOut,
            // Where this player's baseline came from. Null pre-flip, so the
            // column simply does not render on the 2025 board.
            carryover, depth,
          });
        }
      }
    }
  }
  return out;
}
