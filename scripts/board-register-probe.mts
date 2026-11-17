#!/usr/bin/env npx tsx
/** Read-only probe of loadBoardRegister. Writes nothing. */
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const { loadBoardRegister } = await import("../lib/governance/register");

for (const asOf of ["2026-11-17", "2027-01-01", "2027-01-21"]) {
  const r = await loadBoardRegister({ asOf });
  if (!r) { console.log("no body"); continue; }
  console.log(`\n=== as at ${asOf} — ${r.body.name} (${r.body.seatCount} seats, min ${r.body.minSeatCount}) ===`);
  console.log(`holding ${r.holding.length} · incoming ${r.incoming.length} · past ${r.past.length} · markers ${r.markers.length} · vacancies ${r.vacancies} · belowMinimum ${r.belowMinimum}`);
  for (const t of r.holding) console.log(`   HOLD  ${t.name.padEnd(22)} ${t.termStart} → ${t.termEnd ?? "open"}  ${t.organizationName ?? ""}`);
  for (const t of r.incoming) console.log(`   IN    ${t.name.padEnd(22)} ${t.termStart} → ${t.termEnd ?? "open"}`);
  for (const t of r.markers) console.log(`   MARK  ${t.name.padEnd(22)} ${t.termStart}`);
}
