// ─────────────────────────────────────────────────────────────────
// Chunk 24: Events — Types
// ─────────────────────────────────────────────────────────────────

export type EventStatus =
  | "pending_review"
  | "draft"
  | "published"
  | "cancelled"
  | "completed";

export type EventAudienceMode =
  | "public"               // Anyone, no login required
  | "members_and_partners" // Any authenticated member or partner
  | "members"              // Member orgs only (not partners)
  | "partners"             // Partner orgs only
  | "org_admin"            // Org administrators and above
  | "board";               // CSC admins / board only

export const AUDIENCE_MODE_LABELS: Record<EventAudienceMode, string> = {
  public:               "Public",
  members_and_partners: "Members & Partners",
  members:              "Members",
  partners:             "Partners",
  org_admin:            "Org Administrators",
  board:                "Board & CSC Admins",
};

export const AUDIENCE_MODE_DESCRIPTIONS: Record<EventAudienceMode, string> = {
  public:               "Visible to anyone, no login required",
  members_and_partners: "Any logged-in member or partner",
  members:              "Member organizations only",
  partners:             "Partner organizations only",
  org_admin:            "Org admins, CSC admins, and board",
  board:                "CSC admins and super admins only",
};

// ── DB row ────────────────────────────────────────────────────────

export interface Event {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  body_html: string | null;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  virtual_link: string | null;
  is_virtual: boolean;
  audience_mode: EventAudienceMode;
  capacity: number | null;
  status: EventStatus;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** The conference catalog entity this event is bound to, if any — see lib/events/conference-link.ts. */
  conference_entity_id: string | null;
}

export interface EventRegistration {
  id: string;
  event_id: string;
  user_id: string;
  status: "registered" | "cancelled" | "waitlisted" | "promoted";
  registered_at: string;
  cancelled_at: string | null;
}

export interface EventWaitlistEntry {
  id: string;
  event_id: string;
  user_id: string;
  position: number;
  joined_at: string;
  promoted_at: string | null;
}

export interface EventCheckin {
  id: string;
  event_id: string;
  registration_id: string;
  user_id: string;
  checked_in_at: string;
  checked_in_by: string | null;
}

// ── Enriched / admin views ────────────────────────────────────────

export interface EventWithMeta extends Event {
  registration_count: number;
  waitlist_count: number;
  creator_name: string | null;
}

export interface AttendeeRow {
  registration_id: string;
  user_id: string;
  display_name: string | null;
  email: string | null;
  registration_status: EventRegistration["status"];
  registered_at: string;
  cancelled_at: string | null;
  checked_in: boolean;
  checked_in_at: string | null;
}

export interface WaitlistRow {
  waitlist_id: string;
  user_id: string;
  display_name: string | null;
  email: string | null;
  position: number;
  joined_at: string;
}

// ── Public-facing view ────────────────────────────────────────────

export interface EventPublicView extends Event {
  /** null = unlimited */
  spots_remaining: number | null;
  /** null = not registered / not logged in */
  user_registration_status: "registered" | "waitlisted" | "cancelled" | null;
}

// ── Create / update payloads ──────────────────────────────────────

export interface CreateEventPayload {
  title: string;
  description?: string;
  body_html?: string;
  starts_at: string;
  ends_at?: string;
  location?: string;
  virtual_link?: string;
  is_virtual?: boolean;
  audience_mode?: EventAudienceMode;
  capacity?: number;
  metadata?: Record<string, unknown>;
  conference_entity_id?: string | null;
}

export interface UpdateEventPayload {
  title?: string;
  slug?: string;
  description?: string;
  body_html?: string;
  starts_at?: string;
  ends_at?: string;
  location?: string;
  virtual_link?: string;
  is_virtual?: boolean;
  audience_mode?: EventAudienceMode;
  capacity?: number | null;
  metadata?: Record<string, unknown>;
  conference_entity_id?: string | null;
}

// ── Status transitions ────────────────────────────────────────────

export const EVENT_STATUS_TRANSITIONS: Record<EventStatus, EventStatus[]> = {
  pending_review: ["draft", "published", "cancelled"],
  draft:          ["published", "cancelled"],
  published:      ["completed", "cancelled"],
  completed:      [],
  cancelled:      ["draft"],
};

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  pending_review: "Awaiting Approval",
  draft:          "Draft",
  published:      "Published",
  completed:      "Completed",
  cancelled:      "Cancelled",
};

// ── Event with org branding context (for public listing) ──────────

export interface EventWithOrgContext extends Event {
  /** null = unlimited */
  spots_remaining: number | null;
  /** null = not registered / not logged in */
  user_registration_status: "registered" | "waitlisted" | "cancelled" | null;
  /** Creator's display name — null for admin-created (CSC) events */
  creator_display_name: string | null;
  /** Hosting org name — "Campus Stores Canada" for admin-created events */
  creator_org_name: string;
  /** Primary brand hex (with #) — #163D6D for admin-created events */
  creator_primary_color: string;
  /** Map centre latitude — 56 for Canada-wide fallback */
  creator_lat: number;
  /** Map centre longitude — -95 for Canada-wide fallback */
  creator_lng: number;
  /** Mapbox zoom — 3 for Canada-wide, 8 for city-level */
  creator_zoom: number;
}
