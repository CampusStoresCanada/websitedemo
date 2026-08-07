// ─────────────────────────────────────────────────────────────────
// Chunk 22: Communications — Condition Registry
// Curated, client-safe description of what can be checked about a
// recipient for {{#if}} blocks in a template. Extend by adding a field
// here (or a whole subject) — never by letting a condition reference an
// arbitrary column: some columns genuinely shouldn't be checkable from
// an email (tokens, internal notes), and every subject needs a known
// resolution path from "this recipient" to the row being checked, which
// isn't uniform across the schema.
//
// Purely data — no imports, safe to send to the client as-is. The actual
// row-resolution logic (which table, which join) lives server-only in
// ./resolve.ts so it never ships to the browser.
// ─────────────────────────────────────────────────────────────────

export type ConditionFieldType = "nullable" | "string" | "enum" | "date" | "boolean";

export interface ConditionFieldDef {
  label: string;
  type: ConditionFieldType;
  /** For type "enum" — the known set of values, shown as a dropdown. */
  options?: string[];
}

export interface ConditionSubjectDef {
  label: string;
  /**
   * Set when checking this subject requires picking a specific instance
   * (e.g. which event, which checklist task). `endpoint` is the GET route
   * the "Insert Conditional" modal fetches picker options from — a plain
   * `{ options: { id, title }[] }` response — so adding a new referenced
   * subject never requires new modal code, only a new route.
   */
  requiresReference?: { label: string; endpoint: string };
  fields: Record<string, ConditionFieldDef>;
}

export type ConditionSubjectKey =
  | "organization"
  | "person"
  | "event_registration"
  | "checklist_task"
  | "conference_entity_ownership";

export const CONDITION_SUBJECTS: Record<ConditionSubjectKey, ConditionSubjectDef> = {
  organization: {
    label: "Organization",
    fields: {
      name: { label: "Name", type: "nullable" },
      // Always present, non-nullable — the org's URL slug (e.g. /org/{{organization_slug}}),
      // for building CTA links to their org dashboard. See app_url in the system variable registry.
      slug: { label: "URL Slug", type: "string" },
      logo_url: { label: "Logo", type: "nullable" },
      logo_horizontal_url: { label: "Horizontal Logo", type: "nullable" },
      banner_url: { label: "Banner Image", type: "nullable" },
      website: { label: "Website", type: "nullable" },
      company_description: { label: "Company Description", type: "nullable" },
      membership_status: {
        label: "Membership Status",
        type: "enum",
        options: ["applied", "approved", "active", "grace", "locked", "reactivated", "canceled"],
      },
      payment_status: { label: "Payment Status", type: "nullable" },
      onboarding_completed_at: { label: "Onboarding Completed", type: "date" },
    },
  },
  person: {
    label: "Person",
    fields: {
      display_name: { label: "Name", type: "nullable" },
      avatar_url: { label: "Avatar", type: "nullable" },
      global_role: { label: "Role", type: "enum", options: ["user", "admin", "super_admin"] },
    },
  },
  event_registration: {
    label: "Event Registration",
    requiresReference: { label: "Event", endpoint: "/api/admin/comms/conditions/events" },
    fields: {
      status: { label: "Registration Status", type: "enum", options: ["registered", "cancelled", "waitlisted", "promoted"] },
      payment_status: { label: "Payment Status", type: "nullable" },
    },
  },
  checklist_task: {
    label: "Checklist Task",
    requiresReference: { label: "Task", endpoint: "/api/admin/comms/conditions/checklist-tasks" },
    fields: {
      // Backed by the same fixed CHECKS registry the checklist reminder
      // digest itself evaluates (lib/conference/checklist-engine.ts) — not
      // a raw column, so this is the one field every checklist task has,
      // regardless of its check_type.
      is_complete: { label: "Complete", type: "boolean" },
    },
  },
  conference_entity_ownership: {
    label: "Conference Purchase",
    // Reference is a conference (a real conference_instances row — reference_id
    // is a genuine uuid column, so it can't carry a synthetic compound key).
    // "Booth" vs "registration" are two fields on that same referenced
    // conference rather than two different references, because neither one
    // maps to a single conference_entities row: Standard/Connected are
    // different booth entities, and Day Pass/Full Conference are different
    // registration entities — "owns a booth of either kind" is the kind-level
    // fact a suppression gate actually needs. See resolve.ts.
    requiresReference: { label: "Conference", endpoint: "/api/admin/comms/conditions/conferences" },
    fields: {
      owns_booth: { label: "Owns a booth (any tier)", type: "boolean" },
      owns_registration: { label: "Has a registration (Day Pass or Full Conference)", type: "boolean" },
    },
  },
};

export type ConditionOperator =
  | "is_empty"
  | "is_not_empty"
  | "equals"
  | "not_equals"
  | "contains"
  | "before"
  | "after"
  | "is_true"
  | "is_false";

export const OPERATORS_BY_FIELD_TYPE: Record<ConditionFieldType, { value: ConditionOperator; label: string }[]> = {
  nullable: [
    { value: "is_empty", label: "is empty" },
    { value: "is_not_empty", label: "is not empty" },
    { value: "equals", label: "equals" },
    { value: "not_equals", label: "does not equal" },
    { value: "contains", label: "contains" },
  ],
  string: [
    { value: "equals", label: "equals" },
    { value: "not_equals", label: "does not equal" },
    { value: "contains", label: "contains" },
  ],
  enum: [
    { value: "equals", label: "is" },
    { value: "not_equals", label: "is not" },
  ],
  date: [
    { value: "is_empty", label: "is empty" },
    { value: "is_not_empty", label: "is set" },
    { value: "before", label: "is before" },
    { value: "after", label: "is after" },
  ],
  boolean: [
    { value: "is_true", label: "is true" },
    { value: "is_false", label: "is false" },
  ],
};
