/**
 * Revoke the stale org_admin seat on McGraw Hill.
 *
 *   npx tsx scripts/revoke-mcgraw-andres-admin.mts           # dry run
 *   npx tsx scripts/revoke-mcgraw-andres-admin.mts --apply   # writes
 *
 * Steve, 2026-10-06: "Yeah, kill it and give it to Meghan." Then, on being told
 * the grant sends an immediate magic-link invite: "Revoke put her on the list,
 * we aren't sending the email until Friday."
 *
 * So this REVOKES ONLY. Meghan is not invited and no email goes to anyone.
 *
 * ⛔ Writes status "rejected", NOT "inactive".
 *
 * deactivateOrgUser (lib/actions/user-management.ts) writes "inactive", which is
 * in neither `MembershipStatus` ("active" | "pending" | "rejected") nor the
 * `user_organizations_status_check` constraint. That write is REJECTED BY THE
 * DATABASE, so the admin UI's deactivate-user action cannot work in production
 * and returns "Failed to deactivate user" every time. Reported to Steve; not
 * fixed here, since this script is not the place for it.
 *
 * All 796 rows in the table are "active", so the enum could not be inferred from
 * the data — it came from the constraint and the type union.
 *
 * ⛔ Deliberately bypasses the last-org-admin guard. deactivateOrgUser refuses
 * to remove an org's only admin, which is a good invariant; here the whole point
 * is that the only admin should not be one. McGraw Hill is left with zero admins
 * on purpose until Meghan is invited after Friday's send. Nothing is lost: this
 * account was created by import on 2026-02-05 and has NEVER been signed into.
 *
 * ⛔ Does not delete the row or the auth account. Status is reversible;
 * reactivateOrgUser flips it straight back.
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const { createAdminClient } = await import("../lib/supabase/admin");

const APPLY = process.argv.includes("--apply");
const LINK_ID = "62587be8-b369-4b72-bfb9-b933a5777202";
const USER_ID = "140fbc71-b38c-436e-8a8f-ded5996c34b2";
const db = createAdminClient();

const { data: link, error } = await db
  .from("user_organizations")
  .select("id, user_id, organization_id, role, status, organizations(name)")
  .eq("id", LINK_ID)
  .maybeSingle();
if (error) throw new Error(`lookup: ${error.message}`);
if (!link) throw new Error(`link ${LINK_ID} not found — refusing to guess`);
if (link.user_id !== USER_ID) throw new Error("link belongs to a different user — refusing");

const org = Array.isArray(link.organizations) ? link.organizations[0] : link.organizations;
console.log(`link    : ${link.id}`);
console.log(`org     : ${org?.name}`);
console.log(`role    : ${link.role}`);
console.log(`status  : ${link.status} -> rejected`);

if (!APPLY) { console.log("\nDRY RUN — nothing written. Re-run with --apply."); process.exit(0); }
if (link.status !== "active") { console.log("\nalready not active, nothing to do."); process.exit(0); }

const { error: upErr } = await db
  .from("user_organizations")
  .update({ status: "rejected", updated_at: new Date().toISOString() })
  .eq("id", LINK_ID);
if (upErr) throw new Error(`update failed: ${upErr.message}`);

const { data: after } = await db
  .from("user_organizations")
  .select("status").eq("id", LINK_ID).maybeSingle();
console.log(`\nrevoked. status is now: ${after?.status}`);

const { data: remaining } = await db
  .from("user_organizations")
  .select("user_id").eq("organization_id", link.organization_id!)
  .eq("role", "org_admin").eq("status", "active");
console.log(`McGraw Hill active org_admins: ${remaining?.length ?? 0} (zero is expected until Meghan is invited)`);
