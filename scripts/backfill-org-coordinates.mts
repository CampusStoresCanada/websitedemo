#!/usr/bin/env npx tsx
/**
 * Fill organizations.latitude/longitude for orgs that hold conference seats.
 *
 * Why it matters: the badge front is a Mapbox static map centred on the
 * holder's ORG. `mapboxStaticBackground` (lib/conference/badges/render-html.ts)
 * falls back to `lng = -95, lat = 56` when coordinates are missing — which is
 * NOT a graceful degradation, it is a zoom-11.5 map of an arbitrary point in
 * central Saskatchewan. The badge looks plausible and is wrong, and nobody
 * finds out until the box is opened.
 *
 * Only writes rows where latitude IS NULL, so it is idempotent and can never
 * overwrite a real coordinate. Dry-run by default; pass --apply to commit.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const APPLY = process.argv.includes("--apply");
const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
if (!TOKEN) throw new Error("NEXT_PUBLIC_MAPBOX_TOKEN missing");

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function geocode(
  street: string | null,
  city: string | null,
  province: string | null,
  postal: string | null,
  country: string | null
): Promise<{ latitude: number; longitude: number } | null> {
  const isUs = /united states|usa|^us$/i.test(country ?? "");
  // "Out of Canada" is a province placeholder, not a place — sending it makes
  // the query worse, not better.
  const cleanProvince = province && !/out of canada/i.test(province) ? province : null;
  const query = [street, city, cleanProvince, postal, isUs ? "United States" : "Canada"]
    .filter(Boolean)
    .join(", ");
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
    `?access_token=${TOKEN}&country=${isUs ? "US" : "CA"}&limit=1`;
  const res = await fetch(url);
  const data = (await res.json()) as { features?: Array<{ center: [number, number]; place_name: string }> };
  const hit = data.features?.[0];
  if (!hit) {
    console.log(`   no result for "${query}"`);
    return null;
  }
  console.log(`   → ${hit.place_name}`);
  return { latitude: hit.center[1], longitude: hit.center[0] };
}

// Scoped to orgs that hold conference seats — these are the ones whose badges
// get printed, so these are the ones a wrong map centre actually reaches.
// Pass --all to sweep every org without coordinates.
const ALL = process.argv.includes("--all");
const { data: seatOrgs, error: seatErr } = await db
  .from("entity_balance_seats")
  .select("organization_id");
if (seatErr) throw new Error(seatErr.message);
const seatOrgIds = [...new Set((seatOrgs ?? []).map((s) => s.organization_id).filter(Boolean))];

let query = db
  .from("organizations")
  .select("id, name, street_address, city, province, postal_code, country, latitude")
  .is("latitude", null)
  .is("archived_at", null);
if (!ALL) query = query.in("id", seatOrgIds);
const { data: orgs, error } = await query;
if (error) throw new Error(error.message);

console.log(`${orgs?.length ?? 0} orgs without coordinates. ${APPLY ? "APPLYING" : "dry run"}\n`);

let filled = 0;
let skipped = 0;
for (const org of orgs ?? []) {
  // A city is the minimum that can produce a meaningful centre. Anything less
  // is a data problem for a human, not something to guess at.
  if (!org.city && !org.street_address) {
    console.log(`❌ ${org.name} — no address to geocode (needs data, not code)`);
    skipped += 1;
    continue;
  }
  console.log(`• ${org.name}`);
  const coords = await geocode(
    org.street_address,
    org.city,
    org.province,
    org.postal_code,
    org.country
  );
  if (!coords) {
    skipped += 1;
    continue;
  }
  if (APPLY) {
    const { error: upErr } = await db
      .from("organizations")
      .update({ latitude: coords.latitude, longitude: coords.longitude })
      .eq("id", org.id)
      .is("latitude", null);
    if (upErr) {
      console.log(`   write failed: ${upErr.message}`);
      skipped += 1;
      continue;
    }
  }
  filled += 1;
  await new Promise((r) => setTimeout(r, 120));
}

console.log(`\n${filled} filled, ${skipped} skipped.${APPLY ? "" : " Re-run with --apply to commit."}`);
