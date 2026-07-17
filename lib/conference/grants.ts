/**
 * Conference v2 grant vocabulary — pure types, definitions, and validation.
 *
 * A grant is grant_type × quantity × scope: the declarative contents of a
 * product. Eligibility/purchasability stays in the rules engine; grants only
 * say what a purchase includes. Each grant type also declares the data
 * obligations its assignee eventually owes (drives Stage 4 readiness).
 *
 * No imports from server-only modules — everything here is unit-testable.
 * See docs/CONFERENCE_V2_BLUEPRINT.md.
 */

export const GRANT_TYPES = [
  "booth_space",
  "badge_seat",
  "day_access",
  "offsite_seat",
  "meal_access",
  "meeting_access",
  "education_access",
] as const;

export type GrantType = (typeof GRANT_TYPES)[number];

export const GRANT_REGISTRATION_TYPES = [
  "delegate",
  "exhibitor",
  "observer",
  "staff",
  "speaker",
] as const;

export type GrantRegistrationType = (typeof GRANT_REGISTRATION_TYPES)[number];

export const DAY_ACCESS_KINDS = ["floor", "meeting", "move_in", "move_out"] as const;
export type DayAccessKind = (typeof DAY_ACCESS_KINDS)[number];

/** Which scope mechanism a grant type uses when scope_mode = 'selected'. */
export type GrantScopeKind =
  | "none"
  | "booth"
  | "days"
  /** one element (e.g. an offsite seat scopes to a single event element) */
  | "element"
  /** many elements (e.g. meal/education access scopes to a set of elements) */
  | "elements";

/**
 * Data the assigned person owes once this grant is allocated to them, and
 * which deadline that obligation tracks against. Stage 4 readiness is derived
 * from the union of obligations across a person's assigned grants.
 */
export type DataObligation = {
  key: string;
  label: string;
  deadline: "badge_print" | "offsite_lock" | "travel_cutoff" | "registration_close";
};

export type GrantTypeDefinition = {
  label: string;
  description: string;
  scopeKind: GrantScopeKind;
  /** Whether scope_mode 'all' (every current + future noun) is meaningful. */
  allowsScopeAll: boolean;
  /** Whether scope_registration_type applies. */
  usesRegistrationType: boolean;
  dataObligations: DataObligation[];
};

export const GRANT_TYPE_DEFINITIONS: Record<GrantType, GrantTypeDefinition> = {
  booth_space: {
    label: "Booth space",
    description: "One trade-show booth slot, chosen from the floor plan at or after purchase.",
    scopeKind: "booth",
    allowsScopeAll: true,
    usesRegistrationType: false,
    dataObligations: [],
  },
  badge_seat: {
    label: "Badge seat",
    description: "An assignable attendee seat producing a name badge of the given registration type.",
    scopeKind: "none",
    allowsScopeAll: true,
    usesRegistrationType: true,
    dataObligations: [
      { key: "display_name", label: "Badge name", deadline: "badge_print" },
      { key: "contact_email", label: "Contact email", deadline: "badge_print" },
    ],
  },
  day_access: {
    label: "Day access",
    description: "Access to the conference on specific days (floor, meeting space, move-in/out).",
    scopeKind: "days",
    allowsScopeAll: true,
    usesRegistrationType: false,
    dataObligations: [],
  },
  offsite_seat: {
    label: "Offsite seat",
    description: "A seat at a specific offsite event element.",
    scopeKind: "element",
    allowsScopeAll: false,
    usesRegistrationType: false,
    dataObligations: [
      { key: "dietary_restrictions", label: "Dietary restrictions", deadline: "offsite_lock" },
      { key: "accessibility_needs", label: "Accessibility needs", deadline: "offsite_lock" },
      { key: "emergency_contact_name", label: "Emergency contact name", deadline: "offsite_lock" },
      { key: "emergency_contact_phone", label: "Emergency contact phone", deadline: "offsite_lock" },
    ],
  },
  meal_access: {
    label: "Meal access",
    description: "Access to meal elements (all of them, or a selected set).",
    scopeKind: "elements",
    allowsScopeAll: true,
    usesRegistrationType: false,
    dataObligations: [
      { key: "dietary_restrictions", label: "Dietary restrictions", deadline: "registration_close" },
    ],
  },
  meeting_access: {
    label: "Meeting access",
    description: "Participation in the scheduled-meetings program.",
    scopeKind: "days",
    allowsScopeAll: true,
    usesRegistrationType: false,
    dataObligations: [],
  },
  education_access: {
    label: "Education access",
    description: "Access to education elements (all, or a selected set).",
    scopeKind: "elements",
    allowsScopeAll: true,
    usesRegistrationType: false,
    dataObligations: [],
  },
};

// ─────────────────────────────────────────────────────────────────
// Grant input shape (composer/actions write this; DB rows mirror it)
// ─────────────────────────────────────────────────────────────────

export type GrantInput = {
  grantType: GrantType;
  quantity: number;
  // Only 'order' is supported: quantity is per order line. A per-attendee
  // multiplier was specced but never implemented end-to-end (minting skipped
  // it), so it was removed to avoid a silent dead path.
  per: "order";
  scopeMode: "all" | "selected";
  scopeRegistrationType?: GrantRegistrationType | null;
  scopeBoothId?: string | null;
  /** offsite_seat: the single element (event) this seat is for. */
  scopeElementId?: string | null;
  dayScopes?: Array<{ dayId: string; accessKind: DayAccessKind }>;
  /** meal_access / education_access: the elements this grant covers. */
  elementIds?: string[];
  notes?: string | null;
};

/** Catalog id sets used to check that scopes reference real conference things. */
export type GrantScopeCatalog = {
  dayIds: ReadonlySet<string>;
  elementIds: ReadonlySet<string>;
  boothIds: ReadonlySet<string>;
};

// ─────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────

/** Structural validation — no catalog needed. Returns human-readable errors. */
export function validateGrantInput(input: GrantInput): string[] {
  const errors: string[] = [];
  const def = GRANT_TYPE_DEFINITIONS[input.grantType];

  if (!def) {
    return [`Unknown grant type: ${String(input.grantType)}`];
  }

  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    errors.push(`${def.label}: quantity must be a positive integer.`);
  }
  if (input.per !== "order") {
    errors.push(`${def.label}: per must be 'order'.`);
  }

  if (input.scopeMode === "all" && !def.allowsScopeAll) {
    errors.push(`${def.label}: requires a specific scope (scope_mode 'all' is not allowed).`);
  }

  if (def.usesRegistrationType) {
    if (
      !input.scopeRegistrationType ||
      !GRANT_REGISTRATION_TYPES.includes(input.scopeRegistrationType)
    ) {
      errors.push(`${def.label}: requires a registration type scope.`);
    }
  } else if (input.scopeRegistrationType) {
    errors.push(`${def.label}: registration type scope does not apply.`);
  }

  // Scope payloads must match the type's scope kind.
  const hasDays = (input.dayScopes?.length ?? 0) > 0;
  const hasElements = (input.elementIds?.length ?? 0) > 0;
  const hasElement = Boolean(input.scopeElementId);
  const hasBooth = Boolean(input.scopeBoothId);

  if (hasDays && def.scopeKind !== "days") {
    errors.push(`${def.label}: day scopes do not apply.`);
  }
  if (hasElements && def.scopeKind !== "elements") {
    errors.push(`${def.label}: element scopes do not apply.`);
  }
  if (hasElement && def.scopeKind !== "element") {
    errors.push(`${def.label}: single-element scope does not apply.`);
  }
  if (hasBooth && def.scopeKind !== "booth") {
    errors.push(`${def.label}: booth scope does not apply.`);
  }

  if (input.scopeMode === "selected") {
    switch (def.scopeKind) {
      case "days":
        if (!hasDays) errors.push(`${def.label}: select at least one day.`);
        break;
      case "elements":
        if (!hasElements) errors.push(`${def.label}: select at least one element.`);
        break;
      case "element":
        if (!hasElement) errors.push(`${def.label}: select an element.`);
        break;
      case "booth":
        // A specific booth is optional even in selected mode (booth chosen later).
        break;
      case "none":
        break;
    }
  }

  for (const dayScope of input.dayScopes ?? []) {
    if (!DAY_ACCESS_KINDS.includes(dayScope.accessKind)) {
      errors.push(`${def.label}: invalid day access kind '${String(dayScope.accessKind)}'.`);
    }
  }

  return errors;
}

/** Referential validation — every scope id must belong to the conference. */
export function validateGrantScopes(
  input: GrantInput,
  catalog: GrantScopeCatalog
): string[] {
  const errors: string[] = [];
  const def = GRANT_TYPE_DEFINITIONS[input.grantType];
  if (!def) return errors; // structural validation already failed

  for (const dayScope of input.dayScopes ?? []) {
    if (!catalog.dayIds.has(dayScope.dayId)) {
      errors.push(`${def.label}: day ${dayScope.dayId} is not part of this conference.`);
    }
  }
  for (const elementId of input.elementIds ?? []) {
    if (!catalog.elementIds.has(elementId)) {
      errors.push(`${def.label}: element ${elementId} is not part of this conference.`);
    }
  }
  if (input.scopeElementId && !catalog.elementIds.has(input.scopeElementId)) {
    errors.push(`${def.label}: element ${input.scopeElementId} is not part of this conference.`);
  }
  if (input.scopeBoothId && !catalog.boothIds.has(input.scopeBoothId)) {
    errors.push(`${def.label}: booth ${input.scopeBoothId} is not part of this conference.`);
  }

  return errors;
}

/** Union of data obligations across a set of grant types (deduped by key). */
export function collectDataObligations(grantTypes: GrantType[]): DataObligation[] {
  const seen = new Map<string, DataObligation>();
  for (const type of grantTypes) {
    for (const obligation of GRANT_TYPE_DEFINITIONS[type]?.dataObligations ?? []) {
      if (!seen.has(obligation.key)) seen.set(obligation.key, obligation);
    }
  }
  return [...seen.values()];
}
