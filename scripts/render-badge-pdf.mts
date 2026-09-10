#!/usr/bin/env npx tsx
/**
 * Render a badge job all the way to a real PDF, using the same Chrome engine an
 * operator would.
 *
 * ⛔ WHY THIS EXISTS: reading the HTML tells you nothing about what the PRINTER
 * does. Chrome drops background graphics by default, so the map, the tint layer,
 * the overlay artwork and the crop marks (background-coloured divs) all vanish —
 * and the on-screen preview looks perfect the whole time. Burnt-in Mapbox
 * attribution lands inside the trim. The only way to know is to render and look.
 *
 * Usage: render-badge-pdf.mts <conferenceId> <jobId> [--out dir]
 */
import { mkdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
// Throwaway local render: badges produced here are for inspection, not print.
process.env.BADGE_ALLOW_LOCAL_SCAN_URL = "1";

import { buildBadgeJobDocument } from "../lib/conference/badges/document";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const [conferenceId, jobId] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!conferenceId || !jobId) throw new Error("usage: render-badge-pdf.mts <conferenceId> <jobId>");
const outIdx = process.argv.indexOf("--out");
const outDir = outIdx > -1 ? process.argv[outIdx + 1] : "/tmp/badge-render";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if (!existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME}`);

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const { html, badgeCount } = await buildBadgeJobDocument({ db, conferenceId, jobId });
mkdirSync(outDir, { recursive: true });
const htmlPath = `${outDir}/badge-job-${jobId}.html`;
const pdfPath = `${outDir}/badge-job-${jobId}.pdf`;
// Relative asset URLs (/badges/*.png overlays) cannot resolve from file://, and
// Adobe Fonts refuses to serve a kit to an unauthorised origin — so a naive
// file:// render silently loses the overlay artwork AND the typeface, which
// would look exactly like a real bug. Absolutise against the running app so the
// render exercises the same assets an operator's browser would.
const ORIGIN = process.env.RENDER_ORIGIN ?? "http://localhost:3000";
const faithful = html
  .replace(/(src|href)="\/(?!\/)/g, `$1="${ORIGIN}/`)
  .replace(/url\((['"]?)\/(?!\/)/g, `url($1${ORIGIN}/`);
writeFileSync(htmlPath, faithful, "utf8");
console.log(`${badgeCount} badges · html ${(html.length / 1024).toFixed(0)}kb → ${htmlPath}`);

// --no-pdf-header-footer keeps Chrome's date/URL furniture off a print artifact.
// The remote Typekit stylesheet and Mapbox images are fetched during this run,
// which is exactly the point: if they fail here they fail on the operator's
// machine too, and the PDF shows it.
execFileSync(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-pdf-header-footer",
    "--virtual-time-budget=20000",
    `--print-to-pdf=${pdfPath}`,
    `file://${htmlPath}`,
  ],
  { stdio: "inherit", timeout: 120000 }
);

const size = statSync(pdfPath).size;
console.log(`pdf ${(size / 1024).toFixed(0)}kb → ${pdfPath}`);
