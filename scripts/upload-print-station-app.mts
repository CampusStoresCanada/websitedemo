#!/usr/bin/env npx tsx
/**
 * Upload the Mac print station app (print-station/build_app.sh → dist/) to
 * private storage, where the print station page's "Download CSC Print Station
 * for Mac" link serves it. Replaces the previous upload.
 *
 *   ditto -c -k --keepParent "print-station/dist/CSC Print Station.app" "print-station/dist/CSC Print Station.zip"
 *   npx tsx scripts/upload-print-station-app.mts
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const file = readFileSync(new URL("../print-station/dist/CSC Print Station.zip", import.meta.url));
const { error } = await db.storage.from("brand-assets").upload("software/csc-print-station-mac.zip", file, {
  contentType: "application/zip",
  upsert: true,
});
if (error) throw new Error(error.message);
console.log(`Uploaded ${(file.length / 1e6).toFixed(1)} MB to brand-assets/software/csc-print-station-mac.zip`);
