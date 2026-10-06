#!/usr/bin/env node
/**
 * Test identities for the Big Ideas Day page, one per edge case.
 *
 * The page renders seven different ways depending on who is reading it, and
 * the existing personas cover one of them. Worse, Test Org (Partner) holds a
 * Full Conference Registration left over from earlier testing — a member-only
 * offer a real partner could never buy — so it reads as "already in the room"
 * and hides the partner path entirely. Testing against it proves nothing.
 *
 * ⛔ Passwords are never written to this file or printed. The script writes the
 * persona list straight into .env.local, which is gitignored; this file is
 * tracked, so anything in it travels with every clone and stays in history.
 *
 *   node scripts/seed-big-ideas-test-identities.mjs --up
 *   node scripts/seed-big-ideas-test-identities.mjs --status
 *   node scripts/seed-big-ideas-test-identities.mjs --down
 *
 * ⚠️ Every org is created with is_test = true, which is what keeps them out of
 * audiences, exports and partner counts — those all filter on it. Adding a test
 * org to a real offer's direct_purchase_org_ids is therefore harmless to live
 * sends, and is the only way to exercise the named-list gate.
 */

import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const MARKER = "BI-TEST";
const ENV_PATH = ".env.local";

/** One per way the page can render. */
const PERSONAS = [
  { key: "ops", name: "Test Org (BI Ops Partner)", type: "Vendor Partner", label: "BI — Ops Partner ($1,000)" },
  { key: "publisher", name: "Test Org (BI Publisher)", type: "Vendor Partner", label: "BI — Publisher ($500)" },
  { key: "presenter", name: "Test Org (BI Presenter)", type: "Vendor Partner", label: "BI — Ops Partner with a slot" },
  { key: "uninvited", name: "Test Org (BI Uninvited Partner)", type: "Vendor Partner", label: "BI — Partner, not invited" },
  { key: "member", name: "Test Org (BI Member)", type: "Member", label: "BI — Member, unregistered" },
  { key: "memberIn", name: "Test Org (BI Member Registered)", type: "Member", label: "BI — Member, registered" },
];

const email = (key) => `bi.test.${key.toLowerCase()}@example.com`;

/** organizations.id and tenant_id have no defaults — both must be supplied. */
async function tenantId() {
  const { data } = await db.from("organizations").select("tenant_id").not("tenant_id", "is", null).limit(1).single();
  return data.tenant_id;
}

async function conferenceId() {
  const { data } = await db
    .from("conference_instances")
    .select("id")
    .in("status", ["registration_open", "sales_open", "published", "active"])
    .order("start_date", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (data?.id) return data.id;
  const { data: any } = await db.from("conference_instances").select("id").order("start_date", { ascending: false }).limit(1).single();
  return any.id;
}

async function entityByName(conf, name) {
  const { data } = await db.from("conference_entities").select("id, attributes").eq("conference_id", conf).eq("name", name).maybeSingle();
  return data ?? null;
}

async function up() {
  const conf = await conferenceId();
  const created = [];
  const tenant = await tenantId();
  const password = randomBytes(18).toString("base64url");

  for (const persona of PERSONAS) {
    // Org
    let { data: org } = await db.from("organizations").select("id").eq("name", persona.name).maybeSingle();
    if (!org) {
      const { data, error } = await db
        .from("organizations")
        .insert({
          id: randomUUID(),
          tenant_id: tenant,
          name: persona.name,
          slug: persona.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
          type: persona.type,
          membership_status: "active",
          is_test: true,
          province: "Ontario",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (error) throw new Error(`org ${persona.name}: ${error.message}`);
      org = data;
    }

    // Auth user. Password is reset every --up so the personas always work —
    // the stale one on test.member@example.com is what sent me looking.
    const addr = email(persona.key);
    let userId = null;
    const { data: createdUser, error: createErr } = await db.auth.admin.createUser({
      email: addr,
      password,
      email_confirm: true,
    });
    if (createErr) {
      // Already there — reset the password so the persona is usable.
      const { data: found } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
      const hit = found?.users?.find((u) => u.email === addr);
      if (!hit) throw new Error(`user ${addr}: ${createErr.message}`);
      await db.auth.admin.updateUserById(hit.id, { password });
      userId = hit.id;
    } else {
      userId = createdUser.user.id;
    }

    await db.from("user_organizations").upsert(
      { user_id: userId, organization_id: org.id, role: "org_admin", status: "active" },
      { onConflict: "user_id,organization_id" }
    );

    created.push({ ...persona, orgId: org.id, userId, email: addr });
  }

  // Named-list membership, so the gate can actually be exercised.
  const byKey = Object.fromEntries(created.map((c) => [c.key, c]));
  const ops = await entityByName(conf, "Big Ideas Day — Operations Partner");
  const pub = await entityByName(conf, "Big Ideas Day — Publisher");
  const slot = await entityByName(conf, "Big Ideas Presentations");

  if (ops) {
    const ids = new Set([...(ops.attributes?.direct_purchase_org_ids ?? []), byKey.ops.orgId, byKey.presenter.orgId]);
    await db.from("conference_entities").update({ attributes: { ...ops.attributes, direct_purchase_org_ids: [...ids] } }).eq("id", ops.id);
  }
  if (pub) {
    const ids = new Set([...(pub.attributes?.direct_purchase_org_ids ?? []), byKey.publisher.orgId]);
    await db.from("conference_entities").update({ attributes: { ...pub.attributes, direct_purchase_org_ids: [...ids] } }).eq("id", pub.id);
  }
  if (slot) {
    const ids = new Set([...(slot.attributes?.direct_purchase_org_ids ?? []), byKey.presenter.orgId]);
    await db.from("conference_entities").update({ attributes: { ...slot.attributes, direct_purchase_org_ids: [...ids] } }).eq("id", slot.id);
    // Give the presenter an actual slot, so the propose form unlocks.
    const { data: purchase } = await db
      .from("entity_purchases")
      .insert({ conference_id: conf, offer_entity_id: slot.id, quantity: 1, buyer: MARKER })
      .select("id")
      .single();
    await db.from("entity_balances").upsert(
      { conference_id: conf, organization_id: byKey.presenter.orgId, purchase_id: purchase.id, entity_id: slot.id, quantity: 1 },
      { onConflict: "conference_id,organization_id,entity_id" }
    );
  }

  // The registered member needs something that reaches the session.
  const fullConf = await entityByName(conf, "Full Conference Registration");
  if (fullConf) {
    const { data: purchase } = await db
      .from("entity_purchases")
      .insert({ conference_id: conf, offer_entity_id: fullConf.id, quantity: 1, buyer: MARKER })
      .select("id")
      .single();
    await db.from("entity_balances").upsert(
      { conference_id: conf, organization_id: byKey.memberIn.orgId, purchase_id: purchase.id, entity_id: fullConf.id, quantity: 1 },
      { onConflict: "conference_id,organization_id,entity_id" }
    );
  }

  writeEnv(created, password);
  console.log(`✓ ${created.length} personas ready. Passwords written to ${ENV_PATH} (gitignored), not printed.`);
  for (const c of created) console.log(`   ${c.label.padEnd(34)} ${c.email}`);
}

/** Merge the personas into NEXT_PUBLIC_DEV_ACCOUNTS without clobbering existing ones. */
function writeEnv(created, password) {
  const line = "NEXT_PUBLIC_DEV_ACCOUNTS=";
  let existing = [];
  let lines = [];
  if (existsSync(ENV_PATH)) {
    lines = readFileSync(ENV_PATH, "utf8").split("\n");
    const current = lines.find((l) => l.startsWith(line));
    if (current) {
      try { existing = JSON.parse(current.slice(line.length)); } catch { existing = []; }
    }
  }
  const kept = existing.filter((a) => !a.email?.startsWith("bi.test."));
  const next = [...kept, ...created.map((c) => ({ email: c.email, password, label: c.label }))];
  const rendered = line + JSON.stringify(next);
  const idx = lines.findIndex((l) => l.startsWith(line));
  if (idx >= 0) lines[idx] = rendered; else lines.push(rendered);
  writeFileSync(ENV_PATH, lines.join("\n"));
}

async function status() {
  const { data: orgs } = await db.from("organizations").select("id, name, type").like("name", "Test Org (BI %");
  console.log(`orgs: ${orgs?.length ?? 0}`);
  for (const o of orgs ?? []) console.log(`   ${o.type.padEnd(16)} ${o.name}`);
  const { count } = await db.from("entity_purchases").select("id", { count: "exact", head: true }).eq("buyer", MARKER);
  console.log(`seeded purchases: ${count ?? 0}`);
}

async function down() {
  const { data: orgs } = await db.from("organizations").select("id, name").like("name", "Test Org (BI %");
  const orgIds = (orgs ?? []).map((o) => o.id);

  // Pull the test orgs back out of every named list they were added to.
  const { data: gated } = await db
    .from("conference_entities")
    .select("id, attributes")
    .not("attributes->direct_purchase_org_ids", "is", null);
  for (const e of gated ?? []) {
    const ids = e.attributes?.direct_purchase_org_ids ?? [];
    const next = ids.filter((id) => !orgIds.includes(id));
    if (next.length !== ids.length) {
      await db.from("conference_entities").update({ attributes: { ...e.attributes, direct_purchase_org_ids: next } }).eq("id", e.id);
    }
  }

  const { data: purchases } = await db.from("entity_purchases").select("id").eq("buyer", MARKER);
  const purchaseIds = (purchases ?? []).map((p) => p.id);
  if (purchaseIds.length) {
    await db.from("entity_balance_seats").delete().in("balance_id",
      ((await db.from("entity_balances").select("id").in("purchase_id", purchaseIds)).data ?? []).map((b) => b.id));
    await db.from("entity_balances").delete().in("purchase_id", purchaseIds);
    await db.from("entity_purchases").delete().in("id", purchaseIds);
  }

  for (const key of PERSONAS.map((p) => p.key)) {
    const { data: found } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
    const hit = found?.users?.find((u) => u.email === email(key));
    if (hit) await db.auth.admin.deleteUser(hit.id);
  }
  if (orgIds.length) {
    await db.from("user_organizations").delete().in("organization_id", orgIds);
    await db.from("conference_topics").delete().in("organization_id", orgIds);
    await db.from("conference_topic_ballots").delete().in("organization_id", orgIds);
    await db.from("organizations").delete().in("id", orgIds);
  }
  console.log(`✓ removed ${orgIds.length} test orgs, ${purchaseIds.length} purchases, and their personas.`);
}

const mode = process.argv[2] ?? "--status";
const run = mode === "--up" ? up : mode === "--down" ? down : status;
run().catch((e) => { console.error(e); process.exit(1); });
