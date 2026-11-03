// ── Design tokens ────────────────────────────────────────────────────────────
// The house design across the SchiffPicks labs, ported from the WNBA lab
// (wnba.schiffpicks.com). Single source of truth for the style system.
//
// TWO THEMES. Dark (the WNBA ground, the original) and Light (a bright card-on-
// slate look). The PALETTE VALUES live in src/index.css as CSS variables, one
// block per theme; `C` below maps names onto those variables, so every inline
// style re-themes the moment <html data-theme> flips, with no re-render.
// The dark block is the original palette value-for-value — switching back is
// the old app exactly.
//
// TWO EXPORTS MATTER:
//   C — color tokens (CSS var references), for the places that need a value
//   S — the style system: chrome (wrap/header/main), cards, tables, controls
//
// A var() cannot be string-concatenated with a hex alpha (`${C.good}22` is not a
// color), so translucency goes through alpha(), which works on a var, a hex or a
// readable() result alike. Prefer S.* over hand-rolled inline objects — a
// one-off `padding: "9px 12px"` in a component is how the old board drifted into
// five different table paddings.

const v = (name) => `var(--${name})`;

export const C = {
  bg: v("bg"),
  panel: v("panel"),              // card surface
  panelSolid: v("panel-solid"),   // same, opaque (dropdown options, popovers)
  panelDeep: v("panel2"),         // card headers, table headers — one step down
  deep: v("deep"),                // the solid behind strips and table heads, used through alpha()
  inset: v("inset"),              // wells: bars, expanded rows, sub-panels
  line: v("line"),
  lineSoft: v("line-soft"),       // row separators — a full line is too loud at row density
  txt: v("txt"),
  txt2: v("txt2"),                // body text one step under txt (menu items)
  sub: v("sub"),                  // inactive pill text
  muted: v("muted"),
  faint: v("faint"),
  faintest: v("faintest"),
  accent: v("accent"),
  accent2: v("accent2"),
  good: v("good"),
  bad: v("bad"),
  warn: v("warn"),
  purple: v("purple"),
  pink: v("pink"),
  gold: v("gold"),                // eyebrow labels
  shadow: v("shadow"),
};

/** `c` at opacity `a`. Works on a CSS var, a hex, or a readable() color. */
export const alpha = (c, a) => `color-mix(in srgb, ${c} ${+(a * 100).toFixed(2)}%, transparent)`;

// ── theme switching ──────────────────────────────────────────────────────────
// The choice is a per-viewer convenience, so it lives in localStorage; index.html
// applies it before first paint so a light-theme reload never flashes dark.
export const THEMES = ["light", "dark"];
export const DEFAULT_THEME = "light";
const THEME_KEY = "nfl-lab-theme";

export function savedTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return THEMES.includes(t) ? t : DEFAULT_THEME;
  } catch { return DEFAULT_THEME; }
}

export function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(THEME_KEY, t); } catch { /* private window: the toggle still works for the visit */ }
}

export const MON = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

// position → accent color. Drives the row rail on the board, the POS tag, and
// the leader strips, so a position reads the same everywhere.
export const POS_COLORS = { QB: v("pos-qb"), RB: v("pos-rb"), WR: v("pos-wr"), TE: v("pos-te"), FB: v("pos-rb") };

// coverage arsenal: [field, label, color]
export const COV_KEYS = [
  ["cover1_rate", "Cover 1", "#f87272"], ["cover3_rate", "Cover 3", "#7dd3fc"],
  ["cover2_rate", "Cover 2", "#4ade80"], ["cover4_rate", "Cover 4", "#c084fc"],
  ["cover6_rate", "Cover 6", "#f59e0b"], ["cover0_rate", "Cover 0", "#fb7185"],
  ["cover2man_rate", "2-Man", "#f472b6"],
];

// ── the style system ─────────────────────────────────────────────────────────
export const S = {
  // chrome
  wrap:    { minHeight: "100vh", background: C.bg, color: C.txt, position: "relative" },
  grid:    { position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0,
             backgroundImage: `linear-gradient(${alpha(C.accent, 0.025)} 1px, transparent 1px), linear-gradient(90deg, ${alpha(C.accent, 0.025)} 1px, transparent 1px)`,
             backgroundSize: "48px 48px" },
  glow:    { position: "fixed", top: 0, left: "50%", transform: "translateX(-50%)", width: "70%",
             height: 280, pointerEvents: "none", zIndex: 0,
             background: v("glow") },
  content: { position: "relative", zIndex: 1 },

  header:  { padding: "10px 16px", background: v("header-bg"), backdropFilter: "blur(12px)",
             borderBottom: `1px solid ${alpha(C.line, 0.6)}`, position: "sticky", top: 0, zIndex: 100 },
  hRow:    { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
             maxWidth: 1400, margin: "0 auto" },
  title:   { fontSize: 18, fontWeight: 700, color: C.accent, display: "flex", alignItems: "center",
             gap: 8, flexWrap: "wrap", lineHeight: 1.2 },
  subtitle:{ fontSize: 10, color: C.muted, fontFamily: MON, marginTop: 2 },
  main:    { padding: "12px 16px 64px", maxWidth: 1400, margin: "0 auto" },

  // "IN SEASON" / season chips in the header. `color:"live"` is the green variant.
  badge: (color = "#f59e0b") => ({
    fontSize: 9, padding: "2px 7px", borderRadius: 4, fontWeight: 700, letterSpacing: "0.04em",
    whiteSpace: "nowrap",
    background: color === "live" ? alpha(C.good, 0.15) : `linear-gradient(135deg,${color},${color}cc)`,
    color: color === "live" ? C.good : "#fff",
    border: color === "live" ? `1px solid ${alpha(C.good, 0.3)}` : "none",
  }),

  btn:     { display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px",
             background: alpha(C.accent, 0.08), border: `1px solid ${alpha(C.accent, 0.25)}`,
             borderRadius: 6, color: C.accent, cursor: "pointer", fontSize: 11, fontWeight: 500 },
  btnGhost:{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 11px",
             background: "transparent", border: `1px solid ${C.line}`, borderRadius: 6,
             color: C.muted, cursor: "pointer", fontSize: 11, fontWeight: 500 },

  // the header's status read (components/LabStatus.jsx) and the Model Refresh popover
  hStatus: { display: "flex", gap: 18, marginLeft: "auto", fontSize: 10, fontFamily: MON, color: C.muted,
             lineHeight: 1.5, whiteSpace: "nowrap", textAlign: "right" },
  popover: { position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 120, width: 280, padding: 14,
             background: C.panelSolid, border: `1px solid ${C.line}`, borderRadius: 10,
             boxShadow: `0 12px 32px ${alpha(C.shadow, 0.55)}`, textAlign: "left" },

  // top-level tab nav
  tabNav:  { display: "flex", gap: 4, marginBottom: 12, overflowX: "auto", paddingBottom: 4 },
  tabBtn:  (active) => ({
    padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: active ? 700 : 500,
    whiteSpace: "nowrap",
    // The active tab is its own token: a tint on dark, a solid accent pill on light.
    background: active ? v("tab-on-bg") : alpha(C.panelSolid, 0.6),
    border: `1px solid ${active ? v("tab-on-line") : C.line}`,
    color: active ? v("tab-on-fg") : C.muted,
  }),

  // cards
  card:     { background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, overflow: "hidden",
              marginBottom: 12, boxShadow: v("card-shadow") },
  cardHead: { padding: "10px 14px", background: C.panelDeep, borderBottom: `1px solid ${C.line}`,
              display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" },
  cardTitle:{ fontSize: 13, fontWeight: 600, color: C.txt, display: "flex", alignItems: "center", gap: 8 },
  cardMeta: { fontSize: 10, color: C.faint, fontFamily: MON },
  cardBody: { padding: 14 },
  inset:    { background: C.inset, border: `1px solid ${C.line}`, borderRadius: 8 },

  // the segmented strip that sits under a card head (prop type, trait, filter)
  propTabs: { display: "flex", gap: 3, padding: "8px 12px", background: alpha(C.deep, 0.6),
              borderBottom: `1px solid ${C.line}`, overflowX: "auto", alignItems: "center", flexWrap: "wrap" },
  propTab:  (active) => ({
    padding: "5px 14px", borderRadius: 5, cursor: "pointer", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
    background: active ? alpha(C.accent, 0.15) : "transparent",
    border: `1px solid ${active ? alpha(C.accent, 0.4) : C.line}`,
    color: active ? C.accent : C.sub,
  }),
  // compact variant for long runs of chips (the 18 week pills)
  chipTab: (active) => ({
    padding: "4px 9px", borderRadius: 5, cursor: "pointer", fontSize: 10, fontWeight: 700,
    fontFamily: MON, whiteSpace: "nowrap",
    background: active ? alpha(C.accent, 0.15) : "transparent",
    border: `1px solid ${active ? alpha(C.accent, 0.4) : C.line}`,
    color: active ? C.accent : C.muted,
  }),

  searchWrap: { padding: "8px 12px", borderBottom: `1px solid ${C.line}`, display: "flex", gap: 8,
                alignItems: "center", background: alpha(C.deep, 0.5), flexWrap: "wrap" },
  searchIn:   { flex: 1, minWidth: 160, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 5,
                padding: "5px 10px", color: C.txt, fontSize: 12, outline: "none" },
  select:     { background: C.bg, border: `1px solid ${C.line}`, borderRadius: 5, padding: "5px 8px",
                color: C.txt, fontSize: 11, cursor: "pointer", outline: "none" },

  // ── the filter bar (props.cash-style) ──────────────────────────────────────
  // A row of labelled dropdowns above the board: the label names the dimension,
  // the button says its current value, and the menu is a checklist. Replaced
  // three stacked pill strips that each cost a full row of height.
  filterBar:  { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 },
  filterLabel:{ fontSize: 9, color: C.faint, fontWeight: 700, textTransform: "uppercase",
                letterSpacing: "0.08em", marginBottom: 4, whiteSpace: "nowrap" },
  ddBtn: (changed) => ({
    display: "inline-flex", alignItems: "center", justifyContent: "space-between", gap: 10,
    minWidth: 118, padding: "7px 10px", borderRadius: 7, fontSize: 12, fontWeight: 600,
    background: changed ? alpha(C.accent, 0.1) : C.panel, color: changed ? C.accent : C.txt,
    border: `1px solid ${changed ? alpha(C.accent, 0.4) : C.line}`, whiteSpace: "nowrap",
  }),
  ddMenu:     { position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 60, minWidth: 210,
                maxHeight: 380, overflowY: "auto", padding: 4, background: C.panelSolid,
                border: `1px solid ${C.line}`, borderRadius: 8, boxShadow: `0 12px 32px ${alpha(C.shadow, 0.55)}` },
  ddItem: (selected, disabled) => ({
    display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 8px", borderRadius: 5,
    background: "transparent", border: "none", textAlign: "left", fontSize: 12,
    color: disabled ? C.faintest : selected ? C.txt : C.txt2, fontWeight: selected ? 600 : 400,
  }),
  ddSection:  { fontSize: 9, color: C.faint, fontWeight: 700, textTransform: "uppercase",
                letterSpacing: "0.08em", padding: "8px 8px 4px" },

  // tables — dense, monospace numerics, 9px uppercase headers
  tblWrap: { width: "100%", overflowX: "auto" },
  tbl:     { width: "100%", borderCollapse: "collapse" },
  th:      { padding: "8px 10px", fontSize: 9, color: C.faint, fontWeight: 600, textTransform: "uppercase",
             textAlign: "center", whiteSpace: "nowrap", background: alpha(C.deep, 0.7),
             borderBottom: `1px solid ${C.line}`, userSelect: "none" },
  thLeft:  { padding: "8px 12px", fontSize: 9, color: C.faint, fontWeight: 600, textTransform: "uppercase",
             textAlign: "left", background: alpha(C.deep, 0.7), borderBottom: `1px solid ${C.line}`,
             userSelect: "none" },
  td:      { padding: "9px 10px", fontSize: 12, textAlign: "center", borderBottom: `1px solid ${C.lineSoft}`,
             fontFamily: MON, whiteSpace: "nowrap" },
  tdLeft:  { padding: "9px 12px", fontSize: 12, textAlign: "left", borderBottom: `1px solid ${C.lineSoft}` },

  tag: (bg, color) => ({ display: "inline-block", fontSize: 9, padding: "1px 5px", borderRadius: 3,
                         background: bg, color, margin: "1px", fontWeight: 600, whiteSpace: "nowrap" }),

  // section label — the small uppercase caption above a strip
  sectionLabel: { fontSize: 9, color: C.faint, fontWeight: 700, textTransform: "uppercase",
                  letterSpacing: "0.08em", whiteSpace: "nowrap" },
};


// ── legibility ───────────────────────────────────────────────────────────────

const hex2rgb = (h) => {
  const s = String(h || "").replace("#", "");
  if (s.length !== 6) return null;
  const n = parseInt(s, 16);
  return Number.isNaN(n) ? null : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Relative luminance, the WCAG one — not a naive channel average. */
function luminance([r, g, b]) {
  const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** Green above +eps, red below −eps, muted between — for units, ROI, CLV. */
export const goodBad = (x, eps = 0) => (x == null ? C.muted : x > eps ? C.good : x < -eps ? C.bad : C.muted);

const toHex = (rgb) => `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;

/**
 * A team color that is actually legible on the ground — in either theme.
 *
 * Half the league's primary is navy or black — SEA #002244, NE #002244,
 * CHI #0B162A — and painting an abbreviation in those on #0f1923 renders it
 * invisible, which is exactly what the first pass of the slate strip did. On
 * the light ground the failure flips: PIT's gold and the Chargers' powder blue
 * wash out on white.
 *
 * So two versions are computed — lifted toward white until it clears `floor`,
 * and pressed toward black until it is under a ceiling — and CSS light-dark()
 * picks between them by the page's color-scheme (index.css sets it per theme).
 * A theme flip therefore re-colors every team mark with no re-render. A color
 * already legible in a theme is returned untouched for it.
 */
export function readable(hex, floor = 0.22) {
  const rgb = hex2rgb(hex);
  if (!rgb) return C.txt;
  // Blend in steps rather than solving for it: cheap, stable, and it preserves
  // hue better than clamping lightness in HSL for dark navies.
  let lift = rgb;
  for (let i = 0; i < 12 && luminance(lift) < floor; i++) lift = lift.map((c) => Math.round(c + (255 - c) * 0.18));
  // A low floor is a fill (the slate's team rail), where the raw color is the
  // point; text wants WCAG-ish contrast against white.
  const ceiling = floor >= 0.2 ? 0.2 : 0.6;
  let press = rgb;
  for (let i = 0; i < 12 && luminance(press) > ceiling; i++) press = press.map((c) => Math.round(c * 0.85));
  return `light-dark(${toHex(press)}, ${toHex(lift)})`;
}


/**
 * Heat-map fill for a value in [0, 1], centred on 0.5: red below, green above,
 * transparent at the middle. The hit-rate and diff cells, after props.cash —
 * but as a translucent wash over the ground rather than a pastel block,
 * so the numbers stay the brightest thing in the cell. `weak` halves the
 * strength for a cell whose sample is too thin to shout about.
 */
export function heat(x, weak = false) {
  if (x == null || !Number.isFinite(x)) return undefined;
  const d = Math.max(-1, Math.min(1, (x - 0.5) * 2));
  const a = Math.abs(d) * (weak ? 0.2 : 0.4);
  if (a < 0.03) return undefined;
  return alpha(d > 0 ? v("heat-good") : v("heat-bad"), a);
}
