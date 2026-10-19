"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireAuthenticated } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { membershipCoversConference } from "@/lib/conference/membership-gate";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { loadBursaryApplications } from "@/lib/conference/bursary-widget";
import { isBursaryStatus, type BursaryStatus } from "@/lib/conference/bursary-status";

type Result<T> = { success: true; data: T } | { success: false; error: string };

// Every Bronze+ sponsorship commits $500 toward member travel — the pitch's
// own line. "Raised" is derived from sponsor_agreements, not a separate
// ledger: the money is already collected the moment the booth purchase that
// spawned the agreement completes, so draft agreements count too, not just
// ones an admin has gotten around to formally activating.
const BURSARY_AMOUNT_PER_SPONSOR_CENTS = 50000;

/** Public: the bursary "thermometer" — no auth required. */
export async function getBursaryProgress(
  conferenceId: string
): Promise<Result<{ goalCents: number | null; raisedCents: number; sponsorCount: number }>> {
  const db = createAdminClient();

  const [{ data: conference }, { data: tiers }] = await Promise.all([
    db.from("conference_instances").select("bursary_goal_cents").eq("id", conferenceId).maybeSingle(),
    db.from("sponsor_tiers").select("id").in("slug", ["bronze-27", "silver-27", "gold-27"]),
  ]);

  const tierIds = (tiers ?? []).map((t) => t.id);
  if (tierIds.length === 0) {
    return { success: true, data: { goalCents: conference?.bursary_goal_cents ?? null, raisedCents: 0, sponsorCount: 0 } };
  }

  const { count } = await db
    .from("sponsor_agreements")
    .select("id", { count: "exact", head: true })
    .in("tier_id", tierIds)
    .in("status", ["draft", "active"]);

  const sponsorCount = count ?? 0;

  return {
    success: true,
    data: {
      goalCents: conference?.bursary_goal_cents ?? null,
      raisedCents: sponsorCount * BURSARY_AMOUNT_PER_SPONSOR_CENTS,
      sponsorCount,
    },
  };
}

/**
 * Member-only, gated the same way a booth purchase is — the org's membership
 * has to cover this conference's dates. Vendor Partner orgs apply for
 * sponsorship, not this; this is the travel bursary for member institutions.
 */
export async function submitBursaryApplication(params: {
  conferenceId: string;
  organizationId: string;
  contactName: string;
  contactEmail: string;
  notes?: string;
}): Promise<Result<{ id: string }>> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();

  const [{ data: org }, { data: conference }] = await Promise.all([
    db.from("organizations").select("type, membership_expires_at").eq("id", params.organizationId).maybeSingle(),
    db.from("conference_instances").select("end_date").eq("id", params.conferenceId).maybeSingle(),
  ]);

  if (org?.type !== "Member") {
    return { success: false, error: "The delegate travel bursary is for CSC member institutions." };
  }
  if (!conference?.end_date || !membershipCoversConference(org.membership_expires_at, conference.end_date)) {
    return { success: false, error: "Your organization's membership needs to cover this conference's dates to apply." };
  }

  const { data: existing } = await db
    .from("conference_bursary_applications")
    .select("id")
    .eq("conference_id", params.conferenceId)
    .eq("organization_id", params.organizationId)
    .maybeSingle();
  if (existing) return { success: true, data: { id: existing.id } };

  const { data, error } = await db
    .from("conference_bursary_applications")
    .insert({
      conference_id: params.conferenceId,
      organization_id: params.organizationId,
      submitted_by_user_id: auth.ctx.userId,
      contact_name: params.contactName,
      contact_email: params.contactEmail,
      notes: params.notes ?? null,
    })
    .select("id")
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, data: { id: data.id } };
}

/** Admin: review queue for the board. */
export async function listBursaryApplications(conferenceId: string): Promise<
  Result<
    Array<{
      id: string;
      organizationName: string;
      contactName: string;
      contactEmail: string;
      notes: string | null;
      status: string;
      createdAt: string;
    }>
  >
> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  try {
    const rows = await loadBursaryApplications(conferenceId);
    return {
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        organizationName: r.organizationName,
        contactName: r.contactName,
        contactEmail: r.contactEmail,
        notes: r.notes,
        status: r.status,
        createdAt: r.submittedOn ?? "",
      })),
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Failed to load applications." };
  }
}

/**
 * Admin: record the decision a human made on one application.
 *
 * Only the status moves. Nothing here evaluates eligibility, and no other
 * field of the application is editable from the review queue — what the
 * institution submitted is their statement, not ours to revise.
 */
export async function setBursaryApplicationStatus(params: {
  applicationId: string;
  status: BursaryStatus;
}): Promise<Result<null>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  if (!isBursaryStatus(params.status)) {
    return { success: false, error: `"${params.status}" isn't a bursary status.` };
  }

  const db = createAdminClient();

  // Read the prior status first so the audit row records the transition, not
  // just the destination.
  const { data: before } = await db
    .from("conference_bursary_applications")
    .select("status, conference_id, organization_id")
    .eq("id", params.applicationId)
    .maybeSingle();

  if (!before) return { success: false, error: "That application no longer exists." };
  if (before.status === params.status) return { success: true, data: null };

  const { error } = await db
    .from("conference_bursary_applications")
    .update({ status: params.status, updated_at: new Date().toISOString() })
    .eq("id", params.applicationId);

  if (error) return { success: false, error: error.message };

  await logAuditEventSafe({
    action: "bursary_application_status_changed",
    entityType: "conference_bursary_application",
    entityId: params.applicationId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: {
      from: before.status,
      to: params.status,
      conferenceId: before.conference_id,
      organizationId: before.organization_id,
    },
  });

  revalidatePath("/admin");
  return { success: true, data: null };
}
