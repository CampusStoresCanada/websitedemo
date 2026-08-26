#!/usr/bin/env npx tsx
/** Render the Nominating Committee Report from live data. Read-only. */
import { readFileSync } from "node:fs";
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}
process.env.ELECTIONS_SUPPRESS_EMAIL = "1";

const { getNominatingCommitteeReport } = await import("../lib/elections/service");
const r = (await getNominatingCommitteeReport(process.argv[2] ?? "board-2027"))!;

console.log(r.title);
for (const m of r.meta) console.log(`${m.label}: ${m.value}`);
console.log();
for (const s of r.sections) {
  for (const p of s.paragraphs) console.log(p + "\n");
  if (s.roster) {
    for (const d of s.roster)
      console.log(`   ${d.name.padEnd(26)} ${d.institution.padEnd(38)} ${d.region}`);
    console.log();
  }
}
console.log(`Respectfully Submitted,\n${r.meta[2].value.replace("The ", "")}`);
console.log(`\n[vacancies: ${r.vacancies}]`);
