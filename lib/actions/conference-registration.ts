"use server";

import {
  requireAuthenticated,
  requireAdmin,
  isGlobalAdmin,
} from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  REGISTRATION_STATUS_TRANSITIONS,
  type RegistrationStatus,
  type RegistrationType,
} from "@/lib/constants/conference";
import { ensurePersonForUser, upsertConferenceContact } from "@/lib/identity/lifecycle";
import { getEffectivePolicies } from "@/lib/policy/engine";
import { checkLegalAcceptance } from "@/lib/actions/conference-legal";
import { syncConferencePeopleIndex } from "@/lib/actions/conference-people";
import { logAuditEventSafe } from "@/lib/ops/audit";
import type { Database } from "@/lib/database.types";

type RegistrationRow = Database["public"]["Tables"]["conference_registrations"]["Row"];
type RegistrationUpdate = Database["public"]["Tables"]["conference_registrations"]["Update"];

type OppositeRegistrationType = "delegate" | "exhibitor";
type TravelWindowExceptionStatus = "pending" | "approved" | "rejected";

type TravelWindowExceptionRecord = {
  status: TravelWindowExceptionStatus;
  reason: string | null;
  requested_at: string | null;
  requested_by: string | null;
  requested_arrival_date: string | null;
  requested_departure_date: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_note: string | null;
};

function getOppositeRegistrationType(type: RegistrationType): OppositeRegistrationType | null {
  if (type === "delegate") return "exhibitor";
  if (type === "exhibitor") return "delegate";
  return null;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isValidPhone(value: string): boolean {
  const normalized = value.replace(/[^\d+]/g, "");
  return normalized.length >= 7;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseDateOrDateTime(value: string | null | undefined): Date | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return parseDateOnly(trimmed);
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) {
    const normalized = trimmed.length === 16 ? `${trimmed}:00` : trimmed;
    const parsed = new Date(`${normalized}Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function shiftUtcDays(base: Date, days: number): Date {
  const next = new Date(base);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function readCustomAnswers(reg: RegistrationRow): Record<string, unknown> {
  const raw = (reg as unknown as { registration_custom_answers?: Record<string, unknown> | null })
    .registration_custom_answers;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw;
}

function readTravelWindowException(reg: RegistrationRow): TravelWindowExceptionRecord | null {
  const customAnswers = readCustomAnswers(reg);
  const raw = customAnswers.travel_window_exception;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const entry = raw as Record<string, unknown>;
  const status = entry.status;
  if (status !== "pending" && status !== "approved" && status !== "rejected") return null;
  return {
    status,
    reason: typeof entry.reason === "string" ? entry.reason : null,
    requested_at: typeof entry.requested_at === "string" ? entry.requested_at : null,
    requested_by: typeof entry.requested_by === "string" ? entry.requested_by : null,
    requested_arrival_date:
      typeof entry.requested_arrival_date === "string" ? entry.requested_arrival_date : null,
    requested_departure_date:
      typeof entry.requested_departure_date === "string" ? entry.requested_departure_date : null,
    reviewed_at: typeof entry.reviewed_at === "string" ? entry.reviewed_at : null,
    reviewed_by: typeof entry.reviewed_by === "string" ? entry.reviewed_by : null,
    review_note: typeof entry.review_note === "string" ? entry.review_note : null,
  };
}

// ─────────────────────────────────────────────────────────────────
// Create registration (draft)
// ─────────────────────────────────────────────────────────────────

export async function createRegistration(
  conferenceId: string,
  registrationType: RegistrationType,
  orgId: string
): Promise<{ success: boolean; error?: string; data?: RegistrationRow }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  // Check conference is registration_open
  const { data: conf, error: confErr } = await adminClient
    .from("conference_instances")
    .select("status")
    .eq("id", conferenceId)
    .single();

  if (confErr || !conf) {
    return { success: false, error: "Conference not found" };
  }
  if (conf.status !== "registration_open") {
    return { success: false, error: "Registration is not currently open" };
  }

  // Check no duplicate
  const { data: existing } = await adminClient
    .from("conference_registrations")
    .select("id")
    .eq("conference_id", conferenceId)
    .eq("user_id", auth.ctx.userId)
    .eq("registration_type", registrationType)
    .maybeSingle();

  if (existing) {
    return { success: false, error: "You already have a registration of this type" };
  }

  const { data, error } = await adminClient
    .from("conference_registrations")
    .insert({
      conference_id: conferenceId,
      organization_id: orgId,
      user_id: auth.ctx.userId,
      registration_type: registrationType,
      status: "draft",
    })
    .select()
    .single();

  if (error) return { success: false, error: error.message };

  await syncConferencePeopleIndex(conferenceId).catch((syncError) => {
    console.warn("[conference-registration] syncConferencePeopleIndex(create) failed", {
      conferenceId,
      error: syncError instanceof Error ? syncError.message : String(syncError),
    });
  });

  const personResult = await ensurePersonForUser({
    userId: auth.ctx.userId,
    organizationId: orgId,
    fallbackEmail: auth.ctx.userEmail,
  });
  if (personResult.personId) {
    await upsertConferenceContact({
      organizationId: orgId,
      personId: personResult.personId,
      email: auth.ctx.userEmail,
      contactType: ["conference", "registrant"],
    });
  }

  await syncConferencePeopleIndex(reg.conference_id).catch((syncError) => {
    console.warn("[conference-registration] syncConferencePeopleIndex(save) failed", {
      conferenceId: reg.conference_id,
      error: syncError instanceof Error ? syncError.message : String(syncError),
    });
  });

  const oppositeType = getOppositeRegistrationType(registrationType);
  if (oppositeType && data) {
    const { data: opposite } = await adminClient
      .from("conference_registrations")
      .select("id, linked_registration_id")
      .eq("conference_id", conferenceId)
      .eq("user_id", auth.ctx.userId)
      .eq("registration_type", oppositeType)
      .maybeSingle();

    if (opposite?.id) {
      await Promise.all([
        adminClient
          .from("conference_registrations")
          .update({ linked_registration_id: opposite.id, updated_at: new Date().toISOString() })
          .eq("id", data.id),
        adminClient
          .from("conference_registrations")
          .update({ linked_registration_id: data.id, updated_at: new Date().toISOString() })
          .eq("id", opposite.id),
      ]);
    }
  }

  return { success: true, data };
}

// ─────────────────────────────────────────────────────────────────
// Save registration step (direct column updates, not JSONB)
// ─────────────────────────────────────────────────────────────────

export async function saveRegistrationStep(
  registrationId: string,
  stepData: RegistrationUpdate | Record<string, unknown>
): Promise<{ success: boolean; error?: string; data?: RegistrationRow }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  // Validate ownership
  const { data: reg, error: regErr } = await adminClient
    .from("conference_registrations")
    .select("user_id, status, travel_consent_given, organization_id, registration_type")
    .eq("id", registrationId)
    .single();

  if (regErr || !reg) {
    return { success: false, error: "Registration not found" };
  }
  if (reg.user_id !== auth.ctx.userId && !isGlobalAdmin(auth.ctx.globalRole)) {
    return { success: false, error: "Not authorized" };
  }
  if (reg.status !== "draft" && reg.status !== "submitted") {
    return { success: false, error: "Registration is locked" };
  }

  // Strip fields that should not be updated via this endpoint
  const safeFields = { ...stepData } as Record<string, unknown>;
  delete safeFields.id;
  delete safeFields.conference_id;
  delete safeFields.organization_id;
  delete safeFields.user_id;
  delete safeFields.registration_type;
  delete safeFields.status;
  delete safeFields.created_at;

  if (
    "registration_custom_answers" in safeFields &&
    safeFields.registration_custom_answers !== null &&
    (typeof safeFields.registration_custom_answers !== "object" ||
      Array.isArray(safeFields.registration_custom_answers))
  ) {
    return {
      success: false,
      error: "Custom answers must be a JSON object.",
    };
  }

  if (typeof safeFields.delegate_email === "string" && safeFields.delegate_email.trim().length > 0) {
    if (!isValidEmail(safeFields.delegate_email)) {
      return { success: false, error: "Enter a valid contact email address." };
    }
    safeFields.delegate_email = safeFields.delegate_email.trim().toLowerCase();
  }

  for (const phoneField of ["mobile_phone", "delegate_work_phone", "emergency_contact_phone"] as const) {
    const raw = safeFields[phoneField];
    if (typeof raw === "string" && raw.trim().length > 0 && !isValidPhone(raw)) {
      return { success: false, error: `Enter a valid phone number for ${phoneField.replaceAll("_", " ")}.` };
    }
  }

  if (typeof safeFields.date_of_birth === "string" && safeFields.date_of_birth.trim().length > 0) {
    if (!isIsoDate(safeFields.date_of_birth)) {
      return { success: false, error: "Date of birth must use YYYY-MM-DD format." };
    }
  }

  const hasTravelFields = [
    "legal_name",
    "date_of_birth",
    "seat_preference",
    "preferred_departure_airport",
    "road_origin_address",
    "nexus_trusted_traveler",
    "emergency_contact_name",
    "emergency_contact_phone",
    "gender",
    "mobile_phone",
  ].some((field) => field in safeFields && safeFields[field] !== undefined);
  const hasDietaryAccessibilityFields = [
    "dietary_restrictions",
    "accessibility_needs",
  ].some((field) => field in safeFields && safeFields[field] !== undefined);

  const effectiveConsent =
    (safeFields.travel_consent_given as boolean | null | undefined) ??
    reg.travel_consent_given ??
    false;

  const consentPolicies = await getEffectivePolicies([
    "consent.travel_data_required",
    "consent.dietary_accessibility_required",
  ]).catch(() => ({} as Record<string, unknown>));

  const travelConsentRequired =
    (consentPolicies["consent.travel_data_required"] as boolean | undefined) ?? true;
  const dietaryAccessibilityConsentRequired =
    (consentPolicies["consent.dietary_accessibility_required"] as boolean | undefined) ?? false;

  if (hasTravelFields && travelConsentRequired && !effectiveConsent) {
    return {
      success: false,
      error: "Travel consent must be granted before travel fields can be saved.",
    };
  }

  if (
    hasDietaryAccessibilityFields &&
    dietaryAccessibilityConsentRequired &&
    !effectiveConsent
  ) {
    return {
      success: false,
      error:
        "Consent is required before dietary/accessibility fields can be saved.",
    };
  }

  if (safeFields.travel_consent_given === false) {
    safeFields.legal_name = null;
    safeFields.date_of_birth = null;
    safeFields.preferred_departure_airport = null;
    safeFields.road_origin_address = null;
    safeFields.nexus_trusted_traveler = null;
    safeFields.seat_preference = null;
    safeFields.emergency_contact_name = null;
    safeFields.emergency_contact_phone = null;
    safeFields.gender = null;
    safeFields.mobile_phone = null;
    if (dietaryAccessibilityConsentRequired) {
      safeFields.dietary_restrictions = null;
      safeFields.accessibility_needs = null;
    }
  }

  const { data, error } = await adminClient
    .from("conference_registrations")
    .update({ ...safeFields, updated_at: new Date().toISOString() })
    .eq("id", registrationId)
    .select()
    .single();

  if (error) return { success: false, error: error.message };

  const personResult = await ensurePersonForUser({
    userId: auth.ctx.userId,
    organizationId: reg.organization_id,
    fallbackEmail: auth.ctx.userEmail,
  });
  if (personResult.personId) {
    await upsertConferenceContact({
      organizationId: reg.organization_id,
      personId: personResult.personId,
      name: (safeFields.delegate_name as string | null | undefined) ?? undefined,
      email:
        (safeFields.delegate_email as string | null | undefined) ??
        auth.ctx.userEmail ??
        undefined,
      roleTitle: (safeFields.delegate_title as string | null | undefined) ?? undefined,
      phone: (safeFields.mobile_phone as string | null | undefined) ?? undefined,
      workPhone:
        (safeFields.delegate_work_phone as string | null | undefined) ??
        (safeFields.mobile_phone as string | null | undefined) ??
        undefined,
      contactType: [
        "conference",
        reg.registration_type === "delegate" ? "delegate" : "exhibitor",
      ],
    });
  }

  return { success: true, data };
}

// ─────────────────────────────────────────────────────────────────
// Submit registration (draft → submitted)
// ─────────────────────────────────────────────────────────────────

export async function submitRegistration(
  registrationId: string
): Promise<{ success: boolean; error?: string; data?: RegistrationRow }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  const { data: reg, error: regErr } = await adminClient
    .from("conference_registrations")
    .select("*")
    .eq("id", registrationId)
    .single();

  if (regErr || !reg) {
    return { success: false, error: "Registration not found" };
  }
  if (reg.user_id !== auth.ctx.userId && !isGlobalAdmin(auth.ctx.globalRole)) {
    return { success: false, error: "Not authorized" };
  }
  if (reg.status !== "draft") {
    return { success: false, error: "Registration must be in draft to submit" };
  }

  const { data: conferenceRow, error: conferenceError } = await adminClient
    .from("conference_instances")
    .select("start_date, end_date")
    .eq("id", reg.conference_id)
    .single();
  if (conferenceError || !conferenceRow) {
    return { success: false, error: "Conference context is missing for this registration." };
  }

  const policyValues = await getEffectivePolicies([
    "conference.travel_arrival_min_days_before_start",
    "conference.travel_departure_max_days_after_end",
  ]).catch(() => ({} as Record<string, unknown>));

  const arrivalMinDaysBeforeStart = Number(
    policyValues["conference.travel_arrival_min_days_before_start"] ?? 0
  );
  const departureMaxDaysAfterEnd = Number(
    policyValues["conference.travel_departure_max_days_after_end"] ?? 0
  );

  const startDate = parseDateOnly(conferenceRow.start_date);
  const endDate = parseDateOnly(conferenceRow.end_date);

  const customAnswers =
    ((reg as unknown as { registration_custom_answers?: Record<string, unknown> })
      .registration_custom_answers as Record<string, unknown> | undefined) ?? {};
  const arrivalRaw =
    typeof customAnswers.arrival_date === "string" ? customAnswers.arrival_date : null;
  const departureRaw =
    typeof customAnswers.departure_date === "string" ? customAnswers.departure_date : null;
  const travelWindowException = readTravelWindowException(reg);

  const arrivalDate = parseDateOrDateTime(arrivalRaw);
  const departureDate = parseDateOrDateTime(departureRaw);

  if (startDate && arrivalDate && Number.isFinite(arrivalMinDaysBeforeStart)) {
    const earliestAllowed = shiftUtcDays(startDate, -arrivalMinDaysBeforeStart);
    if (arrivalDate < earliestAllowed) {
      if (travelWindowException?.status === "pending") {
        return {
          success: false,
          error:
            "Travel window exception request is pending admin review.",
        };
      }
      const approvalMatchesCurrentDates =
        travelWindowException?.status === "approved" &&
        travelWindowException.requested_arrival_date === arrivalRaw &&
        travelWindowException.requested_departure_date === departureRaw;
      if (!approvalMatchesCurrentDates) {
      return {
        success: false,
        error:
            "Arrival date is outside the policy window. Request an exception for admin approval before submitting.",
      };
      }
    }
  }

  if (endDate && departureDate && Number.isFinite(departureMaxDaysAfterEnd)) {
    const latestAllowed = shiftUtcDays(endDate, departureMaxDaysAfterEnd);
    if (departureDate > latestAllowed) {
      if (travelWindowException?.status === "pending") {
        return {
          success: false,
          error:
            "Travel window exception request is pending admin review.",
        };
      }
      const approvalMatchesCurrentDates =
        travelWindowException?.status === "approved" &&
        travelWindowException.requested_arrival_date === arrivalRaw &&
        travelWindowException.requested_departure_date === departureRaw;
      if (!approvalMatchesCurrentDates) {
      return {
        success: false,
        error:
            "Departure date is outside the policy window. Request an exception for admin approval before submitting.",
      };
      }
    }
  }

  const legalCheck = await checkLegalAcceptance(auth.ctx.userId, reg.conference_id);
  if (!legalCheck.success) {
    return { success: false, error: legalCheck.error ?? "Failed to verify legal acceptance" };
  }
  if (!legalCheck.data?.allAccepted) {
    return {
      success: false,
      error: "All legal documents must be accepted before submitting",
    };
  }

  const { data, error } = await adminClient
    .from("conference_registrations")
    .update({ status: "submitted", updated_at: new Date().toISOString() })
    .eq("id", registrationId)
    .select()
    .single();

  if (error) return { success: false, error: error.message };

  await syncConferencePeopleIndex(reg.conference_id).catch((syncError) => {
    console.warn("[conference-registration] syncConferencePeopleIndex(submit) failed", {
      conferenceId: reg.conference_id,
      error: syncError instanceof Error ? syncError.message : String(syncError),
    });
  });
  return { success: true, data };
}

export async function requestTravelWindowException(
  registrationId: string,
  reason: string
): Promise<{ success: boolean; error?: string; data?: RegistrationRow }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    return { success: false, error: "Exception reason is required." };
  }

  const adminClient = createAdminClient();
  const { data: reg, error: regErr } = await adminClient
    .from("conference_registrations")
    .select("*")
    .eq("id", registrationId)
    .single();
  if (regErr || !reg) {
    return { success: false, error: "Registration not found." };
  }
  if (reg.user_id !== auth.ctx.userId && !isGlobalAdmin(auth.ctx.globalRole)) {
    return { success: false, error: "Not authorized." };
  }

  const customAnswers = readCustomAnswers(reg);
  const arrivalRaw =
    typeof customAnswers.arrival_date === "string" ? customAnswers.arrival_date : null;
  const departureRaw =
    typeof customAnswers.departure_date === "string" ? customAnswers.departure_date : null;
  const now = new Date().toISOString();
  const nextCustomAnswers: Record<string, unknown> = {
    ...customAnswers,
    travel_window_exception: {
      status: "pending",
      reason: trimmedReason,
      requested_at: now,
      requested_by: auth.ctx.userId,
      requested_arrival_date: arrivalRaw,
      requested_departure_date: departureRaw,
      reviewed_at: null,
      reviewed_by: null,
      review_note: null,
    } satisfies TravelWindowExceptionRecord,
  };

  const { data, error } = await adminClient
    .from("conference_registrations")
    .update({
      registration_custom_answers: nextCustomAnswers as RegistrationUpdate["registration_custom_answers"],
      updated_at: now,
    })
    .eq("id", registrationId)
    .select()
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? "Failed to request exception." };
  }

  await logAuditEventSafe({
    action: "conference_travel_exception_requested",
    entityType: "conference_registration",
    entityId: registrationId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: {
      conferenceId: reg.conference_id,
      registrationId,
      reason: trimmedReason,
      arrivalDate: arrivalRaw,
      departureDate: departureRaw,
    },
  });

  return { success: true, data: data as RegistrationRow };
}

export async function reviewTravelWindowException(
  registrationId: string,
  decision: "approved" | "rejected",
  reviewNote?: string
): Promise<{ success: boolean; error?: string; data?: RegistrationRow }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data: reg, error: regErr } = await adminClient
    .from("conference_registrations")
    .select("*")
    .eq("id", registrationId)
    .single();
  if (regErr || !reg) {
    return { success: false, error: "Registration not found." };
  }

  const customAnswers = readCustomAnswers(reg);
  const existing = readTravelWindowException(reg);
  if (!existing || existing.status !== "pending") {
    return { success: false, error: "No pending travel exception request found." };
  }

  const now = new Date().toISOString();
  const nextCustomAnswers: Record<string, unknown> = {
    ...customAnswers,
    travel_window_exception: {
      ...existing,
      status: decision,
      reviewed_at: now,
      reviewed_by: auth.ctx.userId,
      review_note: (reviewNote ?? "").trim() || null,
    } satisfies TravelWindowExceptionRecord,
  };

  const { data, error } = await adminClient
    .from("conference_registrations")
    .update({
      registration_custom_answers: nextCustomAnswers as RegistrationUpdate["registration_custom_answers"],
      updated_at: now,
    })
    .eq("id", registrationId)
    .select()
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? "Failed to review exception." };
  }

  await logAuditEventSafe({
    action:
      decision === "approved"
        ? "conference_travel_exception_approved"
        : "conference_travel_exception_rejected",
    entityType: "conference_registration",
    entityId: registrationId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: {
      conferenceId: reg.conference_id,
      registrationId,
      note: (reviewNote ?? "").trim() || null,
    },
  });

  return { success: true, data: data as RegistrationRow };
}

// ─────────────────────────────────────────────────────────────────
// Cancel registration
// ─────────────────────────────────────────────────────────────────

export async function cancelRegistration(
  registrationId: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  const { data: reg, error: regErr } = await adminClient
    .from("conference_registrations")
    .select("user_id, status")
    .eq("id", registrationId)
    .single();

  if (regErr || !reg) {
    return { success: false, error: "Registration not found" };
  }
  if (reg.user_id !== auth.ctx.userId && !isGlobalAdmin(auth.ctx.globalRole)) {
    return { success: false, error: "Not authorized" };
  }

  const allowed = REGISTRATION_STATUS_TRANSITIONS[reg.status as RegistrationStatus];
  if (!allowed?.includes("canceled")) {
    return { success: false, error: "Registration cannot be canceled in its current state" };
  }

  const { error } = await adminClient
    .from("conference_registrations")
    .update({ status: "canceled", updated_at: new Date().toISOString() })
    .eq("id", registrationId);

  if (error) return { success: false, error: error.message };

  const { data: canceled } = await adminClient
    .from("conference_registrations")
    .select("conference_id")
    .eq("id", registrationId)
    .maybeSingle();
  if (canceled?.conference_id) {
    await syncConferencePeopleIndex(canceled.conference_id).catch((syncError) => {
      console.warn("[conference-registration] syncConferencePeopleIndex(cancel) failed", {
        conferenceId: canceled.conference_id,
        error: syncError instanceof Error ? syncError.message : String(syncError),
      });
    });
  }
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────
// Get my registration
// ─────────────────────────────────────────────────────────────────

export async function getMyRegistration(
  conferenceId: string,
  registrationType: RegistrationType
): Promise<{ success: boolean; error?: string; data?: RegistrationRow | null }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const { data, error } = await auth.ctx.supabase
    .from("conference_registrations")
    .select("*")
    .eq("conference_id", conferenceId)
    .eq("user_id", auth.ctx.userId)
    .eq("registration_type", registrationType)
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  return { success: true, data };
}

export async function getMyRegistrationsForConference(
  conferenceId: string
): Promise<{ success: boolean; error?: string; data?: RegistrationRow[] }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const { data, error } = await auth.ctx.supabase
    .from("conference_registrations")
    .select("*")
    .eq("conference_id", conferenceId)
    .eq("user_id", auth.ctx.userId);

  if (error) return { success: false, error: error.message };
  return { success: true, data: data ?? [] };
}

// ─────────────────────────────────────────────────────────────────
// Org admin: Get org registrations
// ─────────────────────────────────────────────────────────────────

export async function getOrgRegistrations(
  conferenceId: string,
  orgId: string
): Promise<{ success: boolean; error?: string; data?: RegistrationRow[] }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  if (!isGlobalAdmin(auth.ctx.globalRole) && !auth.ctx.orgAdminOrgIds.includes(orgId)) {
    return { success: false, error: "Not authorized for this organization" };
  }

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("conference_registrations")
    .select("*")
    .eq("conference_id", conferenceId)
    .eq("organization_id", orgId);

  if (error) return { success: false, error: error.message };
  return { success: true, data: data ?? [] };
}

// ─────────────────────────────────────────────────────────────────
// Admin: Get all registrations with optional filters
// ─────────────────────────────────────────────────────────────────

export async function getAllRegistrations(
  conferenceId: string,
  filters?: { status?: string; registration_type?: string; organization_id?: string }
): Promise<{ success: boolean; error?: string; data?: RegistrationRow[] }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  let query = adminClient
    .from("conference_registrations")
    .select("*")
    .eq("conference_id", conferenceId);

  if (filters?.status) query = query.eq("status", filters.status);
  if (filters?.registration_type) query = query.eq("registration_type", filters.registration_type);
  if (filters?.organization_id) query = query.eq("organization_id", filters.organization_id);

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) return { success: false, error: error.message };
  return { success: true, data: data ?? [] };
}

// ─────────────────────────────────────────────────────────────────
// Admin: Update registration status
// ─────────────────────────────────────────────────────────────────

export async function adminUpdateRegistrationStatus(
  registrationId: string,
  newStatus: RegistrationStatus
): Promise<{ success: boolean; error?: string; data?: RegistrationRow }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  const { data: reg, error: regErr } = await adminClient
    .from("conference_registrations")
    .select("status")
    .eq("id", registrationId)
    .single();

  if (regErr || !reg) {
    return { success: false, error: "Registration not found" };
  }

  const current = reg.status as RegistrationStatus;
  const allowed = REGISTRATION_STATUS_TRANSITIONS[current];
  if (!allowed.includes(newStatus)) {
    return {
      success: false,
      error: `Cannot transition from "${current}" to "${newStatus}"`,
    };
  }

  const { data, error } = await adminClient
    .from("conference_registrations")
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq("id", registrationId)
    .select()
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, data };
}
