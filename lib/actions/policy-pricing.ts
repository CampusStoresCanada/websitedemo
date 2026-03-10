"use server";

import { requireAdmin, requireSuperAdmin } from "@/lib/auth/guards";
import {
  applyManualMembershipAssessmentOverride,
  previewPricingChangeAll,
  previewPricingChange,
} from "@/lib/membership/pricing";
import { createAdminClient } from "@/lib/supabase/admin";

type PricingStatus = "computed" | "fallback_used" | "manual_required" | "manual_override";

interface PricingModelSummary {
  policySetId: string;
  pricingMode: string;
  metricKey: string;
  fallbackBehavior: string;
  roundingRule: string;
  manualOverrideAllowed: boolean;
  overridePersistence: string;
  partnershipRate: number;
}

async function loadPricingModelSummary(
  policySetId: string
): Promise<PricingModelSummary> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("policy_values")
    .select("key, value_json")
    .eq("policy_set_id", policySetId)
    .in("key", [
      "billing.pricing_mode",
      "billing.metric_key",
      "billing.fallback_behavior",
      "billing.rounding_rule",
      "billing.manual_override_allowed",
      "billing.override_persistence",
      "billing.partnership_rate",
    ]);

  if (error) {
    throw new Error(`Failed to load pricing model summary: ${error.message}`);
  }

  const map = new Map((data ?? []).map((row) => [row.key, row.value_json]));

  return {
    policySetId,
    pricingMode: String(map.get("billing.pricing_mode") ?? "FTE_BUCKETS"),
    metricKey: String(map.get("billing.metric_key") ?? "organizations.fte"),
    fallbackBehavior: String(map.get("billing.fallback_behavior") ?? "use_fallback_price"),
    roundingRule: String(map.get("billing.rounding_rule") ?? "nearest_dollar"),
    manualOverrideAllowed: Boolean(map.get("billing.manual_override_allowed") ?? true),
    overridePersistence: String(map.get("billing.override_persistence") ?? "cycle_only"),
    partnershipRate:
      typeof map.get("billing.partnership_rate") === "number"
        ? (map.get("billing.partnership_rate") as number)
        : Number(map.get("billing.partnership_rate") ?? 0),
  };
}

async function loadPartnershipImpact(
  currentRate: number,
  draftRate: number
): Promise<{
  partnerCount: number;
  currentTotalCents: number;
  draftTotalCents: number;
  diffCents: number;
}> {
  const db = createAdminClient();
  const { count, error } = await db
    .from("organizations")
    .select("id", { head: true, count: "exact" })
    .ilike("type", "%vendor%");

  if (error) {
    throw new Error(`Failed to load vendor partner count: ${error.message}`);
  }

  const partnerCount = count ?? 0;
  const currentTotalCents = Math.round(currentRate * 100) * partnerCount;
  const draftTotalCents = Math.round(draftRate * 100) * partnerCount;
  return {
    partnerCount,
    currentTotalCents,
    draftTotalCents,
    diffCents: draftTotalCents - currentTotalCents,
  };
}

export async function getPricingPreviewAction(
  draftPolicySetId: string,
  sampleSize = 10,
  mode: "sample" | "all" = "sample"
): Promise<
  | {
      success: true;
      rows: Array<{
        organizationId: string;
        organizationName: string;
        currentAmountCents: number;
        draftAmountCents: number;
        diffCents: number;
        currentStatus: PricingStatus;
        draftStatus: PricingStatus;
      }>;
      totals: {
        currentAmountCents: number;
        draftAmountCents: number;
        diffCents: number;
      };
      impact: {
        increased: number;
        decreased: number;
        unchanged: number;
        draftStatusCounts: Record<PricingStatus, number>;
      };
      models: {
        current: PricingModelSummary;
        draft: PricingModelSummary;
      };
      partnershipImpact: {
        partnerCount: number;
        currentTotalCents: number;
        draftTotalCents: number;
        diffCents: number;
      };
      scope: "sample" | "all";
      orgCount: number;
    }
  | { success: false; error: string }
> {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  try {
    const db = createAdminClient();
    const { data: active, error: activeError } = await db
      .from("policy_sets")
      .select("id")
      .eq("is_active", true)
      .maybeSingle();

    if (activeError) {
      return { success: false, error: `Failed to load active policy set: ${activeError.message}` };
    }
    if (!active) {
      return { success: false, error: "No active policy set found." };
    }

    const rows =
      mode === "all"
        ? await previewPricingChangeAll(draftPolicySetId)
        : await previewPricingChange(draftPolicySetId, sampleSize);
    const totals = rows.reduce(
      (acc, row) => {
        acc.currentAmountCents += row.currentAmountCents;
        acc.draftAmountCents += row.draftAmountCents;
        acc.diffCents += row.diffCents;
        return acc;
      },
      { currentAmountCents: 0, draftAmountCents: 0, diffCents: 0 }
    );

    const impact = rows.reduce(
      (acc, row) => {
        if (row.diffCents > 0) acc.increased += 1;
        else if (row.diffCents < 0) acc.decreased += 1;
        else acc.unchanged += 1;

        acc.draftStatusCounts[row.draftStatus] += 1;
        return acc;
      },
      {
        increased: 0,
        decreased: 0,
        unchanged: 0,
        draftStatusCounts: {
          computed: 0,
          fallback_used: 0,
          manual_required: 0,
          manual_override: 0,
        } as Record<PricingStatus, number>,
      }
    );

    const [currentModel, draftModel] = await Promise.all([
      loadPricingModelSummary(active.id),
      loadPricingModelSummary(draftPolicySetId),
    ]);
    const partnershipImpact = await loadPartnershipImpact(
      currentModel.partnershipRate,
      draftModel.partnershipRate
    );

    return {
      success: true,
      rows,
      totals,
      impact,
      models: {
        current: currentModel,
        draft: draftModel,
      },
      partnershipImpact,
      scope: mode,
      orgCount: rows.length,
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to compute pricing preview",
    };
  }
}

export async function listMemberOrganizationsAction(
  limit = 200
): Promise<
  | { success: true; organizations: Array<{ id: string; name: string }> }
  | { success: false; error: string }
> {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  try {
    const db = createAdminClient();
    const { data, error } = await db
      .from("organizations")
      .select("id, name")
      .not("membership_status", "is", null)
      .not("type", "ilike", "%vendor%")
      .order("name", { ascending: true })
      .limit(limit);

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: true,
      organizations: (data ?? []).map((row) => ({ id: row.id, name: row.name })),
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to load organizations",
    };
  }
}

export async function applyPricingOverrideAction(params: {
  organizationId: string;
  policySetId?: string;
  billingCycleYear: number;
  amountDollars: number;
  reason: string;
}): Promise<{ success: true; assessmentId: string } | { success: false; error: string }> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  if (!params.reason || params.reason.trim().length === 0) {
    return { success: false, error: "Override reason is required." };
  }

  if (!Number.isFinite(params.amountDollars) || params.amountDollars < 0) {
    return { success: false, error: "Amount must be a non-negative number." };
  }

  try {
    const active = params.policySetId
      ? { id: params.policySetId }
      : await createAdminClient()
          .from("policy_sets")
          .select("id")
          .eq("is_active", true)
          .maybeSingle()
          .then((r) => (r.error ? null : r.data));

    if (!active) {
      return { success: false, error: "No active policy set found." };
    }

    const assessment = await applyManualMembershipAssessmentOverride({
      organizationId: params.organizationId,
      policySetId: active.id,
      billingCycleYear: params.billingCycleYear,
      amountCents: Math.round(params.amountDollars * 100),
      reason: params.reason,
      overrideByUserId: auth.ctx.userId,
    });

    return { success: true, assessmentId: assessment.id };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to apply override",
    };
  }
}
