/**
 * Switching off a person's link to an organisation.
 *
 * ⛔ ONE off switch, two callers: an org admin pressing Deactivate
 * (deactivateOrgUser) and the nightly run ending links whose date has passed
 * (expireOrgLinks, from the grace-check cron). Both mark the link inactive,
 * remove the person from the org's Circle spaces and write the audit row; a
 * second copy would drift on exactly those side effects.
 *
 * The email telling someone they were removed stays with the manual button —
 * an expiry was scheduled on purpose, and is not news.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueCircleSync } from "@/lib/circle/sync";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { orgLinkToday } from "@/lib/auth/org-link";

type AdminClient = ReturnType<typeof createAdminClient>;

export async function deactivateOrgLink(params: {
  db: AdminClient;
  linkId: string;
  userId: string;
  orgId: string;
  /** Null for the nightly run. */
  actorId: string | null;
  reason: "deactivated" | "expired";
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
    idempotencyKey: `${params.reason === "expired" ? "expire" : "deactivate"}:${userId}:${orgId}:${Date.now()}`,
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
