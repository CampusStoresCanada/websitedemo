/**
 * Read-only check of the board group against the people holding the role.
 *
 *   npx tsx scripts/board-group-probe.mts
 *   npx tsx scripts/board-group-probe.mts --as-of 2027-06-30
 *
 * Adds nothing, removes nothing. Proves the query filter and the holder lookup
 * agree with what Google actually has, before the button is trusted to do it
 * for real. `--as-of` is the date a press would carry: pass the end of the
 * conference to see what the standing-down press would do months early.
 *
 * With --run it performs the real sync the way the SEATING press does: adds
 * only. Safe when the dry run reports nobody to add — it is then two reads and
 * a telemetry write.
 *
 * ⛔ A removal only ever happens here for addresses named on the command line,
 * never for the people the dry run lists as holding no role. That set contains
 * a management company and a shared inbox that somebody put on the list
 * deliberately, and sweeping it from a script is how you find that out
 * afterwards. To exercise the path for real:
 *
 *   npx tsx scripts/board-group-probe.mts --run --remove someone@example.ca
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

const argv = process.argv.slice(2);
const flag = (name: string): string | null => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
};
const asOf = flag("as-of") ?? new Date().toISOString().slice(0, 10);
const removeArg = flag("remove");
const toRemove = removeArg ? removeArg.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean) : [];

const { createAdminClient } = await import("../lib/supabase/admin");
const { listGroupMembers, workspaceConfigured } = await import("../lib/google/directory");
const { groupRulesForBody } = await import("../lib/google/governance-group");
const { SPACE_RULE_COLUMNS } = await import("../lib/circle/space-rules");

const db = createAdminClient();
console.log("workspace configured:", workspaceConfigured());
console.log("as of:", asOf, asOf === new Date().toISOString().slice(0, 10) ? "(today)" : "(a date you passed)");

// 1. The cron's query must still return only Circle rules.
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
  const { data: body } = await db.from("governance_bodies").select("id").eq("key", rule.bodyKey).maybeSingle();
  const { data: holders } = await db
    .from("governance_role_assignments")
    .select("person_contact_id, contacts(email)")
    .eq("body_id", body!.id)
    .eq("role_key", rule.roleKey)
    .lte("term_start", asOf)
    .or(`term_end.is.null,term_end.gt.${asOf}`);

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
  console.log(`holders of "${rule.roleKey}" as of ${asOf}: ${wanted.length}`);
  console.log(`in the group: ${members.length}`);
  console.log(`would be ADDED by a press: ${wanted.filter((e) => !present.has(e)).join(", ") || "(nobody)"}`);
  const stale = members
    .filter((m) => !wanted.includes(m.email) && !m.email.endsWith("@campusstores.ca") && m.role === "MEMBER")
    .map((m) => m.email);
  console.log(`on the list holding no role: ${stale.length}${stale.length ? ` — ${stale.join(", ")}` : ""}`);
  console.log("  ⛔ reported only. A press removes the directors it listed as Leaving, not this set.");
  if (toRemove.length > 0)
    console.log(`named for removal on the command line: ${toRemove.filter((e) => present.has(e)).join(", ") || "(none of them are on the list)"}`);
}

if (argv.includes("--run")) {
  const { syncGovernanceGroupNow, describeOutcome } = await import("../lib/google/governance-group");
  console.log(`\n=== REAL RUN (asOf ${asOf}${toRemove.length ? `, removing ${toRemove.join(", ")}` : ", adds only"}) ===`);
  for (const rule of rules) {
    const outcome = await syncGovernanceGroupNow(db, rule, rule.groupEmail, {
      asOf,
      remove: toRemove.length > 0 ? toRemove : undefined,
    });
    console.log(describeOutcome(outcome));
    console.log(
      "verified:", outcome.verified,
      "| missing:", outcome.missing.length,
      "| still there:", outcome.stillThere.length,
      "| failed:", outcome.failed.length
    );
  }
}
