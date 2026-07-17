#!/usr/bin/env node
/**
 * Live proof that the v3 loop closes on the real DB: sell an Offer → mint what
 * it includes (recursively, with quantity) → a holder resolves into what those
 * grants let them attend. Exercises the actual RPCs
 * (mint_entity_offer_purchase / resolve_holder_access). Self-contained; cleans up.
 *
 *   npm run check:entity-commerce-live
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* env may already be set */
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env/.env.local.");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const checks = [];
function assert(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${ok ? "" : `  → ${JSON.stringify(detail)}`}`);
}
async function insert(table, row, select = "id") {
  const { data, error } = await db.from(table).insert(row).select(select).single();
  if (error) throw new Error(`insert ${table}: ${error.message}`);
  return data;
}
const ent = (conferenceId, kind, name, attributes = {}, extra = {}) =>
  insert("conference_entities", { conference_id: conferenceId, kind, name, attributes, ...extra });
const link = (conferenceId, from, to, role, quantity = null) =>
  db.from("conference_entity_refs").insert({ conference_id: conferenceId, from_entity_id: from, to_entity_id: to, role, quantity });

async function main() {
  let conferenceId = null;
  try {
    const conf = await insert("conference_instances", {
      name: "v3 Commerce Live-Check", year: 9996, edition_code: "V3C", status: "draft",
      timezone: "America/Toronto", start_date: "9996-03-04", end_date: "9996-03-05",
    });
    conferenceId = conf.id;

    const day = await ent(conferenceId, "day", "Wed, Mar 4", { date: "9996-03-04" });
    const tradeShow = await ent(conferenceId, "session", "Trade Show", { start_time: "10:00", end_time: "16:00" });
    const reg = await ent(conferenceId, "registration", "Exhibitor Registration", {}, { is_for_sale: true, price_cents: 0 });
    const networking = await ent(conferenceId, "ticket", "Networking Ticket", {}, { is_for_sale: true, price_cents: 5000 });
    const table = await ent(conferenceId, "equipment", "6'×2' Table");
    const chair = await ent(conferenceId, "equipment", "Folding Chair");
    const booth = await ent(conferenceId, "booth", "Standard Booth", { size: "8'×10'" }, { is_for_sale: true, price_cents: 250000 });

    // Booth includes equipment + sellable grants; each reg is involved_in the
    // Trade Show and includes a Day.
    await link(conferenceId, booth.id, table.id, "includes", 1);
    await link(conferenceId, booth.id, chair.id, "includes", 2);
    await link(conferenceId, booth.id, reg.id, "includes", 4);
    await link(conferenceId, booth.id, networking.id, "includes", 1);
    await link(conferenceId, reg.id, tradeShow.id, "involved_in");
    await link(conferenceId, reg.id, day.id, "includes", 1);

    // SELL: buy one Booth.
    const { data: purchaseId, error: mintErr } = await db.rpc("mint_entity_offer_purchase", {
      p_conference_id: conferenceId, p_offer_id: booth.id, p_quantity: 1, p_buyer: "Acme Corp",
    });
    if (mintErr) throw new Error(`mint rpc: ${mintErr.message}`);

    const { data: balances } = await db
      .from("entity_balances")
      .select("entity_id, quantity")
      .eq("purchase_id", purchaseId);
    const qty = Object.fromEntries((balances ?? []).map((b) => [b.entity_id, b.quantity]));

    assert("Mint expands the Booth's includes with quantities", qty[table.id] === 1 && qty[chair.id] === 2 && qty[reg.id] === 4 && qty[networking.id] === 1, qty);
    // day/item/meal/suite are deliberately excluded from entity_balances by the
    // mint RPC — day access resolves per-person via seats (see the resolver
    // check below), not as a held quantity. Guard the exclusion, not a quantity.
    assert("Day is not tracked as a held balance (resolves via seats, not quantity)", qty[day.id] === undefined, { day: qty[day.id] });
    assert("The buyer also holds the Booth itself", qty[booth.id] === 1, { booth: qty[booth.id] });

    // FULFILL: locate the registration balance to allocate from. (The pre-B1
    // holder-string resolver `resolve_holder_access` was retired in the v3
    // cutover; access now resolves per real person via the seats they occupy,
    // exercised below.)
    const { data: regBalance } = await db
      .from("entity_balances")
      .select("id")
      .eq("purchase_id", purchaseId)
      .eq("entity_id", reg.id)
      .single();

    // FORK B / B1: the grant, held by a REAL person, resolves to their access.
    const { data: org } = await db.from("organizations").select("id").limit(1).maybeSingle();
    if (org) {
      const person = await insert("conference_people", {
        conference_id: conferenceId, organization_id: org.id,
        source_type: "manual", source_id: randomUUID(), person_kind: "delegate", display_name: "Jordan (person)",
      });
      // Allocation is per-SEAT: assign one of the registration balance's seats to the person.
      const { data: regSeat } = await db.from("entity_balance_seats").select("id").eq("balance_id", regBalance.id).limit(1).single();
      await db.from("entity_balance_seats").update({ holder_person_id: person.id }).eq("id", regSeat.id);
      const personAccess = await db.rpc("resolve_person_access", { p_conference_id: conferenceId, p_person_id: person.id });
      const personIds = new Set((personAccess.data ?? []).map((r) => r.entity_id));
      assert("Resolver works by real person via the seat they occupy", personIds.has(tradeShow.id) && personIds.has(day.id), [...personIds]);

      // B3: the obligations resolver reads what kinds a person holds via their seats.
      const { data: heldKinds } = await db
        .from("entity_balance_seats")
        .select("entity:conference_entities!entity_balance_seats_entity_id_fkey(kind)")
        .eq("conference_id", conferenceId)
        .eq("holder_person_id", person.id);
      const kinds = new Set((heldKinds ?? []).map((r) => (Array.isArray(r.entity) ? r.entity[0]?.kind : r.entity?.kind)).filter(Boolean));
      assert("A person's v3 seats resolve to their kinds (drives obligations)", kinds.has("registration"), [...kinds]);
    } else {
      console.log("  • (skipped person-resolver check — no organization in dev DB)");
    }

    // INVENTORY: a capped offer can't be oversold (guard lives in the mint RPC).
    const limited = await ent(conferenceId, "ticket", "VIP Pass", {}, { is_for_sale: true, price_cents: 10000, inventory: 2 });
    const buy = (q) => db.rpc("mint_entity_offer_purchase", { p_conference_id: conferenceId, p_offer_id: limited.id, p_quantity: q, p_buyer: "X", p_unit_price: 10000, p_buyer_tier: "public" });
    const b1 = await buy(1);
    const b2 = await buy(1);
    const b3 = await buy(1); // should be refused — only 2 exist
    assert("First two VIP passes mint fine", !b1.error && !b2.error, { b1: b1.error?.message, b2: b2.error?.message });
    assert("The third is refused — inventory guard blocks oversell", Boolean(b3.error) && /SOLD_OUT/.test(b3.error?.message ?? ""), b3.error?.message ?? "no error (BAD)");

    // PRICING: the recorded sale price + buyer tier round-trip on the purchase.
    const { data: vipPurchase } = await db
      .from("entity_purchases")
      .select("price_cents, buyer_tier")
      .eq("id", b1.data)
      .single();
    assert("Sale price + buyer tier are recorded on the purchase", vipPurchase?.price_cents === 10000 && vipPurchase?.buyer_tier === "public", vipPurchase);
  } finally {
    if (conferenceId) await db.from("conference_instances").delete().eq("id", conferenceId);
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
  if (failed.length > 0) {
    console.error("v3 commerce live-check FAILED.");
    process.exit(1);
  }
  console.log("v3 commerce live-check passed — sell, mint, resolve.");
}

main().catch((err) => {
  console.error("v3 commerce live-check error:", err.message ?? err);
  process.exit(1);
});
