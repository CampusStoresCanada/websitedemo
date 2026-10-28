"use server";

import { revalidatePath } from "next/cache";
import { canManageOrganization, requireAdmin, requireAuthenticated } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { membershipCoversConference } from "@/lib/conference/membership-gate";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { loadBursaryApplications } from "@/lib/conference/bursary-widget";
import { isBursaryStatus, type BursaryStatus } from "@/lib/conference/bursary-status";
import {
  bursaryRequestGaps,
  bursaryRequestOpen,
  isBursaryRequestField,
  validateBursaryAnswer,
  type BursaryRequestAnswers,
} from "@/lib/conference/bursary-request";
import { loadStoreContacts, type StoreContact } from "@/lib/actions/benchmarking-respondent";

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

// ─────────────────────────────────────────────────────────────────
// The travel bursary REQUEST (2026-10-28)
//
// Modelled on the benchmarking survey: one row per school per conference that
// anyone entitled at the school works on, answers saved as they go and checked
// against one question list (lib/conference/bursary-request.ts), the delegate
// picked from the school's contacts, and the login that submitted recorded.
// ─────────────────────────────────────────────────────────────────

/**
 * The new columns are not in the generated types until the migration is
 * applied and types are regenerated. Same narrow shim the other new tables use.
 */
type LooseDb = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

const REQUEST_COLUMNS =
  "id, contact_name, contact_email, status, requested_at, requested_by_user_id, delegate_contact_id, covers_hotel, covers_travel, payment_preference, gm_buyer_confirmed";

type RequestRow = {
  id: string;
  contact_name: string;
  contact_email: string;
  status: string;
  requested_at: string | null;
  requested_by_user_id: string | null;
} & BursaryRequestAnswers;

export type BursaryRequestView = {
  answers: BursaryRequestAnswers;
  /** Submitted as a request, not just registered interest. */
  submittedAt: string | null;
  /** Staff decision, once there is one. "submitted" means waiting. */
  status: string;
  contacts: StoreContact[];
  terms: { versionId: string; title: string; content: string } | null;
  termsAccepted: boolean;
  open: boolean;
  closesAt: string | null;
  /** This person may change it: entitled at the school, open, not yet submitted. */
  canEdit: boolean;
  gaps: string[];
};

/**
 * Who may fill in a school's request: anyone registered for this conference
 * from that school, or the school's admin whether or not they are registered.
 */
async function canFillBursaryRequest(
  ctx: Parameters<typeof canManageOrganization>[0] & { userId: string },
  conferenceId: string,
  organizationId: string
): Promise<boolean> {
  if (canManageOrganization(ctx, organizationId)) return true;
  const { count } = await createAdminClient()
    .from("conference_people")
    .select("id", { count: "exact", head: true })
    .eq("conference_id", conferenceId)
    .eq("organization_id", organizationId)
    .eq("user_id", ctx.userId)
    .neq("assignment_status", "canceled");
  return (count ?? 0) > 0;
}

/** The school must be a member whose membership covers the conference. */
async function memberCovered(conferenceId: string, organizationId: string): Promise<string | null> {
  const db = createAdminClient();
  const [{ data: org }, { data: conference }] = await Promise.all([
    db.from("organizations").select("type, membership_expires_at").eq("id", organizationId).maybeSingle(),
    db.from("conference_instances").select("end_date").eq("id", conferenceId).maybeSingle(),
  ]);
  if (org?.type !== "Member") return "The travel bursary is for CSC member institutions.";
  if (!conference?.end_date || !membershipCoversConference(org.membership_expires_at, conference.end_date)) {
    return "Your institution's membership needs to cover this conference's dates.";
  }
  return null;
}

async function loadClosesAt(conferenceId: string): Promise<string | null> {
  const { data } = await (createAdminClient() as unknown as LooseDb)
    .from("conference_instances")
    .select("bursary_request_closes_at")
    .eq("id", conferenceId)
    .maybeSingle();
  return (data?.bursary_request_closes_at as string | null) ?? null;
}

/** The newest effective Travel Bursary Terms for this conference, if written. */
async function loadTerms(conferenceId: string) {
  const { data } = await createAdminClient()
    .from("conference_legal_versions")
    .select("id, content")
    .eq("conference_id", conferenceId)
    .eq("document_type", "travel_bursary_terms")
    .lte("effective_at", new Date().toISOString())
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? { versionId: data.id, title: "Travel Bursary Terms", content: data.content } : null;
}

async function loadRequestRow(conferenceId: string, organizationId: string): Promise<RequestRow | null> {
  const { data } = await (createAdminClient() as unknown as LooseDb)
    .from("conference_bursary_applications")
    .select(REQUEST_COLUMNS)
    .eq("conference_id", conferenceId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  return (data as RequestRow | null) ?? null;
}

function answersOf(row: RequestRow | null): BursaryRequestAnswers {
  return {
    delegate_contact_id: row?.delegate_contact_id ?? null,
    covers_hotel: row?.covers_hotel ?? null,
    covers_travel: row?.covers_travel ?? null,
    payment_preference: row?.payment_preference ?? null,
    gm_buyer_confirmed: row?.gm_buyer_confirmed ?? null,
  };
}

/** A school's request as the person filling it in sees it. */
export async function getBursaryRequest(params: {
  conferenceId: string;
  organizationId: string;
}): Promise<Result<BursaryRequestView>> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  const notMember = await memberCovered(params.conferenceId, params.organizationId);
  if (notMember) return { success: false, error: notMember };
  if (!(await canFillBursaryRequest(auth.ctx, params.conferenceId, params.organizationId))) {
    return { success: false, error: "Only people registered from your institution, or its admin, can request travel support." };
  }

  const [row, { contacts }, terms, closesAt] = await Promise.all([
    loadRequestRow(params.conferenceId, params.organizationId),
    loadStoreContacts(params.organizationId),
    loadTerms(params.conferenceId),
    loadClosesAt(params.conferenceId),
  ]);
  let termsAccepted = false;
  if (terms) {
    const { count } = await createAdminClient()
      .from("legal_acceptances")
      .select("id", { count: "exact", head: true })
      .eq("legal_version_id", terms.versionId)
      .eq("user_id", auth.ctx.userId);
    termsAccepted = (count ?? 0) > 0;
  }
  const answers = answersOf(row);
  const open = bursaryRequestOpen(closesAt);
  return {
    success: true,
    data: {
      answers,
      submittedAt: row?.requested_at ?? null,
      status: row?.status ?? "submitted",
      contacts: contacts.filter((c) => !c.isArchived),
      terms,
      termsAccepted,
      open,
      closesAt,
      canEdit: open && !row?.requested_at,
      gaps: bursaryRequestGaps(answers, termsAccepted),
    },
  };
}

/** Save one answer, as benchmarking saves one field: validated, then written. */
export async function saveBursaryAnswer(params: {
  conferenceId: string;
  organizationId: string;
  field: string;
  value: unknown;
}): Promise<Result<null>> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!isBursaryRequestField(params.field)) return { success: false, error: "That question isn't on the request." };
  const check = validateBursaryAnswer(params.field, params.value);
  if (!check.valid) return { success: false, error: check.error };

  const notMember = await memberCovered(params.conferenceId, params.organizationId);
  if (notMember) return { success: false, error: notMember };
  if (!(await canFillBursaryRequest(auth.ctx, params.conferenceId, params.organizationId))) {
    return { success: false, error: "Only people registered from your institution, or its admin, can request travel support." };
  }
  if (!bursaryRequestOpen(await loadClosesAt(params.conferenceId))) {
    return { success: false, error: "Travel support requests have closed." };
  }

  const db = createAdminClient() as unknown as LooseDb;
  if (params.field === "delegate_contact_id" && check.clean) {
    const { data: contact } = await db
      .from("contacts")
      .select("id")
      .eq("id", check.clean)
      .eq("organization_id", params.organizationId)
      .maybeSingle();
    if (!contact) return { success: false, error: "That person isn't on your institution's list." };
  }

  const row = await loadRequestRow(params.conferenceId, params.organizationId);
  if (row?.requested_at) return { success: false, error: "This request has been submitted and can't be changed." };

  const now = new Date().toISOString();
  if (row) {
    const { error } = await db
      .from("conference_bursary_applications")
      .update({ [params.field]: check.clean, updated_at: now })
      .eq("id", row.id);
    if (error) return { success: false, error: error.message };
  } else {
    // contact_name / contact_email are required on the row; the person who
    // starts the request is who CSC contacts about it. Their own contact row at
    // this school when they have one, else their login email.
    const { data: me } = await db
      .from("contacts")
      .select("name, email, work_email")
      .eq("organization_id", params.organizationId)
      .eq("profile_id", auth.ctx.userId)
      .is("archived_at", null)
      .limit(1)
      .maybeSingle();
    const email = (me?.work_email as string | null) || (me?.email as string | null) || auth.ctx.userEmail || "";
    const { error } = await db.from("conference_bursary_applications").insert({
      conference_id: params.conferenceId,
      organization_id: params.organizationId,
      submitted_by_user_id: auth.ctx.userId,
      contact_name: (me?.name as string | null) || email,
      contact_email: email,
      [params.field]: check.clean,
    });
    if (error) return { success: false, error: error.message };
  }
  return { success: true, data: null };
}

/** Submit the request. Every question answered and the terms accepted, or nothing. */
export async function submitBursaryRequest(params: {
  conferenceId: string;
  organizationId: string;
}): Promise<Result<null>> {
  const view = await getBursaryRequest(params);
  if (!view.success) return view;
  if (!view.data.open) return { success: false, error: "Travel support requests have closed." };
  if (view.data.submittedAt) return { success: true, data: null };
  if (view.data.gaps.length > 0) return { success: false, error: view.data.gaps[0] };

  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  const now = new Date().toISOString();
  const { error } = await (createAdminClient() as unknown as LooseDb)
    .from("conference_bursary_applications")
    .update({ requested_at: now, requested_by_user_id: auth.ctx.userId, updated_at: now })
    .eq("conference_id", params.conferenceId)
    .eq("organization_id", params.organizationId)
    .is("requested_at", null);
  if (error) return { success: false, error: error.message };

  await logAuditEventSafe({
    action: "bursary_request_submitted",
    entityType: "organization",
    entityId: params.organizationId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { conferenceId: params.conferenceId, answers: view.data.answers },
  });
  revalidatePath("/admin");
  return { success: true, data: null };
}

