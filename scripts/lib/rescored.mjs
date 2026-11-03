// The re-scored pre-baseline weeks (scripts/rescore_weeks.mjs) for scripts.
// The browser loads the same file through src/lib/rescoreView.js; Node cannot
// import JSON without an attribute, so scripts read it here. Null when the
// season has none — the caller then counts the frozen rows as they are.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "out");

export function readRescored(season) {
  const p = path.join(OUT, `rescored_${season}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
}
