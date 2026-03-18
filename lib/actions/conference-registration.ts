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
import {
  evaluateRulesEngine,
  normalizeRulesEngine,
  type RulesEngineAction,
  type RulesEngineEvalContext,
} from "@/lib/conference/rules-engine";
import type { Database } from "@/lib/database.types";

type RegistrationRow = Database["public"]["Tables"]["conference_registrations"]["Row"];
type RegistrationUpdate = Database["public"]["Tables"]["conference_registrations"]["Update"];
export type AdminRegistrationRow = RegistrationRow & {
  user_display_name: string | null;
  organization_name: string | null;
};

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

type TravelSupportMode = "managed" | "reimbursement" | "self_managed" | "none";
type ManagementMode = "fully_managed" | "partially_managed" | "attendee_managed";

type TravelPolicyDecision = {
  effectiveTravelSupportMode: TravelSupportMode;
  travelManagementMode: ManagementMode;
  accommodationManagementMode: ManagementMode;
  airTravelAllowed: boolean;
  organizationDistanceKm: number | null;
  matchedOverrideRules: Array<{
    condition: string;
    action: string;
    thresholdKm: number | null;
    reason: string;
  }>;
  travelBookingOwner: "csc" | "attendee" | "none";
  travelPaymentOwner: "csc" | "attendee" | "reimbursement";
  accommodationBookingOwner: "csc" | "attendee";
  accommodationPaymentOwner: "csc" | "attendee";
  attendeeGuidance: string[];
  rulesEngineTravelRequirements: {
    requiresTravelIntake: boolean | null;
    requiresAccommodationIntake: boolean | null;
  };
};

const AIRPORT_COORDINATES_BY_IATA: Record<string, { lat: number; lon: number }> = {
  YYZ: { lat: 43.6777, lon: -79.6248 },
  YTZ: { lat: 43.6275, lon: -79.3962 },
  YVR: { lat: 49.1967, lon: -123.1815 },
  YYC: { lat: 51.1139, lon: -114.0203 },
  YEG: { lat: 53.3097, lon: -113.5797 },
  YUL: { lat: 45.4706, lon: -73.7408 },
  YOW: { lat: 45.3225, lon: -75.6692 },
  YWG: { lat: 49.910, lon: -97.2399 },
  YHZ: { lat: 44.8808, lon: -63.5086 },
  YXE: { lat: 52.1708, lon: -106.6999 },
  YQR: { lat: 50.4319, lon: -104.6661 },
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

function toFiniteNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeManagementMode(value: unknown): ManagementMode {
  if (value === "fully_managed" || value === "partially_managed" || value === "attendee_managed") {
    return value;
  }
  return "partially_managed";
}

function normalizeTravelSupportMode(value: unknown): TravelSupportMode {
  if (value === "managed" || value === "reimbursement" || value === "self_managed" || value === "none") {
    return value;
  }
  return "managed";
}

function normalizeTravelModeForStorage(value: unknown): "flight" | "road" | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (["flight", "air", "plane"].includes(normalized)) return "flight";
  if (
    [
      "road",
      "car",
      "personal vehicle",
      "personal_vehicle",
      "rail",
      "bus",
      "bus/coach",
      "other",
    ].includes(normalized)
  ) {
    return "road";
  }
  return null;
}

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function normalizeOrgTypeForRules(value: unknown): string {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "member") return "member";
  if (raw === "vendor partner" || raw === "vendor_partner") return "vendor_partner";
  return raw;
}

function isRulesActionTargetMatch(
  action: RulesEngineAction,
  context: RulesEngineEvalContext
): boolean {
  if ("target_product_id" in action) {
    const matchesProductId = !action.target_product_id || action.target_product_id === context.product_id;
    const matchesSlug = !action.target_product_slug || action.target_product_slug === context.product_slug;
    return matchesProductId && matchesSlug;
  }
  return true;
}

async function evaluateTravelPolicyForRegistration(params: {
  adminClient: ReturnType<typeof createAdminClient>;
  conferenceId: string;
  organizationId: string;
  registrationType: string;
  registrationCustomAnswers?: Record<string, unknown> | null;
}): Promise<TravelPolicyDecision> {
  const {
    adminClient,
    conferenceId,
    organizationId,
    registrationType,
    registrationCustomAnswers = null,
  } = params;

  const [moduleRes, regOpsModuleRes, organizationRes, orgRegistrationCountRes] = await Promise.all([
    adminClient
      .from("conference_schedule_modules")
      .select("config_json")
      .eq("conference_id", conferenceId)
      .eq("module_key", "travel_accommodation")
      .maybeSingle(),
    adminClient
      .from("conference_schedule_modules")
      .select("config_json")
      .eq("conference_id", conferenceId)
      .eq("module_key", "registration_ops")
      .maybeSingle(),
    adminClient
      .from("organizations")
      .select("id, type, organization_type, membership_status, latitude, longitude")
      .eq("id", organizationId)
      .maybeSingle(),
    adminClient
      .from("conference_registrations")
      .select("id", { count: "exact", head: true })
      .eq("conference_id", conferenceId)
      .eq("organization_id", organizationId),
  ]);

  const policyValues = await getEffectivePolicies([
    "conference.travel_management_mode",
    "conference.accommodation_management_mode",
    "conference.travel_disable_air_within_km",
    "conference.travel_nearby_support_mode",
  ]).catch(() => ({} as Record<string, unknown>));

  const config =
    moduleRes.data?.config_json && typeof moduleRes.data.config_json === "object"
      ? (moduleRes.data.config_json as Record<string, unknown>)
      : {};
  const org = organizationRes.data;
  const orgLat = toFiniteNumber(org?.latitude);
  const orgLon = toFiniteNumber(org?.longitude);

  const travelManagementMode = normalizeManagementMode(
    config.travel_management_mode ?? policyValues["conference.travel_management_mode"]
  );
  const accommodationManagementMode = normalizeManagementMode(
    config.accommodation_management_mode ?? policyValues["conference.accommodation_management_mode"]
  );
  const travelManagementScope =
    config.travel_management_scope === "all_managed" ||
    config.travel_management_scope === "some_managed" ||
    config.travel_management_scope === "none_managed"
      ? (config.travel_management_scope as "all_managed" | "some_managed" | "none_managed")
      : null;

  let effectiveTravelSupportMode: TravelSupportMode =
    travelManagementMode === "fully_managed"
      ? "managed"
      : travelManagementMode === "attendee_managed"
        ? "self_managed"
        : "managed";
  if (travelManagementScope === "none_managed") {
    effectiveTravelSupportMode = "self_managed";
  }

  let airTravelAllowed = true;
  const matchedOverrideRules: TravelPolicyDecision["matchedOverrideRules"] = [];
  let rulesEngineRequiresTravelIntake: boolean | null = null;
  let rulesEngineRequiresAccommodationIntake: boolean | null = null;

  let organizationDistanceKm: number | null = null;
  const destinationAirportEntries = Array.isArray(config.destination_airports)
    ? (config.destination_airports as Array<Record<string, unknown>>)
    : [];
  if (orgLat != null && orgLon != null && destinationAirportEntries.length > 0) {
    const distances: number[] = [];
    for (const entry of destinationAirportEntries) {
      const code = typeof entry.code === "string" ? entry.code.trim().toUpperCase() : "";
      if (!code) continue;
      const airportCoords = AIRPORT_COORDINATES_BY_IATA[code];
      if (!airportCoords) continue;
      distances.push(haversineKm(orgLat, orgLon, airportCoords.lat, airportCoords.lon));
    }
    if (distances.length > 0) {
      organizationDistanceKm = Math.min(...distances);
    }
  }

  const orgRegistrationCount = orgRegistrationCountRes.count ?? 0;
  const rawRuleMap = (
    config.registration_option_travel_rules ??
    config.registration_product_travel_rules ??
    {}
  ) as Record<string, unknown>;
  const customAnswers =
    registrationCustomAnswers &&
    typeof registrationCustomAnswers === "object" &&
    !Array.isArray(registrationCustomAnswers)
      ? registrationCustomAnswers
      : {};
  const registrationOptionId =
    typeof customAnswers.registration_option_id === "string"
      ? customAnswers.registration_option_id
      : null;
  const registrationProductIds = Array.isArray(customAnswers.registration_product_ids)
    ? customAnswers.registration_product_ids.filter(
        (entry): entry is string => typeof entry === "string" && entry.trim().length > 0
      )
    : [];
  if (
    typeof customAnswers.registration_primary_product_id === "string" &&
    customAnswers.registration_primary_product_id.trim().length > 0
  ) {
    registrationProductIds.unshift(customAnswers.registration_primary_product_id);
  }
  const uniqueRegistrationProductIds = Array.from(new Set(registrationProductIds));
  const productSlugById = new Map<string, string>();
  if (uniqueRegistrationProductIds.length > 0) {
    const { data: selectedProducts } = await adminClient
      .from("conference_products")
      .select("id, slug")
      .in("id", uniqueRegistrationProductIds);
    for (const row of selectedProducts ?? []) {
      if (typeof row.id === "string" && typeof row.slug === "string") {
        productSlugById.set(row.id, row.slug);
      }
    }
  }

  const rawRuleEntries = Object.entries(rawRuleMap);
  const ruleEntries =
    uniqueRegistrationProductIds.length > 0
      ? rawRuleEntries.filter(([key]) => uniqueRegistrationProductIds.includes(key))
      : registrationOptionId
        ? rawRuleEntries.filter(([key]) => key === registrationOptionId)
        : rawRuleEntries.filter(([key]) =>
            key.toLowerCase().startsWith(`${registrationType.toLowerCase()}::`)
          );
  for (const [key, rawRule] of ruleEntries) {
    if (!rawRule || typeof rawRule !== "object" || Array.isArray(rawRule)) continue;
    const overrides = Array.isArray((rawRule as Record<string, unknown>).conditional_overrides)
      ? ((rawRule as Record<string, unknown>).conditional_overrides as Array<Record<string, unknown>>)
      : [];
    for (const override of overrides) {
      const condition = typeof override.condition === "string" ? override.condition : "";
      const action = typeof override.action === "string" ? override.action : "";
      const conditionNumberValue = toFiniteNumber(override.condition_number_value);
      const conditionTextValue =
        typeof override.condition_text_value === "string"
          ? override.condition_text_value.trim().toLowerCase()
          : "";

      let conditionMatched = false;
      if (condition === "org_distance_to_airport_km_lte") {
        conditionMatched =
          organizationDistanceKm != null &&
          conditionNumberValue != null &&
          organizationDistanceKm <= conditionNumberValue;
      } else if (condition === "org_type_is") {
        const orgType = typeof org?.type === "string" ? org.type.toLowerCase() : "";
        const orgSubtype =
          typeof org?.organization_type === "string" ? org.organization_type.toLowerCase() : "";
        conditionMatched = Boolean(
          conditionTextValue &&
            (orgType === conditionTextValue || orgSubtype === conditionTextValue)
        );
      } else if (condition === "org_type_registration_count_gt") {
        conditionMatched =
          conditionNumberValue != null && orgRegistrationCount > conditionNumberValue;
      }

      if (!conditionMatched) continue;
      if (action === "disable_air_travel_option") {
        airTravelAllowed = false;
      } else if (action === "set_travel_support_mode") {
        effectiveTravelSupportMode = normalizeTravelSupportMode(override.action_text_value);
      }
      matchedOverrideRules.push({
        condition,
        action,
        thresholdKm: condition === "org_distance_to_airport_km_lte" ? conditionNumberValue : null,
        reason: `Matched override for ${key}`,
      });
    }
  }

  const policyDistanceThresholdKm = toFiniteNumber(
    policyValues["conference.travel_disable_air_within_km"]
  );
  if (
    policyDistanceThresholdKm != null &&
    organizationDistanceKm != null &&
    organizationDistanceKm <= policyDistanceThresholdKm
  ) {
    airTravelAllowed = false;
    const nearbySupportModeRaw = policyValues["conference.travel_nearby_support_mode"];
    if (nearbySupportModeRaw != null) {
      effectiveTravelSupportMode = normalizeTravelSupportMode(nearbySupportModeRaw);
    }
    matchedOverrideRules.push({
      condition: "policy.travel_disable_air_within_km",
      action: "disable_air_travel_option",
      thresholdKm: policyDistanceThresholdKm,
      reason: "Matched conference-level nearby-travel policy.",
    });
  }

  const regOpsConfig =
    regOpsModuleRes.data?.config_json && typeof regOpsModuleRes.data.config_json === "object"
      ? (regOpsModuleRes.data.config_json as Record<string, unknown>)
      : {};
  const rulesEngine = normalizeRulesEngine(regOpsConfig.rules_engine_v1 ?? null);
  const travelEvalContexts: RulesEngineEvalContext[] =
    uniqueRegistrationProductIds.length > 0
      ? uniqueRegistrationProductIds.map((productId) => ({
          org_membership_status:
            typeof org?.membership_status === "string" ? org.membership_status : null,
          org_type: normalizeOrgTypeForRules(org?.type ?? org?.organization_type ?? null),
          user_is_authenticated: true,
          org_registration_count: orgRegistrationCount,
          product_id: productId,
          product_slug: productSlugById.get(productId),
        }))
      : [
          {
            org_membership_status:
              typeof org?.membership_status === "string" ? org.membership_status : null,
            org_type: normalizeOrgTypeForRules(org?.type ?? org?.organization_type ?? null),
            user_is_authenticated: true,
            org_registration_count: orgRegistrationCount,
            product_id: undefined,
            product_slug: undefined,
          },
        ];

  for (const context of travelEvalContexts) {
    const evaluation = evaluateRulesEngine(rulesEngine, "travel_intake_save", context);
    for (const action of evaluation.actions) {
      if (!isRulesActionTargetMatch(action, context)) continue;
      if (action.type === "set_travel_support_mode") {
        effectiveTravelSupportMode = normalizeTravelSupportMode(action.mode);
        matchedOverrideRules.push({
          condition: "rules_engine.travel_intake_save",
          action: "set_travel_support_mode",
          thresholdKm: null,
          reason: action.reason || "Rules engine travel support mode override.",
        });
        continue;
      }
      if (action.type === "set_travel_requirement") {
        if (action.requirement === "air_travel_allowed") {
          airTravelAllowed = action.value;
        } else if (action.requirement === "requires_travel_intake") {
          rulesEngineRequiresTravelIntake = action.value;
        } else if (action.requirement === "requires_accommodation_intake") {
          rulesEngineRequiresAccommodationIntake = action.value;
        }
        matchedOverrideRules.push({
          condition: "rules_engine.travel_intake_save",
          action: `set_travel_requirement.${action.requirement}`,
          thresholdKm: null,
          reason: action.reason || "Rules engine travel requirement override.",
        });
      }
    }
  }

  const travelBookingOwner: TravelPolicyDecision["travelBookingOwner"] =
    effectiveTravelSupportMode === "managed"
      ? "csc"
      : effectiveTravelSupportMode === "none"
        ? "none"
        : "attendee";
  const travelPaymentOwner: TravelPolicyDecision["travelPaymentOwner"] =
    effectiveTravelSupportMode === "managed"
      ? "csc"
      : effectiveTravelSupportMode === "reimbursement"
        ? "reimbursement"
        : "attendee";
  const accommodationBookingOwner: TravelPolicyDecision["accommodationBookingOwner"] =
    accommodationManagementMode === "attendee_managed" ? "attendee" : "csc";
  const accommodationPaymentOwner: TravelPolicyDecision["accommodationPaymentOwner"] =
    accommodationManagementMode === "attendee_managed" ? "attendee" : "csc";

  const attendeeGuidance: string[] = [];
  if (!airTravelAllowed) {
    attendeeGuidance.push(
      "Air travel is not covered for this registration path. Use road travel and submit mileage where applicable."
    );
  }
  if (effectiveTravelSupportMode === "reimbursement") {
    attendeeGuidance.push("Book your own travel; eligible costs are reimbursed per policy.");
  } else if (effectiveTravelSupportMode === "self_managed") {
    attendeeGuidance.push("Travel is self-managed and not centrally booked.");
  } else if (effectiveTravelSupportMode === "managed") {
    attendeeGuidance.push("Travel is centrally managed by CSC operations.");
  }
  attendeeGuidance.push(
    accommodationManagementMode === "attendee_managed"
      ? "Accommodation is self-managed."
      : "Accommodation is managed through CSC room blocks."
  );
  if (rulesEngineRequiresTravelIntake === false) {
    attendeeGuidance.push("Travel intake is optional for this registration path.");
  }
  if (rulesEngineRequiresAccommodationIntake === false) {
    attendeeGuidance.push("Accommodation intake is optional for this registration path.");
  }

  return {
    effectiveTravelSupportMode,
    travelManagementMode,
    accommodationManagementMode,
    airTravelAllowed,
    organizationDistanceKm,
    matchedOverrideRules,
    travelBookingOwner,
    travelPaymentOwner,
    accommodationBookingOwner,
    accommodationPaymentOwner,
    attendeeGuidance,
    rulesEngineTravelRequirements: {
      requiresTravelIntake: rulesEngineRequiresTravelIntake,
      requiresAccommodationIntake: rulesEngineRequiresAccommodationIntake,
    },
  };
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
    .select("conference_id, user_id, status, travel_consent_given, organization_id, registration_type, registration_custom_answers")
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

  const normalizedTravelMode = normalizeTravelModeForStorage(safeFields.travel_mode);
  if ("travel_mode" in safeFields && safeFields.travel_mode != null && normalizedTravelMode == null) {
    return {
      success: false,
      error:
        "Travel mode must be one of: flight/air, rail, bus/coach, personal vehicle, or road.",
    };
  }
  if (normalizedTravelMode) {
    safeFields.travel_mode = normalizedTravelMode;
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

  const existingCustomAnswers = readCustomAnswers(reg as RegistrationRow);
  const incomingCustomAnswers =
    safeFields.registration_custom_answers &&
    typeof safeFields.registration_custom_answers === "object" &&
    !Array.isArray(safeFields.registration_custom_answers)
      ? (safeFields.registration_custom_answers as Record<string, unknown>)
      : {};
  const mergedCustomAnswers: Record<string, unknown> = {
    ...existingCustomAnswers,
    ...incomingCustomAnswers,
  };

  const travelPolicyDecision = await evaluateTravelPolicyForRegistration({
    adminClient,
    conferenceId: reg.conference_id,
    organizationId: reg.organization_id,
    registrationType: reg.registration_type,
    registrationCustomAnswers: mergedCustomAnswers,
  });
  if (safeFields.travel_mode === "flight" && !travelPolicyDecision.airTravelAllowed) {
    const roundedDistance =
      travelPolicyDecision.organizationDistanceKm != null
        ? Math.round(travelPolicyDecision.organizationDistanceKm)
        : null;
    const reimbursementHint =
      travelPolicyDecision.effectiveTravelSupportMode === "reimbursement"
        ? "Road mileage reimbursement applies under current policy."
        : "Please select road travel.";
    return {
      success: false,
      error:
        roundedDistance != null
          ? `Air travel is not allowed under current policy (organization is ~${roundedDistance} km from destination). ${reimbursementHint}`
          : `Air travel is not allowed under current policy. ${reimbursementHint}`,
    };
  }

  safeFields.registration_custom_answers = {
    ...mergedCustomAnswers,
    travel_ops_classification: {
      decision_pipeline_version: "travel_ops_v2",
      travel_management_mode: travelPolicyDecision.travelManagementMode,
      accommodation_management_mode: travelPolicyDecision.accommodationManagementMode,
      effective_travel_support_mode: travelPolicyDecision.effectiveTravelSupportMode,
      travel_booking_owner: travelPolicyDecision.travelBookingOwner,
      travel_payment_owner: travelPolicyDecision.travelPaymentOwner,
      accommodation_booking_owner: travelPolicyDecision.accommodationBookingOwner,
      accommodation_payment_owner: travelPolicyDecision.accommodationPaymentOwner,
      air_travel_allowed: travelPolicyDecision.airTravelAllowed,
      requires_travel_intake:
        travelPolicyDecision.rulesEngineTravelRequirements.requiresTravelIntake,
      requires_accommodation_intake:
        travelPolicyDecision.rulesEngineTravelRequirements.requiresAccommodationIntake,
      organization_distance_to_destination_airport_km: travelPolicyDecision.organizationDistanceKm,
      matched_override_rules: travelPolicyDecision.matchedOverrideRules,
      attendee_guidance: travelPolicyDecision.attendeeGuidance,
      computed_at: new Date().toISOString(),
    },
  } satisfies Record<string, unknown>;

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
  filters?: {
    status?: string;
    registration_type?: string;
    organization_id?: string;
    created_at_from?: string;
    created_at_to?: string;
  }
): Promise<{ success: boolean; error?: string; data?: AdminRegistrationRow[] }> {
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
  if (filters?.created_at_from) query = query.gte("created_at", `${filters.created_at_from}T00:00:00.000Z`);
  if (filters?.created_at_to) query = query.lte("created_at", `${filters.created_at_to}T23:59:59.999Z`);

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) return { success: false, error: error.message };

  const registrations = data ?? [];
  if (registrations.length === 0) {
    return { success: true, data: [] };
  }

  const userIds = Array.from(
    new Set(
      registrations
        .map((row) => row.user_id)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
    )
  );

  let profileById = new Map<string, string | null>();
  let organizationById = new Map<string, string | null>();

  if (userIds.length > 0) {
    const { data: profiles, error: profileError } = await adminClient
      .from("profiles")
      .select("id, display_name")
      .in("id", userIds);

    if (profileError) return { success: false, error: profileError.message };
    profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile.display_name]));
  }

  const organizationIds = Array.from(
    new Set(
      registrations
        .map((row) => row.organization_id)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
    )
  );
  if (organizationIds.length > 0) {
    const { data: organizations, error: organizationError } = await adminClient
      .from("organizations")
      .select("id, name")
      .in("id", organizationIds);

    if (organizationError) return { success: false, error: organizationError.message };
    organizationById = new Map((organizations ?? []).map((org) => [org.id, org.name]));
  }

  const enrichedRows: AdminRegistrationRow[] = registrations.map((row) => ({
    ...row,
    user_display_name: profileById.get(row.user_id) ?? null,
    organization_name: organizationById.get(row.organization_id) ?? null,
  }));

  return { success: true, data: enrichedRows };
}

export type RegistrationExportPreset =
  | "summary"
  | "all"
  | "hotel_rooming"
  | "airline_booking"
  | "catering_dietary"
  | "emergency_contacts";

export async function recordRegistrationExportEvent(input: {
  conferenceId: string;
  preset: RegistrationExportPreset;
  rowCount: number;
  filters?: Record<string, unknown>;
  sharedWith?: string | null;
}): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  await logAuditEventSafe({
    action: "conference_registration_exported",
    entityType: "conference_instance",
    entityId: input.conferenceId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: {
      preset: input.preset,
      row_count: input.rowCount,
      shared_with: input.sharedWith ?? null,
      filters: input.filters ?? {},
    },
  });

  return { success: true };
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
