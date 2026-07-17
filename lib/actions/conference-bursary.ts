"use server";

import { requireAdmin, requireAuthenticated } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { membershipCoversConference } from "@/lib/conference/membership-gate";

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

  const db = createAdminClient();
  const { data, error } = await db
    .from("conference_bursary_applications")
    .select("id, contact_name, contact_email, notes, status, created_at, organizations(name)")
    .eq("conference_id", conferenceId)
    .order("created_at", { ascending: false });
  if (error) return { success: false, error: error.message };

  return {
    success: true,
    data: (data ?? []).map((r) => ({
      id: r.id,
      organizationName: r.organizations?.name ?? "",
      contactName: r.contact_name,
      contactEmail: r.contact_email,
      notes: r.notes,
      status: r.status,
      createdAt: r.created_at,
    })),
  };
}
