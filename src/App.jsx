import { useCallback, useEffect, useState } from "react";
import { loadSeason } from "./lib/loadData.js";
import { hasPlayerPriors } from "./lib/playerPriors.js";
import { S, C } from "./lib/theme.js";
import { Empty } from "./components/ui.jsx";
import { Header } from "./components/Header.jsx";
import { PlayerPanel } from "./components/PlayerPanel.jsx";
import { Board } from "./components/Board.jsx";
import { Results } from "./components/Results.jsx";
import { MatchupLab } from "./components/MatchupLab.jsx";
import { Games } from "./components/Games.jsx";
import { OfficialPlays } from "./components/OfficialPlays.jsx";
import { Defenses } from "./components/Defenses.jsx";
import { SnapCounts } from "./components/SnapCounts.jsx";

// The season the board is built on. Keep in sync with CURRENT in scripts/etl.py.
// Flipping this is the whole season change: player baselines come from
// src/lib/playerPriors.js and team baselines from src/lib/teamPriors.js, both of
// which key on the season and return null for years they have no priors for.
const SEASON = 2026;

function useData(season) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [at, setAt] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setBusy(true);
    return loadSeason(season)
      .then((x) => { setD(x); setErr(null); setAt(new Date()); })
      .catch((e) => setErr(e.message || String(e)))
      .finally(() => setBusy(false));
  }, [season]);

  // The fetch-on-mount that fills the whole board. `load` flips `busy` before it
  // awaits, which is the synchronous setState the rule is looking for — but the
  // effect IS the external-system subscription here (Supabase → React), not a
  // render-triggered state sync, so there is nothing to hoist out of it.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);
  return { d, err, at, busy, reload: load };
}

// ── shell ────────────────────────────────────────────────────────────────────
// Sacks had a tab and no longer do: the sack market is a prop on the Board, in
// the Props dropdown beside every other market (src/lib/props.js, sackRows.js).
// A second board for one market is what kept it out of the pick ledger and off
// the Results tab, and gave it its own week picker to disagree with.
// Official Plays sits beside the Board: the Board grades every priced row, the
// card is the subset the engine stands behind, and "what are the plays" should
// not need a filter to answer.
const TABS = [["board", "Board"], ["official", "Official Plays"], ["lab", "Matchup Lab"], ["games", "Games"],
  ["defenses", "Defenses"], ["snaps", "Snaps"], ["results", "Results"]];

export default function App() {
  const { d, err, at, busy, reload } = useData(SEASON);
  const [tab, setTab] = useState("board");
  const [drill, setDrill] = useState(null); // Board → player drill-in
  const flipped = hasPlayerPriors(SEASON);

  // A season with carried baselines is "in season"; a completed one is the
  // offseason build. The header badge says which, so a projection is never
  // mistaken for a measurement.
  const source = flipped
    ? `${SEASON} season · baselines carried from ${SEASON - 1}, weaning onto live data as games are played`
    : `${SEASON} usage & efficiency vs each defense's coverage / box / pressure scheme`;

  return (
    <div style={S.wrap}>
      <div style={S.grid} />
      <div style={S.glow} />

      <div style={S.content}>
        <Header season={SEASON} status={flipped ? "live" : "offseason"} source={source}
          loadedAt={at} onReload={reload} busy={busy} />

        <main style={S.main}>
          <nav style={S.tabNav}>
            {TABS.map(([k, l]) => (
              <button key={k} onClick={() => { setTab(k); setDrill(null); }} style={S.tabBtn(tab === k)}>{l}</button>
            ))}
          </nav>

          {err && !d && (
            <Empty>
              <div style={{ marginBottom: 10 }}>Couldn’t load the season data.</div>
              <div style={{ fontSize: 11, color: "var(--faint)", fontFamily: "var(--mono)", marginBottom: 12 }}>{err}</div>
              <button style={S.btn} onClick={reload} disabled={busy}>
                {busy ? "Retrying…" : "↻ Try again"}
              </button>
            </Empty>
          )}
          {!err && !d && <Empty>Loading season data…</Empty>}
          {err && d && (
            <div style={{ ...S.card, padding: "8px 14px", marginBottom: 12, fontSize: 11, color: C.warn }}>
              Refresh failed — showing the last data that loaded. <span style={{ color: C.faint }}>{err}</span>
            </div>
          )}
          {d && (
            <div className="fade-in">
              {tab === "board" && !drill && <Board d={d} onPick={setDrill} />}
              {tab === "board" && drill && (
                <div className="fade-in">
                  <button onClick={() => setDrill(null)} style={{ ...S.btnGhost, marginBottom: 12 }}>← back to board</button>
                  <PlayerPanel d={d} playerId={drill.player_id} oppAbbr={drill.opp} game={drill.game} side={drill.side} />
                </div>
              )}
              {tab === "official" && <OfficialPlays season={SEASON} d={d} />}
              {tab === "lab" && <MatchupLab d={d} />}
              {tab === "games" && <Games d={d} />}
              {tab === "defenses" && <Defenses d={d} />}
              {tab === "snaps" && <SnapCounts d={d} />}
              {tab === "results" && <Results season={SEASON} d={d} />}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
