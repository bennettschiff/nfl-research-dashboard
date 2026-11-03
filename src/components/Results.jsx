// ── Results tab ──────────────────────────────────────────────────────────────
// The scoreboard for the pick ledger. Every pick the board priced is frozen
// before kickoff and graded after the game (src/lib/pickLedger.js), so this is
// the model's actual record — not a list of picks someone remembered to save.
//
// READ TOP TO BOTTOM, ONE QUESTION A ROW:
//   1. Which book of record?   the ERA switch — since the baseline (default),
//      today's rules over the whole season, the full season as frozen, or the
//      weeks before it. The 2026-10-07 audit changed what a pick is
//      (pickLedger.js BASELINE), so a frozen total across it describes neither;
//      "Today's rules" is the one season-long book, because it re-scores the
//      pre-fix weeks from their frozen inputs under the rules that run now
//      (src/lib/rescore.js) — hindsight on the RULE, never on the inputs, and
//      never folded into the official record.
//   2. Is it winning?          two headline records, the OFFICIAL card and every
//      graded pick, side by side. Clicking one points everything below at it.
//   3. Week by week.           both records per week; a week unfolds into its
//      record per prop, and a prop row points the pick list at that week × prop.
//   4. Where is it winning?    one record per market / side / position / … ranked
//      by units, every group listed (empty ones too); a row click filters the
//      pick list to it.
//   5. The picks.              their own Week / Prop / Side / Player filters, then
//      Won / Lost / Pending pills. Those filters narrow the LIST only — the
//      records above always describe the whole era and card.
//   6. Diagnostics, folded.    CLV, Brier, calibration, the prop × confidence
//      matrix and the official card's earn-in ladder — the audit view, kept, but
//      out of the way of someone who opened the tab to see if it won.
//
// TWO RECORDS. The ledger grades every pick; the OFFICIAL card is the subset the
// engine stands behind (src/lib/officialPicks.js), stamped before kickoff. A retro
// card — the rule applied to a week frozen before it existed — is its own record
// and never folded into the official one.
//
// The headline is the LIVE ledger only. Backfilled games were priced after the
// fact with later model code; they are one filter away (Diagnostics → Ledger)
// but never mixed in by default.
import { useEffect, useMemo, useRef, useState } from "react";
import { loadPicks } from "../lib/picks.js";
import { summarize, calibration, BASELINE, inBaseline } from "../lib/pickLedger.js";
import { marketStanding, isOfficialCard, isOfficialRetro } from "../lib/officialPicks.js";
import { loadRescored, underTodaysRules } from "../lib/rescoreView.js";
import { cmp } from "../lib/boardSort.js";
import { isOneSided } from "../lib/props.js";
import { S, C, MON, goodBad, alpha } from "../lib/theme.js";
import { pct, pct1, units } from "../lib/format.js";
import { Empty, StatTile } from "./ui.jsx";
import { Dropdown } from "./FilterBar.jsx";
import { WeeklyRecord, TierPropMatrix, MarketStanding } from "./ResultsTables.jsx";
import { RecordCard, Breakdown } from "./ResultsSummary.jsx";
import { PicksTable } from "./ResultsPicks.jsx";

const ERAS = [
  { key: "since", label: "Since the fix", sub: `Week ${BASELINE.week} on`, keep: inBaseline },
  { key: "rules", label: "Today's rules", sub: "Every week, re-scored", keep: () => true },
  { key: "season", label: "Full season", sub: "Every week, as frozen", keep: () => true },
  { key: "before", label: "Before the fix", sub: `Weeks 1–${BASELINE.week - 1}`, keep: (p) => !inBaseline(p) },
];
const SOURCES = [
  ["auto", "Live", "Frozen before kickoff — the record"],
  ["backfill", "Backfill", "Games played before the ledger existed, priced at their close"],
  ["manual", "Hand-tracked", "Saved from a projection card at the model's own line"],
];
// "official" is isOfficialLive in every view but Today's rules, the only one
// holding re-scored rows (officialPicks.js isOfficialCard).
const CARD_OF = { all: () => true, official: isOfficialCard, retro: isOfficialRetro };
const TIER_LABEL = { high: "High conf", medium: "Med conf", low: "Low conf" };
/** The pick list's filters (applied in ResultsPicks.jsx); q is the player search. */
const NO_PICK_FILTERS = { week: null, prop: null, side: null, pos: null, tier: null, q: "" };

const signedPts = (x) => (x == null ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}`);
const wl = (s) => `${s.win}–${s.loss}${s.push ? `–${s.push}` : ""}`;

// What the Beat Close tile can honestly claim. A pick priced at the close itself
// (pickLedger.js closeIsCapture) is not a tie with the market — there was no
// later price — so it is named, never folded into "unmoved".
const closeSub = (r) => {
  const atClose = r.atClose ? `${r.atClose} priced at the close` : null;
  if (r.clvN) return [`avg CLV ${signedPts(r.avgClv)} pts`, `${r.clvN - r.clvBeat - r.clvLost} unmoved`, atClose].filter(Boolean).join(" · ");
  return atClose ? `${atClose} · no later price` : "no same-line closes";
};


export function Results({ season, d }) {
  const [picks, setPicks] = useState(null);
  const [rescored, setRescored] = useState(null);
  const [err, setErr] = useState(null);
  const [era, setEra] = useState("since");
  const [source, setSource] = useState("auto");
  const [card, setCard] = useState("official");
  const [f, setF] = useState(NO_PICK_FILTERS);
  const [resultF, setResultF] = useState("all");
  const [diag, setDiag] = useState(false);
  const [diagTier, setDiagTier] = useState(null);
  const picksRef = useRef(null);

  // The fetch-on-mount for the ledger; same shape as App's useData.
  useEffect(() => { loadPicks({ season }).then(setPicks).catch((e) => setErr(e.message || String(e))); }, [season]);
  // The re-scored weeks are a bundled file, fetched the first time the view opens.
  useEffect(() => {
    if ((era !== "rules" && !diag) || rescored) return;
    loadRescored(season).then((r) => setRescored(r || { picks: null })).catch((e) => setErr(e.message || String(e)));
  }, [era, diag, season, rescored]);

  const eraDef = ERAS.find((e) => e.key === era);
  const ledger = useMemo(() => {
    const rows = era === "rules" ? underTodaysRules(picks || [], rescored) : (picks || []);
    return rows.filter((p) => p.source === source);
  }, [picks, source, era, rescored]);
  const inEra = useMemo(() => ledger.filter(eraDef.keep), [ledger, eraDef]);
  const weeks = useMemo(() => [...new Set(inEra.map((p) => p.week).filter((w) => w != null))].sort((a, b) => a - b), [inEra]);

  // The headline cards and the weekly table read the whole era, because they
  // show the official card and every pick side by side. Everything below them
  // reads the record that is selected; the pick list's own filters apply inside
  // PicksTable, and the Confidence filter only to the diagnostics it sits in.
  const scoped = useMemo(() => inEra.filter(CARD_OF[card]), [inEra, card]);
  const diagPicks = useMemo(() => (diagTier ? scoped.filter((p) => p.conf_tier === diagTier) : scoped), [scoped, diagTier]);

  const recAll = useMemo(() => summarize(inEra), [inEra]);
  const recOff = useMemo(() => summarize(inEra.filter(isOfficialCard)), [inEra]);
  const recRetro = useMemo(() => summarize(inEra.filter(isOfficialRetro)), [inEra]);
  const rec = useMemo(() => summarize(diagPicks), [diagPicks]);
  const cal = useMemo(() => calibration(diagPicks), [diagPicks]);
  // The earn-in ladder reads the whole live ledger, never a filtered slice, and
  // reads it the way scripts/snapshot_picks.mjs does: the pre-baseline weeks as
  // today's rules re-score them. Until the re-scored file has loaded (it is
  // fetched with the diagnostics) it reads the frozen rows.
  const standing = useMemo(() => marketStanding(underTodaysRules(picks || [], rescored)), [picks, rescored]);

  if (err) return (
    <Empty>
      <div style={{ marginBottom: 8 }}>Couldn’t load the pick ledger.</div>
      <div style={{ fontSize: 11, color: C.faint, fontFamily: MON }}>{err}</div>
    </Empty>
  );
  if (!picks || (era === "rules" && !rescored)) return <Empty>Loading picks…</Empty>;
  if (!picks.length) return (
    <Empty>
      <div style={{ marginBottom: 8 }}>No picks recorded yet.</div>
      <div style={{ fontSize: 12 }}>
        The ledger fills itself: every priced board row is frozen before kickoff by the odds pull and graded the
        morning after.
      </div>
    </Empty>
  );

  const setFilter = (k, v) => setF((x) => ({ ...x, [k]: v }));
  // A row click upstream is "show me those picks": it replaces the list's
  // filters with just that one, shows every result, and scrolls to the list.
  const showPicks = (next) => {
    setF({ ...NO_PICK_FILTERS, ...next });
    setResultF("all");
    picksRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const sel = card === "all" ? recAll : card === "retro" ? recRetro : recOff;
  const headline = sel.win + sel.loss
    ? `${card === "all" ? "All picks" : card === "retro" ? "Retro card" : "Official card"} ${wl(sel)}, ${sel.staked ? units(sel.profit) : "no units"}`
    : "Nothing graded in this view yet";

  return (
    <div>
      {/* ── heading + era ─────────────────────────────────────────────────── */}
      <div style={{ ...S.card, padding: "18px 20px 16px", marginBottom: 14 }}>
        <div style={{ ...S.sectionLabel, color: C.gold, fontSize: 10, letterSpacing: "0.14em" }}>
          {season} results · {eraDef.label.toLowerCase()}
        </div>
        <div style={{ fontSize: 24, fontWeight: 800, margin: "6px 0 6px", lineHeight: 1.2 }}>{headline}</div>
        <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.55, maxWidth: 860 }}>
          {era === "rules"
            ? <>Every week as the engine is tuned today. Weeks 1–{BASELINE.week - 1} are re-scored from the numbers frozen
              on each pick before kickoff (the projection, the spread and every book's price) under the rules that
              started week {BASELINE.week}: Win% calibrated to the price, the side that calibration picks, anytime TD and
              sacks only when the Yes is +EV, sack rungs priced as the book settles them, and the official card as week{" "}
              {BASELINE.week} ran it (passing and rushing yards; receiving-yards unders benched). That is hindsight on the
              rules, not on the inputs, so it is a test of today's engine on those weeks — never part of the official
              record. Week {BASELINE.week} on is the record as frozen.</>
            : era === "before"
            ? <>Weeks 1–{BASELINE.week - 1}, graded under the old rules: every anytime-TD and sack Yes was booked as a
              bet, sack rungs were priced one rung too generous, and Win% was the model alone. Kept for the record, not
              for judging the model as it runs today.</>
            : <>On {new Date(`${BASELINE.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })} the
              grading changed: anytime TD and sacks are only bet when the price is +EV, sack rungs are priced as the
              book settles them, Win% is calibrated to the price, and CLV measures a later close. Week {BASELINE.week} is
              the first week under those rules{era === "season" ? " — this view mixes both" : ", so this is the baseline"}.</>}
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 14, flexWrap: "wrap" }}>
          {ERAS.map((e) => (
            <button key={e.key} type="button" onClick={() => { setEra(e.key); setF(NO_PICK_FILTERS); setResultF("all"); }}
              style={{ ...S.tabBtn(era === e.key), borderRadius: 999, padding: "8px 16px", fontSize: 12 }}>
              {e.label} <span style={{ opacity: 0.7, fontWeight: 500, marginLeft: 4 }}>{e.sub}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── the two records ───────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <RecordCard title="Official card" s={recOff} active={card === "official"} onClick={() => setCard("official")}
          blurb={era === "rules"
            ? `Week ${BASELINE.week} on as stamped before kickoff; weeks 1–${BASELINE.week - 1} as today's rule would have carded them.`
            : "The picks the engine stands behind, stamped before kickoff — what gets bet."}
          foot={recRetro.n > 0 && (
            <div style={{ fontSize: 10.5, color: C.purple, marginTop: 6 }}
              onClick={(e) => { e.stopPropagation(); setCard("retro"); }}
              title="The official rule applied to weeks frozen before it existed — never part of the official record">
              + retro {wl(recRetro)}, {units(recRetro.profit)} (not counted) {card === "retro" ? "● showing" : "→ show"}
            </div>
          )} />
        <RecordCard title="All picks" s={recAll} active={card === "all"} onClick={() => setCard("all")} tone={C.sub}
          blurb="Every priced row the board graded — the model's full record, high conviction or not." />
      </div>

      <WeeklyRecord picks={inEra} onProp={(week, prop) => showPicks({ week, prop })} />

      <div style={{ marginBottom: 12 }}>
        <Breakdown picks={scoped} universe={inEra} isOneSided={isOneSided} active={f} cmp={cmp}
          emptyNote={card === "all" ? "no picks" : "none on the card"}
          records={[["official", "Official card"], ["all", "All picks"], ...(card === "retro" ? [["retro", "Retro card"]] : [])]}
          record={card} onRecord={setCard}
          onPick={(k, v) => (v == null ? setFilter(k, null) : showPicks({ [k]: v }))} />
      </div>

      <PicksTable picks={scoped} f={f} setFilter={setFilter} onClear={() => setF(NO_PICK_FILTERS)} weeks={weeks}
        resultF={resultF} onResult={setResultF} d={d} cardRef={picksRef} />

      {/* ── diagnostics ───────────────────────────────────────────────────── */}
      <div style={{ ...S.card, marginBottom: 0 }}>
        <button type="button" onClick={() => setDiag((d) => !d)}
          style={{ ...S.cardHead, width: "100%", border: "none", borderBottom: diag ? `1px solid ${C.line}` : "none", cursor: "pointer", color: C.txt, fontFamily: "inherit" }}>
          <span style={S.cardTitle}>{diag ? "▾" : "▸"} Model diagnostics</span>
          <span style={S.cardMeta}>closing-line value · calibration · prop × confidence · official ladder · ledger source</span>
        </button>
        {diag && (
          <div style={{ padding: 14, background: alpha(C.deep, 0.15) }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
              <Dropdown label="Ledger" selected={source} changed={source !== "auto"} display={SOURCES.find((s) => s[0] === source)[1]}
                onChange={setSource}
                options={SOURCES.map(([value, label, title]) => ({ value, label, title,
                  sub: `${(picks || []).filter((p) => p.source === value).length}` }))} />
              <Dropdown label="Confidence" selected={diagTier ?? "ALL"} changed={diagTier != null}
                display={diagTier == null ? "All" : TIER_LABEL[diagTier]}
                onChange={(v) => setDiagTier(v === "ALL" ? null : v)}
                options={[{ value: "ALL", label: "All" }, { value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }]} />
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <StatTile label="Beat Close" v={rec.beatClose == null ? "—" : pct(rec.beatClose)} sub={closeSub(rec)}
                color={rec.beatClose == null ? null : rec.beatClose >= 0.5 ? C.good : C.bad} />
              <StatTile label="Avg CLV" v={rec.avgClv == null ? "—" : `${signedPts(rec.avgClv)} pts`}
                color={rec.avgClv == null ? null : goodBad(rec.avgClv)} sub={`${rec.clvN} picks with a later close`} />
              <StatTile label="Brier" v={rec.brier == null ? "—" : rec.brier.toFixed(3)} sub="win% vs result · lower is better" />
            </div>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(min(340px, 100%), 1fr))", marginBottom: 12 }}>
              <Calibration cal={cal} />
              <MarketStanding standing={standing} />
            </div>
            <TierPropMatrix picks={diagPicks} />
          </div>
        )}
      </div>
    </div>
  );
}

function Calibration({ cal }) {
  return (
    <div style={{ ...S.card, marginBottom: 0 }}>
      <div style={S.cardHead}>
        <div style={S.cardTitle}>Calibration</div>
        <span style={S.cardMeta}>does a 60% call win 60%?</span>
      </div>
      {cal.length === 0 ? (
        <div style={{ padding: 20, textAlign: "center", color: C.muted, fontSize: 12 }}>Nothing graded in this slice yet.</div>
      ) : (
        <div style={S.tblWrap}>
          <table style={S.tbl}>
            <thead><tr>
              <th style={S.thLeft}>Model band</th><th style={S.th}>Picks</th><th style={S.th}>Model</th>
              <th style={S.th}>Actual</th><th style={S.th}>Gap</th>
            </tr></thead>
            <tbody>
              {cal.map((b) => {
                const gap = b.actual - b.expected;
                return (
                  <tr key={b.lo} className="row-hover">
                    <td style={{ ...S.tdLeft, fontFamily: MON, fontSize: 11 }}>{pct(b.lo)}–{pct(b.hi)}</td>
                    <td style={{ ...S.td, color: b.n < 10 ? C.faint : C.txt }}>{b.n}</td>
                    <td style={S.td}>{pct1(b.expected)}</td>
                    <td style={{ ...S.td, fontWeight: 700 }}>{pct1(b.actual)}</td>
                    <td style={{ ...S.td, color: b.n < 10 ? C.faint : goodBad(gap, 0.03) }}>{signedPts(gap)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
