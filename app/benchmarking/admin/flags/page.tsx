import { createClient } from "@/lib/supabase/server";
import DeltaFlagsTable from "@/components/benchmarking/admin/DeltaFlagsTable";

export default async function FlagsPage() {
  const supabase = await createClient();

  // Get latest survey fiscal year
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: latestSurvey } = (await (supabase as any)
    .from("benchmarking_surveys")
    .select("fiscal_year, title")
    .order("fiscal_year", { ascending: false })
    .limit(1)
    .single()) as { data: any };

  if (!latestSurvey) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Flag Review</h1>
        <p className="text-gray-500">No surveys exist yet.</p>
      </div>
    );
  }

  // Get all delta flags for this fiscal year with org info
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: flags } = (await (supabase as any)
    .from("delta_flags")
    .select(
      `
      *,
      benchmarking!inner(
        id,
        fiscal_year,
        organization_id,
        organization:organizations(id, name)
      )
    `
    )
    .eq("benchmarking.fiscal_year", latestSurvey.fiscal_year)
    .order("created_at", { ascending: false })) as { data: any[] | null };

  const tableData = (flags ?? []).map((f) => {
    const benchmarking = f.benchmarking as unknown as {
      id: string;
      organization: { id: string; name: string };
    };
    return {
      id: f.id,
      benchmarkingId: benchmarking.id,
      organizationName: benchmarking.organization?.name ?? "Unknown",
      fieldName: f.field_name,
      previousValue: f.previous_value,
      currentValue: f.current_value,
      pctChange: f.pct_change,
      absChange: f.abs_change,
      respondentAction: f.respondent_action,
      respondentExplanation: f.respondent_explanation,
      committeeStatus: f.committee_status ?? "pending",
      committeeNotes: f.committee_notes,
      reviewedAt: f.reviewed_at,
    };
  });

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Flag Review</h1>
      <p className="text-sm text-gray-500 mb-6">
        FY{latestSurvey.fiscal_year} &mdash; {latestSurvey.title}
      </p>
      <DeltaFlagsTable flags={tableData} fiscalYear={latestSurvey.fiscal_year} />
    </div>
  );
}
