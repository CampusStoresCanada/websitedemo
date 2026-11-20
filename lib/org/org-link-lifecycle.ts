/**
 * Switching off a person's link to an organisation.
 *
 * ⛔ ONE off switch, three callers: an org admin pressing Deactivate
 * (deactivateOrgUser), the nightly run ending links whose date has passed
 * (expireOrgLinks, from the grace-check cron), and removing a contact
 * (endOrgLinkForRemovedContact, from deleteContact). All mark the link
 * inactive, remove the person from the org's Circle spaces and write the audit
 * row; a second copy would drift on exactly those side effects.
 *
 * The email telling someone they were removed stays with the manual button —
 * an expiry was scheduled on purpose, and is not news.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueCircleSync } from "@/lib/circle/sync";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { orgLinkToday } from "@/lib/auth/org-link";

type AdminClient = ReturnType<typeof createAdminClient>;

const IDEMPOTENCY_PREFIX = {
  deactivated: "deactivate",
  expired: "expire",
  contact_removed: "contact-removed",
} as const;

/**
 * Would switching this person off leave the organisation with no admin?
 * False for anyone who is not an active org admin there.
 */
export async function isLastOrgAdmin(db: AdminClient, orgId: string, userId: string, role: string): Promise<boolean> {
  if (role !== "org_admin") return false;
  const { count } = await db
    .from("user_organizations")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("role", "org_admin")
    .eq("status", "active")
    .neq("user_id", userId);
  return (count ?? 0) < 1;
}

export async function deactivateOrgLink(params: {
  db: AdminClient;
  linkId: string;
  userId: string;
  orgId: string;
  /** Null for the nightly run. */
  actorId: string | null;
  reason: "deactivated" | "expired" | "contact_removed";
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { db, linkId, userId, orgId } = params;
  const { error } = await db
    .from("user_organizations")
    .update({ status: "inactive", updated_at: new Date().toISOString() })
    .eq("id", linkId);
  if (error) return { ok: false, error: error.message };

  await enqueueCircleSync({
    operation: "remove_from_space",
    entityType: "contact",
    entityId: userId,
    payload: { orgId },
    orgId,
    idempotencyKey: `${IDEMPOTENCY_PREFIX[params.reason]}:${userId}:${orgId}:${Date.now()}`,
  });

  await logAuditEventSafe({
    action: "organization_user_deactivated",
    entityType: "organization",
    entityId: orgId,
    actorId: params.actorId,
    actorType: params.actorId ? "user" : "system",
    details: { orgId, targetUserId: userId, reason: params.reason },
  });
  return { ok: true };
}

/** What happened to the login of a contact who was just removed. */
export type RemovedContactLogin =
  | "ended"
  | "no_login"
  /** The person removing them is the person: they would lock themselves out. */
  | "kept_own_login"
  /** The same login still belongs to another live contact at this organisation. */
  | "kept_other_contact"
  /** Admin has to be handed over first, exactly as Deactivate insists. */
  | "kept_last_admin"
  | "failed";

/**
 * ⛔ Removing a contact ends their login to that organisation.
 *
 * It used to end everything except the login: the contact was archived, their
 * seats released and their Circle account removed, and they could still sign in
 * as a member of the store they had left (six at Laurier, 2026-11-20; three
 * departed admins switched off by hand, 2026-11-17).
 *
 * Same off switch as Deactivate and the nightly expiry, and like the expiry it
 * sends no email. Never throws, never blocks the removal: a login that is kept
 * is reported, not a reason to leave the person on the page.
 */
export async function endOrgLinkForRemovedContact(params: {
  db: AdminClient;
  contactId: string;
  /** The contact's `profile_id`: their login, if they have one. */
  profileId: string | null;
  orgId: string;
  actorId: string | null;
}): Promise<RemovedContactLogin> {
  const { db, contactId, profileId, orgId } = params;
  if (!profileId) return "no_login";
  try {
    const { data: link } = await db
      .from("user_organizations")
      .select("id, role")
      .eq("user_id", profileId)
      .eq("organization_id", orgId)
      .eq("status", "active")
      .maybeSingle();
    if (!link) return "no_login";
    if (params.actorId === profileId) return "kept_own_login";

    const { data: others } = await db
      .from("contacts")
      .select("id")
      .eq("profile_id", profileId)
      .eq("organization_id", orgId)
      .is("archived_at", null)
      .neq("id", contactId)
      .limit(1);
    if ((others ?? []).length > 0) return "kept_other_contact";

    if (await isLastOrgAdmin(db, orgId, profileId, link.role)) return "kept_last_admin";

    const off = await deactivateOrgLink({
      db,
      linkId: link.id,
      userId: profileId,
      orgId,
      actorId: params.actorId,
      reason: "contact_removed",
    });
    if (!off.ok) {
      console.error("[org-link] could not end a removed contact's login:", off.error);
      return "failed";
    }
    return "ended";
  } catch (error) {
    console.error("[org-link] could not end a removed contact's login:", error);
    return "failed";
  }
}

/**
 * End every active link whose date has passed. Run nightly.
 *
 * ⚠️ Each link on its own: one failure is counted and reported, never allowed to
 * stop the rest.
 */
export async function expireOrgLinks(
  now: Date = new Date()
): Promise<{ expired: number; failed: number; errors: string[] }> {
  const db = createAdminClient();
  const { data: links, error } = await db
    .from("user_organizations")
    .select("id, user_id, organization_id")
    .eq("status", "active")
    .lte("expires_at", orgLinkToday(now));
  if (error) return { expired: 0, failed: 0, errors: [error.message] };

  let expired = 0;
  const errors: string[] = [];
  for (const link of links ?? []) {
    const result = await deactivateOrgLink({
      db,
      linkId: link.id,
      userId: link.user_id,
      orgId: link.organization_id,
      actorId: null,
      reason: "expired",
    });
    if (result.ok) expired += 1;
    else errors.push(`${link.id}: ${result.error}`);
  }
  return { expired, failed: errors.length, errors };
}
