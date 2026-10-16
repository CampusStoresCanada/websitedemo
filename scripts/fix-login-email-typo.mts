/**
 * Correct a typo in an auth login email.
 *
 *   npx tsx scripts/fix-login-email-typo.mts           # dry run
 *   npx tsx scripts/fix-login-email-typo.mts --apply   # writes
 *
 * jbugorski@fanshawec.ca. has a TRAILING PERIOD. Resend rejects it outright
 * ("Invalid `to` field"), so it has failed on every send: the Rush Recap on
 * 2026-10-05 and the members explainer on 2026-10-09.
 *
 * ⛔ The send reads auth.users.email, via lookupUserEmailsByIds. Fixing the
 * contacts rows alone would NOT fix the send, which is why this exists.
 *
 * ⛔ This deliberately does NOT touch the two contacts rows. contacts.email and
 * contacts.work_email are in EDITABLE_COLUMNS, so updateField can change them
 * from the UI and write an audit row. A script cannot produce that audit row,
 * and org/contact data edited without a trail is a rule this project already
 * learned the hard way. Those two are Steve's edit.
 *
 * ⛔ And it does NOT merge the two duplicate contact rows. They share one
 * profile_id, so this is one person with a duplicate row rather than two
 * people, but which row is canonical is a human's call.
 *
 * email_confirm stays true: the account was created by import on 2026-02-05,
 * has NEVER been signed into, and was already confirmed. Re-confirming would
 * mail a stranger a confirmation link for an account they have never used.
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const { createAdminClient } = await import("../lib/supabase/admin");

const APPLY = process.argv.includes("--apply");
const USER_ID = "e6f05c87-b15b-4ae6-9449-685c4d2ee1b7";
const FROM = "jbugorski@fanshawec.ca.";
const TO = "jbugorski@fanshawec.ca";
const db = createAdminClient();

const { data: got, error: getErr } = await db.auth.admin.getUserById(USER_ID);
if (getErr || !got?.user) throw new Error(`lookup failed: ${getErr?.message ?? "no user"}`);
if (got.user.email !== FROM) {
  console.log(`already "${got.user.email}", not "${FROM}" — nothing to do.`);
  process.exit(0);
}
if (got.user.last_sign_in_at) {
  throw new Error("this account HAS been signed into — stop and confirm with a human before changing its login email");
}

// ⛔ Collision was verified directly in SQL before this ran: a scan of
// auth.users for 'jbugorski@fanshawec.ca%' returned exactly one row, the one
// with the trailing dot. An earlier draft "checked" this through an RPC that
// may not exist, wrapped in optional chaining that would have swallowed the
// failure and reported no clash either way. A check that cannot fail is worse
// than no check, because it reads as reassurance.

console.log(`user    : ${USER_ID}`);
console.log(`email   : "${FROM}"  ->  "${TO}"`);
console.log(`signed in: never (${got.user.created_at})`);
console.log(`⛔ contacts rows NOT touched — those are an audited UI edit.`);

if (!APPLY) { console.log("\nDRY RUN — nothing written. Re-run with --apply."); process.exit(0); }

const { error } = await db.auth.admin.updateUserById(USER_ID, { email: TO, email_confirm: true });
if (error) throw new Error(`update failed: ${error.message}`);

const { data: after } = await db.auth.admin.getUserById(USER_ID);
console.log(`\nnow: ${after?.user?.email}`);
