import { createAdminClient } from "../supabase/admin";
import type { BillingConfig } from "../policy/types";
import type { Json } from "../database.types";
import {
  applyRoundingRule,
  evaluateBucketPrice,
  evaluateLinearFormulaPrice,
  toCents,
} from "./pricing-core";

export type { PricingMode } from "./pricing-core";
import type { PricingMode } from "./pricing-core";

export type AssessmentStatus =
  | "computed"
  | "fallback_used"
  | "manual_required"
  | "manual_override";

export type FallbackReasonCode =
  | "metric_missing"
  | "metric_non_numeric"
  | "metric_key_not_allowed"
  | "metric_key_invalid";

export interface MembershipAssessment {
  id: string;
  organizationId: string;
  policySetId: string;
  billingCycleYear: number;
  pricingMode: PricingMode;
  metricKey: string;
  metricValue: number | null;
  computedAmountCents: number;
  assessmentStatus: AssessmentStatus;
  fallbackReasonCode: FallbackReasonCode | null;
  explanation: string;
  inputSnapshot: Record<string, unknown>;
  isManualOverride: boolean;
}

export interface ComputeMembershipAssessmentOptions {
  policySetId?: string;
  billingCycleYear?: number;
  billingPeriodStart?: string;
  persist?: boolean;
}

interface PricingTier {
  max_fte?: number | null;
  max_value?: number | null;
  price: number;
}

interface PricingEvaluation {
  pricingMode: PricingMode;
  metricKey: string;
  metricValue: number | null;
  computedAmountCents: number;
  assessmentStatus: AssessmentStatus;
  fallbackReasonCode: FallbackReasonCode | null;
  explanation: string;
  inputSnapshot: Record<string, unknown>;
}

interface ManualOverrideResult {
  computedAmountCents: number;
  explanation: string;
  inputSnapshot: Record<string, unknown>;
  applied: boolean;
}

const BILLING_POLICY_KEYS = [
  "billing.pricing_mode",
  "billing.membership_tiers",
  "billing.formula_config",
  "billing.metric_key",
  "billing.metric_allowlist",
  "billing.fallback_price",
  "billing.fallback_behavior",
  "billing.rounding_rule",
  "billing.manual_override_allowed",
  "billing.override_persistence",
] as const;

function resolveBillingCycleYear(options?: ComputeMembershipAssessmentOptions): number {
  if (typeof options?.billingCycleYear === "number") {
    return options.billingCycleYear;
  }
  if (options?.billingPeriodStart) {
    return new Date(`${options.billingPeriodStart}T00:00:00Z`).getUTCFullYear();
  }
  return new Date().getUTCFullYear();
}

function safeNumeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function jsonSnapshot(payload: Record<string, unknown>): Json {
  return JSON.parse(JSON.stringify(payload)) as Json;
}

async function resolvePolicySetId(explicitPolicySetId?: string): Promise<string> {
  if (explicitPolicySetId) {
    return explicitPolicySetId;
  }
  const db = createAdminClient();
  const { data: active, error } = await db
    .from("policy_sets")
    .select("id")
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve active policy set: ${error.message}`);
  }
  if (!active) {
    throw new Error("No active policy set found for pricing computation");
  }

  return active.id;
}

async function loadBillingPolicyValues(policySetId: string): Promise<Record<string, unknown>> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("policy_values")
    .select("key, value_json")
    .eq("policy_set_id", policySetId)
    .in("key", [...BILLING_POLICY_KEYS]);

  if (error) {
    throw new Error(`Failed to load billing policy values: ${error.message}`);
  }

  const map: Record<string, unknown> = {};
  for (const row of data ?? []) {
    map[row.key] = row.value_json;
  }
  return map;
}

function parseBillingPricingConfig(policies: Record<string, unknown>) {
  const pricingMode = String(policies["billing.pricing_mode"] ?? "FTE_BUCKETS") as PricingMode;
  const membershipTiers = Array.isArray(policies["billing.membership_tiers"])
    ? (policies["billing.membership_tiers"] as PricingTier[])
    : [];
  const formulaConfig =
    policies["billing.formula_config"] && typeof policies["billing.formula_config"] === "object"
      ? (policies["billing.formula_config"] as NonNullable<BillingConfig["formula_config"]>)
      : null;

  const metricKey = String(policies["billing.metric_key"] ?? "organizations.fte");
  const metricAllowlist = Array.isArray(policies["billing.metric_allowlist"])
    ? (policies["billing.metric_allowlist"] as string[])
    : ["organizations.fte", "benchmarking.enrollment_fte"];

  const fallbackPrice = safeNumeric(policies["billing.fallback_price"]) ?? 0;
  const fallbackBehavior =
    (String(policies["billing.fallback_behavior"] ?? "use_fallback_price") as
      | "use_fallback_price"
      | "require_manual"
      | "use_highest_tier");
  const roundingRule =
    (String(policies["billing.rounding_rule"] ?? "nearest_dollar") as
      | "nearest_dollar"
      | "floor"
      | "ceil");

  const manualOverrideAllowed = Boolean(policies["billing.manual_override_allowed"] ?? true);
  const overridePersistence =
    (String(policies["billing.override_persistence"] ?? "cycle_only") as
      | "cycle_only"
      | "until_cleared");

  return {
    pricingMode,
    membershipTiers,
    formulaConfig,
    metricKey,
    metricAllowlist,
    fallbackPrice,
    fallbackBehavior,
    roundingRule,
    manualOverrideAllowed,
    overridePersistence,
  };
}

function extractMetric(
  metricKey: string,
  organizationRow: Record<string, unknown>,
  benchmarkingRow: Record<string, unknown> | null
): { value: number | null; reason: FallbackReasonCode | null } {
  const [source, field] = metricKey.split(".");
  if (!source || !field) {
    return { value: null, reason: "metric_key_invalid" };
  }

  if (source === "organizations") {
    const numeric = safeNumeric(organizationRow[field]);
    if (numeric === null) {
      return {
        value: null,
        reason:
          organizationRow[field] === null || organizationRow[field] === undefined
            ? "metric_missing"
            : "metric_non_numeric",
      };
    }
    return { value: numeric, reason: null };
  }

  if (source === "benchmarking") {
    if (!benchmarkingRow) {
      return { value: null, reason: "metric_missing" };
    }
    const numeric = safeNumeric(benchmarkingRow[field]);
    if (numeric === null) {
      return {
        value: null,
        reason:
          benchmarkingRow[field] === null || benchmarkingRow[field] === undefined
            ? "metric_missing"
            : "metric_non_numeric",
      };
    }
    return { value: numeric, reason: null };
  }

  return { value: null, reason: "metric_key_invalid" };
}

function fallbackFromPolicy(
  reason: FallbackReasonCode,
  config: ReturnType<typeof parseBillingPricingConfig>,
  metricKey: string,
  metricValue: number | null
): PricingEvaluation {
  if (config.fallbackBehavior === "require_manual") {
    return {
      pricingMode: config.pricingMode,
      metricKey,
      metricValue,
      computedAmountCents: 0,
      assessmentStatus: "manual_required",
      fallbackReasonCode: reason,
      explanation: `Pricing requires manual override (${reason}).`,
      inputSnapshot: {
        metric_key: metricKey,
        metric_value: metricValue,
        fallback_behavior: config.fallbackBehavior,
        reason,
      },
    };
  }

  if (config.fallbackBehavior === "use_highest_tier") {
    const tiers = [...config.membershipTiers];
    const maxTier = tiers
      .map((tier) => safeNumeric(tier.price) ?? 0)
      .reduce((max, current) => Math.max(max, current), 0);
    const amountCents = applyRoundingRule(toCents(maxTier), config.roundingRule);
    return {
      pricingMode: config.pricingMode,
      metricKey,
      metricValue,
      computedAmountCents: amountCents,
      assessmentStatus: "fallback_used",
      fallbackReasonCode: reason,
      explanation: `Fallback used highest tier (${reason}).`,
      inputSnapshot: {
        metric_key: metricKey,
        metric_value: metricValue,
        fallback_behavior: config.fallbackBehavior,
        highest_tier_amount_cents: amountCents,
        reason,
      },
    };
  }

  const amountCents = applyRoundingRule(toCents(config.fallbackPrice), config.roundingRule);
  return {
    pricingMode: config.pricingMode,
    metricKey,
    metricValue,
    computedAmountCents: amountCents,
    assessmentStatus: "fallback_used",
    fallbackReasonCode: reason,
    explanation: `Fallback price used (${reason}).`,
    inputSnapshot: {
      metric_key: metricKey,
      metric_value: metricValue,
      fallback_behavior: config.fallbackBehavior,
      fallback_price: config.fallbackPrice,
      reason,
    },
  };
}

function evaluatePricing(
  config: ReturnType<typeof parseBillingPricingConfig>,
  metricValue: number,
  metricKey: string
): PricingEvaluation {
  if (config.pricingMode === "LINEAR_FORMULA") {
    if (!config.formulaConfig) {
      return fallbackFromPolicy("metric_key_invalid", config, metricKey, metricValue);
    }
    const amountCents = evaluateLinearFormulaPrice(
      metricValue,
      config.formulaConfig,
      config.roundingRule
    );
    return {
      pricingMode: config.pricingMode,
      metricKey,
      metricValue,
      computedAmountCents: amountCents,
      assessmentStatus: "computed",
      fallbackReasonCode: null,
      explanation: `Linear formula computed for ${metricKey}=${metricValue}.`,
      inputSnapshot: {
        mode: config.pricingMode,
        metric_key: metricKey,
        metric_value: metricValue,
        formula: config.formulaConfig,
        rounding_rule: config.roundingRule,
      },
    };
  }

  const tierEval = evaluateBucketPrice(metricValue, config.membershipTiers, config.pricingMode);
  return {
    pricingMode: config.pricingMode,
    metricKey,
    metricValue,
    computedAmountCents: applyRoundingRule(tierEval.amountCents, config.roundingRule),
    assessmentStatus: "computed",
    fallbackReasonCode: null,
    explanation: `${metricKey}=${metricValue} matched ${tierEval.tierLabel}.`,
    inputSnapshot: {
      mode: config.pricingMode,
      metric_key: metricKey,
      metric_value: metricValue,
      tier: tierEval.tierLabel,
    },
  };
}

async function maybeUseManualOverride(
  params: {
    organizationId: string;
    policySetId: string;
    billingCycleYear: number;
    config: ReturnType<typeof parseBillingPricingConfig>;
  }
): Promise<ManualOverrideResult> {
  if (!params.config.manualOverrideAllowed) {
    return {
      computedAmountCents: 0,
      explanation: "",
      inputSnapshot: {},
      applied: false,
    };
  }

  const db = createAdminClient();
  const { data } = await db
    .from("membership_assessments")
    .select(
      "computed_amount_cents, explanation, input_snapshot, is_manual_override, billing_cycle_year"
    )
    .eq("organization_id", params.organizationId)
    .eq("policy_set_id", params.policySetId)
    .eq("billing_cycle_year", params.billingCycleYear)
    .eq("is_manual_override", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data?.is_manual_override) {
    return {
      computedAmountCents: 0,
      explanation: "",
      inputSnapshot: {},
      applied: false,
    };
  }

  if (
    params.config.overridePersistence === "cycle_only" &&
    data.billing_cycle_year !== params.billingCycleYear
  ) {
    return {
      computedAmountCents: 0,
      explanation: "",
      inputSnapshot: {},
      applied: false,
    };
  }

  return {
    computedAmountCents: data.computed_amount_cents,
    explanation: data.explanation,
    inputSnapshot: (data.input_snapshot as Record<string, unknown>) ?? {},
    applied: true,
  };
}

export async function computeMembershipAssessment(
  organizationId: string,
  options?: ComputeMembershipAssessmentOptions
): Promise<MembershipAssessment> {
  const db = createAdminClient();
  const persist = options?.persist !== false;
  const policySetId = await resolvePolicySetId(options?.policySetId);
  const billingCycleYear = resolveBillingCycleYear(options);

  const [policyValues, organizationRes, benchmarkingRes] = await Promise.all([
    loadBillingPolicyValues(policySetId),
    db.from("organizations").select("*").eq("id", organizationId).single(),
    db
      .from("benchmarking")
      .select("*")
      .eq("organization_id", organizationId)
      .order("fiscal_year", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (organizationRes.error || !organizationRes.data) {
    throw new Error(`Organization ${organizationId} not found`);
  }

  const config = parseBillingPricingConfig(policyValues);

  const overrideResult = await maybeUseManualOverride({
    organizationId,
    policySetId,
    billingCycleYear,
    config,
  });

  let evaluation: PricingEvaluation;

  if (overrideResult.applied) {
    evaluation = {
      pricingMode: config.pricingMode,
      metricKey: config.metricKey,
      metricValue: null,
      computedAmountCents: overrideResult.computedAmountCents,
      assessmentStatus: "manual_override",
      fallbackReasonCode: null,
      explanation: overrideResult.explanation,
      inputSnapshot: {
        ...(overrideResult.inputSnapshot ?? {}),
        source: "manual_override",
      },
    };
  } else {
    if (!config.metricAllowlist.includes(config.metricKey)) {
      evaluation = fallbackFromPolicy(
        "metric_key_not_allowed",
        config,
        config.metricKey,
        null
      );
    } else {
      const metricResult = extractMetric(
        config.metricKey,
        organizationRes.data as unknown as Record<string, unknown>,
        (benchmarkingRes.data as unknown as Record<string, unknown> | null) ?? null
      );

      if (metricResult.value === null || metricResult.reason) {
        evaluation = fallbackFromPolicy(
          metricResult.reason ?? "metric_missing",
          config,
          config.metricKey,
          metricResult.value
        );
      } else {
        evaluation = evaluatePricing(config, metricResult.value, config.metricKey);
      }
    }
  }

  const payload = {
    organization_id: organizationId,
    policy_set_id: policySetId,
    billing_cycle_year: billingCycleYear,
    pricing_mode: evaluation.pricingMode,
    metric_key: evaluation.metricKey,
    metric_value: evaluation.metricValue,
    computed_amount_cents: evaluation.computedAmountCents,
    assessment_status: evaluation.assessmentStatus,
    fallback_reason_code: evaluation.fallbackReasonCode,
    explanation: evaluation.explanation,
    input_snapshot: jsonSnapshot({
      ...evaluation.inputSnapshot,
      policy_set_id: policySetId,
      billing_cycle_year: billingCycleYear,
    }),
    is_manual_override: evaluation.assessmentStatus === "manual_override",
  };

  if (!persist) {
    return {
      id: "preview",
      organizationId,
      policySetId,
      billingCycleYear,
      pricingMode: evaluation.pricingMode,
      metricKey: evaluation.metricKey,
      metricValue: evaluation.metricValue,
      computedAmountCents: evaluation.computedAmountCents,
      assessmentStatus: evaluation.assessmentStatus,
      fallbackReasonCode: evaluation.fallbackReasonCode,
      explanation: evaluation.explanation,
      inputSnapshot: payload.input_snapshot as Record<string, unknown>,
      isManualOverride: payload.is_manual_override,
    };
  }

  const { data: upserted, error: upsertError } = await db
    .from("membership_assessments")
    .upsert(payload, {
      onConflict: "organization_id,policy_set_id,billing_cycle_year",
      ignoreDuplicates: false,
    })
    .select(
      "id, organization_id, policy_set_id, billing_cycle_year, pricing_mode, metric_key, metric_value, computed_amount_cents, assessment_status, fallback_reason_code, explanation, input_snapshot, is_manual_override"
    )
    .single();

  if (upsertError || !upserted) {
    throw new Error(`Failed to persist membership assessment: ${upsertError?.message}`);
  }

  return {
    id: upserted.id,
    organizationId: upserted.organization_id,
    policySetId: upserted.policy_set_id,
    billingCycleYear: upserted.billing_cycle_year,
    pricingMode: upserted.pricing_mode as PricingMode,
    metricKey: upserted.metric_key,
    metricValue: upserted.metric_value,
    computedAmountCents: upserted.computed_amount_cents,
    assessmentStatus: upserted.assessment_status as AssessmentStatus,
    fallbackReasonCode: upserted.fallback_reason_code as FallbackReasonCode | null,
    explanation: upserted.explanation,
    inputSnapshot: (upserted.input_snapshot as Record<string, unknown>) ?? {},
    isManualOverride: upserted.is_manual_override,
  };
}

export async function previewPricingChange(
  draftPolicySetId: string,
  sampleSize = 10
): Promise<
  Array<{
    organizationId: string;
    organizationName: string;
    currentAmountCents: number;
    draftAmountCents: number;
    diffCents: number;
    currentStatus: AssessmentStatus;
    draftStatus: AssessmentStatus;
  }>
> {
  const db = createAdminClient();

  const { data: activePolicySet, error: activeSetError } = await db
    .from("policy_sets")
    .select("id")
    .eq("is_active", true)
    .maybeSingle();
  if (activeSetError) {
    throw new Error(`Failed to load active policy set: ${activeSetError.message}`);
  }
  if (!activePolicySet) {
    throw new Error("No active policy set available for pricing preview");
  }

  const { data: orgs, error: orgError } = await db
    .from("organizations")
    .select("id, name")
    .not("membership_status", "is", null)
    .not("type", "ilike", "%vendor%")
    .order("name", { ascending: true })
    .limit(sampleSize);

  if (orgError) {
    throw new Error(`Failed to load sample orgs for pricing preview: ${orgError.message}`);
  }

  const previews: Array<{
    organizationId: string;
    organizationName: string;
    currentAmountCents: number;
    draftAmountCents: number;
    diffCents: number;
    currentStatus: AssessmentStatus;
    draftStatus: AssessmentStatus;
  }> = [];

  for (const org of orgs ?? []) {
    const [current, draft] = await Promise.all([
      computeMembershipAssessment(org.id, {
        policySetId: activePolicySet.id,
        persist: false,
      }),
      computeMembershipAssessment(org.id, {
        policySetId: draftPolicySetId,
        persist: false,
      }),
    ]);

    previews.push({
      organizationId: org.id,
      organizationName: org.name,
      currentAmountCents: current.computedAmountCents,
      draftAmountCents: draft.computedAmountCents,
      diffCents: draft.computedAmountCents - current.computedAmountCents,
      currentStatus: current.assessmentStatus,
      draftStatus: draft.assessmentStatus,
    });
  }

  return previews;
}

export async function previewPricingChangeAll(
  draftPolicySetId: string
): Promise<
  Array<{
    organizationId: string;
    organizationName: string;
    currentAmountCents: number;
    draftAmountCents: number;
    diffCents: number;
    currentStatus: AssessmentStatus;
    draftStatus: AssessmentStatus;
  }>
> {
  const db = createAdminClient();

  const { data: activePolicySet, error: activeSetError } = await db
    .from("policy_sets")
    .select("id")
    .eq("is_active", true)
    .maybeSingle();
  if (activeSetError) {
    throw new Error(`Failed to load active policy set: ${activeSetError.message}`);
  }
  if (!activePolicySet) {
    throw new Error("No active policy set available for pricing preview");
  }

  const { data: orgs, error: orgError } = await db
    .from("organizations")
    .select("id, name")
    .not("membership_status", "is", null)
    .not("type", "ilike", "%vendor%")
    .order("name", { ascending: true });

  if (orgError) {
    throw new Error(`Failed to load member orgs for pricing impact: ${orgError.message}`);
  }

  const previews: Array<{
    organizationId: string;
    organizationName: string;
    currentAmountCents: number;
    draftAmountCents: number;
    diffCents: number;
    currentStatus: AssessmentStatus;
    draftStatus: AssessmentStatus;
  }> = [];

  for (const org of orgs ?? []) {
    const [current, draft] = await Promise.all([
      computeMembershipAssessment(org.id, {
        policySetId: activePolicySet.id,
        persist: false,
      }),
      computeMembershipAssessment(org.id, {
        policySetId: draftPolicySetId,
        persist: false,
      }),
    ]);

    previews.push({
      organizationId: org.id,
      organizationName: org.name,
      currentAmountCents: current.computedAmountCents,
      draftAmountCents: draft.computedAmountCents,
      diffCents: draft.computedAmountCents - current.computedAmountCents,
      currentStatus: current.assessmentStatus,
      draftStatus: draft.assessmentStatus,
    });
  }

  return previews;
}

export async function applyManualMembershipAssessmentOverride(params: {
  organizationId: string;
  policySetId: string;
  billingCycleYear: number;
  amountCents: number;
  reason: string;
  overrideByUserId: string;
}): Promise<MembershipAssessment> {
  if (!params.reason || params.reason.trim().length === 0) {
    throw new Error("Manual override reason is required");
  }

  const db = createAdminClient();

  const payload = {
    organization_id: params.organizationId,
    policy_set_id: params.policySetId,
    billing_cycle_year: params.billingCycleYear,
    pricing_mode: "FTE_BUCKETS",
    metric_key: "manual_override",
    metric_value: null,
    computed_amount_cents: params.amountCents,
    assessment_status: "manual_override" as const,
    fallback_reason_code: null,
    explanation: `Manual override applied: $${(params.amountCents / 100).toFixed(2)} (${params.reason}).`,
    input_snapshot: jsonSnapshot({
      source: "manual_override",
      amount_cents: params.amountCents,
      reason: params.reason,
      override_by: params.overrideByUserId,
    }),
    is_manual_override: true,
    override_reason: params.reason,
    override_by: params.overrideByUserId,
  };

  const { data, error } = await db
    .from("membership_assessments")
    .upsert(payload, {
      onConflict: "organization_id,policy_set_id,billing_cycle_year",
      ignoreDuplicates: false,
    })
    .select(
      "id, organization_id, policy_set_id, billing_cycle_year, pricing_mode, metric_key, metric_value, computed_amount_cents, assessment_status, fallback_reason_code, explanation, input_snapshot, is_manual_override"
    )
    .single();

  if (error || !data) {
    throw new Error(`Failed to apply manual override: ${error?.message}`);
  }

  return {
    id: data.id,
    organizationId: data.organization_id,
    policySetId: data.policy_set_id,
    billingCycleYear: data.billing_cycle_year,
    pricingMode: data.pricing_mode as PricingMode,
    metricKey: data.metric_key,
    metricValue: data.metric_value,
    computedAmountCents: data.computed_amount_cents,
    assessmentStatus: data.assessment_status as AssessmentStatus,
    fallbackReasonCode: data.fallback_reason_code as FallbackReasonCode | null,
    explanation: data.explanation,
    inputSnapshot: (data.input_snapshot as Record<string, unknown>) ?? {},
    isManualOverride: data.is_manual_override,
  };
}
