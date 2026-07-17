#!/usr/bin/env node
/**
 * Live proof of the v3 catalog model with composition + instances, on the real
 * DB. Wires the Booth scenario: a Booth (free kind) that INCLUDES things with
 * quantities (some of them Offers), is INVOLVED IN a session, references a
 * seeded day/audience, and is stamped as an instance via instance_of.
 * Self-contained; cleans up.
 *
 *   npm run check:entities-live
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

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
      name: "v3 Entities Live-Check", year: 9997, edition_code: "V3", status: "draft",
      timezone: "America/Toronto", start_date: "9997-03-04", end_date: "9997-03-05",
    });
    conferenceId = conf.id;

    // Freeform kinds — "booth", "equipment", "registration", "ticket" are not a fixed enum.
    const booth = await ent(conferenceId, "booth", "Standard Booth", { size: "8'×10'" }, { is_for_sale: true, price_cents: 250000 });
    const table = await ent(conferenceId, "equipment", "6'×2' Table", { spec: "6'×2'" });
    const chairs = await ent(conferenceId, "equipment", "Folding Chair");
    // Coined inline → a stub awaiting definition (open question).
    const exhibReg = await ent(conferenceId, "registration", "Exhibitor Registration", {}, { is_for_sale: true, price_cents: 0, needs_definition: true });
    const networking = await ent(conferenceId, "ticket", "Networking Ticket", {}, { is_for_sale: true, price_cents: 5000 });
    const tradeShow = await ent(conferenceId, "session", "Trade Show", { start_time: "10:00", end_time: "16:00" });
    const day = await ent(conferenceId, "day", "Wed, Mar 4", { date: "9997-03-04" });
    const members = await ent(conferenceId, "audience", "Member", { source_role: "member" });

    // Composition: a Booth includes things WITH QUANTITY (some are Offers).
    await link(conferenceId, booth.id, table.id, "includes", 1);
    await link(conferenceId, booth.id, chairs.id, "includes", 2);
    await link(conferenceId, booth.id, exhibReg.id, "includes", 4);
    await link(conferenceId, booth.id, networking.id, "includes", 1);
    // Participation + when/who.
    await link(conferenceId, booth.id, tradeShow.id, "involved_in");
    await link(conferenceId, tradeShow.id, day.id, "when");
    await link(conferenceId, tradeShow.id, members.id, "who");

    // Type → instance: stamp Booth 601 pointing at the Booth type.
    const booth601 = await ent(conferenceId, "booth", "Booth 601", { number: "601" });
    await link(conferenceId, booth601.id, booth.id, "instance_of");

    // Read the Booth's outgoing graph back.
    const { data: boothRefs } = await db
      .from("conference_entity_refs")
      .select("role, quantity, to:conference_entities!conference_entity_refs_to_entity_id_fkey(name, is_for_sale)")
      .eq("from_entity_id", booth.id);

    const includes = (boothRefs ?? []).filter((r) => r.role === "includes");
    const qtyByName = Object.fromEntries(includes.map((r) => [r.to?.name, r.quantity]));
    const involved = (boothRefs ?? []).filter((r) => r.role === "involved_in").map((r) => r.to?.name);

    assert("Booth includes 4 things with the right quantities",
      qtyByName["6'×2' Table"] === 1 && qtyByName["Folding Chair"] === 2 && qtyByName["Exhibitor Registration"] === 4 && qtyByName["Networking Ticket"] === 1,
      qtyByName);
    assert("Some included things are themselves Offers (Offer within an Offer)",
      includes.filter((r) => r.to?.is_for_sale).map((r) => r.to?.name).sort().join() === "Exhibitor Registration,Networking Ticket",
      includes.map((r) => ({ n: r.to?.name, sale: r.to?.is_for_sale })));
    assert("Booth is involved in the Trade Show session", involved.join() === "Trade Show", involved);

    // The session's own backward references resolve.
    const { data: tsRefs } = await db
      .from("conference_entity_refs")
      .select("role, to:conference_entities!conference_entity_refs_to_entity_id_fkey(name, attributes)")
      .eq("from_entity_id", tradeShow.id);
    const whenRef = (tsRefs ?? []).find((r) => r.role === "when");
    const whoRef = (tsRefs ?? []).find((r) => r.role === "who");
    assert("Trade Show → When resolves to the conference's Day (backward ref)", whenRef?.to?.attributes?.date === "9997-03-04", whenRef);
    assert("Trade Show → Who resolves to the inherited Member tier", whoRef?.to?.attributes?.source_role === "member", whoRef);

    // Instance points at its type.
    const { data: instRefs } = await db
      .from("conference_entity_refs")
      .select("role, to:conference_entities!conference_entity_refs_to_entity_id_fkey(name)")
      .eq("from_entity_id", booth601.id);
    const instOf = (instRefs ?? []).find((r) => r.role === "instance_of");
    assert("Booth 601 is an instance_of the Booth type", instOf?.to?.name === "Standard Booth", instOf);

    // Open-questions loop: the inline-coined registration is flagged for definition.
    const { data: stub } = await db
      .from("conference_entities")
      .select("needs_definition")
      .eq("id", exhibReg.id)
      .single();
    assert("Inline-coined thing is flagged needs_definition (open question)", stub?.needs_definition === true, stub);

    // Defining it clears the flag.
    await db.from("conference_entities").update({ needs_definition: false, price_cents: 15000 }).eq("id", exhibReg.id);
    const { data: defined } = await db
      .from("conference_entities")
      .select("needs_definition")
      .eq("id", exhibReg.id)
      .single();
    assert("Defining it clears the open question", defined?.needs_definition === false, defined);
  } finally {
    if (conferenceId) await db.from("conference_instances").delete().eq("id", conferenceId);
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
  if (failed.length > 0) {
    console.error("v3 entities live-check FAILED.");
    process.exit(1);
  }
  console.log("v3 entities live-check passed — things, plugged together.");
}

main().catch((err) => {
  console.error("v3 entities live-check error:", err.message ?? err);
  process.exit(1);
});
