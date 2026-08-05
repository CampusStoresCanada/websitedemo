/**
 * Build suggestions, not a schema. Kinds are free labels — these are just
 * starting points offered in "add a thing" so an admin isn't staring at a blank
 * field, each with the properties it usually has. Relationships are the small,
 * meaningful vocabulary of reference roles the engine understands. Coining a new
 * kind needs nothing here; this only makes the common path faster.
 */

export type FieldType = "text" | "textarea" | "time" | "date" | "number";

export type SuggestedField = {
  key: string;
  label: string;
  type: FieldType;
  /** Example shown as ghost text in the value box, e.g. "8'×10'". */
  placeholder?: string;
  /** One-line nudge under the field so the label isn't cryptic. */
  hint?: string;
};

export type KindSuggestion = {
  kind: string;
  label: string;
  /** One line of guidance shown when this kind is chosen — what it's for. */
  hint?: string;
  /** Properties this kind usually carries (offered as starter property rows). */
  fields: SuggestedField[];
  /** Relationship roles this kind usually fills out (offered as starter rows). */
  suggestedRoles?: string[];
  /** Roles this kind should have to be considered defined (drives open questions). */
  requiredRoles?: string[];
  /** Property keys this kind should have a value for (drives open questions). */
  requiredFields?: string[];
  sellable?: boolean;
  seeded?: boolean;
  /** True when price is computed live per-org at checkout rather than stored
   *  on the entity — hides the price/tier inputs in Build and exempts the
   *  entity from the "marked for sale but has no price" open question. */
  computedPricing?: boolean;
  /** True when eligibility is enforced entirely in code (by kind and buyer
   *  tier/status), not by a `who` ref — because the entity is never directly
   *  purchasable (e.g. auto-attached only when another offer requires it).
   *  Exempts it from the "no audience" open question, which it could never
   *  satisfy meaningfully. */
  audienceGatedByCode?: boolean;
};

/**
 * Relationship = a typed edge. The role is what the engine bills/grants/schedules
 * on. `target` only HINTS what you'll usually plug in (for ordering the picker);
 * you can point any role at any thing.
 */
export type Relationship = {
  role: string;
  label: string;
  verb: string;
  hasQuantity: boolean;
  targetHint?: string;
  hint?: string;
};

export const RELATIONSHIPS: Relationship[] = [
  { role: "includes", label: "Includes", verb: "includes", hasQuantity: true, hint: "What this is made of or bundles — tables, chairs, registrations, tickets." },
  { role: "involved_in", label: "Involved in", verb: "involved in", hasQuantity: false, hint: "Sessions or things this takes part in." },
  { role: "when", label: "When", verb: "on", hasQuantity: false, targetHint: "day" },
  { role: "where", label: "Where", verb: "at", hasQuantity: false, targetHint: "venue" },
  { role: "who", label: "Who", verb: "for", hasQuantity: false, targetHint: "audience", hint: "Inherited from the website; add your own too." },
  { role: "about", label: "About", verb: "about", hasQuantity: false, hint: "Comms, emails, notices tied to this." },
  { role: "requires", label: "Requires", verb: "requires", hasQuantity: false, targetHint: "policy", hint: "A policy (terms/waiver) anyone holding this must accept before they're complete." },
  { role: "requires_ownership_of", label: "Requires ownership of", verb: "requires ownership of", hasQuantity: false, hint: "The buying org must already hold one of this kind (e.g. a booth) before this can be bought on its own." },
];

export const RELATIONSHIP_BY_ROLE: Record<string, Relationship> = Object.fromEntries(
  RELATIONSHIPS.map((r) => [r.role, r])
);

const TIME_FIELDS: SuggestedField[] = [
  { key: "start_time", label: "Starts", type: "time" },
  { key: "end_time", label: "Ends", type: "time" },
];

const SUMMARY_FIELD: SuggestedField = {
  key: "summary", label: "Summary", type: "text",
  placeholder: "e.g. what to expect in one line",
  hint: "Short teaser shown in listings — put the full write-up in Purpose.",
};

const VIRTUAL_LINK_FIELD: SuggestedField = {
  key: "virtual_link", label: "Video call link", type: "text",
  placeholder: "e.g. Google Meet URL",
  hint: "Leave blank for in-person — set this to mark it virtual (used if RSVP via Events is enabled).",
};

// Draft scaffolding: every field carries an example and (where the label could
// be cryptic) a one-line hint. All of it is editable or removable — it's there
// so nobody stares at a blank "Property" box wondering what to type.
export const KIND_SUGGESTIONS: KindSuggestion[] = [
  {
    kind: "session", label: "Session",
    hint: "A talk, panel, or workshop on the agenda. Set when it runs and who it's for.",
    fields: [
      SUMMARY_FIELD,
      { key: "purpose", label: "Purpose", type: "textarea", placeholder: "e.g. how buyers and vendors connect" },
      { key: "format", label: "Format", type: "text", placeholder: "e.g. panel, keynote, workshop" },
      VIRTUAL_LINK_FIELD,
      ...TIME_FIELDS,
    ],
    suggestedRoles: ["when", "where", "who"], requiredRoles: ["when"], sellable: true,
  },
  {
    kind: "meeting", label: "Meeting",
    hint: "A scheduled meeting slot — buyer/seller, board, committee. Often capped by seats.",
    fields: [
      SUMMARY_FIELD,
      { key: "capacity", label: "Seats", type: "number", placeholder: "e.g. 8", hint: "How many people fit." },
      VIRTUAL_LINK_FIELD,
      ...TIME_FIELDS,
    ],
    suggestedRoles: ["when", "where", "who"], requiredRoles: ["when"], sellable: true,
  },
  {
    kind: "presentation_slot", label: "Presentation Slot",
    hint: "A paid, first-come speaking slot for a vendor — e.g. a service provider showcasing a new feature or model. Gate purchase to specific vendor categories with direct_purchase_only / direct_purchase_category.",
    fields: [
      SUMMARY_FIELD,
      { key: "presenter_org", label: "Presenter org (optional)", type: "text", hint: "Fill in once a vendor claims the slot." },
      ...TIME_FIELDS,
    ],
    suggestedRoles: ["when", "where", "who"], requiredRoles: ["when"], sellable: true,
  },
  {
    kind: "event", label: "Event",
    hint: "An off-agenda happening — reception, tour, gala.",
    fields: [
      SUMMARY_FIELD,
      { key: "purpose", label: "Purpose", type: "textarea", placeholder: "e.g. welcome reception" },
      VIRTUAL_LINK_FIELD,
      ...TIME_FIELDS,
    ],
    suggestedRoles: ["when", "where", "who"], requiredRoles: ["when"], sellable: true,
  },
  {
    kind: "networking", label: "Networking",
    hint: "Mixers, meet-and-greets, matchmaking.",
    fields: [
      SUMMARY_FIELD,
      { key: "format", label: "Format", type: "text", placeholder: "e.g. speed networking" },
      VIRTUAL_LINK_FIELD,
      ...TIME_FIELDS,
    ],
    suggestedRoles: ["when", "where", "who"], requiredRoles: ["when"], sellable: true,
  },
  {
    kind: "meal", label: "Meal",
    hint: "Catered service — breakfast, lunch, banquet.",
    fields: [{ key: "notes", label: "Notes", type: "text", placeholder: "e.g. plated; vegetarian option" }, ...TIME_FIELDS],
    suggestedRoles: ["when", "where", "who"], requiredRoles: ["when"], sellable: true,
  },
  {
    kind: "booth", label: "Booth",
    hint: "A sellable exhibit space. Usually includes furniture + a few registrations, and takes part in move-in / show / move-out.",
    fields: [
      { key: "size", label: "Size", type: "text", placeholder: "e.g. 8'×10'" },
      { key: "number", label: "Booth #", type: "text", placeholder: "e.g. 601", hint: "Leave blank on the type; set it per instance." },
    ],
    suggestedRoles: ["includes", "involved_in"], requiredRoles: ["includes"], sellable: true,
  },
  {
    kind: "registration", label: "Registration",
    hint: "A pass someone holds. Set who it's for and what it gets them into (Includes / Involved in).",
    fields: [], suggestedRoles: ["who", "includes"], sellable: true,
  },
  {
    kind: "ticket", label: "Ticket",
    hint: "A single-thing pass — networking, a meal, an add-on.",
    fields: [], suggestedRoles: ["who"], sellable: true,
  },
  {
    kind: "equipment", label: "Equipment",
    hint: "A physical item a booth or room includes.",
    fields: [{ key: "spec", label: "Spec", type: "text", placeholder: "e.g. 6'×2' table" }], suggestedRoles: [],
  },
  {
    kind: "suite", label: "Suite",
    hint: "A meeting room the scheduler places buyer/seller meetings in. Connect it to a Venue (Where) to assign it to a physical room. How many suites you add sets how many meetings run in parallel.",
    fields: [
      { key: "suite_number", label: "Suite #", type: "number", placeholder: "e.g. 1" },
      { key: "organization_id", label: "Pinned org (optional)", type: "text", hint: "Reserve this suite for one exhibitor org." },
    ],
    suggestedRoles: ["where"],
  },
  {
    kind: "venue", label: "Venue",
    hint: "A room or space things happen in. Referenced as Where.",
    fields: [
      { key: "address", label: "Address", type: "text", placeholder: "e.g. 123 King St, Hall A" },
      { key: "capacity", label: "Capacity", type: "number", placeholder: "e.g. 400", hint: "Max occupancy." },
    ],
    requiredFields: ["capacity"],
  },
  {
    kind: "floorplan", label: "Floor Plan",
    hint: "An exhibit-hall layout. Holds the booth categories on it.",
    fields: [{ key: "notes", label: "Notes", type: "textarea", placeholder: "e.g. Hall A, 120 booths over two aisles" }],
    suggestedRoles: ["includes"],
  },
  {
    kind: "policy", label: "Policy",
    hint: "Terms, a waiver, or an eligibility rule referenced by Offers.",
    fields: [{ key: "body", label: "Text", type: "textarea", placeholder: "e.g. Cancellations before Jan 1 are fully refundable…" }],
    requiredFields: ["body"],
  },
  {
    kind: "day", label: "Day",
    hint: "Inherited from the conference's dates. Referenced as When. Add meeting cadence to make it a meeting day the scheduler can use.",
    fields: [
      { key: "date", label: "Date", type: "date" },
      { key: "meeting_start_time", label: "Meetings start", type: "time", hint: "Set start + end to make this a meeting day." },
      { key: "meeting_end_time", label: "Meetings end", type: "time" },
      { key: "slot_duration_minutes", label: "Slot duration (min)", type: "number", placeholder: "e.g. 15" },
      { key: "meeting_buffer_minutes", label: "Buffer (min)", type: "number", placeholder: "e.g. 5" },
      { key: "meeting_count", label: "Meetings (optional)", type: "number", hint: "Leave blank to derive from the time window." },
    ],
    seeded: true,
  },
  { kind: "audience", label: "Audience", hint: "Inherited from the website's people categories. Referenced as Who.", fields: [{ key: "description", label: "Description", type: "text", placeholder: "e.g. first-time attendees" }], seeded: true },
  {
    kind: "membership_renewal", label: "Membership Renewal",
    hint: "Auto-provisioned, one per conference. Attach as Requires on an offer (e.g. a booth) to require an active membership through the conference's dates — price is computed per-org at checkout, not set here.",
    fields: [], sellable: true, seeded: true, computedPricing: true, audienceGatedByCode: true,
  },
];

export const SUGGESTION_BY_KIND: Record<string, KindSuggestion> = Object.fromEntries(
  KIND_SUGGESTIONS.map((s) => [s.kind, s])
);

/** A label for a kind: the suggestion's nice label, else the raw kind word. */
export function kindLabel(kind: string): string {
  return SUGGESTION_BY_KIND[kind]?.label ?? kind.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
