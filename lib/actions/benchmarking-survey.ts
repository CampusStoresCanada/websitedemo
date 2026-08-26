"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  canManageOrganization,
  isGlobalAdmin,
  requireAuthenticated,
} from "@/lib/auth/guards";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface SaveFieldResult {
  success: boolean;
  error?: string;
  /** When a value was auto-corrected (e.g. rounded to cents, or a comma-separated
   *  string split into an array), return the canonical value */
  correctedValue?: string | number | boolean | string[] | null;
}

type FieldType =
  | "currency"     // stored as integer cents → displayed as $x.xx
  | "number"       // any numeric (integer or decimal)
  | "integer"      // whole numbers only
  | "percentage"   // 0–100 stored as number
  | "text"         // free-text (max 500 chars)
  | "text_long"    // longer text (max 2000 chars)
  | "select"       // must match one of allowed values
  | "multiselect"  // text[] column — zero or more values, stored as an array
  | "boolean";     // true / false / null

interface FieldDef {
  type: FieldType;
  /** For select fields: the allowed values */
  options?: string[];
  /**
   * multiselect only: the options are a prompt, not a closed set.
   *
   * Every one of these lists already has a tail of things stores added
   * themselves — "Gown Rentals for Graduation Photography", "Lottery ticket
   * sales". Enforcing membership would reject a store's own 2025 answer the
   * next time they touched the row, and would teach them that the honest
   * answer is unwelcome.
   */
  allowOther?: boolean;
  /** Max length for text fields (defaults to 500) */
  maxLength?: number;
  /** Min numeric value (inclusive) */
  min?: number;
  /** Max numeric value (inclusive) */
  max?: number;
}

// ─────────────────────────────────────────────────────────────────
// Field Allowlist + Type Registry
// Every editable survey field MUST be listed here.
// Fields NOT listed are blocked from writes.
// ─────────────────────────────────────────────────────────────────

const FIELD_REGISTRY: Record<string, FieldDef> = {
  // ── Who to phone about these figures (brief, Institution Profile) ──
  //
  // Editable by the store, unlike respondent_user_id which records who pressed
  // submit and is system-only. The person who compiled the numbers is often not
  // the account holder, and a reviewer ringing the wrong desk in November is how
  // a flag goes unanswered.
  respondent_name:         { type: "text", maxLength: 120 },
  respondent_title:        { type: "text", maxLength: 120 },
  respondent_email:        { type: "text", maxLength: 200 },
  respondent_phone:        { type: "text", maxLength: 60 },

  // ── Section 1: Institution Profile ──
  store_name:              { type: "text" },
  institution_type:        { type: "select", options: ["University", "College", "Polytechnic", "CEGEP"] },
  enrollment_fte:          { type: "integer", min: 0, max: 500000 },
  num_store_locations:     { type: "integer", min: 0, max: 100 },
  total_square_footage:    { type: "integer", min: 0, max: 1000000 },
  operations_mandate:      { type: "select", options: ["Cost Recovery", "For-profit", "Not-for-profit"] },
  is_semester_based:       { type: "boolean" },
  fiscal_year_end_date:    { type: "text", maxLength: 10 },
  sqft_salesfloor:         { type: "integer", min: 0, max: 500000 },
  sqft_storage:            { type: "integer", min: 0, max: 500000 },
  sqft_office:             { type: "integer", min: 0, max: 500000 },
  sqft_other:              { type: "integer", min: 0, max: 500000 },

  // ── Section 2: Sales Revenue ──
  total_gross_sales_instore: { type: "currency", min: 0 },
  total_online_sales:        { type: "currency", min: 0 },
  ia_revenue:                { type: "currency", min: 0 },
  other_non_retail_revenue:  { type: "currency", min: 0 },
  other_non_retail_description: { type: "text_long" },

  // ── Section 3: Financial Metrics ──
  total_cogs:              { type: "currency", min: 0 },
  expense_hr:              { type: "currency", min: 0 },
  expense_rent_maintenance:{ type: "currency", min: 0 },
  net_profit:              { type: "currency" }, // can be negative (loss)
  marketing_spend:         { type: "currency", min: 0 },
  central_funding:         { type: "currency", min: 0 },

  // ── Section 4: Staffing ──
  fulltime_employees:              { type: "number", min: 0, max: 10000 },
  parttime_fte_offpeak:            { type: "number", min: 0, max: 10000 },
  student_fte_average:             { type: "number", min: 0, max: 10000 },
  manager_years_current_position:  { type: "number", min: 0, max: 60 },
  manager_years_in_industry:       { type: "number", min: 0, max: 60 },

  // ── Section 5: Course Materials Breakdown ──
  cm_print_new_total:        { type: "currency", min: 0 },
  cm_print_new_online:       { type: "currency", min: 0 },
  cm_print_used_total:       { type: "currency", min: 0 },
  cm_print_used_online:      { type: "currency", min: 0 },
  cm_custom_courseware_total: { type: "currency", min: 0 },
  cm_custom_courseware_online:{ type: "currency", min: 0 },
  cm_rentals_total:          { type: "currency", min: 0 },
  cm_rentals_online:         { type: "currency", min: 0 },
  cm_digital_total:          { type: "currency", min: 0 },
  cm_digital_online:         { type: "currency", min: 0 },
  cm_inclusive_access_total:  { type: "currency", min: 0 },
  cm_inclusive_access_online: { type: "currency", min: 0 },
  cm_course_packs_total:     { type: "currency", min: 0 },
  cm_course_packs_online:    { type: "currency", min: 0 },
  cm_other_total:            { type: "currency", min: 0 },
  cm_other_online:           { type: "currency", min: 0 },

  // ── Section 6: General Merchandise ──
  sales_course_supplies:        { type: "currency", min: 0 },
  sales_course_supplies_online: { type: "currency", min: 0 },
  sales_general_books:          { type: "currency", min: 0 },
  sales_technology:             { type: "currency", min: 0 },
  sales_stationary:             { type: "currency", min: 0 },
  sales_apparel:                { type: "currency", min: 0 },
  sales_apparel_imprint:        { type: "currency", min: 0 },
  sales_apparel_non_imprint:    { type: "currency", min: 0 },
  sales_gifts_drinkware:        { type: "currency", min: 0 },
  sales_gifts_imprint:          { type: "currency", min: 0 },
  sales_gifts_non_imprint:      { type: "currency", min: 0 },
  sales_custom_merch:           { type: "currency", min: 0 },
  sales_food_beverage:          { type: "currency", min: 0 },

  // ── Section 7: Technology & Systems ──
  pos_system:              { type: "text" },
  ebook_delivery_system:   { type: "text" },
  student_info_system:     { type: "text" },
  lms_system:              { type: "text" },
  payment_options:         { type: "multiselect", allowOther: true, options: ["Gift Cards", "Accept Campus Card", "Loyalty / Frequent Shopper Program"] },
  social_media_platforms:  { type: "multiselect", allowOther: true, options: ["Instagram", "Facebook", "TikTok", "Twitter (X)", "Threads", "YouTube", "BlueSky"] },
  social_media_frequency:  { type: "select", options: ["Daily", "Several times a week", "Weekly", "Monthly", "Rarely", "Never"] },
  social_media_run_by:     { type: "select", options: ["In-house", "Outsourced", "Mix", "N/A"] },
  services_offered:        { type: "multiselect", allowOther: true, options: ["Sponsorships", "Transit or Parking Pass Sales", "Locker Sales", "Print / Photocopy Service", "Campus Card Services", "Post Office", "Student Mail Services", "Campus Mail"] },
  shopping_services:       { type: "multiselect", allowOther: true, options: ["In-Store Pick-up", "Ship from Store", "Order on Web", "Custom Orders", "Return to Store", "Special Orders", "Customer Service Kiosk", "Graduation Regalia", "Residence Delivery", "Locker Pick-up", "Competitive Price Guarantee", "Personal Shopper"] },
  store_in_stores:         { type: "text_long" },
  physical_inventory_schedule: { type: "text" },

  // ── Section 8: Store Operations & New KPIs ──
  weekday_hours_open:      { type: "text", maxLength: 20 },
  weekday_hours_close:     { type: "text", maxLength: 20 },
  saturday_hours_open:     { type: "text", maxLength: 20 },
  saturday_hours_close:    { type: "text", maxLength: 20 },
  sunday_hours_open:       { type: "text", maxLength: 20 },
  sunday_hours_close:      { type: "text", maxLength: 20 },
  hours_vary_seasonally:   { type: "boolean" },
  shrink_textbooks:        { type: "percentage" },
  shrink_general_merch:    { type: "percentage" },
  fye_inventory_value:     { type: "currency", min: 0 },
  total_transaction_count: { type: "integer", min: 0, max: 50000000 },
  tracks_adoptions:        { type: "boolean" },
  total_course_sections:   { type: "integer", min: 0, max: 50000 },
  adoptions_by_deadline:   { type: "integer", min: 0, max: 50000 },
  adoption_deadline_window:{ type: "select", options: ["2 weeks before term", "4 weeks before term", "6 weeks before term", "8+ weeks before term", "Other"] },
};

/** Set of all editable field names (fast lookups) */
const ALLOWED_FIELDS = new Set(Object.keys(FIELD_REGISTRY));

/** Fields that ONLY the system / workflow transitions can write */
const SYSTEM_ONLY_FIELDS = new Set([
  "id",
  "organization_id",
  "fiscal_year",
  "status",
  "submitted_at",
  "amended_at",
  "respondent_user_id",
  "verified_by",
  "verified_at",
  "qa_status",
  "created_at",
  "updated_at",
]);

// ─────────────────────────────────────────────────────────────────
// Server-side Input Validation
// ─────────────────────────────────────────────────────────────────

interface ValidationResult {
  valid: boolean;
  /** The cleaned/canonical value to store. string[] for multiselect (text[] columns). */
  cleanValue: string | number | boolean | string[] | null;
  /** Human-readable error if invalid */
  error?: string;
}

function validateFieldValue(
  field: string,
  value: string | number | boolean | string[] | null
): ValidationResult {
  const def = FIELD_REGISTRY[field];
  if (!def) {
    return { valid: false, cleanValue: null, error: `Unknown field: ${field}` };
  }

  // Null / empty always accepted (clears the field)
  if (value === null || value === "" || value === undefined) {
    return { valid: true, cleanValue: null };
  }

  switch (def.type) {
    case "currency": {
      // Accept string or number, clean currency symbols
      const cleaned = typeof value === "string"
        ? value.replace(/[$,\s]/g, "").trim()
        : String(value);
      if (cleaned === "" || cleaned === "-") return { valid: true, cleanValue: null };

      const num = Number(cleaned);
      if (isNaN(num)) {
        return { valid: false, cleanValue: null, error: `"${field}" must be a valid dollar amount (e.g., 12345.67)` };
      }
      // Round to cents
      const rounded = Math.round(num * 100) / 100;
      // Range checks
      if (def.min !== undefined && rounded < def.min) {
        return { valid: false, cleanValue: null, error: `"${field}" cannot be less than $${def.min}` };
      }
      if (def.max !== undefined && rounded > def.max) {
        return { valid: false, cleanValue: null, error: `"${field}" cannot exceed $${def.max.toLocaleString()}` };
      }
      return { valid: true, cleanValue: rounded };
    }

    case "multiselect": {
      // These four columns are text[] in the database but were declared as
      // free text here and in the field config, so the form sent a
      // comma-separated string and Postgres rejected it outright:
      //   malformed array literal: "Instagram, TikTok"
      // Every one of them was unsaveable. Accepting both shapes fixes the
      // break for the three that still have no agreed vocabulary, while
      // social_media_platforms moves to real options.
      const list = Array.isArray(value)
        ? value
        : String(value)
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean);

      if (list.length === 0) return { valid: true, cleanValue: null };

      // Only enforce membership where a vocabulary actually exists. The other
      // three take free text until the committee agrees their lists — an
      // invented taxonomy is worse than an honest open field.
      if (def.options && !def.allowOther) {
        const unknown = list.filter((v) => !def.options!.includes(v));
        if (unknown.length > 0) {
          return {
            valid: false,
            cleanValue: null,
            error: `"${field}" does not allow: ${unknown.join(", ")}`,
          };
        }
      }

      // De-duplicate, preserving the order they picked.
      return { valid: true, cleanValue: [...new Set(list)] };
    }

    case "number": {
      const num = typeof value === "string" ? Number(value.replace(/,/g, "").trim()) : Number(value);
      if (isNaN(num)) {
        return { valid: false, cleanValue: null, error: `"${field}" must be a number` };
      }
      if (def.min !== undefined && num < def.min) {
        return { valid: false, cleanValue: null, error: `"${field}" cannot be less than ${def.min}` };
      }
      if (def.max !== undefined && num > def.max) {
        return { valid: false, cleanValue: null, error: `"${field}" cannot exceed ${def.max}` };
      }
      return { valid: true, cleanValue: num };
    }

    case "integer": {
      const num = typeof value === "string" ? Number(value.replace(/,/g, "").trim()) : Number(value);
      if (isNaN(num) || !Number.isFinite(num)) {
        return { valid: false, cleanValue: null, error: `"${field}" must be a whole number` };
      }
      const rounded = Math.round(num);
      if (def.min !== undefined && rounded < def.min) {
        return { valid: false, cleanValue: null, error: `"${field}" cannot be less than ${def.min}` };
      }
      if (def.max !== undefined && rounded > def.max) {
        return { valid: false, cleanValue: null, error: `"${field}" cannot exceed ${def.max.toLocaleString()}` };
      }
      return { valid: true, cleanValue: rounded };
    }

    case "percentage": {
      const num = typeof value === "string"
        ? Number(value.replace(/%/g, "").trim())
        : Number(value);
      if (isNaN(num)) {
        return { valid: false, cleanValue: null, error: `"${field}" must be a number (percentage)` };
      }
      // Server-side sanity: percentages stored as 0–100. Values > 100 or < 0 are questionable.
      // We allow 0–100 range. Values like 0.87 are allowed (the client should prompt for clarification).
      if (num < 0) {
        return { valid: false, cleanValue: null, error: `"${field}" cannot be negative` };
      }
      if (num > 100) {
        return { valid: false, cleanValue: null, error: `"${field}" cannot exceed 100%` };
      }
      // Store with up to 2 decimal places
      const rounded = Math.round(num * 100) / 100;
      return { valid: true, cleanValue: rounded };
    }

    case "text": {
      if (typeof value !== "string") {
        return { valid: false, cleanValue: null, error: `"${field}" must be text` };
      }
      const maxLen = def.maxLength ?? 500;
      const trimmed = value.trim();
      if (trimmed.length > maxLen) {
        return { valid: false, cleanValue: null, error: `"${field}" exceeds maximum length of ${maxLen} characters` };
      }
      // Strip control characters (except newlines for long text)
      const sanitized = trimmed.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
      return { valid: true, cleanValue: sanitized || null };
    }

    case "text_long": {
      if (typeof value !== "string") {
        return { valid: false, cleanValue: null, error: `"${field}" must be text` };
      }
      const maxLen = def.maxLength ?? 2000;
      const trimmed = value.trim();
      if (trimmed.length > maxLen) {
        return { valid: false, cleanValue: null, error: `"${field}" exceeds maximum length of ${maxLen} characters` };
      }
      const sanitized = trimmed.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
      return { valid: true, cleanValue: sanitized || null };
    }

    case "select": {
      const strVal = String(value).trim();
      if (!strVal) return { valid: true, cleanValue: null };
      if (!def.options?.includes(strVal)) {
        return { valid: false, cleanValue: null, error: `"${field}" must be one of: ${def.options?.join(", ")}` };
      }
      return { valid: true, cleanValue: strVal };
    }

    case "boolean": {
      if (typeof value === "boolean") return { valid: true, cleanValue: value };
      if (value === "true") return { valid: true, cleanValue: true };
      if (value === "false") return { valid: true, cleanValue: false };
      return { valid: false, cleanValue: null, error: `"${field}" must be true or false` };
    }

    default:
      return { valid: false, cleanValue: null, error: `Unknown field type for "${field}"` };
  }
}

// ─────────────────────────────────────────────────────────────────
// Rate Limiter (in-memory, per-user, token bucket)
// ─────────────────────────────────────────────────────────────────

interface RateBucket {
  tokens: number;
  lastRefill: number;
}

/**
 * Simple in-memory token-bucket rate limiter.
 * - 30 tokens per bucket (one save = one token)
 * - Refills at 2 tokens/second
 * - So burst of 30 is fine, sustained 120/min is fine,
 *   but >120/min sustained will be throttled.
 *
 * For a serverless environment this resets per cold start,
 * which is acceptable — it stops hot-loop abuse within a
 * single instance lifetime.
 */
const MAX_TOKENS = 30;
const REFILL_RATE = 2; // tokens per second
const rateBuckets = new Map<string, RateBucket>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  let bucket = rateBuckets.get(userId);

  if (!bucket) {
    bucket = { tokens: MAX_TOKENS, lastRefill: now };
    rateBuckets.set(userId, bucket);
  }

  // Refill tokens based on elapsed time
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(MAX_TOKENS, bucket.tokens + elapsed * REFILL_RATE);
  bucket.lastRefill = now;

  if (bucket.tokens < 1) {
    return false; // rate limited
  }

  bucket.tokens -= 1;
  return true;
}

// Clean up stale buckets every 5 minutes to prevent memory leaks
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let lastCleanup = Date.now();
function maybeCleanupBuckets() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  const cutoff = now - 10 * 60 * 1000; // Remove buckets idle > 10 min
  for (const [userId, bucket] of rateBuckets.entries()) {
    if (bucket.lastRefill < cutoff) {
      rateBuckets.delete(userId);
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// Auth + Permission Helper
// ─────────────────────────────────────────────────────────────────

interface AuthCheck {
  authorized: boolean;
  userId?: string;
  error?: string;
}

async function verifyBenchmarkingAccess(
  benchmarkingId: string,
  requireDraft: boolean = true
): Promise<AuthCheck & { row?: { id: string; organization_id: string; status: string | null } }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) {
    return { authorized: false, error: auth.error };
  }
  const { supabase, userId } = auth.ctx;

  // 2. Rate limit check
  maybeCleanupBuckets();
  if (!checkRateLimit(userId)) {
    return { authorized: false, userId, error: "Too many requests. Please slow down." };
  }

  // 3. Fetch the benchmarking row
  const { data: row, error: fetchError } = await supabase
    .from("benchmarking")
    .select("id, organization_id, status")
    .eq("id", benchmarkingId)
    .single();

  if (fetchError || !row) {
    return { authorized: false, userId, error: "Benchmarking record not found" };
  }

  // 4. Draft-status check
  if (requireDraft && row.status !== "draft") {
    return { authorized: false, userId, error: "Cannot edit a submitted survey" };
  }

  // Permission: org_admin for this org, OR global admin
  const isAdmin = isGlobalAdmin(auth.ctx.globalRole);
  if (!canManageOrganization(auth.ctx, row.organization_id) && !isAdmin) {
    return { authorized: false, userId, error: "You don't have permission to edit this survey" };
  }

  return { authorized: true, userId, row };
}

// ─────────────────────────────────────────────────────────────────
// Server Action: Save a single field
// ─────────────────────────────────────────────────────────────────

export async function saveBenchmarkingField(
  benchmarkingId: string,
  field: string,
  value: string | number | boolean | string[] | null
): Promise<SaveFieldResult> {
  try {
    // 1. Allowlist check
    if (!ALLOWED_FIELDS.has(field) || SYSTEM_ONLY_FIELDS.has(field)) {
      console.error(`[SECURITY] Blocked write to disallowed field: ${field}`);
      return { success: false, error: "This field cannot be edited" };
    }

    // 2. Validate the value
    const validation = validateFieldValue(field, value);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // 3. Auth + permissions + rate limiting
    const auth = await verifyBenchmarkingAccess(benchmarkingId, true);
    if (!auth.authorized) {
      return { success: false, error: auth.error };
    }

    // 4. Write the validated, clean value.
    // Service-role client, not the session client: `benchmarking` grants
    // `authenticated` SELECT only, so its org_admin INSERT/UPDATE policies are
    // dead letters — every write failed with "permission denied for table
    // benchmarking" before RLS was ever consulted. Same shape as the
    // brand_colors fix; authorization stays in verifyBenchmarkingAccess above.
    const supabase = createAdminClient();
    const { error: updateError } = await supabase
      .from("benchmarking")
      .update({
        [field]: validation.cleanValue,
        updated_at: new Date().toISOString(),
      })
      .eq("id", benchmarkingId);

    if (updateError) {
      console.error(`Error saving benchmarking field ${field}:`, updateError);
      return { success: false, error: "Failed to save field" };
    }

    // Return correctedValue if the server cleaned up the input
    const wasCorrected = validation.cleanValue !== value && validation.cleanValue !== null;
    return {
      success: true,
      ...(wasCorrected ? { correctedValue: validation.cleanValue } : {}),
    };
  } catch (err) {
    console.error("Error saving benchmarking field:", err);
    return { success: false, error: "An unexpected error occurred" };
  }
}

// ─────────────────────────────────────────────────────────────────
// Server Action: Save multiple fields (batch)
// ─────────────────────────────────────────────────────────────────

export async function saveBenchmarkingFields(
  benchmarkingId: string,
  fields: Record<string, string | number | boolean | string[] | null>
): Promise<SaveFieldResult> {
  try {
    // 1. Validate ALL fields before writing any
    const cleanedFields: Record<string, string | number | boolean | string[] | null> = {};
    for (const [field, value] of Object.entries(fields)) {
      if (!ALLOWED_FIELDS.has(field) || SYSTEM_ONLY_FIELDS.has(field)) {
        console.error(`[SECURITY] Blocked batch write to disallowed field: ${field}`);
        return { success: false, error: `Field "${field}" cannot be edited` };
      }

      const validation = validateFieldValue(field, value);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }
      cleanedFields[field] = validation.cleanValue;
    }

    // 2. Auth + permissions + rate limiting
    const auth = await verifyBenchmarkingAccess(benchmarkingId, true);
    if (!auth.authorized) {
      return { success: false, error: auth.error };
    }

    // 3. Write all validated values (service-role client — see saveBenchmarkingField)
    const supabase = createAdminClient();
    const { error: updateError } = await supabase
      .from("benchmarking")
      .update({
        ...cleanedFields,
        updated_at: new Date().toISOString(),
      })
      .eq("id", benchmarkingId);

    if (updateError) {
      console.error("Error saving benchmarking fields:", updateError);
      return { success: false, error: "Failed to save fields" };
    }

    return { success: true };
  } catch (err) {
    console.error("Error saving benchmarking fields:", err);
    return { success: false, error: "An unexpected error occurred" };
  }
}

// ─────────────────────────────────────────────────────────────────
// Server Action: Submit survey (draft → submitted)
// ─────────────────────────────────────────────────────────────────

export async function submitBenchmarkingSurvey(
  benchmarkingId: string
): Promise<SaveFieldResult> {
  try {
    const auth = await verifyBenchmarkingAccess(benchmarkingId, true);
    if (!auth.authorized || !auth.row || !auth.userId) {
      return { success: false, error: auth.error };
    }
    // Service-role client — see saveBenchmarkingField. Also covers the
    // organizations.fte sync below, which RLS blocks for `authenticated` too.
    const supabase = createAdminClient();
    const userId = auth.userId;

    const { data: submitted, error: updateError } = await supabase
      .from("benchmarking")
      .update({
        status: "submitted",
        submitted_at: new Date().toISOString(),
        respondent_user_id: userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", benchmarkingId)
      .select("organization_id, enrollment_fte, fiscal_year")
      .single();

    if (updateError) {
      console.error("Error submitting survey:", updateError);
      return { success: false, error: "Failed to submit survey" };
    }

    // A confirmed submission is fresher than anything else on file — it
    // always refreshes the org's public/priced FTE number, even overriding
    // a prior admin manual edit (which only stands between submissions).
    if (submitted?.enrollment_fte !== null && submitted?.enrollment_fte !== undefined) {
      const { error: orgUpdateError } = await supabase
        .from("organizations")
        .update({
          fte: submitted.enrollment_fte,
          fte_is_manual_override: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", submitted.organization_id);
      if (orgUpdateError) {
        console.warn("[submitBenchmarkingSurvey] failed to sync organizations.fte:", orgUpdateError.message);
      }
    }

    // Refresh the derived metrics for this store. Fire and forget: the table
    // is rebuildable by recomputeYear, and a store must never see "failed to
    // submit" because a derived row could not be written.
    try {
      const { syncMetricsFor } = await import("@/lib/actions/benchmarking-metrics");
      await syncMetricsFor(benchmarkingId);
    } catch (err) {
      console.warn("[submitBenchmarkingSurvey] metrics sync failed:", err);
    }

    // Confirm receipt, and tell them what happens to their figures next. Fire
    // and forget on purpose: the submission is saved either way, and a store
    // must never see "failed to submit" because Resend was having a bad day.
    if (submitted?.fiscal_year && submitted?.organization_id) {
      try {
        const { sendSubmissionReceipt } = await import("@/lib/benchmarking/notify");
        const outcome = await sendSubmissionReceipt(
          submitted.fiscal_year,
          submitted.organization_id
        );
        if (outcome && !outcome.sent) {
          console.warn("[submitBenchmarkingSurvey] receipt not sent:", outcome.error);
        }
      } catch (err) {
        console.warn("[submitBenchmarkingSurvey] receipt threw:", err);
      }
    }

    return { success: true };
  } catch (err) {
    console.error("Error submitting survey:", err);
    return { success: false, error: "An unexpected error occurred" };
  }
}

// ─────────────────────────────────────────────────────────────────
// Server Action: Amend survey (submitted → draft)
// ─────────────────────────────────────────────────────────────────

export async function amendBenchmarkingSurvey(
  benchmarkingId: string
): Promise<SaveFieldResult> {
  try {
    const auth = await requireAuthenticated();
    if (!auth.ok) {
      return { success: false, error: auth.error };
    }
    const { supabase, userId } = auth.ctx;

    // Rate limit
    maybeCleanupBuckets();
    if (!checkRateLimit(userId)) {
      return { success: false, error: "Too many requests. Please slow down." };
    }

    const { data: row, error: fetchError } = await supabase
      .from("benchmarking")
      .select("id, organization_id, status, fiscal_year")
      .eq("id", benchmarkingId)
      .single();

    if (fetchError || !row) {
      return { success: false, error: "Benchmarking record not found" };
    }

    if (row.status !== "submitted") {
      return { success: false, error: "Only submitted surveys can be amended" };
    }

    // Check survey is still open
    const { data: survey } = await supabase
      .from("benchmarking_surveys")
      .select("status")
      .eq("fiscal_year", row.fiscal_year)
      .single();

    if (survey?.status !== "open") {
      return { success: false, error: "The survey period has closed" };
    }

    if (!canManageOrganization(auth.ctx, row.organization_id)) {
      return { success: false, error: "You don't have permission" };
    }

    // Service-role client for the write only — see saveBenchmarkingField.
    // The reads above stay on the session client (SELECT is granted).
    const { error: updateError } = await createAdminClient()
      .from("benchmarking")
      .update({
        status: "draft",
        amended_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", benchmarkingId);

    if (updateError) {
      console.error("Error amending survey:", updateError);
      return { success: false, error: "Failed to amend survey" };
    }

    return { success: true };
  } catch (err) {
    console.error("Error amending survey:", err);
    return { success: false, error: "An unexpected error occurred" };
  }
}

// ─────────────────────────────────────────────────────────────────
// Server Action: Save delta flag
// ─────────────────────────────────────────────────────────────────

export async function saveDeltaFlag(
  benchmarkingId: string,
  fieldName: string,
  previousValue: number | null,
  currentValue: number | null,
  action: "fixed" | "explained",
  explanation?: string
): Promise<SaveFieldResult> {
  try {
    // Validate fieldName is in our registry
    if (!ALLOWED_FIELDS.has(fieldName)) {
      return { success: false, error: "Invalid field name" };
    }

    // Validate action
    if (action !== "fixed" && action !== "explained") {
      return { success: false, error: "Invalid action" };
    }

    // Validate explanation text length
    if (explanation && explanation.length > 2000) {
      return { success: false, error: "Explanation too long (max 2000 characters)" };
    }

    const auth = await requireAuthenticated();
    if (!auth.ok) {
      return { success: false, error: auth.error };
    }
    const supabase = auth.ctx.supabase;
    const userId = auth.ctx.userId;

    // Rate limit
    maybeCleanupBuckets();
    if (!checkRateLimit(userId)) {
      return { success: false, error: "Too many requests. Please slow down." };
    }

    if (action === "fixed") {
      await supabase
        .from("delta_flags")
        .delete()
        .eq("benchmarking_id", benchmarkingId)
        .eq("field_name", fieldName);
      return { success: true };
    }

    // Calculate changes
    const prev = previousValue ?? 0;
    const curr = currentValue ?? 0;
    const absChange = curr - prev;
    const pctChange = prev !== 0 ? ((curr - prev) / prev) * 100 : null;

    const { error: upsertError } = await supabase
      .from("delta_flags")
      .upsert(
        {
          benchmarking_id: benchmarkingId,
          field_name: fieldName,
          previous_value: previousValue,
          current_value: currentValue,
          pct_change: pctChange,
          abs_change: absChange,
          respondent_action: action,
          respondent_explanation: explanation?.trim() ?? null,
          committee_status: "pending",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "benchmarking_id,field_name" }
      );

    if (upsertError) {
      console.error("Error saving delta flag:", upsertError);
      return { success: false, error: "Failed to save explanation" };
    }

    return { success: true };
  } catch (err) {
    console.error("Error saving delta flag:", err);
    return { success: false, error: "An unexpected error occurred" };
  }
}

// ─────────────────────────────────────────────────────────────────
// Server Action: set disclosure level (disclosure choice + consent seal)
// ─────────────────────────────────────────────────────────────────

/**
 * A store choosing whether it may be named to its peers.
 *
 * `requireDraft: false` on purpose. Consent here is live, not a gate at
 * submission: a store may change its mind after filing and everything
 * downstream reads the current value. The only hard stop is the seal when the
 * successor survey opens, and nothing computes that yet — see Consent seal: Until it
 * does, a change is always allowed, which is the permissive direction and the
 * right one to be wrong in.
 */
export async function setDisclosureLevel(
  benchmarkingId: string,
  level: "full" | "aggregate_only"
): Promise<SaveFieldResult> {
  try {
    if (level !== "full" && level !== "aggregate_only") {
      return { success: false, error: "Unknown disclosure level" };
    }

    const auth = await verifyBenchmarkingAccess(benchmarkingId, false);
    if (!auth.authorized || !auth.row || !auth.userId) {
      return { success: false, error: auth.error };
    }

    // Consent seal: Live consent has an end: once the successor survey opened, these
    // figures are published beside this year's as the reference value, and
    // withdrawing now would retroactively change comparisons other stores have
    // already read.
    const { sealStateForBenchmarking, sealMessage } = await import(
      "@/lib/benchmarking/seal"
    );
    const seal = await sealStateForBenchmarking(benchmarkingId);
    if (seal?.sealed) {
      return { success: false, error: sealMessage(seal) ?? "That year is closed." };
    }

    // Service role, as everywhere else on this table: `authenticated` holds
    // SELECT only, so a session-client update matches zero rows and reports
    // success.
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("benchmarking")
      .update({
        disclosure_level: level,
        disclosure_level_set_at: new Date().toISOString(),
        disclosure_level_set_by: auth.userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", benchmarkingId);

    if (error) {
      console.error("[setDisclosureLevel]", error);
      return { success: false, error: "Could not save that choice" };
    }

    return { success: true };
  } catch (err) {
    console.error("[setDisclosureLevel]", err);
    return { success: false, error: "An unexpected error occurred" };
  }
}
