/**
 * Fire the two flag messages at a named pair of people, and nobody else.
 *
 * ⛔ Butler's DMs had never been exercised end to end, because the only way to
 * see one was to raise or decide a real flag — which messages all six holders of
 * benchmarking.qa_verify and lands in a member's thread. So the link that went
 * nowhere and the decision that sent nothing both shipped unseen.
 *
 * This builds both messages from a REAL flag row and sends them to the two
 * addresses given, using the same ghost client the live path uses. It reads the
 * flag and writes nothing: no status, no resolved_by, no resolved_at. The room
 * is the pair, so it is a new conversation of its own and the reporter's thread
 * is untouched.
 *
 *   npx tsx scripts/flag-roundtrip-test-send.mts                 # dry run, prints only
 *   npx tsx scripts/flag-roundtrip-test-send.mts --send
 *   npx tsx scripts/flag-roundtrip-test-send.mts --send --to a@x.ca,b@y.ca
 *   npx tsx scripts/flag-roundtrip-test-send.mts --send --flag <uuid>
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
const flagOf = (name: string): string | null => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
};

const SEND = argv.includes("--send");
const TO = (flagOf("--to") ?? "google@campusstores.ca,sean.bell@uleth.ca")
  .split(",")
  .map((e) => e.trim())
  .filter(Boolean);
const FLAG_ID = flagOf("--flag");

/*
  ⛔ Imported after env is in place. flag-message is a plain module, but the
  Circle client and the Supabase admin client both read env at module scope.
*/
const { buildFlagDm, buildFlagDecisionDm } = await import("../lib/circle/flag-message");
const { fieldKeyFromSelector } = await import("../lib/circle/flag-routing");
const { getCircleGhostClient } = await import("../lib/circle/client");
const { createAdminClient } = await import("../lib/supabase/admin");

/*
  ⛔ NOT NEXT_PUBLIC_APP_URL. .env.local sets it to http://localhost:3000, so a
  test send run from a laptop would have put localhost links in Sean's Circle
  inbox — a message whose whole purpose is a link he can click. The point of
  this script is the real link, so the live host is the default and a local one
  has to be asked for by name.
*/
const APP_URL = flagOf("--app-url") ?? "https://www.campusstores.ca";
const db = createAdminClient();

/* A real survey report, so the wording and the link are the real ones. */
let q = db
  .from("flags")
  .select("id, page_url, note, priority, flagger_id, flagger_name, element_selector, element_content")
  .like("page_url", "%/benchmarking/survey%")
  .order("created_at", { ascending: false })
  .limit(1);
if (FLAG_ID) q = db
  .from("flags")
  .select("id, page_url, note, priority, flagger_id, flagger_name, element_selector, element_content")
  .eq("id", FLAG_ID)
  .limit(1);

const { data: rows } = await q;
const flag = (rows ?? [])[0] as Record<string, unknown> | undefined;
if (!flag) {
  console.error("No survey flag found to build a message from.");
  process.exit(1);
}

/* The reporter's member store, the same way the queue derives it. */
let orgId: string | null = null;
if (flag.flagger_id) {
  const { data: links } = await db
    .from("user_organizations")
    .select("organizations!inner(id, type)")
    .eq("user_id", flag.flagger_id as string)
    .eq("status", "active");
  for (const l of (links ?? []) as unknown as Record<string, unknown>[]) {
    const org = l.organizations as { id?: string; type?: string } | null;
    if (org?.type === "Member" && org.id) orgId = org.id;
  }
}

const fieldKey = fieldKeyFromSelector(flag.element_selector as string | null);
const who = (flag.flagger_name as string | null)?.trim() || "A CSC member";

const opening = buildFlagDm({
  priorityLabel: flag.priority === "high" ? "🔴 HIGH PRIORITY" : "🟡 Normal priority",
  who,
  note: (flag.note as string | null) ?? null,
  elementContent: (flag.element_content as string | null) ?? null,
  survey: true,
  issueLink: `${APP_URL}/benchmarking/admin/issues?flag=${flag.id}`,
  reviewLink: `${APP_URL}${flag.page_url}`,
});

const decision = buildFlagDecisionDm({
  status: "resolved",
  who: who.split(/\s+/)[0],
  actor: "Stephen Thomas",
  elementContent: (flag.element_content as string | null) ?? null,
});

const header = `[TEST of the flag round trip, sent to ${TO.join(" and ")} only. Nothing was resolved and nobody else was messaged.]`;
const surveyLink = orgId
  ? `${APP_URL}/benchmarking/survey?org=${orgId}${fieldKey ? `#field-${fieldKey}` : ""}`
  : "(no member store on the reporter, so no submission link)";

console.log(`\nFlag:        ${flag.id}`);
console.log(`Reporter:    ${who}`);
console.log(`Field:       ${fieldKey ?? "(positional selector, no field name)"}`);
console.log(`Queue link:  ${APP_URL}/benchmarking/admin/issues?flag=${flag.id}`);
console.log(`Survey link: ${surveyLink}`);
console.log(`\n--- 1. when it is raised ---\n${opening}`);
console.log(`\n--- 2. when it is decided ---\n${decision}`);

if (!SEND) {
  console.log(`\nDry run. Add --send to put these in Circle for ${TO.join(", ")}.`);
  process.exit(0);
}

const ghost = getCircleGhostClient();
if (!ghost) {
  console.error("Circle is not configured in this environment, so nothing can be sent.");
  process.exit(1);
}
for (const [label, text] of [["raised", opening], ["decided", decision]] as const) {
  const res = await ghost.sendGroupDirectMessage(TO, `${header}\n\n${text}`);
  console.log(`\n${label}: ${res.success ? `sent (room ${res.chatRoomUuid ?? "?"})` : `FAILED — ${res.error}`}`);
}
