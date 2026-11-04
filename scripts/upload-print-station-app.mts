#!/usr/bin/env npx tsx
/**
 * Upload the Mac print station app (print-station/build_app.sh, which builds
 * OUTSIDE the repo in ~/csc-print-station-build) to private storage, where the
 * print station page's "Download CSC Print Station for Mac" link serves it.
 * Replaces the previous upload.
 *
 *   ditto -c -k --keepParent ~/csc-print-station-build/dist/"CSC Print Station.app" ~/csc-print-station-build/dist/"CSC Print Station.zip"
 *   npx tsx scripts/upload-print-station-app.mts
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const buildDir = process.env.CSC_PRINT_STATION_BUILD || join(homedir(), "csc-print-station-build");
const file = readFileSync(join(buildDir, "dist", "CSC Print Station.zip"));
const { error } = await db.storage.from("brand-assets").upload("software/csc-print-station-mac.zip", file, {
  contentType: "application/zip",
  upsert: true,
});
if (error) throw new Error(error.message);
console.log(`Uploaded ${(file.length / 1e6).toFixed(1)} MB to brand-assets/software/csc-print-station-mac.zip`);
