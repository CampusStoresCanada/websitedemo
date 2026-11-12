"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { attachLoginToContact } from "@/lib/identity/org-login";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { findUserByEmail } from "@/lib/supabase/user-lookup";
import { hasNonMemberTag } from "@/lib/contacts/tags";

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
        .select("id, name, organization_id, contact_type, organizations!inner(archived_at)")
        .eq("email", email)
        .is("archived_at", null)
        .is("organizations.archived_at", null)
        .limit(1)
        .maybeSingle(),
      adminClient
        .from("contacts")
        .select("id, name, organization_id, contact_type, organizations!inner(archived_at)")
        .eq("work_email", email)
        .is("archived_at", null)
        .is("organizations.archived_at", null)
        .limit(1)
        .maybeSingle(),
    ]);
    const contact = byEmail ?? byWorkEmail;

    // Non-member contacts (lapsed/prospect/conference-only/board/external
    // vendor) are tracked like any other contact but must never be able to
    // self-provision a real login this way.
    if (!contact || !contact.organization_id || hasNonMemberTag(contact.contact_type)) {
      return { outcome: "not_recognized" };
    }

    // The login is for the contact we just recognised them as. Nothing is
    // sent here; the code goes out through the normal reset below.
    const attached = await attachLoginToContact({
      orgId: contact.organization_id,
      email,
      role: "member",
      contactId: contact.id,
      displayName: contact.name,
      newAccount: "silent",
      ifAlreadyActive: "keep",
    });
    if (!attached.success || !attached.userId) {
      console.error("[initiateAccountRecovery] could not set up the login", attached.error);
      return {
        outcome: "error",
        error: attached.userId
          ? "Could not link your account to your organization."
          : "Could not set up your account. Please try again.",
      };
    }
    const userId = attached.userId;

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
