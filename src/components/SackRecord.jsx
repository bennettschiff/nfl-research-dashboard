// ── The sack model's frozen record ───────────────────────────────────────────
// Every other market on this board is judged by the pick ledger: a priced row,
// a side, a price, a result (src/lib/pickLedger.js, and the Results tab). Sacks
// get that too now, but almost nobody posts the market — FanDuel priced ten
// players in one game of the week-2 slate and the rest came from two DFS
// pick'em apps — so a ledger of the priced rows is a ledger of a few dozen bets
// and says very little about whether the NUMBER is any good.
//
// This card answers the other question, over every defender the board carried:
// is the projection unbiased, and do the rungs land at the rate they claim.
// scripts/snapshot_sacks.mjs freezes the board before kickoff and grades it
// after, and nothing here recomputes anything — a projection scored with its own
// result in the inputs is not a record of anything.
//
// Lifted out of the old Sacks tab when sacks became a prop on the main board
// (src/lib/props.js). It sits above the table it describes.
import { sackRecord } from "../lib/sackRecord.js";
import { S, C } from "../lib/theme.js";
import { pct1 } from "../lib/format.js";
import { StatTile } from "./ui.jsx";

/**
 * Green when a stated probability landed within two standard errors of itself.
 *
 * Module-private: this file exports a component and nothing else, or fast
 * refresh stops working for the board.
 *
 * A fixed tolerance would call a 229-game sample miscalibrated for a gap that is
 * just the sample being small — the whole point of the record is that it knows
 * how much it knows.
 */
function calColor(p, obs, n) {
  if (p == null || obs == null || !n) return undefined;
  const se = Math.sqrt(Math.max(p * (1 - p), 1e-6) / n);
  return Math.abs(p - obs) <= 2 * se ? C.good : C.warn;
}

export function SackRecord({ season }) {
  const std = sackRecord(season)?.season_to_date || null;
  if (!std) return null;

  return (
    <div style={{ ...S.card, marginBottom: 12 }}>
      <div style={S.cardHead}>
        <div style={S.cardTitle}>The sack record</div>
        <div style={S.cardMeta}>
          {std.weeks} graded {std.weeks === 1 ? "week" : "weeks"} · {std.n} defender-games · frozen before kickoff
        </div>
      </div>
      <div style={{ ...S.cardBody, display: "grid", gap: 10,
        gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
        <StatTile label="Projected" v={std.proj.toFixed(3)} sub="sacks per defender-game" />
        <StatTile label="Actual" v={std.actual.toFixed(3)}
          sub={`bias ${std.bias >= 0 ? "+" : ""}${std.bias.toFixed(3)}`} />
        <StatTile label="P ≥ 0.5" v={pct1(std.p05)} sub={`landed ${pct1(std.obs05)}`}
          color={calColor(std.p05, std.obs05, std.n)} />
        <StatTile label="P ≥ 1" v={pct1(std.p10)} sub={`landed ${pct1(std.obs10)}`}
          color={calColor(std.p10, std.obs10, std.n)} />
      </div>
      <div style={{ padding: "8px 14px", fontSize: 10, color: C.faint,
        borderTop: `1px solid ${C.lineSoft}`, lineHeight: 1.6 }}>
        The PROJECTION's record, not the card's: every defender on the frozen board, graded on whether the
        number is right on average and whether each rung came in at the rate it claimed. A defender who
        never took a defensive snap is a scratch, not a miss. Whether a sack PICK wins is the Results tab.
      </div>
    </div>
  );
}
