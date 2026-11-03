// ── Week slate strip ─────────────────────────────────────────────────────────
// The week's games as a scrollable rail of cards, and a filter: clicking one
// narrows whatever is below it to that game.
//
// The board used to give you no way to see the slate you were projecting
// against — you picked a week from 23 identical pills and got 400 rows with no
// sense of which games they came from. This is the NFL analog of the WNBA lab's
// TODAY'S SLATE, with the fields nflverse already carries and the old Games tab
// threw away: kickoff, the spread, the total, and implied points.
//
// ── THE CARD SHOWS THE GAME'S NUMBERS, NOT A QUARTERBACK (2026-09-18) ────────
// Each side used to carry its starting quarterback's name under the abbreviation
// and a big number beside it. The big number is the side's IMPLIED TOTAL, but
// sitting next to a player's name it reads as that player's prop — sixteen cards
// of what looks like a QB projection, on a rail whose job is to say what the
// slate is. The two numbers a game actually has are the SPREAD and the TOTAL, so
// each side now carries its own side of the spread and the card foots with the
// total. The quarterbacks are still on the Games tab, on a card that is about a
// game rather than about the week.
//
// ── THE BIG NUMBER IS THE MODEL'S, AND THE LINE SITS BESIDE IT (2026-10-31) ──
// The implied totals that replaced the quarterbacks were still the LINE: the
// posted total split at the posted spread, so DAL 30.75 / ARI 23.75 summed to
// the 54.5 printed under them and the card could never disagree with the book.
// Like the NBA lab's slate, each side now shows its posted spread beside the
// engine's projected points, and the footer sets the posted O/U against the
// engine's total and the engine's spread against the posted one.
import { C, MON, readable, alpha } from "../lib/theme.js";
import { kickoff, sideSpread, spreadText, weekLabel } from "../lib/format.js";
import { gameStatus } from "../lib/gameStatus.js";
import { SectionLabel, TeamLogo } from "./ui.jsx";

// Status used to be `gameday < today` on the UTC date — which called every
// Sunday-night game FINAL at 8pm Eastern. The board passes its own clock-read
// statuses in so the slate and the table can never disagree about a game.
export function WeekSlate({ games, teams, week, selected, onSelect, statusOf, engine }) {
  if (!games.length) return null;
  const status = (g) => statusOf?.[g.game_id] ?? gameStatus(g);
  return (
    <div style={{ marginBottom: 14 }}>
      <SectionLabel
        right={selected && (
          <span style={{ fontSize: 9, color: C.accent, fontFamily: MON }}>
            · filtering {selected.away_team} @ {selected.home_team} —{" "}
            <span style={{ textDecoration: "underline", cursor: "pointer", color: C.muted }}
              onClick={() => onSelect(null)}>clear</span>
          </span>
        )}>
        {weekLabel(week)} Slate · {games.length} {games.length === 1 ? "Game" : "Games"}
      </SectionLabel>
      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
        {games.map((g) => (
          <SlateCard key={g.game_id} g={g} eng={engine?.byGame.get(g.game_id)} teams={teams} status={status(g)}
            active={selected?.game_id === g.game_id}
            onClick={() => onSelect(selected?.game_id === g.game_id ? null : g)} />
        ))}
      </div>
    </div>
  );
}

function SlateCard({ g, eng, teams, status, active, onClick }) {
  const final = status === "final";
  const live = status === "live";
  const total = g.total_line;
  // The big number is the ENGINE's score. Before the engine reached the slate it
  // was the implied team total — the line's own total split at the line's own
  // spread, which can only ever agree with the line and read as a model that
  // copied the book. A game the engine has not rated yet (a week past the next)
  // still shows that split, labelled as what it is.
  const pts = (side) => eng ? eng[`${side}_pts`] : g[`${side}_implied`];
  const fmt = (x) => (x == null ? null : eng ? x.toFixed(1) : x);
  const modelSpread = eng && (Math.abs(eng.margin) < 0.05 ? "PK"
    : `${eng.margin > 0 ? g.home_team : g.away_team} −${Math.abs(eng.margin).toFixed(1)}`);
  const marketSpread = spreadText(g)?.replace("-", "\u2212");
  const totalGap = eng && total != null ? eng.total - total : null;
  const wx = g.roof === "dome" || g.roof === "closed" ? "dome"
    : g.wind != null && g.wind >= 15 ? `${g.wind}mph wind`
    : g.temp != null ? `${g.temp}°` : "";
  return (
    <div onClick={onClick} className="row-hover" style={{
      background: active ? alpha(C.accent, 0.1) : C.panelDeep,
      border: `1px solid ${active ? alpha(C.accent, 0.55) : C.line}`,
      borderRadius: 8, overflow: "hidden", minWidth: 214, flexShrink: 0, cursor: "pointer",
      boxShadow: active ? `0 0 18px ${alpha(C.accent, 0.14)}` : `0 2px 8px ${alpha(C.shadow, 0.3)}`,
      transition: "border-color .15s, box-shadow .15s, opacity .15s",
      // A final game's props are off the board; its card stays so the week's shape
      // still reads, but steps back.
      opacity: final && !active ? 0.55 : 1,
    }}>
      <div style={{ padding: "5px 10px", borderBottom: `1px solid ${C.line}`, display: "flex",
        justifyContent: "space-between", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 10, fontFamily: MON, fontWeight: 700, whiteSpace: "nowrap" }}>
          <span style={{ color: final ? C.muted : live ? C.good : C.accent }}>
            {final ? "FINAL" : live ? "● LIVE" : kickoff(g.gameday, g.gametime)}
          </span>
          {wx && <span style={{ color: C.faint, fontWeight: 400 }}> · {wx}</span>}
        </span>
        <span style={{ fontSize: 9, color: C.faint, fontFamily: MON }}
          title={eng ? "The engine's projected score for each side" : "No engine score yet: each side's implied total at the posted line"}>
          {active ? <b style={{ color: C.accent }}>FILTERED</b> : eng ? "model" : "implied"}
        </span>
      </div>
      <div style={{ padding: "7px 10px" }}>
        {[["away", g.away_team], ["home", g.home_team]].map(([sideKey, abbr]) => {
          const hcap = sideSpread(g, sideKey);
          const p = fmt(pts(sideKey));
          // The favourite's own number is the negative one. Colouring it is
          // the fastest read on the card: who is laying the points.
          const fav = hcap != null && hcap.startsWith("\u2212");
          return (
            <div key={sideKey} style={{ display: "flex", alignItems: "center", padding: "3px 0", gap: 8 }}>
              <span style={{ width: 3, height: 20, borderRadius: 2, flexShrink: 0,
                background: readable(teams?.[abbr]?.color, 0.1) }} />
              <TeamLogo src={teams?.[abbr]?.logo} size={20} />
              <span style={{ fontSize: 12, fontWeight: 700, width: 34, color: readable(teams?.[abbr]?.color) }}>{abbr}</span>
              <span style={{ fontSize: 10, fontFamily: MON, color: fav ? C.txt : C.faint, flex: 1 }}
                title={hcap ? `${abbr} ${hcap === "PK" ? "pick'em" : hcap} on the posted spread` : undefined}>{hcap ?? ""}</span>
              {p != null && (
                <span style={{ fontSize: 14, fontWeight: 700, fontFamily: MON, color: C.txt }}
                  title={eng ? `${abbr}'s projected points from the game engine`
                    : `implied team total — ${abbr}'s half of the ${total ?? "?"} at this spread`}>{p}</span>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ padding: "4px 10px", borderTop: `1px solid ${C.lineSoft}`, fontSize: 9,
        color: C.muted, fontFamily: MON, display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span title={totalGap == null ? "the posted game total"
          : `The engine projects ${eng.total.toFixed(1)}, ${Math.abs(totalGap).toFixed(1)} ${totalGap >= 0 ? "over" : "under"} the posted ${total}`}>
          {total != null ? `O/U ${total}` : "no total"}
          {eng && <> · <span style={{ color: C.txt }}>proj {eng.total.toFixed(1)}</span></>}
        </span>
        {modelSpread && (
          <span title={`The engine's spread: ${modelSpread}. Posted: ${marketSpread ?? "none"}.`}>
            <span style={{ color: C.txt }}>proj {modelSpread}</span>
          </span>
        )}
      </div>
    </div>
  );
}
