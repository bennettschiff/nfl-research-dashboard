// ── A clickable price ────────────────────────────────────────────────────────
// One book's price for one prop. Tapping it opens that book's bet slip with the
// outcome already on it — the native share sheet on a phone (AirDrop, Messages,
// Copy), a Copy | Open popover everywhere else.
//
// Ported from the MLB lab's src/components/OddsLink.jsx and repainted in house
// colours. The popover is plain DOM (document.createElement) rather than React
// state, for the reason the MLB one is: the board re-renders on every sort,
// filter and week change, and a popover living in a row's component tree
// disappears the moment anything above it moves.
//
// WHAT MAKES A CELL CLICKABLE. Only a real bet-slip URL (src/lib/betslip.js).
// A book with no link is rendered as plain text — dropping a reader on a
// sportsbook's homepage when they tapped a specific price is worse than not
// being tappable, because they will believe they are on the bet.
import { C, MON, readable, alpha } from "../lib/theme.js";
import { BOOK_COLORS, BOOK_NAMES, BOOK_ABBR } from "../lib/betslip.js";
import { fmtOdds } from "../lib/format.js";

const POPUP_ID = "odds-popup";

// Module-private, all of it: this file exports components and nothing else, or
// fast refresh stops working for the board (react-refresh/only-export-components).
let teardown = null;

function dismissOddsPopup() {
  document.getElementById(POPUP_ID)?.remove();
  teardown?.();
  teardown = null;
}

function toast(text) {
  document.getElementById("betslip-toast")?.remove();
  const el = document.createElement("div");
  el.id = "betslip-toast";
  el.textContent = text;
  Object.assign(el.style, {
    position: "fixed", bottom: "28px", left: "50%", transform: "translateX(-50%)",
    background: C.panelSolid, color: C.txt, border: `1px solid ${C.line}`,
    padding: "9px 18px", borderRadius: "8px", fontSize: "12px", fontWeight: "600",
    zIndex: "99999", pointerEvents: "none", boxShadow: `0 8px 28px ${alpha(C.shadow, 0.45)}`,
    opacity: "1", transition: "opacity 0.4s ease",
  });
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; }, 1700);
  setTimeout(() => el.remove(), 2200);
}

function popover(url, bookName, anchor) {
  dismissOddsPopup();
  const pop = document.createElement("div");
  pop.id = POPUP_ID;
  Object.assign(pop.style, {
    position: "fixed", width: "162px", zIndex: "99999",
    background: C.panelSolid, border: `1px solid ${C.line}`, borderRadius: "10px",
    padding: "8px 10px", display: "flex", flexDirection: "column", gap: "6px",
    boxShadow: `0 12px 36px ${alpha(C.shadow, 0.5)}`,
  });

  const label = document.createElement("div");
  label.textContent = bookName;
  Object.assign(label.style, {
    fontSize: "9px", fontWeight: "700", letterSpacing: "0.06em",
    color: C.faint, textTransform: "uppercase",
  });

  const button = (text, color, onClick) => {
    const b = document.createElement("button");
    b.textContent = text;
    Object.assign(b.style, {
      padding: "6px 0", fontSize: "12px", fontWeight: "600", borderRadius: "6px",
      cursor: "pointer", border: `1px solid ${alpha(color, 0.4)}`, background: alpha(color, 0.122), color,
      fontFamily: "inherit",
    });
    b.onclick = (e) => { e.stopPropagation(); onClick(); dismissOddsPopup(); };
    return b;
  };

  pop.append(
    label,
    button("Open", C.good, () => window.open(url, "_blank", "noopener,noreferrer")),
    button("Copy link", C.accent, () => {
      try { navigator.clipboard.writeText(url); } catch { /* clipboard blocked — the Open button still works */ }
      toast(`${bookName} bet slip copied`);
    }),
  );
  document.body.appendChild(pop);

  const r = anchor?.getBoundingClientRect();
  if (r) {
    const left = Math.max(8, Math.min(r.left + r.width / 2 - pop.offsetWidth / 2,
      window.innerWidth - pop.offsetWidth - 8));
    const above = r.top - pop.offsetHeight - 8;
    pop.style.left = `${left}px`;
    pop.style.top = `${above < 8 ? r.bottom + 8 : above}px`;
  } else {
    Object.assign(pop.style, { left: "50%", top: "50%", transform: "translate(-50%,-50%)" });
  }

  // Dismiss on the NEXT click anywhere, and on any scroll — the popover is
  // position:fixed against a table row, so a scroll leaves it pointing at
  // nothing. `capture` catches the board's own scroll container, not just the
  // window. Deferred a tick so the click that opened it does not close it.
  const close = () => dismissOddsPopup();
  teardown = () => {
    document.removeEventListener("click", close);
    window.removeEventListener("scroll", close, true);
  };
  setTimeout(() => {
    document.addEventListener("click", close, { once: true });
    window.addEventListener("scroll", close, { once: true, capture: true });
  }, 0);
}

function openBetslip(e, url, book) {
  e.preventDefault();
  e.stopPropagation();
  const name = BOOK_NAMES[book] || book;
  if (typeof navigator.share === "function") {
    // The native sheet must be opened inside the click gesture or the browser
    // blocks it; a rejection is the user cancelling, not a failure.
    navigator.share({ title: `${name} bet slip`, url }).catch(() => {});
  } else {
    popover(url, name, e.currentTarget);
  }
}

/**
 * One book's price.
 *
 * @param p     the per-book record from priceAgainstMarket().books[book]
 * @param book  the Odds API bookmaker key
 * @param best  true when this is the row's best price on its own line
 * @param refLine  the row's reference line, so an off-line book can say so
 * @param lineText how a line reads on this market — "o44.5" for a prop (the
 *                 default), "+2.5" for a spread, "u20.5" for a team-total under
 */
export function OddsCell({ p, book, best, refLine, lineText = (l) => `o${l}` }) {
  if (!p) return <span style={{ color: C.faintest }}>—</span>;
  // Brand colour through readable(), the same rule the team colours follow
  // (CLAUDE.md): FanDuel's #2062c8 is a navy on a navy ground and DraftKings'
  // #0f8a44 is not much better. readable() lifts them until they clear a
  // luminance floor while holding the hue, so a price still reads as its book's
  // colour and can also actually be read.
  const brand = BOOK_COLORS[book] ? readable(BOOK_COLORS[book]) : C.muted;
  const clickable = !!p.url;

  const title =
    `${BOOK_NAMES[book] || book} — ${p.line == null ? "" : `${lineText(p.line)} `}at ${fmtOdds(p.overOdds)}`
    + (p.offLine ? `\nDifferent line from the row (${lineText(refLine)}), so it is a different bet and cannot be the best price.` : "")
    + (best ? "\nBest price on this line." : "")
    + `\nmodel ${(p.modelProb * 100).toFixed(1)}% vs book ${(p.mktProb * 100).toFixed(1)}%`
    + (p.rawProb != null && Math.abs(p.rawProb - p.modelProb) >= 0.0005
      ? ` (calibrated to the price; the projection alone says ${(p.rawProb * 100).toFixed(1)}%)` : "")
    + (p.devigged ? " (de-vigged)" : " (one-sided market — the hold is still in it)")
    + (clickable ? "\nTap for the bet slip." : "\nThis book posted no bet-slip link.");

  return (
    <span
      title={title}
      onClick={clickable ? (e) => openBetslip(e, p.url, book) : undefined}
      style={{
        display: "inline-flex", flexDirection: "column", alignItems: "center", lineHeight: 1.25,
        cursor: clickable ? "pointer" : "default",
        padding: best ? "1px 6px" : "1px 0", borderRadius: 4,
        background: best ? alpha(brand, 0.15) : "transparent",
        border: `1px solid ${best ? alpha(brand, 0.4) : "transparent"}`,
      }}>
      <span style={{
        fontFamily: MON, fontSize: 11.5, fontWeight: best ? 700 : 500,
        color: best ? brand : C.muted,
      }}>
        {fmtOdds(p.overOdds)}
      </span>
      {/* Only shown when this book is NOT on the row's line — otherwise the Line
          column already says it and repeating it on three cells is noise. */}
      {p.offLine && (
        <span style={{ fontFamily: MON, fontSize: 8.5, color: C.warn }}>{lineText(p.line)}</span>
      )}
    </span>
  );
}

/** The column header mark: the book's abbreviation in its own brand colour. */
export function BookHead({ book }) {
  const c = BOOK_COLORS[book];
  return <span style={{ color: c ? readable(c) : "inherit" }}>{BOOK_ABBR[book] || book}</span>;
}
