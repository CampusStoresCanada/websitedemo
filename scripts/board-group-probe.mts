/**
 * Read-only check of the board group against the people holding the role.
 *
 *   npx tsx scripts/board-group-probe.mts
 *
 * Adds nothing. Proves the query filter and the holder lookup agree with what
 * Google actually has, before the button is trusted to do it for real.
 *
 * With --run it performs the real sync, exactly as the button does. Safe when
 * the dry run above reports nobody to add: it is then two reads and a
 * telemetry write. Check that line first.
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
const { listGroupMembers, workspaceConfigured } = await import("../lib/google/directory");
const { groupRulesForBody } = await import("../lib/google/governance-group");
const { SPACE_RULE_COLUMNS } = await import("../lib/circle/space-rules");

const db = createAdminClient();
console.log("workspace configured:", workspaceConfigured());

// 1. The cron's query must now return only Circle rules.
const { data: cronRows, error } = await db
  .from("circle_space_rules")
  .select(SPACE_RULE_COLUMNS)
  .or("destination.is.null,destination.eq.circle_space");
if (error) throw new Error(`cron query failed: ${error.message}`);
console.log(
  "\ncron would load:",
  (cronRows ?? []).map((r) => `${r.label} [${r.destination ?? "null"}]`).join(", ") || "(none)"
);

// 2. The rules the button would run.
const rules = await groupRulesForBody(db, "board_of_directors");
console.log("button would run:", rules.map((r) => `${r.label} -> ${r.groupEmail}`).join(", ") || "(none)");

for (const rule of rules) {
  const today = new Date().toISOString().slice(0, 10);
  const { data: body } = await db.from("governance_bodies").select("id").eq("key", rule.bodyKey).maybeSingle();
  const { data: holders } = await db
    .from("governance_role_assignments")
    .select("person_contact_id, contacts(email)")
    .eq("body_id", body!.id)
    .eq("role_key", rule.roleKey)
    .lte("term_start", today)
    .or(`term_end.is.null,term_end.gt.${today}`);

  const wanted = [
    ...new Set(
      (holders ?? [])
        .map((h) => (h.contacts as { email?: string } | null)?.email?.toLowerCase())
        .filter((e): e is string => Boolean(e))
    ),
  ];
  const members = await listGroupMembers(rule.groupEmail);
  const present = new Set(members.map((m) => m.email));

  console.log(`\n--- ${rule.label} (${rule.groupEmail}) ---`);
  console.log(`holders of "${rule.roleKey}": ${wanted.length}`);
  console.log(`in the group: ${members.length}`);
  console.log(`would be ADDED by a press: ${wanted.filter((e) => !present.has(e)).join(", ") || "(nobody)"}`);
  const stale = members
    .filter((m) => !wanted.includes(m.email) && !m.email.endsWith("@campusstores.ca") && m.role === "MEMBER")
    .map((m) => m.email);
  console.log(`on the list holding no role: ${stale.length}`);
}

if (process.argv.includes("--run")) {
  const { syncGovernanceGroupNow, describeOutcome } = await import("../lib/google/governance-group");
  console.log("\n=== REAL RUN (what the button does) ===");
  for (const rule of rules) {
    const outcome = await syncGovernanceGroupNow(db, rule, rule.groupEmail);
    console.log(describeOutcome(outcome));
    console.log("verified:", outcome.verified, "| missing:", outcome.missing.length, "| failed:", outcome.failed.length);
  }
}
