#!/usr/bin/env node
/**
 * Bulk upload product overlay images to Supabase storage
 * and update the product_overlay_url on each organization.
 *
 * Usage: node scripts/upload-product-images.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const SUPABASE_URL = "https://kalosjtiwtnwsseitfys.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthbG9zanRpd3Rud3NzZWl0ZnlzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk5MDI4NzIsImV4cCI6MjA3NTQ3ODg3Mn0.5o9KKSsP52FfKvOmAWhKTBqiu9Oaopis4_yV1U2CSyQ";

const IMAGE_DIR =
  "/Users/Work/Documents/csc-website/images-to-process/products/finished";
const BUCKET = "organization-images";

// Mapping from image filename stem → database slug
const FILENAME_TO_SLUG = {
  "10tree": "10tree",
  ahead: "ahead",
  "algonquin-college": "algonquin-college",
  "ambrose-university-lions-store": "ambrose-university-college-bookstores",
  "athabasca-university": "athabasca-university",
  "barbarian-bruzer": "barbarian-bruzer",
  "bardown-sports": "bardown-sports",
  bmf: "bmf",
  boxercraft: "boxercraft",
  "camosun-college": "camosun-college",
  "campus-ebookstore": "campus-ebookstore",
  "campus-priority": "campus-priority",
  cancoll: "cancoll",
  "capilano-university": "capilano-university",
  "carleton-technologies": null,
  "carleton-university": "carleton-university",
  "catalyst-group": "catalyst-group",
  cengage: "cengage",
  "cesium-telecom": "cesium",
  "champlain-college": "champlain-college",
  "coast-mountain-college": "coast-mountain-college",
  cocoburry: "cocoburry",
  "college-of-new-caledonia": "college-of-new-caledonia",
  "conestoga-college": "conestoga-college",
  "cutter-and-buck": "cutter-buck",
  "dalhousie-university": "dalhousie-university",
  danbar: "danbar",
  "dgn-apparel-layer": "dgn-marketing",
  dmg: "dmg",
  "douglas-college": "douglas-college",
  "durham-college": "durham-college",
  "fanshawe-college": "fanshawe-college",
  "ggs-ltd": "ggs-ltd-",
  "greenglass-group": "greenglass-group",
  "greentown-canada": "greentown-canada",
  "holland-college": "holland-college",
  "hotline-apparel": "hotline-apparel",
  "hype-and-vice": "hype-and-vice",
  ironhead: null,
  itoya: "itoya-studio",
  "jack-and-sage": "jack-and-sage",
  "jailbird-designs": "jailbird-designs",
  "jay-line": "jay-line",
  jcwg: "jcwg",
  "john-abbott-college": "john-abbott-college",
  "joto-imaging-supplies": null,
  "jpt-america-kokuyo": "jpt-america-inc-",
  "keyano-college": "keyano-college",
  kotmo: null,
  "kwantlen-polytechnic-university": "kwantlen-polytechnic-university",
  l2brands: "l2brands",
  "lago-apparel": "lago-apparel",
  "lakehead-university": "lakehead-university",
  "lakeland-college": "lakeland-college",
  "lambton-college": "lambton-college",
  "langara-college": "langara-college",
  "lethbridge-polytechnic": "lethbridge-polytechnic",
  "liberty-clothing-company": "liberty-clothing-company",
  "login-canada": "login-canada",
  "macewan-university": "macewan-university",
  martinivispak: "martinivispak",
  "mcgill-university": "mcgill-university",
  "mcmaster-university": "mcmaster-university",
  "medicine-hat-college": "medicine-hat-college",
  "memorial-university-of-newfoundland":
    "memorial-university-of-newfoundland",
  "milburn-universal-designs": "milburn-universal-designs",
  "mohawk-college": "mohawk-college",
  "momentec-brands-canada": "momentec",
  "mount-allison-university": "mount-allison-university",
  "mount-royal-university": "mount-royal-university",
  "mount-saint-vincent": "mount-saint-vincent",
  nait: "nait",
  "nellies-clean": "nellie-s-clean",
  "new-brunswick-community-college": null,
  "norquest-college": "norquest-college",
  "north-island-college": "north-island-college",
  "northern-icons-creations-inc": "northern-icons-creations-inc-",
  "nova-scotia-community-college": "nova-scotia-community-college",
  "okanagan-college": "okanagan-college",
  "olds-college": "olds-college",
  "ontariotech-university": "ontariotech-university",
  "ookami-promo": "ookami-promo",
  "outset-media": "outset-media",
  "parkdale-novelty": "parkdale-novelty",
  "patrick-king-woollen-company": "patrick-king-woollen-company",
  "penguin-random-house": "penguin-random-house",
  "portage-college": "portage-college",
  "premium-uniforms": "premium-uniforms",
  prismrbs: null,
  pukka: "pukka",
  "queens-university": "queen-s-university",
  "radley-prep": "radley-prep",
  "rafhy-apparel-inc": "rafhy-apparel-inc",
  randmar: "randmar",
  "red-river-polytech": "red-river-polytech",
  "redeemer-university": "redeemer-college",
  resero: null,
  "roaring-spring": "roaring-spring",
  roots: "roots",
  "saint-francis-xavier-university": "saint-francis-xavier-university",
  "saint-marys-university": "saint-mary-s-university",
  "saskatchewan-polytechnic": "saskatchewan-polytechnic",
  "selkirk-college": "selkirk-college",
  "sharper-marketing": "sharper-marketing",
  "sheridan-college": "sheridan-college",
  "simon-fraser-university": "simon-fraser-university",
  "sparta-pewter": "sparta-pewter",
  "spiritwear-canada": "spiritwear-canada",
  "st-marys-university": "st-mary-s-university",
  stanfields: "stanfield-s",
  "tempo-framing": "tempo-framing",
  "thompson-river-university": "thompson-river-university",
  "thread-wallets": null,
  "toronto-metropolitan-university": "toronto-metropolitan-university",
  "trinity-western-university": "trinity-western-university",
  "university-college-of-the-north": "university-college-of-the-north",
  "university-of-alberta": "university-of-alberta",
  "university-of-british-columbia": "university-of-british-columbia",
  "university-of-calgary": "university-of-calgary",
  "university-of-guelph": "university-of-guelph",
  "university-of-lethbridge": "university-of-lethbridge",
  "university-of-manitoba": "university-of-manitoba",
  "university-of-new-brunswick": "university-of-new-brunswick",
  "university-of-northern-british-columbia":
    "university-of-northern-british-columbia",
  "university-of-prince-edward-island": "university-of-prince-edward-island",
  "university-of-saskatchewan": "university-of-saskatchewan",
  "university-of-the-fraser-valley": "university-of-the-fraser-valley",
  "university-of-toronto": "university-of-toronto",
  "university-of-victoria": "university-of-victoria",
  "university-of-waterloo": "university-of-waterloo",
  "vancouver-island-university": "vancouver-island-university",
  "vitalsource-tech": "vitalsource-tech",
  "western-university": "western-university",
  "wilfrid-laurier-university": "wilfrid-laurier-university",
  "willland-outdoors": "willland-outdoors",
  "york-university": "york-university",
  "yukon-university": "yukon-university",
};

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Sign in as super admin for storage upload permission
  const { error: authErr } = await supabase.auth.signInWithPassword({
    email: "google@campusstores.ca",
    password: "Mkpspxw8BA!vb3T",
  });
  if (authErr) {
    console.error("Auth failed:", authErr.message);
    process.exit(1);
  }
  console.log("✓ Authenticated\n");

  // Get all org IDs by slug
  const { data: orgs, error: orgsErr } = await supabase
    .from("organizations")
    .select("id, slug, name, product_overlay_url");
  if (orgsErr) {
    console.error("Failed to fetch orgs:", orgsErr.message);
    process.exit(1);
  }
  const orgBySlug = Object.fromEntries(orgs.map((o) => [o.slug, o]));

  // Read image files
  const files = readdirSync(IMAGE_DIR).filter((f) =>
    f.endsWith("_product.png")
  );
  console.log(`Found ${files.length} product images\n`);

  let uploaded = 0;
  let skipped = 0;
  let noMatch = 0;
  let errors = 0;
  const unmatched = [];

  for (const file of files) {
    const stem = file.replace("_product.png", "");
    const slug = FILENAME_TO_SLUG[stem];

    if (slug === null || slug === undefined) {
      console.log(`  ⊘ ${stem} → no DB match`);
      unmatched.push(stem);
      noMatch++;
      continue;
    }

    const org = orgBySlug[slug];
    if (!org) {
      console.log(`  ⊘ ${stem} → slug "${slug}" not found in DB`);
      unmatched.push(stem);
      noMatch++;
      continue;
    }

    // Skip if already has a Supabase storage URL (not a local /heroes/ path)
    if (
      org.product_overlay_url &&
      org.product_overlay_url.includes("supabase.co/storage")
    ) {
      console.log(`  ⊜ ${org.name} — already has storage URL, skipping`);
      skipped++;
      continue;
    }

    // Read file
    const filePath = join(IMAGE_DIR, file);
    const fileBuffer = readFileSync(filePath);
    const timestamp = Date.now();
    const storagePath = `${org.id}/product_overlay_${timestamp}.png`;

    // Upload to storage
    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, fileBuffer, {
        contentType: "image/png",
        upsert: true,
      });

    if (uploadErr) {
      console.error(`  ✗ ${org.name}: upload failed — ${uploadErr.message}`);
      errors++;
      continue;
    }

    // Get public URL
    const {
      data: { publicUrl },
    } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

    // Update org record
    const { error: updateErr } = await supabase
      .from("organizations")
      .update({ product_overlay_url: publicUrl })
      .eq("id", org.id);

    if (updateErr) {
      console.error(
        `  ✗ ${org.name}: DB update failed — ${updateErr.message}`
      );
      errors++;
      continue;
    }

    console.log(`  ✓ ${org.name}`);
    uploaded++;

    // Small delay to avoid rate limiting
    if (uploaded % 10 === 0) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`Uploaded: ${uploaded}`);
  console.log(`Skipped (already done): ${skipped}`);
  console.log(`No match: ${noMatch}`);
  console.log(`Errors: ${errors}`);
  if (unmatched.length > 0) {
    console.log(`\nUnmatched files:`);
    unmatched.forEach((u) => console.log(`  - ${u}_product.png`));
  }

  await supabase.auth.signOut();
}

main().catch(console.error);
