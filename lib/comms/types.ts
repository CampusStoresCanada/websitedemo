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
  // Benchmarking. Transactional: the survey is a membership obligation and a
  // member benefit, not a commercial message, so these bypass suppressions on
  // the same reasoning as election mail. See lib/benchmarking/notify.ts.
  | "benchmarking"
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
  | "prospective_booth_payment_confirmation"
  | "prospective_booth_application_reminder"
  // Events
  // Benchmarking
  | "benchmarking_invitation"
  | "benchmarking_beta_invitation"
  | "benchmarking_reminder"
  | "benchmarking_submission_received"

  | "event_submitted"
  | "event_approved"
  | "event_changes_requested"
  | "event_registration_confirmation"
  | "event_reminder"
  | "event_cancelled"
  | "event_waitlist_promoted";

export interface MessageTemplate {
  id: string;
  /** Known system keys autocomplete; campaign-forked/custom templates carry a generated key outside this union. */
  key: TemplateKey | (string & {});
  category: TemplateCategory;
  name: string;
  description: string | null;
  subject: string;
  body_html: string;
  variable_keys: string[];
  is_system: boolean;
  /** Operational/transactional — bypasses unsubscribe preferences (CASL-exempt). Commercial templates respect comms_suppressions. */
  is_transactional: boolean;
  /** Set when this template is a campaign-scoped fork, not part of the shared library. */
  campaign_id: string | null;
  /** The library template this was forked from, if any (null for a blank-started campaign email). */
  forked_from_template_id: string | null;
  /**
   * Visual-builder authoring data (see lib/comms/blocks/). Null for
   * templates authored the old way — raw body_html, hand-edited. When
   * set, body_html is compiled from this on every save and stays the
   * thing that actually gets sent; nothing else in the comms system
   * needs to know blocks exist.
   */
  body_blocks: import("./blocks/types").ContentBlock[] | null;
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
  /** The campaign initiative this send belongs to, if any. */
  campaign_id: string | null;
  scheduled_at: string | null;
  sent_at: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ── Campaign initiative (the ongoing thing with a goal — e.g. "Onboarding
// for Partner Admins") — distinct from MessageCampaign, which is one send.
// A CommsCampaign owns a roster of forked MessageTemplates (its emails);
// each of those can be sent (and resent) many times as MessageCampaign rows.

export type CampaignInitiativeStatus = "active" | "paused" | "ended";

export interface CommsCampaign {
  id: string;
  name: string;
  goal: string | null;
  status: CampaignInitiativeStatus;
  /**
   * Saved condition keys that must ALL still be true for someone to keep
   * receiving this campaign's sends. Re-evaluated at send time (not when
   * the send was created) — see resolveEffectiveAudience in
   * lib/comms/audience.ts. Empty = every send under this campaign is
   * unfiltered by campaign-level relevance.
   */
  target_condition_keys: string[];
  /** "all" (default) requires every target condition; "any" requires at least one. */
  target_condition_match: "all" | "any";
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommsCampaignMilestone {
  id: string;
  campaign_id: string;
  /** The specific email (forked template) this milestone is about, if any. */
  template_id: string | null;
  occurred_at: string;
  note: string;
  created_by: string | null;
  created_at: string;
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
  opened_at: string | null;
  open_count: number;
  first_clicked_at: string | null;
  click_count: number;
}

/** One click on one link within one delivered email. Powers the per-link click map. */
export interface MessageLinkClick {
  id: string;
  delivery_id: string;
  campaign_id: string;
  url: string;
  clicked_at: string;
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
  | "conference_all"
  | "conference_holders"
  | "conference_orgs_with_open_seats"
  | "conference_orgs_fully_assigned"
  | "global_admins"
  | "org_admins"
  | "event_registrants"
  | "contact_tags"
  | "custom_emails"
  /**
   * Exact recipients with per-recipient variable overrides already
   * resolved — a real mail merge, each person gets their own values. Used
   * both by the admin-facing CSV paste in NewCampaignForm and by
   * orchestration code (e.g. the checklist reminder engine) that resolves
   * recipients programmatically.
   */
  | "custom_recipient_list";

export interface AudienceDefinition {
  type: AudienceType;
  filters?: {
    conference_instance_id?: string;
    event_id?: string;
    org_ids?: string[];
    /** For org_admins: limit to orgs of this type (e.g. "Vendor Partner", "Member"). Combines with org_ids as AND when both are set. Test orgs (organizations.is_test) are always excluded. */
    org_type?: string;
    /** For org_admins: which user_organizations.role values to include (any-of). Defaults to ["org_admin"] when unset, matching the type's own "All Org Admins" label — set to ["org_admin", "member"] to also reach regular (non-admin) org members. */
    roles?: string[];
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
    /** For contact_tags: contacts.contact_type values to match (see lib/contacts/tags.ts). Any-of match. */
    tags?: string[];
    /**
     * Saved condition keys (see lib/comms/conditions/) further narrowing
     * whichever audience type resolved above — a recipient must satisfy
     * ALL of these (AND) to stay in. Applied after the type-specific
     * resolution, regardless of audience type. Recipients with no
     * user_id (custom_emails/custom_recipient_list) have no resolvable
     * identity to check a condition against — they pass through
     * unfiltered rather than being excluded by default, since silently
     * emptying an admin-supplied list would be worse than not being able
     * to segment it.
     */
    condition_keys?: string[];
    /** "all" (default) requires every condition_keys entry; "any" requires at least one. */
    condition_match?: "all" | "any";
    /**
     * Set only by resolveEffectiveAudience (lib/comms/campaigns.ts), never
     * authored directly — the parent campaign's own "Still Relevant While"
     * gate, kept as a second, independent AND'd pass rather than merged
     * into condition_keys/condition_match above, since audience
     * segmentation and campaign-level ongoing relevance are two different
     * concerns that can each independently be ALL or ANY.
     */
    campaign_condition_keys?: string[];
    campaign_condition_match?: "all" | "any";
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
