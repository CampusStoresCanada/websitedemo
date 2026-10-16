"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getServerAuthState } from "@/lib/auth/server";
import { canEditOrganization } from "@/lib/auth/permissions";
import { CERTIFICATION_NAMES, CANCOLL_CERT } from "@/lib/certifications";
import { ORG_TYPE } from "@/lib/constants/org-types";
import { mirrorFieldsToMembership } from "@/lib/membership/mirror";

interface UpdateCertificationsResult {
  success: boolean;
  error?: string;
}

/**
 * Update certifications for an organization.
 * Org admins can update their own org. Admins/super admins can update any.
 */
export async function updateCertifications(
  orgId: string,
  certifications: string[]
): Promise<UpdateCertificationsResult> {
  const auth = await getServerAuthState();

  if (!auth.user) {
    return { success: false, error: "Not authenticated" };
  }

  // Same question every other org write asks: does this person administrate
  // this org? `canEditOrganization` is that question — it reads the org LINK
  // role, exactly like updateField's canManageOrganization.
  //
  // ⛔ This used to additionally require hasPermission(permissionState,
  // "org_admin"), and that conjunct rejected every Vendor Partner org admin:
  // derivePermissionState resolves them to "partner" (level 1, below
  // org_admin's 3) because the partner program carries orgAdminElevates:
  // false. Partners are the entire audience for these badges, and the toggle
  // grid renders off the org link role, so the chips were live, the save was
  // refused, and the optimistic flip rolled back — reported as "editing
  // certifications just doesn't work" (GROSCHE, 2026-09-18). Every other
  // field on the same page saved fine, because no other action consults
  // permissionState. This was the only one that did.
  if (!canEditOrganization(auth.globalRole, auth.organizations, orgId)) {
    return { success: false, error: "Insufficient permissions" };
  }

  const supabase = createAdminClient();

  // CANCOLL shares this array but is NOT in CERTIFICATION_NAMES — it's
  // admin-managed (updateCancollStatus is now its only writer), not
  // self-declared. It used to reach the validation below and fail it, rejecting
  // the ENTIRE save: the 9 partners whose array carries "CANCOLL" could not
  // toggle any badge at all. Strip it from the incoming list, validate the rest,
  // then restore whatever the row actually holds — so this path can neither
  // grant nor revoke CANCOLL, which is the property the validation was
  // protecting in the first place.
  const declared = certifications.filter((c) => c !== CANCOLL_CERT.name);

  const invalid = declared.filter((c) => !CERTIFICATION_NAMES.includes(c));
  if (invalid.length > 0) {
    return { success: false, error: `Unknown certifications: ${invalid.join(", ")}` };
  }

  const { data: existing, error: readError } = await supabase
    .from("organizations")
    .select("certifications")
    .eq("id", orgId)
    .single();

  if (readError) {
    console.error("[updateCertifications] read error:", readError);
    return { success: false, error: "Failed to update certifications" };
  }

  const hadCancoll =
    Array.isArray(existing?.certifications) &&
    (existing.certifications as string[]).includes(CANCOLL_CERT.name);

  const next = hadCancoll ? [CANCOLL_CERT.name, ...declared] : declared;

  const { error } = await supabase
    .from("organizations")
    .update({ certifications: next })
    .eq("id", orgId);

  if (error) {
    console.error("[updateCertifications] DB error:", error);
    return { success: false, error: "Failed to update certifications" };
  }

  return { success: true };
}

/**
 * Update CANCOLL status for an organization.
 * Admin/super_admin only.
 */
export async function updateCancollStatus(
  orgId: string,
  isCancollMember: boolean
): Promise<UpdateCertificationsResult> {
  const auth = await getServerAuthState();

  if (!auth.user) {
    return { success: false, error: "Not authenticated" };
  }

  const isAdmin = auth.globalRole === "admin" || auth.globalRole === "super_admin";
  if (!isAdmin) {
    return { success: false, error: "Admin access required" };
  }

  const supabase = createAdminClient();

  // `type` decides whether the badge string is written (see below), and the
  // current array lets CANCOLL be added or removed without disturbing the
  // self-declared badges beside it. `name` and the previous flag are read for
  // the audit row.
  const { data: org, error: readError } = await supabase
    .from("organizations")
    .select("name, type, certifications, is_cancoll_member")
    .eq("id", orgId)
    .maybeSingle();

  if (readError || !org) {
    console.error("[updateCancollStatus] read error:", readError);
    return { success: false, error: "Failed to update CANCOLL status" };
  }

  const previousValue = org.is_cancoll_member === true;
  const current: string[] = Array.isArray(org.certifications) ? (org.certifications as string[]) : [];

  // ⛔ The literal "CANCOLL" belongs in `organizations.certifications` on
  // VENDOR PARTNERS ONLY. That array is publicly visible, and lib/homepage.ts's
  // fetchMapOrgsWithBenchmarking selects it viewer-agnostic and cached — so a
  // string written onto a member store rides out in the map payload to every
  // visitor. The reciprocal gate (lib/visibility/cancoll.ts) runs on the
  // org-page read path and would not catch it there. This write used to be
  // unconditional, which is why it had no member-side caller it could safely
  // have: this branch is what makes one possible.
  //
  // Withholding it costs the member nothing. The array is how PartnerProfile
  // renders the badge; every member-facing surface reads the boolean instead.
  // It matches the live rows exactly — all 12 partner holders carry both, and
  // all 51 member plus 2 non-member holders carry the boolean alone.
  //
  // Stated as an invariant rather than a skip, so the string is also cleaned
  // off a non-partner that somehow acquired it: present iff partner AND in the
  // group.
  const badgeString = org.type === ORG_TYPE.vendorPartner && isCancollMember;
  const nextCerts = badgeString
    ? current.includes(CANCOLL_CERT.name) ? current : [...current, CANCOLL_CERT.name]
    : current.filter((c) => c !== CANCOLL_CERT.name);
  const certificationsChanged = nextCerts.length !== current.length;

  const { error } = await supabase
    .from("organizations")
    .update({
      is_cancoll_member: isCancollMember,
      ...(certificationsChanged ? { certifications: nextCerts } : {}),
    })
    .eq("id", orgId);

  if (error) {
    console.error("[updateCancollStatus] DB error:", error);
    return { success: false, error: "Failed to update CANCOLL status" };
  }

  // Phase 4 Stage 2a: mirror into `memberships` ahead of the Stage 2 billing
  // cutover. Deliberately mirrors `is_cancoll_member` only — this path does
  // not touch `cancoll_tier` on `organizations`, so the mirror must not
  // either, or the two tables would disagree in the opposite direction.
  // `memberships.is_cancoll_member` is NOT NULL and drift is 0; this call is
  // what keeps it there.
  await mirrorFieldsToMembership(
    orgId,
    { is_cancoll_member: isCancollMember },
    { source: "updateCancollStatus" }
  );

  // Record what changed, in updateField's shape so both paths read the same
  // way. Until now this one wrote nothing at all while the generic Toolkit
  // path audited every field it touched — so a CANCOLL grant or revocation
  // left no trace of who did it, which is why a roster reconciliation had to
  // hand-insert its own rows to account for itself. CANCOLL feeds pricing, so
  // "who put this store in the purchasing group, and when" is a question that
  // gets asked.
  //
  // Awaited rather than fired and forgotten: a server action's floating
  // promises are not guaranteed to finish, and the row existing is the whole
  // point. A failed insert is logged and never fails the saved edit.
  const { error: auditError } = await supabase.from("audit_log").insert({
    action: "field.update",
    entity_type: "organizations",
    entity_id: orgId,
    actor_id: auth.user.id,
    actor_type: "user",
    details: {
      table: "organizations",
      column: "is_cancoll_member",
      previous_value: previousValue,
      new_value: isCancollMember,
      organization_id: orgId,
      entity_name: org.name,
      changed_by_email: auth.user.email ?? null,
      mirrored_to_membership: true,
      // Whether the public badge string moved with the flag — false on a
      // member store by design, so a reader can tell the two cases apart
      // without re-deriving the org type.
      certifications_updated: certificationsChanged || undefined,
    },
  });

  if (auditError) {
    console.warn("[updateCancollStatus] audit write failed:", auditError.message);
  }

  return { success: true };
}
