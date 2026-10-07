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

/**
 * ⛔ Insert, and CHECK the error.
 *
 * This was an upsert with onConflict "conference_id,organization_id,entity_id".
 * entity_balances has no such unique constraint — only a primary key on id — so
 * every call failed, and because the error was never read the script reported
 * six happy personas while granting nothing. The presenter then showed as
 * blocked from proposing, which is the bug it was seeded to disprove.
 */
async function grantBalance(conf, orgId, purchaseId, entityId) {
  const { data: existing } = await db
    .from("entity_balances")
    .select("id")
    .eq("conference_id", conf)
    .eq("organization_id", orgId)
    .eq("entity_id", entityId)
    .maybeSingle();
  if (existing) return;
  const { data: balance, error } = await db
    .from("entity_balances")
    .insert({
      conference_id: conf,
      organization_id: orgId,
      purchase_id: purchaseId,
      entity_id: entityId,
      quantity: 1,
    })
    .select("id")
    .single();
  if (error) throw new Error(`grant balance ${entityId} to ${orgId}: ${error.message}`);

  /*
   * ⛔ A BALANCE WITHOUT A SEAT IS NOT A PURCHASE.
   *
   * The real mint writes entity_balance_seats alongside the balance, one row
   * per unit, and the org page's assignment columns are built from SEATS —
   * listEntitySeatsForOrg, not balances. Granting only the balance produced a
   * fixture that held the right things and still rendered no checkbox column,
   * which reads exactly like "a paying partner cannot assign anyone".
   *
   * Fourth fixture-shaped false finding in one session. Each time the fixture
   * was missing a row a surface keys off — grants, contacts, now seats — and
   * each time the missing row looked like a product defect. Mirror what the
   * mint writes, not what the test happens to care about.
   */
  const { error: seatErr } = await db.from("entity_balance_seats").insert({
    conference_id: conf,
    organization_id: orgId,
    balance_id: balance.id,
    entity_id: entityId,
    seat_index: 1,
  });
  if (seatErr) throw new Error(`seat for ${entityId}: ${seatErr.message}`);
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

    /*
     * ⛔ A PERSONA WITHOUT A CONTACT ROW IS NOT A CUSTOMER.
     *
     * The org page's roster — the table carrying the per-entity assignment
     * checkboxes — renders only when `contacts.length > 0`. A login plus a
     * user_organizations link is not enough: every real org reaches that page
     * with people on it, and these personas reached it with none.
     *
     * The cost was a false bug report. Walking this fixture showed no roster
     * and no sign of the $1,250 the org had "bought", and I wrote that up as
     * "a paying partner cannot see or assign what they bought" — a defect that
     * does not exist. Bookware has two contacts and gets the full table.
     *
     * Third fixture-shaped false finding in one session, same shape each time:
     * the fixture differed from the real org in a way the page keys off, so
     * the answer did not transfer. A persona has to look like a customer in
     * every field a surface reads, not just the ones the test is about.
     */
    const personName = `Test ${persona.key}`;
    const { error: contactErr } = await db.from("contacts").insert({
      organization_id: org.id,
      profile_id: userId,
      name: personName,              // NOT NULL — omitting it failed the whole insert silently
      first_name: "Test",
      last_name: persona.key,
      email: addr,
      is_primary: true,
    });
    // ⛔ Read the error. The first version of this swallowed it and reported
    // six happy personas while creating zero contacts, which is the exact
    // failure this file's header already warns about for grants.
    if (contactErr) throw new Error(`contact ${addr}: ${contactErr.message}`);

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
    await grantBalance(conf, byKey.presenter.orgId, purchase.id, slot.id);
  }

  /*
   * ⛔ THE PRESENTER MUST ALSO HOLD THE $1,000 PLACE, OR THE FIXTURE IS NOT A
   * CUSTOMER.
   *
   * It held only the slot, which no real buyer does: Bookware bought the
   * Operations Partner place AND the Presentations slot in one $1,412.50
   * order on 2026-10-07, and that is the obvious shape — you buy your way
   * into the room, then buy the right to pitch in it.
   *
   * The gap mattered. Every question about what a Big Ideas partner SEES —
   * the assignment grid, the exhibitor checklist, the meeting picker — was
   * being asked of a fixture holding half of what the real org holds, so the
   * answers did not transfer. Testing against it proved nothing, which is the
   * same failure this file's header already describes for Test Org (Partner).
   */
  if (ops) {
    const { data: placePurchase } = await db
      .from("entity_purchases")
      .insert({ conference_id: conf, offer_entity_id: ops.id, quantity: 1, buyer: MARKER })
      .select("id")
      .single();
    await grantBalance(conf, byKey.presenter.orgId, placePurchase.id, ops.id);
  }

  // The registered member needs something that reaches the session.
  const fullConf = await entityByName(conf, "Full Conference Registration");
  if (fullConf) {
    const { data: purchase } = await db
      .from("entity_purchases")
      .insert({ conference_id: conf, offer_entity_id: fullConf.id, quantity: 1, buyer: MARKER })
      .select("id")
      .single();
    await grantBalance(conf, byKey.memberIn.orgId, purchase.id, fullConf.id);
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
