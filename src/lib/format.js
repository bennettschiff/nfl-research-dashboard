// ── Formatting helpers ───────────────────────────────────────────────────────
// Pure presentation. Shared across all components.

export const fmtOdds = (o) => (o == null ? "—" : o > 0 ? `+${o}` : `${o}`);
export const pct = (p) => (p == null ? "—" : `${(p * 100).toFixed(0)}%`);
export const pct1 = (p) => (p == null ? "—" : `${(p * 100).toFixed(1)}%`);
// betting record: units on a 1u stake, and return on stake
export const units = (u) => (u == null ? "—" : `${u >= 0 ? "+" : ""}${u.toFixed(2)}u`);
export const roiTxt = (r) => (r == null ? "—" : `${r >= 0 ? "+" : ""}${(r * 100).toFixed(1)}%`);

// signed percentage delta from a multiplier (1.07 → "+7%")
export function multPct(m) {
  if (m == null) return "—";
  const d = (m - 1) * 100;
  return `${d >= 0 ? "+" : ""}${d.toFixed(0)}%`;
}

// color for a multiplier delta (good if >1, bad if <1, muted near neutral)
export function multColor(m) {
  if (m == null) return "var(--muted)";
  const d = (m - 1) * 100;
  return d > 1 ? "var(--good)" : d < -1 ? "var(--bad)" : "var(--muted)";
}

export const lastName = (full) => (full ? full.split(" ").slice(-1)[0] : "?");
export const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

// ── labels ───────────────────────────────────────────────────────────────────

/** Compact prop labels for dense tables. Falls back to the model's own label. */
export const PROP_SHORT = {
  rec_yards: "REC YDS", rush_yards: "RUSH YDS", pass_yards: "PASS YDS",
  receptions: "REC", rush_att: "CAR", completions: "CMP",
  pass_tds: "PASS TD", anytime_td: "ANY TD", def_sacks: "SACKS",
  spread: "SPREAD", total: "TOTAL", moneyline: "MONEYLINE", team_total: "TEAM TOTAL",
};
export const propShort = (type, label) => PROP_SHORT[type] || label || type;

const PLAYOFF_LABELS = ["WC", "DIV", "CONF", "", "SB"];
/** Week 1–18 → "W1"; 19+ → the round name. */
export const weekLabel = (w) => (w <= 18 ? `W${w}` : PLAYOFF_LABELS[w - 19] || `W${w}`);

/** "2025-09-04" + "20:20" → "Thu 8:20p". Kickoff, in the reader's own words. */
export function kickoff(gameday, gametime) {
  if (!gameday) return "";
  const [y, m, d] = gameday.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  if (!gametime) return day;
  const [hh, mm] = gametime.split(":").map(Number);
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${day} ${h12}:${String(mm).padStart(2, "0")}${hh >= 12 ? "p" : "a"}`;
}

/** The spread from the FAVOURITE's side: nflverse stores it home-relative. */
export function spreadText(g) {
  if (g?.spread_line == null) return null;
  const s = g.spread_line;
  if (s === 0) return "PK";
  return s > 0 ? `${g.home_team} -${s}` : `${g.away_team} -${Math.abs(s)}`;
}

/**
 * ONE SIDE's own number, the way a board prints it: "-4.5" for the favourite,
 * "+4.5" for the dog, "PK" when there is no favourite.
 *
 * nflverse's spread_line is HOME-POSITIVE — a +4.5 means the home team is
 * favoured by four and a half — so the home side's printed handicap is its
 * NEGATIVE. Getting that backwards is the kind of error a slate card shows
 * sixteen times at once, so there is one place that does it.
 */
export function sideSpread(g, side) {
  if (g?.spread_line == null) return null;
  const s = side === "home" ? -g.spread_line : g.spread_line;
  if (s === 0) return "PK";
  return `${s > 0 ? "+" : "\u2212"}${Math.abs(s)}`;
}
