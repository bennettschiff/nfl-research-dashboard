// ── Filter bar ───────────────────────────────────────────────────────────────
// Labelled dropdowns in a row, after props.cash: SECTION · GAMES · PROPS and so
// on, each a caption over a button that says its current value, opening a
// checklist. The board used to stack a position pill strip, a prop pill strip
// and a search strip inside its card — three rows of chrome before the first
// player — and the week rail and slate filter lived somewhere else again.
import { useEffect, useRef, useState } from "react";
import { S, C, MON } from "../lib/theme.js";

/** One labelled field in the bar. */
export function Field({ label, children, grow }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: grow ? "1 1 180px" : "0 0 auto", minWidth: 0 }}>
      <div style={S.filterLabel}>{label}</div>
      {children}
    </div>
  );
}

/**
 * A dropdown checklist.
 *
 * options  [{ value, label, sub?, subColor?, disabled?, section? }] — an entry
 *          with `section` and no value is a non-clickable group caption.
 * selected a value (single) or a Set (multi)
 * multi    keeps the menu open on click and toggles, rather than choosing
 * display  the button text
 * changed  accent the button when the field is off its default
 */
export function Dropdown({ label, options, selected, onChange, multi, display, changed, grow }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const isSel = (v) => (multi ? selected.has(v) : selected === v);

  return (
    <Field label={label} grow={grow}>
      <div ref={ref} style={{ position: "relative" }}>
        <button type="button" onClick={() => setOpen((o) => !o)} style={{ ...S.ddBtn(changed), width: grow ? "100%" : undefined }}
          aria-haspopup="listbox" aria-expanded={open}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{display}</span>
          <span style={{ fontSize: 9, color: C.faint, transform: open ? "rotate(180deg)" : "none",
            transition: "transform .15s" }}>▼</span>
        </button>
        {open && (
          <div role="listbox" aria-multiselectable={!!multi} style={S.ddMenu} className="fade-in">
            {options.map((o, i) => o.section && o.value === undefined ? (
              <div key={`s${i}`} style={S.ddSection}>{o.section}</div>
            ) : (
              <button key={String(o.value)} type="button" role="option" aria-selected={isSel(o.value)}
                className="dd-item" disabled={o.disabled} title={o.title}
                style={S.ddItem(isSel(o.value), o.disabled)}
                onClick={() => { onChange(o.value); if (!multi) setOpen(false); }}>
                <span style={{ width: 12, color: C.accent, fontSize: 11, flexShrink: 0 }}>{isSel(o.value) ? "✓" : ""}</span>
                <span style={{ flex: 1, whiteSpace: "nowrap" }}>{o.label}</span>
                {o.sub && <span style={{ fontSize: 9.5, fontFamily: MON, color: o.subColor || C.faint,
                  fontWeight: 700, whiteSpace: "nowrap" }}>{o.sub}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </Field>
  );
}
