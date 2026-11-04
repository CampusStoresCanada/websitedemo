"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireAuthenticated } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { membershipCoversConference } from "@/lib/conference/membership-gate";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { loadBursaryApplications } from "@/lib/conference/bursary-widget";
import { isBursaryStatus, type BursaryStatus } from "@/lib/conference/bursary-status";
import {
  BURSARY_DESIGNATION_FIELDS,
  bursaryRequestGaps,
  bursaryRequestOpen,
  defaultHotelNights,
  hotelNightsText,
  isBursaryRequestField,
  validateBursaryAnswer,
  type BursaryRequestAnswers,
  type HotelRate,
} from "@/lib/conference/bursary-request";
import { loadSeatHoldings } from "@/lib/conference/seats";
import { loadStoreContacts, type StoreContact } from "@/lib/actions/benchmarking-respondent";
import { formatDeadline } from "@/lib/benchmarking/deadline";
import { canFillBursaryRequest } from "@/lib/conference/bursary-access";
import { lookupUserEmailsByIds } from "@/lib/supabase/user-lookup";

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

type BursaryTemplate = "bursary_request_received" | "bursary_request_denied";

/**
 * Tell the school about its own request: the person who started it (the
 * request's contact) and the login that submitted it, once each. Never throws:
 * the write it follows has already happened, and a failed email must not read
 * as a failed decision. Returns how many were sent.
 */
async function tellRequesters(applicationId: string, templateKey: BursaryTemplate): Promise<number> {
  try {
    const db = createAdminClient() as unknown as LooseDb;
    const { data: row } = await db
      .from("conference_bursary_applications")
      .select(
        "contact_name, contact_email, requested_by_user_id, hotel_nights, organization:organizations(name), conference:conference_instances(id, name, year, edition_code, bursary_hotel_night_cents, bursary_hotel_tax_bps)"
      )
      .eq("id", applicationId)
      .maybeSingle();
    if (!row?.conference) return 0;

    const people = new Map<string, string | null>();
    const add = (email: string | null | undefined, name: string | null | undefined) => {
      const key = email?.trim().toLowerCase();
      if (key && !people.has(key)) people.set(key, name?.trim() || null);
    };
    add(row.contact_email, row.contact_name !== row.contact_email ? row.contact_name : null);
    if (row.requested_by_user_id) {
      const admin = createAdminClient();
      const [emails, { data: profile }] = await Promise.all([
        lookupUserEmailsByIds(admin, [row.requested_by_user_id]),
        admin.from("profiles").select("display_name").eq("id", row.requested_by_user_id).maybeSingle(),
      ]);
      add(emails[row.requested_by_user_id], profile?.display_name);
    }
    if (people.size === 0) return 0;

    const { data: program } = await db
      .from("expense_programs")
      .select("opens_at, closes_at")
      .eq("conference_id", row.conference.id)
      .eq("is_active", true)
      .like("slug", "travel-bursary-%")
      .maybeSingle();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
    const { sendTransactionalBatch } = await import("@/lib/comms/send");
    const results = await sendTransactionalBatch({
      templateKey,
      recipients: [...people].map(([to, name]) => ({
        to,
        variables: {
          first_name: name?.split(/\s+/)[0] || "there",
          organization_name: row.organization?.name ?? "your institution",
          conference_name: row.conference.name ?? "the conference",
          request_url: `${appUrl}/conference/${row.conference.year}/${row.conference.edition_code}/bursary`,
          hotel_nights_text: hotelNightsText(row.hotel_nights ?? 3, {
            nightCents: row.conference.bursary_hotel_night_cents ?? null,
            taxBps: row.conference.bursary_hotel_tax_bps ?? null,
          }),
          // The claim window opens on its first day; formatDeadline reads an
          // exclusive boundary, so a minute in names that same day.
          claims_open_date: formatDeadline(program?.opens_at ? new Date(Date.parse(program.opens_at) + 60_000).toISOString() : null) ?? "after the conference",
          claims_close_date: formatDeadline(program?.closes_at) ?? "the deadline",
        },
      })),
    });
    return results.filter((r) => r.success).length;
  } catch (err) {
    console.warn(`[bursary] ${templateKey} email failed`, err);
    return 0;
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

  // No "approved" email: there is no approval step any more (Steve,
  // 2026-11-02). The "received" email carries what it used to say.
  if (params.status === "denied") await tellRequesters(params.applicationId, "bursary_request_denied");

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
  "id, contact_name, contact_email, status, requested_at, requested_by_user_id, delegate_seat_id, delegate_contact_id, covers_hotel, covers_travel, payment_preference, gm_buyer_confirmed, notes, hotel_nights";

type RequestRow = {
  id: string;
  contact_name: string;
  contact_email: string;
  status: string;
  requested_at: string | null;
  requested_by_user_id: string | null;
  hotel_nights: number | null;
} & BursaryRequestAnswers;

/** One of the school's registrations, as the "who is it for" question lists it. */
export type BursarySeatOption = {
  seatId: string;
  /** "Jane Smith, Full Conference Registration", or "Not yet named, ..." */
  label: string;
  holderName: string | null;
};

export type BursaryRequestView = {
  answers: BursaryRequestAnswers;
  /** Submitted as a request, not just registered interest. */
  submittedAt: string | null;
  /** Staff decision, once there is one. "submitted" means waiting. */
  status: string;
  contacts: StoreContact[];
  /** The school's registration seats; the request picks one. */
  seats: BursarySeatOption[];
  /** Who the support is for right now: the picked seat's holder, else the old contact pick. */
  delegateName: string | null;
  /** The pick can change until this day ("January 17, 2027"), after submitting too. */
  designationOpen: boolean;
  designationClosesOnLabel: string | null;
  /** Entitled and the designation window is open. */
  canDesignate: boolean;
  hotelNights: number;
  /** "3 hotel nights, up to $664.77 including tax" */
  hotelText: string;
  terms: { versionId: string; title: string; content: string } | null;
  termsAccepted: boolean;
  open: boolean;
  closesAt: string | null;
  /**
   * "November 20, 2026": the last day, formatted on the server. Not in the
   * browser: a browser with stale time-zone data rendered this deadline as the
   * 21st, which is the boundary, not the last day.
   */
  closesOnLabel: string | null;
  /** This person may change it: entitled at the school, open, not yet submitted. */
  canEdit: boolean;
  gaps: string[];
};

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

type BursarySettings = {
  closesAt: string | null;
  designationClosesAt: string | null;
  rate: HotelRate;
  fourNightOrgIds: string[];
};

async function loadSettings(conferenceId: string): Promise<BursarySettings> {
  const { data } = await (createAdminClient() as unknown as LooseDb)
    .from("conference_instances")
    .select(
      "bursary_request_closes_at, bursary_designation_closes_at, bursary_hotel_night_cents, bursary_hotel_tax_bps, bursary_four_night_org_ids"
    )
    .eq("id", conferenceId)
    .maybeSingle();
  return {
    closesAt: (data?.bursary_request_closes_at as string | null) ?? null,
    designationClosesAt: (data?.bursary_designation_closes_at as string | null) ?? null,
    rate: {
      nightCents: (data?.bursary_hotel_night_cents as number | null) ?? null,
      taxBps: (data?.bursary_hotel_tax_bps as number | null) ?? null,
    },
    fourNightOrgIds: (data?.bursary_four_night_org_ids as string[] | null) ?? [],
  };
}

/** The school's registration seats, labelled by holder. */
async function loadSeatOptions(conferenceId: string, organizationId: string): Promise<BursarySeatOption[]> {
  const { seats } = await loadSeatHoldings(createAdminClient(), {
    conferenceId,
    organizationId,
    entityKinds: ["registration"],
  });
  return seats
    .sort((a, b) => (a.holderName ? 0 : 1) - (b.holderName ? 0 : 1) || (a.seatIndex ?? 0) - (b.seatIndex ?? 0))
    .map((seat) => ({
      seatId: seat.seatId,
      label: `${seat.holderName ?? "Not yet named"}, ${seat.entityName}`,
      holderName: seat.holderName,
    }));
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
    delegate_seat_id: row?.delegate_seat_id ?? null,
    delegate_contact_id: row?.delegate_contact_id ?? null,
    covers_hotel: row?.covers_hotel ?? null,
    covers_travel: row?.covers_travel ?? null,
    payment_preference: row?.payment_preference ?? null,
    gm_buyer_confirmed: row?.gm_buyer_confirmed ?? null,
    notes: row?.notes ?? null,
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

  const [row, { contacts }, terms, settings, seats] = await Promise.all([
    loadRequestRow(params.conferenceId, params.organizationId),
    loadStoreContacts(params.organizationId),
    loadTerms(params.conferenceId),
    loadSettings(params.conferenceId),
    loadSeatOptions(params.conferenceId, params.organizationId),
  ]);
  const { closesAt } = settings;
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
  // The request deadline is the date we SAY (November 27), not the date the
  // page stops taking requests: those keep coming until the designation
  // deadline, quietly, so a school late to its date is never turned away
  // (Steve, 2026-11-04). Once the stated date passes, the page stops naming it
  // rather than announcing a new one.
  const open = bursaryRequestOpen(settings.designationClosesAt);
  const designationOpen = bursaryRequestOpen(settings.designationClosesAt);
  const hotelNights = row?.hotel_nights ?? defaultHotelNights(params.organizationId, settings.fourNightOrgIds);
  const pickedSeat = seats.find((s) => s.seatId === answers.delegate_seat_id);
  return {
    success: true,
    data: {
      answers,
      submittedAt: row?.requested_at ?? null,
      status: row?.status ?? "submitted",
      contacts: contacts.filter((c) => !c.isArchived),
      seats,
      delegateName: answers.delegate_seat_id
        ? pickedSeat?.holderName ?? null
        : contacts.find((c) => c.id === answers.delegate_contact_id)?.name ?? null,
      designationOpen,
      designationClosesOnLabel: formatDeadline(settings.designationClosesAt),
      canDesignate: designationOpen && (open || !!row?.requested_at),
      hotelNights,
      hotelText: hotelNightsText(hotelNights, settings.rate),
      terms,
      termsAccepted,
      open,
      closesAt,
      closesOnLabel: bursaryRequestOpen(closesAt) ? formatDeadline(closesAt) : null,
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
  const settings = await loadSettings(params.conferenceId);
  const designation = BURSARY_DESIGNATION_FIELDS.includes(params.field);
  const row = await loadRequestRow(params.conferenceId, params.organizationId);
  if (designation) {
    // Who it is for can change after submitting, until the designation
    // deadline (MOU 8.7). Before submitting, the request deadline still applies.
    if (!bursaryRequestOpen(settings.designationClosesAt)) {
      return { success: false, error: "The date to change who the support is for has passed. Please contact Campus Stores Canada." };
    }
    if (!row?.requested_at && !bursaryRequestOpen(settings.designationClosesAt)) {
      return { success: false, error: "Travel support requests have closed." };
    }
  } else {
    // Accepted past the stated date, to the designation deadline (see getBursaryRequest).
    if (!bursaryRequestOpen(settings.designationClosesAt)) return { success: false, error: "Travel support requests have closed." };
    if (row?.requested_at) return { success: false, error: "This request has been submitted and can't be changed." };
  }

  const db = createAdminClient() as unknown as LooseDb;
  if (params.field === "delegate_seat_id" && check.clean) {
    // One of THIS school's registrations, read through the one seat reader.
    const { seats } = await loadSeatHoldings(createAdminClient(), {
      conferenceId: params.conferenceId,
      organizationId: params.organizationId,
      entityKinds: ["registration"],
      seatIds: [check.clean as string],
    });
    if (seats.length === 0) return { success: false, error: "That isn't one of your institution's registrations." };
  }

  const now = new Date().toISOString();
  if (row) {
    const { error } = await db
      .from("conference_bursary_applications")
      .update({ [params.field]: check.clean, updated_at: now })
      .eq("id", row.id);
    if (error) return { success: false, error: error.message };
    // A change after submitting moves the support, and the obligations, to
    // someone else: keep the trail.
    if (row.requested_at && designation) {
      await logAuditEventSafe({
        action: "bursary_delegate_changed",
        entityType: "conference_bursary_application",
        entityId: row.id,
        actorId: auth.ctx.userId,
        actorType: "user",
        details: { from: row.delegate_seat_id, to: check.clean, conferenceId: params.conferenceId, organizationId: params.organizationId },
      });
    }
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
      hotel_nights: defaultHotelNights(params.organizationId, settings.fourNightOrgIds),
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
  const { data: submitted, error } = await (createAdminClient() as unknown as LooseDb)
    .from("conference_bursary_applications")
    .update({ requested_at: now, requested_by_user_id: auth.ctx.userId, updated_at: now })
    .eq("conference_id", params.conferenceId)
    .eq("organization_id", params.organizationId)
    .is("requested_at", null)
    .select("id");
  if (error) return { success: false, error: error.message };
  // Only the click that actually submitted it sends the receipt; a double
  // click updates nothing the second time.
  if (submitted?.[0]?.id) await tellRequesters(submitted[0].id as string, "bursary_request_received");

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


// ─────────────────────────────────────────────────────────────────
// The expense claim that follows an approved request
// ─────────────────────────────────────────────────────────────────

/**
 * The school's travel expense claim, opened on first visit once its request is
 * submitted. The claim itself is the general expense module's
 * (lib/expenses/); the bursary only supplies the program and the request it
 * hangs from. Null when there is nothing to claim yet.
 */
export async function getBursaryClaim(params: {
  conferenceId: string;
  organizationId: string;
}): Promise<Result<{ claimId: string } | null>> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  const db = createAdminClient();

  // No board gate (Steve, 2026-11-02): a submitted request opens the claim,
  // and the two approvals on the claim are the approval. Staff can still
  // decline a school that isn't eligible.
  const { data: request } = await (db as unknown as LooseDb)
    .from("conference_bursary_applications")
    .select("id, status, requested_at")
    .eq("conference_id", params.conferenceId)
    .eq("organization_id", params.organizationId)
    .maybeSingle();
  if (!request?.requested_at || request.status === "denied") return { success: true, data: null };

  const { data: program } = await db
    .from("expense_programs")
    .select("id")
    .eq("conference_id", params.conferenceId)
    .eq("is_active", true)
    .like("slug", "travel-bursary-%")
    .maybeSingle();
  if (!program) return { success: true, data: null };

  const find = () =>
    db
      .from("expense_claims")
      .select("id")
      .eq("program_id", program.id)
      .eq("source_table", "conference_bursary_applications")
      .eq("source_id", request.id)
      .maybeSingle();

  const { data: existing } = await find();
  if (existing) return { success: true, data: { claimId: existing.id } };

  if (!(await canFillBursaryRequest(auth.ctx, params.conferenceId, params.organizationId))) {
    return { success: true, data: null };
  }
  const { error } = await db.from("expense_claims").insert({
    program_id: program.id,
    organization_id: params.organizationId,
    source_table: "conference_bursary_applications",
    source_id: request.id,
    created_by_user_id: auth.ctx.userId,
  });
  // A colleague opening it at the same moment wins the unique index; read theirs.
  if (error && error.code !== "23505") return { success: false, error: error.message };
  const { data: created } = await find();
  return created ? { success: true, data: { claimId: created.id } } : { success: false, error: "Could not open the claim." };
}

// ─────────────────────────────────────────────────────────────────
// Staff: hotel nights, and booking a prepaid trip (2026-11-03)
// ─────────────────────────────────────────────────────────────────

/**
 * Admin: change how many hotel nights a school is covered for. The claim's
 * hotel cap follows it (lib/expenses/sources.ts).
 */
export async function setBursaryHotelNights(params: {
  applicationId: string;
  nights: number;
}): Promise<Result<null>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!Number.isInteger(params.nights) || params.nights < 1 || params.nights > 4) {
    return { success: false, error: "Hotel nights must be 1 to 4." };
  }
  const db = createAdminClient() as unknown as LooseDb;
  const { data: before } = await db
    .from("conference_bursary_applications")
    .select("hotel_nights, conference_id, organization_id")
    .eq("id", params.applicationId)
    .maybeSingle();
  if (!before) return { success: false, error: "That request no longer exists." };
  if (before.hotel_nights === params.nights) return { success: true, data: null };

  const { error } = await db
    .from("conference_bursary_applications")
    .update({ hotel_nights: params.nights, updated_at: new Date().toISOString() })
    .eq("id", params.applicationId);
  if (error) return { success: false, error: error.message };
  await logAuditEventSafe({
    action: "bursary_hotel_nights_changed",
    entityType: "conference_bursary_application",
    entityId: params.applicationId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { from: before.hotel_nights, to: params.nights, conferenceId: before.conference_id, organizationId: before.organization_id },
  });
  revalidatePath("/admin");
  return { success: true, data: null };
}

/**
 * Admin: CSC has booked the hotel and travel for a school that asked to be
 * paid in advance. Until then it waits in the War Room.
 */
export async function markBursaryPrepayBooked(params: { applicationId: string }): Promise<Result<null>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };
  const now = new Date().toISOString();
  const { data, error } = await (createAdminClient() as unknown as LooseDb)
    .from("conference_bursary_applications")
    .update({ prepay_booked_at: now, prepay_booked_by: auth.ctx.userId, updated_at: now })
    .eq("id", params.applicationId)
    .is("prepay_booked_at", null)
    .select("id, conference_id, organization_id");
  if (error) return { success: false, error: error.message };
  if (data?.[0]) {
    await logAuditEventSafe({
      action: "bursary_prepay_booked",
      entityType: "conference_bursary_application",
      entityId: params.applicationId,
      actorId: auth.ctx.userId,
      actorType: "user",
      details: { conferenceId: data[0].conference_id, organizationId: data[0].organization_id },
    });
    revalidatePath(`/admin/conference/${data[0].conference_id}/war-room`);
  }
  revalidatePath("/admin");
  return { success: true, data: null };
}
