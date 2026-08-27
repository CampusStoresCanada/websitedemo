#!/usr/bin/env npx tsx
/**
 * Live proof of the board renewal report against the real DB. READ ONLY —
 * writes nothing, touches no membership, invoice, or contact record.
 *
 *   npx tsx scripts/board-renewal-report-live-check.mts
 */
import { readFileSync } from "node:fs";

try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* env may already be set */
}

const { getBoardRenewalReport, resolveBoardRenewalWindow } = await import(
  "../lib/renewal/board-report"
);
const { getRenewalProgressData } = await import("../lib/renewal/renewal-progress");

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else    { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}
const money = (c: number) => `$${(c / 100).toLocaleString("en-CA")}`;

console.log("\n── Window resolution (keyed on MEETING date, not today) ──");
const windowCases: [string, boolean][] = [
  ["2026-08-27", true],   // today's meeting
  ["2026-09-24", true],
  ["2026-10-29", true],   // first meeting after the Oct 1 grace cliff
  ["2026-11-26", true],
  ["2026-12-17", false],  // out — three months past cycle start
  ["2027-01-21", false],  // AGM
  ["2026-07-30", false],  // before the window opens
];
for (const [date, expected] of windowCases) {
  const w = await resolveBoardRenewalWindow(date);
  check(
    `${date} ${expected ? "in" : "out of"} window`,
    (w !== null) === expected,
    w ? `renewalYear ${w.renewalYear}` : "null"
  );
}

const aug = await resolveBoardRenewalWindow("2026-08-27");
const nov = await resolveBoardRenewalWindow("2026-11-26");
check(
  "Aug and Nov meetings resolve to the SAME renewal year",
  aug?.renewalYear === nov?.renewalYear,
  `${aug?.renewalYear} vs ${nov?.renewalYear}`
);

console.log("\n── Report for the 2026-08-27 meeting ──");
const report = await getBoardRenewalReport("2026-08-27");
if (!report) {
  console.log("  ✗ report was null for an in-window meeting");
  process.exit(1);
}

for (const [key, t] of Object.entries(report.types)) {
  console.log(
    `  ${key.padEnd(15)} ${t.renewedCount}/${t.populationCount} renewed · ` +
    `collected ${money(t.collectedCents)} · outstanding ${money(t.outstandingCents)} ` +
    `(${t.outstanding.length} orgs)`
  );
  check(
    `${key}: outstanding list length matches population − renewed`,
    t.outstanding.length === t.populationCount - t.renewedCount
  );
  check(
    `${key}: collected + outstanding = total expected`,
    t.collectedCents + t.outstandingCents === t.totalExpectedCents,
    `${money(t.collectedCents)} + ${money(t.outstandingCents)} = ${money(t.totalExpectedCents)}`
  );
  check(`${key}: outstanding list is alphabetical`,
    t.outstanding.every((o, i, a) => i === 0 || a[i - 1].name.localeCompare(o.name) <= 0));
  check(`${key}: no org appears twice`,
    new Set(t.outstanding.map((o) => o.organizationId)).size === t.outstanding.length);
}

console.log(`  TOTAL           ${report.totals.renewedCount}/${report.totals.populationCount} renewed · ` +
  `collected ${money(report.totals.collectedCents)} · outstanding ${money(report.totals.outstandingCents)}`);

console.log("\n── Agreement with the /admin widget (must never diverge) ──");
const widget = await getRenewalProgressData();
if (!widget) {
  console.log("  ⚠ widget returned null (outside the operational season) — skipping comparison");
} else {
  for (const key of Object.keys(report.types) as (keyof typeof report.types)[]) {
    const b = report.types[key];
    const w = widget.types[key];
    check(`${key}: population matches widget`, b.populationCount === w.populationCount,
      `${b.populationCount} vs ${w.populationCount}`);
    check(`${key}: renewed matches widget`, b.renewedCount === w.renewedCount,
      `${b.renewedCount} vs ${w.renewedCount}`);
    // Both surfaces price through getExpectedAmountsByOrg, so these must agree
    // exactly. A divergence means one of them stopped using the shared helper.
    check(`${key}: collected matches widget`, b.collectedCents === w.collectedCents,
      `${money(b.collectedCents)} vs ${money(w.collectedCents)}`);
    check(`${key}: total expected matches widget`, b.totalExpectedCents === w.totalExpectedCents,
      `${money(b.totalExpectedCents)} vs ${money(w.totalExpectedCents)}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
