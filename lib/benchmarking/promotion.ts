import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/database.types";

export interface PromotionResult {
  success: boolean;
  error?: string;
  data?: {
    benchmarkingId: string;
    organizationId: string;
    promotedFields: string[];
  };
}

function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

export async function promoteBenchmarkingToOrganizationCurrentState(params: {
  benchmarkingId: string;
  promotedByUserId: string;
  note?: string;
}): Promise<PromotionResult> {
  const db = createAdminClient();

  const { data: benchmarkRow, error: benchmarkError } = await db
    .from("benchmarking")
    .select(
      "id, organization_id, status, verified_by, verified_at, fiscal_year, enrollment_fte, total_square_footage, institution_type"
    )
    .eq("id", params.benchmarkingId)
    .maybeSingle();

  if (benchmarkError) {
    return { success: false, error: `Failed to load benchmarking row: ${benchmarkError.message}` };
  }
  if (!benchmarkRow) {
    return { success: false, error: "Benchmarking row not found" };
  }

  if (!benchmarkRow.verified_by || !benchmarkRow.verified_at) {
    return { success: false, error: "Benchmarking row must be verified before promotion" };
  }

  const { data: orgRow, error: orgError } = await db
    .from("organizations")
    .select("id, fte, square_footage, organization_type")
    .eq("id", benchmarkRow.organization_id)
    .maybeSingle();

  if (orgError) {
    return { success: false, error: `Failed to load organization row: ${orgError.message}` };
  }
  if (!orgRow) {
    return { success: false, error: "Target organization not found" };
  }

  const beforeSnapshot = {
    fte: orgRow.fte,
    square_footage: orgRow.square_footage,
    organization_type: orgRow.organization_type,
  };

  const updatePayload: {
    fte?: number | null;
    square_footage?: number | null;
    organization_type?: string | null;
    updated_at?: string;
  } = {};
  const promotedFields: string[] = [];

  if (typeof benchmarkRow.enrollment_fte === "number") {
    updatePayload.fte = benchmarkRow.enrollment_fte;
    promotedFields.push("fte");
  }

  if (typeof benchmarkRow.total_square_footage === "number") {
    updatePayload.square_footage = benchmarkRow.total_square_footage;
    promotedFields.push("square_footage");
  }

  if (
    typeof benchmarkRow.institution_type === "string" &&
    benchmarkRow.institution_type.trim().length > 0
  ) {
    updatePayload.organization_type = benchmarkRow.institution_type;
    promotedFields.push("organization_type");
  }

  let afterSnapshot = beforeSnapshot;

  if (promotedFields.length > 0) {
    updatePayload.updated_at = new Date().toISOString();

    const { data: updatedOrg, error: updateError } = await db
      .from("organizations")
      .update(updatePayload)
      .eq("id", orgRow.id)
      .select("fte, square_footage, organization_type")
      .single();

    if (updateError || !updatedOrg) {
      return {
        success: false,
        error: `Failed to update organization current-state fields: ${updateError?.message}`,
      };
    }

    afterSnapshot = {
      fte: updatedOrg.fte,
      square_footage: updatedOrg.square_footage,
      organization_type: updatedOrg.organization_type,
    };
  }

  const promotionPayload = {
    benchmarking_id: benchmarkRow.id,
    organization_id: benchmarkRow.organization_id,
    promoted_fields: promotedFields,
    source_snapshot: asJson({
      fiscal_year: benchmarkRow.fiscal_year,
      enrollment_fte: benchmarkRow.enrollment_fte,
      total_square_footage: benchmarkRow.total_square_footage,
      institution_type: benchmarkRow.institution_type,
      verified_by: benchmarkRow.verified_by,
      verified_at: benchmarkRow.verified_at,
    }),
    target_before_snapshot: asJson(beforeSnapshot),
    target_after_snapshot: asJson(afterSnapshot),
    promoted_by: params.promotedByUserId,
    promoted_at: new Date().toISOString(),
    note: params.note ?? null,
  };

  // `benchmarking_promotions` is added via migration and may not be present in generated DB types yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: promotionError } = await (db.from as any)("benchmarking_promotions")
    .upsert(promotionPayload, {
      onConflict: "benchmarking_id,organization_id",
      ignoreDuplicates: false,
    });

  if (promotionError) {
    return {
      success: false,
      error: `Failed to write benchmarking promotion audit row: ${promotionError.message}`,
    };
  }

  return {
    success: true,
    data: {
      benchmarkingId: benchmarkRow.id,
      organizationId: benchmarkRow.organization_id,
      promotedFields,
    },
  };
}
