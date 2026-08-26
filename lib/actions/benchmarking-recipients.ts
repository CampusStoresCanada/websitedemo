"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated, isGlobalAdmin } from "@/lib/auth/guards";

/**
 * Recipient confirmation — who actually receives the survey at each store.
 *
 * Writes go through createAdminClient(): the session client holds SELECT only,
 * and a GRANT without a matching write policy returns zero rows with
 * error:null, which reads as success and quietly loses the rep's work.
 */

async function verifyRep(): Promise<{
  ok: boolean;
  userId?: string;
  isAdmin?: boolean;
  error?: string;
}> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { ok: false, error: "Not signed in" };
  const admin = isGlobalAdmin(auth.ctx.globalRole);
  if (admin) return { ok: true, userId: auth.ctx.userId, isAdmin: true };
  if (!auth.ctx.capabilities.includes("benchmarking.recipient_confirm")) {
    return { ok: false, error: "Recipient confirmation access required" };
  }
  return { ok: true, userId: auth.ctx.userId, isAdmin: false };
}

async function verifyAdmin(): Promise<{
  ok: boolean;
  userId?: string;
  error?: string;
}> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { ok: false, error: "Not signed in" };
  if (!isGlobalAdmin(auth.ctx.globalRole)) {
    return { ok: false, error: "Admin access required" };
  }
  return { ok: true, userId: auth.ctx.userId };
}

/**
 * Create one queue row per active member store for this survey, seeding each
 * with our current best guess at the contact. Idempotent — re-running adds
 * only stores that joined since.
 */
export async function seedRecipientQueue(
  surveyId: string,
): Promise<{ success: boolean; created?: number; error?: string }> {
  const auth = await verifyAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();

  const { data: orgs, error: orgErr } = await db
    .from("organizations")
    .select("id")
    .eq("type", "Member")
    .eq("membership_status", "active")
    .or("is_test.is.null,is_test.eq.false");

  if (orgErr) {
    console.error("[recipients] seed org read failed:", orgErr);
    return { success: false, error: "Could not read member stores" };
  }

  const { data: existing } = await db
    .from("benchmarking_recipients")
    .select("organization_id")
    .eq("survey_id", surveyId);

  const have = new Set((existing ?? []).map((r) => r.organization_id));
  const missing = (orgs ?? []).filter((o) => !have.has(o.id));
  if (missing.length === 0) return { success: true, created: 0 };

  // Best guess at the contact: their primary, if they have one.
  const { data: primaries } = await db
    .from("contacts")
    .select("id, organization_id")
    .in(
      "organization_id",
      missing.map((o) => o.id),
    )
    .eq("is_primary", true)
    .is("archived_at", null);

  const primaryByOrg = new Map(
    (primaries ?? []).map((c) => [c.organization_id, c.id]),
  );

  const { error: insErr } = await db.from("benchmarking_recipients").insert(
    missing.map((o) => ({
      survey_id: surveyId,
      organization_id: o.id,
      contact_id: primaryByOrg.get(o.id) ?? null,
      // No primary contact means nobody to even guess at — that one goes
      // straight to the office rather than sitting in a rep's queue going stale.
      status: primaryByOrg.has(o.id) ? "unconfirmed" : "escalated",
    })),
  );

  if (insErr) {
    console.error("[recipients] seed insert failed:", insErr);
    return { success: false, error: "Could not create the queue" };
  }

  revalidatePath("/benchmarking/recipients");
  return { success: true, created: missing.length };
}

/** Hand a whole region to one rep in a single move. */
export async function assignRegion(
  surveyId: string,
  region: string,
  repId: string | null,
): Promise<{ success: boolean; assigned?: number; error?: string }> {
  const auth = await verifyAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();

  const { data: orgs } = await db
    .from("organizations")
    .select("id, province")
    .eq("type", "Member")
    .eq("membership_status", "active");

  // Rep patches, which are NOT the same buckets the comparison uses.
  //
  // Comparison groups by province because a province is a regulatory
  // jurisdiction — Ontario stores operate under Ontario rules, and that is a
  // real peer group whatever the headcount. A rep patch is a different thing
  // entirely: it is a workload and a set of relationships, and Quebec's two
  // member stores are not a patch. They ride with Atlantic.
  //
  // Keep these two maps separate. Collapsing them would either give a rep a
  // two-store round or destroy a legitimate comparison group.
  const REGION: Record<string, string[]> = {
    "Atlantic & Quebec": [
      "Newfoundland and Labrador",
      "Nova Scotia",
      "New Brunswick",
      "Prince Edward Island",
      "Quebec",
    ],
    Ontario: ["Ontario"],
    Prairies: ["Manitoba", "Saskatchewan", "Alberta"],
    West: ["British Columbia", "Yukon", "Northwest Territories", "Nunavut"],
  };
  const provinces = REGION[region] ?? [];
  const orgIds = (orgs ?? [])
    .filter((o) => provinces.includes(o.province ?? ""))
    .map((o) => o.id);

  if (orgIds.length === 0) return { success: true, assigned: 0 };

  const { error } = await db
    .from("benchmarking_recipients")
    .update({ assigned_to: repId })
    .eq("survey_id", surveyId)
    .in("organization_id", orgIds);

  if (error) {
    console.error("[recipients] assignRegion failed:", error);
    return { success: false, error: "Could not assign the region" };
  }

  revalidatePath("/benchmarking/recipients");
  return { success: true, assigned: orgIds.length };
}

/**
 * A rep's answer on one store. "I don't know" is a first-class outcome — much
 * better than a guess, and it routes the store back to the office.
 */
export async function resolveRecipient(input: {
  recipientId: string;
  outcome: "confirmed" | "corrected" | "unknown";
  contactId?: string | null;
  note?: string | null;
}): Promise<{ success: boolean; error?: string }> {
  const auth = await verifyRep();
  if (!auth.ok || !auth.userId) return { success: false, error: auth.error };

  if (
    (input.outcome === "confirmed" || input.outcome === "corrected") &&
    !input.contactId
  ) {
    return { success: false, error: "Pick the person first" };
  }

  const db = createAdminClient();
  const { error } = await db
    .from("benchmarking_recipients")
    .update({
      status: input.outcome === "unknown" ? "escalated" : input.outcome,
      contact_id:
        input.outcome === "unknown" ? null : (input.contactId ?? null),
      note: input.note?.trim() || null,
      confirmed_by: auth.userId,
      confirmed_at: new Date().toISOString(),
    })
    .eq("id", input.recipientId);

  if (error) {
    console.error("[recipients] resolve failed:", error);
    return { success: false, error: "Could not save" };
  }

  revalidatePath("/benchmarking/recipients");
  revalidatePath("/benchmarking/committee");
  return { success: true };
}

/**
 * Send the invitations.
 *
 * Admin-only, not rep-only. A regional rep may confirm who the right person is
 * at a store — that is the job — but putting mail into 52 inboxes is a
 * different act, and there is no undo on it.
 *
 * Safe to run twice: the send skips anyone already invited, so the natural
 * response to a partial failure (run it again) does not double-mail the stores
 * that succeeded the first time.
 */
export async function sendInvitations(input: {
  surveyId: string;
  betaOnly?: boolean;
}): Promise<{
  success: boolean;
  error?: string;
  sent?: number;
  failed?: number;
  failures?: { organizationName: string; error?: string }[];
}> {
  const auth = await verifyRep();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!auth.isAdmin) {
    return { success: false, error: "Only an administrator can send the survey invitations." };
  }

  const { sendBenchmarkingInvitations } = await import("@/lib/benchmarking/notify");
  const summary = await sendBenchmarkingInvitations(input.surveyId, {
    betaOnly: input.betaOnly,
  });

  revalidatePath("/benchmarking/recipients");
  return {
    success: true,
    sent: summary.sent,
    failed: summary.failed,
    // Surfaced, never swallowed: a store with no address on file is the most
    // common failure and it is also the most actionable one.
    failures: summary.outcomes
      .filter((o) => !o.sent)
      .map((o) => ({ organizationName: o.organizationName, error: o.error })),
  };
}

/**
 * Chase the stores that have not filed.
 *
 * Skips anyone who has submitted and anyone who was never successfully invited.
 * A draft is not a submission — someone who saved and walked away is exactly
 * who this is for.
 */
export async function sendReminders(input: { surveyId: string }): Promise<{
  success: boolean;
  error?: string;
  sent?: number;
  failed?: number;
  skipped?: number;
  failures?: { organizationName: string; error?: string }[];
}> {
  const auth = await verifyRep();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!auth.isAdmin) {
    return { success: false, error: "Only an administrator can send reminders." };
  }

  const { sendBenchmarkingReminders } = await import("@/lib/benchmarking/notify");
  const summary = await sendBenchmarkingReminders(input.surveyId);

  revalidatePath("/benchmarking/recipients");
  return {
    success: true,
    sent: summary.sent,
    failed: summary.failed,
    skipped: summary.skipped,
    failures: summary.outcomes
      .filter((o) => !o.sent)
      .map((o) => ({ organizationName: o.organizationName, error: o.error })),
  };
}

/**
 * Who would be mailed, without mailing anyone.
 *
 * Reads the same plan the send consumes, so what the operator approves is
 * literally the list that goes out — not a similar list built by a second
 * query that could drift from it.
 */
export async function previewSend(input: {
  surveyId: string;
  kind: "invitation" | "reminder";
  betaOnly?: boolean;
}): Promise<{
  success: boolean;
  error?: string;
  plan?: {
    fiscalYear: number;
    surveyStatus: string;
    templateKey: string;
    killSwitchOn: boolean;
    willSend: { organizationName: string; contactName: string; to: string | null }[];
    blocked: { organizationName: string; blockedReason?: string }[];
  };
}> {
  const auth = await verifyRep();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!auth.isAdmin) {
    return { success: false, error: "Only an administrator can send the survey invitations." };
  }

  const { planInvitations, planReminders } = await import("@/lib/benchmarking/notify");
  const plan =
    input.kind === "reminder"
      ? await planReminders(input.surveyId)
      : await planInvitations(input.surveyId, { betaOnly: input.betaOnly });

  if (!plan) return { success: false, error: "No survey found." };

  return {
    success: true,
    plan: {
      fiscalYear: plan.fiscalYear,
      surveyStatus: plan.surveyStatus,
      templateKey: plan.templateKey,
      killSwitchOn: plan.killSwitchOn,
      willSend: plan.willSend.map((l) => ({
        organizationName: l.organizationName,
        contactName: l.contactName,
        to: l.to,
      })),
      blocked: plan.blocked.map((l) => ({
        organizationName: l.organizationName,
        blockedReason: l.blockedReason,
      })),
    },
  };
}
