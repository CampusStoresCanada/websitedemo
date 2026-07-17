#!/usr/bin/env node
/**
 * Fork B · B2 live proof: a paid conference order mints v3 grants. Drives the
 * REAL process_conference_order_paid RPC (the one the Stripe webhook calls) with
 * an order line that references a v3 Offer, and asserts entity_balances appear,
 * are linked to the order line, and don't double-mint on webhook retry.
 * Self-contained; cleans up. Reuses an existing org + profile (FKs require them).
 *
 *   npm run check:checkout-v3-live
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

async function main() {
  const { data: org } = await db.from("organizations").select("id").limit(1).maybeSingle();
  const { data: profile } = await db.from("profiles").select("id").limit(1).maybeSingle();
  if (!org || !profile) {
    console.log("Skipped — need at least one organization and one profile in the dev DB.");
    return;
  }

  let conferenceId = null;
  try {
    const conf = await insert("conference_instances", {
      name: "v3 Checkout Live-Check", year: 9995, edition_code: "V3K", status: "registration_open",
      timezone: "America/Toronto", start_date: "9995-03-04", end_date: "9995-03-05",
    });
    conferenceId = conf.id;

    // A Booth Offer that includes 4 registrations.
    const reg = await insert("conference_entities", { conference_id: conferenceId, kind: "registration", name: "Exhibitor Registration", attributes: {}, is_for_sale: true, price_cents: 0 });
    const booth = await insert("conference_entities", { conference_id: conferenceId, kind: "booth", name: "Standard Booth", attributes: { size: "8'×10'" }, is_for_sale: true, price_cents: 250000 });
    await db.from("conference_entity_refs").insert({ conference_id: conferenceId, from_entity_id: booth.id, to_entity_id: reg.id, role: "includes", quantity: 4 });

    // A real pending order with a v3 Offer line (no product_id).
    const order = await insert("conference_orders", {
      conference_id: conferenceId, organization_id: org.id, user_id: profile.id,
      status: "pending", subtotal_cents: 250000, tax_cents: 0, total_cents: 250000,
    });
    const item = await insert("conference_order_items", {
      order_id: order.id, offer_entity_id: booth.id, quantity: 1,
      unit_price_cents: 250000, tax_cents: 0, total_cents: 250000,
    });

    // PAY — the exact RPC the Stripe webhook invokes.
    const { error: payErr } = await db.rpc("process_conference_order_paid", {
      p_order_id: order.id, p_checkout_session_id: "cs_test_b2", p_payment_intent_id: "pi_test_b2",
    });
    assert("process_conference_order_paid succeeds for an Offer line", !payErr, payErr?.message);

    const { data: paidOrder } = await db.from("conference_orders").select("status").eq("id", order.id).single();
    assert("Order is marked paid", paidOrder?.status === "paid", paidOrder);

    const { data: purchase } = await db
      .from("entity_purchases")
      .select("id, order_item_id, price_cents")
      .eq("order_item_id", item.id)
      .maybeSingle();
    assert("A v3 purchase was minted, linked to the order line", purchase?.order_item_id === item.id && purchase?.price_cents === 250000, purchase);

    const { data: balances } = await db
      .from("entity_balances")
      .select("entity_id, quantity")
      .eq("purchase_id", purchase?.id ?? "00000000-0000-0000-0000-000000000000");
    const qty = Object.fromEntries((balances ?? []).map((b) => [b.entity_id, b.quantity]));
    assert("The paid booth minted the booth + its 4 registrations", qty[booth.id] === 1 && qty[reg.id] === 4, qty);

    // Webhook retries are safe — re-running mints nothing new.
    await db.rpc("process_conference_order_paid", { p_order_id: order.id, p_checkout_session_id: "cs_test_b2", p_payment_intent_id: "pi_test_b2" });
    const { count } = await db
      .from("entity_purchases")
      .select("id", { count: "exact", head: true })
      .eq("order_item_id", item.id);
    assert("Re-running the paid RPC is idempotent (no double-mint)", count === 1, { count });

    // B2c: the order-from-cart RPC turns an Offer cart line into an offer order_item.
    await insert("cart_items", { conference_id: conferenceId, organization_id: org.id, user_id: profile.id, offer_entity_id: booth.id, quantity: 1 });
    const { data: cartOrder, error: cartErr } = await db.rpc("create_conference_order_from_cart", {
      p_user_id: profile.id, p_organization_id: org.id, p_conference_id: conferenceId,
      p_checkout_idempotency_key: `b2c-${randomUUID()}`, p_tax_rate_pct: 0, p_currency: "CAD",
      p_price_overrides: null, p_offer_prices: { [booth.id]: 200000 },
    });
    assert("order-from-cart RPC accepts an Offer cart line (no PRODUCT_NOT_FOUND)", !cartErr && Boolean(cartOrder?.id), cartErr?.message);
    if (cartOrder?.id) {
      const { data: offerItem } = await db
        .from("conference_order_items")
        .select("offer_entity_id, unit_price_cents")
        .eq("order_id", cartOrder.id)
        .maybeSingle();
      assert("Offer cart line → offer order_item at the tier price", offerItem?.offer_entity_id === booth.id && offerItem?.unit_price_cents === 200000, offerItem);
      assert("Order totals reflect the offer line", cartOrder.subtotal_cents === 200000, { subtotal: cartOrder.subtotal_cents });
    }

    // B4: minted balances carry the org and split into per-attendee SEATS.
    const { data: regBal } = await db
      .from("entity_balances")
      .select("id, organization_id, quantity")
      .eq("purchase_id", purchase.id)
      .eq("entity_id", reg.id)
      .maybeSingle();
    assert("Minted balances are stamped with the buyer org (for allocation)", regBal?.organization_id === org.id, regBal);

    const { data: regSeats } = await db
      .from("entity_balance_seats")
      .select("id, holder_person_id")
      .eq("balance_id", regBal.id);
    assert("The booth bundle's 4 registrations split into 4 allocatable seats", (regSeats ?? []).length === 4, { seats: (regSeats ?? []).length });

    // Two different staff get one registration seat each — the per-seat win.
    const a1 = await insert("conference_people", { conference_id: conferenceId, organization_id: org.id, source_type: "entitlement", source_id: randomUUID(), person_kind: "exhibitor", display_name: "Staffer A" });
    const a2 = await insert("conference_people", { conference_id: conferenceId, organization_id: org.id, source_type: "entitlement", source_id: randomUUID(), person_kind: "exhibitor", display_name: "Staffer B" });
    await db.from("entity_balance_seats").update({ holder_person_id: a1.id }).eq("id", regSeats[0].id);
    await db.from("entity_balance_seats").update({ holder_person_id: a2.id }).eq("id", regSeats[1].id);

    const { data: orgSeats } = await db
      .from("entity_balance_seats")
      .select("id, holder_person_id")
      .eq("conference_id", conferenceId)
      .eq("organization_id", org.id);
    const holders = new Set((orgSeats ?? []).map((s) => s.holder_person_id).filter(Boolean));
    assert("One bundle, two registrations allocated to two different attendees", holders.has(a1.id) && holders.has(a2.id), [...holders]);
    assert("Org holds booth + 4 registration seats to allocate", (orgSeats ?? []).length >= 5, { count: (orgSeats ?? []).length });
  } finally {
    if (conferenceId) await db.from("conference_instances").delete().eq("id", conferenceId);
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
  if (failed.length > 0) {
    console.error("v3 checkout live-check FAILED.");
    process.exit(1);
  }
  console.log("v3 checkout live-check passed — paid order mints v3 grants.");
}

main().catch((err) => {
  console.error("v3 checkout live-check error:", err.message ?? err);
  process.exit(1);
});
