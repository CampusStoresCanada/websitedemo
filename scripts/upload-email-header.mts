/**
 * Upload an email header image to the PUBLIC comms-content bucket.
 *
 *   npx tsx scripts/upload-email-header.mts <local.png> <headers/name.png>
 *
 * ⛔ Email headers must NOT be served from the site (`/email/...`). That path
 * only works if the file is committed AND deployed, and it has already failed
 * once: campusstores.ca/email/conference-in-a-box-header.png is a live 404.
 * Storage needs no deploy and cannot be lost to a branch that never merged.
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const { createAdminClient } = await import("../lib/supabase/admin");
const [src, dest] = process.argv.slice(2);
if (!src || !dest) { console.error("usage: upload-email-header.mts <local.png> <headers/name.png>"); process.exit(1); }
const db = createAdminClient();
const { error } = await db.storage.from("comms-content")
  .upload(dest, readFileSync(src), { contentType: "image/png", upsert: true, cacheControl: "31536000" });
if (error) { console.error("upload failed:", error.message); process.exit(1); }
console.log(db.storage.from("comms-content").getPublicUrl(dest).data.publicUrl);
