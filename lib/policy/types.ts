// Policy Engine Types — Chunk 01

export interface PolicySet {
  id: string
  name: string
  status: 'draft' | 'published' | 'archived'
  is_active: boolean
  effective_at: string | null
  created_by: string | null
  created_at: string
  published_at: string | null
  notes: string | null
}

export interface PolicyValue {
  id: string
  policy_set_id: string
  key: string
  category: string
  label: string
  description: string | null
  type: 'integer' | 'decimal' | 'string' | 'boolean' | 'json' | 'string_array' | 'integer_array'
  value_json: unknown
  validation_schema: unknown | null
  is_high_risk: boolean
  display_order: number
  updated_at: string
}

export interface PolicyChangeLog {
  id: string
  policy_set_id: string
  key: string
  old_value_json: unknown | null
  new_value_json: unknown
  changed_by: string
  reason: string | null
  changed_at: string
}

export interface PolicyRollback {
  id: string
  from_policy_set_id: string
  to_policy_set_id: string
  rolled_back_by: string
  rolled_back_at: string
  reason: string | null
}

// Typed config shapes for common policy reads

export interface RenewalConfig {
  reminder_days: number[]
  dispatch_time: string
  dispatch_timezone: string
  grace_days: number
  reactivation_days: number
  refund_window_days: number
  access_lock_mode: string
}

export interface BillingConfig {
  proration_rules: Array<{ after_month_day: string; discount_pct: number }>
  membership_tiers: Array<{ max_fte: number | null; price: number }>
  partnership_rate: number
  downgrade_policy: string
  currency: string
  pricing_mode: string
  formula_config: {
    base: number
    multiplier: number
    min_price: number
    max_price: number
    rounding: 'nearest_dollar' | 'floor' | 'ceil'
  } | null
  metric_key: string | null
  metric_allowlist: string[]
  fallback_price: number
  fallback_behavior: 'use_fallback_price' | 'require_manual' | 'use_highest_tier'
  rounding_rule: 'nearest_dollar' | 'floor' | 'ceil'
  manual_override_allowed: boolean
  override_persistence: 'cycle_only' | 'until_cleared'
}

export interface SchedulingConfig {
  swap_cap: number
  swap_count_mode: 'requested' | 'committed'
  swap_admin_override: boolean
  tiebreak_mode: string
  delegate_coverage_pct: number
  meeting_group_min: number
  meeting_group_max: number
  feasibility_relaxation: boolean
  org_coverage_pct: number
}

export interface VisibilityConfig {
  public_allowlist: string[]
  private_fields: string[]
  masked_reveal_fields: string[]
  masking_rules: Record<string, MaskingRule>
}

export interface MaskingRule {
  mode: 'initials' | 'email_domain' | 'phone_prefix' | 'truncate'
  visible_digits?: number
}

export interface IntegrationConfig {
  source_of_truth: string
  conflict_rule: string
  circle_dm_mode: string
  circle_cutover_enabled: boolean
  circle_canary_org_ids: string[]
  circle_legacy_fallback_enabled: boolean
  conference_ops_masthead_org_ids: string[]
}

export interface RetentionConsentConfig {
  travel_delete_rule: string
  travel_data_required: boolean
  dietary_accessibility_required: boolean
}

// All policy categories
export const POLICY_CATEGORIES = [
  'renewals',
  'billing',
  'scheduling',
  'visibility',
  'integrations',
  'retention',
  'admin',
] as const

export type PolicyCategory = (typeof POLICY_CATEGORIES)[number]
