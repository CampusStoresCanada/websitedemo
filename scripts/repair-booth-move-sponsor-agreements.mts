#!/usr/bin/env npx tsx
/**
 * One-off repair for the two orgs whose booth MOVE never reached their sponsor
 * agreement, because moveBoothsCore only ever called enqueueQBConferenceReceipt
 * and the agreement hook lived solely in the Stripe webhook.
 *
 *   MV Sport          moved onto Connected booth 306 (paid, $6,780) and has no
 *                     agreement at all — owed the whole Connected 27 benefit set.
 *   Varsity Collection moved OFF Connected booths 203+205 onto 405+407 but kept
 *                     an agreement naming both. Booth 205 has since been bought
 *                     by Kotmo, who has their own agreement for it.
 *
 * Runs the same two functions moveBoothsCore now calls, so this repairs the data
 * and exercises the fix at once. Idempotent: the add no-ops on a booth already
 * tracked, the remove no-ops on an agreement that never named the booth.
 *
 * ⚠️ Deliberately does not touch any agreement's status or tier. Varsity are a
 * paying exhibitor; whether two $4,000 booths still constitute a sponsorship is
 * a human decision, not this script's.
 *
 *   npx tsx scripts/repair-booth-move-sponsor-agreements.mts
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

const { createAdminClient } = await import("../lib/supabase/admin");
const { createSponsorAgreementFromBoothPurchase, removeBoothFromSponsorAgreements } = await import(
  "../lib/sponsorship/booth-agreement"
);

const CONFERENCE_ID = "7e650b08-51d1-4573-a332-7d6b6fbc50bd";

const db = createAdminClient();

async function orgId(name: string): Promise<string> {
  const { data } = await db.from("organizations").select("id").eq("name", name).single();
  if (!data) throw new Error(`org not found: ${name}`);
  return data.id;
}

async function boothByName(name: string) {
  const { data } = await db
    .from("conference_entities")
    .select("id, name, price_cents")
    .eq("conference_id", CONFERENCE_ID)
    .eq("kind", "booth")
    .eq("name", name)
    .single();
  if (!data) throw new Error(`booth not found: ${name}`);
  return data;
}

async function show(label: string, organizationId: string) {
  const { data } = await db
    .from("sponsor_agreements")
    .select("id, status, custom_benefits, tier:sponsor_tiers(name)")
    .eq("organization_id", organizationId);
  console.log(`\n  ${label}:`);
  if (!data?.length) {
    console.log("    (no agreements)");
    return;
  }
  for (const a of data) {
    const tier = (a as unknown as { tier: { name: string } | null }).tier?.name ?? "—";
    const booths = (Array.isArray(a.custom_benefits) ? a.custom_benefits : [])
      .map((b: { label?: string }) => b?.label ?? "?")
      .join("; ");
    console.log(`    [${a.status}] ${tier} — ${booths || "no booth benefits"}`);
  }
}

// ── MV Sport: owed an agreement for the Connected booth they moved onto ──
const mvSport = await orgId("MV Sport");
const booth306 = await boothByName("306");
await show("MV Sport BEFORE", mvSport);
await createSponsorAgreementFromBoothPurchase({
  organizationId: mvSport,
  boothEntityId: booth306.id,
  boothEntityName: booth306.name,
  boothPriceCents: booth306.price_cents!,
});
await show("MV Sport AFTER", mvSport);

// ── Varsity Collection: drop the two booths they moved away from ──
const varsity = await orgId("Varsity Collection");
await show("Varsity BEFORE", varsity);
for (const name of ["203", "205"]) {
  const booth = await boothByName(name);
  await removeBoothFromSponsorAgreements({ organizationId: varsity, boothEntityId: booth.id });
}
await show("Varsity AFTER", varsity);

console.log("\nDone. Statuses and tiers untouched.\n");
