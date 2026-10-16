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

    // Check if a user with this email already exists in auth
    const existingUser = await findUserByEmail(adminClient, normalizedEmail);

    let userId: string;
    // The contact this login belongs to. Circle queue rows are keyed by
    // contact — entity_id used to be handed the auth user id instead, which
    // points at no contacts row at all, so every tool that joins on it (the
    // ops panel, the access-group reconcile) saw an orphan.
    let circleContactId: string | null = null;

    if (existingUser) {
      userId = existingUser.id;
      const ensuredPerson = await ensurePersonForUser({
        userId,
        organizationId: orgId,
        fallbackEmail: normalizedEmail,
      });
      // Link whichever contact we resolved — the freshly-matched one (most
      // trustworthy: it's this exact user's email in this exact org) if we
      // found one, otherwise the one syncIdentity resolved/created above.
      // Now that this is a real write (not the old no-op), it should run
      // whenever we have a contact in hand, not just as an email-lookup fallback.
      const linkPersonId = ensuredPerson.personId ?? knownPersonId;
      circleContactId = linkPersonId ?? null;
      if (linkPersonId) {
        await linkUserToPerson({ userId, personId: linkPersonId });
      }

      // Check if they're already a member of this org
      const { data: existingMembership } = await adminClient
        .from("user_organizations")
        .select("id, status")
        .eq("user_id", userId)
        .eq("organization_id", orgId)
        .maybeSingle();

      if (existingMembership) {
        if (existingMembership.status === "active") {
          return {
            success: false,
            outcome: "already_member",
            error: "User is already an active member of this organization",
          };
        }
        // Reactivate if inactive
        const { error: updateErr } = await adminClient
          .from("user_organizations")
          .update({ status: "active", role, updated_at: new Date().toISOString() })
          .eq("id", existingMembership.id);

        if (updateErr) {
          console.error("[provisionOrgLogin] Reactivation failed:", updateErr);
          return { success: false, error: "Failed to reactivate user membership" };
        }

        sendTransactional({
          templateKey: "org_user_added_to_org",
          to: normalizedEmail,
          variables: { user_name: normalizedEmail, org_name: orgRow.name ?? orgId, role },
        }).catch(() => {});
        return { success: true, outcome: "reactivated" };
      }
    } else {
      // Create a new auth user via invite (sends magic-link email)
      const { data: inviteData, error: inviteErr } =
        await adminClient.auth.admin.inviteUserByEmail(normalizedEmail);

      if (inviteErr || !inviteData.user) {
        console.error("[provisionOrgLogin] Invite failed:", inviteErr);
        return {
          success: false,
          error: inviteErr?.message ?? "Failed to send invite",
        };
      }

      userId = inviteData.user.id;

      // Create profile row if it doesn't exist
      const { error: profileErr } = await adminClient
        .from("profiles")
        .upsert(
          {
            id: userId,
            global_role: "user",
          },
          { onConflict: "id" }
        );

      if (profileErr) {
        console.error("[provisionOrgLogin] Profile creation failed:", profileErr);
        // Non-fatal: the profile trigger may handle this
      }

      const ensuredPerson = await ensurePersonForUser({
        userId,
        organizationId: orgId,
        fallbackEmail: normalizedEmail,
      });
      const linkPersonId = ensuredPerson.personId ?? knownPersonId;
      circleContactId = linkPersonId ?? null;
      if (linkPersonId) {
        await linkUserToPerson({ userId, personId: linkPersonId });
      }
    }

    // Create user_organizations row
    const { error: orgErr } = await adminClient
      .from("user_organizations")
      .insert({
        user_id: userId,
        organization_id: orgId,
        role,
        status: "active",
      });

    if (orgErr) {
      console.error("[provisionOrgLogin] user_organizations insert failed:", orgErr);
      return {
        success: false,
        error: orgErr.message.includes("duplicate")
          ? "User is already a member of this organization"
          : "Failed to add user to organization",
      };
    }

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
      outcome: existingUser ? "added_existing_account" : "invited",
    };
  } catch (err) {
    console.error("[provisionOrgLogin] Unexpected error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
