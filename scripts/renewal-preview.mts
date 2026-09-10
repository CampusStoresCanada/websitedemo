#!/usr/bin/env npx tsx
/** Render the three renewal emails as they will actually go out. Sends nothing. */
import { readFileSync } from "node:fs";
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const { getTemplate, renderTemplateContent } = await import("../lib/comms/templates");
const { buildMembershipValueHtml, getOpenElectionForRenewal, renewalTemplateFor } =
  await import("../lib/renewal/membership-value");

const election = await getOpenElectionForRenewal();
console.log(`open election: ${election ? `${election.cycleYear}, ${election.seatsAvailable} seats` : "none"}\n`);

const APP = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.campusstores.ca";
const program = (process.argv[2] as "member" | "partner") ?? "member";
console.log(`programme: ${program}\n`);
const cases: { stage: "reminder" | "grace" | "locked"; lapsesOn: string | null; vars: Record<string, string | number> }[] = [
  { stage: "reminder" as const, lapsesOn: null,
    vars: { org_name: "Algonquin College", contact_name: "Algonquin College team",
            renewal_date: "September 1, 2026", days_until_expiry: 7, invoice_url: `${APP}/org/billing` } },
  { stage: "grace" as const, lapsesOn: "2026-10-01",
    vars: { org_name: "Algonquin College", contact_name: "Algonquin College team",
            grace_days_remaining: 12, payment_url: `${APP}/org/billing` } },
  { stage: "locked" as const, lapsesOn: null,
    vars: { org_name: "Algonquin College", contact_name: "Algonquin College team",
            admin_contact_url: `${APP}/contact` } },
];

for (const c of cases) {
  const key = renewalTemplateFor(c.stage, program);
  const t = await getTemplate(key);
  if (!t) { console.log(`MISSING ${key}`); continue; }
  const { subject, bodyHtml } = renderTemplateContent(t, {
    ...c.vars,
    membership_value_html: buildMembershipValueHtml({
      stage: c.stage, program, lapsesOn: c.lapsesOn, election, appUrl: APP,
    }),
  });
  const leftover = [...bodyHtml.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)].map((m) => m[1]);
  const text = bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  console.log("=".repeat(70));
  console.log(`${key}  ·  "${subject}"`);
  if (leftover.length) console.log(`  ⚠ UNRENDERED: ${[...new Set(leftover)].join(", ")}`);
  console.log("-".repeat(70));
  console.log(text);
  console.log();
}
