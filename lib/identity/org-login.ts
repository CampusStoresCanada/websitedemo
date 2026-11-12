import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueCircleSync } from "@/lib/circle/sync";
import { getAccessGroupIds } from "@/lib/circle/config";
import {
  ensureKnownPerson,
  ensurePersonForUser,
  linkUserToPerson,
  upsertPersonContact,
} from "@/lib/identity/lifecycle";
import { sendTransactional } from "@/lib/comms/send";
import { findUserByEmail } from "@/lib/supabase/user-lookup";

/**
 * What actually happened, for callers that need to distinguish outcomes
 * rather than parse `error` strings.
 */
export type InviteOutcome =
  | "invited"
  | "added_existing_account"
  | "reactivated"
  | "already_member";

export interface ProvisionOrgLoginResult {
  success: boolean;
  error?: string;
  outcome?: InviteOutcome;
}

/**
 * Create (or attach) the auth account and org membership behind an email,
 * sending the invite when the account is new.
 *
 * Unguarded — every caller must authorize first. It lives here rather than
 * inside the inviteOrgUser server action so the add-contact flow can share it
 * without going through a second identity sync.
 */
export async function provisionOrgLogin(params: {
  orgId: string;
  email: string;
  role: "member" | "org_admin";
  /**
   * Create the person + contact projection for this email before
   * provisioning. Callers that just wrote those records themselves pass
   * false: ensureKnownPerson overwrites title/work_phone/mobile_phone with
   * whatever it is handed, so re-running it here with only a name and email
   * would blank the details the caller just saved.
   */
  syncIdentity: boolean;
  /** Existing person to fall back to when linking. Used when syncIdentity is false. */
  personId?: string | null;
}): Promise<ProvisionOrgLoginResult> {
  const { orgId, role } = params;
  const adminClient = createAdminClient();
  const normalizedEmail = params.email.trim().toLowerCase();

  try {
    const { data: orgRow } = await adminClient
      .from("organizations")
      .select("id, name, tenant_id, circle_tag_id, type")
      .eq("id", orgId)
      .maybeSingle();

    if (!orgRow) {
      return { success: false, error: "Organization not found" };
    }

    let knownPersonId: string | null = params.personId ?? null;

    if (params.syncIdentity) {
      // Prefer an already-known real name over the raw email. A contact for
      // this email/org often already exists — e.g. an admin registering a
      // known person (by name) for a conference, which invites them under the
      // hood via resolveAssigneeForEmail() below. Passing the email as `name`
      // unconditionally used to overwrite that person's real contact name
      // with their email address on every invite, a confirmed real bug —
      // ensureKnownPerson's own existing-person match doesn't touch the name
      // field, but upsertPersonContact's existing-contact match does, and a
      // non-empty `name` here always wins over the record's real one.
      const { data: existingContact } = await adminClient
        .from("contacts")
        .select("name")
        .eq("organization_id", orgId)
        .or(`work_email.eq.${normalizedEmail},email.eq.${normalizedEmail}`)
        .limit(1)
        .maybeSingle();
      const knownName = existingContact?.name?.trim() || normalizedEmail;

      const knownPerson = await ensureKnownPerson({
        organizationId: orgId,
        tenantId: orgRow.tenant_id,
        name: knownName,
        email: normalizedEmail,
      });
      knownPersonId = knownPerson.personId;

      if (knownPerson.personId) {
        await upsertPersonContact({
          organizationId: orgId,
          personId: knownPerson.personId,
          name: knownName,
          email: normalizedEmail,
          contactType: ["directory"],
        });
      }
    }

    const attached = await attachLoginToContact({
      orgId,
      email: normalizedEmail,
      role,
      contactId: knownPersonId,
      newAccount: "magic_link",
      ifAlreadyActive: "refuse",
    });

    if (!attached.success || !attached.userId) {
      if (attached.membership === "already_active") {
        return {
          success: false,
          outcome: "already_member",
          error: "User is already an active member of this organization",
        };
      }
      return { success: false, error: attached.error ?? "Failed to add user to organization" };
    }

    const userId = attached.userId;
    const isNewAccount = attached.isNewAccount === true;

    if (attached.membership === "reactivated") {
      sendTransactional({
        templateKey: "org_user_added_to_org",
        to: normalizedEmail,
        variables: { user_name: normalizedEmail, org_name: orgRow.name ?? orgId, role },
      }).catch(() => {});
      return { success: true, outcome: "reactivated" };
    }

    // The contact this login belongs to. Circle queue rows are keyed by
    // contact — entity_id used to be handed the auth user id instead, which
    // points at no contacts row at all, so every tool that joins on it (the
    // ops panel, the access-group reconcile) saw an orphan.
    const circleContactId = attached.linkedContactId ?? null;

    // ── Circle: link, then group, then tag ───────────────────────────────────
    // This used to queue the tag alone. add_tag and add_to_access_group both
    // address the member by email, so against someone Circle has never seen
    // they 404 — which is what happened to every invite for a brand-new
    // person. link_member is find-or-create and runs first for that reason;
    // it is a no-op for anyone already linked. The access group was simply
    // missing, so an invited user got their org tag and never the Members or
    // Partners access that comes with it.
    const circleEntityId = circleContactId ?? userId;

    await enqueueCircleSync({
      operation: "link_member",
      entityType: "contact",
      entityId: circleEntityId,
      payload: { email: normalizedEmail, name: normalizedEmail },
      orgId,
      idempotencyKey: `invite-link:${circleEntityId}`,
    });

    const groupIds = getAccessGroupIds();
    const isPartner = orgRow.type?.toLowerCase().includes("partner") ?? false;
    const inviteGroupId = isPartner ? groupIds.partner : groupIds.member;

    if (inviteGroupId) {
      await enqueueCircleSync({
        operation: "add_to_access_group",
        entityType: "contact",
        entityId: circleEntityId,
        payload: { groupId: inviteGroupId, email: normalizedEmail },
        orgId,
        idempotencyKey: `invite-access:${circleEntityId}:${inviteGroupId}`,
      });
    }

    if (orgRow.circle_tag_id) {
      await enqueueCircleSync({
        operation: "add_tag",
        entityType: "contact",
        entityId: circleEntityId,
        payload: { tagId: Number(orgRow.circle_tag_id), email: normalizedEmail },
        orgId,
        idempotencyKey: `invite-tag:${circleEntityId}:${orgRow.circle_tag_id}`,
      });
    }

    sendTransactional({
      templateKey: "org_user_added_to_org",
      to: normalizedEmail,
      variables: { user_name: normalizedEmail, org_name: orgRow.name ?? orgId, role },
    }).catch(() => {});

    return {
      success: true,
      outcome: isNewAccount ? "invited" : "added_existing_account",
    };
  } catch (err) {
    console.error("[provisionOrgLogin] Unexpected error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export interface AttachLoginResult {
  success: boolean;
  error?: string;
  userId?: string;
  /** True when this call created the auth account. */
  isNewAccount?: boolean;
  /** What happened to the membership. "already_active" with success false
   *  means the caller asked to refuse an existing active member. */
  membership?: "created" | "reactivated" | "already_active";
  /** The contact now linked to this login (contacts.profile_id), if any. */
  linkedContactId?: string | null;
}

/**
 * Give a person a login at an organisation. THE one place this happens.
 *
 * Finds or creates the auth account for the email, links it to the contact
 * the caller names (contacts.profile_id), and makes sure the membership
 * exists with the role asked for. It sends nothing of its own except
 * Supabase's invite when `newAccount` is "magic_link"; which email a person
 * gets is the caller's business.
 *
 * ⛔ Why this exists: application approval, merge and account recovery each
 * used to do these steps by hand, and each linked the contact only when the
 * email lookup found nothing. That lookup always finds the contact the flow
 * had just written, so the link was never made: 24 of 230 org admins had no
 * linked contact on 2026-11-12. Commit 11c69c9b had fixed the same thing in
 * provisionOrgLogin alone. Every path that gives someone a login goes through
 * here so the link cannot be forgotten by a new one.
 *
 * The contact the caller names wins. The email lookup is only a fallback for
 * a caller that has none, never a reason to link a different row: with two
 * contacts on one address it would pick whichever came back first.
 *
 * Unguarded — every caller must authorize first.
 */
export async function attachLoginToContact(params: {
  orgId: string;
  email: string;
  role: "member" | "org_admin";
  /** The contact this login IS. */
  contactId: string | null;
  /** Display name for a brand-new account. */
  displayName?: string | null;
  /**
   * How a brand-new account is created:
   *  - "magic_link": Supabase emails its own invite (staff invites).
   *  - "silent": nothing is sent; the caller delivers its own 6-digit code
   *    (approval, recovery), because magic links break in Outlook Safe Links.
   */
  newAccount: "magic_link" | "silent";
  /** An active membership already at this org: leave it as it is ("keep"),
   *  or stop and report it ("refuse"). */
  ifAlreadyActive: "keep" | "refuse";
}): Promise<AttachLoginResult> {
  const adminClient = createAdminClient();
  const email = params.email.trim().toLowerCase();
  if (!email) return { success: false, error: "An email address is required" };

  // 1. The account.
  let userId: string;
  let isNewAccount = false;
  const existingUser = await findUserByEmail(adminClient, email);
  if (existingUser) {
    userId = existingUser.id;
  } else if (params.newAccount === "magic_link") {
    const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email);
    if (error || !data.user) {
      console.error("[attachLoginToContact] Invite failed:", error);
      return { success: false, error: error?.message ?? "Failed to send invite" };
    }
    userId = data.user.id;
    isNewAccount = true;
  } else {
    const { data, error } = await adminClient.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: params.displayName ? { display_name: params.displayName } : undefined,
    });
    if (error || !data.user) {
      console.error("[attachLoginToContact] createUser failed:", error);
      return { success: false, error: error?.message ?? "Could not create the account" };
    }
    userId = data.user.id;
    isNewAccount = true;
  }

  if (isNewAccount) {
    const { error: profileErr } = await adminClient
      .from("profiles")
      .upsert({ id: userId, global_role: "user" }, { onConflict: "id" });
    // Non-fatal: the profile trigger may handle this.
    if (profileErr) console.error("[attachLoginToContact] Profile creation failed:", profileErr);
  }

  // 2. The link: this login IS this contact.
  const linkedContactId =
    params.contactId ??
    (await ensurePersonForUser({ userId, organizationId: params.orgId, fallbackEmail: email })).personId;
  if (linkedContactId) {
    await linkUserToPerson({ userId, personId: linkedContactId });
  }

  // 3. The membership.
  const { data: membership } = await adminClient
    .from("user_organizations")
    .select("id, status")
    .eq("user_id", userId)
    .eq("organization_id", params.orgId)
    .maybeSingle();

  if (membership?.status === "active") {
    return params.ifAlreadyActive === "refuse"
      ? {
          success: false,
          error: "User is already an active member of this organization",
          userId,
          isNewAccount,
          membership: "already_active",
          linkedContactId,
        }
      : { success: true, userId, isNewAccount, membership: "already_active", linkedContactId };
  }

  if (membership) {
    // ⛔ Clears any old end date too: a temp whose link expired and is invited
    // back would otherwise be reactivated straight into a date already past,
    // and still locked out.
    const { error } = await adminClient
      .from("user_organizations")
      .update({ status: "active", role: params.role, expires_at: null, updated_at: new Date().toISOString() })
      .eq("id", membership.id);
    if (error) {
      console.error("[attachLoginToContact] Reactivation failed:", error);
      return { success: false, error: "Failed to reactivate user membership" };
    }
    return { success: true, userId, isNewAccount, membership: "reactivated", linkedContactId };
  }

  const { error: insertErr } = await adminClient
    .from("user_organizations")
    .insert({ user_id: userId, organization_id: params.orgId, role: params.role, status: "active" });
  if (insertErr) {
    console.error("[attachLoginToContact] user_organizations insert failed:", insertErr);
    return {
      success: false,
      error: insertErr.message.includes("duplicate")
        ? "User is already a member of this organization"
        : "Failed to add user to organization",
    };
  }
  return { success: true, userId, isNewAccount, membership: "created", linkedContactId };
}
