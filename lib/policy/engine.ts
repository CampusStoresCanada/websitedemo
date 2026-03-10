import { createAdminClient } from "@/lib/supabase/admin";
import type {
  PolicySet,
  PolicyValue,
  RenewalConfig,
  BillingConfig,
  SchedulingConfig,
  VisibilityConfig,
  IntegrationConfig,
  RetentionConsentConfig,
  MaskingRule,
} from './types'

// ---------------------------------------------------------------------------
// Cache — simple TTL, per-server-instance (fine for infrequent policy changes)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 60_000 // 60 seconds

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

const cache = new Map<string, CacheEntry<unknown>>()

function getPolicyClient() {
  // Policy resolution is server-side only in this codebase.
  // Use service-role to avoid runtime RLS misses in jobs/routes.
  return createAdminClient();
}

function getCached<T>(key: string): T | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    return null
  }
  return entry.data as T
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS })
}

/** Clear the entire policy cache (call on publish / rollback). */
export function clearPolicyCache(): void {
  cache.clear()
}

// ---------------------------------------------------------------------------
// Active policy set resolution
// ---------------------------------------------------------------------------

/**
 * Get the active policy set. Resolution order:
 * 1. Exactly one row with is_active = true
 * 2. Latest published where effective_at <= now (or null), ordered by effective_at DESC NULLS LAST, published_at DESC
 * 3. null (fail closed — callers must handle)
 */
export async function getActivePolicySet(): Promise<PolicySet | null> {
  const cached = getCached<PolicySet>('active_policy_set')
  if (cached) return cached

  // Try is_active = true first
  const supabase = getPolicyClient();
  const { data: activeSets, error: activeSetError } = await supabase
    .from('policy_sets')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(2)

  if (activeSetError) {
    throw new Error(`Failed to resolve active policy set: ${activeSetError.message}`)
  }

  if ((activeSets ?? []).length > 1) {
    throw new Error(
      'POLICY_INTEGRITY_ERROR: multiple policy_sets rows are marked is_active=true. Keep exactly one active set.'
    )
  }

  const activeSet = (activeSets ?? [])[0] ?? null

  if (activeSet) {
    setCache('active_policy_set', activeSet as PolicySet)
    return activeSet as PolicySet
  }

  // Fallback: latest published where effective_at <= now
  const { data: fallbackSets, error: fallbackError } = await supabase
    .from('policy_sets')
    .select('*')
    .eq('status', 'published')
    .or('effective_at.is.null,effective_at.lte.' + new Date().toISOString())
    .order('effective_at', { ascending: false, nullsFirst: false })
    .order('published_at', { ascending: false })
    .limit(1)

  if (fallbackError) {
    throw new Error(`Failed to resolve published fallback policy set: ${fallbackError.message}`)
  }

  const fallbackSet = (fallbackSets ?? [])[0] ?? null

  if (fallbackSet) {
    setCache('active_policy_set', fallbackSet as PolicySet)
    return fallbackSet as PolicySet
  }

  return null
}

/** Get the latest published policy set (alias for dashboard display). */
export async function getPublishedPolicySet(): Promise<PolicySet | null> {
  return getActivePolicySet()
}

// ---------------------------------------------------------------------------
// Single policy value read
// ---------------------------------------------------------------------------

/**
 * Get the current effective value for a single policy key.
 * Returns the unwrapped value (not the full PolicyValue row).
 */
export async function getEffectivePolicy<T = unknown>(key: string): Promise<T> {
  const cacheKey = `policy_value:${key}`
  const cached = getCached<T>(cacheKey)
  if (cached !== null) return cached

  const policySet = await getActivePolicySet()
  if (!policySet) {
    throw new Error(`No active policy set found when reading key "${key}"`)
  }

  const supabase = getPolicyClient();
  const { data: rows, error } = await supabase
    .from('policy_values')
    .select('value_json')
    .eq('policy_set_id', policySet.id)
    .eq('key', key)
    .limit(2)

  if (error) {
    throw new Error(`Failed to read policy key "${key}": ${error.message}`)
  }

  if (!rows || rows.length === 0) {
    throw new Error(`Policy key "${key}" not found in active set "${policySet.name}"`)
  }

  if (rows.length > 1) {
    throw new Error(
      `POLICY_INTEGRITY_ERROR: multiple values found for key "${key}" in active set "${policySet.name}".`
    )
  }

  const data = rows[0]
  const value = data.value_json as T
  setCache(cacheKey, value)
  return value
}

// ---------------------------------------------------------------------------
// Batched multi-key read
// ---------------------------------------------------------------------------

/** Get multiple policy keys at once (single round trip). */
export async function getEffectivePolicies(keys: string[]): Promise<Record<string, unknown>> {
  const supabase = getPolicyClient();
  const policySet = await getActivePolicySet()
  if (!policySet) {
    throw new Error('No active policy set found')
  }

  // Check cache for all keys first
  const result: Record<string, unknown> = {}
  const uncachedKeys: string[] = []

  for (const key of keys) {
    const cached = getCached<unknown>(`policy_value:${key}`)
    if (cached !== null) {
      result[key] = cached
    } else {
      uncachedKeys.push(key)
    }
  }

  if (uncachedKeys.length === 0) return result

  const { data, error } = await supabase
    .from('policy_values')
    .select('key, value_json')
    .eq('policy_set_id', policySet.id)
    .in('key', uncachedKeys)

  if (error) {
    throw new Error(`Failed to fetch policy keys: ${error.message}`)
  }

  for (const row of data ?? []) {
    result[row.key] = row.value_json
    setCache(`policy_value:${row.key}`, row.value_json)
  }

  return result
}

// ---------------------------------------------------------------------------
// Category read (for dashboard tabs)
// ---------------------------------------------------------------------------

/** Get all policy values for a category in the active set. */
export async function getPolicyCategory(category: string): Promise<PolicyValue[]> {
  const cacheKey = `policy_category:${category}`
  const cached = getCached<PolicyValue[]>(cacheKey)
  if (cached) return cached

  const policySet = await getActivePolicySet()
  if (!policySet) return []

  const supabase = getPolicyClient();
  const { data } = await supabase
    .from('policy_values')
    .select('*')
    .eq('policy_set_id', policySet.id)
    .eq('category', category)
    .order('display_order', { ascending: true })

  const values = (data ?? []) as PolicyValue[]
  setCache(cacheKey, values)
  return values
}

// ---------------------------------------------------------------------------
// Typed config wrappers
// ---------------------------------------------------------------------------

export async function getRenewalConfig(): Promise<RenewalConfig> {
  const policies = await getEffectivePolicies([
    'renewal.reminder_days',
    'renewal.dispatch_time',
    'renewal.dispatch_timezone',
    'renewal.grace_days',
    'renewal.reactivation_days',
    'renewal.refund_window_days',
    'renewal.access_lock_mode',
  ])

  return {
    reminder_days: policies['renewal.reminder_days'] as number[],
    dispatch_time: policies['renewal.dispatch_time'] as string,
    dispatch_timezone: policies['renewal.dispatch_timezone'] as string,
    grace_days: policies['renewal.grace_days'] as number,
    reactivation_days: policies['renewal.reactivation_days'] as number,
    refund_window_days: policies['renewal.refund_window_days'] as number,
    access_lock_mode: policies['renewal.access_lock_mode'] as string,
  }
}

export async function getBillingConfig(): Promise<BillingConfig> {
  const policies = await getEffectivePolicies([
    'billing.proration_rules',
    'billing.membership_tiers',
    'billing.partnership_rate',
    'billing.downgrade_policy',
    'billing.currency',
    'billing.pricing_mode',
    'billing.formula_config',
    'billing.metric_key',
    'billing.metric_allowlist',
    'billing.fallback_price',
    'billing.fallback_behavior',
    'billing.rounding_rule',
    'billing.manual_override_allowed',
    'billing.override_persistence',
  ])

  return {
    proration_rules: policies['billing.proration_rules'] as BillingConfig['proration_rules'],
    membership_tiers: policies['billing.membership_tiers'] as BillingConfig['membership_tiers'],
    partnership_rate: policies['billing.partnership_rate'] as number,
    downgrade_policy: policies['billing.downgrade_policy'] as string,
    currency: policies['billing.currency'] as string,
    pricing_mode: policies['billing.pricing_mode'] as string,
    formula_config:
      (policies['billing.formula_config'] as BillingConfig['formula_config']) ?? null,
    metric_key: (policies['billing.metric_key'] as string | undefined) ?? null,
    metric_allowlist:
      (policies['billing.metric_allowlist'] as string[] | undefined) ?? [],
    fallback_price: (policies['billing.fallback_price'] as number | undefined) ?? 0,
    fallback_behavior:
      (policies['billing.fallback_behavior'] as BillingConfig['fallback_behavior'] | undefined) ??
      'use_fallback_price',
    rounding_rule:
      (policies['billing.rounding_rule'] as BillingConfig['rounding_rule'] | undefined) ??
      'nearest_dollar',
    manual_override_allowed:
      (policies['billing.manual_override_allowed'] as boolean | undefined) ?? true,
    override_persistence:
      (policies['billing.override_persistence'] as BillingConfig['override_persistence'] | undefined) ??
      'cycle_only',
  }
}

export async function getSchedulingConfig(): Promise<SchedulingConfig> {
  const policies = await getEffectivePolicies([
    'conference.swap_cap',
    'conference.swap_count_mode',
    'conference.swap_admin_override',
    'conference.tiebreak_mode',
    'conference.delegate_coverage_pct',
    'conference.meeting_group_min',
    'conference.meeting_group_max',
    'conference.feasibility_relaxation',
    'conference.org_coverage_pct',
  ])

  return {
    swap_cap: policies['conference.swap_cap'] as number,
    swap_count_mode:
      (policies['conference.swap_count_mode'] as 'requested' | 'committed' | undefined) ??
      'requested',
    swap_admin_override: policies['conference.swap_admin_override'] as boolean,
    tiebreak_mode: policies['conference.tiebreak_mode'] as string,
    delegate_coverage_pct: policies['conference.delegate_coverage_pct'] as number,
    meeting_group_min: policies['conference.meeting_group_min'] as number,
    meeting_group_max: policies['conference.meeting_group_max'] as number,
    feasibility_relaxation: policies['conference.feasibility_relaxation'] as boolean,
    org_coverage_pct: policies['conference.org_coverage_pct'] as number,
  }
}

export async function getVisibilityConfig(): Promise<VisibilityConfig> {
  const policies = await getEffectivePolicies([
    'visibility.public_allowlist',
    'visibility.private_fields',
    'visibility.masked_reveal_fields',
    'visibility.masking_rules',
  ])

  return {
    public_allowlist: policies['visibility.public_allowlist'] as string[],
    private_fields: policies['visibility.private_fields'] as string[],
    masked_reveal_fields: policies['visibility.masked_reveal_fields'] as string[],
    masking_rules: policies['visibility.masking_rules'] as Record<string, MaskingRule>,
  }
}

export async function getIntegrationConfig(): Promise<IntegrationConfig> {
  const policies = await getEffectivePolicies([
    'integration.source_of_truth',
    'integration.conflict_rule',
    'integration.circle_dm_mode',
    'integration.circle_cutover_enabled',
    'integration.circle_canary_org_ids',
    'integration.circle_legacy_fallback_enabled',
    'integration.conference_ops_masthead_org_ids',
  ])

  return {
    source_of_truth: policies['integration.source_of_truth'] as string,
    conflict_rule: policies['integration.conflict_rule'] as string,
    circle_dm_mode: policies['integration.circle_dm_mode'] as string,
    circle_cutover_enabled: policies['integration.circle_cutover_enabled'] as boolean,
    circle_canary_org_ids: policies['integration.circle_canary_org_ids'] as string[],
    circle_legacy_fallback_enabled: policies['integration.circle_legacy_fallback_enabled'] as boolean,
    conference_ops_masthead_org_ids:
      (policies['integration.conference_ops_masthead_org_ids'] as string[] | undefined) ??
      [],
  }
}

export async function getRetentionConsentConfig(): Promise<RetentionConsentConfig> {
  const policies = await getEffectivePolicies([
    'retention.travel_delete_rule',
    'consent.travel_data_required',
    'consent.dietary_accessibility_required',
  ])

  return {
    travel_delete_rule:
      (policies['retention.travel_delete_rule'] as string | undefined) ??
      'march_1_conference_year_utc',
    travel_data_required:
      (policies['consent.travel_data_required'] as boolean | undefined) ?? true,
    dietary_accessibility_required:
      (policies['consent.dietary_accessibility_required'] as boolean | undefined) ??
      false,
  }
}
