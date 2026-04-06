"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createSuggestedEducationProducts,
  createSuggestedMeetingProducts,
  createSuggestedMealProducts,
  createSuggestedOffsiteProducts,
  createSuggestedTradeShowProducts,
  regenerateProgramFromSetup,
  reconcileConferenceSetupAndPeople,
  reconcileConferenceScheduleSetup,
  saveConferenceScheduleModules,
  type ConferenceScheduleModuleKey,
  type ConferenceScheduleModuleRow,
} from "@/lib/actions/conference-schedule-design";
import { loadGooglePlacesScript } from "@/lib/google/places";

type ParamsRow = {
  id: string;
  conference_id: string;
  conference_days: number;
  meeting_slots_per_day: number;
  slot_duration_minutes: number;
  slot_buffer_minutes: number;
  meeting_start_time: string;
  meeting_end_time: string;
  flex_time_start: string | null;
  flex_time_end: string | null;
  total_meeting_suites: number;
  delegate_target_meetings: number | null;
};

interface ScheduleDesignWizardProps {
  conferenceId: string;
  params: ParamsRow | null;
  initialModules: ConferenceScheduleModuleRow[];
  conferenceStartDate: string | null;
  conferenceEndDate: string | null;
  conferenceRegistrationOpenAt?: string | null;
  conferenceRegistrationCloseAt?: string | null;
  googleMapsApiKey?: string | null;
  initialProducts?: Array<{
    id: string;
    slug: string;
    name: string;
    price_cents: number;
    is_active: boolean;
  }>;
}

const MODULES: Array<{
  key: ConferenceScheduleModuleKey;
  label: string;
  description: string;
  alwaysIncluded?: boolean;
  v12Stub?: boolean;
}> = [
  {
    key: "meetings",
    label: "Meetings",
    description: "Scheduled meeting blocks (1:1, group, and related matching workflows).",
  },
  {
    key: "trade_show",
    label: "Trade Show",
    description: "Exhibit-floor blocks and logistics (ex: move-in).",
  },
  {
    key: "education",
    label: "Education",
    description: "Sessions, speakers, abstracts, and education schedule.",
  },
  {
    key: "meals",
    label: "Meals",
    description: "Breakfast/lunch/dinner/networking meal blocks.",
  },
  {
    key: "offsite",
    label: "Offsite Events",
    description: "Venue-shifted sessions and transportation details.",
  },
  {
    key: "custom",
    label: "Custom + Define",
    description: "Anything unique to this conference.",
  },
  {
    key: "registration_ops",
    label: "Registration Operations",
    description: "Check-in, onsite edits, walk-ins, and badge reprint flow.",
    alwaysIncluded: true,
  },
  {
    key: "communications",
    label: "Communications",
    description: "Announcements, segmented alerts, and schedule-change messaging.",
    alwaysIncluded: true,
  },
  {
    key: "sponsorship_ops",
    label: "Sponsorship Operations",
    description: "Sponsor deliverables, placements, and activation tracking.",
  },
  {
    key: "logistics",
    label: "Logistics",
    description: "Freight/dock/storage workflows and exhibitor logistics controls.",
  },
  {
    key: "travel_accommodation",
    label: "Travel + Accommodation",
    description: "Hotel blocks, transport windows, and travel coordination.",
  },
  {
    key: "content_capture",
    label: "Content Capture",
    description: "Recording/media capture and consent-aware content handling.",
    v12Stub: true,
  },
  {
    key: "lead_capture",
    label: "Lead Capture",
    description: "Exhibitor lead scans, exports, and privacy controls.",
    v12Stub: true,
  },
  {
    key: "compliance_safety",
    label: "Compliance + Safety",
    description: "Incident/safety handling and compliance requirements.",
    v12Stub: true,
  },
  {
    key: "staffing",
    label: "Staffing",
    description: "Staff/crew shifts and operational staffing coverage.",
    v12Stub: true,
  },
  {
    key: "post_event",
    label: "Post-Event",
    description: "Surveys, credits/certificates, and post-event outputs.",
    v12Stub: true,
  },
  {
    key: "virtual_hybrid",
    label: "Virtual / Hybrid",
    description: "Streaming and hybrid attendee schedule mapping.",
    v12Stub: true,
  },
  {
    key: "expo_floor_plan",
    label: "Expo Floor Plan",
    description: "Booth map, assignments, and floor-plan constraints.",
    v12Stub: true,
  },
];

const DEFAULT_MEETING_PRIORITIES = [
  "No blackout conflicts",
  "No duplicate exhibitor organization per delegate",
  "Meet delegate target meetings",
  "Meet exhibitor target meetings",
  "Maximize organization coverage",
  "Honor top preferences",
];

type AirportCodeType = "airport" | "metro";
type TravelSectionKey =
  | "hotels"
  | "destination_airports"
  | "airline_policies"
  | "travel_policies"
  | "reimbursement_policies"
  | "travel_rules";
type TravelSectionSignatures = Record<TravelSectionKey, string>;
type PreflightSeverity = "blocking" | "warning" | "info";
type PreflightIssue = {
  id: string;
  severity: PreflightSeverity;
  title: string;
  detail: string;
  moduleKey?: ConferenceScheduleModuleKey;
  actionLabel?: string;
  actionHref?: string;
};
type AirportReference = {
  code: string;
  codeType: AirportCodeType;
  name: string;
  city: string;
  country: string;
};

const METRO_CODE_FALLBACKS: AirportReference[] = [
  {
    code: "LON",
    codeType: "metro",
    name: "London Metropolitan Area (city code)",
    city: "London",
    country: "GB",
  },
  {
    code: "NYC",
    codeType: "metro",
    name: "New York Metropolitan Area (city code)",
    city: "New York",
    country: "US",
  },
  {
    code: "TYO",
    codeType: "metro",
    name: "Tokyo Metropolitan Area (city code)",
    city: "Tokyo",
    country: "JP",
  },
];

function normalizeAirportLookupText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function buildTravelSectionSignatures(config: Record<string, unknown>): TravelSectionSignatures {
  const stable = (value: unknown): string => JSON.stringify(value ?? []);
  return {
    hotels: stable(Array.isArray(config.hotels) ? config.hotels : []),
    destination_airports: stable(
      Array.isArray(config.destination_airports) ? config.destination_airports : []
    ),
    airline_policies: stable(Array.isArray(config.airline_policies) ? config.airline_policies : []),
    travel_policies: stable(Array.isArray(config.travel_policies) ? config.travel_policies : []),
    reimbursement_policies: stable(
      Array.isArray(config.reimbursement_policies) ? config.reimbursement_policies : []
    ),
    travel_rules: stable({
      travel_management_mode: config.travel_management_mode ?? null,
      accommodation_management_mode: config.accommodation_management_mode ?? null,
      travel_disable_air_within_km: config.travel_disable_air_within_km ?? null,
      travel_nearby_support_mode: config.travel_nearby_support_mode ?? null,
    }),
  };
}

function findAirportReference(query: string): AirportReference | null {
  const normalized = normalizeAirportLookupText(query);
  if (!normalized) return null;
  const upper = normalized.toUpperCase().slice(0, 3);
  return METRO_CODE_FALLBACKS.find((entry) => entry.code === upper) ?? null;
}


function normalizePriorityList(input: string[]): string[] {
  const set = new Set<string>();
  for (const item of input) {
    const trimmed = item?.trim();
    if (trimmed) set.add(trimmed);
  }
  for (const fallback of DEFAULT_MEETING_PRIORITIES) set.add(fallback);
  return [...set];
}

function getConferenceDates(startDate: string | null, endDate: string | null): string[] {
  if (!startDate || !endDate) return [];
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()) || end < start) return [];

  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const yyyy = cursor.getFullYear();
    const mm = String(cursor.getMonth() + 1).padStart(2, "0");
    const dd = String(cursor.getDate()).padStart(2, "0");
    dates.push(`${yyyy}-${mm}-${dd}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function formatDateLabel(dateValue: string): string {
  const date = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(date.valueOf())) return dateValue;
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function parseLocalDateTime(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (!match) return null;
  const [, y, m, d, hh, mm, ss = "0"] = match;
  const date = new Date(
    Number(y),
    Number(m) - 1,
    Number(d),
    Number(hh),
    Number(mm),
    Number(ss)
  );
  if (Number.isNaN(date.valueOf())) return null;
  return date;
}

function shiftDateTimeLocal(value: string, hoursDelta: number): string {
  if (!value.trim()) return "";
  const date = parseLocalDateTime(value);
  if (!date) return "";
  date.setHours(date.getHours() + hoursDelta);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

type MeetingDaySetting = {
  day_type?: "full_day" | "half_day" | "travel" | "other" | "custom";
  meeting_count?: number;
  start_time?: string;
  end_time?: string;
  slot_duration_minutes?: number;
  buffer_minutes?: number;
};

type TradeShowDaySetting = {
  day_type?: "full_day" | "half_day" | "travel" | "other" | "custom";
  open_time?: string;
  close_time?: string;
};

type EducationDaySetting = {
  day_type?: "full_day" | "half_day" | "travel" | "other" | "custom";
  start_time?: string;
  end_time?: string;
};

type MealDaySetting = {
  day_type?: "full_day" | "half_day" | "travel" | "other" | "custom";
  breakfast?: boolean;
  lunch?: boolean;
  dinner?: boolean;
  custom_enabled?: boolean;
  custom_label?: string;
  breakfast_time?: string;
  lunch_time?: string;
  dinner_time?: string;
  custom_time?: string;
  breakfast_duration_minutes?: number;
  lunch_duration_minutes?: number;
  dinner_duration_minutes?: number;
  custom_duration_minutes?: number;
  snack_breaks?: Array<{
    start_time: string;
    duration_minutes: number;
  }>;
};

type OffsiteTravelMode = "walk" | "shuttle" | "bus" | "own_transport";
type OffsiteMealType = "breakfast" | "lunch" | "dinner" | "snack" | "custom";
type OffsiteRegistrationType = "delegate" | "observer" | "exhibitor" | "staff";
type RegistrationTypeKey =
  | "delegate"
  | "exhibitor"
  | "speaker"
  | "observer"
  | "staff";
type RegistrationFieldKey =
  | "display_name"
  | "contact_email"
  | "phone"
  | "mobile_phone"
  | "organization"
  | "job_title"
  | "dietary_needs"
  | "accessibility_needs"
  | "legal_name"
  | "departure_city"
  | "arrival_date"
  | "departure_date"
  | "travel_mode"
  | "date_of_birth"
  | "known_traveler_number"
  | "passport_number"
  | "passport_expiry"
  | "citizenship"
  | "check_in_date"
  | "check_out_date"
  | "room_occupancy"
  | "room_type_preference"
  | "roommate_preference"
  | "hotel_preference"
  | "hotel_loyalty_number"
  | "special_requests"
  | "waiver_ack"
  | "emergency_contact";
type RegistrationLifecycleStage =
  | "draft"
  | "submitted"
  | "approved"
  | "waitlisted"
  | "checked_in"
  | "cancelled";
type OccupancyModuleKey =
  | "meetings"
  | "trade_show"
  | "education"
  | "meals"
  | "offsite"
  | "travel_accommodation";
type OccupancyMode = "no" | "included" | "purchase_required";
type RegistrationFieldState = "required" | "optional";
type RegistrationFieldSection =
  | "identity"
  | "travel"
  | "accommodation"
  | "profile"
  | "compliance"
  | "additional";
type RegistrationFieldInputType =
  | "text"
  | "email"
  | "phone"
  | "number"
  | "date"
  | "datetime"
  | "radio"
  | "select"
  | "multiselect"
  | "textarea"
  | "boolean";
type RegistrationOptionRule = ProductConditionalOverrideRule;
type RegistrationOptionFormItem = {
  id: string;
  type: "field" | "custom" | "break" | "title";
  field_key: RegistrationFieldKey | null;
  label: string;
  state: RegistrationFieldState;
  custom_key?: string;
  custom_input_type?: RegistrationFieldInputType;
  custom_options?: string[];
};
type RegistrationOption = {
  id: string;
  name: string;
  registration_type: RegistrationTypeKey;
  linked_product_ids: string[];
  entitlements: Record<OccupancyModuleKey, OccupancyMode>;
  field_policy: Partial<Record<RegistrationFieldKey, RegistrationFieldState>>;
  form_items: RegistrationOptionFormItem[];
  rules: RegistrationOptionRule[];
  notes: string;
};

const REGISTRATION_FIELD_MODULE_SCOPE: Partial<Record<RegistrationFieldKey, OccupancyModuleKey[]>> = {
  dietary_needs: ["meals", "offsite"],
  departure_city: ["travel_accommodation"],
  arrival_date: ["travel_accommodation"],
  departure_date: ["travel_accommodation"],
  travel_mode: ["travel_accommodation"],
  date_of_birth: ["travel_accommodation"],
  known_traveler_number: ["travel_accommodation"],
  passport_number: ["travel_accommodation"],
  passport_expiry: ["travel_accommodation"],
  citizenship: ["travel_accommodation"],
  check_in_date: ["travel_accommodation"],
  check_out_date: ["travel_accommodation"],
  room_occupancy: ["travel_accommodation"],
  room_type_preference: ["travel_accommodation"],
  roommate_preference: ["travel_accommodation"],
  hotel_preference: ["travel_accommodation"],
  hotel_loyalty_number: ["travel_accommodation"],
  special_requests: ["travel_accommodation"],
  waiver_ack: ["offsite"],
};
type AudienceListRule = {
  id: string;
  name: string;
  enabled: boolean;
  registration_types: RegistrationTypeKey[];
  registration_statuses: RegistrationLifecycleStage[];
  requires_travel_consent: boolean | null;
  requires_checkin: boolean | null;
  occupancy_module: OccupancyModuleKey | null;
  linked_product_ids: string[];
  notes: string;
};
type SponsorDeliverableStatus = "planned" | "assigned" | "in_progress" | "completed" | "blocked";
type SponsorDeliverable = {
  id: string;
  title: string;
  module_context: OccupancyModuleKey | "custom";
  due_date: string;
  owner: string;
  status: SponsorDeliverableStatus;
  notes: string;
};
type SponsorOpsRecord = {
  id: string;
  sponsor_name: string;
  tier: string;
  linked_product_id: string | null;
  linked_org_id: string | null;
  primary_contact_name: string;
  primary_contact_email: string;
  activation_modules: Array<OccupancyModuleKey | "communications">;
  deliverables: SponsorDeliverable[];
  notes: string;
};
type LogisticsTaskStatus = "planned" | "ordered" | "confirmed" | "delivered" | "blocked";
type LogisticsService = {
  key: "av" | "furniture" | "electrical" | "internet" | "labor_rigging" | "cleaning_waste";
  enabled: boolean;
  included_in_booth: boolean;
  billing_mode: "included" | "optional_add_on" | "required_add_on";
  linked_product_id: string | null;
  notes: string;
};
type BoothInclusionPreset = {
  tier: string;
  tables: number;
  chairs: number;
  carpet: boolean;
  lighting: boolean;
  power: boolean;
  internet: boolean;
  linked_product_id: string | null;
  notes: string;
};
type LogisticsTask = {
  id: string;
  title: string;
  category: "move_in" | "move_out" | "shipping" | "services" | "parking" | "custom";
  owner: string;
  due_date: string;
  status: LogisticsTaskStatus;
  blocker_reason: string;
  notes: string;
};
type OffsiteEventDraft = {
  id: string;
  title: string;
  date: string;
  start_time: string;
  end_time: string;
  linked_product_id: string | null;
  google_place_id: string;
  venue_name: string;
  venue_address: string;
  travel_time_minutes: number;
  travel_mode: OffsiteTravelMode;
  departure_time: string;
  return_time: string;
  includes_meal: boolean;
  meal_type: OffsiteMealType;
  meal_custom_label: string;
  audience_registration_types: OffsiteRegistrationType[];
  capacity: number;
  waitlist_enabled: boolean;
  is_sponsored: boolean;
  sponsor_name: string;
  sponsor_tier: string;
  sponsorship_activation_notes: string;
  waiver_required: boolean;
  accessibility_notes: string;
  emergency_contact: string;
  meeting_point: string;
  contingency_plan: string;
};

type ConferenceDayProfile = "full_day" | "half_day" | "travel" | "other";
type ModuleDayType = ConferenceDayProfile | "custom";
type DayTypePromptState = {
  moduleKey: "meetings" | "trade_show" | "meals" | "education";
  date: string;
  nextValue: ModuleDayType;
};

type ManagementMode = "fully_managed" | "partially_managed" | "attendee_managed";
type TravelFieldKey =
  | "legal_name"
  | "departure_city"
  | "arrival_date"
  | "departure_date"
  | "travel_mode_preference"
  | "date_of_birth"
  | "known_traveler_number"
  | "passport_number"
  | "passport_expiry"
  | "citizenship"
  | "emergency_contact"
  | "accessibility_needs";
type AccommodationFieldKey =
  | "check_in_date"
  | "check_out_date"
  | "room_occupancy"
  | "room_type_preference"
  | "roommate_preference"
  | "hotel_preference"
  | "hotel_loyalty_number"
  | "accessibility_needs"
  | "special_requests";
type TravelSupportMode = "none" | "managed" | "reimbursement" | "self_managed";
type TravelModeKey = "air" | "rail" | "personal_vehicle" | "bus" | "other";
type RegistrationOptionTravelPreset =
  | "org_managed_travel_accommodation"
  | "org_managed_accommodation_only"
  | "no_travel_scope";
type ProductTravelRule = {
  travel_support_mode: TravelSupportMode;
  allowed_travel_modes: TravelModeKey[];
  includes_accommodation: boolean;
  requires_travel_intake: boolean;
  requires_accommodation_intake: boolean;
  arrival_window_start: string;
  arrival_window_end: string;
  departure_window_start: string;
  departure_window_end: string;
  conditional_overrides: ProductConditionalOverrideRule[];
  notes: string;
};
type ProductRuleCondition =
  | "org_distance_to_airport_km_lte"
  | "org_type_is"
  | "org_type_registration_count_gt";
type ProductRuleAction =
  | "disable_air_travel_option"
  | "set_travel_support_mode"
  | "set_offsite_auto_discount_percent";
type ManagementScope = "all_managed" | "some_managed" | "none_managed";
type TravelHotelPolicy = {
  id: string;
  name: string;
  google_place_id: string;
  address: string;
  nightly_rate: number;
  currency: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  share_contact_with_attendees: boolean;
  room_block_url: string;
  room_block_code: string;
  notes: string;
};
type TravelAirportPolicy = {
  id: string;
  code: string;
  code_type: AirportCodeType | "";
  name: string;
  city: string;
  country: string;
  ground_transfer_notes: string;
};
type TravelAirlinePolicy = {
  id: string;
  airline_name: string;
  airline_code: string;
  booking_class_policy: string;
  bags_included: number;
  meal_included: boolean;
  change_policy_notes: string;
  notes: string;
};
type TravelPolicyEntry = {
  id: string;
  title: string;
  policy_text: string;
  applies_to_registration_types: RegistrationTypeKey[];
  effective_from: string;
  effective_to: string;
};
type ReimbursementPolicyEntry = {
  id: string;
  title: string;
  covered_items: string;
  caps_and_limits: string;
  receipt_requirements: string;
  submission_sla_days: number;
  payout_timeline: string;
};
type ProductConditionalOverrideRule = {
  id: string;
  name: string;
  condition: ProductRuleCondition;
  condition_number_value: number | null;
  condition_text_value: string;
  action: ProductRuleAction;
  action_text_value: string;
  action_number_value: number | null;
  notes: string;
};

const MANAGEMENT_SCOPE_OPTIONS: Array<{ key: ManagementScope; label: string; description: string }> = [
  {
    key: "all_managed",
    label: "All Managed",
    description: "Every eligible registration path is managed by CSC.",
  },
  {
    key: "some_managed",
    label: "Some Managed",
    description: "Managed support is configurable per registration path in Registration Ops.",
  },
  {
    key: "none_managed",
    label: "No Managed Support",
    description: "Managed support is not offered for this domain.",
  },
];

const TRAVEL_FIELD_DEFS: Array<{ key: TravelFieldKey; label: string }> = [
  { key: "legal_name", label: "Legal name (as on ID)" },
  { key: "departure_city", label: "Departure city/airport" },
  { key: "arrival_date", label: "Arrival date/time" },
  { key: "departure_date", label: "Departure date/time" },
  { key: "travel_mode_preference", label: "Travel mode preference" },
  { key: "date_of_birth", label: "Date of birth" },
  { key: "known_traveler_number", label: "Known traveler/NEXUS number" },
  { key: "passport_number", label: "Passport number (if required)" },
  { key: "passport_expiry", label: "Passport expiry (if required)" },
  { key: "citizenship", label: "Citizenship (if required)" },
  { key: "emergency_contact", label: "Emergency contact" },
  { key: "accessibility_needs", label: "Accessibility needs" },
];

const ACCOMMODATION_FIELD_DEFS: Array<{ key: AccommodationFieldKey; label: string }> = [
  { key: "check_in_date", label: "Request alternate check-in date" },
  { key: "check_out_date", label: "Request alternate check-out date" },
  { key: "room_occupancy", label: "Room occupancy preference (single/double/shared)" },
  { key: "room_type_preference", label: "Room type preference" },
  { key: "roommate_preference", label: "Roommate preference" },
  { key: "hotel_preference", label: "Hotel preference/rank" },
  { key: "hotel_loyalty_number", label: "Hotel loyalty number" },
  { key: "accessibility_needs", label: "Accessibility needs" },
  { key: "special_requests", label: "Special requests" },
];

const TRAVEL_TO_REG_FIELD_MAP: Record<TravelFieldKey, RegistrationFieldKey> = {
  legal_name: "legal_name",
  departure_city: "departure_city",
  arrival_date: "arrival_date",
  departure_date: "departure_date",
  travel_mode_preference: "travel_mode",
  date_of_birth: "date_of_birth",
  known_traveler_number: "known_traveler_number",
  passport_number: "passport_number",
  passport_expiry: "passport_expiry",
  citizenship: "citizenship",
  emergency_contact: "emergency_contact",
  accessibility_needs: "accessibility_needs",
};

const ACCOMMODATION_TO_REG_FIELD_MAP: Record<AccommodationFieldKey, RegistrationFieldKey> = {
  check_in_date: "check_in_date",
  check_out_date: "check_out_date",
  room_occupancy: "room_occupancy",
  room_type_preference: "room_type_preference",
  roommate_preference: "roommate_preference",
  hotel_preference: "hotel_preference",
  hotel_loyalty_number: "hotel_loyalty_number",
  accessibility_needs: "accessibility_needs",
  special_requests: "special_requests",
};

const TRAVEL_FIELD_KEYS = Object.values(TRAVEL_TO_REG_FIELD_MAP);
const ACCOMMODATION_FIELD_KEYS = Object.values(ACCOMMODATION_TO_REG_FIELD_MAP);
const AIR_SENSITIVE_TRAVEL_FIELDS: RegistrationFieldKey[] = [
  "date_of_birth",
  "known_traveler_number",
  "passport_number",
  "passport_expiry",
  "citizenship",
];

function createDefaultProductTravelRule(): ProductTravelRule {
  return {
    travel_support_mode: "managed",
    allowed_travel_modes: ["air", "rail", "personal_vehicle", "bus", "other"],
    includes_accommodation: true,
    requires_travel_intake: true,
    requires_accommodation_intake: true,
    arrival_window_start: "",
    arrival_window_end: "",
    departure_window_start: "",
    departure_window_end: "",
    conditional_overrides: [],
    notes: "",
  };
}

  const normalizeDateTimeWindowValue = (value: unknown): string => {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    return trimmed;
  };


function getRegistrationOptionKey(type: RegistrationTypeKey, productId: string): string {
  return `${type}::${productId}`;
}

function createDefaultConditionalOverrideRule(): ProductConditionalOverrideRule {
  return {
    id: `rule-${Math.random().toString(36).slice(2, 10)}`,
    name: "New Override Rule",
    condition: "org_distance_to_airport_km_lte",
    condition_number_value: 300,
    condition_text_value: "",
    action: "disable_air_travel_option",
    action_text_value: "",
    action_number_value: null,
    notes: "",
  };
}

function normalizeTravelSupportMode(value: unknown): TravelSupportMode {
  if (
    value === "managed" ||
    value === "reimbursement" ||
    value === "self_managed" ||
    value === "none"
  ) {
    return value;
  }
  return "managed";
}

function normalizeManagementScope(value: unknown, fallback: ManagementScope = "some_managed"): ManagementScope {
  if (value === "all_managed" || value === "some_managed" || value === "none_managed") {
    return value;
  }
  return fallback;
}

function normalizeAllowedTravelModes(value: unknown, fallback: TravelModeKey[]): TravelModeKey[] {
  if (!Array.isArray(value)) return fallback;
  return uniqueStrings(
    value.filter(
      (mode): mode is TravelModeKey =>
        mode === "air" ||
        mode === "rail" ||
        mode === "personal_vehicle" ||
        mode === "bus" ||
        mode === "other"
    )
  );
}

function getTravelPresetFromRule(rule: ProductTravelRule): RegistrationOptionTravelPreset {
  if (rule.travel_support_mode === "managed" && rule.includes_accommodation) {
    return "org_managed_travel_accommodation";
  }
  if (rule.travel_support_mode === "none" && rule.includes_accommodation) {
    return "org_managed_accommodation_only";
  }
  return "no_travel_scope";
}

function buildTravelRulePatchFromPreset(
  preset: RegistrationOptionTravelPreset
): Partial<ProductTravelRule> {
  if (preset === "org_managed_travel_accommodation") {
    return {
      travel_support_mode: "managed",
      includes_accommodation: true,
      requires_travel_intake: true,
      requires_accommodation_intake: true,
      allowed_travel_modes: ["air", "rail", "personal_vehicle", "bus", "other"],
    };
  }
  if (preset === "org_managed_accommodation_only") {
    return {
      travel_support_mode: "none",
      includes_accommodation: true,
      requires_travel_intake: false,
      requires_accommodation_intake: true,
      allowed_travel_modes: [],
    };
  }
  return {
    travel_support_mode: "none",
    includes_accommodation: false,
    requires_travel_intake: false,
    requires_accommodation_intake: false,
    allowed_travel_modes: [],
  };
}

function getBlockedRegistrationFieldKeysForTravelRule(
  rule: ProductTravelRule
): Set<RegistrationFieldKey> {
  const blocked = new Set<RegistrationFieldKey>();
  const travelKeys = new Set<RegistrationFieldKey>(TRAVEL_FIELD_KEYS);
  const accommodationKeys = new Set<RegistrationFieldKey>(ACCOMMODATION_FIELD_KEYS);

  if (rule.travel_support_mode === "none" || !rule.requires_travel_intake) {
    for (const key of travelKeys) blocked.add(key);
  }

  if (!rule.includes_accommodation || !rule.requires_accommodation_intake) {
    for (const key of accommodationKeys) blocked.add(key);
  }

  if (!rule.allowed_travel_modes.includes("air")) {
    for (const key of AIR_SENSITIVE_TRAVEL_FIELDS) blocked.add(key);
  }

  return blocked;
}

const OFFSITE_REGISTRATION_TYPES: Array<{ value: OffsiteRegistrationType; label: string }> = [
  { value: "delegate", label: "Delegates" },
  { value: "observer", label: "Observers" },
  { value: "exhibitor", label: "Exhibitors" },
  { value: "staff", label: "Staff" },
];
const REGISTRATION_TYPES: Array<{
  key: RegistrationTypeKey;
  label: string;
  description: string;
}> = [
  { key: "delegate", label: "Delegate", description: "Member-side attendee for meetings and sessions." },
  { key: "exhibitor", label: "Exhibitor", description: "Partner-side attendee tied to booth/trade-show participation." },
  { key: "speaker", label: "Speaker", description: "Education speaker/presenter." },
  { key: "observer", label: "Observer", description: "Guest observer / non-participating attendee." },
  { key: "staff", label: "Staff", description: "CSC staff/ops crew and support roles." },
];
const OCCUPANCY_MODULES: Array<{ key: OccupancyModuleKey; label: string }> = [
  { key: "meetings", label: "Meetings" },
  { key: "trade_show", label: "Trade Show" },
  { key: "education", label: "Education" },
  { key: "meals", label: "Meals" },
  { key: "offsite", label: "Offsite" },
  { key: "travel_accommodation", label: "Travel + Accommodation" },
];
const DEFAULT_REGISTRATION_STATUSES: RegistrationLifecycleStage[] = ["submitted", "approved"];
const SPONSOR_DELIVERABLE_STATUSES: Array<{ key: SponsorDeliverableStatus; label: string }> = [
  { key: "planned", label: "Planned" },
  { key: "assigned", label: "Assigned" },
  { key: "in_progress", label: "In Progress" },
  { key: "completed", label: "Completed" },
  { key: "blocked", label: "Blocked" },
];
const LOGISTICS_TASK_STATUSES: Array<{ key: LogisticsTaskStatus; label: string }> = [
  { key: "planned", label: "Planned" },
  { key: "ordered", label: "Ordered" },
  { key: "confirmed", label: "Confirmed" },
  { key: "delivered", label: "Delivered" },
  { key: "blocked", label: "Blocked" },
];
const DEFAULT_LOGISTICS_SERVICES: LogisticsService[] = [
  {
    key: "av",
    enabled: false,
    included_in_booth: false,
    billing_mode: "optional_add_on",
    linked_product_id: null,
    notes: "",
  },
  {
    key: "furniture",
    enabled: false,
    included_in_booth: false,
    billing_mode: "optional_add_on",
    linked_product_id: null,
    notes: "",
  },
  {
    key: "electrical",
    enabled: false,
    included_in_booth: false,
    billing_mode: "optional_add_on",
    linked_product_id: null,
    notes: "",
  },
  {
    key: "internet",
    enabled: false,
    included_in_booth: false,
    billing_mode: "optional_add_on",
    linked_product_id: null,
    notes: "",
  },
  {
    key: "labor_rigging",
    enabled: false,
    included_in_booth: false,
    billing_mode: "optional_add_on",
    linked_product_id: null,
    notes: "",
  },
  {
    key: "cleaning_waste",
    enabled: false,
    included_in_booth: false,
    billing_mode: "optional_add_on",
    linked_product_id: null,
    notes: "",
  },
];
const LOGISTICS_SERVICE_LABELS: Record<LogisticsService["key"], string> = {
  av: "AV",
  furniture: "Furniture Rentals",
  electrical: "Electrical",
  internet: "Internet",
  labor_rigging: "Labor / Rigging",
  cleaning_waste: "Cleaning / Waste",
};
const REGISTRATION_SECTION_ORDER: RegistrationFieldSection[] = [
  "identity",
  "travel",
  "accommodation",
  "profile",
  "compliance",
  "additional",
];
const REGISTRATION_SECTION_LABELS: Record<RegistrationFieldSection, string> = {
  identity: "Identity",
  travel: "Travel",
  accommodation: "Accommodation",
  profile: "Profile",
  compliance: "Compliance",
  additional: "Additional",
};
const REGISTRATION_FIELDS: Array<{
  key: RegistrationFieldKey;
  label: string;
  section: RegistrationFieldSection;
  order: number;
  input_type: RegistrationFieldInputType;
  validation: "none" | "email" | "phone" | "date" | "datetime";
  prefill_source: "person" | "organization" | "none";
  description?: string;
  options?: string[];
}> = [
  { key: "display_name", label: "Preferred name", section: "identity", order: 10, input_type: "text", validation: "none", prefill_source: "person", description: "How this attendee wants to be addressed onsite." },
  { key: "legal_name", label: "Legal name", section: "identity", order: 20, input_type: "text", validation: "none", prefill_source: "person", description: "Legal/government name for travel and billing records." },
  { key: "contact_email", label: "Contact email", section: "identity", order: 30, input_type: "email", validation: "email", prefill_source: "person", description: "Primary conference communications email." },
  { key: "phone", label: "Phone number", section: "identity", order: 40, input_type: "phone", validation: "phone", prefill_source: "person" },
  { key: "mobile_phone", label: "Mobile phone", section: "identity", order: 45, input_type: "phone", validation: "phone", prefill_source: "person" },
  { key: "organization", label: "Organization", section: "identity", order: 50, input_type: "text", validation: "none", prefill_source: "organization" },
  { key: "job_title", label: "Job title", section: "identity", order: 60, input_type: "text", validation: "none", prefill_source: "person" },
  { key: "departure_city", label: "Departure city/airport", section: "travel", order: 10, input_type: "text", validation: "none", prefill_source: "none" },
  { key: "arrival_date", label: "Arrival date/time", section: "travel", order: 20, input_type: "datetime", validation: "datetime", prefill_source: "none" },
  { key: "departure_date", label: "Departure date/time", section: "travel", order: 30, input_type: "datetime", validation: "datetime", prefill_source: "none" },
  { key: "travel_mode", label: "Travel mode", section: "travel", order: 40, input_type: "select", validation: "none", prefill_source: "none", options: ["Air", "Rail", "Bus/Coach", "Personal Vehicle", "Other"] },
  { key: "date_of_birth", label: "Date of birth", section: "travel", order: 50, input_type: "date", validation: "date", prefill_source: "person" },
  { key: "known_traveler_number", label: "Known traveler number", section: "travel", order: 60, input_type: "text", validation: "none", prefill_source: "none" },
  { key: "passport_number", label: "Passport number", section: "travel", order: 70, input_type: "text", validation: "none", prefill_source: "none" },
  { key: "passport_expiry", label: "Passport expiry", section: "travel", order: 80, input_type: "date", validation: "date", prefill_source: "none" },
  { key: "citizenship", label: "Citizenship", section: "travel", order: 90, input_type: "text", validation: "none", prefill_source: "none" },
  { key: "check_in_date", label: "Request alternate check-in date", section: "accommodation", order: 10, input_type: "date", validation: "date", prefill_source: "none" },
  { key: "check_out_date", label: "Request alternate check-out date", section: "accommodation", order: 20, input_type: "date", validation: "date", prefill_source: "none" },
  { key: "room_occupancy", label: "Room occupancy preference", section: "accommodation", order: 30, input_type: "select", validation: "none", prefill_source: "none", options: ["Single", "Double", "Shared"] },
  { key: "room_type_preference", label: "Room type preference", section: "accommodation", order: 40, input_type: "select", validation: "none", prefill_source: "none", options: ["Standard", "Accessible", "King", "Two Queen", "Other"] },
  { key: "roommate_preference", label: "Roommate preference", section: "accommodation", order: 50, input_type: "text", validation: "none", prefill_source: "none" },
  { key: "hotel_preference", label: "Hotel preference", section: "accommodation", order: 60, input_type: "select", validation: "none", prefill_source: "none", options: ["Primary Block", "Secondary Block", "No Preference"] },
  { key: "hotel_loyalty_number", label: "Hotel loyalty number", section: "accommodation", order: 70, input_type: "text", validation: "none", prefill_source: "none" },
  { key: "special_requests", label: "Special requests", section: "accommodation", order: 80, input_type: "textarea", validation: "none", prefill_source: "none" },
  { key: "dietary_needs", label: "Dietary needs", section: "profile", order: 10, input_type: "textarea", validation: "none", prefill_source: "none" },
  { key: "accessibility_needs", label: "Accessibility needs", section: "profile", order: 20, input_type: "textarea", validation: "none", prefill_source: "none" },
  { key: "waiver_ack", label: "Waiver acknowledgment", section: "compliance", order: 10, input_type: "boolean", validation: "none", prefill_source: "none" },
  { key: "emergency_contact", label: "Emergency contact", section: "compliance", order: 20, input_type: "text", validation: "none", prefill_source: "none" },
];
const REGISTRATION_FIELD_STATES: Array<{ key: RegistrationFieldState; label: string }> = [
  { key: "required", label: "Required" },
  { key: "optional", label: "Optional" },
];

const REGISTRATION_INPUT_TYPES: Array<{ key: RegistrationFieldInputType; label: string }> = [
  { key: "text", label: "Text" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "number", label: "Number" },
  { key: "date", label: "Date" },
  { key: "datetime", label: "Date / Time" },
  { key: "select", label: "Dropdown" },
  { key: "multiselect", label: "Multi-select" },
  { key: "radio", label: "Radio" },
  { key: "textarea", label: "Textarea" },
  { key: "boolean", label: "Checkbox" },
];
const REGISTRATION_LIFECYCLE_STAGES: Array<{ key: RegistrationLifecycleStage; label: string }> = [
  { key: "draft", label: "Draft" },
  { key: "submitted", label: "Submitted" },
  { key: "approved", label: "Approved" },
  { key: "waitlisted", label: "Waitlisted" },
  { key: "checked_in", label: "Checked In" },
  { key: "cancelled", label: "Cancelled" },
];
const DEFAULT_REGISTRATION_TYPES: RegistrationTypeKey[] = [
  "delegate",
  "exhibitor",
  "observer",
  "speaker",
  "staff",
];
const DEFAULT_OCCUPANCY_BY_TYPE: Record<RegistrationTypeKey, Record<OccupancyModuleKey, OccupancyMode>> = {
  delegate: {
    meetings: "included",
    trade_show: "included",
    education: "included",
    meals: "included",
    offsite: "purchase_required",
    travel_accommodation: "purchase_required",
  },
  exhibitor: {
    meetings: "included",
    trade_show: "included",
    education: "purchase_required",
    meals: "purchase_required",
    offsite: "purchase_required",
    travel_accommodation: "purchase_required",
  },
  observer: {
    meetings: "no",
    trade_show: "included",
    education: "purchase_required",
    meals: "purchase_required",
    offsite: "purchase_required",
    travel_accommodation: "purchase_required",
  },
  speaker: {
    meetings: "no",
    trade_show: "included",
    education: "included",
    meals: "included",
    offsite: "purchase_required",
    travel_accommodation: "purchase_required",
  },
  staff: {
    meetings: "included",
    trade_show: "included",
    education: "included",
    meals: "included",
    offsite: "included",
    travel_accommodation: "included",
  },
};

function toModuleMap(rows: ConferenceScheduleModuleRow[]): Record<ConferenceScheduleModuleKey, ConferenceScheduleModuleRow> {
  const map = {} as Record<ConferenceScheduleModuleKey, ConferenceScheduleModuleRow>;
  for (const row of rows) map[row.module_key] = row;
  return map;
}

function uniqueStrings<T extends string>(values: T[]): T[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function sortRegistrationFields(
  fields: Array<{
    key: RegistrationFieldKey;
    label: string;
    section: RegistrationFieldSection;
    order: number;
  }>
) {
  return [...fields].sort((a, b) => {
    const aSection = REGISTRATION_SECTION_ORDER.indexOf(a.section);
    const bSection = REGISTRATION_SECTION_ORDER.indexOf(b.section);
    if (aSection !== bSection) return aSection - bSection;
    return a.order - b.order;
  });
}

function buildRegistrationFormTemplate(
  availableFields: Array<{
    key: RegistrationFieldKey;
    label: string;
    section: RegistrationFieldSection;
  }>,
  fieldPolicy: Partial<Record<RegistrationFieldKey, RegistrationFieldState>>,
  idPrefix: string
): RegistrationOptionFormItem[] {
  const bySection = availableFields.reduce<Record<RegistrationFieldSection, typeof availableFields>>(
    (acc, field) => {
      acc[field.section] = [...(acc[field.section] ?? []), field];
      return acc;
    },
    {} as Record<RegistrationFieldSection, typeof availableFields>
  );
  const template: RegistrationOptionFormItem[] = [];
  for (const section of REGISTRATION_SECTION_ORDER) {
    const sectionFields = bySection[section];
    if (!sectionFields || sectionFields.length === 0) continue;
    template.push({
      id: `${idPrefix}-title-${section}`,
      type: "title",
      field_key: null,
      label: REGISTRATION_SECTION_LABELS[section],
      state: "optional",
    });
    for (const field of sectionFields) {
      template.push({
        id: `${idPrefix}-field-${field.key}`,
        type: "field",
        field_key: field.key,
        label: field.label,
        state: fieldPolicy[field.key] ?? "optional",
      });
    }
  }
  return template;
}

function getModeRequiredTravelFields(mode: ManagementMode): TravelFieldKey[] {
  if (mode === "fully_managed") {
    return [
      "legal_name",
      "departure_city",
      "arrival_date",
      "departure_date",
      "travel_mode_preference",
      "date_of_birth",
      "emergency_contact",
      "accessibility_needs",
    ];
  }
  if (mode === "partially_managed") {
    return [
      "legal_name",
      "arrival_date",
      "departure_date",
      "travel_mode_preference",
      "emergency_contact",
      "accessibility_needs",
    ];
  }
  return ["arrival_date", "departure_date", "accessibility_needs"];
}

function getModeRequiredAccommodationFields(mode: ManagementMode): AccommodationFieldKey[] {
  if (mode === "fully_managed") {
    return [
      "check_in_date",
      "check_out_date",
      "room_occupancy",
      "room_type_preference",
      "accessibility_needs",
    ];
  }
  if (mode === "partially_managed") {
    return ["check_in_date", "check_out_date", "room_type_preference", "accessibility_needs"];
  }
  return ["check_in_date", "check_out_date"];
}

export default function ScheduleDesignWizard({
  conferenceId,
  params,
  initialModules,
  conferenceStartDate,
  conferenceEndDate,
  conferenceRegistrationOpenAt = null,
  conferenceRegistrationCloseAt = null,
  googleMapsApiKey = null,
  initialProducts = [],
}: ScheduleDesignWizardProps) {
  const offsiteEventCounterRef = useRef(1);
  const audienceListCounterRef = useRef(1);
  const sponsorRecordCounterRef = useRef(1);
  const sponsorDeliverableCounterRef = useRef(1);
  const logisticsTaskCounterRef = useRef(1);
  const registrationOptionCounterRef = useRef(1);
  const registrationOptionFormItemCounterRef = useRef(1);
  const registrationCustomFieldCounterRef = useRef(1);
  const travelHotelCounterRef = useRef(1);
  const travelAirportCounterRef = useRef(1);
  const travelAirlineCounterRef = useRef(1);
  const travelPolicyCounterRef = useRef(1);
  const reimbursementPolicyCounterRef = useRef(1);
  const hotelPlaceInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const hotelAutocompleteRefs = useRef<
    Record<
      string,
      {
        remove?: () => void;
      }
    >
  >({});
  const offsiteVenueInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const offsiteAutocompleteRefs = useRef<
    Record<
      string,
      {
        remove?: () => void;
      }
    >
  >({});
  const [modules, setModules] = useState<Record<ConferenceScheduleModuleKey, ConferenceScheduleModuleRow>>(
    () => {
      const map = toModuleMap(initialModules);
      for (const moduleDef of MODULES) {
        if (!map[moduleDef.key]) {
          map[moduleDef.key] = {
            id: `virtual-${moduleDef.key}`,
            conference_id: conferenceId,
            module_key: moduleDef.key,
            enabled: moduleDef.alwaysIncluded === true,
            config_json: {},
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
        }
      }
      return map;
    }
  );
  const [step, setStep] = useState(1);
  const [moduleStepIndex, setModuleStepIndex] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [placesReady, setPlacesReady] = useState(false);
  const [placesRuntimeError, setPlacesRuntimeError] = useState<string | null>(null);
  const [airportLookupQueryById, setAirportLookupQueryById] = useState<Record<string, string>>({});
  const [airportLookupLoadingById, setAirportLookupLoadingById] = useState<Record<string, boolean>>({});
  const [airportLookupErrorById, setAirportLookupErrorById] = useState<Record<string, string>>({});
  const savedTravelSectionSignaturesRef = useRef<TravelSectionSignatures | null>(null);
  const [meetingProductResult, setMeetingProductResult] = useState<string | null>(null);
  const [tradeShowProductResult, setTradeShowProductResult] = useState<string | null>(null);
  const [educationProductResult, setEducationProductResult] = useState<string | null>(null);
  const [mealProductResult, setMealProductResult] = useState<string | null>(null);
  const [offsiteProductResult, setOffsiteProductResult] = useState<string | null>(null);
  const [isReconcilingSetup, setIsReconcilingSetup] = useState(false);
  const [isReconcilingPeople, setIsReconcilingPeople] = useState(false);
  const [isRegeneratingProgram, setIsRegeneratingProgram] = useState(false);
  const [dayTypePrompt, setDayTypePrompt] = useState<DayTypePromptState | null>(null);
  const [travelSourceDraftByType, setTravelSourceDraftByType] = useState<Record<string, string>>(
    {}
  );
  const [draggedFormItem, setDraggedFormItem] = useState<{
    optionId: string;
    itemId: string;
  } | null>(null);
  const placesError =
    !googleMapsApiKey
      ? "Google Places is disabled. Add GOOGLE_MAPS_API_KEY (or NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) to env.local."
      : placesRuntimeError;

  const maxStep = 3;
  const selectedModuleDefs = MODULES.filter(
    (moduleDef) => moduleDef.alwaysIncluded || modules[moduleDef.key].enabled
  );
  const enabledOccupancyModules = useMemo<OccupancyModuleKey[]>(
    () =>
      OCCUPANCY_MODULES.filter((moduleDef) => {
        const moduleEntry = modules[moduleDef.key];
        return Boolean(moduleEntry?.enabled);
      }).map((moduleDef) => moduleDef.key),
    [modules]
  );
  const availableRegistrationFields = useMemo(
    () =>
      sortRegistrationFields(
        REGISTRATION_FIELDS.filter((field) => {
          const scope = REGISTRATION_FIELD_MODULE_SCOPE[field.key];
          if (!scope || scope.length === 0) return true;
          return scope.some((moduleKey) => enabledOccupancyModules.includes(moduleKey));
        })
    ),
    [enabledOccupancyModules]
  );
  const availableRegistrationFieldSet = useMemo(
    () => new Set(availableRegistrationFields.map((field) => field.key)),
    [availableRegistrationFields]
  );
  const currentModuleDef = selectedModuleDefs[moduleStepIndex] ?? null;
  const conferenceDates = getConferenceDates(conferenceStartDate, conferenceEndDate);
  const registrationOpsConfig = useMemo(
    () => ((modules.registration_ops?.config_json ?? {}) as Record<string, unknown>),
    [modules.registration_ops?.config_json]
  );
  const registrationTypeSet = useMemo(
    () => new Set(REGISTRATION_TYPES.map((type) => type.key)),
    []
  );
  const legacySelectedRegistrationTypes = Array.isArray(registrationOpsConfig.registration_types)
    ? uniqueStrings(
        (registrationOpsConfig.registration_types as string[]).filter((value): value is RegistrationTypeKey =>
          registrationTypeSet.has(value as RegistrationTypeKey)
        )
      )
    : DEFAULT_REGISTRATION_TYPES;
  const productLinkageByType = useMemo(
    () => ((registrationOpsConfig.product_linkage_by_type ?? {}) as Record<string, unknown>),
    [registrationOpsConfig.product_linkage_by_type]
  );
  const requiredFieldsByType = useMemo(
    () => ((registrationOpsConfig.required_fields_by_type ?? {}) as Record<string, unknown>),
    [registrationOpsConfig.required_fields_by_type]
  );
  const registrationOptions = useMemo<RegistrationOption[]>(() => {
    const raw = registrationOpsConfig.registration_options;
    const normalizedFromConfig = Array.isArray(raw)
      ? (raw as Array<Partial<RegistrationOption>>).map((entry, idx) => {
          const registrationType = registrationTypeSet.has(entry.registration_type as RegistrationTypeKey)
            ? (entry.registration_type as RegistrationTypeKey)
            : "delegate";
          const linkedProductIds = Array.isArray(entry.linked_product_ids)
            ? uniqueStrings(
                entry.linked_product_ids.filter(
                  (productId): productId is string => typeof productId === "string" && productId.trim().length > 0
                )
              )
            : [];
          const entitlements = OCCUPANCY_MODULES.reduce<Record<OccupancyModuleKey, OccupancyMode>>(
            (acc, moduleDef) => {
              const rawMode = entry.entitlements?.[moduleDef.key];
              acc[moduleDef.key] =
                rawMode === "no" || rawMode === "included" || rawMode === "purchase_required"
                  ? rawMode
                  : DEFAULT_OCCUPANCY_BY_TYPE[registrationType][moduleDef.key];
              return acc;
            },
            {} as Record<OccupancyModuleKey, OccupancyMode>
          );
          const fieldPolicy: Partial<Record<RegistrationFieldKey, RegistrationFieldState>> = {};
          for (const field of REGISTRATION_FIELDS) {
            const value = entry.field_policy?.[field.key];
            if (value === "required" || value === "optional") {
              fieldPolicy[field.key] = value;
            }
          }
          const formItems = Array.isArray(entry.form_items)
            ? (entry.form_items as Array<Partial<RegistrationOptionFormItem>>).map((item, itemIdx) => ({
                id:
                  typeof item.id === "string" && item.id.trim()
                    ? item.id
                    : `registration-form-item-${idx + 1}-${itemIdx + 1}`,
                type:
                  item.type === "field" ||
                  item.type === "custom" ||
                  item.type === "break" ||
                  item.type === "title"
                    ? item.type
                    : "title",
                field_key:
                  item.field_key && availableRegistrationFieldSet.has(item.field_key as RegistrationFieldKey)
                    ? (item.field_key as RegistrationFieldKey)
                    : null,
                label:
                  typeof item.label === "string" && item.label.trim().length > 0
                    ? item.label
                    : "Legacy custom prompt (unsupported)",
                state:
                  item.state === "required" || item.state === "optional"
                    ? item.state
                    : "optional",
                custom_key:
                  typeof item.custom_key === "string" && item.custom_key.trim().length > 0
                    ? item.custom_key.trim()
                    : undefined,
                custom_input_type:
                  item.custom_input_type === "text" ||
                  item.custom_input_type === "email" ||
                  item.custom_input_type === "phone" ||
                  item.custom_input_type === "number" ||
                  item.custom_input_type === "date" ||
                  item.custom_input_type === "datetime" ||
                  item.custom_input_type === "radio" ||
                  item.custom_input_type === "select" ||
                  item.custom_input_type === "multiselect" ||
                  item.custom_input_type === "textarea" ||
                  item.custom_input_type === "boolean"
                    ? item.custom_input_type
                    : undefined,
                custom_options: Array.isArray(item.custom_options)
                  ? item.custom_options.filter(
                      (value): value is string =>
                        typeof value === "string" && value.trim().length > 0
                    )
                  : undefined,
              }))
            : buildRegistrationFormTemplate(
                availableRegistrationFields,
                fieldPolicy,
                `registration-form-item-${idx + 1}`
              );
          const rules = Array.isArray(entry.rules)
            ? (entry.rules as RegistrationOptionRule[]).map((rule) => ({
                ...createDefaultConditionalOverrideRule(),
                ...rule,
                id: typeof rule.id === "string" && rule.id.trim() ? rule.id : `rule-${idx + 1}`,
              }))
            : [];
          return {
            id:
              typeof entry.id === "string" && entry.id.trim()
                ? entry.id
                : `registration-option-${idx + 1}`,
            name:
              typeof entry.name === "string" && entry.name.trim()
                ? entry.name
                : `${REGISTRATION_TYPES.find((type) => type.key === registrationType)?.label ?? registrationType} Option ${idx + 1}`,
            registration_type: registrationType,
            linked_product_ids: linkedProductIds,
            entitlements,
            field_policy: fieldPolicy,
            form_items: formItems,
            rules,
            notes: typeof entry.notes === "string" ? entry.notes : "",
          };
        })
      : [];
    if (normalizedFromConfig.length > 0) {
      const seen = new Map<string, number>();
      return normalizedFromConfig.map((option, idx) => {
        const baseId =
          typeof option.id === "string" && option.id.trim().length > 0
            ? option.id.trim()
            : `registration-option-${idx + 1}`;
        const count = seen.get(baseId) ?? 0;
        seen.set(baseId, count + 1);
        if (count === 0) return option;
        return {
          ...option,
          id: `${baseId}-${count + 1}`,
        };
      });
    }

    const migratedOptions: RegistrationOption[] = [];
    for (const type of legacySelectedRegistrationTypes) {
      const rawProducts = productLinkageByType[type];
      const linkedProductIds = Array.isArray(rawProducts)
        ? uniqueStrings(rawProducts.filter((value): value is string => typeof value === "string"))
        : [];
      const requiredFieldSet = new Set(
        Array.isArray(requiredFieldsByType[type])
          ? uniqueStrings((requiredFieldsByType[type] as string[]) as RegistrationFieldKey[])
          : []
      );
      const fieldPolicy = REGISTRATION_FIELDS.reduce<
        Partial<Record<RegistrationFieldKey, RegistrationFieldState>>
      >((acc, field) => {
        acc[field.key] = requiredFieldSet.has(field.key) ? "required" : "optional";
        return acc;
      }, {});
      const baseName = REGISTRATION_TYPES.find((entry) => entry.key === type)?.label ?? type;
      if (linkedProductIds.length === 0) {
        migratedOptions.push({
          id: `registration-option-${type}-base`,
          name: `${baseName} Registration`,
          registration_type: type,
          linked_product_ids: [],
          entitlements: { ...DEFAULT_OCCUPANCY_BY_TYPE[type] },
          field_policy: fieldPolicy,
          form_items: buildRegistrationFormTemplate(
            availableRegistrationFields,
            fieldPolicy,
            `registration-form-item-${type}-base`
          ),
          rules: [],
          notes: "",
        });
      } else {
        for (const productId of linkedProductIds) {
          const product = initialProducts.find((entry) => entry.id === productId);
          migratedOptions.push({
            id: `registration-option-${type}-${productId}`,
            name: `${baseName}: ${product?.name ?? productId}`,
            registration_type: type,
            linked_product_ids: [productId],
            entitlements: { ...DEFAULT_OCCUPANCY_BY_TYPE[type] },
            field_policy: fieldPolicy,
            form_items: buildRegistrationFormTemplate(
              availableRegistrationFields,
              fieldPolicy,
              `registration-form-item-${type}-${productId}`
            ),
            rules: [],
            notes: "",
          });
        }
      }
    }
    return migratedOptions;
  }, [
    initialProducts,
    legacySelectedRegistrationTypes,
    productLinkageByType,
    registrationOpsConfig.registration_options,
    registrationTypeSet,
    availableRegistrationFields,
    availableRegistrationFieldSet,
    requiredFieldsByType,
  ]);
  const selectedRegistrationTypes =
    registrationOptions.length > 0
      ? uniqueStrings(registrationOptions.map((option) => option.registration_type))
      : legacySelectedRegistrationTypes;
  const communicationsConfig = (modules.communications?.config_json ?? {}) as Record<string, unknown>;
  const audienceLists = Array.isArray(communicationsConfig.audience_lists)
    ? (communicationsConfig.audience_lists as AudienceListRule[])
    : [];
  const sponsorshipOpsConfig = (modules.sponsorship_ops?.config_json ?? {}) as Record<string, unknown>;
  const sponsorRecords = Array.isArray(sponsorshipOpsConfig.sponsor_records)
    ? (sponsorshipOpsConfig.sponsor_records as SponsorOpsRecord[])
    : [];
  const logisticsConfig = (modules.logistics?.config_json ?? {}) as Record<string, unknown>;
  const logisticsServices = useMemo(() => {
    const raw = Array.isArray(logisticsConfig.services)
      ? (logisticsConfig.services as Array<Partial<LogisticsService>>)
      : [];
    const byKey = new Map(
      raw
        .filter((service): service is Partial<LogisticsService> => Boolean(service?.key))
        .map((service) => [service.key as LogisticsService["key"], service] as const)
    );
    return DEFAULT_LOGISTICS_SERVICES.map((defaultService) => {
      const current = byKey.get(defaultService.key) ?? {};
      return {
        ...defaultService,
        enabled: Boolean(current.enabled ?? defaultService.enabled),
        included_in_booth: Boolean(current.included_in_booth ?? defaultService.included_in_booth),
        billing_mode:
          current.billing_mode === "included" ||
          current.billing_mode === "optional_add_on" ||
          current.billing_mode === "required_add_on"
            ? current.billing_mode
            : defaultService.billing_mode,
        linked_product_id:
          typeof current.linked_product_id === "string" && current.linked_product_id.trim()
            ? current.linked_product_id
            : null,
        notes: typeof current.notes === "string" ? current.notes : "",
      };
    });
  }, [logisticsConfig.services]);
  const boothInclusionPresets = useMemo(
    () =>
      Array.isArray(logisticsConfig.booth_inclusion_presets)
        ? (logisticsConfig.booth_inclusion_presets as Array<Partial<BoothInclusionPreset>>).map((preset) => ({
            tier: typeof preset.tier === "string" ? preset.tier : "Standard",
            tables: Math.max(0, Number(preset.tables ?? 0)),
            chairs: Math.max(0, Number(preset.chairs ?? 0)),
            carpet: Boolean(preset.carpet),
            lighting: Boolean(preset.lighting),
            power: Boolean(preset.power),
            internet: Boolean(preset.internet),
            linked_product_id:
              typeof preset.linked_product_id === "string" && preset.linked_product_id.trim()
                ? preset.linked_product_id
                : null,
            notes: typeof preset.notes === "string" ? preset.notes : "",
          }))
        : [],
    [logisticsConfig.booth_inclusion_presets]
  );
  const logisticsTasks = Array.isArray(logisticsConfig.tasks)
    ? (logisticsConfig.tasks as LogisticsTask[])
    : [];
  const moveInStartValue = String(logisticsConfig.move_in_start ?? "");
  const moveInEndValue = String(logisticsConfig.move_in_end ?? "");
  const moveOutStartValue = String(logisticsConfig.move_out_start ?? "");
  const moveOutEndValue = String(logisticsConfig.move_out_end ?? "");
  const hasMoveInWindowData = Boolean(moveInStartValue || moveInEndValue);
  const hasMoveOutWindowData = Boolean(moveOutStartValue || moveOutEndValue);
  const productNameById = useMemo(
    () => new Map(initialProducts.map((product) => [product.id, product.name] as const)),
    [initialProducts]
  );
  const getProductLabel = (productId: string | null): string => {
    if (!productId) return "Not linked";
    return productNameById.get(productId) ?? "Unknown product";
  };
  const logisticsRunSheet = (() => {
    const windows: Array<{ label: string; start: string; end: string }> = [];
    if (hasMoveInWindowData) {
      windows.push({
        label: "Move In",
        start: moveInStartValue,
        end: moveInEndValue,
      });
    }
    if (hasMoveOutWindowData) {
      windows.push({
        label: "Move Out",
        start: moveOutStartValue,
        end: moveOutEndValue,
      });
    }

    const services = logisticsServices.filter((service) => service.enabled);
    const boothTiers = boothInclusionPresets.filter((preset) => preset.tier.trim().length > 0);
    const tasks = logisticsTasks.filter(
      (task) =>
        task.title.trim().length > 0 ||
        task.owner.trim().length > 0 ||
        task.notes.trim().length > 0
    );
    return { windows, services, boothTiers, tasks };
  })();
  const conferenceDayProfiles =
    ((registrationOpsConfig.conference_day_profiles ?? {}) as Record<string, ConferenceDayProfile>) ?? {};
  const getDayProfile = (date: string): ConferenceDayProfile =>
    conferenceDayProfiles[date] ?? "full_day";

  const meetingConfig = useMemo(
    () => ((modules.meetings?.config_json ?? {}) as Record<string, unknown>),
    [modules.meetings?.config_json]
  );
  const meetingDays = useMemo(
    () => (Array.isArray(meetingConfig.meeting_days) ? (meetingConfig.meeting_days as string[]) : []),
    [meetingConfig.meeting_days]
  );
  const rawMeetingDaySettings = ((meetingConfig.meeting_day_settings ?? {}) as Record<string, unknown>);
  const meetingAccessProductId =
    typeof meetingConfig.access_product_id === "string" && meetingConfig.access_product_id.trim()
      ? meetingConfig.access_product_id
      : "";
  const meetingDaySettings = meetingDays.reduce<Record<string, MeetingDaySetting>>((acc, date) => {
    const raw = rawMeetingDaySettings[date];
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      acc[date] = raw as MeetingDaySetting;
      return acc;
    }
    acc[date] = {};
    return acc;
  }, {});
  const schedulingPriorities = normalizePriorityList(
    (meetingConfig.scheduling_priorities as string[] | undefined) ?? []
  );
  const tradeShowConfig = useMemo(
    () => ((modules.trade_show?.config_json ?? {}) as Record<string, unknown>),
    [modules.trade_show?.config_json]
  );
  const tradeShowDays = useMemo(
    () =>
      Array.isArray(tradeShowConfig.trade_show_days)
        ? (tradeShowConfig.trade_show_days as string[])
        : [],
    [tradeShowConfig.trade_show_days]
  );
  const rawTradeShowDaySettings = ((tradeShowConfig.trade_show_day_settings ?? {}) as Record<
    string,
    unknown
  >);
  const tradeShowAccessProductId =
    typeof tradeShowConfig.access_product_id === "string" && tradeShowConfig.access_product_id.trim()
      ? tradeShowConfig.access_product_id
      : "";
  const tradeShowDaySettings = tradeShowDays.reduce<Record<string, TradeShowDaySetting>>(
    (acc, date) => {
      const raw = rawTradeShowDaySettings[date];
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        acc[date] = raw as TradeShowDaySetting;
        return acc;
      }
      acc[date] = {};
      return acc;
    },
    {}
  );
  const educationConfig = useMemo(
    () => ((modules.education?.config_json ?? {}) as Record<string, unknown>),
    [modules.education?.config_json]
  );
  const educationDays = useMemo(
    () => (Array.isArray(educationConfig.education_days) ? (educationConfig.education_days as string[]) : []),
    [educationConfig.education_days]
  );
  const educationAllowTbdDetails = Boolean(educationConfig.allow_tbd_details);
  const rawEducationDaySettings = ((educationConfig.education_day_settings ?? {}) as Record<
    string,
    unknown
  >);
  const educationAccessProductId =
    typeof educationConfig.access_product_id === "string" && educationConfig.access_product_id.trim()
      ? educationConfig.access_product_id
      : "";
  const educationDaySettings = educationDays.reduce<Record<string, EducationDaySetting>>(
    (acc, date) => {
      const raw = rawEducationDaySettings[date];
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        acc[date] = raw as EducationDaySetting;
        return acc;
      }
      acc[date] = {};
      return acc;
    },
    {}
  );
  const mealsConfig = useMemo(
    () => ((modules.meals?.config_json ?? {}) as Record<string, unknown>),
    [modules.meals?.config_json]
  );
  const mealDays = useMemo(
    () => (Array.isArray(mealsConfig.meal_days) ? (mealsConfig.meal_days as string[]) : []),
    [mealsConfig.meal_days]
  );
  const rawMealDaySettings = ((mealsConfig.meal_day_settings ?? {}) as Record<string, unknown>);
  const mealsAccessProductId =
    typeof mealsConfig.access_product_id === "string" && mealsConfig.access_product_id.trim()
      ? mealsConfig.access_product_id
      : "";
  const mealDaySettings = mealDays.reduce<Record<string, MealDaySetting>>((acc, date) => {
    const raw = rawMealDaySettings[date];
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      acc[date] = raw as MealDaySetting;
      return acc;
    }
    acc[date] = {};
    return acc;
  }, {});
  const offsiteConfig = useMemo(
    () => ((modules.offsite?.config_json ?? {}) as Record<string, unknown>),
    [modules.offsite?.config_json]
  );
  const offsiteEvents = useMemo(
    () =>
      Array.isArray(offsiteConfig.offsite_events)
        ? (offsiteConfig.offsite_events as OffsiteEventDraft[])
        : [],
    [offsiteConfig.offsite_events]
  );
  const offsiteAllowTbdVenue = Boolean(offsiteConfig.allow_tbd_venue);
  const requiresPurchaseForModule = useCallback(
    (moduleKey: OccupancyModuleKey) =>
      registrationOptions.some((option) => option.entitlements[moduleKey] === "purchase_required"),
    [registrationOptions]
  );
  const moduleAccessMappingTargets = useMemo(
    () =>
      [
        {
          key: "meetings" as const,
          label: "Meetings",
          productId: meetingAccessProductId,
        },
        {
          key: "trade_show" as const,
          label: "Trade Show",
          productId: tradeShowAccessProductId,
        },
        {
          key: "education" as const,
          label: "Education",
          productId: educationAccessProductId,
        },
        {
          key: "meals" as const,
          label: "Meals",
          productId: mealsAccessProductId,
        },
      ].filter(
        (moduleDef) => modules[moduleDef.key].enabled && requiresPurchaseForModule(moduleDef.key)
      ),
    [
      educationAccessProductId,
      mealsAccessProductId,
      meetingAccessProductId,
      modules,
      requiresPurchaseForModule,
      tradeShowAccessProductId,
    ]
  );
  const travelAccommodationConfig = useMemo(
    () => ((modules.travel_accommodation?.config_json ?? {}) as Record<string, unknown>),
    [modules.travel_accommodation?.config_json]
  );
  const travelManagementMode =
    travelAccommodationConfig.travel_management_mode === "fully_managed" ||
    travelAccommodationConfig.travel_management_mode === "partially_managed" ||
    travelAccommodationConfig.travel_management_mode === "attendee_managed"
      ? (travelAccommodationConfig.travel_management_mode as ManagementMode)
      : "partially_managed";
  const accommodationManagementMode =
    travelAccommodationConfig.accommodation_management_mode === "fully_managed" ||
    travelAccommodationConfig.accommodation_management_mode === "partially_managed" ||
    travelAccommodationConfig.accommodation_management_mode === "attendee_managed"
      ? (travelAccommodationConfig.accommodation_management_mode as ManagementMode)
      : "partially_managed";
  const travelManagementScope = normalizeManagementScope(
    travelAccommodationConfig.travel_management_scope,
    travelManagementMode === "fully_managed"
      ? "all_managed"
      : travelManagementMode === "attendee_managed"
        ? "none_managed"
        : "some_managed"
  );
  const accommodationManagementScope = normalizeManagementScope(
    travelAccommodationConfig.accommodation_management_scope,
    accommodationManagementMode === "fully_managed"
      ? "all_managed"
      : accommodationManagementMode === "attendee_managed"
        ? "none_managed"
        : "some_managed"
  );
  const requiredTravelFieldOverrides = (
    travelAccommodationConfig.required_travel_fields_by_key ?? {}
  ) as Record<string, boolean>;
  const travelDisableAirWithinKmRaw = Number(
    travelAccommodationConfig.travel_disable_air_within_km ?? NaN
  );
  const travelDisableAirWithinKm = Number.isFinite(travelDisableAirWithinKmRaw)
    ? Math.max(0, travelDisableAirWithinKmRaw)
    : "";
  const travelNearbySupportMode = normalizeTravelSupportMode(
    travelAccommodationConfig.travel_nearby_support_mode
  );
  const requiredAccommodationFieldOverrides = (
    travelAccommodationConfig.required_accommodation_fields_by_key ?? {}
  ) as Record<string, boolean>;
  const registrationOptionTravelRules = useMemo(
    () =>
      ((travelAccommodationConfig.registration_option_travel_rules ??
        travelAccommodationConfig.registration_product_travel_rules ??
        {}) as Record<string, Partial<ProductTravelRule>>),
    [
      travelAccommodationConfig.registration_option_travel_rules,
      travelAccommodationConfig.registration_product_travel_rules,
    ]
  );
  const hasLegacyTravelRuleKeys = useMemo(() => {
    const keys = Object.keys(registrationOptionTravelRules ?? {});
    if (keys.some((key) => key.includes("::"))) return true;
    return registrationOptions.some(
      (option) =>
        Object.prototype.hasOwnProperty.call(registrationOptionTravelRules, option.id) &&
        option.linked_product_ids.length > 0
    );
  }, [registrationOptionTravelRules, registrationOptions]);
  const travelHotels = Array.isArray(travelAccommodationConfig.hotels)
    ? (travelAccommodationConfig.hotels as Array<Partial<TravelHotelPolicy>>).map((entry, index) => ({
        id: typeof entry.id === "string" && entry.id.trim() ? entry.id : `hotel-${index + 1}`,
        name: typeof entry.name === "string" ? entry.name : "",
        google_place_id: typeof entry.google_place_id === "string" ? entry.google_place_id : "",
        address: typeof entry.address === "string" ? entry.address : "",
        nightly_rate: Math.max(0, Number(entry.nightly_rate ?? 0)),
        currency:
          typeof entry.currency === "string" && entry.currency.trim()
            ? entry.currency.toUpperCase().slice(0, 3)
            : "CAD",
        contact_name: typeof entry.contact_name === "string" ? entry.contact_name : "",
        contact_email: typeof entry.contact_email === "string" ? entry.contact_email : "",
        contact_phone: typeof entry.contact_phone === "string" ? entry.contact_phone : "",
        share_contact_with_attendees: Boolean(entry.share_contact_with_attendees),
        room_block_url: typeof entry.room_block_url === "string" ? entry.room_block_url : "",
        room_block_code: typeof entry.room_block_code === "string" ? entry.room_block_code : "",
        notes: typeof entry.notes === "string" ? entry.notes : "",
      }))
    : [];
  const destinationAirports = Array.isArray(travelAccommodationConfig.destination_airports)
    ? (travelAccommodationConfig.destination_airports as Array<Partial<TravelAirportPolicy>>).map(
        (entry, index) => ({
          id: typeof entry.id === "string" && entry.id.trim() ? entry.id : `airport-${index + 1}`,
          code: typeof entry.code === "string" ? entry.code.toUpperCase() : "",
          code_type:
            entry.code_type === "airport" || entry.code_type === "metro" ? entry.code_type : "",
          name: typeof entry.name === "string" ? entry.name : "",
          city: typeof entry.city === "string" ? entry.city : "",
          country: typeof entry.country === "string" ? entry.country : "CA",
          ground_transfer_notes:
            typeof entry.ground_transfer_notes === "string" ? entry.ground_transfer_notes : "",
        })
      )
    : [];
  const airlinePolicies = Array.isArray(travelAccommodationConfig.airline_policies)
    ? (travelAccommodationConfig.airline_policies as Array<Partial<TravelAirlinePolicy>>).map(
        (entry, index) => ({
          id: typeof entry.id === "string" && entry.id.trim() ? entry.id : `airline-${index + 1}`,
          airline_name: typeof entry.airline_name === "string" ? entry.airline_name : "",
          airline_code: typeof entry.airline_code === "string" ? entry.airline_code.toUpperCase() : "",
          booking_class_policy:
            typeof entry.booking_class_policy === "string" ? entry.booking_class_policy : "",
          bags_included: Math.max(0, Number(entry.bags_included ?? 0)),
          meal_included: Boolean(entry.meal_included),
          change_policy_notes:
            typeof entry.change_policy_notes === "string" ? entry.change_policy_notes : "",
          notes: typeof entry.notes === "string" ? entry.notes : "",
        })
      )
    : [];
  const travelPolicies = Array.isArray(travelAccommodationConfig.travel_policies)
    ? (travelAccommodationConfig.travel_policies as Array<Partial<TravelPolicyEntry>>).map(
        (entry, index) => ({
          id:
            typeof entry.id === "string" && entry.id.trim()
              ? entry.id
              : `travel-policy-${index + 1}`,
          title: typeof entry.title === "string" ? entry.title : "",
          policy_text: typeof entry.policy_text === "string" ? entry.policy_text : "",
          applies_to_registration_types: Array.isArray(entry.applies_to_registration_types)
            ? uniqueStrings(
                entry.applies_to_registration_types.filter(
                  (value): value is RegistrationTypeKey =>
                    typeof value === "string" &&
                    REGISTRATION_TYPES.some((type) => type.key === value)
                )
              )
            : [],
          effective_from: typeof entry.effective_from === "string" ? entry.effective_from : "",
          effective_to: typeof entry.effective_to === "string" ? entry.effective_to : "",
        })
      )
    : [];
  const reimbursementPolicies = Array.isArray(travelAccommodationConfig.reimbursement_policies)
    ? (travelAccommodationConfig.reimbursement_policies as Array<Partial<ReimbursementPolicyEntry>>).map(
        (entry, index) => ({
          id:
            typeof entry.id === "string" && entry.id.trim()
              ? entry.id
              : `reimbursement-policy-${index + 1}`,
          title: typeof entry.title === "string" ? entry.title : "",
          covered_items: typeof entry.covered_items === "string" ? entry.covered_items : "",
          caps_and_limits: typeof entry.caps_and_limits === "string" ? entry.caps_and_limits : "",
          receipt_requirements:
            typeof entry.receipt_requirements === "string" ? entry.receipt_requirements : "",
          submission_sla_days: Math.max(0, Number(entry.submission_sla_days ?? 14)),
          payout_timeline: typeof entry.payout_timeline === "string" ? entry.payout_timeline : "",
        })
      )
    : [];
  const currentTravelSectionSignatures = useMemo(
    () => buildTravelSectionSignatures(travelAccommodationConfig),
    [travelAccommodationConfig]
  );
  useEffect(() => {
    if (!savedTravelSectionSignaturesRef.current) {
      savedTravelSectionSignaturesRef.current = currentTravelSectionSignatures;
    }
  }, [currentTravelSectionSignatures]);
  const travelSectionDirty = useMemo(() => {
    const saved = savedTravelSectionSignaturesRef.current ?? currentTravelSectionSignatures;
    return {
      hotels: currentTravelSectionSignatures.hotels !== saved.hotels,
      destination_airports:
        currentTravelSectionSignatures.destination_airports !== saved.destination_airports,
      airline_policies:
        currentTravelSectionSignatures.airline_policies !== saved.airline_policies,
      travel_policies:
        currentTravelSectionSignatures.travel_policies !== saved.travel_policies,
      reimbursement_policies:
        currentTravelSectionSignatures.reimbursement_policies !== saved.reimbursement_policies,
      travel_rules: currentTravelSectionSignatures.travel_rules !== saved.travel_rules,
    };
  }, [currentTravelSectionSignatures]);
  const preflightIssues = useMemo<PreflightIssue[]>(() => {
    const issues: PreflightIssue[] = [];
    const add = (
      severity: PreflightSeverity,
      id: string,
      title: string,
      detail: string,
      moduleKey?: ConferenceScheduleModuleKey,
      actionLabel?: string,
      actionHref?: string
    ) => {
      issues.push({ severity, id, title, detail, moduleKey, actionLabel, actionHref });
    };

    const start = conferenceStartDate ? new Date(`${conferenceStartDate}T00:00:00`) : null;
    const end = conferenceEndDate ? new Date(`${conferenceEndDate}T23:59:59`) : null;
    if (!conferenceStartDate || !conferenceEndDate) {
      add(
        "blocking",
        "core-dates-missing",
        "Conference dates are missing",
        "Set conference start and end dates in Details before publishing."
      );
    } else if (start && end && end < start) {
      add(
        "blocking",
        "core-dates-invalid-range",
        "Conference date range is invalid",
        "Conference end date must be after start date."
      );
    }

    const parseUTC = (s: string) => { const u = s.endsWith("Z") || s.includes("+") ? s : s.replace(" ", "T") + "Z"; return new Date(u); };
    const regOpen = conferenceRegistrationOpenAt ? parseUTC(conferenceRegistrationOpenAt) : null;
    const regClose = conferenceRegistrationCloseAt ? parseUTC(conferenceRegistrationCloseAt) : null;
    if (!conferenceRegistrationOpenAt || !conferenceRegistrationCloseAt) {
      add(
        "blocking",
        "registration-window-missing",
        "Registration window is missing",
        "Set registration open and close datetimes in Details."
      );
    } else if (regOpen && regClose && regClose <= regOpen) {
      add(
        "blocking",
        "registration-window-invalid",
        "Registration window is invalid",
        "Registration close must be after registration open."
      );
    } else if (regClose && start && regClose > start) {
      add(
        "warning",
        "registration-close-after-start",
        "Registration closes after conference start",
        "Confirm this is intentional; attendees may register after sessions begin."
      );
    }

    if (modules.meetings.enabled) {
      if (meetingDays.length === 0) {
        add("blocking", "meetings-days-missing", "Meetings days are not configured", "Select at least one meetings day.", "meetings");
      }
      const suites = Number(meetingConfig.meeting_suites ?? params?.total_meeting_suites ?? 0);
      if (!Number.isFinite(suites) || suites <= 0) {
        add("blocking", "meetings-suites-missing", "Meeting suites are not configured", "Set meeting suites greater than zero.", "meetings");
      }
      const totalSlotsFromDaySettings = Object.values(meetingDaySettings).reduce((sum, setting) => {
        const n = Number(setting?.meeting_count ?? 0);
        return sum + (Number.isFinite(n) && n > 0 ? n : 0);
      }, 0);
      const meetingsPerDayByDate =
        meetingConfig.meetings_per_day_by_date &&
        typeof meetingConfig.meetings_per_day_by_date === "object" &&
        !Array.isArray(meetingConfig.meetings_per_day_by_date)
          ? (meetingConfig.meetings_per_day_by_date as Record<string, unknown>)
          : {};
      const totalSlotsFromLegacyPerDate = Object.values(meetingsPerDayByDate).reduce((sum: number, raw) => {
        const n = Number(raw ?? 0);
        return sum + (Number.isFinite(n) && n > 0 ? n : 0);
      }, 0);
      const fallbackSlotsPerDay = Number(
        meetingConfig.meeting_slots_per_day ?? params?.meeting_slots_per_day ?? 0
      );
      const totalSlotsFromFallback =
        Number.isFinite(fallbackSlotsPerDay) && fallbackSlotsPerDay > 0
          ? fallbackSlotsPerDay * Math.max(meetingDays.length, 0)
          : 0;
      const totalSlots = Math.max(
        totalSlotsFromDaySettings,
        totalSlotsFromLegacyPerDate,
        totalSlotsFromFallback
      );
      if (totalSlots <= 0) {
        add("blocking", "meetings-slots-missing", "No meeting slots configured", "Set at least one meeting slot on at least one meetings day.", "meetings");
      }
    }

    if (modules.trade_show.enabled) {
      if (tradeShowDays.length === 0) {
        add("blocking", "trade-show-days-missing", "Trade show days are not configured", "Select at least one trade show day.", "trade_show");
      }
      const booths = Number(tradeShowConfig.booth_count_total ?? 0);
      if (!Number.isFinite(booths) || booths <= 0) {
        add("blocking", "trade-show-booths-missing", "Trade show booth inventory is missing", "Set total booth count greater than zero.", "trade_show");
      }
    }

    if (modules.education.enabled) {
      if (educationDays.length === 0) {
        add("blocking", "education-days-missing", "Education days are not configured", "Select at least one education day.", "education");
      }
      const sessions = Number(educationConfig.session_count_target ?? 0);
      if (!Number.isFinite(sessions) || sessions <= 0) {
        add(
          educationAllowTbdDetails ? "warning" : "blocking",
          "education-sessions-missing",
          "Education session target is missing",
          educationAllowTbdDetails
            ? "Education is in TBD mode. Add session targets later before final publish."
            : "Set session count target greater than zero.",
          "education"
        );
      }
    }

    if (modules.meals.enabled) {
      if (mealDays.length === 0) {
        add("blocking", "meals-days-missing", "Meal days are not configured", "Select at least one meals day.", "meals");
      }
      const hasMealService = mealDays.some((date) => {
        const raw = mealDaySettings[date];
        if (!raw || typeof raw !== "object") return false;
        const row = raw as Record<string, unknown>;
        return (
          Boolean(row.breakfast) ||
          Boolean(row.lunch) ||
          Boolean(row.dinner) ||
          Boolean(row.custom_enabled) ||
          (Array.isArray(row.snack_breaks) && row.snack_breaks.length > 0)
        );
      });
      if (!hasMealService) {
        add("blocking", "meals-services-missing", "No meal services configured", "Enable at least one meal/snack service.", "meals");
      }
    }

    if (modules.offsite.enabled) {
      if (offsiteEvents.length === 0) {
        add("warning", "offsite-empty", "Offsite module enabled with no events", "Either add at least one offsite event or disable this module.", "offsite");
      } else {
        const invalidOffsiteTiming = offsiteEvents.find(
          (event) => !event.date || !event.start_time || !event.end_time
        );
        if (invalidOffsiteTiming) {
          add("blocking", "offsite-missing-time", "Offsite events are missing dates/times", "Each offsite event needs date, start time, and end time.", "offsite");
        }
        const invalidOffsiteVenue = offsiteEvents.find(
          (event) => !event.venue_name && !event.venue_address
        );
        if (invalidOffsiteVenue) {
          add(
            offsiteAllowTbdVenue ? "warning" : "blocking",
            "offsite-missing-venue",
            "Offsite venue details are missing",
            offsiteAllowTbdVenue
              ? "Offsite is in TBD venue mode. Fill venue details later."
              : "Each offsite event needs venue name or address.",
            "offsite"
          );
        }
        const missingProductLinks = offsiteEvents.filter(
          (event) => !(typeof event.linked_product_id === "string" && event.linked_product_id.trim())
        );
        if (missingProductLinks.length > 0) {
          add(
            "blocking",
            "offsite-product-links-missing",
            "Offsite events are missing linked products",
            `${missingProductLinks.length} offsite event(s) need a linked product.`,
            "offsite"
          );
        }
        const linkedProductIds = offsiteEvents
          .map((event) => (typeof event.linked_product_id === "string" ? event.linked_product_id : ""))
          .filter((value) => value.trim().length > 0);
        if (linkedProductIds.length > 0) {
          const validProducts = new Map(initialProducts.map((product) => [product.id, product]));
          const invalidLink = linkedProductIds.find((id) => !validProducts.has(id));
          if (invalidLink) {
            add(
              "blocking",
              "offsite-product-link-invalid",
              "Offsite event product link is invalid",
              "One or more offsite events link to a missing product.",
              "offsite"
            );
          }
          const inactiveLink = linkedProductIds.find((id) => {
            const product = validProducts.get(id);
            return product ? !product.is_active : false;
          });
          if (inactiveLink) {
            add(
              "blocking",
              "offsite-product-link-inactive",
              "Offsite event product link is inactive",
              "Activate linked offsite products before publish.",
              "offsite"
            );
          }
        }
      }
    }

    if (registrationOptions.length === 0) {
      add("blocking", "registration-options-missing", "No registration options configured", "Create at least one registration option in Registration Operations.", "registration_ops");
    } else {
      const unlinked = registrationOptions.filter((option) => option.linked_product_ids.length === 0);
      if (unlinked.length > 0) {
        add(
          "blocking",
          "registration-options-unlinked-products",
          "Registration options are missing product links",
          `${unlinked.length} option(s) are not linked to a conference product.`,
          "registration_ops"
        );
      }

      const productById = new Map(initialProducts.map((product) => [product.id, product]));
      const referencedProductIds = new Set<string>();

      for (const option of registrationOptions) {
        const linkedProducts = option.linked_product_ids
          .map((id) => productById.get(id))
          .filter((product): product is (typeof initialProducts)[number] => Boolean(product));
        for (const id of option.linked_product_ids) referencedProductIds.add(id);

        if (linkedProducts.length === 0) {
          add(
            "blocking",
            `registration-option-no-valid-products-${option.id}`,
            `${option.name || "Registration option"} has no valid product links`,
            "Link this option to at least one existing conference product.",
            "registration_ops"
          );
          continue;
        }

        const activeLinkedProducts = linkedProducts.filter((product) => product.is_active);
        if (activeLinkedProducts.length === 0) {
          add(
            "blocking",
            `registration-option-inactive-products-${option.id}`,
            `${option.name || "Registration option"} only links inactive products`,
            "Activate at least one linked product for this registration path.",
            "registration_ops"
          );
        }

        const hasPurchaseRequiredEntitlement = OCCUPANCY_MODULES.some(
          (moduleDef) => option.entitlements[moduleDef.key] === "purchase_required"
        );
        if (hasPurchaseRequiredEntitlement && activeLinkedProducts.length === 0) {
          add(
            "blocking",
            `registration-option-purchase-path-inactive-${option.id}`,
            `${option.name || "Registration option"} requires purchase but has no active purchase path`,
            "Ensure at least one active linked product is available for purchase.",
            "registration_ops"
          );
        }

        const hasIncludedEntitlement = OCCUPANCY_MODULES.some(
          (moduleDef) => option.entitlements[moduleDef.key] === "included"
        );
        if (hasIncludedEntitlement && option.linked_product_ids.length === 0) {
          add(
            "warning",
            `registration-option-included-no-package-${option.id}`,
            `${option.name || "Registration option"} has included items but no package product`,
            "Confirm whether this path should be attached to a registration package product.",
            "registration_ops"
          );
        }
      }

      const orphanActiveProducts = initialProducts.filter(
        (product) => product.is_active && !referencedProductIds.has(product.id)
      );
      if (orphanActiveProducts.length > 0) {
        const named = orphanActiveProducts.map((product) => `${product.name} (${product.slug})`);
        const preview = named.slice(0, 5).join(", ");
        const suffix = named.length > 5 ? `, +${named.length - 5} more` : "";
        add(
          "warning",
          "products-orphan-active",
          "Active products are not referenced by any registration path",
          `${orphanActiveProducts.length} active product(s) appear orphaned: ${preview}${suffix}. Link them to registration options or mark them intentionally standalone.`,
          undefined,
          "Open Products",
          `/admin/conference/${conferenceId}?tab=products`
        );
      }
    }

    const productById = new Map(initialProducts.map((product) => [product.id, product]));
    const suggestedProductSlugs: Array<{
      moduleKey: ConferenceScheduleModuleKey;
      slug: string;
      label: string;
      configuredProductId?: string | null;
    }> = [];
    if (modules.meetings.enabled) {
      suggestedProductSlugs.push(
        {
          moduleKey: "meetings",
          slug: "delegate_meetings_access",
          label: "Delegate Meetings Access",
          configuredProductId: meetingAccessProductId || null,
        },
        {
          moduleKey: "meetings",
          slug: "exhibitor_meetings_access",
          label: "Exhibitor Meetings Access",
          configuredProductId: meetingAccessProductId || null,
        }
      );
    }
    if (modules.trade_show.enabled) {
      suggestedProductSlugs.push({
        moduleKey: "trade_show",
        slug: "trade_show_booth_access",
        label: "Trade Show Booth Access",
        configuredProductId: tradeShowAccessProductId || null,
      });
    }
    if (modules.education.enabled) {
      suggestedProductSlugs.push({
        moduleKey: "education",
        slug: "education_sessions_access",
        label: "Education Sessions Access",
        configuredProductId: educationAccessProductId || null,
      });
    }
    if (modules.meals.enabled) {
      suggestedProductSlugs.push({
        moduleKey: "meals",
        slug: "conference_meal_plan",
        label: "Conference Meal Plan",
        configuredProductId: mealsAccessProductId || null,
      });
    }
    // Offsite product coverage is validated at event level (linked_product_id on each event).
    for (const suggestion of suggestedProductSlugs) {
      const moduleNeedsPurchase = requiresPurchaseForModule(
        suggestion.moduleKey === "meetings"
          ? "meetings"
          : suggestion.moduleKey === "trade_show"
            ? "trade_show"
            : suggestion.moduleKey === "education"
              ? "education"
              : suggestion.moduleKey === "meals"
                ? "meals"
                : "offsite"
      );
      if (!moduleNeedsPurchase) {
        continue;
      }
      if (suggestion.configuredProductId) {
        const configured = productById.get(suggestion.configuredProductId);
        if (!configured) {
          add(
            "blocking",
            `configured-product-missing-${suggestion.moduleKey}`,
            `${suggestion.label} configured product is missing`,
            "Choose a valid active product for this module purchase path.",
            suggestion.moduleKey
          );
          continue;
        }
        if (!configured.is_active) {
          add(
            "blocking",
            `configured-product-inactive-${suggestion.moduleKey}`,
            `${suggestion.label} configured product is inactive`,
            "Activate the selected module access product.",
            suggestion.moduleKey
          );
        }
        continue;
      }
      const product = initialProducts.find((entry) => entry.slug === suggestion.slug);
      if (!product) {
        add(
          "blocking",
          `product-missing-${suggestion.slug}`,
          `${suggestion.label} product is missing`,
          "Create suggested products from module setup or map an existing product as module access.",
          suggestion.moduleKey
        );
      } else if (!product.is_active) {
        add(
          "blocking",
          `product-inactive-${suggestion.slug}`,
          `${suggestion.label} product is inactive`,
          "Activate this product before publish/go-live.",
          suggestion.moduleKey
        );
      }
    }

    if (modules.travel_accommodation.enabled) {
      if (travelManagementScope !== "none_managed" && destinationAirports.length === 0) {
        add(
          "blocking",
          "travel-airports-missing",
          "No destination airports configured",
          "Add at least one destination airport for managed travel.",
          "travel_accommodation"
        );
      }
      if (accommodationManagementScope !== "none_managed" && travelHotels.length === 0) {
        add(
          "warning",
          "travel-hotels-missing",
          "No accommodation hotels configured",
          "Add at least one hotel block or mark accommodations as unmanaged.",
          "travel_accommodation"
        );
      }
      if (
        travelSectionDirty.hotels ||
        travelSectionDirty.destination_airports ||
        travelSectionDirty.airline_policies ||
        travelSectionDirty.travel_policies ||
        travelSectionDirty.reimbursement_policies ||
        travelSectionDirty.travel_rules
      ) {
        add(
          "blocking",
          "travel-unsaved-edits",
          "Travel + Accommodation has unsaved edits",
          "Save the edited travel policy blocks before publish.",
          "travel_accommodation"
        );
      }
    }

    const now = new Date();
    if (regOpen && regOpen > now) {
      add(
        "info",
        "go-live-scheduled",
        "Registration go-live is scheduled",
        `Registration opens at ${regOpen.toLocaleString()}.`
      );
    } else if (regOpen) {
      add(
        "info",
        "go-live-open",
        "Registration window has started",
        `Registration opened at ${regOpen.toLocaleString()}.`
      );
    }

    return issues;
  }, [
    conferenceId,
    conferenceStartDate,
    conferenceEndDate,
    conferenceRegistrationOpenAt,
    conferenceRegistrationCloseAt,
    modules,
    meetingDays,
    meetingConfig,
    meetingAccessProductId,
    params?.meeting_slots_per_day,
    params?.total_meeting_suites,
    meetingDaySettings,
    tradeShowDays,
    tradeShowConfig,
    tradeShowAccessProductId,
    educationDays,
    educationConfig,
    educationAccessProductId,
    educationAllowTbdDetails,
    mealDays,
    mealDaySettings,
    mealsAccessProductId,
    offsiteEvents,
    offsiteAllowTbdVenue,
    registrationOptions,
    initialProducts,
    requiresPurchaseForModule,
    travelManagementScope,
    accommodationManagementScope,
    destinationAirports.length,
    travelHotels.length,
    travelSectionDirty,
  ]);
  const blockingPreflightIssues = preflightIssues.filter((issue) => issue.severity === "blocking");
  const warningPreflightIssues = preflightIssues.filter((issue) => issue.severity === "warning");
  const infoPreflightIssues = preflightIssues.filter((issue) => issue.severity === "info");
  const canPublishFromPreflight = blockingPreflightIssues.length === 0;
  const defaultRequiredTravelFields = getModeRequiredTravelFields(travelManagementMode);
  const defaultRequiredAccommodationFields =
    getModeRequiredAccommodationFields(accommodationManagementMode);

  const setConferenceDayProfile = (date: string, profile: ConferenceDayProfile) => {
    updateModuleConfig("registration_ops", {
      conference_day_profiles: {
        ...conferenceDayProfiles,
        [date]: profile,
      },
    });
  };

  const getEffectiveDayType = (date: string, overrideValue: unknown): ModuleDayType => {
    if (typeof overrideValue === "string" && overrideValue) {
      return overrideValue as ModuleDayType;
    }
    return getDayProfile(date);
  };

  const updateModuleDayTypeOverride = (
    moduleKey: "meetings" | "trade_show" | "meals" | "education",
    date: string,
    dayType: ModuleDayType | null
  ) => {
    const apply = <T extends { day_type?: unknown }>(map: Record<string, T>) => {
      const next = { ...map };
      const existing = (next[date] ?? {}) as T;
      if (dayType === null || dayType === getDayProfile(date)) {
        const rest = { ...(existing as Record<string, unknown>) };
        delete rest.day_type;
        next[date] = rest as T;
      } else {
        next[date] = { ...existing, day_type: dayType };
      }
      return next;
    };

    if (moduleKey === "meetings") {
      updateModuleConfig("meetings", {
        meeting_day_settings: apply(meetingDaySettings),
      });
      return;
    }
    if (moduleKey === "trade_show") {
      updateModuleConfig("trade_show", {
        trade_show_day_settings: apply(tradeShowDaySettings),
      });
      return;
    }
    if (moduleKey === "meals") {
      updateModuleConfig("meals", {
        meal_day_settings: apply(mealDaySettings),
      });
      return;
    }
    updateModuleConfig("education", {
      education_day_settings: apply(educationDaySettings),
    });
  };

  const saveModules = async (
    successMessage = "Schedule module selections saved.",
    options?: {
      skipLogisticsValidation?: boolean;
      skipTravelValidation?: boolean;
    }
  ) => {
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(null);

    const validateLogisticsBeforeSave = (): string | null => {
      const cfg = (modules.logistics?.config_json ?? {}) as Record<string, unknown>;
      const parseDateValue = (value: unknown): number | null => {
        if (typeof value !== "string" || !value.trim()) return null;
        const time = parseLocalDateTime(value)?.valueOf() ?? Number.NaN;
        return Number.isFinite(time) ? time : null;
      };

      const moveInStart = parseDateValue(cfg.move_in_start);
      const moveInEnd = parseDateValue(cfg.move_in_end);
      const moveOutStart = parseDateValue(cfg.move_out_start);
      const moveOutEnd = parseDateValue(cfg.move_out_end);
      const hasMoveIn = moveInStart !== null || moveInEnd !== null;
      const hasMoveOut = moveOutStart !== null || moveOutEnd !== null;
      if (hasMoveIn && (moveInStart === null || moveInEnd === null)) {
        return "Logistics validation: move-in requires both open and close times.";
      }
      if (hasMoveOut && (moveOutStart === null || moveOutEnd === null)) {
        return "Logistics validation: move-out requires both open and close times.";
      }
      if (hasMoveIn && moveInStart !== null && moveInEnd !== null && moveInStart >= moveInEnd) {
        return "Logistics validation: move-in start must be before move-in end.";
      }
      if (hasMoveOut && moveOutStart !== null && moveOutEnd !== null && moveOutStart >= moveOutEnd) {
        return "Logistics validation: move-out start must be before move-out end.";
      }

      const parkingCapacity = Number(cfg.parking_capacity ?? 0);
      if (Number.isFinite(parkingCapacity) && parkingCapacity < 0) {
        return "Logistics validation: parking capacity cannot be negative.";
      }

      const tasks = Array.isArray(cfg.tasks) ? (cfg.tasks as Array<Record<string, unknown>>) : [];
      const blockedMissingReason = tasks.find(
        (task) =>
          task.status === "blocked" &&
          !(typeof task.blocker_reason === "string" && task.blocker_reason.trim().length > 0)
      );
      if (blockedMissingReason) {
        return "Logistics validation: blocked tasks require a blocker reason.";
      }

      return null;
    };

    if (!options?.skipLogisticsValidation) {
      const logisticsValidationError = validateLogisticsBeforeSave();
      if (logisticsValidationError) {
        setIsSaving(false);
        setSaveError(logisticsValidationError);
        return false;
      }
    }

    const validateTravelBeforeSave = (): string | null => {
      if (!modules.travel_accommodation.enabled) return null;
      const config = (modules.travel_accommodation?.config_json ?? {}) as Record<string, unknown>;
      const rawRules =
        config.registration_option_travel_rules ?? config.registration_product_travel_rules ?? {};
      if (!rawRules || typeof rawRules !== "object" || Array.isArray(rawRules)) return null;

      const ruleEntries = Object.entries(rawRules as Record<string, unknown>);
      const parseWindowValue = (value: unknown): Date | null => {
        if (typeof value !== "string" || !value.trim()) return null;
        return parseLocalDateTime(value.trim());
      };
      const resolveRuleLabel = (ruleKey: string): string => {
        const option = registrationOptions.find((entry) => entry.id === ruleKey);
        if (option) return option.name || ruleKey;
        if (ruleKey.includes("::")) {
          const [type, productId] = ruleKey.split("::");
          const product = initialProducts.find((entry) => entry.id === productId);
          const typeLabel =
            REGISTRATION_TYPES.find((entry) => entry.key === type)?.label ?? type;
          return product ? `${typeLabel}: ${product.name}` : `${typeLabel}: ${productId}`;
        }
        const product = initialProducts.find((entry) => entry.id === ruleKey);
        return product?.name ?? ruleKey;
      };

      for (const [ruleKey, rawRule] of ruleEntries) {
        const rule =
          rawRule && typeof rawRule === "object" && !Array.isArray(rawRule)
            ? (rawRule as Record<string, unknown>)
            : {};
        const normalizedRule: ProductTravelRule = {
          ...createDefaultProductTravelRule(),
          travel_support_mode: normalizeTravelSupportMode(rule.travel_support_mode),
          includes_accommodation: Boolean(rule.includes_accommodation ?? true),
          requires_travel_intake: Boolean(rule.requires_travel_intake ?? true),
          requires_accommodation_intake: Boolean(rule.requires_accommodation_intake ?? true),
          allowed_travel_modes: normalizeAllowedTravelModes(
            rule.allowed_travel_modes,
            createDefaultProductTravelRule().allowed_travel_modes
          ),
          arrival_window_start: normalizeDateTimeWindowValue(rule.arrival_window_start),
          arrival_window_end: normalizeDateTimeWindowValue(rule.arrival_window_end),
          departure_window_start: normalizeDateTimeWindowValue(rule.departure_window_start),
          departure_window_end: normalizeDateTimeWindowValue(rule.departure_window_end),
        };
        const preset = getTravelPresetFromRule(normalizedRule);
        const label = resolveRuleLabel(ruleKey);

        const checkWindowPair = (
          prefix: "arrival" | "departure",
          required: boolean
        ): string | null => {
          const startRaw =
            prefix === "arrival"
              ? normalizedRule.arrival_window_start
              : normalizedRule.departure_window_start;
          const endRaw =
            prefix === "arrival"
              ? normalizedRule.arrival_window_end
              : normalizedRule.departure_window_end;
          const start = parseWindowValue(startRaw);
          const end = parseWindowValue(endRaw);
          const labelPrefix = prefix === "arrival" ? "Arrival" : "Departure";
          if (required && (!startRaw || !endRaw)) {
            return `${label}: ${labelPrefix} date range is required for this travel mode.`;
          }
          if ((!startRaw && endRaw) || (startRaw && !endRaw)) {
            return `${label}: ${labelPrefix} date range must include both earliest and latest values.`;
          }
          if ((startRaw && !start) || (endRaw && !end)) {
            return `${label}: ${labelPrefix} date range contains an invalid date/time.`;
          }
          if (start && end && start.valueOf() > end.valueOf()) {
            return `${label}: ${labelPrefix} earliest date must be before latest date.`;
          }
          return null;
        };

        if (preset === "no_travel_scope") {
          if (
            normalizedRule.arrival_window_start ||
            normalizedRule.arrival_window_end ||
            normalizedRule.departure_window_start ||
            normalizedRule.departure_window_end
          ) {
            return `${label}: no-travel mode cannot include arrival/departure date windows.`;
          }
          continue;
        }

        const requireTravelWindows = preset === "org_managed_travel_accommodation";
        const arrivalValidation = checkWindowPair("arrival", requireTravelWindows);
        if (arrivalValidation) return arrivalValidation;
        const departureValidation = checkWindowPair("departure", requireTravelWindows);
        if (departureValidation) return departureValidation;
      }

      return null;
    };

    if (!options?.skipTravelValidation) {
      const travelValidationError = validateTravelBeforeSave();
      if (travelValidationError) {
        setIsSaving(false);
        setSaveError(travelValidationError);
        return false;
      }
    }

    const normalizeWithDayProfiles = (
      key: ConferenceScheduleModuleKey,
      config: Record<string, unknown>
    ): Record<string, unknown> => {
      const next = { ...config };
      const normalizeDayType = (settingsKey: string) => {
        const raw = next[settingsKey];
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
        const settings = raw as Record<string, unknown>;
        const normalized: Record<string, unknown> = {};
        for (const [date, value] of Object.entries(settings)) {
          if (!value || typeof value !== "object" || Array.isArray(value)) {
            normalized[date] = value;
            continue;
          }
          const asObj = value as Record<string, unknown>;
          const override = typeof asObj.day_type === "string" ? asObj.day_type : null;
          if (!override || override === getDayProfile(date)) {
            const rest = { ...asObj };
            delete rest.day_type;
            normalized[date] = rest;
            continue;
          }
          normalized[date] = {
            ...asObj,
            day_type: override,
          };
        }
        next[settingsKey] = normalized;
      };

      if (key === "meetings") normalizeDayType("meeting_day_settings");
      if (key === "trade_show") normalizeDayType("trade_show_day_settings");
      if (key === "meals") normalizeDayType("meal_day_settings");
      if (key === "education") normalizeDayType("education_day_settings");
      if (key === "logistics") {
        const clampInt = (value: unknown, fallback = 0) => {
          const numeric = Number(value);
          if (!Number.isFinite(numeric)) return Math.max(0, fallback);
          return Math.max(0, Math.round(numeric));
        };
        const normalizedServices = DEFAULT_LOGISTICS_SERVICES.map((defaultService) => {
          const raw = Array.isArray(next.services)
            ? (next.services as Array<Record<string, unknown>>).find(
                (service) => service.key === defaultService.key
              )
            : null;
          return {
            ...defaultService,
            enabled: Boolean(raw?.enabled ?? defaultService.enabled),
            included_in_booth: Boolean(
              raw?.included_in_booth ?? defaultService.included_in_booth
            ),
            billing_mode:
              raw?.billing_mode === "included" ||
              raw?.billing_mode === "optional_add_on" ||
              raw?.billing_mode === "required_add_on"
                ? raw.billing_mode
                : defaultService.billing_mode,
            linked_product_id:
              typeof raw?.linked_product_id === "string" && raw.linked_product_id.trim()
                ? raw.linked_product_id
                : null,
            notes: typeof raw?.notes === "string" ? raw.notes.trim() : "",
          };
        });
        next.services = normalizedServices;

        const normalizedPresets = Array.isArray(next.booth_inclusion_presets)
          ? (next.booth_inclusion_presets as Array<Record<string, unknown>>)
              .map((preset) => ({
                tier: typeof preset.tier === "string" ? preset.tier.trim() : "",
                tables: clampInt(preset.tables, 0),
                chairs: clampInt(preset.chairs, 0),
                carpet: Boolean(preset.carpet),
                lighting: Boolean(preset.lighting),
                power: Boolean(preset.power),
                internet: Boolean(preset.internet),
                linked_product_id:
                  typeof preset.linked_product_id === "string" && preset.linked_product_id.trim()
                    ? preset.linked_product_id
                    : null,
                notes: typeof preset.notes === "string" ? preset.notes.trim() : "",
              }))
              .filter((preset) => preset.tier.length > 0)
          : [];

        if (modules.trade_show.enabled) {
          next.booth_inclusion_presets = normalizedPresets;
        } else {
          next.booth_inclusion_presets = [];
        }

        next.tasks = Array.isArray(next.tasks)
          ? (next.tasks as Array<Record<string, unknown>>)
              .map((task, index) => ({
                id:
                  typeof task.id === "string" && task.id.trim()
                    ? task.id
                    : `normalized-task-${index + 1}`,
                title: typeof task.title === "string" ? task.title.trim() : "",
                category:
                  task.category === "move_in" ||
                  task.category === "move_out" ||
                  task.category === "shipping" ||
                  task.category === "services" ||
                  task.category === "parking" ||
                  task.category === "custom"
                    ? task.category
                    : "custom",
                owner: typeof task.owner === "string" ? task.owner.trim() : "",
                due_date: typeof task.due_date === "string" ? task.due_date : "",
                status:
                  task.status === "planned" ||
                  task.status === "ordered" ||
                  task.status === "confirmed" ||
                  task.status === "delivered" ||
                  task.status === "blocked"
                    ? task.status
                    : "planned",
                blocker_reason:
                  typeof task.blocker_reason === "string" ? task.blocker_reason.trim() : "",
                notes: typeof task.notes === "string" ? task.notes.trim() : "",
              }))
              .filter(
                (task) =>
                  task.title.length > 0 ||
                  task.owner.length > 0 ||
                  task.notes.length > 0 ||
                  task.blocker_reason.length > 0 ||
                  task.due_date.length > 0
              )
          : [];

        next.parking_capacity = clampInt(next.parking_capacity, 0);
        next.inbound_shipping_address =
          typeof next.inbound_shipping_address === "string"
            ? next.inbound_shipping_address.trim()
            : "";
        next.return_shipping_address =
          typeof next.return_shipping_address === "string"
            ? next.return_shipping_address.trim()
            : "";
        next.dock_instructions =
          typeof next.dock_instructions === "string" ? next.dock_instructions.trim() : "";
        next.freight_notes =
          typeof next.freight_notes === "string" ? next.freight_notes.trim() : "";
        next.parking_notes =
          typeof next.parking_notes === "string" ? next.parking_notes.trim() : "";
        next.notes = typeof next.notes === "string" ? next.notes.trim() : "";
        next.move_in_enabled = Boolean(
          (typeof next.move_in_start === "string" && next.move_in_start.trim()) ||
            (typeof next.move_in_end === "string" && next.move_in_end.trim())
        );
        next.move_out_enabled = Boolean(
          (typeof next.move_out_start === "string" && next.move_out_start.trim()) ||
            (typeof next.move_out_end === "string" && next.move_out_end.trim())
        );
        next.config_version = 2;
      }
      if (key === "travel_accommodation") {
        const travelMode =
          next.travel_management_mode === "fully_managed" ||
          next.travel_management_mode === "partially_managed" ||
          next.travel_management_mode === "attendee_managed"
            ? next.travel_management_mode
            : "partially_managed";
        const accommodationMode =
          next.accommodation_management_mode === "fully_managed" ||
          next.accommodation_management_mode === "partially_managed" ||
          next.accommodation_management_mode === "attendee_managed"
            ? next.accommodation_management_mode
            : "partially_managed";
        const travelDisableAirWithinKm = Number(next.travel_disable_air_within_km);
        next.travel_management_mode = travelMode;
        next.accommodation_management_mode = accommodationMode;
        next.travel_disable_air_within_km =
          Number.isFinite(travelDisableAirWithinKm) && travelDisableAirWithinKm > 0
            ? travelDisableAirWithinKm
            : null;
        next.travel_nearby_support_mode = normalizeTravelSupportMode(
          next.travel_nearby_support_mode
        );
        next.required_travel_fields_by_key =
          next.required_travel_fields_by_key &&
          typeof next.required_travel_fields_by_key === "object" &&
          !Array.isArray(next.required_travel_fields_by_key)
            ? Object.fromEntries(
                Object.entries(next.required_travel_fields_by_key as Record<string, unknown>).map(
                  ([field, value]) => [field, Boolean(value)]
                )
              )
            : {};
        next.required_accommodation_fields_by_key =
          next.required_accommodation_fields_by_key &&
          typeof next.required_accommodation_fields_by_key === "object" &&
          !Array.isArray(next.required_accommodation_fields_by_key)
            ? Object.fromEntries(
                Object.entries(
                  next.required_accommodation_fields_by_key as Record<string, unknown>
                ).map(([field, value]) => [field, Boolean(value)])
              )
            : {};
        const rawRegistrationOptionTravelRules =
          next.registration_option_travel_rules ??
          next.registration_product_travel_rules;
        next.registration_option_travel_rules =
          rawRegistrationOptionTravelRules &&
          typeof rawRegistrationOptionTravelRules === "object" &&
          !Array.isArray(rawRegistrationOptionTravelRules)
            ? Object.fromEntries(
                Object.entries(
                  rawRegistrationOptionTravelRules as Record<string, unknown>
                ).map(([optionKey, rawRule]) => {
                  const rule =
                    rawRule && typeof rawRule === "object" && !Array.isArray(rawRule)
                      ? (rawRule as Record<string, unknown>)
                      : {};
                  const conditionalOverrides = Array.isArray(rule.conditional_overrides)
                    ? (rule.conditional_overrides as Array<Record<string, unknown>>).map((entry, index) => ({
                        id:
                          typeof entry.id === "string" && entry.id.trim()
                            ? entry.id
                            : `${optionKey}-rule-${index + 1}`,
                        name:
                          typeof entry.name === "string" && entry.name.trim()
                            ? entry.name
                            : "Override Rule",
                        condition:
                          entry.condition === "org_distance_to_airport_km_lte" ||
                          entry.condition === "org_type_is" ||
                          entry.condition === "org_type_registration_count_gt"
                            ? entry.condition
                            : "org_distance_to_airport_km_lte",
                        condition_number_value:
                          typeof entry.condition_number_value === "number"
                            ? entry.condition_number_value
                            : null,
                        condition_text_value:
                          typeof entry.condition_text_value === "string"
                            ? entry.condition_text_value.trim()
                            : "",
                        action:
                          entry.action === "disable_air_travel_option" ||
                          entry.action === "set_travel_support_mode" ||
                          entry.action === "set_offsite_auto_discount_percent"
                            ? entry.action
                            : "disable_air_travel_option",
                        action_text_value:
                          entry.action === "set_travel_support_mode"
                            ? normalizeTravelSupportMode(entry.action_text_value)
                            : typeof entry.action_text_value === "string"
                              ? entry.action_text_value.trim()
                              : "",
                        action_number_value:
                          typeof entry.action_number_value === "number"
                            ? entry.action_number_value
                            : null,
                        notes: typeof entry.notes === "string" ? entry.notes.trim() : "",
                      }))
                    : [];
                  return [
                    optionKey,
                    {
                      travel_support_mode: normalizeTravelSupportMode(rule.travel_support_mode),
                      allowed_travel_modes: normalizeAllowedTravelModes(
                        rule.allowed_travel_modes,
                        ["air", "rail", "personal_vehicle", "bus", "other"]
                      ),
                      includes_accommodation: Boolean(rule.includes_accommodation ?? true),
                      requires_travel_intake: Boolean(rule.requires_travel_intake ?? true),
                      requires_accommodation_intake: Boolean(
                        rule.requires_accommodation_intake ?? true
                      ),
                      arrival_window_start: normalizeDateTimeWindowValue(rule.arrival_window_start),
                      arrival_window_end: normalizeDateTimeWindowValue(rule.arrival_window_end),
                      departure_window_start: normalizeDateTimeWindowValue(rule.departure_window_start),
                      departure_window_end: normalizeDateTimeWindowValue(rule.departure_window_end),
                      conditional_overrides: conditionalOverrides,
                      notes: typeof rule.notes === "string" ? rule.notes.trim() : "",
                    },
                  ];
                })
              )
            : {};
        delete next.registration_product_travel_rules;
        next.notes = typeof next.notes === "string" ? next.notes.trim() : "";
      }
      return next;
    };

    const payload = MODULES.map((moduleDef) => ({
      module_key: moduleDef.key,
      enabled: moduleDef.alwaysIncluded ? true : modules[moduleDef.key].enabled,
      config_json: normalizeWithDayProfiles(
        moduleDef.key,
        (modules[moduleDef.key].config_json ?? {}) as Record<string, unknown>
      ),
    }));

    const result = await saveConferenceScheduleModules(conferenceId, payload);
    setIsSaving(false);
    if (!result.success || !result.data) {
      setSaveError(result.error ?? "Failed to save schedule modules.");
      return false;
    }

    const nextModules = toModuleMap(result.data);
    setModules(nextModules);
    savedTravelSectionSignaturesRef.current = buildTravelSectionSignatures(
      (nextModules.travel_accommodation?.config_json ?? {}) as Record<string, unknown>
    );
    setSaveSuccess(successMessage);
    return true;
  };

  const saveCurrentSetup = async () => {
    const context =
      step === 1
        ? "Scope setup saved."
        : step === 2 && currentModuleDef
          ? `${currentModuleDef.label} saved.`
          : "Setup saved.";
    return saveModules(context, {
      skipLogisticsValidation: true,
      skipTravelValidation: true,
    });
  };

  const saveSection = async (label: string) =>
    saveModules(`${label} saved.`, {
      skipLogisticsValidation: true,
      skipTravelValidation: true,
    });

  const updateModuleEnabled = (key: ConferenceScheduleModuleKey, enabled: boolean) => {
    setModules((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        enabled,
      },
    }));
  };

  const updateModuleConfig = useCallback((
    key: ConferenceScheduleModuleKey,
    patch: Record<string, unknown>
  ) => {
    setModules((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        config_json: {
          ...(prev[key].config_json ?? {}),
          ...patch,
        },
      },
    }));
  }, []);

  const updateTravelAccommodationConfig = useCallback((patch: Record<string, unknown>) => {
    setModules((prev) => ({
      ...prev,
      travel_accommodation: {
        ...prev.travel_accommodation,
        config_json: {
          ...(prev.travel_accommodation.config_json ?? {}),
          ...patch,
        },
      },
    }));
  }, []);

  const migrateLegacyTravelRuleKeysToProductKeys = useCallback(() => {
    const rawRuleMap =
      registrationOptionTravelRules && typeof registrationOptionTravelRules === "object"
        ? (registrationOptionTravelRules as Record<string, unknown>)
        : {};
    if (Object.keys(rawRuleMap).length === 0) {
      setSaveSuccess("No travel rules found to migrate.");
      return;
    }

    const nextRuleMap: Record<string, unknown> = { ...rawRuleMap };
    let migratedCompositeCount = 0;
    let migratedOptionCount = 0;
    let removedLegacyCount = 0;
    let skippedExistingCount = 0;

    for (const [ruleKey, ruleValue] of Object.entries(rawRuleMap)) {
      if (!ruleKey.includes("::")) continue;
      const [, productId] = ruleKey.split("::");
      const normalizedProductId = typeof productId === "string" ? productId.trim() : "";
      if (!normalizedProductId) continue;
      if (nextRuleMap[normalizedProductId] == null) {
        nextRuleMap[normalizedProductId] = ruleValue;
        migratedCompositeCount += 1;
      } else {
        skippedExistingCount += 1;
      }
    }

    for (const option of registrationOptions) {
      const optionRule = rawRuleMap[option.id];
      if (!optionRule || typeof optionRule !== "object" || Array.isArray(optionRule)) continue;
      const linkedProducts = uniqueStrings(option.linked_product_ids).filter(Boolean);
      if (linkedProducts.length === 0) continue;
      for (const productId of linkedProducts) {
        if (nextRuleMap[productId] == null) {
          nextRuleMap[productId] = optionRule;
          migratedOptionCount += 1;
        } else {
          skippedExistingCount += 1;
        }
      }
      delete nextRuleMap[option.id];
      removedLegacyCount += 1;
    }

    for (const ruleKey of Object.keys(nextRuleMap)) {
      if (!ruleKey.includes("::")) continue;
      delete nextRuleMap[ruleKey];
      removedLegacyCount += 1;
    }

    updateTravelAccommodationConfig({
      registration_option_travel_rules: nextRuleMap,
      registration_product_travel_rules: null,
    });
    setSaveError(null);
    if (migratedCompositeCount === 0 && migratedOptionCount === 0 && removedLegacyCount === 0) {
      setSaveSuccess("Travel rules are already normalized to product keys.");
      return;
    }
    setSaveSuccess(
      `Migrated travel rules to product keys (composite: ${migratedCompositeCount}, option: ${migratedOptionCount}, removed legacy keys: ${removedLegacyCount}, skipped existing product rules: ${skippedExistingCount}).`
    );
  }, [registrationOptionTravelRules, registrationOptions, updateTravelAccommodationConfig]);

  const setModuleAccessProduct = useCallback(
    (
      moduleKey: "meetings" | "trade_show" | "education" | "meals",
      productId: string
    ) => {
      updateModuleConfig(moduleKey, {
        access_product_id: productId.trim() ? productId : null,
      });
    },
    [updateModuleConfig]
  );

  const setTravelFieldOverride = (field: TravelFieldKey, required: boolean) => {
    const next = { ...requiredTravelFieldOverrides, [field]: required };
    updateTravelAccommodationConfig({ required_travel_fields_by_key: next });
  };

  const setAccommodationFieldOverride = (field: AccommodationFieldKey, required: boolean) => {
    const next = { ...requiredAccommodationFieldOverrides, [field]: required };
    updateTravelAccommodationConfig({ required_accommodation_fields_by_key: next });
  };

  const setTravelManagementScope = (scope: ManagementScope) => {
    updateTravelAccommodationConfig({ travel_management_scope: scope });
  };

  const setAccommodationManagementScope = (scope: ManagementScope) => {
    updateTravelAccommodationConfig({ accommodation_management_scope: scope });
  };

  const createDefaultTravelHotel = (): TravelHotelPolicy => {
    const id = `hotel-${travelHotelCounterRef.current}`;
    travelHotelCounterRef.current += 1;
    return {
      id,
      name: "",
      google_place_id: "",
      address: "",
      nightly_rate: 0,
      currency: "CAD",
      contact_name: "",
      contact_email: "",
      contact_phone: "",
      share_contact_with_attendees: false,
      room_block_url: "",
      room_block_code: "",
      notes: "",
    };
  };

  const addTravelHotel = () => {
    updateTravelAccommodationConfig({ hotels: [...travelHotels, createDefaultTravelHotel()] });
  };

  const updateTravelHotel = (hotelId: string, patch: Partial<TravelHotelPolicy>) => {
    updateTravelAccommodationConfig({
      hotels: travelHotels.map((hotel) => (hotel.id === hotelId ? { ...hotel, ...patch } : hotel)),
    });
  };

  const removeTravelHotel = (hotelId: string) => {
    updateTravelAccommodationConfig({
      hotels: travelHotels.filter((hotel) => hotel.id !== hotelId),
    });
  };

  const createDefaultDestinationAirport = (): TravelAirportPolicy => {
    const id = `airport-${travelAirportCounterRef.current}`;
    travelAirportCounterRef.current += 1;
    return {
      id,
      code: "",
      code_type: "",
      name: "",
      city: "",
      country: "CA",
      ground_transfer_notes: "",
    };
  };

  const addDestinationAirport = () => {
    updateTravelAccommodationConfig({
      destination_airports: [...destinationAirports, createDefaultDestinationAirport()],
    });
  };

  const updateDestinationAirport = (airportId: string, patch: Partial<TravelAirportPolicy>) => {
    updateTravelAccommodationConfig({
      destination_airports: destinationAirports.map((airport) =>
        airport.id === airportId ? { ...airport, ...patch } : airport
      ),
    });
  };

  const removeDestinationAirport = (airportId: string) => {
    updateTravelAccommodationConfig({
      destination_airports: destinationAirports.filter((airport) => airport.id !== airportId),
    });
    setAirportLookupQueryById((prev) => {
      const next = { ...prev };
      delete next[airportId];
      return next;
    });
    setAirportLookupLoadingById((prev) => {
      const next = { ...prev };
      delete next[airportId];
      return next;
    });
    setAirportLookupErrorById((prev) => {
      const next = { ...prev };
      delete next[airportId];
      return next;
    });
  };

  const applyAirportLookup = async (airportId: string, query: string): Promise<boolean> => {
    const raw = query.trim();
    if (!raw) return false;
    setAirportLookupLoadingById((prev) => ({ ...prev, [airportId]: true }));
    setAirportLookupErrorById((prev) => ({ ...prev, [airportId]: "" }));
    try {
      const response = await fetch(`/api/admin/airport-lookup?q=${encodeURIComponent(raw)}`, {
        method: "GET",
      });
      if (response.ok) {
        const payload = (await response.json()) as {
          success?: boolean;
          data?: {
            code?: string;
            codeType?: AirportCodeType;
            name?: string;
            city?: string;
            country?: string;
          };
          error?: string;
        };
        if (payload.success && payload.data?.code) {
          const match = payload.data;
          const existing = destinationAirports.find((airport) => airport.id === airportId);
          updateDestinationAirport(airportId, {
            code: (match.code ?? "").toUpperCase(),
            code_type: match.codeType === "metro" ? "metro" : "airport",
            name: match.name ?? "",
            city: match.city ?? "",
            country: (match.country ?? "CA").toUpperCase(),
            ground_transfer_notes:
              existing?.ground_transfer_notes?.trim()
                ? existing.ground_transfer_notes
                : match.codeType === "metro"
                  ? `Metro code (${(match.code ?? "").toUpperCase()}) selected. Confirm the specific arrival airport when booking.`
                  : existing?.ground_transfer_notes ?? "",
          });
          setAirportLookupQueryById((prev) => ({
            ...prev,
            [airportId]: `${(match.code ?? "").toUpperCase()} - ${match.name ?? ""}`.trim(),
          }));
          return true;
        }
      }
    } catch {
      // fall through to fallback match
    } finally {
      setAirportLookupLoadingById((prev) => ({ ...prev, [airportId]: false }));
    }

    const fallback = findAirportReference(raw);
    if (fallback) {
      const existing = destinationAirports.find((airport) => airport.id === airportId);
      updateDestinationAirport(airportId, {
        code: fallback.code,
        code_type: fallback.codeType,
        name: fallback.name,
        city: fallback.city,
        country: fallback.country,
        ground_transfer_notes:
          existing?.ground_transfer_notes?.trim()
            ? existing.ground_transfer_notes
            : `Metro code (${fallback.code}) selected. Confirm the specific arrival airport when booking.`,
      });
      setAirportLookupQueryById((prev) => ({
        ...prev,
        [airportId]: `${fallback.code} - ${fallback.name}`,
      }));
      return true;
    }

    setAirportLookupErrorById((prev) => ({
      ...prev,
      [airportId]: "No airport match found. Try a 3-letter code (e.g., YTZ) or airport name.",
    }));
    return false;
  };

  const createDefaultAirlinePolicy = (): TravelAirlinePolicy => {
    const id = `airline-${travelAirlineCounterRef.current}`;
    travelAirlineCounterRef.current += 1;
    return {
      id,
      airline_name: "",
      airline_code: "",
      booking_class_policy: "",
      bags_included: 0,
      meal_included: false,
      change_policy_notes: "",
      notes: "",
    };
  };

  const addAirlinePolicy = () => {
    updateTravelAccommodationConfig({
      airline_policies: [...airlinePolicies, createDefaultAirlinePolicy()],
    });
  };

  const updateAirlinePolicy = (policyId: string, patch: Partial<TravelAirlinePolicy>) => {
    updateTravelAccommodationConfig({
      airline_policies: airlinePolicies.map((policy) =>
        policy.id === policyId ? { ...policy, ...patch } : policy
      ),
    });
  };

  const removeAirlinePolicy = (policyId: string) => {
    updateTravelAccommodationConfig({
      airline_policies: airlinePolicies.filter((policy) => policy.id !== policyId),
    });
  };

  const createDefaultTravelPolicy = (): TravelPolicyEntry => {
    const id = `travel-policy-${travelPolicyCounterRef.current}`;
    travelPolicyCounterRef.current += 1;
    return {
      id,
      title: "Travel Policy",
      policy_text: "",
      applies_to_registration_types: [],
      effective_from: "",
      effective_to: "",
    };
  };

  const addTravelPolicy = () => {
    updateTravelAccommodationConfig({
      travel_policies: [...travelPolicies, createDefaultTravelPolicy()],
    });
  };

  const updateTravelPolicy = (policyId: string, patch: Partial<TravelPolicyEntry>) => {
    updateTravelAccommodationConfig({
      travel_policies: travelPolicies.map((policy) =>
        policy.id === policyId ? { ...policy, ...patch } : policy
      ),
    });
  };

  const removeTravelPolicy = (policyId: string) => {
    updateTravelAccommodationConfig({
      travel_policies: travelPolicies.filter((policy) => policy.id !== policyId),
    });
  };

  const createDefaultReimbursementPolicy = (): ReimbursementPolicyEntry => {
    const id = `reimbursement-policy-${reimbursementPolicyCounterRef.current}`;
    reimbursementPolicyCounterRef.current += 1;
    return {
      id,
      title: "Reimbursement Policy",
      covered_items: "",
      caps_and_limits: "",
      receipt_requirements: "",
      submission_sla_days: 14,
      payout_timeline: "",
    };
  };

  const addReimbursementPolicy = () => {
    updateTravelAccommodationConfig({
      reimbursement_policies: [
        ...reimbursementPolicies,
        createDefaultReimbursementPolicy(),
      ],
    });
  };

  const updateReimbursementPolicy = (
    policyId: string,
    patch: Partial<ReimbursementPolicyEntry>
  ) => {
    updateTravelAccommodationConfig({
      reimbursement_policies: reimbursementPolicies.map((policy) =>
        policy.id === policyId ? { ...policy, ...patch } : policy
      ),
    });
  };

  const removeReimbursementPolicy = (policyId: string) => {
    updateTravelAccommodationConfig({
      reimbursement_policies: reimbursementPolicies.filter((policy) => policy.id !== policyId),
    });
  };

  const normalizeTravelRule = useCallback((raw: Partial<ProductTravelRule> | undefined): ProductTravelRule => {
    const defaults = createDefaultProductTravelRule();
    return {
      travel_support_mode: normalizeTravelSupportMode(raw?.travel_support_mode),
      allowed_travel_modes: normalizeAllowedTravelModes(
        raw?.allowed_travel_modes,
        defaults.allowed_travel_modes
      ),
      includes_accommodation:
        typeof raw?.includes_accommodation === "boolean"
          ? raw.includes_accommodation
          : defaults.includes_accommodation,
      requires_travel_intake:
        typeof raw?.requires_travel_intake === "boolean"
          ? raw.requires_travel_intake
          : defaults.requires_travel_intake,
      requires_accommodation_intake:
        typeof raw?.requires_accommodation_intake === "boolean"
          ? raw.requires_accommodation_intake
          : defaults.requires_accommodation_intake,
      arrival_window_start: normalizeDateTimeWindowValue(raw?.arrival_window_start),
      arrival_window_end: normalizeDateTimeWindowValue(raw?.arrival_window_end),
      departure_window_start: normalizeDateTimeWindowValue(raw?.departure_window_start),
      departure_window_end: normalizeDateTimeWindowValue(raw?.departure_window_end),
      conditional_overrides: Array.isArray(raw?.conditional_overrides)
        ? (raw.conditional_overrides as Array<Partial<ProductConditionalOverrideRule>>).map(
            (rule) => ({
              id:
                typeof rule.id === "string" && rule.id.trim()
                  ? rule.id
                  : createDefaultConditionalOverrideRule().id,
              name:
                typeof rule.name === "string" && rule.name.trim()
                  ? rule.name
                  : "Override Rule",
              condition:
                rule.condition === "org_distance_to_airport_km_lte" ||
                rule.condition === "org_type_is" ||
                rule.condition === "org_type_registration_count_gt"
                  ? rule.condition
                  : "org_distance_to_airport_km_lte",
              condition_number_value:
                typeof rule.condition_number_value === "number"
                  ? rule.condition_number_value
                  : null,
              condition_text_value:
                typeof rule.condition_text_value === "string"
                  ? rule.condition_text_value
                  : "",
              action:
                rule.action === "disable_air_travel_option" ||
                rule.action === "set_travel_support_mode" ||
                rule.action === "set_offsite_auto_discount_percent"
                  ? rule.action
                  : "disable_air_travel_option",
              action_text_value:
                rule.action === "set_travel_support_mode"
                  ? normalizeTravelSupportMode(rule.action_text_value)
                  : typeof rule.action_text_value === "string"
                    ? rule.action_text_value
                    : "",
              action_number_value:
                typeof rule.action_number_value === "number" ? rule.action_number_value : null,
              notes: typeof rule.notes === "string" ? rule.notes : "",
            })
          )
        : defaults.conditional_overrides,
      notes: typeof raw?.notes === "string" ? raw.notes : defaults.notes,
    };
  }, []);

  const getProductTravelRule = (
    type: RegistrationTypeKey,
    productId: string
  ): ProductTravelRule => {
    const optionKey = getRegistrationOptionKey(type, productId);
    const raw =
      registrationOptionTravelRules[productId] ??
      registrationOptionTravelRules[optionKey] ??
      {};
    return normalizeTravelRule(raw);
  };

  const getRegistrationOptionTravelRule = (option: RegistrationOption): ProductTravelRule => {
    for (const productId of option.linked_product_ids) {
      const compositeKey = getRegistrationOptionKey(option.registration_type, productId);
      const raw = registrationOptionTravelRules[productId] ?? registrationOptionTravelRules[compositeKey];
      if (raw && typeof raw === "object") {
        return normalizeTravelRule(raw as Partial<ProductTravelRule>);
      }
    }
    const direct = registrationOptionTravelRules[option.id];
    if (direct && typeof direct === "object") {
      return normalizeTravelRule(direct as Partial<ProductTravelRule>);
    }
    return createDefaultProductTravelRule();
  };

  const getOptionAvailableRegistrationFields = (option: RegistrationOption) => {
    const rule = getRegistrationOptionTravelRule(option);
    if (availableRegistrationFields.length === 0) {
      return availableRegistrationFields;
    }
    const blockedFieldKeys = getBlockedRegistrationFieldKeysForTravelRule(rule);
    return availableRegistrationFields.filter((field) => !blockedFieldKeys.has(field.key));
  };

  const getVisibleRegistrationOptionFormItems = (option: RegistrationOption) => {
    const availableFieldKeys = new Set(
      getOptionAvailableRegistrationFields(option).map((field) => field.key)
    );
    const scopedItems = option.form_items.filter(
      (item) => item.type !== "field" || !item.field_key || availableFieldKeys.has(item.field_key)
    );
    const isQuestionItem = (item: RegistrationOptionFormItem) =>
      item.type === "field" || item.type === "custom";

    const cleaned: RegistrationOptionFormItem[] = [];
    for (let index = 0; index < scopedItems.length; index += 1) {
      const item = scopedItems[index];
      if (item.type === "title") {
        let hasQuestionUnderTitle = false;
        for (let cursor = index + 1; cursor < scopedItems.length; cursor += 1) {
          const candidate = scopedItems[cursor];
          if (candidate.type === "title") break;
          if (isQuestionItem(candidate)) {
            hasQuestionUnderTitle = true;
            break;
          }
        }
        if (hasQuestionUnderTitle) cleaned.push(item);
        continue;
      }
      if (item.type === "break") {
        const hasPreviousQuestion = cleaned.some((candidate) => isQuestionItem(candidate));
        const hasNextQuestion = scopedItems
          .slice(index + 1)
          .some((candidate) => isQuestionItem(candidate));
        if (hasPreviousQuestion && hasNextQuestion) cleaned.push(item);
        continue;
      }
      cleaned.push(item);
    }
    return cleaned;
  };

  const getAutoRequiredRegistrationFieldKeysForTravelRule = (
    rule: ProductTravelRule
  ): RegistrationFieldKey[] => {
    const requiredTravelFields = TRAVEL_FIELD_DEFS.filter((field) => {
      const defaultRequired = defaultRequiredTravelFields.includes(field.key);
      const override = requiredTravelFieldOverrides[field.key];
      return typeof override === "boolean" ? override : defaultRequired;
    }).map((field) => TRAVEL_TO_REG_FIELD_MAP[field.key]);

    const requiredAccommodationFields = ACCOMMODATION_FIELD_DEFS.filter((field) => {
      const defaultRequired = defaultRequiredAccommodationFields.includes(field.key);
      const override = requiredAccommodationFieldOverrides[field.key];
      return typeof override === "boolean" ? override : defaultRequired;
    }).map((field) => ACCOMMODATION_TO_REG_FIELD_MAP[field.key]);

    const next: RegistrationFieldKey[] = [];
    if (rule.travel_support_mode !== "none" && rule.requires_travel_intake) {
      next.push(...requiredTravelFields);
    }
    if (rule.includes_accommodation && rule.requires_accommodation_intake) {
      next.push(...requiredAccommodationFields);
    }
    return uniqueStrings(next);
  };

  const getAllowedTravelPresetsForScope = (): RegistrationOptionTravelPreset[] => {
    if (travelManagementScope === "none_managed" && accommodationManagementScope === "none_managed") {
      return ["no_travel_scope"];
    }
    if (travelManagementScope === "none_managed") {
      return ["org_managed_accommodation_only", "no_travel_scope"];
    }
    if (travelManagementScope === "all_managed" && accommodationManagementScope === "all_managed") {
      return ["org_managed_travel_accommodation"];
    }
    if (travelManagementScope === "all_managed" && accommodationManagementScope === "none_managed") {
      return ["org_managed_travel_accommodation"];
    }
    if (accommodationManagementScope === "none_managed") {
      return ["org_managed_travel_accommodation", "no_travel_scope"];
    }
    return [
      "org_managed_travel_accommodation",
      "org_managed_accommodation_only",
      "no_travel_scope",
    ];
  };

  const enforceRuleByManagementScope = (rule: ProductTravelRule): ProductTravelRule => {
    let next = { ...rule };
    if (travelManagementScope === "none_managed") {
      next = {
        ...next,
        travel_support_mode: "none",
        requires_travel_intake: false,
        allowed_travel_modes: [],
      };
    } else if (travelManagementScope === "all_managed") {
      next = {
        ...next,
        travel_support_mode: "managed",
        requires_travel_intake: true,
        allowed_travel_modes:
          next.allowed_travel_modes.length > 0
            ? next.allowed_travel_modes
            : ["air", "rail", "personal_vehicle", "bus", "other"],
      };
    }

    if (accommodationManagementScope === "none_managed") {
      next = {
        ...next,
        includes_accommodation: false,
        requires_accommodation_intake: false,
      };
    } else if (accommodationManagementScope === "all_managed") {
      next = {
        ...next,
        includes_accommodation: true,
        requires_accommodation_intake: true,
      };
    }
    return next;
  };

  const updateRegistrationOptionTravelRule = (
    option: RegistrationOption,
    patch: Partial<ProductTravelRule>,
    behavior?: {
      autoPopulateRequiredFields?: boolean;
    }
  ) => {
    const current = getRegistrationOptionTravelRule(option);
    const nextRule: ProductTravelRule = enforceRuleByManagementScope({
      ...current,
      ...patch,
    });

    const blockedFieldKeys = getBlockedRegistrationFieldKeysForTravelRule(nextRule);
    let nextFormItems = option.form_items.map((item) => {
      if (item.type !== "field" || !item.field_key) return item;
      if (!blockedFieldKeys.has(item.field_key)) return item;
      return {
        ...item,
        state: "optional" as const,
      };
    });

    if (behavior?.autoPopulateRequiredFields) {
      const autoRequiredFieldKeys = getAutoRequiredRegistrationFieldKeysForTravelRule(nextRule).filter(
        (fieldKey) => !blockedFieldKeys.has(fieldKey)
      );
      const existingFieldKeys = new Set(
        nextFormItems
          .filter((item) => item.type === "field" && Boolean(item.field_key))
          .map((item) => item.field_key as RegistrationFieldKey)
      );

      nextFormItems = nextFormItems.map((item) => {
        if (item.type !== "field" || !item.field_key) return item;
        if (!autoRequiredFieldKeys.includes(item.field_key)) return item;
        return {
          ...item,
          state: "required" as const,
        };
      });

      for (const fieldKey of autoRequiredFieldKeys) {
        if (existingFieldKeys.has(fieldKey)) continue;
        const fieldDef = REGISTRATION_FIELDS.find((field) => field.key === fieldKey);
        if (!fieldDef) continue;
        const sectionTitleExists = nextFormItems.some(
          (item) =>
            item.type === "title" &&
            item.label.trim().toLowerCase() ===
              REGISTRATION_SECTION_LABELS[fieldDef.section].toLowerCase()
        );
        if (!sectionTitleExists) {
          const titleItemId = `registration-form-item-${registrationOptionFormItemCounterRef.current}`;
          registrationOptionFormItemCounterRef.current += 1;
          nextFormItems.push({
            id: titleItemId,
            type: "title",
            field_key: null,
            label: REGISTRATION_SECTION_LABELS[fieldDef.section],
            state: "optional",
          });
        }
        const itemId = `registration-form-item-${registrationOptionFormItemCounterRef.current}`;
        registrationOptionFormItemCounterRef.current += 1;
        nextFormItems.push({
          id: itemId,
          type: "field",
          field_key: fieldDef.key,
          label: fieldDef.label,
          state: "required",
          custom_input_type: undefined,
          custom_options: [],
        });
      }
    }

    if (JSON.stringify(nextFormItems) !== JSON.stringify(option.form_items)) {
      updateRegistrationOption(option.id, { form_items: nextFormItems });
    }

    const targetRuleKeys =
      option.linked_product_ids.length > 0 ? uniqueStrings(option.linked_product_ids) : [option.id];
    const nextRuleMap: Record<string, unknown> = {
      ...registrationOptionTravelRules,
    };
    for (const key of targetRuleKeys) {
      nextRuleMap[key] = {
        ...nextRule,
      };
    }

    updateTravelAccommodationConfig({
      registration_option_travel_rules: nextRuleMap,
    });
  };

  const applyRegistrationOptionTravelPreset = (
    option: RegistrationOption,
    preset: RegistrationOptionTravelPreset
  ) => {
    updateRegistrationOptionTravelRule(option, buildTravelRulePatchFromPreset(preset), {
      autoPopulateRequiredFields: preset !== "no_travel_scope",
    });
  };

  const toggleRegistrationOptionTravelMode = (
    option: RegistrationOption,
    mode: TravelModeKey,
    enabled: boolean
  ) => {
    const current = getRegistrationOptionTravelRule(option);
    const next = new Set(current.allowed_travel_modes);
    if (enabled) next.add(mode);
    else next.delete(mode);
    updateRegistrationOptionTravelRule(option, { allowed_travel_modes: Array.from(next) });
  };

  const addRegistrationOptionConditionalOverrideRule = (option: RegistrationOption) => {
    const current = getRegistrationOptionTravelRule(option);
    updateRegistrationOptionTravelRule(option, {
      conditional_overrides: [
        ...current.conditional_overrides,
        createDefaultConditionalOverrideRule(),
      ],
    });
  };

  const updateRegistrationOptionConditionalOverrideRule = (
    option: RegistrationOption,
    ruleId: string,
    patch: Partial<ProductConditionalOverrideRule>
  ) => {
    const current = getRegistrationOptionTravelRule(option);
    updateRegistrationOptionTravelRule(option, {
      conditional_overrides: current.conditional_overrides.map((rule) =>
        rule.id === ruleId ? { ...rule, ...patch } : rule
      ),
    });
  };

  const removeRegistrationOptionConditionalOverrideRule = (
    option: RegistrationOption,
    ruleId: string
  ) => {
    const current = getRegistrationOptionTravelRule(option);
    updateRegistrationOptionTravelRule(option, {
      conditional_overrides: current.conditional_overrides.filter((rule) => rule.id !== ruleId),
    });
  };

  const applyOptionIntakeRequirement = (
    option: RegistrationOption,
    scope: "travel" | "accommodation",
    required: boolean
  ) => {
    const scopedKeys =
      scope === "travel"
        ? new Set<RegistrationFieldKey>(TRAVEL_FIELD_KEYS)
        : new Set<RegistrationFieldKey>(ACCOMMODATION_FIELD_KEYS);
    const nextItems = option.form_items.map((item) => {
      if (item.type !== "field" || !item.field_key) return item;
      if (!scopedKeys.has(item.field_key)) return item;
      return {
        ...item,
        state: (required ? "required" : "optional") as RegistrationFieldState,
      };
    });
    updateRegistrationOption(option.id, { form_items: nextItems });
    if (scope === "travel") {
      updateRegistrationOptionTravelRule(option, { requires_travel_intake: required });
    } else {
      updateRegistrationOptionTravelRule(option, { requires_accommodation_intake: required });
    }
  };

  const updateProductTravelRule = (
    type: RegistrationTypeKey,
    productId: string,
    patch: Partial<ProductTravelRule>
  ) => {
    const current = getProductTravelRule(type, productId);
    const nextRule = enforceRuleByManagementScope({
      ...current,
      ...patch,
    });
    updateTravelAccommodationConfig({
      registration_option_travel_rules: {
        ...registrationOptionTravelRules,
        [productId]: {
          ...nextRule,
        },
      },
    });
  };

  const applyProductTravelPreset = (
    type: RegistrationTypeKey,
    productId: string,
    preset: RegistrationOptionTravelPreset
  ) => {
    updateProductTravelRule(type, productId, buildTravelRulePatchFromPreset(preset));
  };

  const toggleProductTravelMode = (
    type: RegistrationTypeKey,
    productId: string,
    mode: TravelModeKey,
    enabled: boolean
  ) => {
    const current = getProductTravelRule(type, productId);
    const next = new Set(current.allowed_travel_modes);
    if (enabled) next.add(mode);
    else next.delete(mode);
    updateProductTravelRule(type, productId, { allowed_travel_modes: Array.from(next) });
  };

  const addProductConditionalOverrideRule = (type: RegistrationTypeKey, productId: string) => {
    const current = getProductTravelRule(type, productId);
    updateProductTravelRule(type, productId, {
      conditional_overrides: [
        ...current.conditional_overrides,
        createDefaultConditionalOverrideRule(),
      ],
    });
  };

  const updateProductConditionalOverrideRule = (
    type: RegistrationTypeKey,
    productId: string,
    ruleId: string,
    patch: Partial<ProductConditionalOverrideRule>
  ) => {
    const current = getProductTravelRule(type, productId);
    updateProductTravelRule(type, productId, {
      conditional_overrides: current.conditional_overrides.map((rule) =>
        rule.id === ruleId ? { ...rule, ...patch } : rule
      ),
    });
  };

  const removeProductConditionalOverrideRule = (
    type: RegistrationTypeKey,
    productId: string,
    ruleId: string
  ) => {
    const current = getProductTravelRule(type, productId);
    updateProductTravelRule(type, productId, {
      conditional_overrides: current.conditional_overrides.filter((rule) => rule.id !== ruleId),
    });
  };

  const nextStep = async () => {
    if (step === 1 || step === 2) {
      const ok = await saveModules("Draft saved.", {
        skipLogisticsValidation: true,
        skipTravelValidation: true,
      });
      if (!ok) return;
    }
    if (step === 1) {
      setModuleStepIndex(0);
      setStep(2);
      return;
    }
    if (step === 2) {
      if (moduleStepIndex < selectedModuleDefs.length - 1) {
        setModuleStepIndex((prev) => prev + 1);
        return;
      }
      setStep(3);
      return;
    }
    setStep((prev) => Math.min(maxStep, prev + 1));
  };

  const prevStep = () => {
    if (step === 3) {
      setStep(2);
      setModuleStepIndex(Math.max(selectedModuleDefs.length - 1, 0));
      return;
    }
    if (step === 2) {
      if (moduleStepIndex > 0) {
        setModuleStepIndex((prev) => prev - 1);
        return;
      }
      setStep(1);
      return;
    }
    setStep((prev) => Math.max(1, prev - 1));
  };

  const jumpToModule = (moduleKey?: ConferenceScheduleModuleKey) => {
    if (!moduleKey) return;
    const idx = selectedModuleDefs.findIndex((moduleDef) => moduleDef.key === moduleKey);
    if (idx < 0) return;
    setStep(2);
    setModuleStepIndex(idx);
  };

  const toggleMeetingDay = (date: string, enabled: boolean) => {
    const set = new Set(meetingDays);
    if (enabled) set.add(date);
    else set.delete(date);

    const nextDays = [...set].sort();
    const nextSettings: Record<string, MeetingDaySetting> = {};
    for (const day of nextDays) {
      const existing = meetingDaySettings[day];
      const defaultStart = String(meetingConfig.meeting_start_time ?? params?.meeting_start_time ?? "09:00");
      const defaultEnd = String(meetingConfig.meeting_end_time ?? params?.meeting_end_time ?? "17:00");
      const defaultDuration = Number(meetingConfig.slot_duration_minutes ?? params?.slot_duration_minutes ?? 15);
      const defaultBuffer = Number(meetingConfig.meeting_buffer_minutes ?? params?.slot_buffer_minutes ?? 0);
      const existingCount = Number(existing?.meeting_count ?? 0);
      nextSettings[day] = {
        day_type: existing?.day_type as MeetingDaySetting["day_type"],
        meeting_count: Number.isFinite(existingCount) && existingCount > 0 ? existingCount : 8,
        start_time: existing?.start_time ?? defaultStart,
        end_time: existing?.end_time ?? defaultEnd,
        slot_duration_minutes: Number.isFinite(Number(existing?.slot_duration_minutes))
          ? Number(existing?.slot_duration_minutes)
          : defaultDuration,
        buffer_minutes: Number.isFinite(Number(existing?.buffer_minutes))
          ? Number(existing?.buffer_minutes)
          : defaultBuffer,
      };
    }

    updateModuleConfig("meetings", {
      meeting_days: nextDays,
      meeting_day_settings: nextSettings,
    });
  };

  const updateMeetingDaySetting = (date: string, patch: MeetingDaySetting) => {
    const nextSettings: Record<string, MeetingDaySetting> = {
      ...meetingDaySettings,
      [date]: {
        ...(meetingDaySettings[date] ?? {}),
        ...patch,
      },
    };
    updateModuleConfig("meetings", { meeting_day_settings: nextSettings });
  };

  const movePriority = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= schedulingPriorities.length) return;
    const next = [...schedulingPriorities];
    const current = next[index];
    next[index] = next[nextIndex];
    next[nextIndex] = current;
    updateModuleConfig("meetings", { scheduling_priorities: next });
  };

  const toggleTradeShowDay = (date: string, enabled: boolean) => {
    const set = new Set(tradeShowDays);
    if (enabled) set.add(date);
    else set.delete(date);

    const nextDays = [...set].sort();
    const nextSettings: Record<string, TradeShowDaySetting> = {};
    for (const day of nextDays) {
      const existing = tradeShowDaySettings[day];
      nextSettings[day] = {
        day_type: existing?.day_type as TradeShowDaySetting["day_type"],
        open_time: existing?.open_time ?? "09:00",
        close_time: existing?.close_time ?? "17:00",
      };
    }

    updateModuleConfig("trade_show", {
      trade_show_days: nextDays,
      trade_show_day_settings: nextSettings,
    });
  };

  const updateTradeShowDaySetting = (date: string, patch: TradeShowDaySetting) => {
    const nextSettings: Record<string, TradeShowDaySetting> = {
      ...tradeShowDaySettings,
      [date]: {
        ...(tradeShowDaySettings[date] ?? {}),
        ...patch,
      },
    };
    updateModuleConfig("trade_show", { trade_show_day_settings: nextSettings });
  };

  const toggleEducationDay = (date: string, enabled: boolean) => {
    const set = new Set(educationDays);
    if (enabled) set.add(date);
    else set.delete(date);

    const nextDays = [...set].sort();
    const nextSettings: Record<string, EducationDaySetting> = {};
    for (const day of nextDays) {
      const existing = educationDaySettings[day];
      nextSettings[day] = {
        day_type: existing?.day_type as EducationDaySetting["day_type"],
        start_time: existing?.start_time ?? "09:00",
        end_time: existing?.end_time ?? "17:00",
      };
    }

    updateModuleConfig("education", {
      education_days: nextDays,
      education_day_settings: nextSettings,
    });
  };

  const updateEducationDaySetting = (date: string, patch: EducationDaySetting) => {
    const nextSettings: Record<string, EducationDaySetting> = {
      ...educationDaySettings,
      [date]: {
        ...(educationDaySettings[date] ?? {}),
        ...patch,
      },
    };
    updateModuleConfig("education", { education_day_settings: nextSettings });
  };

  const toggleMealDay = (date: string, enabled: boolean) => {
    const set = new Set(mealDays);
    if (enabled) set.add(date);
    else set.delete(date);

    const nextDays = [...set].sort();
    const nextSettings: Record<string, MealDaySetting> = {};
    for (const day of nextDays) {
      const existing = mealDaySettings[day];
      nextSettings[day] = {
        day_type: existing?.day_type as MealDaySetting["day_type"],
        breakfast: existing?.breakfast ?? true,
        lunch: existing?.lunch ?? true,
        dinner: existing?.dinner ?? false,
        custom_enabled: existing?.custom_enabled ?? false,
        custom_label: existing?.custom_label ?? "Custom",
        breakfast_time: existing?.breakfast_time ?? "08:00",
        lunch_time: existing?.lunch_time ?? "12:00",
        dinner_time: existing?.dinner_time ?? "18:00",
        custom_time: existing?.custom_time ?? "17:00",
        breakfast_duration_minutes:
          Number.isFinite(Number(existing?.breakfast_duration_minutes))
            ? Number(existing?.breakfast_duration_minutes)
            : 60,
        lunch_duration_minutes:
          Number.isFinite(Number(existing?.lunch_duration_minutes))
            ? Number(existing?.lunch_duration_minutes)
            : 60,
        dinner_duration_minutes:
          Number.isFinite(Number(existing?.dinner_duration_minutes))
            ? Number(existing?.dinner_duration_minutes)
            : 90,
        custom_duration_minutes:
          Number.isFinite(Number(existing?.custom_duration_minutes))
            ? Number(existing?.custom_duration_minutes)
            : 90,
        snack_breaks: Array.isArray(existing?.snack_breaks)
          ? (existing?.snack_breaks as Array<{ start_time?: unknown; duration_minutes?: unknown }>)
              .map((entry) => ({
                start_time:
                  typeof entry.start_time === "string" && entry.start_time
                    ? entry.start_time
                    : "15:00",
                duration_minutes:
                  Number.isFinite(Number(entry.duration_minutes)) && Number(entry.duration_minutes) >= 5
                    ? Number(entry.duration_minutes)
                    : 30,
              }))
          : [],
      };
    }

    updateModuleConfig("meals", {
      meal_days: nextDays,
      meal_day_settings: nextSettings,
    });
  };

  const updateMealDaySetting = (date: string, patch: MealDaySetting) => {
    const nextSettings: Record<string, MealDaySetting> = {
      ...mealDaySettings,
      [date]: {
        ...(mealDaySettings[date] ?? {}),
        ...patch,
      },
    };
    updateModuleConfig("meals", { meal_day_settings: nextSettings });
  };

  const setSnackBreakCount = (date: string, count: number) => {
    const safeCount = Math.max(0, Math.min(6, Number.isFinite(count) ? count : 0));
    const currentBreaks = Array.isArray(mealDaySettings[date]?.snack_breaks)
      ? [...(mealDaySettings[date]?.snack_breaks as Array<{ start_time: string; duration_minutes: number }>)]
      : [];
    const nextBreaks = Array.from({ length: safeCount }, (_, index) => {
      const existing = currentBreaks[index];
      return {
        start_time: existing?.start_time ?? "15:00",
        duration_minutes:
          Number.isFinite(Number(existing?.duration_minutes)) && Number(existing?.duration_minutes) >= 5
            ? Number(existing?.duration_minutes)
            : 30,
      };
    });
    updateMealDaySetting(date, { snack_breaks: nextBreaks });
  };

  const setSnackBreakTime = (date: string, index: number, time: string) => {
    const currentBreaks = Array.isArray(mealDaySettings[date]?.snack_breaks)
      ? [...(mealDaySettings[date]?.snack_breaks as Array<{ start_time: string; duration_minutes: number }>)]
      : [];
    const entry = currentBreaks[index] ?? { start_time: "15:00", duration_minutes: 30 };
    currentBreaks[index] = { ...entry, start_time: time };
    updateMealDaySetting(date, { snack_breaks: currentBreaks });
  };

  const setSnackBreakDuration = (date: string, index: number, durationMinutes: number) => {
    const currentBreaks = Array.isArray(mealDaySettings[date]?.snack_breaks)
      ? [...(mealDaySettings[date]?.snack_breaks as Array<{ start_time: string; duration_minutes: number }>)]
      : [];
    const entry = currentBreaks[index] ?? { start_time: "15:00", duration_minutes: 30 };
    currentBreaks[index] = {
      ...entry,
      duration_minutes:
        Number.isFinite(durationMinutes) && durationMinutes >= 5 ? durationMinutes : 30,
    };
    updateMealDaySetting(date, { snack_breaks: currentBreaks });
  };

  const createDefaultOffsiteEvent = (): OffsiteEventDraft => {
    const defaultDate = conferenceDates[0] ?? "";
    const nextId = `offsite-${offsiteEventCounterRef.current}`;
    offsiteEventCounterRef.current += 1;
    return {
      id: nextId,
      title: "Offsite Event",
      date: defaultDate,
      start_time: "18:00",
      end_time: "21:00",
      linked_product_id: null,
      google_place_id: "",
      venue_name: "",
      venue_address: "",
      travel_time_minutes: 30,
      travel_mode: "shuttle",
      departure_time: "17:15",
      return_time: "21:15",
      includes_meal: false,
      meal_type: "dinner",
      meal_custom_label: "",
      audience_registration_types: ["delegate", "observer", "exhibitor"],
      capacity: 100,
      waitlist_enabled: true,
      is_sponsored: false,
      sponsor_name: "",
      sponsor_tier: "",
      sponsorship_activation_notes: "",
      waiver_required: false,
      accessibility_notes: "",
      emergency_contact: "",
      meeting_point: "",
      contingency_plan: "",
    };
  };

  const setOffsiteEvents = (nextEvents: OffsiteEventDraft[]) => {
    updateModuleConfig("offsite", { offsite_events: nextEvents });
  };

  const addOffsiteEvent = () => {
    setOffsiteEvents([...offsiteEvents, createDefaultOffsiteEvent()]);
  };

  const removeOffsiteEvent = (eventId: string) => {
    setOffsiteEvents(offsiteEvents.filter((event) => event.id !== eventId));
  };

  const updateOffsiteEvent = (eventId: string, patch: Partial<OffsiteEventDraft>) => {
    setOffsiteEvents(
      offsiteEvents.map((event) => (event.id === eventId ? { ...event, ...patch } : event))
    );
  };

  const updateRegistrationOpsConfig = useCallback((patch: Record<string, unknown>) => {
    setModules((prev) => ({
      ...prev,
      registration_ops: {
        ...prev.registration_ops,
        config_json: {
          ...(prev.registration_ops.config_json ?? {}),
          ...patch,
        },
      },
    }));
  }, []);
  const updateCommunicationsConfig = useCallback((patch: Record<string, unknown>) => {
    setModules((prev) => ({
      ...prev,
      communications: {
        ...prev.communications,
        config_json: {
          ...(prev.communications.config_json ?? {}),
          ...patch,
        },
      },
    }));
  }, []);
  const setRegistrationOptions = useCallback((nextOptions: RegistrationOption[]) => {
    const nextSelectedTypes = uniqueStrings(nextOptions.map((option) => option.registration_type));
    const nextProductLinkageByType = REGISTRATION_TYPES.reduce<Record<string, string[]>>(
      (acc, typeDef) => {
        const linkedProducts = uniqueStrings(
          nextOptions
            .filter((option) => option.registration_type === typeDef.key)
            .flatMap((option) => option.linked_product_ids)
        );
        acc[typeDef.key] = linkedProducts;
        return acc;
      },
      {}
    );
    const nextRequiredFieldsByType = REGISTRATION_TYPES.reduce<Record<string, string[]>>(
      (acc, typeDef) => {
        const requiredFields = uniqueStrings(
          nextOptions
            .filter((option) => option.registration_type === typeDef.key)
            .flatMap((option) =>
              option.form_items
                .filter(
                  (item) => item.type === "field" && item.state === "required" && Boolean(item.field_key)
                )
                .map((item) => item.field_key as RegistrationFieldKey)
            )
        );
        acc[typeDef.key] = requiredFields;
        return acc;
      },
      {}
    );

    updateRegistrationOpsConfig({
      registration_options: nextOptions,
      selected_types: nextSelectedTypes,
      product_linkage_by_type: nextProductLinkageByType,
      required_fields_by_type: nextRequiredFieldsByType,
      required_field_exceptions_by_type: {},
    });
  }, [updateRegistrationOpsConfig]);

  const createDefaultRegistrationOption = (
    registrationType: RegistrationTypeKey = "delegate"
  ): RegistrationOption => {
    const typeLabel =
      REGISTRATION_TYPES.find((type) => type.key === registrationType)?.label ?? registrationType;
    const fieldPolicy = REGISTRATION_FIELDS.reduce<
      Partial<Record<RegistrationFieldKey, RegistrationFieldState>>
    >((acc, field) => {
      acc[field.key] = "optional";
      return acc;
    }, {});
    fieldPolicy.display_name = "required";
    fieldPolicy.contact_email = "required";
    fieldPolicy.organization = "required";
    const nextId = `registration-option-${registrationOptionCounterRef.current}`;
    registrationOptionCounterRef.current += 1;
    const provisionalOption: RegistrationOption = {
      id: nextId,
      name: `${typeLabel} Option`,
      registration_type: registrationType,
      linked_product_ids: [],
      entitlements: { ...DEFAULT_OCCUPANCY_BY_TYPE[registrationType] },
      field_policy: fieldPolicy,
      form_items: [],
      rules: [],
      notes: "",
    };
    const formItems: RegistrationOptionFormItem[] = buildRegistrationFormTemplate(
      getOptionAvailableRegistrationFields(provisionalOption),
      fieldPolicy,
      nextId
    ).map((item) => {
      const itemId = `registration-form-item-${registrationOptionFormItemCounterRef.current}`;
      registrationOptionFormItemCounterRef.current += 1;
      return { ...item, id: itemId };
    });
    return {
      id: nextId,
      name: `${typeLabel} Option`,
      registration_type: registrationType,
      linked_product_ids: [],
      entitlements: { ...DEFAULT_OCCUPANCY_BY_TYPE[registrationType] },
      field_policy: fieldPolicy,
      form_items: formItems,
      rules: [],
      notes: "",
    };
  };

  const addRegistrationOption = (registrationType: RegistrationTypeKey = "delegate") => {
    setRegistrationOptions([...registrationOptions, createDefaultRegistrationOption(registrationType)]);
  };

  const createCustomFieldKey = () => {
    const key = `custom_${registrationCustomFieldCounterRef.current}`;
    registrationCustomFieldCounterRef.current += 1;
    return key;
  };

  const updateRegistrationOption = (optionId: string, patch: Partial<RegistrationOption>) => {
    setRegistrationOptions(
      registrationOptions.map((option) => {
        if (option.id !== optionId) return option;
        const next = { ...option, ...patch };
        if (patch.form_items) {
          const derivedPolicy: Partial<Record<RegistrationFieldKey, RegistrationFieldState>> = {};
          for (const item of patch.form_items) {
            if (item.type === "field" && item.field_key) {
              derivedPolicy[item.field_key] = item.state;
            }
          }
          next.field_policy = {
            ...next.field_policy,
            ...derivedPolicy,
          };
        }
        return next;
      })
    );
  };

  const removeRegistrationOption = (optionId: string) => {
    setRegistrationOptions(registrationOptions.filter((option) => option.id !== optionId));
  };

  const toggleRegistrationOptionProduct = (
    optionId: string,
    productId: string,
    enabled: boolean
  ) => {
    const option = registrationOptions.find((entry) => entry.id === optionId);
    if (!option) return;
    const next = new Set(option.linked_product_ids);
    if (enabled) next.add(productId);
    else next.delete(productId);
    updateRegistrationOption(optionId, { linked_product_ids: Array.from(next) });
  };

  const addRegistrationOptionCustomQuestionItem = (option: RegistrationOption) => {
    const itemId = `registration-form-item-${registrationOptionFormItemCounterRef.current}`;
    registrationOptionFormItemCounterRef.current += 1;
    const customKey = createCustomFieldKey();
    updateRegistrationOption(option.id, {
      form_items: [
        ...option.form_items,
        {
          id: itemId,
          type: "custom",
          field_key: null,
          label: "Custom question",
          state: "optional",
          custom_key: customKey,
          custom_input_type: "text",
          custom_options: [],
        },
      ],
    });
  };

  const addRegistrationOptionFieldItem = (option: RegistrationOption) => {
    const takenFieldKeys = new Set(
      option.form_items
        .filter((item) => item.type === "field" && Boolean(item.field_key))
        .map((item) => item.field_key as RegistrationFieldKey)
    );
    const optionAvailableRegistrationFields = getOptionAvailableRegistrationFields(option);
    const nextField = optionAvailableRegistrationFields.find((field) => !takenFieldKeys.has(field.key));
    if (!nextField) {
      return;
    }
    const itemId = `registration-form-item-${registrationOptionFormItemCounterRef.current}`;
    registrationOptionFormItemCounterRef.current += 1;
    updateRegistrationOption(option.id, {
      form_items: [
        ...option.form_items,
        {
          id: itemId,
          type: "field",
          field_key: nextField.key,
          label: nextField.label,
          state: "optional",
          custom_input_type: undefined,
          custom_options: [],
        },
      ],
    });
  };

  const addRegistrationOptionBreakItem = (option: RegistrationOption) => {
    const itemId = `registration-form-item-${registrationOptionFormItemCounterRef.current}`;
    registrationOptionFormItemCounterRef.current += 1;
    updateRegistrationOption(option.id, {
      form_items: [
        ...option.form_items,
        {
          id: itemId,
          type: "break",
          field_key: null,
          label: "Section break",
          state: "optional",
        },
      ],
    });
  };

  const addRegistrationOptionTitleItem = (option: RegistrationOption) => {
    const itemId = `registration-form-item-${registrationOptionFormItemCounterRef.current}`;
    registrationOptionFormItemCounterRef.current += 1;
    updateRegistrationOption(option.id, {
      form_items: [
        ...option.form_items,
        {
          id: itemId,
          type: "title",
          field_key: null,
          label: "Section title",
          state: "optional",
        },
      ],
    });
  };

  const updateRegistrationOptionFormItem = (
    option: RegistrationOption,
    itemId: string,
    patch: Partial<RegistrationOptionFormItem>
  ) => {
    updateRegistrationOption(option.id, {
      form_items: option.form_items.map((item) =>
        item.id === itemId ? { ...item, ...patch } : item
      ),
    });
  };

  const removeRegistrationOptionFormItem = (option: RegistrationOption, itemId: string) => {
    updateRegistrationOption(option.id, {
      form_items: option.form_items.filter((item) => item.id !== itemId),
    });
  };

  const reorderRegistrationOptionFormItem = (
    option: RegistrationOption,
    fromItemId: string,
    toItemId: string
  ) => {
    if (fromItemId === toItemId) return;
    const fromIndex = option.form_items.findIndex((item) => item.id === fromItemId);
    const toIndex = option.form_items.findIndex((item) => item.id === toItemId);
    if (fromIndex < 0 || toIndex < 0) return;
    const next = [...option.form_items];
    const [moved] = next.splice(fromIndex, 1);
    const insertIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
    next.splice(insertIndex, 0, moved);
    updateRegistrationOption(option.id, { form_items: next });
  };

  const setRegistrationOptionEntitlement = (
    optionId: string,
    moduleKey: OccupancyModuleKey,
    mode: OccupancyMode
  ) => {
    const option = registrationOptions.find((entry) => entry.id === optionId);
    if (!option) return;
    updateRegistrationOption(optionId, {
      entitlements: {
        ...option.entitlements,
        [moduleKey]: mode,
      },
    });
  };

  const parseLinkedProductIds = useCallback((type: RegistrationTypeKey): string[] => {
    const raw = productLinkageByType[type];
    if (Array.isArray(raw)) {
      return uniqueStrings(raw.filter((value): value is string => typeof value === "string"));
    }
    if (typeof raw === "string" && raw.trim()) {
      const byId = new Set(initialProducts.map((product) => product.id));
      const bySlug = new Map(initialProducts.map((product) => [product.slug, product.id] as const));
      return uniqueStrings(
        raw
          .split(",")
          .map((token) => token.trim())
          .filter(Boolean)
          .map((token) => (byId.has(token) ? token : bySlug.get(token) ?? token))
      );
    }
    return [];
  }, [initialProducts, productLinkageByType]);

  const setLinkedProductIds = (type: RegistrationTypeKey, productIds: string[]) => {
    updateRegistrationOpsConfig({
      product_linkage_by_type: {
        ...(productLinkageByType as Record<string, unknown>),
        [type]: uniqueStrings(productIds),
      },
    });
  };

  const toggleLinkedProduct = (type: RegistrationTypeKey, productId: string, enabled: boolean) => {
    const next = new Set(parseLinkedProductIds(type));
    if (enabled) next.add(productId);
    else next.delete(productId);
    setLinkedProductIds(type, Array.from(next));
  };

  const setTravelSourceDraftProduct = (type: RegistrationTypeKey, productId: string) => {
    setTravelSourceDraftByType((prev) => ({ ...prev, [type]: productId }));
  };

  const addTravelSourceProduct = (type: RegistrationTypeKey) => {
    const candidate = travelSourceDraftByType[type];
    if (!candidate) return;
    if (parseLinkedProductIds(type).includes(candidate)) return;
    toggleLinkedProduct(type, candidate, true);
    setTravelSourceDraftByType((prev) => ({ ...prev, [type]: "" }));
  };

  const createDefaultAudienceList = (name = "New Audience List"): AudienceListRule => {
    const id = `audience-list-${audienceListCounterRef.current}`;
    audienceListCounterRef.current += 1;
    return {
      id,
      name,
      enabled: true,
      registration_types: [],
      registration_statuses: [...DEFAULT_REGISTRATION_STATUSES],
      requires_travel_consent: null,
      requires_checkin: null,
      occupancy_module: null,
      linked_product_ids: [],
      notes: "",
    };
  };

  const setAudienceLists = (next: AudienceListRule[]) => {
    updateCommunicationsConfig({ audience_lists: next });
  };

  const addAudienceList = () => {
    setAudienceLists([...audienceLists, createDefaultAudienceList()]);
  };

  const removeAudienceList = (listId: string) => {
    setAudienceLists(audienceLists.filter((list) => list.id !== listId));
  };

  const updateAudienceList = (listId: string, patch: Partial<AudienceListRule>) => {
    setAudienceLists(audienceLists.map((list) => (list.id === listId ? { ...list, ...patch } : list)));
  };

  const toggleAudienceListRegistrationType = (
    listId: string,
    registrationType: RegistrationTypeKey,
    enabled: boolean
  ) => {
    const list = audienceLists.find((entry) => entry.id === listId);
    if (!list) return;
    const next = new Set(list.registration_types);
    if (enabled) next.add(registrationType);
    else next.delete(registrationType);
    updateAudienceList(listId, { registration_types: Array.from(next) });
  };

  const toggleAudienceListStatus = (
    listId: string,
    status: RegistrationLifecycleStage,
    enabled: boolean
  ) => {
    const list = audienceLists.find((entry) => entry.id === listId);
    if (!list) return;
    const next = new Set(list.registration_statuses);
    if (enabled) next.add(status);
    else next.delete(status);
    updateAudienceList(listId, { registration_statuses: Array.from(next) });
  };

  const toggleAudienceListLinkedProduct = (listId: string, productId: string, enabled: boolean) => {
    const list = audienceLists.find((entry) => entry.id === listId);
    if (!list) return;
    const next = new Set(list.linked_product_ids);
    if (enabled) next.add(productId);
    else next.delete(productId);
    updateAudienceList(listId, { linked_product_ids: Array.from(next) });
  };

  const seedStandardAudienceLists = () => {
    const seeded: AudienceListRule[] = [
      {
        ...createDefaultAudienceList("Delegates (Approved + Submitted)"),
        registration_types: ["delegate"],
      },
      {
        ...createDefaultAudienceList("Exhibitors (Approved + Submitted)"),
        registration_types: ["exhibitor"],
      },
      {
        ...createDefaultAudienceList("Speakers"),
        registration_types: ["speaker"],
      },
      {
        ...createDefaultAudienceList("Travel Missing Consent"),
        registration_types: ["delegate", "exhibitor", "speaker", "observer"],
        requires_travel_consent: false,
      },
      {
        ...createDefaultAudienceList("Checked-In Attendees"),
        registration_types: ["delegate", "exhibitor", "speaker", "observer", "staff"],
        requires_checkin: true,
      },
    ];
    setAudienceLists(seeded);
  };

  const createDefaultSponsorDeliverable = (title = "Sponsor Deliverable"): SponsorDeliverable => {
    const id = `sponsor-deliverable-${sponsorDeliverableCounterRef.current}`;
    sponsorDeliverableCounterRef.current += 1;
    return {
      id,
      title,
      module_context: "custom",
      due_date: "",
      owner: "",
      status: "planned",
      notes: "",
    };
  };

  const createDefaultSponsorRecord = (name = "New Sponsor"): SponsorOpsRecord => {
    const id = `sponsor-record-${sponsorRecordCounterRef.current}`;
    sponsorRecordCounterRef.current += 1;
    return {
      id,
      sponsor_name: name,
      tier: "",
      linked_product_id: null,
      linked_org_id: null,
      primary_contact_name: "",
      primary_contact_email: "",
      activation_modules: [],
      deliverables: [],
      notes: "",
    };
  };

  const setSponsorRecords = (nextRecords: SponsorOpsRecord[]) => {
    updateModuleConfig("sponsorship_ops", { sponsor_records: nextRecords });
  };

  const addSponsorRecord = () => {
    setSponsorRecords([...sponsorRecords, createDefaultSponsorRecord()]);
  };

  const removeSponsorRecord = (recordId: string) => {
    setSponsorRecords(sponsorRecords.filter((record) => record.id !== recordId));
  };

  const updateSponsorRecord = (recordId: string, patch: Partial<SponsorOpsRecord>) => {
    setSponsorRecords(
      sponsorRecords.map((record) => (record.id === recordId ? { ...record, ...patch } : record))
    );
  };

  const toggleSponsorActivationModule = (
    recordId: string,
    moduleKey: OccupancyModuleKey | "communications",
    enabled: boolean
  ) => {
    const record = sponsorRecords.find((entry) => entry.id === recordId);
    if (!record) return;
    const next = new Set(record.activation_modules);
    if (enabled) next.add(moduleKey);
    else next.delete(moduleKey);
    updateSponsorRecord(recordId, { activation_modules: Array.from(next) });
  };

  const addSponsorDeliverable = (recordId: string, title?: string) => {
    const record = sponsorRecords.find((entry) => entry.id === recordId);
    if (!record) return;
    updateSponsorRecord(recordId, {
      deliverables: [...record.deliverables, createDefaultSponsorDeliverable(title)],
    });
  };

  const removeSponsorDeliverable = (recordId: string, deliverableId: string) => {
    const record = sponsorRecords.find((entry) => entry.id === recordId);
    if (!record) return;
    updateSponsorRecord(recordId, {
      deliverables: record.deliverables.filter((item) => item.id !== deliverableId),
    });
  };

  const updateSponsorDeliverable = (
    recordId: string,
    deliverableId: string,
    patch: Partial<SponsorDeliverable>
  ) => {
    const record = sponsorRecords.find((entry) => entry.id === recordId);
    if (!record) return;
    updateSponsorRecord(recordId, {
      deliverables: record.deliverables.map((item) =>
        item.id === deliverableId ? { ...item, ...patch } : item
      ),
    });
  };

  const seedSponsorsFromOffsite = () => {
    const sponsoredEvents = offsiteEvents.filter(
      (event) => event.is_sponsored && event.sponsor_name.trim().length > 0
    );
    if (sponsoredEvents.length === 0) return;
    const byName = new Map<string, SponsorOpsRecord>();
    for (const existing of sponsorRecords) {
      byName.set(existing.sponsor_name.trim().toLowerCase(), existing);
    }

    const nextRecords = [...sponsorRecords];
    for (const event of sponsoredEvents) {
      const key = event.sponsor_name.trim().toLowerCase();
      if (!key) continue;
      const deliverableTitle = `Offsite Activation: ${event.title} (${event.date})`;
      const existing = byName.get(key);
      if (existing) {
        const already = existing.deliverables.some((item) => item.title === deliverableTitle);
        if (!already) {
          existing.deliverables = [
            ...existing.deliverables,
            {
              ...createDefaultSponsorDeliverable(deliverableTitle),
              module_context: "offsite",
              notes: event.sponsorship_activation_notes ?? "",
            },
          ];
          existing.activation_modules = Array.from(
            new Set([...(existing.activation_modules ?? []), "offsite"])
          );
        }
        continue;
      }
      const created = createDefaultSponsorRecord(event.sponsor_name);
      created.tier = event.sponsor_tier || "";
      created.activation_modules = ["offsite"];
      created.deliverables = [
        {
          ...createDefaultSponsorDeliverable(deliverableTitle),
          module_context: "offsite",
          notes: event.sponsorship_activation_notes ?? "",
        },
      ];
      nextRecords.push(created);
      byName.set(key, created);
    }
    setSponsorRecords(nextRecords);
  };

  const createDefaultBoothPreset = (tier = "Standard"): BoothInclusionPreset => ({
    tier,
    tables: 1,
    chairs: 2,
    carpet: false,
    lighting: false,
    power: false,
    internet: false,
    linked_product_id: null,
    notes: "",
  });

  const createDefaultLogisticsTask = (title = "Logistics Task"): LogisticsTask => {
    const id = `logistics-task-${logisticsTaskCounterRef.current}`;
    logisticsTaskCounterRef.current += 1;
    return {
      id,
      title,
      category: "custom",
      owner: "",
      due_date: "",
      status: "planned",
      blocker_reason: "",
      notes: "",
    };
  };

  const updateLogisticsConfig = (patch: Record<string, unknown>) => {
    updateModuleConfig("logistics", patch);
  };

  const updateLogisticsWindow = (
    windowKey: "move_in" | "move_out",
    edge: "start" | "end",
    value: string
  ) => {
    const startKey = `${windowKey}_start`;
    const endKey = `${windowKey}_end`;
    const currentStart = String(logisticsConfig[startKey] ?? "");
    const currentEnd = String(logisticsConfig[endKey] ?? "");
    const nextStart = edge === "start" ? value : currentStart;
    const nextEnd = edge === "end" ? value : currentEnd;
    const patch: Record<string, unknown> = {
      [startKey]: nextStart,
      [endKey]: nextEnd,
    };

    if (edge === "start" && nextStart) {
      if (!nextEnd) {
        patch[endKey] = shiftDateTimeLocal(nextStart, 2);
      } else {
        const startAt = parseLocalDateTime(nextStart)?.valueOf() ?? Number.NaN;
        const endAt = parseLocalDateTime(nextEnd)?.valueOf() ?? Number.NaN;
        if (Number.isFinite(startAt) && Number.isFinite(endAt) && endAt <= startAt) {
          patch[endKey] = shiftDateTimeLocal(nextStart, 2);
        }
      }
    }

    if (edge === "end" && nextEnd) {
      if (!nextStart) {
        patch[startKey] = shiftDateTimeLocal(nextEnd, -2);
      }
    }

    const resolvedStart = String(patch[startKey] ?? "");
    const resolvedEnd = String(patch[endKey] ?? "");
    patch[`${windowKey}_enabled`] = Boolean(resolvedStart || resolvedEnd);

    updateLogisticsConfig(patch);
  };

  const updateLogisticsService = (
    serviceKey: LogisticsService["key"],
    patch: Partial<LogisticsService>
  ) => {
    const next = logisticsServices.map((service) =>
      service.key === serviceKey ? { ...service, ...patch } : service
    );
    updateLogisticsConfig({ services: next });
  };

  const addBoothInclusionPreset = () => {
    if (!modules.trade_show.enabled) return;
    updateLogisticsConfig({
      booth_inclusion_presets: [...boothInclusionPresets, createDefaultBoothPreset()],
    });
  };

  const updateBoothInclusionPreset = (index: number, patch: Partial<BoothInclusionPreset>) => {
    const next = boothInclusionPresets.map((preset, currentIndex) =>
      currentIndex === index ? { ...preset, ...patch } : preset
    );
    updateLogisticsConfig({ booth_inclusion_presets: next });
  };

  const removeBoothInclusionPreset = (index: number) => {
    const next = boothInclusionPresets.filter((_, currentIndex) => currentIndex !== index);
    updateLogisticsConfig({ booth_inclusion_presets: next });
  };

  useEffect(() => {
    if (modules.trade_show.enabled) return;
    const hasBoothData = boothInclusionPresets.length > 0;
    if (!hasBoothData) return;
    updateModuleConfig("logistics", {
      booth_inclusion_presets: [],
    });
  }, [boothInclusionPresets.length, modules.trade_show.enabled, updateModuleConfig]);

  const addLogisticsTask = () => {
    updateLogisticsConfig({ tasks: [...logisticsTasks, createDefaultLogisticsTask()] });
  };

  const updateLogisticsTask = (taskId: string, patch: Partial<LogisticsTask>) => {
    const next = logisticsTasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task));
    updateLogisticsConfig({ tasks: next });
  };

  const removeLogisticsTask = (taskId: string) => {
    updateLogisticsConfig({ tasks: logisticsTasks.filter((task) => task.id !== taskId) });
  };

  const applyOffsitePlaceSelection = (
    eventId: string,
    patch: Pick<OffsiteEventDraft, "google_place_id" | "venue_name" | "venue_address">
  ) => {
    setModules((prev) => {
      const offsite = prev.offsite;
      const config = (offsite.config_json ?? {}) as Record<string, unknown>;
      const events = Array.isArray(config.offsite_events)
        ? (config.offsite_events as OffsiteEventDraft[])
        : [];
      const nextEvents = events.map((event) => (event.id === eventId ? { ...event, ...patch } : event));
      return {
        ...prev,
        offsite: {
          ...offsite,
          config_json: {
            ...config,
            offsite_events: nextEvents,
          },
        },
      };
    });
  };

  useEffect(() => {
    if (!googleMapsApiKey) return;

    let isCancelled = false;
    const init = async () => {
      try {
        await loadGooglePlacesScript(googleMapsApiKey);
        if (isCancelled) return;
        setPlacesReady(true);
        setPlacesRuntimeError(null);
      } catch (error) {
        if (isCancelled) return;
        setPlacesReady(false);
        setPlacesRuntimeError(
          error instanceof Error ? error.message : "Google Places unavailable."
        );
      }
    };
    void init();

    return () => {
      isCancelled = true;
    };
  }, [googleMapsApiKey]);

  useEffect(() => {
    if (!placesReady || !window.google?.maps?.places?.Autocomplete) return;

    const hotelsForPlaces = Array.isArray(travelAccommodationConfig.hotels)
      ? (travelAccommodationConfig.hotels as Array<Partial<TravelHotelPolicy>>).map(
          (entry, index) => ({
            id:
              typeof entry.id === "string" && entry.id.trim()
                ? entry.id
                : `hotel-${index + 1}`,
            name: typeof entry.name === "string" ? entry.name : "",
            google_place_id:
              typeof entry.google_place_id === "string" ? entry.google_place_id : "",
            address: typeof entry.address === "string" ? entry.address : "",
            nightly_rate: Math.max(0, Number(entry.nightly_rate ?? 0)),
            currency:
              typeof entry.currency === "string" && entry.currency.trim()
                ? entry.currency.toUpperCase().slice(0, 3)
                : "CAD",
            contact_name: typeof entry.contact_name === "string" ? entry.contact_name : "",
            contact_email: typeof entry.contact_email === "string" ? entry.contact_email : "",
            contact_phone: typeof entry.contact_phone === "string" ? entry.contact_phone : "",
            share_contact_with_attendees: Boolean(entry.share_contact_with_attendees),
            room_block_url:
              typeof entry.room_block_url === "string" ? entry.room_block_url : "",
            room_block_code:
              typeof entry.room_block_code === "string" ? entry.room_block_code : "",
            notes: typeof entry.notes === "string" ? entry.notes : "",
          })
        )
      : [];

    const hotelIds = new Set(hotelsForPlaces.map((hotel) => hotel.id));
    for (const hotel of hotelsForPlaces) {
      if (hotelAutocompleteRefs.current[hotel.id]) continue;
      const input = hotelPlaceInputRefs.current[hotel.id];
      if (!input) continue;
      const autocomplete = new window.google.maps.places.Autocomplete(input, {
        types: ["lodging"],
        fields: ["place_id", "name", "formatted_address"],
        componentRestrictions: { country: "ca" },
      });
      const listener = autocomplete.addListener("place_changed", () => {
        const place = autocomplete.getPlace();
        updateTravelAccommodationConfig({
          hotels: hotelsForPlaces.map((candidate) =>
            candidate.id === hotel.id
              ? {
                  ...candidate,
                  google_place_id: place.place_id ?? "",
                  name: place.name ?? candidate.name,
                  address: place.formatted_address ?? "",
                }
              : candidate
          ),
        });
      });
      hotelAutocompleteRefs.current[hotel.id] = listener;
    }
    for (const [hotelId, listener] of Object.entries(hotelAutocompleteRefs.current)) {
      if (hotelIds.has(hotelId)) continue;
      if (listener?.remove) listener.remove();
      delete hotelAutocompleteRefs.current[hotelId];
      delete hotelPlaceInputRefs.current[hotelId];
    }

    const activeIds = new Set(offsiteEvents.map((event) => event.id));
    for (const event of offsiteEvents) {
      const eventId = event.id;
      if (offsiteAutocompleteRefs.current[eventId]) continue;
      const input = offsiteVenueInputRefs.current[eventId];
      if (!input) continue;

      const autocomplete = new window.google.maps.places.Autocomplete(input, {
        types: ["establishment"],
        fields: ["place_id", "name", "formatted_address"],
        componentRestrictions: { country: "ca" },
      });

      const listener = autocomplete.addListener("place_changed", () => {
        const place = autocomplete.getPlace();
        applyOffsitePlaceSelection(eventId, {
          google_place_id: place.place_id ?? "",
          venue_name: place.name ?? "",
          venue_address: place.formatted_address ?? "",
        });
      });

      offsiteAutocompleteRefs.current[eventId] = listener;
    }

    for (const [eventId, listener] of Object.entries(offsiteAutocompleteRefs.current)) {
      if (activeIds.has(eventId)) continue;
      if (listener?.remove) listener.remove();
      delete offsiteAutocompleteRefs.current[eventId];
      delete offsiteVenueInputRefs.current[eventId];
    }
  }, [
    offsiteEvents,
    placesReady,
    travelAccommodationConfig.hotels,
    updateTravelAccommodationConfig,
  ]);

  useEffect(
    () => () => {
      for (const listener of Object.values(hotelAutocompleteRefs.current)) {
        if (listener?.remove) listener.remove();
      }
      hotelAutocompleteRefs.current = {};
      for (const listener of Object.values(offsiteAutocompleteRefs.current)) {
        if (listener?.remove) listener.remove();
      }
      offsiteAutocompleteRefs.current = {};
    },
    []
  );

  const applyMeetingProductSuggestion = async () => {
    setSaveError(null);
    setMeetingProductResult(null);
    const result = await createSuggestedMeetingProducts(conferenceId);
    if (!result.success || !result.data) {
      setSaveError(result.error ?? "Failed to create suggested meeting products.");
      return;
    }
    setMeetingProductResult(
      `Suggested products updated. Created: ${result.data.created.join(", ") || "none"}; Updated: ${
        result.data.updated.join(", ") || "none"
      }; Skipped: ${result.data.skipped.join(", ") || "none"}; Blocked: ${
        result.data.blocked.join(", ") || "none"
      }; Capacity basis: ${result.data.totalMeetingCells} meeting cells.`
    );
  };

  const applyTradeShowProductSuggestion = async () => {
    setSaveError(null);
    setTradeShowProductResult(null);
    const result = await createSuggestedTradeShowProducts(conferenceId);
    if (!result.success || !result.data) {
      setSaveError(result.error ?? "Failed to create suggested trade show products.");
      return;
    }
    setTradeShowProductResult(
      `Suggested products updated. Created: ${result.data.created.join(", ") || "none"}; Updated: ${
        result.data.updated.join(", ") || "none"
      }; Skipped: ${result.data.skipped.join(", ") || "none"}; Blocked: ${
        result.data.blocked.join(", ") || "none"
      }; Capacity basis: ${result.data.totalBoothInventory} booth inventory.`
    );
  };

  const applyEducationProductSuggestion = async () => {
    setSaveError(null);
    setEducationProductResult(null);
    const result = await createSuggestedEducationProducts(conferenceId);
    if (!result.success || !result.data) {
      setSaveError(result.error ?? "Failed to create suggested education products.");
      return;
    }
    setEducationProductResult(
      `Suggested products updated. Created: ${result.data.created.join(", ") || "none"}; Updated: ${
        result.data.updated.join(", ") || "none"
      }; Skipped: ${result.data.skipped.join(", ") || "none"}; Blocked: ${
        result.data.blocked.join(", ") || "none"
      }; Capacity basis: ${result.data.totalEducationCapacity} education seats.`
    );
  };

  const applyMealProductSuggestion = async () => {
    setSaveError(null);
    setMealProductResult(null);
    const result = await createSuggestedMealProducts(conferenceId);
    if (!result.success || !result.data) {
      setSaveError(result.error ?? "Failed to create suggested meal products.");
      return;
    }
    setMealProductResult(
      `Suggested products updated. Created: ${result.data.created.join(", ") || "none"}; Updated: ${
        result.data.updated.join(", ") || "none"
      }; Skipped: ${result.data.skipped.join(", ") || "none"}; Blocked: ${
        result.data.blocked.join(", ") || "none"
      }; Capacity basis: ${result.data.totalMealEntitlements} meal entitlements.`
    );
  };

  const applyOffsiteProductSuggestion = async () => {
    setSaveError(null);
    setOffsiteProductResult(null);
    const result = await createSuggestedOffsiteProducts(conferenceId);
    if (!result.success || !result.data) {
      setSaveError(result.error ?? "Failed to create suggested offsite products.");
      return;
    }
    setOffsiteProductResult(
      `Suggested products updated. Created: ${result.data.created.join(", ") || "none"}; Updated: ${
        result.data.updated.join(", ") || "none"
      }; Skipped: ${result.data.skipped.join(", ") || "none"}; Blocked: ${
        result.data.blocked.join(", ") || "none"
      }; Capacity basis: ${result.data.totalOffsiteCapacity} offsite seats.`
    );
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <p className="font-semibold">Schedule Design Wizard</p>
        <p className="mt-1">
          Step 1 selects which conference modules are in scope. Every subsequent step is driven by
          that selection.
        </p>
      </div>

      {saveError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{saveError}</div>
      )}
      {saveSuccess && (
        <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          {saveSuccess}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {[
          { id: 1, label: "Scope" },
          { id: 2, label: "Module Setup" },
          { id: 3, label: "Review" },
        ].map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setStep(s.id)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              step === s.id
                ? "bg-[#EE2A2E] text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
            aria-current={step === s.id ? "step" : undefined}
          >
            {s.id}. {s.label}
          </button>
        ))}
      </div>

      {step === 1 && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-base font-semibold text-gray-900">What is included in this conference?</h2>
            <button
              type="button"
              onClick={saveCurrentSetup}
              disabled={isSaving}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              {isSaving ? "Saving..." : "Save Scope"}
            </button>
          </div>
          <p className="mt-1 text-sm text-gray-600">
            These choices determine which setup wizards appear next.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {MODULES.map((moduleDef) => (
              <label key={moduleDef.key} className="rounded-md border border-gray-200 p-3 text-sm">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={
                      moduleDef.alwaysIncluded ? true : modules[moduleDef.key].enabled
                    }
                    onChange={(e) => updateModuleEnabled(moduleDef.key, e.target.checked)}
                    disabled={moduleDef.alwaysIncluded}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="font-medium text-gray-900">
                      {moduleDef.label}
                      {moduleDef.alwaysIncluded && (
                        <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">
                          always included
                        </span>
                      )}
                      {moduleDef.v12Stub && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                          v1.2 stub
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-gray-600">{moduleDef.description}</p>
                  </div>
                </div>
              </label>
            ))}
          </div>

          <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <h3 className="text-sm font-semibold text-gray-900">Conference Day Profiles</h3>
            <p className="mt-1 text-xs text-gray-600">
              Set each day type once. Modules inherit this automatically.
            </p>
            {conferenceDates.length === 0 ? (
              <p className="mt-2 text-xs text-amber-700">
                Set conference start/end dates in Details to define day profiles.
              </p>
            ) : (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {conferenceDates.map((date) => (
                  <label key={`profile-${date}`} className="block text-xs text-gray-700">
                    {formatDateLabel(date)}
                    <select
                      value={getDayProfile(date)}
                      onChange={(e) => setConferenceDayProfile(date, e.target.value as ConferenceDayProfile)}
                      className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                    >
                      <option value="full_day">Full day</option>
                      <option value="half_day">Half day</option>
                      <option value="travel">Travel day</option>
                      <option value="other">Other day</option>
                    </select>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-gray-900">Module Navigation</h3>
            <p className="mt-1 text-xs text-gray-600">
              Jump directly to any selected module setup page.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {selectedModuleDefs.map((moduleDef, index) => (
                <button
                  key={moduleDef.key}
                  type="button"
                  onClick={() => setModuleStepIndex(index)}
                  className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                    index === moduleStepIndex
                      ? "border-[#EE2A2E] bg-[#EE2A2E] text-white"
                      : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                  aria-current={index === moduleStepIndex ? "step" : undefined}
                >
                  {index + 1}. {moduleDef.label}
                </button>
              ))}
            </div>
          </div>

          {moduleAccessMappingTargets.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <h3 className="text-sm font-semibold text-gray-900">Default Purchase Product Mapping</h3>
              <p className="mt-1 text-xs text-gray-600">
                Optional defaults for modules with purchase-required access paths. Registration-path product links remain in Registration Ops.
              </p>
              {initialProducts.length === 0 ? (
                <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  No products exist yet. Create products first, then map defaults here.
                </p>
              ) : (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {moduleAccessMappingTargets.map((moduleDef) => {
                    const selectedProduct = moduleDef.productId
                      ? initialProducts.find((product) => product.id === moduleDef.productId)
                      : null;
                    return (
                      <div
                        key={`module-access-product-${moduleDef.key}`}
                        className="rounded-md border border-gray-200 p-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium text-gray-900">{moduleDef.label}</p>
                          <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                            purchase paths present
                          </span>
                        </div>
                        <label className="mt-2 block text-xs text-gray-700">
                          Default purchase product
                          <select
                            value={moduleDef.productId}
                            onChange={(e) => setModuleAccessProduct(moduleDef.key, e.target.value)}
                            className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                          >
                            <option value="">Not mapped</option>
                            {initialProducts.map((product) => (
                              <option key={`${moduleDef.key}-${product.id}`} value={product.id}>
                                {product.name} ({product.slug}){product.is_active ? "" : " [inactive]"}
                              </option>
                            ))}
                          </select>
                        </label>
                        <p className="mt-2 text-[11px] text-gray-600">
                          {selectedProduct
                            ? `Mapped to ${selectedProduct.name}.`
                            : "No module access product mapped yet."}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
              {modules.offsite.enabled && (
                <p className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                  Offsite uses event-level product links in Offsite Setup, not a module-level access product.
                </p>
              )}
            </div>
          )}

          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-base font-semibold text-gray-900">Module-Specific Setup</h2>
              <button
                type="button"
                onClick={saveCurrentSetup}
                disabled={isSaving}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                {isSaving
                  ? "Saving..."
                  : currentModuleDef
                    ? `Save ${currentModuleDef.label}`
                    : "Save Module"}
              </button>
            </div>
            <p className="mt-1 text-sm text-gray-600">
              Configure one selected module at a time.
            </p>
            {currentModuleDef && (
              <p className="mt-2 text-xs text-gray-500">
                Module {moduleStepIndex + 1} of {selectedModuleDefs.length}:{" "}
                <span className="font-medium text-gray-700">{currentModuleDef.label}</span>
              </p>
            )}
          </div>

          {currentModuleDef?.key === "meetings" &&
            (modules.meetings.enabled || currentModuleDef.alwaysIncluded) && (
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <h3 className="text-sm font-semibold text-gray-900">Meetings Setup</h3>
              <p className="mt-1 text-xs text-gray-600">
                Define meeting days, per-day volumes, constraints, and scheduling priorities.
              </p>

              <div className="mt-4 space-y-4">
                <div className="rounded-md border border-gray-100 p-3">
                  <p className="text-sm font-medium text-gray-900">Which days include meetings?</p>
                  {conferenceDates.length === 0 ? (
                    <p className="mt-2 text-xs text-amber-700">
                      Set conference start/end dates in Details to enable date-driven meeting day selection.
                    </p>
                  ) : (
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      {conferenceDates.map((date) => (
                        <label key={date} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={meetingDays.includes(date)}
                            onChange={(e) => toggleMeetingDay(date, e.target.checked)}
                          />
                          {formatDateLabel(date)}
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {meetingDays.length > 0 && (
                  <div className="rounded-md border border-gray-100 p-3">
                    <p className="text-sm font-medium text-gray-900">Meeting setup by day</p>
                    <p className="mt-1 text-xs text-gray-600">
                      Each day can be full-day, half-day, or custom with its own meeting count and time window.
                    </p>
                    <div className="mt-3 grid gap-3">
                      {meetingDays.map((date) => (
                        <div key={date} className="rounded-md border border-gray-200 p-3">
                          <p className="text-sm font-medium text-gray-900">{formatDateLabel(date)}</p>
                          <p className="mt-1 text-xs text-gray-600">
                            Day profile: <span className="font-medium">{getDayProfile(date).replace("_", " ")}</span>
                          </p>
                          <label className="mt-2 block text-xs text-gray-700">
                            Day type for meetings
                            <select
                              value={getEffectiveDayType(date, meetingDaySettings[date]?.day_type)}
                              onChange={(e) => {
                                const value = e.target.value as ModuleDayType;
                                if (value === getDayProfile(date)) {
                                  updateModuleDayTypeOverride("meetings", date, null);
                                  setDayTypePrompt(null);
                                  return;
                                }
                                setDayTypePrompt({ moduleKey: "meetings", date, nextValue: value });
                              }}
                              className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                            >
                              <option value={getDayProfile(date)}>
                                Inherit ({getDayProfile(date).replace("_", " ")})
                              </option>
                              <option value="full_day">Full day</option>
                              <option value="half_day">Half day</option>
                              <option value="travel">Travel day</option>
                              <option value="other">Other day</option>
                              <option value="custom">Custom</option>
                            </select>
                          </label>
                          {dayTypePrompt?.moduleKey === "meetings" && dayTypePrompt.date === date && (
                            <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                              <p>Apply this day-type change everywhere or only for Meetings?</p>
                              <div className="mt-2 flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const profileValue =
                                      dayTypePrompt.nextValue === "custom"
                                        ? "other"
                                        : (dayTypePrompt.nextValue as ConferenceDayProfile);
                                    setConferenceDayProfile(date, profileValue);
                                    updateModuleDayTypeOverride("meetings", date, null);
                                    setDayTypePrompt(null);
                                  }}
                                  className="rounded border border-amber-300 bg-white px-2 py-1"
                                >
                                  Apply to all modules
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    updateModuleDayTypeOverride("meetings", date, dayTypePrompt.nextValue);
                                    setDayTypePrompt(null);
                                  }}
                                  className="rounded border border-amber-300 bg-white px-2 py-1"
                                >
                                  Only Meetings
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDayTypePrompt(null)}
                                  className="rounded border border-amber-300 bg-white px-2 py-1"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                          <div className="mt-2 grid gap-3 md:grid-cols-3">
                            <label className="block text-xs text-gray-700">
                              Meetings that day
                              <input
                                type="number"
                                min={1}
                                value={Number(meetingDaySettings[date]?.meeting_count ?? 8)}
                                onChange={(e) =>
                                  updateMeetingDaySetting(date, {
                                    meeting_count: Number(e.target.value),
                                  })
                                }
                                className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                              />
                            </label>
                            <label className="block text-xs text-gray-700">
                              Slot duration (minutes)
                              <input
                                type="number"
                                min={5}
                                value={Number(
                                  meetingDaySettings[date]?.slot_duration_minutes ??
                                    meetingConfig.slot_duration_minutes ??
                                    params?.slot_duration_minutes ??
                                    15
                                )}
                                onChange={(e) =>
                                  updateMeetingDaySetting(date, {
                                    slot_duration_minutes: Number(e.target.value),
                                  })
                                }
                                className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                              />
                            </label>
                            <label className="block text-xs text-gray-700">
                              Meeting start
                              <input
                                type="time"
                                value={String(
                                  meetingDaySettings[date]?.start_time ??
                                    meetingConfig.meeting_start_time ??
                                    params?.meeting_start_time ??
                                    "09:00"
                                )}
                                onChange={(e) =>
                                  updateMeetingDaySetting(date, { start_time: e.target.value })
                                }
                                className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                              />
                            </label>
                            <label className="block text-xs text-gray-700">
                              Meeting end
                              <input
                                type="time"
                                value={String(
                                  meetingDaySettings[date]?.end_time ??
                                    meetingConfig.meeting_end_time ??
                                    params?.meeting_end_time ??
                                    "17:00"
                                )}
                                onChange={(e) =>
                                  updateMeetingDaySetting(date, { end_time: e.target.value })
                                }
                                className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                              />
                            </label>
                            <label className="block text-xs text-gray-700">
                              Time between meetings (minutes)
                              <input
                                type="number"
                                min={0}
                                value={Number(
                                  meetingDaySettings[date]?.buffer_minutes ??
                                    meetingConfig.meeting_buffer_minutes ??
                                    params?.slot_buffer_minutes ??
                                    0
                                )}
                                onChange={(e) =>
                                  updateMeetingDaySetting(date, {
                                    buffer_minutes: Number(e.target.value),
                                  })
                                }
                                className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                              />
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block text-sm text-gray-700">
                    How many meeting suites?
                    <input
                      type="number"
                      min={1}
                      value={Number(meetingConfig.meeting_suites ?? params?.total_meeting_suites ?? 1)}
                      onChange={(e) =>
                        updateModuleConfig("meetings", { meeting_suites: Number(e.target.value) })
                      }
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
                    />
                  </label>
                  <label className="block text-sm text-gray-700">
                    Target percent of exhibitors each delegate should meet
                    <div className="mt-1 flex items-center justify-between text-xs text-gray-600">
                      <span>0%</span>
                      <span className="font-semibold text-gray-800">
                        {Number(meetingConfig.target_exhibitor_coverage_percent ?? 80)}%
                      </span>
                      <span>100%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={Number(meetingConfig.target_exhibitor_coverage_percent ?? 80)}
                      onChange={(e) =>
                        updateModuleConfig("meetings", {
                          target_exhibitor_coverage_percent: Number(e.target.value),
                        })
                      }
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
                    />
                  </label>
                  <label className="block text-sm text-gray-700">
                    Minimum delegates in a meeting
                    <input
                      type="number"
                      min={1}
                      value={Number(meetingConfig.min_delegates_per_meeting ?? 1)}
                      onChange={(e) =>
                        updateModuleConfig("meetings", {
                          min_delegates_per_meeting: Number(e.target.value),
                        })
                      }
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
                    />
                  </label>
                  <label className="block text-sm text-gray-700">
                    Maximum delegates in a suite
                    <input
                      type="number"
                      min={1}
                      value={Number(meetingConfig.max_delegates_per_suite ?? 1)}
                      onChange={(e) =>
                        updateModuleConfig("meetings", {
                          max_delegates_per_suite: Number(e.target.value),
                        })
                      }
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
                    />
                  </label>
                </div>

                <div className="rounded-md border border-gray-100 p-3 text-xs text-gray-700">
                  Conference days for scheduler are derived from selected meeting days:{" "}
                  <span className="font-semibold">{meetingDays.length}</span>
                </div>
                <div className="rounded-md border border-gray-100 p-3">
                  <p className="text-sm font-medium text-gray-900">
                    Scheduling priorities (highest to lowest)
                  </p>
                  <div className="mt-2 space-y-2">
                    {schedulingPriorities.map((priority, index) => (
                      <div
                        key={priority}
                        className="flex items-center justify-between rounded border border-gray-200 px-3 py-2"
                      >
                        <span className="text-sm text-gray-800">
                          {index + 1}. {priority}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => movePriority(index, -1)}
                            disabled={index === 0}
                            className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-700 disabled:opacity-50"
                          >
                            Up
                          </button>
                          <button
                            type="button"
                            onClick={() => movePriority(index, 1)}
                            disabled={index === schedulingPriorities.length - 1}
                            className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-700 disabled:opacity-50"
                          >
                            Down
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-md border border-green-200 bg-green-50 p-3">
                  <p className="text-sm font-medium text-green-900">Suggested products</p>
                  <p className="mt-1 text-xs text-green-800">
                    Use meeting setup values to suggest delegate/exhibitor meeting access products and capacities.
                  </p>
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={applyMeetingProductSuggestion}
                      className="rounded-md bg-[#EE2A2E] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#b50001]"
                    >
                      Create/Update Suggested Meeting Products
                    </button>
                  </div>
                  {meetingProductResult && (
                    <p className="mt-2 text-xs text-green-800">{meetingProductResult}</p>
                  )}
                </div>

              </div>
            </div>
          )}

          {currentModuleDef?.key === "trade_show" && modules.trade_show.enabled && (
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-sm font-semibold text-gray-900">Trade Show Setup</p>
              <p className="mt-1 text-xs text-gray-600">
                Configure trade show days with per-day floor windows and baseline operating assumptions.
              </p>

              <div className="mt-4 space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={Boolean(tradeShowConfig.include_move_in)}
                      onChange={(e) =>
                        updateModuleConfig("trade_show", { include_move_in: e.target.checked })
                      }
                    />
                    Include exhibitor move-in block
                  </label>
                  <label className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={Boolean(tradeShowConfig.include_move_out)}
                      onChange={(e) =>
                        updateModuleConfig("trade_show", { include_move_out: e.target.checked })
                      }
                    />
                    Include exhibitor move-out block
                  </label>
                </div>
                <div className="rounded-md border border-gray-100 p-3">
                  <p className="text-sm font-medium text-gray-900">Which days include trade show activity?</p>
                  {conferenceDates.length === 0 ? (
                    <p className="mt-2 text-xs text-amber-700">
                      Set conference start/end dates in Details to enable date-driven trade show day selection.
                    </p>
                  ) : (
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      {conferenceDates.map((date) => (
                        <label key={date} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={tradeShowDays.includes(date)}
                            onChange={(e) => toggleTradeShowDay(date, e.target.checked)}
                          />
                          {formatDateLabel(date)}
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {tradeShowDays.length > 0 && (
                  <div className="rounded-md border border-gray-100 p-3">
                    <p className="text-sm font-medium text-gray-900">Trade show setup by day</p>
                    <div className="mt-3 grid gap-3">
                      {tradeShowDays.map((date) => (
                        <div key={date} className="rounded-md border border-gray-200 p-3">
                          <p className="text-sm font-medium text-gray-900">{formatDateLabel(date)}</p>
                          <p className="mt-1 text-xs text-gray-600">
                            Day profile: <span className="font-medium">{getDayProfile(date).replace("_", " ")}</span>
                          </p>
                          <label className="mt-2 block text-xs text-gray-700">
                            Day type for trade show
                            <select
                              value={getEffectiveDayType(date, tradeShowDaySettings[date]?.day_type)}
                              onChange={(e) => {
                                const value = e.target.value as ModuleDayType;
                                if (value === getDayProfile(date)) {
                                  updateModuleDayTypeOverride("trade_show", date, null);
                                  setDayTypePrompt(null);
                                  return;
                                }
                                setDayTypePrompt({ moduleKey: "trade_show", date, nextValue: value });
                              }}
                              className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                            >
                              <option value={getDayProfile(date)}>
                                Inherit ({getDayProfile(date).replace("_", " ")})
                              </option>
                              <option value="full_day">Full day</option>
                              <option value="half_day">Half day</option>
                              <option value="travel">Travel day</option>
                              <option value="other">Other day</option>
                              <option value="custom">Custom</option>
                            </select>
                          </label>
                          {dayTypePrompt?.moduleKey === "trade_show" && dayTypePrompt.date === date && (
                            <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                              <p>Apply this day-type change everywhere or only for Trade Show?</p>
                              <div className="mt-2 flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const profileValue =
                                      dayTypePrompt.nextValue === "custom"
                                        ? "other"
                                        : (dayTypePrompt.nextValue as ConferenceDayProfile);
                                    setConferenceDayProfile(date, profileValue);
                                    updateModuleDayTypeOverride("trade_show", date, null);
                                    setDayTypePrompt(null);
                                  }}
                                  className="rounded border border-amber-300 bg-white px-2 py-1"
                                >
                                  Apply to all modules
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    updateModuleDayTypeOverride("trade_show", date, dayTypePrompt.nextValue);
                                    setDayTypePrompt(null);
                                  }}
                                  className="rounded border border-amber-300 bg-white px-2 py-1"
                                >
                                  Only Trade Show
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDayTypePrompt(null)}
                                  className="rounded border border-amber-300 bg-white px-2 py-1"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                          <div className="mt-2 grid gap-3 md:grid-cols-3">
                            <label className="block text-xs text-gray-700">
                              Floor opens
                              <input
                                type="time"
                                value={String(tradeShowDaySettings[date]?.open_time ?? "09:00")}
                                onChange={(e) =>
                                  updateTradeShowDaySetting(date, { open_time: e.target.value })
                                }
                                className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                              />
                            </label>
                            <label className="block text-xs text-gray-700">
                              Floor closes
                              <input
                                type="time"
                                value={String(tradeShowDaySettings[date]?.close_time ?? "17:00")}
                                onChange={(e) =>
                                  updateTradeShowDaySetting(date, { close_time: e.target.value })
                                }
                                className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                              />
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block text-sm text-gray-700">
                    Total booth count
                    <input
                      type="number"
                      min={1}
                      value={Number(tradeShowConfig.booth_count_total ?? 40)}
                      onChange={(e) =>
                        updateModuleConfig("trade_show", { booth_count_total: Number(e.target.value) })
                      }
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
                    />
                  </label>
                  <label className="block text-sm text-gray-700">
                    Booth sale mode
                    <select
                      value={String(tradeShowConfig.booth_sale_mode ?? "multi_day")}
                      onChange={(e) =>
                        updateModuleConfig("trade_show", { booth_sale_mode: e.target.value })
                      }
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
                    >
                      <option value="multi_day">Multi-day booth (one booth for all trade-show days)</option>
                      <option value="single_day">Single-day booth inventory</option>
                    </select>
                  </label>
                  <label className="block text-sm text-gray-700">
                    Floor zones
                    <input
                      type="number"
                      min={1}
                      value={Number(tradeShowConfig.floor_zone_count ?? 1)}
                      onChange={(e) =>
                        updateModuleConfig("trade_show", { floor_zone_count: Number(e.target.value) })
                      }
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
                    />
                  </label>
                  <label className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={Boolean(tradeShowConfig.lead_capture_required)}
                      onChange={(e) =>
                        updateModuleConfig("trade_show", { lead_capture_required: e.target.checked })
                      }
                    />
                    Lead capture is required for exhibitors
                  </label>
                </div>

                <div className="rounded-md border border-green-200 bg-green-50 p-3">
                  <p className="text-sm font-medium text-green-900">Suggested products</p>
                  <p className="mt-1 text-xs text-green-800">
                    Use trade show setup values to create/update booth inventory products.
                  </p>
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={applyTradeShowProductSuggestion}
                      className="rounded-md bg-[#EE2A2E] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#b50001]"
                    >
                      Create/Update Suggested Trade Show Products
                    </button>
                  </div>
                  {tradeShowProductResult && (
                    <p className="mt-2 text-xs text-green-800">{tradeShowProductResult}</p>
                  )}
                </div>

                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <p className="font-semibold">Deferred to v1.2</p>
                  <p className="mt-1">
                    Booth sizes, booth inclusions/packages, premium booth tiers, and floorplan builder.
                  </p>
                </div>
              </div>
            </div>
          )}

          {currentModuleDef?.key === "meals" && modules.meals.enabled && (
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-sm font-semibold text-gray-900">Meals Setup</p>
              <p className="mt-1 text-xs text-gray-600">
                Define meal-service days and which meal blocks are offered on each day.
              </p>

              <div className="mt-4 space-y-4">
                <div className="rounded-md border border-gray-100 p-3">
                  <p className="text-sm font-medium text-gray-900">Which days include meal services?</p>
                  {conferenceDates.length === 0 ? (
                    <p className="mt-2 text-xs text-amber-700">
                      Set conference start/end dates in Details to enable date-driven meal day selection.
                    </p>
                  ) : (
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      {conferenceDates.map((date) => (
                        <label key={date} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={mealDays.includes(date)}
                            onChange={(e) => toggleMealDay(date, e.target.checked)}
                          />
                          {formatDateLabel(date)}
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {mealDays.length > 0 && (
                  <div className="rounded-md border border-gray-100 p-3">
                    <p className="text-sm font-medium text-gray-900">Meals setup by day</p>
                    <div className="mt-3 grid gap-3">
                      {mealDays.map((date) => (
                        <div key={date} className="rounded-md border border-gray-200 p-3">
                          <p className="text-sm font-medium text-gray-900">{formatDateLabel(date)}</p>
                          <p className="mt-1 text-xs text-gray-600">
                            Day profile: <span className="font-medium">{getDayProfile(date).replace("_", " ")}</span>
                          </p>
                          <label className="mt-2 block text-xs text-gray-700">
                            Day type for meals
                            <select
                              value={getEffectiveDayType(date, mealDaySettings[date]?.day_type)}
                              onChange={(e) => {
                                const value = e.target.value as ModuleDayType;
                                if (value === getDayProfile(date)) {
                                  updateModuleDayTypeOverride("meals", date, null);
                                  setDayTypePrompt(null);
                                  return;
                                }
                                setDayTypePrompt({ moduleKey: "meals", date, nextValue: value });
                              }}
                              className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                            >
                              <option value={getDayProfile(date)}>
                                Inherit ({getDayProfile(date).replace("_", " ")})
                              </option>
                              <option value="full_day">Full day</option>
                              <option value="half_day">Half day</option>
                              <option value="travel">Travel day</option>
                              <option value="other">Other day</option>
                              <option value="custom">Custom</option>
                            </select>
                          </label>
                          {dayTypePrompt?.moduleKey === "meals" && dayTypePrompt.date === date && (
                            <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                              <p>Apply this day-type change everywhere or only for Meals?</p>
                              <div className="mt-2 flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const profileValue =
                                      dayTypePrompt.nextValue === "custom"
                                        ? "other"
                                        : (dayTypePrompt.nextValue as ConferenceDayProfile);
                                    setConferenceDayProfile(date, profileValue);
                                    updateModuleDayTypeOverride("meals", date, null);
                                    setDayTypePrompt(null);
                                  }}
                                  className="rounded border border-amber-300 bg-white px-2 py-1"
                                >
                                  Apply to all modules
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    updateModuleDayTypeOverride("meals", date, dayTypePrompt.nextValue);
                                    setDayTypePrompt(null);
                                  }}
                                  className="rounded border border-amber-300 bg-white px-2 py-1"
                                >
                                  Only Meals
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDayTypePrompt(null)}
                                  className="rounded border border-amber-300 bg-white px-2 py-1"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                          <div className="mt-2 grid gap-3 md:grid-cols-2">
                            <div className="grid grid-cols-2 gap-2 rounded-md border border-gray-200 p-2 text-xs">
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={Boolean(mealDaySettings[date]?.breakfast)}
                                  onChange={(e) =>
                                    updateMealDaySetting(date, { breakfast: e.target.checked })
                                  }
                                />
                                Breakfast
                              </label>
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={Boolean(mealDaySettings[date]?.lunch)}
                                  onChange={(e) =>
                                    updateMealDaySetting(date, { lunch: e.target.checked })
                                  }
                                />
                                Lunch
                              </label>
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={Boolean(mealDaySettings[date]?.dinner)}
                                  onChange={(e) =>
                                    updateMealDaySetting(date, { dinner: e.target.checked })
                                  }
                                />
                                Dinner
                              </label>
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={Boolean(mealDaySettings[date]?.custom_enabled)}
                                  onChange={(e) =>
                                    updateMealDaySetting(date, { custom_enabled: e.target.checked })
                                  }
                                />
                                Custom
                              </label>
                              <label className="flex items-center gap-2">
                                Snacks
                                <input
                                  type="number"
                                  min={0}
                                  max={6}
                                  value={
                                    Array.isArray(mealDaySettings[date]?.snack_breaks)
                                      ? (mealDaySettings[date]?.snack_breaks as Array<unknown>).length
                                      : 0
                                  }
                                  onChange={(e) => setSnackBreakCount(date, Number(e.target.value))}
                                  className="w-16 rounded-md border border-gray-300 px-2 py-1 text-xs"
                                />
                              </label>
                            </div>
                            {Boolean(mealDaySettings[date]?.breakfast) && (
                              <div className="grid grid-cols-2 gap-2">
                                <label className="block text-xs text-gray-700">
                                  Breakfast time
                                  <input
                                    type="time"
                                    value={String(mealDaySettings[date]?.breakfast_time ?? "08:00")}
                                    onChange={(e) =>
                                      updateMealDaySetting(date, { breakfast_time: e.target.value })
                                    }
                                    className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                                  />
                                </label>
                                <label className="block text-xs text-gray-700">
                                  Breakfast duration (minutes)
                                  <input
                                    type="number"
                                    min={5}
                                    value={Number(mealDaySettings[date]?.breakfast_duration_minutes ?? 60)}
                                    onChange={(e) =>
                                      updateMealDaySetting(date, {
                                        breakfast_duration_minutes: Number(e.target.value),
                                      })
                                    }
                                    className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                                  />
                                </label>
                              </div>
                            )}
                            {Boolean(mealDaySettings[date]?.lunch) && (
                              <div className="grid grid-cols-2 gap-2">
                                <label className="block text-xs text-gray-700">
                                  Lunch time
                                  <input
                                    type="time"
                                    value={String(mealDaySettings[date]?.lunch_time ?? "12:00")}
                                    onChange={(e) =>
                                      updateMealDaySetting(date, { lunch_time: e.target.value })
                                    }
                                    className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                                  />
                                </label>
                                <label className="block text-xs text-gray-700">
                                  Lunch duration (minutes)
                                  <input
                                    type="number"
                                    min={5}
                                    value={Number(mealDaySettings[date]?.lunch_duration_minutes ?? 60)}
                                    onChange={(e) =>
                                      updateMealDaySetting(date, {
                                        lunch_duration_minutes: Number(e.target.value),
                                      })
                                    }
                                    className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                                  />
                                </label>
                              </div>
                            )}
                            {Boolean(mealDaySettings[date]?.dinner) && (
                              <div className="grid grid-cols-2 gap-2">
                                <label className="block text-xs text-gray-700">
                                  Dinner time
                                  <input
                                    type="time"
                                    value={String(mealDaySettings[date]?.dinner_time ?? "18:00")}
                                    onChange={(e) =>
                                      updateMealDaySetting(date, { dinner_time: e.target.value })
                                    }
                                    className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                                  />
                                </label>
                                <label className="block text-xs text-gray-700">
                                  Dinner duration (minutes)
                                  <input
                                    type="number"
                                    min={5}
                                    value={Number(mealDaySettings[date]?.dinner_duration_minutes ?? 90)}
                                    onChange={(e) =>
                                      updateMealDaySetting(date, {
                                        dinner_duration_minutes: Number(e.target.value),
                                      })
                                    }
                                    className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                                  />
                                </label>
                              </div>
                            )}
                            {Boolean(mealDaySettings[date]?.custom_enabled) && (
                              <div className="grid grid-cols-2 gap-2">
                                <label className="block text-xs text-gray-700 col-span-2">
                                  Custom label
                                  <input
                                    type="text"
                                    value={String(mealDaySettings[date]?.custom_label ?? "Custom")}
                                    onChange={(e) =>
                                      updateMealDaySetting(date, { custom_label: e.target.value })
                                    }
                                    className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                                  />
                                </label>
                                <label className="block text-xs text-gray-700">
                                  Custom time
                                  <input
                                    type="time"
                                    value={String(mealDaySettings[date]?.custom_time ?? "17:00")}
                                    onChange={(e) =>
                                      updateMealDaySetting(date, { custom_time: e.target.value })
                                    }
                                    className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                                  />
                                </label>
                                <label className="block text-xs text-gray-700">
                                  Custom duration (minutes)
                                  <input
                                    type="number"
                                    min={5}
                                    value={Number(mealDaySettings[date]?.custom_duration_minutes ?? 90)}
                                    onChange={(e) =>
                                      updateMealDaySetting(date, {
                                        custom_duration_minutes: Number(e.target.value),
                                      })
                                    }
                                    className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                                  />
                                </label>
                              </div>
                            )}
                            {Array.isArray(mealDaySettings[date]?.snack_breaks) &&
                              (mealDaySettings[date]?.snack_breaks as Array<unknown>).length > 0 && (
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between">
                                    <p className="text-xs font-medium text-gray-700">Snacks</p>
                                    <span className="text-xs text-gray-500">
                                      {(mealDaySettings[date]?.snack_breaks as Array<unknown>).length} breaks
                                    </span>
                                  </div>
                                  {Array.from({
                                    length: Array.isArray(mealDaySettings[date]?.snack_breaks)
                                      ? (mealDaySettings[date]?.snack_breaks as Array<unknown>).length
                                      : 0,
                                  }).map((_, snackIndex) => (
                                    <div key={`${date}-snack-${snackIndex}`} className="grid grid-cols-2 gap-2">
                                      <label className="block text-xs text-gray-700">
                                        Snack break {snackIndex + 1} time
                                        <input
                                          type="time"
                                          value={
                                            (Array.isArray(mealDaySettings[date]?.snack_breaks)
                                              ? (
                                                  mealDaySettings[date]?.snack_breaks as Array<{
                                                    start_time: string;
                                                    duration_minutes: number;
                                                  }>
                                                )[snackIndex]?.start_time
                                              : undefined) ?? "15:00"
                                          }
                                          onChange={(e) => setSnackBreakTime(date, snackIndex, e.target.value)}
                                          className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                                        />
                                      </label>
                                      <label className="block text-xs text-gray-700">
                                        Snack break {snackIndex + 1} duration (minutes)
                                        <input
                                          type="number"
                                          min={5}
                                          value={
                                            (Array.isArray(mealDaySettings[date]?.snack_breaks)
                                              ? (
                                                  mealDaySettings[date]?.snack_breaks as Array<{
                                                    start_time: string;
                                                    duration_minutes: number;
                                                  }>
                                                )[snackIndex]?.duration_minutes
                                              : undefined) ?? 30
                                          }
                                          onChange={(e) =>
                                            setSnackBreakDuration(date, snackIndex, Number(e.target.value))
                                          }
                                          className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                                        />
                                      </label>
                                    </div>
                                  ))}
                                </div>
                              )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block text-sm text-gray-700">
                    Meal plan base capacity
                    <input
                      type="number"
                      min={1}
                      value={Number(mealsConfig.meal_plan_capacity ?? 100)}
                      onChange={(e) =>
                        updateModuleConfig("meals", { meal_plan_capacity: Number(e.target.value) })
                      }
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
                    />
                  </label>
                  <label className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={Boolean(mealsConfig.dietary_capture_required)}
                      onChange={(e) =>
                        updateModuleConfig("meals", { dietary_capture_required: e.target.checked })
                      }
                    />
                    Dietary info capture required
                  </label>
                </div>

                <div className="rounded-md border border-green-200 bg-green-50 p-3">
                  <p className="text-sm font-medium text-green-900">Suggested products</p>
                  <p className="mt-1 text-xs text-green-800">
                    Use meals setup to create/update meal plan products.
                  </p>
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={applyMealProductSuggestion}
                      className="rounded-md bg-[#EE2A2E] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#b50001]"
                    >
                      Create/Update Suggested Meal Products
                    </button>
                  </div>
                  {mealProductResult && (
                    <p className="mt-2 text-xs text-green-800">{mealProductResult}</p>
                  )}
                </div>

                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <p className="font-semibold">Deferred to v1.2</p>
                  <p className="mt-1">
                    Per-meal package tiers, guest meal purchase flow, table assignment/plating ops, and vendor
                    menu integration.
                  </p>
                </div>
              </div>
            </div>
          )}

          {currentModuleDef?.key === "offsite" && modules.offsite.enabled && (
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-sm font-semibold text-gray-900">Offsite Events Setup</p>
              <p className="mt-1 text-xs text-gray-600">
                Configure offsite events, place/travel logistics, audience registration types, sponsorship, and
                safety operations.
              </p>
              <label className="mt-3 flex items-center gap-2 text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={offsiteAllowTbdVenue}
                  onChange={(e) => updateModuleConfig("offsite", { allow_tbd_venue: e.target.checked })}
                />
                Allow TBD venue details (dates and times still required)
              </label>
              <div className="mt-4 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-900">
                    Offsite events ({offsiteEvents.length})
                  </p>
                  <button
                    type="button"
                    onClick={addOffsiteEvent}
                    className="rounded-md bg-[#EE2A2E] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#b50001]"
                  >
                    Add Offsite Event
                  </button>
                </div>

                {offsiteEvents.length === 0 && (
                  <p className="rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
                    No offsite events yet. Add one to start configuring venue, travel, audience, and sponsorship.
                  </p>
                )}

                {offsiteEvents.map((event, index) => (
                  <div key={event.id} className="rounded-md border border-gray-200 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-gray-900">Offsite Event {index + 1}</p>
                      <button
                        type="button"
                        onClick={() => removeOffsiteEvent(event.id)}
                        className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                      >
                        Remove
                      </button>
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <label className="block text-xs text-gray-700">
                        Event title
                        <input
                          type="text"
                          value={event.title}
                          onChange={(e) => updateOffsiteEvent(event.id, { title: e.target.value })}
                          className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                        />
                      </label>
                      <label className="block text-xs text-gray-700">
                        Linked product
                        <select
                          value={event.linked_product_id ?? ""}
                          onChange={(e) =>
                            updateOffsiteEvent(event.id, {
                              linked_product_id: e.target.value || null,
                            })
                          }
                          className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                        >
                          <option value="">Select product…</option>
                          {initialProducts.map((product) => (
                            <option key={`${event.id}-product-${product.id}`} value={product.id}>
                              {product.name} ({product.slug}) {product.is_active ? "" : "[inactive]"}
                            </option>
                          ))}
                        </select>
                        <span className="mt-1 block text-[11px] text-gray-500">
                          Every offsite event must link to a product. Multiple events may share one product.
                        </span>
                      </label>
                      <label className="block text-xs text-gray-700">
                        Event date
                        <select
                          value={event.date}
                          onChange={(e) => updateOffsiteEvent(event.id, { date: e.target.value })}
                          className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                        >
                          {conferenceDates.map((date) => (
                            <option key={`${event.id}-${date}`} value={date}>
                              {formatDateLabel(date)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p className="text-xs text-gray-600 md:col-span-2">
                        Day profile:{" "}
                        <span className="font-medium">
                          {(event.date ? getDayProfile(event.date) : "full_day").replace("_", " ")}
                        </span>
                      </p>
                      <label className="block text-xs text-gray-700">
                        Starts at
                        <input
                          type="time"
                          value={event.start_time}
                          onChange={(e) => updateOffsiteEvent(event.id, { start_time: e.target.value })}
                          className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                        />
                      </label>
                      <label className="block text-xs text-gray-700">
                        Ends at
                        <input
                          type="time"
                          value={event.end_time}
                          onChange={(e) => updateOffsiteEvent(event.id, { end_time: e.target.value })}
                          className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                        />
                      </label>
                    </div>

                    <div className="mt-3 rounded-md border border-gray-100 p-3">
                      <p className="text-xs font-medium text-gray-900">Place + Travel</p>
                      <div className="mt-2">
                        {googleMapsApiKey && placesReady && (
                          <p className="rounded border border-green-200 bg-green-50 px-2 py-1 text-[11px] text-green-800">
                            Google Places is active. Pick a venue result to auto-fill place ID and address.
                          </p>
                        )}
                        {placesError && (
                          <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                            {placesError}
                          </p>
                        )}
                      </div>
                      <div className="mt-2 grid gap-3 md:grid-cols-2">
                        <label className="block text-xs text-gray-700">
                          Venue name
                          <input
                            ref={(node) => {
                              offsiteVenueInputRefs.current[event.id] = node;
                            }}
                            type="text"
                            value={event.venue_name}
                            onChange={(e) => updateOffsiteEvent(event.id, { venue_name: e.target.value })}
                            placeholder="Start typing venue name..."
                            className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                          />
                        </label>
                        {event.google_place_id ? (
                          <div className="block text-xs text-gray-600">
                            <p className="font-medium text-gray-700">Google Place ID</p>
                            <p className="mt-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-2 font-mono text-[11px]">
                              {event.google_place_id}
                            </p>
                          </div>
                        ) : (
                          <div className="hidden md:block" aria-hidden="true" />
                        )}
                        <label className="block text-xs text-gray-700 md:col-span-2">
                          Venue address
                          <input
                            type="text"
                            value={event.venue_address}
                            onChange={(e) => updateOffsiteEvent(event.id, { venue_address: e.target.value })}
                            className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                          />
                        </label>
                        <label className="block text-xs text-gray-700">
                          Travel mode
                          <select
                            value={event.travel_mode}
                            onChange={(e) =>
                              updateOffsiteEvent(event.id, {
                                travel_mode: e.target.value as OffsiteTravelMode,
                              })
                            }
                            className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                          >
                            <option value="walk">Walk</option>
                            <option value="shuttle">Shuttle</option>
                            <option value="bus">Bus</option>
                            <option value="own_transport">Own transport</option>
                          </select>
                        </label>
                        <label className="block text-xs text-gray-700">
                          Travel time (minutes)
                          <input
                            type="number"
                            min={0}
                            value={event.travel_time_minutes}
                            onChange={(e) =>
                              updateOffsiteEvent(event.id, { travel_time_minutes: Number(e.target.value) })
                            }
                            className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                          />
                        </label>
                        <label className="block text-xs text-gray-700">
                          Departure time
                          <input
                            type="time"
                            value={event.departure_time}
                            onChange={(e) => updateOffsiteEvent(event.id, { departure_time: e.target.value })}
                            className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                          />
                        </label>
                        <label className="block text-xs text-gray-700">
                          Return time
                          <input
                            type="time"
                            value={event.return_time}
                            onChange={(e) => updateOffsiteEvent(event.id, { return_time: e.target.value })}
                            className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                          />
                        </label>
                      </div>
                    </div>

                    <div className="mt-3 rounded-md border border-gray-100 p-3">
                      <p className="text-xs font-medium text-gray-900">Audience + Capacity</p>
                      <div className="mt-2 grid gap-3 md:grid-cols-2">
                        <label className="block text-xs text-gray-700">
                          Capacity
                          <input
                            type="number"
                            min={1}
                            value={event.capacity}
                            onChange={(e) => updateOffsiteEvent(event.id, { capacity: Number(e.target.value) })}
                            className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                          />
                        </label>
                        <label className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-xs text-gray-700">
                          <input
                            type="checkbox"
                            checked={event.waitlist_enabled}
                            onChange={(e) => updateOffsiteEvent(event.id, { waitlist_enabled: e.target.checked })}
                          />
                          Enable waitlist
                        </label>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 rounded-md border border-gray-200 p-2 text-xs">
                        {OFFSITE_REGISTRATION_TYPES.map((opt) => (
                          <label key={`${event.id}-${opt.value}`} className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={event.audience_registration_types.includes(opt.value)}
                              onChange={(e) => {
                                const next = e.target.checked
                                  ? [...event.audience_registration_types, opt.value]
                                  : event.audience_registration_types.filter((v) => v !== opt.value);
                                updateOffsiteEvent(event.id, {
                                  audience_registration_types: Array.from(new Set(next)),
                                });
                              }}
                            />
                            {opt.label}
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="mt-3 rounded-md border border-gray-100 p-3">
                      <p className="text-xs font-medium text-gray-900">Meal + Sponsorship + Ops</p>
                      <div className="mt-2 grid gap-3 md:grid-cols-2">
                        <label className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-xs text-gray-700">
                          <input
                            type="checkbox"
                            checked={event.includes_meal}
                            onChange={(e) => updateOffsiteEvent(event.id, { includes_meal: e.target.checked })}
                          />
                          Includes meal
                        </label>
                        <label className="block text-xs text-gray-700">
                          Meal type
                          <select
                            value={event.meal_type}
                            onChange={(e) =>
                              updateOffsiteEvent(event.id, { meal_type: e.target.value as OffsiteMealType })
                            }
                            disabled={!event.includes_meal}
                            className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm disabled:bg-gray-100"
                          >
                            <option value="breakfast">Breakfast</option>
                            <option value="lunch">Lunch</option>
                            <option value="dinner">Dinner</option>
                            <option value="snack">Snack</option>
                            <option value="custom">Custom</option>
                          </select>
                        </label>
                        {event.includes_meal && event.meal_type === "custom" && (
                          <label className="block text-xs text-gray-700 md:col-span-2">
                            Custom meal label
                            <input
                              type="text"
                              value={event.meal_custom_label}
                              onChange={(e) =>
                                updateOffsiteEvent(event.id, { meal_custom_label: e.target.value })
                              }
                              className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                            />
                          </label>
                        )}

                        <label className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-xs text-gray-700">
                          <input
                            type="checkbox"
                            checked={event.is_sponsored}
                            onChange={(e) => updateOffsiteEvent(event.id, { is_sponsored: e.target.checked })}
                          />
                          Sponsored event
                        </label>
                        <label className="block text-xs text-gray-700">
                          Sponsor name
                          <input
                            type="text"
                            value={event.sponsor_name}
                            onChange={(e) => updateOffsiteEvent(event.id, { sponsor_name: e.target.value })}
                            disabled={!event.is_sponsored}
                            placeholder={
                              sponsorshipOpsConfig.notes
                                ? "Link to Sponsor Ops naming"
                                : "Sponsor name"
                            }
                            className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm disabled:bg-gray-100"
                          />
                        </label>
                        <label className="block text-xs text-gray-700">
                          Sponsor tier
                          <input
                            type="text"
                            value={event.sponsor_tier}
                            onChange={(e) => updateOffsiteEvent(event.id, { sponsor_tier: e.target.value })}
                            disabled={!event.is_sponsored}
                            className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm disabled:bg-gray-100"
                          />
                        </label>
                        <label className="block text-xs text-gray-700 md:col-span-2">
                          Sponsorship activation notes
                          <textarea
                            value={event.sponsorship_activation_notes}
                            onChange={(e) =>
                              updateOffsiteEvent(event.id, {
                                sponsorship_activation_notes: e.target.value,
                              })
                            }
                            disabled={!event.is_sponsored}
                            rows={2}
                            className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm disabled:bg-gray-100"
                          />
                        </label>

                        <label className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-xs text-gray-700">
                          <input
                            type="checkbox"
                            checked={event.waiver_required}
                            onChange={(e) => updateOffsiteEvent(event.id, { waiver_required: e.target.checked })}
                          />
                          Waiver/consent required
                        </label>
                        <label className="block text-xs text-gray-700">
                          Emergency contact
                          <input
                            type="text"
                            value={event.emergency_contact}
                            onChange={(e) => updateOffsiteEvent(event.id, { emergency_contact: e.target.value })}
                            className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                          />
                        </label>
                        <label className="block text-xs text-gray-700">
                          Meeting point
                          <input
                            type="text"
                            value={event.meeting_point}
                            onChange={(e) => updateOffsiteEvent(event.id, { meeting_point: e.target.value })}
                            className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                          />
                        </label>
                        <label className="block text-xs text-gray-700 md:col-span-2">
                          Accessibility notes
                          <textarea
                            value={event.accessibility_notes}
                            onChange={(e) => updateOffsiteEvent(event.id, { accessibility_notes: e.target.value })}
                            rows={2}
                            className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                          />
                        </label>
                        <label className="block text-xs text-gray-700 md:col-span-2">
                          Contingency plan
                          <textarea
                            value={event.contingency_plan}
                            onChange={(e) => updateOffsiteEvent(event.id, { contingency_plan: e.target.value })}
                            rows={2}
                            className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                ))}

                <div className="rounded-md border border-green-200 bg-green-50 p-3">
                  <p className="text-sm font-medium text-green-900">Suggested products</p>
                  <p className="mt-1 text-xs text-green-800">
                    Use offsite event capacities to create/update offsite access products.
                  </p>
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={applyOffsiteProductSuggestion}
                      className="rounded-md bg-[#EE2A2E] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#b50001]"
                    >
                      Create/Update Suggested Offsite Products
                    </button>
                  </div>
                  {offsiteProductResult && (
                    <p className="mt-2 text-xs text-green-800">{offsiteProductResult}</p>
                  )}
                </div>

                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <p className="font-semibold">Deferred to v1.2</p>
                  <p className="mt-1">
                    Live travel-time API estimation, map route previews, and sponsor catalog picker binding.
                  </p>
                </div>
              </div>
            </div>
          )}

          {currentModuleDef?.key === "education" && modules.education.enabled && (
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-sm font-semibold text-gray-900">Education Setup</p>
              <p className="mt-1 text-xs text-gray-600">
                Define education days, session geometry, and baseline delivery settings.
              </p>
              <label className="mt-3 flex items-center gap-2 text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={educationAllowTbdDetails}
                  onChange={(e) =>
                    updateModuleConfig("education", { allow_tbd_details: e.target.checked })
                  }
                />
                Allow TBD education details (day windows remain required)
              </label>

              <div className="mt-4 space-y-4">
                <div className="rounded-md border border-gray-100 p-3">
                  <p className="text-sm font-medium text-gray-900">Which days include education sessions?</p>
                  {conferenceDates.length === 0 ? (
                    <p className="mt-2 text-xs text-amber-700">
                      Set conference start/end dates in Details to enable date-driven education day selection.
                    </p>
                  ) : (
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      {conferenceDates.map((date) => (
                        <label key={date} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={educationDays.includes(date)}
                            onChange={(e) => toggleEducationDay(date, e.target.checked)}
                          />
                          {formatDateLabel(date)}
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {educationDays.length > 0 && (
                  <div className="rounded-md border border-gray-100 p-3">
                    <p className="text-sm font-medium text-gray-900">Education setup by day</p>
                    <div className="mt-3 grid gap-3">
                      {educationDays.map((date) => (
                        <div key={date} className="rounded-md border border-gray-200 p-3">
                          <p className="text-sm font-medium text-gray-900">{formatDateLabel(date)}</p>
                          <p className="mt-1 text-xs text-gray-600">
                            Day profile: <span className="font-medium">{getDayProfile(date).replace("_", " ")}</span>
                          </p>
                          <label className="mt-2 block text-xs text-gray-700">
                            Day type for education
                            <select
                              value={getEffectiveDayType(date, educationDaySettings[date]?.day_type)}
                              onChange={(e) => {
                                const value = e.target.value as ModuleDayType;
                                if (value === getDayProfile(date)) {
                                  updateModuleDayTypeOverride("education", date, null);
                                  setDayTypePrompt(null);
                                  return;
                                }
                                setDayTypePrompt({ moduleKey: "education", date, nextValue: value });
                              }}
                              className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                            >
                              <option value={getDayProfile(date)}>
                                Inherit ({getDayProfile(date).replace("_", " ")})
                              </option>
                              <option value="full_day">Full day</option>
                              <option value="half_day">Half day</option>
                              <option value="travel">Travel day</option>
                              <option value="other">Other day</option>
                              <option value="custom">Custom</option>
                            </select>
                          </label>
                          {dayTypePrompt?.moduleKey === "education" && dayTypePrompt.date === date && (
                            <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                              <p>Apply this day-type change everywhere or only for Education?</p>
                              <div className="mt-2 flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const profileValue =
                                      dayTypePrompt.nextValue === "custom"
                                        ? "other"
                                        : (dayTypePrompt.nextValue as ConferenceDayProfile);
                                    setConferenceDayProfile(date, profileValue);
                                    updateModuleDayTypeOverride("education", date, null);
                                    setDayTypePrompt(null);
                                  }}
                                  className="rounded border border-amber-300 bg-white px-2 py-1"
                                >
                                  Apply to all modules
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    updateModuleDayTypeOverride("education", date, dayTypePrompt.nextValue);
                                    setDayTypePrompt(null);
                                  }}
                                  className="rounded border border-amber-300 bg-white px-2 py-1"
                                >
                                  Only Education
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDayTypePrompt(null)}
                                  className="rounded border border-amber-300 bg-white px-2 py-1"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                          <div className="mt-2 grid gap-3 md:grid-cols-3">
                            <label className="block text-xs text-gray-700">
                              Session window starts
                              <input
                                type="time"
                                value={String(educationDaySettings[date]?.start_time ?? "09:00")}
                                onChange={(e) =>
                                  updateEducationDaySetting(date, { start_time: e.target.value })
                                }
                                className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                              />
                            </label>
                            <label className="block text-xs text-gray-700">
                              Session window ends
                              <input
                                type="time"
                                value={String(educationDaySettings[date]?.end_time ?? "17:00")}
                                onChange={(e) =>
                                  updateEducationDaySetting(date, { end_time: e.target.value })
                                }
                                className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                              />
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block text-sm text-gray-700">
                    Session count target
                    <input
                      type="number"
                      min={0}
                      value={Number(educationConfig.session_count_target ?? 12)}
                      onChange={(e) =>
                        updateModuleConfig("education", { session_count_target: Number(e.target.value) })
                      }
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
                    />
                    {educationAllowTbdDetails && (
                      <span className="mt-1 block text-xs text-gray-500">
                        TBD mode is on: `0` is allowed during setup.
                      </span>
                    )}
                  </label>
                  <label className="block text-sm text-gray-700">
                    Concurrent room count
                    <input
                      type="number"
                      min={1}
                      value={Number(educationConfig.room_count ?? 2)}
                      onChange={(e) =>
                        updateModuleConfig("education", { room_count: Number(e.target.value) })
                      }
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
                    />
                  </label>
                  <label className="block text-sm text-gray-700">
                    Session length (minutes)
                    <input
                      type="number"
                      min={5}
                      value={Number(educationConfig.session_length_minutes ?? 45)}
                      onChange={(e) =>
                        updateModuleConfig("education", { session_length_minutes: Number(e.target.value) })
                      }
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
                    />
                  </label>
                  <label className="block text-sm text-gray-700">
                    Buffer between sessions (minutes)
                    <input
                      type="number"
                      min={0}
                      value={Number(educationConfig.buffer_minutes ?? 15)}
                      onChange={(e) =>
                        updateModuleConfig("education", { buffer_minutes: Number(e.target.value) })
                      }
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
                    />
                  </label>
                  <label className="block text-sm text-gray-700">
                    Audience mode
                    <select
                      value={String(educationConfig.audience_mode ?? "all")}
                      onChange={(e) =>
                        updateModuleConfig("education", { audience_mode: e.target.value })
                      }
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
                    >
                      <option value="all">All attendees</option>
                      <option value="delegates_only">Delegates only</option>
                      <option value="custom">Custom audience</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={Boolean(educationConfig.speaker_badges)}
                      onChange={(e) =>
                        updateModuleConfig("education", { speaker_badges: e.target.checked })
                      }
                    />
                    Speaker badges required
                  </label>
                  <label className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={Boolean(educationConfig.abstract_intake)}
                      onChange={(e) =>
                        updateModuleConfig("education", { abstract_intake: e.target.checked })
                      }
                    />
                    Abstract intake workflow needed
                  </label>
                </div>

                <div className="rounded-md border border-green-200 bg-green-50 p-3">
                  <p className="text-sm font-medium text-green-900">Suggested products</p>
                  <p className="mt-1 text-xs text-green-800">
                    Use education setup values to create/update education access products.
                  </p>
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={applyEducationProductSuggestion}
                      className="rounded-md bg-[#EE2A2E] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#b50001]"
                    >
                      Create/Update Suggested Education Products
                    </button>
                  </div>
                  {educationProductResult && (
                    <p className="mt-2 text-xs text-green-800">{educationProductResult}</p>
                  )}
                </div>

                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <p className="font-semibold">Deferred to v1.2</p>
                  <p className="mt-1">
                    Abstract review workflow states, speaker onboarding portal, CE credits/certificates,
                    session-level waitlists, and AV/resource assignment.
                  </p>
                </div>
              </div>
            </div>
          )}

          {currentModuleDef?.key === "custom" && modules.custom.enabled && (
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-sm font-semibold text-gray-900">Custom Module Notes</p>
              <textarea
                value={String(modules.custom.config_json.notes ?? "")}
                onChange={(e) => updateModuleConfig("custom", { notes: e.target.value })}
                rows={3}
                placeholder="Define your custom schedule/build requirements."
                className="mt-3 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          )}

          {currentModuleDef?.key === "communications" &&
            (modules.communications.enabled || currentModuleDef.alwaysIncluded) && (
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <p className="text-sm font-semibold text-gray-900">Communications Audience Lists</p>
                <p className="mt-1 text-xs text-gray-600">
                  Define list rules from conference registration/ops flags. Message composition and sending stay in the central communications console.
                </p>

                <div className="mt-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={addAudienceList}
                        className="rounded-md bg-[#EE2A2E] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#b50001]"
                      >
                        Add Audience List
                      </button>
                      <button
                        type="button"
                        onClick={seedStandardAudienceLists}
                        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Seed Standard Lists
                      </button>
                    </div>
                    <p className="text-xs text-gray-500">{audienceLists.length} configured</p>
                  </div>

                  {audienceLists.length === 0 && (
                    <p className="rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
                      No audience lists defined yet. Add lists here; central comms will resolve counts and execute sends.
                    </p>
                  )}

                  {audienceLists.map((list, index) => (
                    <div key={list.id} className="rounded-md border border-gray-200 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium text-gray-900">Audience List {index + 1}</p>
                        <button
                          type="button"
                          onClick={() => removeAudienceList(list.id)}
                          className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                        >
                          Remove
                        </button>
                      </div>

                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <label className="block text-xs text-gray-700">
                          List name
                          <input
                            type="text"
                            value={list.name}
                            onChange={(e) => updateAudienceList(list.id, { name: e.target.value })}
                            className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                          />
                        </label>
                        <label className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-xs text-gray-700">
                          <input
                            type="checkbox"
                            checked={list.enabled}
                            onChange={(e) => updateAudienceList(list.id, { enabled: e.target.checked })}
                          />
                          Enabled
                        </label>
                      </div>

                      <div className="mt-3 rounded border border-gray-100 p-2">
                        <p className="text-xs font-medium text-gray-900">Registration Types</p>
                        <div className="mt-1 grid grid-cols-2 gap-1 text-xs">
                          {selectedRegistrationTypes.map((type) => (
                            <label key={`${list.id}-type-${type}`} className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={list.registration_types.includes(type)}
                                onChange={(e) =>
                                  toggleAudienceListRegistrationType(list.id, type, e.target.checked)
                                }
                              />
                              {REGISTRATION_TYPES.find((entry) => entry.key === type)?.label ?? type}
                            </label>
                          ))}
                        </div>
                      </div>

                      <div className="mt-3 rounded border border-gray-100 p-2">
                        <p className="text-xs font-medium text-gray-900">Registration Statuses</p>
                        <div className="mt-1 grid grid-cols-2 gap-1 text-xs">
                          {REGISTRATION_LIFECYCLE_STAGES.map((stage) => (
                            <label key={`${list.id}-status-${stage.key}`} className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={list.registration_statuses.includes(stage.key)}
                                onChange={(e) => toggleAudienceListStatus(list.id, stage.key, e.target.checked)}
                              />
                              {stage.label}
                            </label>
                          ))}
                        </div>
                      </div>

                      <div className="mt-3 grid gap-3 md:grid-cols-3">
                        <label className="block text-xs text-gray-700">
                          Travel consent
                          <select
                            value={
                              list.requires_travel_consent === null
                                ? "any"
                                : list.requires_travel_consent
                                  ? "required_true"
                                  : "required_false"
                            }
                            onChange={(e) =>
                              updateAudienceList(list.id, {
                                requires_travel_consent:
                                  e.target.value === "any"
                                    ? null
                                    : e.target.value === "required_true",
                              })
                            }
                            className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                          >
                            <option value="any">Any</option>
                            <option value="required_true">Must have consent</option>
                            <option value="required_false">Missing consent</option>
                          </select>
                        </label>
                        <label className="block text-xs text-gray-700">
                          Check-in status
                          <select
                            value={
                              list.requires_checkin === null
                                ? "any"
                                : list.requires_checkin
                                  ? "required_true"
                                  : "required_false"
                            }
                            onChange={(e) =>
                              updateAudienceList(list.id, {
                                requires_checkin:
                                  e.target.value === "any"
                                    ? null
                                    : e.target.value === "required_true",
                              })
                            }
                            className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                          >
                            <option value="any">Any</option>
                            <option value="required_true">Checked in</option>
                            <option value="required_false">Not checked in</option>
                          </select>
                        </label>
                        <label className="block text-xs text-gray-700">
                          Occupancy filter
                          <select
                            value={list.occupancy_module ?? "any"}
                            onChange={(e) =>
                              updateAudienceList(list.id, {
                                occupancy_module:
                                  e.target.value === "any"
                                    ? null
                                    : (e.target.value as OccupancyModuleKey),
                              })
                            }
                            className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                          >
                            <option value="any">Any</option>
                            {OCCUPANCY_MODULES.map((moduleDef) => (
                              <option key={`${list.id}-occ-${moduleDef.key}`} value={moduleDef.key}>
                                {moduleDef.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      <div className="mt-3 rounded border border-gray-100 p-2">
                        <p className="text-xs font-medium text-gray-900">Linked Products (optional)</p>
                        {initialProducts.length === 0 ? (
                          <p className="mt-1 text-xs text-gray-500">No products available.</p>
                        ) : (
                          <div className="mt-1 grid grid-cols-1 gap-1 text-xs">
                            {initialProducts.map((product) => (
                              <label key={`${list.id}-prod-${product.id}`} className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={list.linked_product_ids.includes(product.id)}
                                  onChange={(e) =>
                                    toggleAudienceListLinkedProduct(list.id, product.id, e.target.checked)
                                  }
                                />
                                <span>
                                  {product.name}
                                  <span className="ml-1 text-gray-500">({product.slug})</span>
                                </span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>

                      <label className="mt-3 block text-xs text-gray-700">
                        Notes
                        <textarea
                          value={list.notes}
                          onChange={(e) => updateAudienceList(list.id, { notes: e.target.value })}
                          rows={2}
                          className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                          placeholder="Optional context for comms operators"
                        />
                      </label>
                    </div>
                  ))}

                  <div className="rounded border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
                    These are list definitions only. Final audience preview counts, sample recipients, and send execution happen in the central communications console.
                  </div>
                </div>
              </div>
            )}

          {currentModuleDef?.key === "registration_ops" &&
            (modules.registration_ops.enabled || currentModuleDef.alwaysIncluded) && (
              <div className="rounded-2xl border border-gray-200 bg-gradient-to-b from-white to-gray-50/60 p-5 shadow-sm">
                <p className="text-base font-semibold text-gray-900">Registration Operations</p>
                <p className="mt-1 text-sm text-gray-600">
                  Build the actual registration experience path-by-path.
                </p>

                <div className="mt-4 rounded-xl border border-gray-900 bg-gray-900 p-4 text-white shadow-sm">
                  <div>
                    <p className="text-sm font-semibold">Registration Options Workspace</p>
                    <p className="mt-1 text-xs text-gray-200">
                      Build ordered registration paths from canonical fields, custom questions, breaks, and titles.
                    </p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {REGISTRATION_TYPES.map((type) => (
                      <button
                        key={`add-registration-option-${type.key}`}
                        type="button"
                        onClick={() => addRegistrationOption(type.key)}
                        className="rounded-full border border-white/30 bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20"
                      >
                        Add {type.label} Option
                      </button>
                    ))}
                  </div>

                  <div className="mt-3 space-y-3">
                    {registrationOptions.length === 0 ? (
                      <p className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs text-white">
                        No options yet. Add one to start authoring registration behavior.
                      </p>
                    ) : (
                      registrationOptions.map((option, optionIndex) => (
                        <details
                          key={option.id}
                          className="rounded-xl border border-gray-200 bg-white p-4 text-gray-900 shadow-sm"
                          open={optionIndex === 0}
                        >
                          <summary className="cursor-pointer text-sm font-semibold text-gray-900">
                            {option.name || "Untitled option"} ·{" "}
                            {REGISTRATION_TYPES.find((type) => type.key === option.registration_type)?.label ??
                              option.registration_type}
                          </summary>
                          <div className="mt-3">
                          <div className="grid gap-3 md:grid-cols-3">
                            <label className="block text-xs text-gray-700 md:col-span-2">
                              Option name
                              <input
                                type="text"
                                value={option.name}
                                onChange={(e) => updateRegistrationOption(option.id, { name: e.target.value })}
                                className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                              />
                            </label>
                            <label className="block text-xs text-gray-700">
                              Registration type
                              <select
                                value={option.registration_type}
                                onChange={(e) =>
                                  updateRegistrationOption(option.id, {
                                    registration_type: e.target.value as RegistrationTypeKey,
                                    entitlements: {
                                      ...DEFAULT_OCCUPANCY_BY_TYPE[e.target.value as RegistrationTypeKey],
                                    },
                                  })
                                }
                                className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                              >
                                {REGISTRATION_TYPES.map((type) => (
                                  <option key={`registration-option-type-${option.id}-${type.key}`} value={type.key}>
                                    {type.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>

                          <div className="mt-3">
                            <p className="text-xs font-medium text-gray-900">Linked products</p>
                            {initialProducts.length === 0 ? (
                              <p className="mt-1 text-xs text-gray-500">
                                Add products first, then link them to this option.
                              </p>
                            ) : (
                              <div className="mt-2 max-h-36 space-y-1 overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-2">
                                {initialProducts.map((product) => (
                                  <label
                                    key={`registration-option-product-${option.id}-${product.id}`}
                                    className="flex items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-white"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={option.linked_product_ids.includes(product.id)}
                                      onChange={(e) =>
                                        toggleRegistrationOptionProduct(option.id, product.id, e.target.checked)
                                      }
                                    />
                                    <span className="text-gray-800">
                                      {product.name}
                                      <span className="ml-1 text-gray-500">({product.slug})</span>
                                    </span>
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="mt-3">
                            <p className="text-xs font-medium text-gray-900">Entitlements</p>
                            <div className="mt-2 grid gap-2 md:grid-cols-2">
                              {OCCUPANCY_MODULES.filter((moduleDef) =>
                                enabledOccupancyModules.includes(moduleDef.key)
                              ).map((moduleDef) => (
                                <label key={`registration-option-entitlement-${option.id}-${moduleDef.key}`} className="block text-xs text-gray-700">
                                  {moduleDef.label}
                                  <select
                                    value={option.entitlements[moduleDef.key] ?? "no"}
                                    onChange={(e) =>
                                      setRegistrationOptionEntitlement(
                                        option.id,
                                        moduleDef.key,
                                        e.target.value as OccupancyMode
                                      )
                                    }
                                    className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs"
                                  >
                                    <option value="no">No</option>
                                    <option value="included">Included</option>
                                    <option value="purchase_required">Requires purchase</option>
                                  </select>
                                </label>
                              ))}
                            </div>
                          </div>

                          {modules.travel_accommodation.enabled && (
                            <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
                              <p className="text-xs font-medium text-gray-900">
                                Travel behavior for this option
                              </p>
                              <div className="mt-2 grid gap-2 md:grid-cols-2 text-xs">
                                <label className="block text-gray-700">
                                  Travel support
                                  <select
                                    value={getTravelPresetFromRule(
                                      getRegistrationOptionTravelRule(option)
                                    )}
                                    onChange={(e) =>
                                      applyRegistrationOptionTravelPreset(
                                        option,
                                        e.target.value as RegistrationOptionTravelPreset
                                      )
                                    }
                                    className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5"
                                  >
                                    {getAllowedTravelPresetsForScope().includes(
                                      "org_managed_travel_accommodation"
                                    ) && (
                                      <option value="org_managed_travel_accommodation">
                                        Organization Managed - Travel &amp; Accommodation
                                      </option>
                                    )}
                                    {getAllowedTravelPresetsForScope().includes(
                                      "org_managed_accommodation_only"
                                    ) && (
                                      <option value="org_managed_accommodation_only">
                                        Organization Managed - Accommodation Only
                                      </option>
                                    )}
                                    {getAllowedTravelPresetsForScope().includes("no_travel_scope") && (
                                      <option value="no_travel_scope">No Travel In Scope</option>
                                    )}
                                  </select>
                                </label>
                                <div className="grid gap-1">
                                  <label className="flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      checked={getRegistrationOptionTravelRule(option).requires_travel_intake}
                                      onChange={(e) =>
                                        applyOptionIntakeRequirement(
                                          option,
                                          "travel",
                                          e.target.checked
                                        )
                                      }
                                    />
                                    Travel section required (bulk set)
                                  </label>
                                  <label className="flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      checked={getRegistrationOptionTravelRule(option).includes_accommodation}
                                      onChange={(e) =>
                                        updateRegistrationOptionTravelRule(option, {
                                          includes_accommodation: e.target.checked,
                                        })
                                      }
                                    />
                                    Includes accommodations
                                  </label>
                                  <label className="flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      checked={
                                        getRegistrationOptionTravelRule(option)
                                          .requires_accommodation_intake
                                      }
                                      onChange={(e) =>
                                        applyOptionIntakeRequirement(
                                          option,
                                          "accommodation",
                                          e.target.checked
                                        )
                                      }
                                    />
                                    Accommodation section required (bulk set)
                                  </label>
                                </div>
                              </div>
                              <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                                <label className="block text-xs text-gray-700">
                                  Arrival date earliest
                                  <input
                                    type="datetime-local"
                                    value={getRegistrationOptionTravelRule(option).arrival_window_start}
                                    onChange={(e) => {
                                      const current = getRegistrationOptionTravelRule(option);
                                      const next: Partial<ProductTravelRule> = {
                                        arrival_window_start: e.target.value,
                                      };
                                      if (
                                        e.target.value &&
                                        current.arrival_window_end &&
                                        Date.parse(e.target.value) > Date.parse(current.arrival_window_end)
                                      ) {
                                        next.arrival_window_end = e.target.value;
                                      }
                                      updateRegistrationOptionTravelRule(option, next);
                                    }}
                                    className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs"
                                  />
                                </label>
                                <label className="block text-xs text-gray-700">
                                  Arrival date latest
                                  <input
                                    type="datetime-local"
                                    value={getRegistrationOptionTravelRule(option).arrival_window_end}
                                    onChange={(e) => {
                                      const current = getRegistrationOptionTravelRule(option);
                                      const next: Partial<ProductTravelRule> = {
                                        arrival_window_end: e.target.value,
                                      };
                                      if (
                                        e.target.value &&
                                        current.arrival_window_start &&
                                        Date.parse(e.target.value) < Date.parse(current.arrival_window_start)
                                      ) {
                                        next.arrival_window_start = e.target.value;
                                      }
                                      updateRegistrationOptionTravelRule(option, next);
                                    }}
                                    className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs"
                                  />
                                </label>
                                <label className="block text-xs text-gray-700">
                                  Departure date earliest
                                  <input
                                    type="datetime-local"
                                    value={getRegistrationOptionTravelRule(option).departure_window_start}
                                    onChange={(e) => {
                                      const current = getRegistrationOptionTravelRule(option);
                                      const next: Partial<ProductTravelRule> = {
                                        departure_window_start: e.target.value,
                                      };
                                      if (
                                        e.target.value &&
                                        current.departure_window_end &&
                                        Date.parse(e.target.value) > Date.parse(current.departure_window_end)
                                      ) {
                                        next.departure_window_end = e.target.value;
                                      }
                                      updateRegistrationOptionTravelRule(option, next);
                                    }}
                                    className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs"
                                  />
                                </label>
                                <label className="block text-xs text-gray-700">
                                  Departure date latest
                                  <input
                                    type="datetime-local"
                                    value={getRegistrationOptionTravelRule(option).departure_window_end}
                                    onChange={(e) => {
                                      const current = getRegistrationOptionTravelRule(option);
                                      const next: Partial<ProductTravelRule> = {
                                        departure_window_end: e.target.value,
                                      };
                                      if (
                                        e.target.value &&
                                        current.departure_window_start &&
                                        Date.parse(e.target.value) < Date.parse(current.departure_window_start)
                                      ) {
                                        next.departure_window_start = e.target.value;
                                      }
                                      updateRegistrationOptionTravelRule(option, next);
                                    }}
                                    className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs"
                                  />
                                </label>
                              </div>
                              <div className="mt-2 grid grid-cols-2 gap-1 text-[11px]">
                                {(
                                  [
                                    ["air", "Air"],
                                    ["rail", "Rail"],
                                    ["personal_vehicle", "Personal vehicle"],
                                    ["bus", "Bus / coach"],
                                    ["other", "Other"],
                                  ] as Array<[TravelModeKey, string]>
                                ).map(([mode, label]) => (
                                  <label
                                    key={`registration-option-${option.id}-travel-mode-${mode}`}
                                    className="flex items-center gap-1"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={getRegistrationOptionTravelRule(option).allowed_travel_modes.includes(
                                        mode
                                      )}
                                      onChange={(e) =>
                                        toggleRegistrationOptionTravelMode(option, mode, e.target.checked)
                                      }
                                    />
                                    {label}
                                  </label>
                                ))}
                              </div>
                              <div className="mt-2 rounded-lg border border-gray-200 bg-white p-2">
                                <div className="flex items-center justify-between">
                                  <p className="text-[11px] font-medium text-gray-800">Conditional overrides</p>
                                  <button
                                    type="button"
                                    onClick={() => addRegistrationOptionConditionalOverrideRule(option)}
                                    className="rounded-full border border-gray-300 px-2.5 py-0.5 text-[11px] font-medium text-gray-700 hover:bg-gray-100"
                                  >
                                    Add Rule
                                  </button>
                                </div>
                                {getRegistrationOptionTravelRule(option).conditional_overrides.length === 0 ? (
                                  <p className="mt-1 text-[11px] text-gray-500">No conditional overrides.</p>
                                ) : (
                                  <div className="mt-2 space-y-2">
                                    {getRegistrationOptionTravelRule(option).conditional_overrides.map((override) => (
                                      <div key={`registration-option-${option.id}-override-${override.id}`} className="rounded-lg border border-gray-200 bg-gray-50 p-2">
                                        <div className="grid gap-2 md:grid-cols-3">
                                          <label className="block text-[11px] text-gray-700">
                                            Rule name
                                            <input
                                              type="text"
                                              value={override.name}
                                              onChange={(e) =>
                                                updateRegistrationOptionConditionalOverrideRule(option, override.id, {
                                                  name: e.target.value,
                                                })
                                              }
                                              className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5"
                                            />
                                          </label>
                                          <label className="block text-[11px] text-gray-700">
                                            If condition
                                            <select
                                              value={override.condition}
                                              onChange={(e) =>
                                                updateRegistrationOptionConditionalOverrideRule(option, override.id, {
                                                  condition: e.target.value as ProductRuleCondition,
                                                })
                                              }
                                              className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5"
                                            >
                                              <option value="org_distance_to_airport_km_lte">Org distance to airport &lt;= X km</option>
                                              <option value="org_type_is">Org type is</option>
                                              <option value="org_type_registration_count_gt">Registrations for org type &gt; X</option>
                                            </select>
                                          </label>
                                          <label className="block text-[11px] text-gray-700">
                                            Then action
                                            <select
                                              value={override.action}
                                              onChange={(e) =>
                                                updateRegistrationOptionConditionalOverrideRule(option, override.id, {
                                                  action: e.target.value as ProductRuleAction,
                                                })
                                              }
                                              className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5"
                                            >
                                              <option value="disable_air_travel_option">Hide air travel option</option>
                                              <option value="set_travel_support_mode">Set travel support mode</option>
                                              <option value="set_offsite_auto_discount_percent">Set offsite auto discount %</option>
                                            </select>
                                          </label>
                                        </div>
                                        <div className="mt-2">
                                          <button
                                            type="button"
                                            onClick={() =>
                                              removeRegistrationOptionConditionalOverrideRule(option, override.id)
                                            }
                                            className="rounded-full border border-gray-300 px-3 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-100"
                                          >
                                            Remove Rule
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          <div className="mt-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs font-medium text-gray-900">Registration form order</p>
                              <div className="flex flex-wrap gap-2">
                                    {(() => {
                                      const optionAvailableRegistrationFields = getOptionAvailableRegistrationFields(option);
                                      const usedFieldKeys = new Set(
                                        getVisibleRegistrationOptionFormItems(option)
                                          .filter((item) => item.type === "field" && Boolean(item.field_key))
                                          .map((item) => item.field_key as RegistrationFieldKey)
                                  );
                                  const hasAdditionalFieldToAdd = optionAvailableRegistrationFields.some(
                                    (field) => !usedFieldKeys.has(field.key)
                                  );
                                      return (
                                        <>
                                          <button
                                            type="button"
                                            onClick={() => addRegistrationOptionFieldItem(option)}
                                            disabled={!hasAdditionalFieldToAdd}
                                            className={`rounded-full border border-gray-300 px-3 py-1 text-[11px] font-medium text-gray-700 ${
                                              hasAdditionalFieldToAdd
                                                ? "hover:bg-gray-100"
                                                : "cursor-not-allowed opacity-50"
                                            }`}
                                          >
                                            Add Library Field
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => addRegistrationOptionCustomQuestionItem(option)}
                                            className="rounded-full border border-gray-300 px-3 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-100"
                                      >
                                        Add Custom Question
                                      </button>
                                    </>
                                  );
                                })()}
                                <button
                                  type="button"
                                  onClick={() => addRegistrationOptionBreakItem(option)}
                                  className="rounded-full border border-gray-300 px-3 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-100"
                                >
                                  Add Break
                                </button>
                                <button
                                  type="button"
                                  onClick={() => addRegistrationOptionTitleItem(option)}
                                  className="rounded-full border border-gray-300 px-3 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-100"
                                >
                                  Add Title
                                </button>
                              </div>
                            </div>
                            <div className="mt-2 space-y-2">
                              {getVisibleRegistrationOptionFormItems(option).map((item) => (
                                <div
                                  key={`registration-option-form-item-${option.id}-${item.id}`}
                                  draggable
                                  onDragStart={(e) => {
                                    setDraggedFormItem({ optionId: option.id, itemId: item.id });
                                    e.dataTransfer.effectAllowed = "move";
                                  }}
                                  onDragEnd={() => setDraggedFormItem(null)}
                                  onDragOver={(e) => {
                                    if (!draggedFormItem) return;
                                    if (draggedFormItem.optionId !== option.id) return;
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = "move";
                                  }}
                                  onDrop={(e) => {
                                    e.preventDefault();
                                    if (!draggedFormItem) return;
                                    if (draggedFormItem.optionId !== option.id) return;
                                    reorderRegistrationOptionFormItem(
                                      option,
                                      draggedFormItem.itemId,
                                      item.id
                                    );
                                    setDraggedFormItem(null);
                                  }}
                                  className={`rounded-lg border bg-gray-50 p-3 ${
                                    draggedFormItem?.optionId === option.id &&
                                    draggedFormItem.itemId === item.id
                                      ? "border-red-300 opacity-60"
                                      : "border-gray-200"
                                  }`}
                                >
                                  <div className="grid gap-2 md:grid-cols-5">
                                      <label className="block text-xs text-gray-700">
                                      Type
                                      {item.type === "custom" ? (
                                        <div className="mt-1 inline-flex items-center rounded-lg border border-gray-200 bg-gray-100 px-2 py-1.5 text-xs font-medium text-gray-600">
                                          Custom question
                                        </div>
                                      ) : (
                                      <select
                                        value={item.type}
                                        onChange={(e) =>
                                          updateRegistrationOptionFormItem(option, item.id, {
                                            type: e.target.value as RegistrationOptionFormItem["type"],
                                            field_key:
                                              e.target.value === "field"
                                                ? (item.field_key ?? "display_name")
                                                : null,
                                            custom_key:
                                              e.target.value === "custom"
                                                ? (item.custom_key ?? createCustomFieldKey())
                                                : undefined,
                                            custom_input_type:
                                              e.target.value === "custom"
                                                ? (item.custom_input_type ?? "text")
                                                : undefined,
                                            custom_options:
                                              e.target.value === "custom"
                                                ? (item.custom_options ?? [])
                                              : undefined,
                                          })
                                        }
                                        className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs"
                                      >
                                        <option value="field">Library Field</option>
                                        <option value="break">Break</option>
                                        <option value="title">Title</option>
                                      </select>
                                      )}
                                      </label>
                                    {(() => {
                                      if (item.type === "field") {
                                            const selectedField =
                                              REGISTRATION_FIELDS.find((field) => field.key === item.field_key) ??
                                              REGISTRATION_FIELDS[0];
                                        const inputType = item.custom_input_type ?? selectedField.input_type;
                                        return (
                                          <>
                                            <label className="block text-xs text-gray-700">
                                              Question
                                              <select
                                                value={item.field_key ?? "display_name"}
                                                onChange={(e) =>
                                                  updateRegistrationOptionFormItem(option, item.id, {
                                                    field_key: e.target.value as RegistrationFieldKey,
                                                    label:
                                                      REGISTRATION_FIELDS.find((field) => field.key === e.target.value)
                                                        ?.label ?? item.label,
                                                  })
                                                }
                                                className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs"
                                              >
                                                {getOptionAvailableRegistrationFields(option).map((field) => {
                                                  const takenElsewhere = getVisibleRegistrationOptionFormItems(option).some(
                                                    (candidate) =>
                                                      candidate.id !== item.id &&
                                                      candidate.type === "field" &&
                                                      candidate.field_key === field.key
                                                  );
                                                  return (
                                                    <option
                                                      key={`registration-option-form-field-${field.key}`}
                                                      value={field.key}
                                                      disabled={takenElsewhere}
                                                    >
                                                      {field.label}
                                                    </option>
                                                  );
                                                })}
                                              </select>
                                            </label>
                                            <label className="block text-xs text-gray-700">
                                              Input type
                                              <select
                                                value={inputType}
                                                onChange={(e) =>
                                                  updateRegistrationOptionFormItem(option, item.id, {
                                                    custom_input_type: e.target.value as RegistrationFieldInputType,
                                                  })
                                                }
                                                className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs"
                                              >
                                                {REGISTRATION_INPUT_TYPES.map((inputTypeDef) => (
                                                  <option key={`registration-input-type-${inputTypeDef.key}`} value={inputTypeDef.key}>
                                                    {inputTypeDef.label}
                                                  </option>
                                                ))}
                                              </select>
                                            </label>
                                            <label className="block text-xs text-gray-700 md:col-span-2">
                                              Label
                                              <input
                                                type="text"
                                                value={item.label || selectedField.label}
                                                onChange={(e) =>
                                                  updateRegistrationOptionFormItem(option, item.id, {
                                                    label: e.target.value,
                                                  })
                                                }
                                                className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs"
                                              />
                                            </label>
                                            {(inputType === "select" ||
                                              inputType === "multiselect" ||
                                              inputType === "radio") ? (
                                              <label className="block text-xs text-gray-700 md:col-span-2">
                                                {inputType === "multiselect" ? "Checkbox" : "Dropdown"} options (comma-separated)
                                                <input
                                                  type="text"
                                                  value={
                                                    (
                                                      item.custom_input_type && item.custom_options && item.custom_options.length > 0
                                                        ? item.custom_options
                                                        : selectedField.options ?? []
                                                    ).join(", ")
                                                  }
                                                  onChange={(e) =>
                                                    updateRegistrationOptionFormItem(option, item.id, {
                                                      custom_options: e.target.value
                                                        .split(",")
                                                        .map((value) => value.trim())
                                                        .filter((value) => value.length > 0),
                                                      custom_input_type:
                                                        inputType,
                                                    })
                                                  }
                                                  className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs"
                                                  placeholder="Comma-separated values"
                                                />
                                              </label>
                                            ) : null}
                                            <div className="md:col-span-2 space-y-0.5 text-[10px] text-gray-500">
                                              <p>
                                                {REGISTRATION_SECTION_LABELS[selectedField.section]} · {selectedField.input_type}
                                                {selectedField.validation !== "none"
                                                  ? ` · validates ${selectedField.validation}`
                                                  : ""}
                                                {selectedField.prefill_source !== "none"
                                                  ? ` · prefill: ${selectedField.prefill_source}`
                                                  : ""}
                                              </p>
                                              {selectedField.description ? <p>{selectedField.description}</p> : null}
                                            </div>
                                          </>
                                        );
                                      }
                                      if (item.type === "custom") {
                                        const inputType = item.custom_input_type ?? "text";
                                        return (
                                          <>
                                            <label className="block text-xs text-gray-700">
                                              Custom question label
                                              <input
                                                type="text"
                                                value={item.label}
                                                onChange={(e) =>
                                                  updateRegistrationOptionFormItem(option, item.id, {
                                                    label: e.target.value,
                                                  })
                                                }
                                                className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs"
                                              />
                                            </label>
                                            <label className="block text-xs text-gray-700">
                                              Input type
                                              <select
                                                value={inputType}
                                                onChange={(e) =>
                                                  updateRegistrationOptionFormItem(option, item.id, {
                                                    custom_input_type: e.target.value as RegistrationFieldInputType,
                                                  })
                                                }
                                                className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs"
                                              >
                                                {REGISTRATION_INPUT_TYPES.map((inputTypeDef) => (
                                                  <option key={`registration-input-type-${inputTypeDef.key}`} value={inputTypeDef.key}>
                                                    {inputTypeDef.label}
                                                  </option>
                                                ))}
                                              </select>
                                            </label>
                                            {(inputType === "select" ||
                                              inputType === "multiselect" ||
                                              inputType === "radio") ? (
                                              <label className="block text-xs text-gray-700 md:col-span-2">
                                                {inputType === "multiselect" ? "Checkbox" : "Dropdown"} options (comma-separated)
                                                <input
                                                  type="text"
                                                  value={(item.custom_options ?? []).join(", ")}
                                                  onChange={(e) =>
                                                    updateRegistrationOptionFormItem(option, item.id, {
                                                      custom_options: e.target.value
                                                        .split(",")
                                                        .map((value) => value.trim())
                                                        .filter((value) => value.length > 0),
                                                      custom_input_type: inputType,
                                                    })
                                                  }
                                                  className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs"
                                                />
                                              </label>
                                            ) : null}
                                          </>
                                        );
                                      }
                                      return (
                                        <label className="block text-xs text-gray-700">
                                          Label
                                          <input
                                            type="text"
                                            value={item.label}
                                            onChange={(e) =>
                                              updateRegistrationOptionFormItem(option, item.id, {
                                                label: e.target.value,
                                              })
                                            }
                                            className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs"
                                          />
                                        </label>
                                      );
                                    })()}
                                    {item.type !== "break" && item.type !== "title" ? (
                                      <label className="block text-xs text-gray-700">
                                        State
                                        <select
                                          value={item.state}
                                          onChange={(e) =>
                                            updateRegistrationOptionFormItem(option, item.id, {
                                              state: e.target.value as RegistrationFieldState,
                                            })
                                          }
                                          className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs"
                                        >
                                          {REGISTRATION_FIELD_STATES.map((state) => (
                                            <option key={`registration-option-form-state-${state.key}`} value={state.key}>
                                              {state.label}
                                            </option>
                                          ))}
                                        </select>
                                      </label>
                                    ) : (
                                      <div />
                                    )}
                                    <div className="flex items-end justify-between gap-2 md:col-span-2">
                                      <span className="select-none text-[11px] font-medium text-gray-500">
                                        Drag to reorder
                                      </span>
                                      <div className="flex items-end gap-1">
                                      <button
                                        type="button"
                                        onClick={() => removeRegistrationOptionFormItem(option, item.id)}
                                        className="rounded-full border border-red-300 px-3 py-1 text-[11px] font-medium text-red-700 hover:bg-red-50"
                                      >
                                        Remove
                                      </button>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          <label className="mt-3 block text-xs text-gray-700">
                            Notes
                            <textarea
                              value={option.notes}
                              onChange={(e) => updateRegistrationOption(option.id, { notes: e.target.value })}
                              rows={2}
                              className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                            />
                          </label>

                          <div className="mt-3 flex justify-end">
                            <button
                              type="button"
                              onClick={() => removeRegistrationOption(option.id)}
                              className="rounded-full border border-red-300 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                            >
                              Delete option
                            </button>
                          </div>
                          </div>
                        </details>
                      ))
                    )}
                  </div>
                </div>

              </div>
            )}

          {currentModuleDef?.key === "sponsorship_ops" && modules.sponsorship_ops.enabled && (
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-sm font-semibold text-gray-900">Sponsorship Operations</p>
              <p className="mt-1 text-xs text-gray-600">
                Track sponsor records, linked products, activation modules, and deliverable execution.
              </p>
              <div className="mt-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={addSponsorRecord}
                      className="rounded-md bg-[#EE2A2E] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#b50001]"
                    >
                      Add Sponsor
                    </button>
                    <button
                      type="button"
                      onClick={seedSponsorsFromOffsite}
                      className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Sync Sponsored Offsite Events
                    </button>
                  </div>
                  <p className="text-xs text-gray-500">{sponsorRecords.length} sponsors</p>
                </div>

                {sponsorRecords.length === 0 && (
                  <p className="rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
                    No sponsor records yet. Add one or sync from sponsored offsite events.
                  </p>
                )}

                {sponsorRecords.map((record, index) => (
                  <div key={record.id} className="rounded-md border border-gray-200 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-gray-900">Sponsor {index + 1}</p>
                      <button
                        type="button"
                        onClick={() => removeSponsorRecord(record.id)}
                        className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                      >
                        Remove
                      </button>
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <label className="block text-xs text-gray-700">
                        Sponsor name
                        <input
                          type="text"
                          value={record.sponsor_name}
                          onChange={(e) => updateSponsorRecord(record.id, { sponsor_name: e.target.value })}
                          className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                        />
                      </label>
                      <label className="block text-xs text-gray-700">
                        Tier
                        <input
                          type="text"
                          value={record.tier}
                          onChange={(e) => updateSponsorRecord(record.id, { tier: e.target.value })}
                          className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                        />
                      </label>
                      <label className="block text-xs text-gray-700">
                        Primary contact name
                        <input
                          type="text"
                          value={record.primary_contact_name}
                          onChange={(e) =>
                            updateSponsorRecord(record.id, { primary_contact_name: e.target.value })
                          }
                          className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                        />
                      </label>
                      <label className="block text-xs text-gray-700">
                        Primary contact email
                        <input
                          type="email"
                          value={record.primary_contact_email}
                          onChange={(e) =>
                            updateSponsorRecord(record.id, { primary_contact_email: e.target.value })
                          }
                          className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                        />
                      </label>
                      <label className="block text-xs text-gray-700">
                        Linked sponsor product
                        <select
                          value={record.linked_product_id ?? ""}
                          onChange={(e) =>
                            updateSponsorRecord(record.id, {
                              linked_product_id: e.target.value || null,
                            })
                          }
                          className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                        >
                          <option value="">None</option>
                          {initialProducts.map((product) => (
                            <option key={`${record.id}-product-${product.id}`} value={product.id}>
                              {product.name} ({product.slug})
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="mt-3 rounded border border-gray-100 p-2">
                      <p className="text-xs font-medium text-gray-900">Activation Modules</p>
                      <div className="mt-1 grid grid-cols-2 gap-1 text-xs">
                        {[...OCCUPANCY_MODULES.map((moduleDef) => moduleDef.key), "communications" as const].map(
                          (moduleKey) => (
                            <label key={`${record.id}-activation-${moduleKey}`} className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={record.activation_modules.includes(moduleKey)}
                                onChange={(e) =>
                                  toggleSponsorActivationModule(record.id, moduleKey, e.target.checked)
                                }
                              />
                              {moduleKey === "communications"
                                ? "Communications"
                                : OCCUPANCY_MODULES.find((moduleDef) => moduleDef.key === moduleKey)?.label ??
                                  moduleKey}
                            </label>
                          )
                        )}
                      </div>
                    </div>

                    <div className="mt-3 rounded border border-gray-100 p-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-gray-900">
                          Deliverables ({record.deliverables.length})
                        </p>
                        <button
                          type="button"
                          onClick={() => addSponsorDeliverable(record.id)}
                          className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                        >
                          Add Deliverable
                        </button>
                      </div>

                      {record.deliverables.length === 0 && (
                        <p className="mt-2 text-xs text-gray-500">No deliverables yet.</p>
                      )}

                      <div className="mt-2 space-y-2">
                        {record.deliverables.map((deliverable) => (
                          <div key={deliverable.id} className="rounded border border-gray-200 p-2">
                            <div className="grid gap-2 md:grid-cols-3">
                              <label className="block text-xs text-gray-700">
                                Deliverable
                                <input
                                  type="text"
                                  value={deliverable.title}
                                  onChange={(e) =>
                                    updateSponsorDeliverable(record.id, deliverable.id, {
                                      title: e.target.value,
                                    })
                                  }
                                  className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                                />
                              </label>
                              <label className="block text-xs text-gray-700">
                                Module context
                                <select
                                  value={deliverable.module_context}
                                  onChange={(e) =>
                                    updateSponsorDeliverable(record.id, deliverable.id, {
                                      module_context: e.target.value as OccupancyModuleKey | "custom",
                                    })
                                  }
                                  className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                                >
                                  <option value="custom">Custom</option>
                                  {OCCUPANCY_MODULES.map((moduleDef) => (
                                    <option key={`${deliverable.id}-ctx-${moduleDef.key}`} value={moduleDef.key}>
                                      {moduleDef.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="block text-xs text-gray-700">
                                Status
                                <select
                                  value={deliverable.status}
                                  onChange={(e) =>
                                    updateSponsorDeliverable(record.id, deliverable.id, {
                                      status: e.target.value as SponsorDeliverableStatus,
                                    })
                                  }
                                  className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                                >
                                  {SPONSOR_DELIVERABLE_STATUSES.map((status) => (
                                    <option key={`${deliverable.id}-status-${status.key}`} value={status.key}>
                                      {status.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="block text-xs text-gray-700">
                                Due date
                                <input
                                  type="date"
                                  value={deliverable.due_date}
                                  onChange={(e) =>
                                    updateSponsorDeliverable(record.id, deliverable.id, {
                                      due_date: e.target.value,
                                    })
                                  }
                                  className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                                />
                              </label>
                              <label className="block text-xs text-gray-700">
                                Owner
                                <input
                                  type="text"
                                  value={deliverable.owner}
                                  onChange={(e) =>
                                    updateSponsorDeliverable(record.id, deliverable.id, {
                                      owner: e.target.value,
                                    })
                                  }
                                  className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                                />
                              </label>
                              <div className="flex items-end">
                                <button
                                  type="button"
                                  onClick={() => removeSponsorDeliverable(record.id, deliverable.id)}
                                  className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                                >
                                  Remove Deliverable
                                </button>
                              </div>
                            </div>
                            <label className="mt-2 block text-xs text-gray-700">
                              Notes
                              <textarea
                                value={deliverable.notes}
                                onChange={(e) =>
                                  updateSponsorDeliverable(record.id, deliverable.id, {
                                    notes: e.target.value,
                                  })
                                }
                                rows={2}
                                className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                              />
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>

                    <label className="mt-3 block text-xs text-gray-700">
                      Sponsor notes
                      <textarea
                        value={record.notes}
                        onChange={(e) => updateSponsorRecord(record.id, { notes: e.target.value })}
                        rows={2}
                        className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                      />
                    </label>
                  </div>
                ))}

                <label className="block text-sm text-gray-700">
                  Sponsor Ops Notes
                  <textarea
                    value={String(sponsorshipOpsConfig.notes ?? "")}
                    onChange={(e) =>
                      updateModuleConfig("sponsorship_ops", { notes: e.target.value })
                    }
                    rows={3}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    placeholder="Cross-sponsor constraints, legal notes, exceptions..."
                  />
                </label>
              </div>
            </div>
          )}

          {currentModuleDef?.key === "logistics" && modules.logistics.enabled && (
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-sm font-semibold text-gray-900">Logistics</p>
              <p className="mt-1 text-xs text-gray-600">
                Configure move-in/out blocks, freight, services, booth inclusions, parking, and logistics task execution.
              </p>
              <div className="mt-3 space-y-4">
                <div className="rounded-md border border-gray-100 p-3">
                  <p className="text-sm font-medium text-gray-900">Move-In / Move-Out</p>
                  <p className="mt-1 text-xs text-gray-500">
                    Windows are automatically enabled when a start or end time is entered.
                  </p>
                  <div className="mt-2 grid gap-3 lg:grid-cols-2">
                    <div className="rounded border border-gray-200 p-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-700">Move-In</p>
                      <div className="mt-2 grid gap-3 text-sm">
                        <label className="block text-xs text-gray-700">
                          Open time
                          <input
                            type="datetime-local"
                            value={moveInStartValue}
                            onChange={(e) => updateLogisticsWindow("move_in", "start", e.target.value)}
                            className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                          />
                        </label>
                        <label className="block text-xs text-gray-700">
                          Close time
                          <input
                            type="datetime-local"
                            min={moveInStartValue || undefined}
                            value={moveInEndValue}
                            onChange={(e) => updateLogisticsWindow("move_in", "end", e.target.value)}
                            className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                          />
                        </label>
                      </div>
                    </div>
                    <div className="rounded border border-gray-200 p-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-700">Move-Out</p>
                      <div className="mt-2 grid gap-3 text-sm">
                        <label className="block text-xs text-gray-700">
                          Open time
                          <input
                            type="datetime-local"
                            value={moveOutStartValue}
                            onChange={(e) => updateLogisticsWindow("move_out", "start", e.target.value)}
                            className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                          />
                        </label>
                        <label className="block text-xs text-gray-700">
                          Close time
                          <input
                            type="datetime-local"
                            min={moveOutStartValue || undefined}
                            value={moveOutEndValue}
                            onChange={(e) => updateLogisticsWindow("move_out", "end", e.target.value)}
                            className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2 text-sm">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={Boolean(logisticsConfig.loading_dock_schedule)}
                        onChange={(e) =>
                          updateLogisticsConfig({ loading_dock_schedule: e.target.checked })
                        }
                      />
                      Loading dock appointments required
                    </label>
                    <label className="block text-xs text-gray-700 md:col-span-2">
                      Dock/Marshall instructions
                      <textarea
                        value={String(logisticsConfig.dock_instructions ?? "")}
                        onChange={(e) => updateLogisticsConfig({ dock_instructions: e.target.value })}
                        rows={2}
                        className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                      />
                    </label>
                  </div>
                </div>
                <div className="rounded-md border border-gray-100 p-3">
                  <p className="text-sm font-medium text-gray-900">Shipping / Freight</p>
                  <div className="mt-2 grid gap-3 md:grid-cols-2 text-sm">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={Boolean(logisticsConfig.freight_intake)}
                        onChange={(e) =>
                          updateLogisticsConfig({ freight_intake: e.target.checked })
                        }
                      />
                      Freight intake workflow
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={Boolean(logisticsConfig.storage_tracking)}
                        onChange={(e) =>
                          updateLogisticsConfig({ storage_tracking: e.target.checked })
                        }
                      />
                      Onsite storage tracking
                    </label>
                    <label className="block text-xs text-gray-700">
                      Inbound shipping address
                      <textarea
                        value={String(logisticsConfig.inbound_shipping_address ?? "")}
                        onChange={(e) =>
                          updateLogisticsConfig({ inbound_shipping_address: e.target.value })
                        }
                        rows={2}
                        className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                      />
                    </label>
                    <label className="block text-xs text-gray-700">
                      Return shipping address
                      <textarea
                        value={String(logisticsConfig.return_shipping_address ?? "")}
                        onChange={(e) =>
                          updateLogisticsConfig({ return_shipping_address: e.target.value })
                        }
                        rows={2}
                        className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                      />
                    </label>
                    <label className="block text-xs text-gray-700 md:col-span-2">
                      Freight notes
                      <textarea
                        value={String(logisticsConfig.freight_notes ?? "")}
                        onChange={(e) => updateLogisticsConfig({ freight_notes: e.target.value })}
                        rows={2}
                        className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                      />
                    </label>
                  </div>
                </div>

                <div className="rounded-md border border-gray-100 p-3">
                  <p className="text-sm font-medium text-gray-900">Services (AV / Rentals / Utilities)</p>
                  <div className="mt-2 grid gap-2 md:grid-cols-2 text-xs">
                    {DEFAULT_LOGISTICS_SERVICES.map((serviceDef) => {
                      const current =
                        logisticsServices.find((service) => service.key === serviceDef.key) ??
                        serviceDef;
                      return (
                        <div key={`service-${serviceDef.key}`} className="rounded border border-gray-200 p-2">
                          <p className="font-medium text-gray-900">{LOGISTICS_SERVICE_LABELS[serviceDef.key]}</p>
                          <div className="mt-1 space-y-1">
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={current.enabled}
                                onChange={(e) =>
                                  updateLogisticsService(serviceDef.key, { enabled: e.target.checked })
                                }
                              />
                              Service enabled
                            </label>
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={current.included_in_booth}
                                onChange={(e) =>
                                  updateLogisticsService(serviceDef.key, {
                                    included_in_booth: e.target.checked,
                                  })
                                }
                              />
                              Included in booth default
                            </label>
                            <label className="block">
                              Billing mode
                              <select
                                value={current.billing_mode}
                                onChange={(e) =>
                                  updateLogisticsService(serviceDef.key, {
                                    billing_mode: e.target.value as LogisticsService["billing_mode"],
                                  })
                                }
                                className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
                              >
                                <option value="included">Included</option>
                                <option value="optional_add_on">Optional add-on</option>
                                <option value="required_add_on">Required add-on</option>
                              </select>
                            </label>
                            <label className="block">
                              Linked product
                              <select
                                value={current.linked_product_id ?? ""}
                                onChange={(e) =>
                                  updateLogisticsService(serviceDef.key, {
                                    linked_product_id: e.target.value || null,
                                  })
                                }
                                className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
                              >
                                <option value="">None</option>
                                {initialProducts.map((product) => (
                                  <option key={`logistics-service-${serviceDef.key}-${product.id}`} value={product.id}>
                                    {product.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="block">
                              Notes
                              <input
                                type="text"
                                value={current.notes}
                                onChange={(e) =>
                                  updateLogisticsService(serviceDef.key, { notes: e.target.value })
                                }
                                className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
                              />
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {modules.trade_show.enabled && (
                  <div className="rounded-md border border-gray-100 p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-gray-900">Trade Show Booth Inclusions</p>
                      <button
                        type="button"
                        onClick={addBoothInclusionPreset}
                        className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                      >
                        Add Booth Tier Preset
                      </button>
                    </div>
                    {boothInclusionPresets.length === 0 && (
                      <p className="mt-2 text-xs text-gray-500">
                        No booth inclusion presets yet. Add tier presets (table/chair/carpet/lighting/power/internet).
                      </p>
                    )}
                    <div className="mt-2 space-y-2">
                      {boothInclusionPresets.map((preset, index) => (
                        <div key={`booth-preset-${index}`} className="rounded border border-gray-200 p-2">
                          <div className="grid gap-2 md:grid-cols-4">
                            <label className="block text-xs text-gray-700">
                              Tier
                              <input
                                type="text"
                                value={preset.tier}
                                onChange={(e) =>
                                  updateBoothInclusionPreset(index, { tier: e.target.value })
                                }
                                className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
                              />
                            </label>
                            <label className="block text-xs text-gray-700">
                              Tables
                              <input
                                type="number"
                                min={0}
                                value={preset.tables}
                                onChange={(e) =>
                                  updateBoothInclusionPreset(index, { tables: Number(e.target.value) })
                                }
                                className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
                              />
                            </label>
                            <label className="block text-xs text-gray-700">
                              Chairs
                              <input
                                type="number"
                                min={0}
                                value={preset.chairs}
                                onChange={(e) =>
                                  updateBoothInclusionPreset(index, { chairs: Number(e.target.value) })
                                }
                                className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
                              />
                            </label>
                            <label className="block text-xs text-gray-700">
                              Linked product
                              <select
                                value={preset.linked_product_id ?? ""}
                                onChange={(e) =>
                                  updateBoothInclusionPreset(index, {
                                    linked_product_id: e.target.value || null,
                                  })
                                }
                                className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
                              >
                                <option value="">None</option>
                                {initialProducts.map((product) => (
                                  <option
                                    key={`booth-tier-product-${index}-${product.id}`}
                                    value={product.id}
                                  >
                                    {product.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <div className="flex items-end">
                              <button
                                type="button"
                                onClick={() => removeBoothInclusionPreset(index)}
                                className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                              >
                                Remove Tier
                              </button>
                            </div>
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={preset.carpet}
                                onChange={(e) =>
                                  updateBoothInclusionPreset(index, { carpet: e.target.checked })
                                }
                              />
                              Carpet
                            </label>
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={preset.lighting}
                                onChange={(e) =>
                                  updateBoothInclusionPreset(index, { lighting: e.target.checked })
                                }
                              />
                              Lighting
                            </label>
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={preset.power}
                                onChange={(e) =>
                                  updateBoothInclusionPreset(index, { power: e.target.checked })
                                }
                              />
                              Power
                            </label>
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={preset.internet}
                                onChange={(e) =>
                                  updateBoothInclusionPreset(index, { internet: e.target.checked })
                                }
                              />
                              Internet
                            </label>
                          </div>
                          <label className="mt-2 block text-xs text-gray-700">
                            Notes
                            <input
                              type="text"
                              value={preset.notes}
                              onChange={(e) =>
                                updateBoothInclusionPreset(index, { notes: e.target.value })
                              }
                              className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
                            />
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="rounded-md border border-gray-100 p-3">
                  <p className="text-sm font-medium text-gray-900">Onsite Parking</p>
                  <div className="mt-2 grid gap-3 md:grid-cols-2 text-sm">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={Boolean(logisticsConfig.onsite_parking_enabled)}
                        onChange={(e) =>
                          updateLogisticsConfig({ onsite_parking_enabled: e.target.checked })
                        }
                      />
                      Onsite parking managed
                    </label>
                    <label className="block text-xs text-gray-700">
                      Parking pass type
                      <input
                        type="text"
                        value={String(logisticsConfig.parking_pass_type ?? "")}
                        onChange={(e) =>
                          updateLogisticsConfig({ parking_pass_type: e.target.value })
                        }
                        className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                      />
                    </label>
                    <label className="block text-xs text-gray-700">
                      Parking lot/location
                      <input
                        type="text"
                        value={String(logisticsConfig.parking_location ?? "")}
                        onChange={(e) =>
                          updateLogisticsConfig({ parking_location: e.target.value })
                        }
                        className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                      />
                    </label>
                    <label className="block text-xs text-gray-700">
                      Parking capacity
                      <input
                        type="number"
                        min={0}
                        value={Number(logisticsConfig.parking_capacity ?? 0)}
                        onChange={(e) =>
                          updateLogisticsConfig({ parking_capacity: Number(e.target.value) })
                        }
                        className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                      />
                    </label>
                    <label className="block text-xs text-gray-700 md:col-span-2">
                      Parking notes
                      <textarea
                        value={String(logisticsConfig.parking_notes ?? "")}
                        onChange={(e) => updateLogisticsConfig({ parking_notes: e.target.value })}
                        rows={2}
                        className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                      />
                    </label>
                  </div>
                </div>

                <div className="rounded-md border border-gray-100 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-900">Logistics Task Tracker</p>
                    <button
                      type="button"
                      onClick={addLogisticsTask}
                      className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                    >
                      Add Task
                    </button>
                  </div>
                  {logisticsTasks.length === 0 && (
                    <p className="mt-2 text-xs text-gray-500">No logistics tasks yet.</p>
                  )}
                  <div className="mt-2 space-y-2">
                    {logisticsTasks.map((task) => (
                      <div key={task.id} className="rounded border border-gray-200 p-2">
                        <div className="grid gap-2 md:grid-cols-3">
                          <label className="block text-xs text-gray-700">
                            Task
                            <input
                              type="text"
                              value={task.title}
                              onChange={(e) =>
                                updateLogisticsTask(task.id, { title: e.target.value })
                              }
                              className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
                            />
                          </label>
                          <label className="block text-xs text-gray-700">
                            Category
                            <select
                              value={task.category}
                              onChange={(e) =>
                                updateLogisticsTask(task.id, {
                                  category: e.target.value as LogisticsTask["category"],
                                })
                              }
                              className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
                            >
                              <option value="move_in">Move In</option>
                              <option value="move_out">Move Out</option>
                              <option value="shipping">Shipping</option>
                              <option value="services">Services</option>
                              <option value="parking">Parking</option>
                              <option value="custom">Custom</option>
                            </select>
                          </label>
                          <label className="block text-xs text-gray-700">
                            Status
                            <select
                              value={task.status}
                              onChange={(e) =>
                                updateLogisticsTask(task.id, {
                                  status: e.target.value as LogisticsTaskStatus,
                                })
                              }
                              className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
                            >
                              {LOGISTICS_TASK_STATUSES.map((status) => (
                                <option key={`${task.id}-status-${status.key}`} value={status.key}>
                                  {status.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="block text-xs text-gray-700">
                            Owner
                            <input
                              type="text"
                              value={task.owner}
                              onChange={(e) =>
                                updateLogisticsTask(task.id, { owner: e.target.value })
                              }
                              className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
                            />
                          </label>
                          <label className="block text-xs text-gray-700">
                            Due date
                            <input
                              type="date"
                              value={task.due_date}
                              onChange={(e) =>
                                updateLogisticsTask(task.id, { due_date: e.target.value })
                              }
                              className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
                            />
                          </label>
                          <div className="flex items-end">
                            <button
                              type="button"
                              onClick={() => removeLogisticsTask(task.id)}
                              className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                            >
                              Remove Task
                            </button>
                          </div>
                        </div>
                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                          <label className="block text-xs text-gray-700">
                            Blocker reason
                            <input
                              type="text"
                              value={task.blocker_reason}
                              onChange={(e) =>
                                updateLogisticsTask(task.id, { blocker_reason: e.target.value })
                              }
                              className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
                            />
                          </label>
                          <label className="block text-xs text-gray-700">
                            Notes
                            <input
                              type="text"
                              value={task.notes}
                              onChange={(e) =>
                                updateLogisticsTask(task.id, { notes: e.target.value })
                              }
                              className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
                            />
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-md border border-gray-100 p-3">
                  <p className="text-sm font-medium text-gray-900">Run-Sheet Preview</p>
                  <p className="mt-1 text-xs text-gray-600">
                    Read-only summary of logistics decisions and linked products.
                  </p>
                  <div className="mt-2 space-y-3 text-xs">
                    <div>
                      <p className="font-medium text-gray-900">Windows</p>
                      {logisticsRunSheet.windows.length === 0 ? (
                        <p className="text-gray-500">No move-in/out windows configured.</p>
                      ) : (
                        <ul className="mt-1 space-y-1 text-gray-700">
                          {logisticsRunSheet.windows.map((window) => (
                            <li key={`run-sheet-window-${window.label}`}>
                              {window.label}: {window.start || "Unscheduled"} to {window.end || "Unscheduled"}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">Services</p>
                      {logisticsRunSheet.services.length === 0 ? (
                        <p className="text-gray-500">No enabled services.</p>
                      ) : (
                        <ul className="mt-1 space-y-1 text-gray-700">
                          {logisticsRunSheet.services.map((service) => (
                            <li key={`run-sheet-service-${service.key}`}>
                              {LOGISTICS_SERVICE_LABELS[service.key]}: {service.billing_mode.replaceAll("_", " ")}{" "}
                              ({getProductLabel(service.linked_product_id)})
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    {modules.trade_show.enabled && (
                      <div>
                        <p className="font-medium text-gray-900">Booth tiers</p>
                        {logisticsRunSheet.boothTiers.length === 0 ? (
                          <p className="text-gray-500">No booth tiers configured.</p>
                        ) : (
                          <ul className="mt-1 space-y-1 text-gray-700">
                            {logisticsRunSheet.boothTiers.map((preset, index) => (
                              <li key={`run-sheet-tier-${preset.tier}-${index}`}>
                                {preset.tier}: {preset.tables} table(s), {preset.chairs} chair(s),{" "}
                                {preset.power ? "power" : "no power"}, {preset.internet ? "internet" : "no internet"}{" "}
                                ({getProductLabel(preset.linked_product_id)})
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                    <div>
                      <p className="font-medium text-gray-900">Tasks</p>
                      {logisticsRunSheet.tasks.length === 0 ? (
                        <p className="text-gray-500">No logistics tasks configured.</p>
                      ) : (
                        <ul className="mt-1 space-y-1 text-gray-700">
                          {logisticsRunSheet.tasks.map((task) => (
                            <li key={`run-sheet-task-${task.id}`}>
                              {task.title || "(Untitled)"} - {task.status}
                              {task.owner ? ` - owner: ${task.owner}` : ""}
                              {task.due_date ? ` - due: ${task.due_date}` : ""}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
                <label className="block text-sm text-gray-700">
                  Logistics Notes
                  <textarea
                    value={String(logisticsConfig.notes ?? "")}
                    onChange={(e) => updateLogisticsConfig({ notes: e.target.value })}
                    rows={3}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    placeholder="Dock windows, carrier rules, storage constraints..."
                  />
                </label>
              </div>
            </div>
          )}

          {currentModuleDef?.key === "travel_accommodation" && modules.travel_accommodation.enabled && (
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-sm font-semibold text-gray-900">Travel + Accommodation</p>
              <p className="mt-1 text-xs text-gray-600">
                Configure admin-facing travel/accommodation policy and attendee-facing guidance.
              </p>
              <div className="mt-3 space-y-4">
                <div className="rounded-md border border-gray-100 p-3">
                  <p className="text-sm font-medium text-gray-900">Capability Scope</p>
                  <div className="mt-2 grid gap-3 md:grid-cols-2 text-sm">
                    <label className="block text-xs text-gray-700">
                      Travel managed scope
                      <select
                        value={travelManagementScope}
                        onChange={(e) => setTravelManagementScope(e.target.value as ManagementScope)}
                        className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                      >
                        {MANAGEMENT_SCOPE_OPTIONS.map((option) => (
                          <option key={`travel-scope-${option.key}`} value={option.key}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <span className="mt-1 block text-xs text-gray-500">
                        {
                          MANAGEMENT_SCOPE_OPTIONS.find(
                            (option) => option.key === travelManagementScope
                          )?.description
                        }
                      </span>
                    </label>
                    <label className="block text-xs text-gray-700">
                      Accommodation managed scope
                      <select
                        value={accommodationManagementScope}
                        onChange={(e) =>
                          setAccommodationManagementScope(e.target.value as ManagementScope)
                        }
                        className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                      >
                        {MANAGEMENT_SCOPE_OPTIONS.map((option) => (
                          <option key={`accommodation-scope-${option.key}`} value={option.key}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <span className="mt-1 block text-xs text-gray-500">
                        {
                          MANAGEMENT_SCOPE_OPTIONS.find(
                            (option) => option.key === accommodationManagementScope
                          )?.description
                        }
                      </span>
                    </label>
                  </div>
                </div>

                <div className="rounded-md border border-gray-100 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-gray-900">Travel Rules (Enforced)</p>
                    {hasLegacyTravelRuleKeys ? (
                      <button
                        type="button"
                        onClick={migrateLegacyTravelRuleKeysToProductKeys}
                        className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                      >
                        Normalize Legacy Rule Keys
                      </button>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-gray-600">
                    These settings are evaluated at registration time and drive allowed travel options.
                  </p>
                  <div className="mt-2 grid gap-3 md:grid-cols-2 text-sm">
                    <label className="block text-xs text-gray-700">
                      Disable air travel when organization is within X km of destination
                      <input
                        type="number"
                        min={0}
                        value={travelDisableAirWithinKm}
                        onChange={(e) =>
                          updateTravelAccommodationConfig({
                            travel_disable_air_within_km: e.target.value
                              ? Number(e.target.value)
                              : null,
                          })
                        }
                        className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                        placeholder="250"
                      />
                      <span className="mt-1 block text-xs text-gray-500">
                        Leave blank to disable this distance rule.
                      </span>
                    </label>
                    <label className="block text-xs text-gray-700">
                      Nearby attendee support mode
                      <select
                        value={travelNearbySupportMode}
                        onChange={(e) =>
                          updateTravelAccommodationConfig({
                            travel_nearby_support_mode: e.target.value,
                          })
                        }
                        className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                      >
                        <option value="managed">Managed (we book)</option>
                        <option value="reimbursement">Reimbursement (they book)</option>
                        <option value="self_managed">Self-managed (no reimbursement)</option>
                        <option value="none">No travel support</option>
                      </select>
                    </label>
                  </div>
                  {travelSectionDirty.travel_rules && (
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        onClick={() => void saveSection("Travel Rules")}
                        disabled={isSaving}
                        className="rounded-md bg-[#EE2A2E] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#b50001] disabled:opacity-60"
                      >
                        {isSaving ? "Saving..." : "Save Travel Rules"}
                      </button>
                    </div>
                  )}
                </div>

                <div className="rounded-md border border-gray-100 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-900">Accommodations</p>
                    <button
                      type="button"
                      onClick={addTravelHotel}
                      className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                    >
                      Add Hotel
                    </button>
                  </div>
                  {travelHotels.length === 0 ? (
                    <p className="mt-2 text-xs text-gray-500">No hotels configured yet.</p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {travelHotels.map((hotel) => (
                        <div key={`hotel-${hotel.id}`} className="rounded border border-gray-200 p-2">
                          <div className="grid gap-2 md:grid-cols-2 text-xs">
                            <label className="block text-gray-700">
                              Hotel search (Google Places)
                              <input
                                ref={(node) => {
                                  hotelPlaceInputRefs.current[hotel.id] = node;
                                }}
                                type="text"
                                defaultValue={hotel.name}
                                placeholder="Start typing hotel name..."
                                className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                              />
                            </label>
                            <label className="block text-gray-700">
                              Hotel name
                              <input
                                type="text"
                                value={hotel.name}
                                onChange={(e) => updateTravelHotel(hotel.id, { name: e.target.value })}
                                className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                              />
                            </label>
                            <label className="block text-gray-700 md:col-span-2">
                              Address
                              <input
                                type="text"
                                value={hotel.address}
                                onChange={(e) =>
                                  updateTravelHotel(hotel.id, { address: e.target.value })
                                }
                                className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                              />
                            </label>
                            <label className="block text-gray-700">
                              Google Place ID
                              <input
                                type="text"
                                value={hotel.google_place_id}
                                onChange={(e) =>
                                  updateTravelHotel(hotel.id, { google_place_id: e.target.value })
                                }
                                className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                              />
                            </label>
                            <label className="block text-gray-700">
                              Nightly rate
                              <input
                                type="number"
                                min={0}
                                value={hotel.nightly_rate}
                                onChange={(e) =>
                                  updateTravelHotel(hotel.id, { nightly_rate: Number(e.target.value) })
                                }
                                className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                              />
                            </label>
                            <label className="block text-gray-700">
                              Currency
                              <input
                                type="text"
                                value={hotel.currency}
                                onChange={(e) =>
                                  updateTravelHotel(hotel.id, {
                                    currency: e.target.value.toUpperCase().slice(0, 3),
                                  })
                                }
                                className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                              />
                            </label>
                            <label className="block text-gray-700">
                              Contact name
                              <input
                                type="text"
                                value={hotel.contact_name}
                                onChange={(e) =>
                                  updateTravelHotel(hotel.id, { contact_name: e.target.value })
                                }
                                className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                              />
                            </label>
                            <label className="block text-gray-700">
                              Contact email
                              <input
                                type="email"
                                value={hotel.contact_email}
                                onChange={(e) =>
                                  updateTravelHotel(hotel.id, { contact_email: e.target.value })
                                }
                                className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                              />
                            </label>
                            <label className="block text-gray-700">
                              Contact phone
                              <input
                                type="text"
                                value={hotel.contact_phone}
                                onChange={(e) =>
                                  updateTravelHotel(hotel.id, { contact_phone: e.target.value })
                                }
                                className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                              />
                            </label>
                            <label className="block text-gray-700">
                              Room block URL
                              <input
                                type="url"
                                value={hotel.room_block_url}
                                onChange={(e) =>
                                  updateTravelHotel(hotel.id, { room_block_url: e.target.value })
                                }
                                className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                              />
                            </label>
                            <label className="block text-gray-700">
                              Room block code
                              <input
                                type="text"
                                value={hotel.room_block_code}
                                onChange={(e) =>
                                  updateTravelHotel(hotel.id, { room_block_code: e.target.value })
                                }
                                className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                              />
                            </label>
                            <label className="flex items-center gap-2 text-gray-700 md:col-span-2">
                              <input
                                type="checkbox"
                                checked={hotel.share_contact_with_attendees}
                                onChange={(e) =>
                                  updateTravelHotel(hotel.id, {
                                    share_contact_with_attendees: e.target.checked,
                                  })
                                }
                              />
                              Share hotel contact info with attendees
                            </label>
                            <label className="block text-gray-700 md:col-span-2">
                              Notes
                              <textarea
                                value={hotel.notes}
                                onChange={(e) =>
                                  updateTravelHotel(hotel.id, { notes: e.target.value })
                                }
                                rows={2}
                                className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                              />
                            </label>
                          </div>
                          <div className="mt-2">
                            <button
                              type="button"
                              onClick={() => removeTravelHotel(hotel.id)}
                              className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-50"
                            >
                              Remove Hotel
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {travelSectionDirty.hotels && (
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        onClick={() => void saveSection("Accommodations")}
                        disabled={isSaving}
                        className="rounded-md bg-[#EE2A2E] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#b50001] disabled:opacity-60"
                      >
                        {isSaving ? "Saving..." : "Save Accommodations"}
                      </button>
                    </div>
                  )}
                </div>

                <div className="rounded-md border border-gray-100 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-900">Travel Destinations</p>
                    <button
                      type="button"
                      onClick={addDestinationAirport}
                      className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                    >
                      Add Destination Airport
                    </button>
                  </div>
                  {destinationAirports.length === 0 ? (
                    <p className="mt-2 text-xs text-gray-500">No destination airports configured yet.</p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {destinationAirports.map((airport) => (
                        <div key={`airport-${airport.id}`} className="rounded border border-gray-200 p-2">
                          <div className="mb-2 grid gap-2 md:grid-cols-[1fr_auto] text-xs">
                            <label className="block text-gray-700">
                              Airport lookup (code, airport, city)
                              <input
                                type="text"
                                value={airportLookupQueryById[airport.id] ?? ""}
                                onChange={(e) =>
                                  setAirportLookupQueryById((prev) => ({
                                    ...prev,
                                    [airport.id]: e.target.value,
                                  }))
                                }
                                onBlur={(e) => {
                                  void applyAirportLookup(airport.id, e.target.value);
                                }}
                                className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                                placeholder="YTZ or Billy Bishop"
                              />
                            </label>
                            <div className="flex items-end">
                              <button
                                type="button"
                                onClick={() =>
                                  void applyAirportLookup(
                                    airport.id,
                                    airportLookupQueryById[airport.id] ?? ""
                                  )
                                }
                                disabled={Boolean(airportLookupLoadingById[airport.id])}
                                className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                              >
                                {airportLookupLoadingById[airport.id] ? "Looking up..." : "Apply Lookup"}
                              </button>
                            </div>
                          </div>
                          {airportLookupErrorById[airport.id] ? (
                            <p className="mb-2 text-[11px] text-amber-700">
                              {airportLookupErrorById[airport.id]}
                            </p>
                          ) : null}
                          <div className="grid gap-2 md:grid-cols-3 text-xs">
                            <label className="block text-gray-700">
                              Airport code
                              <input
                                type="text"
                                value={airport.code}
                                onChange={(e) =>
                                  updateDestinationAirport(airport.id, {
                                    code: e.target.value.toUpperCase(),
                                    code_type: "",
                                  })
                                }
                                onBlur={(e) => {
                                  void applyAirportLookup(airport.id, e.target.value);
                                }}
                                className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                                placeholder="YEG"
                              />
                              {airport.code_type === "metro" && (
                                <span className="mt-1 block text-[11px] text-amber-700">
                                  Metro/city code. This is not a specific physical airport.
                                </span>
                              )}
                            </label>
                            <label className="block text-gray-700">
                              Airport name
                              <input
                                type="text"
                                value={airport.name}
                                onChange={(e) =>
                                  updateDestinationAirport(airport.id, { name: e.target.value })
                                }
                                onBlur={(e) => {
                                  if (!airport.code.trim()) {
                                    void applyAirportLookup(airport.id, e.target.value);
                                  }
                                }}
                                className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                              />
                            </label>
                            <label className="block text-gray-700">
                              City
                              <input
                                type="text"
                                value={airport.city}
                                onChange={(e) =>
                                  updateDestinationAirport(airport.id, { city: e.target.value })
                                }
                                className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                              />
                            </label>
                            <label className="block text-gray-700">
                              Country
                              <input
                                type="text"
                                value={airport.country}
                                onChange={(e) =>
                                  updateDestinationAirport(airport.id, {
                                    country: e.target.value.toUpperCase(),
                                  })
                                }
                                className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                                placeholder="CA"
                              />
                            </label>
                            <label className="block text-gray-700 md:col-span-2">
                              Ground transfer notes
                              <input
                                type="text"
                                value={airport.ground_transfer_notes}
                                onChange={(e) =>
                                  updateDestinationAirport(airport.id, {
                                    ground_transfer_notes: e.target.value,
                                  })
                                }
                                className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                              />
                            </label>
                          </div>
                          <div className="mt-2">
                            <button
                              type="button"
                              onClick={() => removeDestinationAirport(airport.id)}
                              className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-50"
                            >
                              Remove Airport
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {travelSectionDirty.destination_airports && (
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        onClick={() => void saveSection("Travel Destinations")}
                        disabled={isSaving}
                        className="rounded-md bg-[#EE2A2E] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#b50001] disabled:opacity-60"
                      >
                        {isSaving ? "Saving..." : "Save Destinations"}
                      </button>
                    </div>
                  )}
                </div>

                <div className="rounded-md border border-gray-100 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-900">Airline Policies</p>
                    <button
                      type="button"
                      onClick={addAirlinePolicy}
                      className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                    >
                      Add Airline
                    </button>
                  </div>
                  {airlinePolicies.length === 0 ? (
                    <p className="mt-2 text-xs text-gray-500">No airline policy entries yet.</p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {airlinePolicies.map((policy) => (
                        <div key={`airline-policy-${policy.id}`} className="rounded border border-gray-200 p-2">
                          <div className="grid gap-2 md:grid-cols-3 text-xs">
                            <label className="block text-gray-700">
                              Airline name
                              <input
                                type="text"
                                value={policy.airline_name}
                                onChange={(e) =>
                                  updateAirlinePolicy(policy.id, { airline_name: e.target.value })
                                }
                                className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                              />
                            </label>
                            <label className="block text-gray-700">
                              Airline code
                              <input
                                type="text"
                                value={policy.airline_code}
                                onChange={(e) =>
                                  updateAirlinePolicy(policy.id, {
                                    airline_code: e.target.value.toUpperCase(),
                                  })
                                }
                                className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                              />
                            </label>
                            <label className="block text-gray-700">
                              Seating / booking level
                              <input
                                type="text"
                                value={policy.booking_class_policy}
                                onChange={(e) =>
                                  updateAirlinePolicy(policy.id, {
                                    booking_class_policy: e.target.value,
                                  })
                                }
                                className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                                placeholder="Economy Flex, Premium Economy..."
                              />
                            </label>
                            <label className="block text-gray-700">
                              Bags included
                              <input
                                type="number"
                                min={0}
                                value={policy.bags_included}
                                onChange={(e) =>
                                  updateAirlinePolicy(policy.id, {
                                    bags_included: Number(e.target.value),
                                  })
                                }
                                className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                              />
                            </label>
                            <label className="flex items-center gap-2 text-gray-700">
                              <input
                                type="checkbox"
                                checked={policy.meal_included}
                                onChange={(e) =>
                                  updateAirlinePolicy(policy.id, {
                                    meal_included: e.target.checked,
                                  })
                                }
                              />
                              Meal included
                            </label>
                            <label className="block text-gray-700 md:col-span-3">
                              Change / cancellation notes
                              <input
                                type="text"
                                value={policy.change_policy_notes}
                                onChange={(e) =>
                                  updateAirlinePolicy(policy.id, {
                                    change_policy_notes: e.target.value,
                                  })
                                }
                                className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                              />
                            </label>
                            <label className="block text-gray-700 md:col-span-3">
                              Notes
                              <textarea
                                value={policy.notes}
                                onChange={(e) =>
                                  updateAirlinePolicy(policy.id, { notes: e.target.value })
                                }
                                rows={2}
                                className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                              />
                            </label>
                          </div>
                          <div className="mt-2">
                            <button
                              type="button"
                              onClick={() => removeAirlinePolicy(policy.id)}
                              className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-50"
                            >
                              Remove Airline
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {travelSectionDirty.airline_policies && (
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        onClick={() => void saveSection("Airline Policies")}
                        disabled={isSaving}
                        className="rounded-md bg-[#EE2A2E] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#b50001] disabled:opacity-60"
                      >
                        {isSaving ? "Saving..." : "Save Airlines"}
                      </button>
                    </div>
                  )}
                </div>

                <div className="rounded-md border border-gray-100 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-900">Travel Policies</p>
                    <button
                      type="button"
                      onClick={addTravelPolicy}
                      className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                    >
                      Add Travel Policy
                    </button>
                  </div>
                  {travelPolicies.length === 0 ? (
                    <p className="mt-2 text-xs text-gray-500">No travel policies yet.</p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {travelPolicies.map((policy) => (
                        <div key={`travel-policy-${policy.id}`} className="rounded border border-gray-200 p-2">
                          <div className="grid gap-2 md:grid-cols-2 text-xs">
                            <label className="block text-gray-700">
                              Title
                              <input
                                type="text"
                                value={policy.title}
                                onChange={(e) =>
                                  updateTravelPolicy(policy.id, { title: e.target.value })
                                }
                                className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                              />
                            </label>
                            <label className="block text-gray-700">
                              Applies to registration types
                              <div className="mt-1 flex flex-wrap gap-2 rounded border border-gray-300 p-2">
                                {REGISTRATION_TYPES.map((type) => (
                                  <label key={`${policy.id}-applies-${type.key}`} className="flex items-center gap-1">
                                    <input
                                      type="checkbox"
                                      checked={policy.applies_to_registration_types.includes(type.key)}
                                      onChange={(e) => {
                                        const next = new Set(policy.applies_to_registration_types);
                                        if (e.target.checked) next.add(type.key);
                                        else next.delete(type.key);
                                        updateTravelPolicy(policy.id, {
                                          applies_to_registration_types: Array.from(next),
                                        });
                                      }}
                                    />
                                    {type.label}
                                  </label>
                                ))}
                              </div>
                            </label>
                            <label className="block text-gray-700">
                              Effective from
                              <input
                                type="date"
                                value={policy.effective_from}
                                onChange={(e) =>
                                  updateTravelPolicy(policy.id, { effective_from: e.target.value })
                                }
                                className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                              />
                            </label>
                            <label className="block text-gray-700">
                              Effective to
                              <input
                                type="date"
                                value={policy.effective_to}
                                onChange={(e) =>
                                  updateTravelPolicy(policy.id, { effective_to: e.target.value })
                                }
                                className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                              />
                            </label>
                            <label className="block text-gray-700 md:col-span-2">
                              Policy text
                              <textarea
                                value={policy.policy_text}
                                onChange={(e) =>
                                  updateTravelPolicy(policy.id, { policy_text: e.target.value })
                                }
                                rows={3}
                                className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                              />
                            </label>
                          </div>
                          <div className="mt-2">
                            <button
                              type="button"
                              onClick={() => removeTravelPolicy(policy.id)}
                              className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-50"
                            >
                              Remove Policy
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {travelSectionDirty.travel_policies && (
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        onClick={() => void saveSection("Travel Policies")}
                        disabled={isSaving}
                        className="rounded-md bg-[#EE2A2E] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#b50001] disabled:opacity-60"
                      >
                        {isSaving ? "Saving..." : "Save Travel Policies"}
                      </button>
                    </div>
                  )}
                </div>

                <div className="rounded-md border border-gray-100 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-900">Reimbursement Policies</p>
                    <button
                      type="button"
                      onClick={addReimbursementPolicy}
                      className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                    >
                      Add Reimbursement Policy
                    </button>
                  </div>
                  {reimbursementPolicies.length === 0 ? (
                    <p className="mt-2 text-xs text-gray-500">No reimbursement policies yet.</p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {reimbursementPolicies.map((policy) => (
                        <div key={`reimburse-policy-${policy.id}`} className="rounded border border-gray-200 p-2">
                          <div className="grid gap-2 md:grid-cols-2 text-xs">
                            <label className="block text-gray-700">
                              Title
                              <input
                                type="text"
                                value={policy.title}
                                onChange={(e) =>
                                  updateReimbursementPolicy(policy.id, { title: e.target.value })
                                }
                                className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                              />
                            </label>
                            <label className="block text-gray-700">
                              Submission SLA (days)
                              <input
                                type="number"
                                min={0}
                                value={policy.submission_sla_days}
                                onChange={(e) =>
                                  updateReimbursementPolicy(policy.id, {
                                    submission_sla_days: Number(e.target.value),
                                  })
                                }
                                className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                              />
                            </label>
                            <label className="block text-gray-700 md:col-span-2">
                              Covered items
                              <textarea
                                value={policy.covered_items}
                                onChange={(e) =>
                                  updateReimbursementPolicy(policy.id, {
                                    covered_items: e.target.value,
                                  })
                                }
                                rows={2}
                                className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                              />
                            </label>
                            <label className="block text-gray-700 md:col-span-2">
                              Caps and limits
                              <textarea
                                value={policy.caps_and_limits}
                                onChange={(e) =>
                                  updateReimbursementPolicy(policy.id, {
                                    caps_and_limits: e.target.value,
                                  })
                                }
                                rows={2}
                                className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                              />
                            </label>
                            <label className="block text-gray-700 md:col-span-2">
                              Receipt requirements
                              <textarea
                                value={policy.receipt_requirements}
                                onChange={(e) =>
                                  updateReimbursementPolicy(policy.id, {
                                    receipt_requirements: e.target.value,
                                  })
                                }
                                rows={2}
                                className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                              />
                            </label>
                            <label className="block text-gray-700 md:col-span-2">
                              Payout timeline
                              <input
                                type="text"
                                value={policy.payout_timeline}
                                onChange={(e) =>
                                  updateReimbursementPolicy(policy.id, {
                                    payout_timeline: e.target.value,
                                  })
                                }
                                className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                              />
                            </label>
                          </div>
                          <div className="mt-2">
                            <button
                              type="button"
                              onClick={() => removeReimbursementPolicy(policy.id)}
                              className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-50"
                            >
                              Remove Reimbursement Policy
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {travelSectionDirty.reimbursement_policies && (
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        onClick={() => void saveSection("Reimbursement Policies")}
                        disabled={isSaving}
                        className="rounded-md bg-[#EE2A2E] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#b50001] disabled:opacity-60"
                      >
                        {isSaving ? "Saving..." : "Save Reimbursement Policies"}
                      </button>
                    </div>
                  )}
                </div>

                {false && (
                <div className="rounded-md border border-gray-100 p-3">
                  <p className="text-sm font-medium text-gray-900">Required Intake Fields</p>
                  <p className="mt-1 text-xs text-gray-600">
                    Defaults are set by management mode. You can override any field below.
                  </p>
                  <div className="mt-2 grid gap-3 lg:grid-cols-2">
                    <div className="rounded border border-gray-200 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-700">
                        Travel Fields
                      </p>
                      <div className="mt-2 space-y-1 text-xs">
                        {TRAVEL_FIELD_DEFS.map((field) => {
                          const defaultRequired = defaultRequiredTravelFields.includes(field.key);
                          const value =
                            typeof requiredTravelFieldOverrides[field.key] === "boolean"
                              ? Boolean(requiredTravelFieldOverrides[field.key])
                              : defaultRequired;
                          return (
                            <label key={`travel-required-${field.key}`} className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={value}
                                onChange={(e) => setTravelFieldOverride(field.key, e.target.checked)}
                              />
                              {field.label}
                              {defaultRequired ? (
                                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">
                                  default
                                </span>
                              ) : null}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    <div className="rounded border border-gray-200 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-700">
                        Accommodation Fields
                      </p>
                      <div className="mt-2 space-y-1 text-xs">
                        {ACCOMMODATION_FIELD_DEFS.map((field) => {
                          const defaultRequired =
                            defaultRequiredAccommodationFields.includes(field.key);
                          const value =
                            typeof requiredAccommodationFieldOverrides[field.key] === "boolean"
                              ? Boolean(requiredAccommodationFieldOverrides[field.key])
                              : defaultRequired;
                          return (
                            <label
                              key={`accommodation-required-${field.key}`}
                              className="flex items-center gap-2"
                            >
                              <input
                                type="checkbox"
                                checked={value}
                                onChange={(e) =>
                                  setAccommodationFieldOverride(field.key, e.target.checked)
                                }
                              />
                              {field.label}
                              {defaultRequired ? (
                                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">
                                  default
                                </span>
                              ) : null}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
                )}

                {false && registrationOptions.length === 0 && (
                <div className="rounded-md border border-gray-100 p-3">
                  <p className="text-sm font-medium text-gray-900">Registration Option Sources</p>
                  <p className="mt-1 text-xs text-gray-600">
                    Manage linked products by registration type. These are the only options that appear in the travel rule editor.
                  </p>
                  {initialProducts.length === 0 ? (
                    <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">
                      No conference products found yet. Add products in commerce first.
                    </p>
                  ) : (
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      {selectedRegistrationTypes.map((type) => {
                        const linkedProducts = parseLinkedProductIds(type);
                        const availableProducts = initialProducts.filter(
                          (product) => !linkedProducts.includes(product.id)
                        );
                        const draftSelection = travelSourceDraftByType[type] ?? "";
                        return (
                          <div key={`travel-product-link-${type}`} className="rounded border border-gray-200 p-2">
                            <p className="text-xs font-semibold text-gray-900">
                              {REGISTRATION_TYPES.find((entry) => entry.key === type)?.label ?? type}
                            </p>
                            {linkedProducts.length === 0 ? (
                              <p className="mt-2 text-xs text-gray-500">No linked products yet.</p>
                            ) : (
                              <div className="mt-2 max-h-44 space-y-1 overflow-auto pr-1">
                                {linkedProducts.map((productId) => {
                                  const product = initialProducts.find((entry) => entry.id === productId);
                                  return (
                                    <div
                                      key={`travel-linked-${type}-${productId}`}
                                      className="flex items-center justify-between gap-2 rounded border border-gray-100 px-2 py-1 text-xs"
                                    >
                                      <span>
                                        <span className="font-medium text-gray-900">
                                          {product?.name ?? productId}
                                        </span>
                                        {product?.slug ? (
                                          <span className="ml-1 text-gray-500">({product.slug})</span>
                                        ) : null}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => toggleLinkedProduct(type, productId, false)}
                                        className="rounded border border-gray-300 px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50"
                                      >
                                        Remove
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                            <div className="mt-2 flex items-center gap-2">
                              <select
                                value={draftSelection}
                                onChange={(e) => setTravelSourceDraftProduct(type, e.target.value)}
                                className="block w-full rounded border border-gray-300 px-2 py-1 text-xs"
                              >
                                <option value="">Add product…</option>
                                {availableProducts.map((product) => (
                                  <option key={`travel-source-add-${type}-${product.id}`} value={product.id}>
                                    {product.name}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={() => addTravelSourceProduct(type)}
                                disabled={!draftSelection}
                                className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                              >
                                Add
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                )}

                {false && registrationOptions.length === 0 && (
                <div className="rounded-md border border-gray-100 p-3">
                  <p className="text-sm font-medium text-gray-900">
                    Registration Option Travel Rules
                  </p>
                  <p className="mt-1 text-xs text-gray-600">
                    Define per-registration-product travel behavior (ex: Meetings Only, no stay,
                    personal vehicle mileage, self-managed travel).
                  </p>
                  <div className="mt-3 space-y-3">
                    {selectedRegistrationTypes.map((type) => {
                      const linkedProducts = parseLinkedProductIds(type);
                      const typeLabel =
                        REGISTRATION_TYPES.find((entry) => entry.key === type)?.label ?? type;
                      return (
                        <div key={`travel-rules-${type}`} className="rounded border border-gray-200 p-2">
                          <p className="text-xs font-semibold text-gray-900">{typeLabel}</p>
                          {linkedProducts.length === 0 ? (
                            <p className="mt-1 text-xs text-gray-500">
                              No linked registration products for this type.
                            </p>
                          ) : (
                            <div className="mt-2 space-y-2">
                              {linkedProducts.map((productId) => {
                                const product = initialProducts.find((item) => item.id === productId);
                                const rule = getProductTravelRule(type, productId);
                                return (
                                  <div key={`travel-rule-${type}-${productId}`} className="rounded border border-gray-100 p-2">
                                    <p className="text-xs font-medium text-gray-900">
                                      {product?.name ?? productId}
                                    </p>
                                    <div className="mt-2 grid gap-2 md:grid-cols-2 text-xs">
                                      <label className="block text-gray-700">
                                        Travel support
                                        <select
                                          value={getTravelPresetFromRule(rule)}
                                          onChange={(e) =>
                                            applyProductTravelPreset(
                                              type,
                                              productId,
                                              e.target.value as RegistrationOptionTravelPreset
                                            )
                                          }
                                          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                                        >
                                          {getAllowedTravelPresetsForScope().includes(
                                            "org_managed_travel_accommodation"
                                          ) && (
                                            <option value="org_managed_travel_accommodation">
                                              Organization Managed - Travel &amp; Accommodation
                                            </option>
                                          )}
                                          {getAllowedTravelPresetsForScope().includes(
                                            "org_managed_accommodation_only"
                                          ) && (
                                            <option value="org_managed_accommodation_only">
                                              Organization Managed - Accommodation Only
                                            </option>
                                          )}
                                          {getAllowedTravelPresetsForScope().includes("no_travel_scope") && (
                                            <option value="no_travel_scope">No Travel In Scope</option>
                                          )}
                                        </select>
                                      </label>
                                      <div className="grid gap-1">
                                        <label className="flex items-center gap-2">
                                          <input
                                            type="checkbox"
                                            checked={rule.requires_travel_intake}
                                            onChange={(e) =>
                                              updateProductTravelRule(type, productId, {
                                                requires_travel_intake: e.target.checked,
                                              })
                                            }
                                          />
                                          Require travel intake
                                        </label>
                                        <label className="flex items-center gap-2">
                                          <input
                                            type="checkbox"
                                            checked={rule.includes_accommodation}
                                            onChange={(e) =>
                                              updateProductTravelRule(type, productId, {
                                                includes_accommodation: e.target.checked,
                                              })
                                            }
                                          />
                                          Includes accommodations
                                        </label>
                                        <label className="flex items-center gap-2">
                                          <input
                                            type="checkbox"
                                            checked={rule.requires_accommodation_intake}
                                            onChange={(e) =>
                                              updateProductTravelRule(type, productId, {
                                                requires_accommodation_intake: e.target.checked,
                                              })
                                            }
                                          />
                                          Require accommodation intake
                                        </label>
                                      </div>
                                    </div>
                                    <div className="mt-2 rounded border border-gray-200 p-2">
                                      <p className="text-[11px] font-medium text-gray-800">
                                        Allowed travel modes
                                      </p>
                                      <div className="mt-1 grid grid-cols-2 gap-1 text-[11px]">
                                        {(
                                          [
                                            ["air", "Air"],
                                            ["rail", "Rail"],
                                            ["personal_vehicle", "Personal vehicle"],
                                            ["bus", "Bus / coach"],
                                            ["other", "Other"],
                                          ] as Array<[TravelModeKey, string]>
                                        ).map(([mode, label]) => (
                                          <label
                                            key={`rule-${type}-${productId}-${mode}`}
                                            className="flex items-center gap-1"
                                          >
                                            <input
                                              type="checkbox"
                                              checked={rule.allowed_travel_modes.includes(mode)}
                                              onChange={(e) =>
                                                toggleProductTravelMode(type, productId, mode, e.target.checked)
                                              }
                                            />
                                            {label}
                                          </label>
                                        ))}
                                      </div>
                                    </div>
                                    <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                                      <label className="block text-xs text-gray-700">
                                        Arrival date earliest
                                        <input
                                          type="datetime-local"
                                          value={rule.arrival_window_start}
                                          onChange={(e) => {
                                            const next: Partial<ProductTravelRule> = {
                                              arrival_window_start: e.target.value,
                                            };
                                            if (
                                              e.target.value &&
                                              rule.arrival_window_end &&
                                              Date.parse(e.target.value) > Date.parse(rule.arrival_window_end)
                                            ) {
                                              next.arrival_window_end = e.target.value;
                                            }
                                            updateProductTravelRule(type, productId, next);
                                          }}
                                          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                                        />
                                      </label>
                                      <label className="block text-xs text-gray-700">
                                        Arrival date latest
                                        <input
                                          type="datetime-local"
                                          value={rule.arrival_window_end}
                                          onChange={(e) => {
                                            const next: Partial<ProductTravelRule> = {
                                              arrival_window_end: e.target.value,
                                            };
                                            if (
                                              e.target.value &&
                                              rule.arrival_window_start &&
                                              Date.parse(e.target.value) < Date.parse(rule.arrival_window_start)
                                            ) {
                                              next.arrival_window_start = e.target.value;
                                            }
                                            updateProductTravelRule(type, productId, next);
                                          }}
                                          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                                        />
                                      </label>
                                      <label className="block text-xs text-gray-700">
                                        Departure date earliest
                                        <input
                                          type="datetime-local"
                                          value={rule.departure_window_start}
                                          onChange={(e) => {
                                            const next: Partial<ProductTravelRule> = {
                                              departure_window_start: e.target.value,
                                            };
                                            if (
                                              e.target.value &&
                                              rule.departure_window_end &&
                                              Date.parse(e.target.value) > Date.parse(rule.departure_window_end)
                                            ) {
                                              next.departure_window_end = e.target.value;
                                            }
                                            updateProductTravelRule(type, productId, next);
                                          }}
                                          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                                        />
                                      </label>
                                      <label className="block text-xs text-gray-700">
                                        Departure date latest
                                        <input
                                          type="datetime-local"
                                          value={rule.departure_window_end}
                                          onChange={(e) => {
                                            const next: Partial<ProductTravelRule> = {
                                              departure_window_end: e.target.value,
                                            };
                                            if (
                                              e.target.value &&
                                              rule.departure_window_start &&
                                              Date.parse(e.target.value) < Date.parse(rule.departure_window_start)
                                            ) {
                                              next.departure_window_start = e.target.value;
                                            }
                                            updateProductTravelRule(type, productId, next);
                                          }}
                                          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                                        />
                                      </label>
                                    </div>
                                    <label className="mt-2 block text-xs text-gray-700">
                                      Notes
                                      <input
                                        type="text"
                                        value={rule.notes}
                                        onChange={(e) =>
                                          updateProductTravelRule(type, productId, { notes: e.target.value })
                                        }
                                        className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                                      />
                                    </label>
                                    <div className="mt-2 rounded border border-gray-200 p-2">
                                      <div className="flex items-center justify-between">
                                        <p className="text-[11px] font-medium text-gray-800">
                                          Conditional overrides
                                        </p>
                                        <button
                                          type="button"
                                          onClick={() => addProductConditionalOverrideRule(type, productId)}
                                          className="rounded border border-gray-300 px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50"
                                        >
                                          Add Rule
                                        </button>
                                      </div>
                                      <p className="mt-1 text-[11px] text-gray-500">
                                        These rules are declarative policy entries for runtime
                                        registration evaluation (org distance/type/count logic).
                                      </p>
                                      {rule.conditional_overrides.length === 0 ? (
                                        <p className="mt-1 text-[11px] text-gray-500">
                                          No conditional overrides yet.
                                        </p>
                                      ) : (
                                        <div className="mt-2 space-y-2">
                                          {rule.conditional_overrides.map((override) => (
                                            <div
                                              key={`override-${productId}-${override.id}`}
                                              className="rounded border border-gray-100 p-2"
                                            >
                                              <div className="grid gap-2 md:grid-cols-3">
                                                <label className="block text-[11px] text-gray-700">
                                                  Rule name
                                                  <input
                                                    type="text"
                                                    value={override.name}
                                                    onChange={(e) =>
                                                      updateProductConditionalOverrideRule(
                                                        type,
                                                        productId,
                                                        override.id,
                                                        { name: e.target.value }
                                                      )
                                                    }
                                                    className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                                                  />
                                                </label>
                                                <label className="block text-[11px] text-gray-700">
                                                  If condition
                                                  <select
                                                    value={override.condition}
                                                    onChange={(e) =>
                                                      updateProductConditionalOverrideRule(
                                                        type,
                                                        productId,
                                                        override.id,
                                                        {
                                                          condition:
                                                            e.target.value as ProductRuleCondition,
                                                        }
                                                      )
                                                    }
                                                    className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                                                  >
                                                    <option value="org_distance_to_airport_km_lte">
                                                      Org distance to airport &lt;= X km
                                                    </option>
                                                    <option value="org_type_is">
                                                      Org type is
                                                    </option>
                                                    <option value="org_type_registration_count_gt">
                                                      Registrations for org type &gt; X
                                                    </option>
                                                  </select>
                                                </label>
                                                <label className="block text-[11px] text-gray-700">
                                                  Then action
                                                  <select
                                                    value={override.action}
                                                    onChange={(e) =>
                                                      updateProductConditionalOverrideRule(
                                                        type,
                                                        productId,
                                                        override.id,
                                                        {
                                                          action:
                                                            e.target.value as ProductRuleAction,
                                                        }
                                                      )
                                                    }
                                                    className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                                                  >
                                                    <option value="disable_air_travel_option">
                                                      Hide air travel option
                                                    </option>
                                                    <option value="set_travel_support_mode">
                                                      Set travel support mode
                                                    </option>
                                                    <option value="set_offsite_auto_discount_percent">
                                                      Set offsite auto discount %
                                                    </option>
                                                  </select>
                                                </label>
                                              </div>

                                              <div className="mt-2 grid gap-2 md:grid-cols-3">
                                                {override.condition === "org_distance_to_airport_km_lte" && (
                                                  <label className="block text-[11px] text-gray-700">
                                                    Distance threshold (km)
                                                    <input
                                                      type="number"
                                                      min={0}
                                                      value={override.condition_number_value ?? ""}
                                                      onChange={(e) =>
                                                        updateProductConditionalOverrideRule(
                                                          type,
                                                          productId,
                                                          override.id,
                                                          {
                                                            condition_number_value: e.target.value
                                                              ? Number(e.target.value)
                                                              : null,
                                                          }
                                                        )
                                                      }
                                                      className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                                                    />
                                                  </label>
                                                )}
                                                {override.condition === "org_type_is" && (
                                                  <label className="block text-[11px] text-gray-700">
                                                    Organization type key
                                                    <input
                                                      type="text"
                                                      value={override.condition_text_value}
                                                      onChange={(e) =>
                                                        updateProductConditionalOverrideRule(
                                                          type,
                                                          productId,
                                                          override.id,
                                                          {
                                                            condition_text_value: e.target.value,
                                                          }
                                                        )
                                                      }
                                                      className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                                                    />
                                                  </label>
                                                )}
                                                {override.condition === "org_type_registration_count_gt" && (
                                                  <label className="block text-[11px] text-gray-700">
                                                    Registration count threshold
                                                    <input
                                                      type="number"
                                                      min={0}
                                                      value={override.condition_number_value ?? ""}
                                                      onChange={(e) =>
                                                        updateProductConditionalOverrideRule(
                                                          type,
                                                          productId,
                                                          override.id,
                                                          {
                                                            condition_number_value: e.target.value
                                                              ? Number(e.target.value)
                                                              : null,
                                                          }
                                                        )
                                                      }
                                                      className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                                                    />
                                                  </label>
                                                )}
                                                {override.action === "set_travel_support_mode" && (
                                                  <label className="block text-[11px] text-gray-700">
                                                    Support mode override
                                                    <select
                                                      value={
                                                        normalizeTravelSupportMode(
                                                          override.action_text_value || "managed"
                                                        )
                                                      }
                                                      onChange={(e) =>
                                                        updateProductConditionalOverrideRule(
                                                          type,
                                                          productId,
                                                          override.id,
                                                          { action_text_value: e.target.value }
                                                        )
                                                      }
                                                    className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                                                  >
                                                    <option value="managed">
                                                      Managed (we book)
                                                    </option>
                                                    <option value="reimbursement">
                                                      Reimbursement (they book)
                                                    </option>
                                                    <option value="self_managed">
                                                      Self-managed (no reimbursement)
                                                    </option>
                                                    <option value="none">
                                                      No travel support
                                                    </option>
                                                  </select>
                                                </label>
                                              )}
                                                {override.action === "set_offsite_auto_discount_percent" && (
                                                  <label className="block text-[11px] text-gray-700">
                                                    Offsite auto-discount (%)
                                                    <input
                                                      type="number"
                                                      min={0}
                                                      max={100}
                                                      value={override.action_number_value ?? ""}
                                                      onChange={(e) =>
                                                        updateProductConditionalOverrideRule(
                                                          type,
                                                          productId,
                                                          override.id,
                                                          {
                                                            action_number_value: e.target.value
                                                              ? Number(e.target.value)
                                                              : null,
                                                          }
                                                        )
                                                      }
                                                      className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                                                    />
                                                  </label>
                                                )}
                                                {override.action === "disable_air_travel_option" && (
                                                  <p className="text-[11px] text-gray-600">
                                                    This action hides air travel from this registration option when the condition matches.
                                                  </p>
                                                )}
                                              </div>
                                              <label className="mt-2 block text-[11px] text-gray-700">
                                                Notes
                                                <input
                                                  type="text"
                                                  value={override.notes}
                                                  onChange={(e) =>
                                                    updateProductConditionalOverrideRule(
                                                      type,
                                                      productId,
                                                      override.id,
                                                      { notes: e.target.value }
                                                    )
                                                  }
                                                  className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                                                />
                                              </label>
                                              <div className="mt-2">
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    removeProductConditionalOverrideRule(
                                                      type,
                                                      productId,
                                                      override.id
                                                    )
                                                  }
                                                  className="rounded border border-gray-300 px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50"
                                                >
                                                  Remove Rule
                                                </button>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                )}

                {false && registrationOptions.length === 0 && (
                <div className="rounded-md border border-gray-100 p-3">
                  <p className="text-sm font-medium text-gray-900">Effective Rule Preview</p>
                  <p className="mt-1 text-xs text-gray-600">
                    Shows exactly what each linked registration option currently resolves to.
                  </p>
                  <div className="mt-2 space-y-2 text-xs">
                    {selectedRegistrationTypes.every((type) => parseLinkedProductIds(type).length === 0) ? (
                      <p className="text-gray-500">No linked registration options yet.</p>
                    ) : (
                      selectedRegistrationTypes.map((type) => {
                        const typeLabel =
                          REGISTRATION_TYPES.find((entry) => entry.key === type)?.label ?? type;
                        const linkedProducts = parseLinkedProductIds(type);
                        if (linkedProducts.length === 0) return null;
                        return (
                          <div key={`effective-preview-${type}`} className="rounded border border-gray-200 p-2">
                            <p className="font-semibold text-gray-900">{typeLabel}</p>
                            <ul className="mt-1 space-y-1 text-gray-700">
                              {linkedProducts.map((productId) => {
                                const product = initialProducts.find((item) => item.id === productId);
                                const rule = getProductTravelRule(type, productId);
                                return (
                                  <li key={`effective-preview-${type}-${productId}`}>
                                {product?.name ?? productId}: support `{rule.travel_support_mode}`, modes{" "}
                                {rule.allowed_travel_modes.join(", ") || "none"}, hotel{" "}
                                {rule.includes_accommodation ? "included" : "not included"}, travel intake{" "}
                                {rule.requires_travel_intake ? "required" : "not required"}, accommodation intake{" "}
                                {rule.requires_accommodation_intake ? "required" : "not required"}, arrival window{" "}
                                [{rule.arrival_window_start || "any"} → {rule.arrival_window_end || "any"}], departure window{" "}
                                [{rule.departure_window_start || "any"} → {rule.departure_window_end || "any"}], overrides{" "}
                                {rule.conditional_overrides.length}
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
                )}
                {registrationOptions.length > 0 && false && (
                  <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
                    Registration-option travel rules are configured in Registration Ops.
                  </div>
                )}

                <label className="block text-sm text-gray-700">
                  Travel Notes
                  <textarea
                    value={String(travelAccommodationConfig.notes ?? "")}
                    onChange={(e) =>
                      updateTravelAccommodationConfig({ notes: e.target.value })
                    }
                    rows={3}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    placeholder="Managed-travel rules, hotel cutoffs, reimbursement constraints..."
                  />
                </label>
              </div>
            </div>
          )}

          {currentModuleDef &&
            currentModuleDef.v12Stub &&
            (currentModuleDef.alwaysIncluded || modules[currentModuleDef.key].enabled) && (
            <div key={currentModuleDef.key} className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-900">{currentModuleDef.label}</p>
              <p className="mt-1 text-xs text-amber-800">
                Stubbed for v1.2: capture intent now, full workflow lands in the next iteration.
              </p>
              <textarea
                value={String(modules[currentModuleDef.key].config_json.notes ?? "")}
                onChange={(e) => updateModuleConfig(currentModuleDef.key, { notes: e.target.value })}
                rows={3}
                placeholder={`Notes for ${currentModuleDef.label}`}
                className="mt-3 block w-full rounded-md border border-amber-300 bg-white px-3 py-2 text-sm"
              />
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-base font-semibold text-gray-900">Review</h2>
          <p className="mt-1 text-sm text-gray-600">
            Preflight checks gate publish readiness and point to exact fix locations.
          </p>

          <div
            className={`mt-3 rounded-md border p-3 ${
              canPublishFromPreflight
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-red-200 bg-red-50 text-red-900"
            }`}
          >
            <p className="text-sm font-semibold">
              {canPublishFromPreflight
                ? "Publish Readiness: Ready"
                : "Publish Readiness: Blocked"}
            </p>
            <p className="mt-1 text-xs">
              {blockingPreflightIssues.length} blocking, {warningPreflightIssues.length} warning,{" "}
              {infoPreflightIssues.length} info.
            </p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={`/admin/conference/${conferenceId}/schedule-ops`}
              className="inline-flex rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
            >
              Open Schedule Ops
            </a>
            <a
              href={`/admin/conference/${conferenceId}?tab=products`}
              className="inline-flex rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
            >
              Open Products
            </a>
            <button
              type="button"
              onClick={async () => {
                setIsRegeneratingProgram(true);
                const result = await regenerateProgramFromSetup(conferenceId, {
                  replaceExisting: true,
                });
                setIsRegeneratingProgram(false);
                if (!result.success) {
                  setSaveError(result.error ?? "Failed to regenerate program from setup.");
                  return;
                }
                setSaveSuccess(
                  `Program regenerated from setup (${result.data?.created ?? 0} item(s)).`
                );
              }}
              disabled={isRegeneratingProgram}
              className="inline-flex rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              {isRegeneratingProgram ? "Regenerating..." : "Regenerate Program from Setup"}
            </button>
            <button
              type="button"
              onClick={async () => {
                setIsReconcilingSetup(true);
                const result = await reconcileConferenceScheduleSetup(conferenceId);
                setIsReconcilingSetup(false);
                if (!result.success || !result.data) {
                  setSaveError(result.error ?? "Failed to reconcile setup.");
                  return;
                }
                setModules(toModuleMap(result.data));
                setSaveSuccess("Setup model reconciled.");
              }}
              disabled={isReconcilingSetup}
              className="inline-flex rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              {isReconcilingSetup ? "Reconciling..." : "Reconcile Setup"}
            </button>
            <button
              type="button"
              onClick={async () => {
                setIsReconcilingPeople(true);
                const result = await reconcileConferenceSetupAndPeople(conferenceId);
                setIsReconcilingPeople(false);
                if (!result.success) {
                  setSaveError(result.error ?? "Failed to reconcile setup and people.");
                  return;
                }
                setSaveSuccess("Setup + people projection reconciled.");
              }}
              disabled={isReconcilingPeople}
              className="inline-flex rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              {isReconcilingPeople ? "Reconciling People..." : "Reconcile Setup + People"}
            </button>
          </div>

          <ul className="mt-4 space-y-2 text-sm text-gray-700">
            {MODULES.map((moduleDef) => (
              <li key={moduleDef.key}>
                <span className="font-medium">{moduleDef.label}:</span>{" "}
                {(moduleDef.alwaysIncluded || modules[moduleDef.key].enabled)
                  ? "Enabled"
                  : "Not included"}
                {moduleDef.v12Stub ? " (v1.2 stub)" : ""}
              </li>
            ))}
          </ul>

          {blockingPreflightIssues.length > 0 && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3">
              <p className="text-sm font-semibold text-red-900">Blocking Issues</p>
              <ul className="mt-2 space-y-2 text-xs text-red-900">
                {blockingPreflightIssues.map((issue) => (
                  <li key={issue.id} className="rounded border border-red-200 bg-white p-2">
                    <p className="font-semibold">{issue.title}</p>
                    <p className="mt-0.5 text-red-800">{issue.detail}</p>
                    {issue.moduleKey && (
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={() => jumpToModule(issue.moduleKey)}
                          className="rounded border border-red-300 px-2 py-0.5 text-[11px] text-red-800 hover:bg-red-100"
                        >
                          Open {MODULES.find((moduleDef) => moduleDef.key === issue.moduleKey)?.label ?? "Module"}
                        </button>
                      </div>
                    )}
                    {issue.actionHref && issue.actionLabel && (
                      <div className="mt-2">
                        <a
                          href={issue.actionHref}
                          className="inline-flex rounded border border-red-300 px-2 py-0.5 text-[11px] text-red-800 hover:bg-red-100"
                        >
                          {issue.actionLabel}
                        </a>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {warningPreflightIssues.length > 0 && (
            <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-900">Warnings</p>
              <ul className="mt-2 space-y-2 text-xs text-amber-900">
                {warningPreflightIssues.map((issue) => (
                  <li key={issue.id} className="rounded border border-amber-200 bg-white p-2">
                    <p className="font-semibold">{issue.title}</p>
                    <p className="mt-0.5 text-amber-800">{issue.detail}</p>
                    {issue.moduleKey && (
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={() => jumpToModule(issue.moduleKey)}
                          className="rounded border border-amber-300 px-2 py-0.5 text-[11px] text-amber-800 hover:bg-amber-100"
                        >
                          Open {MODULES.find((moduleDef) => moduleDef.key === issue.moduleKey)?.label ?? "Module"}
                        </button>
                      </div>
                    )}
                    {issue.actionHref && issue.actionLabel && (
                      <div className="mt-2">
                        <a
                          href={issue.actionHref}
                          className="inline-flex rounded border border-amber-300 px-2 py-0.5 text-[11px] text-amber-800 hover:bg-amber-100"
                        >
                          {issue.actionLabel}
                        </a>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {infoPreflightIssues.length > 0 && (
            <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 p-3">
              <p className="text-sm font-semibold text-blue-900">Go-Live Notes</p>
              <ul className="mt-2 space-y-1 text-xs text-blue-900">
                {infoPreflightIssues.map((issue) => (
                  <li key={issue.id}>
                    <span className="font-semibold">{issue.title}:</span> {issue.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={prevStep}
          disabled={step === 1}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Back
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={saveCurrentSetup}
            disabled={isSaving}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            onClick={nextStep}
            disabled={isSaving || (step === maxStep)}
            className="rounded-md bg-[#EE2A2E] px-4 py-2 text-sm font-medium text-white hover:bg-[#b50001] disabled:opacity-60"
          >
            {isSaving
              ? "Saving..."
              : step === maxStep
                ? "Done"
                : step === 2 && moduleStepIndex < selectedModuleDefs.length - 1
                  ? "Next Module"
                  : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
