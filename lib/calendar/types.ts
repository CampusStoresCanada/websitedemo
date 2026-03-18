// ─────────────────────────────────────────────────────────────────
// Chunk 23: Calendar & Operational Timeline — Types
// ─────────────────────────────────────────────────────────────────

export type CalendarLayer = "people" | "admin_ops" | "system_ops";

export type CalendarCategory =
  | "conference"
  | "renewals_billing"
  | "legal_retention"
  | "communications"
  | "integrations_ops"
  | "membership"
  | "events";

export type CalendarSourceMode = "projected" | "manual";

export type CalendarStatus = "planned" | "active" | "done" | "blocked" | "cancelled";

export type CalendarSeverity = "normal" | "warning" | "critical";

export type CalendarRelatedEntityType =
  | "conference_instance"
  | "policy_set"
  | "message_campaign"
  | "renewal_job_run"
  | "scheduler_run"
  | "retention_job"
  | "ops_alert"
  | "signup_application"
  | "benchmarking_survey"
  | "billing_run"
  | "conference_legal_version"
  | "conference_program_item"
  | "event";

// ── DB row ────────────────────────────────────────────────────────

export interface CalendarItem {
  id: string;
  title: string;
  description: string | null;
  category: CalendarCategory;
  layer: CalendarLayer;
  starts_at: string;
  ends_at: string | null;
  source_mode: CalendarSourceMode;
  source_key: string | null;
  related_entity_type: CalendarRelatedEntityType | null;
  related_entity_id: string | null;
  owner_id: string | null;
  status: CalendarStatus;
  severity: CalendarSeverity;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  /** True for automated financial/org jobs (renewal charges, billing runs). */
  requires_confirmation: boolean;
  /** Set when an admin explicitly approves the upcoming run. Null = unconfirmed. */
  confirmed_at: string | null;
  /** Which admin confirmed. */
  confirmed_by: string | null;
}

// ── Confirmation gate result (for job runners) ────────────────────

export interface CalendarConfirmationResult {
  allowed: boolean;
  /** Present when allowed=false */
  reason?: string;
  confirmed_at?: string;
  confirmed_by?: string;
}

export interface CalendarItemNote {
  id: string;
  calendar_item_id: string;
  note: string;
  actor_id: string | null;
  created_at: string;
}

// ── Enriched view (with owner profile + notes count) ─────────────

export interface CalendarItemEnriched extends CalendarItem {
  owner_name: string | null;
  notes_count: number;
}

// ── Load saturation (per-day density) ─────────────────────────────

export interface DaySaturation {
  /** ISO date string: YYYY-MM-DD */
  date: string;
  admin_ops_count: number;
  system_ops_count: number;
  people_count: number;
  /** true when total >= SATURATION_THRESHOLD */
  overloaded: boolean;
}

// ── Aggregation result ─────────────────────────────────────────────

export interface CalendarAggregationResult {
  items: CalendarItemEnriched[];
  saturation: DaySaturation[];
  synced_at: string;
}

// ── Manual item create payload ────────────────────────────────────

export interface CreateManualItemPayload {
  title: string;
  description?: string;
  category: CalendarCategory;
  layer: CalendarLayer;
  starts_at: string;
  ends_at?: string;
  owner_id?: string;
  status?: CalendarStatus;
  severity?: CalendarSeverity;
}

// ── Item update payload (manual items only) ───────────────────────

export interface UpdateCalendarItemPayload {
  status?: CalendarStatus;
  severity?: CalendarSeverity;
  owner_id?: string | null;
  description?: string;
}

// ── Heartbeat response ────────────────────────────────────────────

export interface CalendarHeartbeatPayload {
  watermark: string;
}
