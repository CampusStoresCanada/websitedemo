#!/usr/bin/env npx tsx
/**
 * Render the badge edge cases a real roster will not contain today, and
 * rasterize them so a human (or a model with eyes) can look.
 *
 * ⛔ WHY: four bugs in one day survived tsc, 1,778 tests and `next build`, and
 * every one was a "no real person hits this" assumption — a missing name, an
 * empty QR payload, a caption for a code that was not there. A roster of 14
 * cooperative people cannot surface them. This feeds the renderer the awkward
 * cases on purpose, through the conference's REAL active template, and prints
 * what comes out.
 *
 * Usage: badge-edge-cases.mts <conferenceId> [--out dir]
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
process.env.BADGE_ALLOW_LOCAL_SCAN_URL = "1";

const { renderJobDocumentHtml } = await import("../lib/conference/badges/render-html");
const { normalizeBadgeTemplateConfig } = await import("../lib/conference/badges/template");
const { resolveBadgeRun } = await import("../lib/conference/badges/run");
type Rec = import("../lib/conference/badges/template").BadgePersonRecord;

const conferenceId = process.argv[2];
if (!conferenceId) throw new Error("usage: badge-edge-cases.mts <conferenceId>");
const outIdx = process.argv.indexOf("--out");
const outDir = outIdx > -1 ? process.argv[outIdx + 1] : "/tmp/badge-edges";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const { data: configRow } = await db
  .from("badge_template_configs")
  .select("field_mapping, config_version, status")
  .eq("conference_id", conferenceId)
  .order("config_version", { ascending: false })
  .limit(1)
  .maybeSingle();
const template = normalizeBadgeTemplateConfig(configRow?.field_mapping ?? null);
console.log(`template v${configRow?.config_version} (${configRow?.status})`);

// Real variants, so the probe exercises the layouts that will actually print.
const run = await resolveBadgeRun(conferenceId);
// ⛔ Two GENUINELY different layouts, not two names that both say "Exhibitor".
// Pass --delegate/--exhibitor to pin them; otherwise pick the longest-agenda
// type (a full attendee) against the largest-seat-count one (the exhibitor
// floor), which is the widest layout gap this conference actually sells.
const pick = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? run.types.find((t) => t.name.toLowerCase().includes(process.argv[i + 1].toLowerCase())) : undefined;
};
const delegateType =
  pick("--delegate") ??
  [...run.types].sort((a, b) => b.agenda.length - a.agenda.length)[0];
const exhibitorType =
  pick("--exhibitor") ??
  [...run.types].sort((a, b) => b.seats.length - a.seats.length).find((t) => t.entityId !== delegateType.entityId) ??
  delegateType;
console.log(`delegate variant : ${delegateType.name}`);
console.log(`exhibitor variant: ${exhibitorType.name}`);

const QR = "data:image/svg+xml;base64," + Buffer.from(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8'><rect width='8' height='8' fill='#fff'/><rect x='1' y='1' width='3' height='3'/><rect x='5' y='5' width='2' height='2'/></svg>`
).toString("base64");

const base: Rec = {
  id: "probe", variantKey: exhibitorType.entityId, variantName: exhibitorType.name,
  displayName: "Jane Smith", firstName: "Jane", lastName: "Smith",
  roleTitle: "Category Manager", organizationName: "Acme Supply Co.",
  logoUrl: null, qrPayload: "https://example.test/scan/abc", qrImageDataUri: QR,
  organizationSlug: "acme", orgQrImageDataUri: QR,
  latitude: 43.65, longitude: -79.38, city: "Toronto", province: "ON",
  organizationType: "Vendor Partner",
  access: exhibitorType.accessSummary, agenda: exhibitorType.agenda,
};

const CASES: Array<[string, Partial<Rec>]> = [
  ["01 baseline exhibitor", {}],
  ["02 baseline delegate", { variantKey: delegateType.entityId, variantName: delegateType.name, access: delegateType.accessSummary, agenda: delegateType.agenda }],
  ["03 very long org name", { organizationName: "The University of Northern British Columbia Bookstore and Campus Retail Services" }],
  ["04 very long person name", { firstName: "Bartholomew Maximilian", lastName: "Featherstonehaugh-Wellington" }],
  ["05 single word name", { firstName: "Prince", lastName: "" }],
  ["06 accents and non-ascii", { firstName: "Zoë", lastName: "Müller-Ançois", organizationName: "Librairie Coopérative de l'Université Laval", city: "Québec", province: "QC" }],
  ["07 no logo", { logoUrl: null, organizationName: "No Logo Ltd." }],
  ["08 no coordinates (no map)", { latitude: null, longitude: null, city: null, province: null }],
  ["09 no org slug (no front QR)", { organizationSlug: null, orgQrImageDataUri: null }],
  ["10 very long title", { roleTitle: "Interim Associate Director of Course Materials, Digital Strategy and Vendor Relations" }],
  ["11 no title", { roleTitle: null }],
  ["12 empty agenda", { agenda: [] }],
  ["13 no org name at all", { organizationName: null }],
  ["14 blank (no person, no code)", { displayName: null, firstName: null, lastName: null, roleTitle: null, qrPayload: "", qrImageDataUri: null }],
  ["15 blank delegate", { variantKey: delegateType.entityId, variantName: delegateType.name, access: delegateType.accessSummary, agenda: delegateType.agenda, displayName: null, firstName: null, lastName: null, roleTitle: null, qrPayload: "", qrImageDataUri: null }],
  ["16 everything missing", { displayName: null, firstName: null, lastName: null, roleTitle: null, organizationName: null, logoUrl: null, latitude: null, longitude: null, city: null, province: null, organizationSlug: null, orgQrImageDataUri: null, qrPayload: "", qrImageDataUri: null, access: null, agenda: [] }],
];

const people = CASES.map(([label, over], i) => ({ ...base, ...over, id: `probe-${i + 1}`, _label: label } as Rec & { _label: string }));
CASES.forEach(([label], i) => console.log(`page ${i * 2 + 1}/${i * 2 + 2}  ${label}`));

const html = renderJobDocumentHtml({
  title: "Badge edge cases",
  template,
  people,
  includeBack: true,
  venueAddress: run.venueAddress,
  onsiteContact: { name: "Carolyn Potter", phone: "(416) 807-8700" },
});

mkdirSync(outDir, { recursive: true });
const ORIGIN = process.env.RENDER_ORIGIN ?? "http://localhost:3000";
const faithful = html
  .replace(/(src|href)="\/(?!\/)/g, `$1="${ORIGIN}/`)
  .replace(/url\((['"]?)\/(?!\/)/g, `url($1${ORIGIN}/`);
const htmlPath = `${outDir}/edge-cases.html`;
const pdfPath = `${outDir}/edge-cases.pdf`;
writeFileSync(htmlPath, faithful, "utf8");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if (!existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME}`);
execFileSync(CHROME, [
  "--headless", "--disable-gpu", "--no-pdf-header-footer",
  `--print-to-pdf=${pdfPath}`, "--virtual-time-budget=20000", htmlPath,
], { stdio: "ignore" });
console.log(`\n${people.length} cases → ${pdfPath}`);
