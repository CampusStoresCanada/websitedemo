// ─────────────────────────────────────────────────────────────────
// Chunk 22: Communications — Types
// ─────────────────────────────────────────────────────────────────

export type CampaignStatus =
  | "draft"
  | "scheduled"
  | "sending"
  | "completed"
  | "failed"
  | "canceled";

export type CampaignChannel = "email";

export type AutomationMode = "draft_only" | "auto_send";

export type TriggerSource =
  | "manual"
  | "renewal"
  | "conference"
  | "events"
  | "user_mgmt";

export type DeliveryStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "bounced"
  | "failed"
  | "complained";

export type AutomationRunStatus =
  | "created_draft"
  | "sent"
  | "skipped"
  | "failed";

export type TemplateCategory =
  | "renewal"
  | "membership"
  | "conference"
  | "events"
  | "user_mgmt"
  | "general";

// ── Template key registry (all known keys) ────────────────────────
export type TemplateKey =
  // Renewal
  | "renewal_reminder"
  | "renewal_charge_failed"
  | "grace_weekly_reminder"
  | "membership_locked"
  | "opt_out_confirmation"
  // User management
  | "org_user_invited"
  | "org_user_added_to_org"
  | "org_user_deactivated"
  | "org_user_reactivated"
  | "org_user_role_changed"
  | "admin_transfer_initiated"
  | "admin_transfer_completed"
  | "admin_transfer_canceled"
  | "admin_transfer_fallback"
  // Conference
  | "conference_registration_confirmation"
  | "conference_payment_confirmation"
  | "conference_schedule_ready"
  | "conference_swap_confirmation"
  | "conference_missing_travel_data"
  | "conference_reminder"
  | "conference_waitlist_approved"
  | "conference_checklist_reminder"
  // Events
  | "event_submitted"
  | "event_approved"
  | "event_changes_requested"
  | "event_registration_confirmation"
  | "event_reminder"
  | "event_cancelled"
  | "event_waitlist_promoted";

export interface MessageTemplate {
  id: string;
  key: TemplateKey;
  category: TemplateCategory;
  name: string;
  description: string | null;
  subject: string;
  body_html: string;
  variable_keys: string[];
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface MessageCampaign {
  id: string;
  name: string;
  status: CampaignStatus;
  channel: CampaignChannel;
  template_id: string | null;
  subject_override: string | null;
  body_override: string | null;
  audience_definition: AudienceDefinition;
  variable_values: Record<string, string>;
  trigger_source: TriggerSource;
  automation_mode: AutomationMode | null;
  trigger_event_key: string | null;
  scheduled_at: string | null;
  sent_at: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageRecipient {
  id: string;
  campaign_id: string;
  user_id: string | null;
  contact_email: string;
  display_name: string | null;
  variable_overrides: Record<string, string>;
  resolved_at: string;
}

export interface MessageDelivery {
  id: string;
  campaign_id: string;
  recipient_id: string;
  provider_message_id: string | null;
  status: DeliveryStatus;
  error: string | null;
  queued_at: string;
  sent_at: string | null;
  delivered_at: string | null;
  bounced_at: string | null;
  failed_at: string | null;
  complained_at: string | null;
}

export interface MessageAutomationRun {
  id: string;
  trigger_source: TriggerSource;
  trigger_event_key: string;
  campaign_id: string | null;
  status: AutomationRunStatus;
  error: string | null;
  created_at: string;
  processed_at: string | null;
}

// ── Audience definition ───────────────────────────────────────────

export type AudienceType =
  | "conference_delegates"
  | "conference_exhibitors"
  | "conference_all"
  | "conference_holders"
  | "conference_orgs_with_open_seats"
  | "conference_orgs_fully_assigned"
  | "global_admins"
  | "org_admins"
  | "event_registrants"
  | "custom_emails"
  /**
   * Internal-only — not exposed in the campaign-builder UI. Used by
   * orchestration code (e.g. the checklist reminder engine) that has
   * already resolved exactly who to email and with what per-recipient
   * variables, and just needs createCampaign/executeCampaignSend to do
   * the sending + delivery tracking.
   */
  | "custom_recipient_list";

export interface AudienceDefinition {
  type: AudienceType;
  filters?: {
    conference_instance_id?: string;
    event_id?: string;
    org_ids?: string[];
    emails?: string[];
    /** For conference_holders / conference_orgs_*: limit to people holding a seat of this kind (e.g. "booth"). */
    seat_kind?: string;
    /**
     * For conference_holders / conference_orgs_*: limit to holders of one specific
     * conference_entities row (a named, admin-authored catalog item — e.g. one
     * particular booth tier or add-on), not just its kind. Takes priority over
     * seat_kind when both are set.
     */
    entity_id?: string;
    /** For custom_recipient_list: exactly who to send to, with per-recipient variables already resolved. */
    recipients?: { email: string; name?: string | null; variableOverrides?: Record<string, string> }[];
  };
}

// ── Send request ──────────────────────────────────────────────────

export interface SendCampaignOptions {
  campaignId: string;
  /** Dry run: resolve recipients and render but don't actually send */
  dryRun?: boolean;
}

export interface ResolvedRecipient {
  userId: string | null;
  email: string;
  name: string | null;
  variableOverrides?: Record<string, string>;
}

// ── Automation trigger ────────────────────────────────────────────

export interface TriggerAutomationOptions {
  triggerSource: TriggerSource;
  /** Unique key for idempotency — same key = same run, no duplicate send */
  triggerEventKey: string;
  /** Code default — used as-is unless an automation_rules row overrides it. */
  templateKey: TemplateKey;
  /** Code default — used as-is unless an automation_rules row overrides it. */
  automationMode: AutomationMode;
  /** Campaign name for display in admin UI */
  campaignName: string;
  audience: AudienceDefinition;
  /** Pre-resolved variable values for all recipients */
  variableValues: Record<string, string>;
  /** Per-recipient overrides (indexed by email) */
  recipientOverrides?: Record<string, Record<string, string>>;
  /**
   * Identity for the admin-configurable rule override (automation_rules.rule_key)
   * — distinct from triggerEventKey, which is per-instance (one per person/event).
   * Defaults to templateKey, which is a stable, sensible identity for most
   * triggers. Pass explicitly only when a trigger's template can legitimately
   * change per-call, so the rule identity needs to stay fixed regardless.
   */
  ruleKey?: string;
}
