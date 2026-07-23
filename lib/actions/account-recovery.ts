"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { ensurePersonForUser, ensureKnownPerson, linkUserToPerson } from "@/lib/identity/lifecycle";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { findUserByEmail } from "@/lib/supabase/user-lookup";

type RecoveryOutcome =
  | { outcome: "code_sent" }
  | { outcome: "not_recognized" }
  | { outcome: "error"; error: string };

/**
 * Entry point for /forgot-password. Handles both real password-reset
 * requests (account already exists) and first-time setup for someone who's
 * already a recognized contact at a member/partner org but has never logged
 * in on this site before -- previously a dead end: Supabase's
 * resetPasswordForEmail() always "succeeds" whether or not an account
 * exists, so these people would sit on the code-entry screen forever with
 * no code ever arriving, and no error telling them why.
 *
 * Deliberately does NOT use auth.admin.inviteUserByEmail() for the
 * first-time case -- that sends a magic-link invite, the same class of
 * cross-device / Exchange Safe Links failure the OTP-code reset flow was
 * built to get away from (see /forgot-password's own comments). Instead we
 * silently provision the account, then route through the exact same
 * already-working OTP flow a normal reset uses.
 */
export async function initiateAccountRecovery(rawEmail: string): Promise<RecoveryOutcome> {
  const email = rawEmail.trim().toLowerCase();
  if (!email) return { outcome: "error", error: "Email is required" };

  const adminClient = createAdminClient();

  const hasAccount = Boolean(await findUserByEmail(adminClient, email));

  if (!hasAccount) {
    const [{ data: byEmail }, { data: byWorkEmail }] = await Promise.all([
      adminClient
        .from("contacts")
        .select("id, name, organization_id, organizations!inner(archived_at)")
        .eq("email", email)
        .is("archived_at", null)
        .is("organizations.archived_at", null)
        .limit(1)
        .maybeSingle(),
      adminClient
        .from("contacts")
        .select("id, name, organization_id, organizations!inner(archived_at)")
        .eq("work_email", email)
        .is("archived_at", null)
        .is("organizations.archived_at", null)
        .limit(1)
        .maybeSingle(),
    ]);
    const contact = byEmail ?? byWorkEmail;

    if (!contact || !contact.organization_id) {
      return { outcome: "not_recognized" };
    }

    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { display_name: contact.name },
    });
    if (createErr || !created.user) {
      console.error("[initiateAccountRecovery] createUser failed", createErr);
      return { outcome: "error", error: "Could not set up your account. Please try again." };
    }
    const userId = created.user.id;

    await adminClient
      .from("profiles")
      .upsert({ id: userId, global_role: "user" }, { onConflict: "id" });

    const ensuredPerson = await ensurePersonForUser({
      userId,
      organizationId: contact.organization_id,
      fallbackEmail: email,
    });
    if (!ensuredPerson.personId) {
      const known = await ensureKnownPerson({
        organizationId: contact.organization_id,
        name: contact.name,
        email,
      });
      if (known.personId) {
        await linkUserToPerson({ userId, personId: known.personId });
      }
    }

    const { error: orgErr } = await adminClient.from("user_organizations").insert({
      user_id: userId,
      organization_id: contact.organization_id,
      role: "member",
      status: "active",
    });
    if (orgErr) {
      console.error("[initiateAccountRecovery] user_organizations insert failed", orgErr);
      return { outcome: "error", error: "Could not link your account to your organization." };
    }

    await logAuditEventSafe({
      action: "self_service_account_provisioned",
      entityType: "user",
      entityId: userId,
      actorId: userId,
      actorType: "user",
      details: { email, organization_id: contact.organization_id, matched_contact_id: contact.id },
    });
  }

  const { error: resetErr } = await adminClient.auth.resetPasswordForEmail(email);
  if (resetErr) {
    return { outcome: "error", error: resetErr.message };
  }

  return { outcome: "code_sent" };
}
