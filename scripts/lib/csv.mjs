// ── nflverse CSV parsing ─────────────────────────────────────────────────────
// One RFC-4180 parser, two entry points, because the files nflverse publishes
// span three orders of magnitude in size and a single strategy cannot serve
// both ends of that range:
//
//   parseCsv()  — whole string in, array of objects out. Right for injuries
//                 (~1 MB) and rosters (~1 MB), where holding the file is free.
//   streamCsv() — async row iterator over a fetch Response. Required for the
//                 depth charts: nflverse keeps EVERY dated snapshot of the
//                 season in one file, which is 48 MB and 507k rows by week 1
//                 and grows all season. Buffering that as a string to keep
//                 2,183 rows from the newest snapshot is the kind of thing that
//                 works in September and OOMs a CI runner in December.
//
// Both handle quoted fields, because they must: nflverse quotes any value with
// a comma in it (an injury of "Knee, Ankle", a college of "Miami, FL") and a
// naive split shifts every column after it — landing a body part in
// report_status, or a depth rank in a position name.

/** Parse a whole CSV string into an array of row objects keyed by header. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const head = rows[0];
  return rows.slice(1).filter((r) => r.length === head.length)
    .map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

/**
 * Split one CSV line into fields, honouring quotes.
 *
 * Exported only so streamCsv can reuse it; a line that ends mid-quote is
 * reported via the returned `open` flag so the caller can join it to the next.
 */
function splitLine(line, carry) {
  const fields = carry ? carry.fields : [];
  let field = carry ? carry.field : "";
  let quoted = carry ? carry.quoted : false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { fields.push(field); field = ""; continue; }
    field += c;
  }
  // Still inside quotes at end-of-line means the value contains a newline. Keep
  // the partial state and resume on the next line rather than emitting a
  // truncated row.
  if (quoted) return { open: true, carry: { fields, field: field + "\n", quoted: true } };
  fields.push(field);
  return { open: false, fields };
}

/**
 * Stream a fetch Response body as CSV row objects, without ever holding the
 * whole file. Yields one plain object per data row.
 */
export async function* streamCsv(res) {
  const decoder = new TextDecoder();
  let buf = "";
  let head = null;
  let carry = null;

  const emit = function* (line) {
    if (line === "" && !carry) return;             // blank line between records
    const r = splitLine(line, carry);
    if (r.open) { carry = r.carry; return; }
    carry = null;
    if (!head) { head = r.fields; return; }
    if (r.fields.length !== head.length) return;   // malformed row — skip, as parseCsv does
    yield Object.fromEntries(head.map((h, i) => [h, r.fields[i]]));
  };

  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      yield* emit(line);
    }
  }
  buf += decoder.decode();
  if (buf.length) yield* emit(buf.replace(/\r$/, ""));
}
