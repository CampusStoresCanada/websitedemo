import { createClient } from "@/lib/supabase/server";
import SubmissionsTable from "@/components/benchmarking/admin/SubmissionsTable";

export default async function SubmissionsPage() {
  const supabase = await createClient();

  // Get latest survey
  const { data: latestSurvey } = await supabase
    .from("benchmarking_surveys")
    .select("*")
    .order("fiscal_year", { ascending: false })
    .limit(1)
    .single();

  if (!latestSurvey) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Submissions</h1>
        <p className="text-gray-500">No surveys exist yet.</p>
      </div>
    );
  }

  // Get all benchmarking rows for this fiscal year with org info
  const { data: submissions } = await supabase
    .from("benchmarking")
    .select(
      `
      id,
      status,
      submitted_at,
      updated_at,
      verified_by,
      verified_at,
      organization_id,
      organization:organizations(id, name, slug)
    `
    )
    .eq("fiscal_year", latestSurvey.fiscal_year)
    .order("updated_at", { ascending: false });

  // Get flag counts per benchmarking_id
  const benchmarkingIds = submissions?.map((s) => s.id) ?? [];
  let flagCounts: Record<string, number> = {};

  if (benchmarkingIds.length > 0) {
    const { data: flags } = await supabase
      .from("delta_flags")
      .select("benchmarking_id, committee_status")
      .in("benchmarking_id", benchmarkingIds);

    if (flags) {
      for (const f of flags) {
        flagCounts[f.benchmarking_id] = (flagCounts[f.benchmarking_id] || 0) + 1;
      }
    }
  }

  const tableData = (submissions ?? []).map((s) => {
    const org = s.organization as unknown as { id: string; name: string; slug: string } | null;
    return {
      id: s.id,
      organizationName: org?.name ?? "Unknown",
      organizationSlug: org?.slug ?? "",
      status: s.status ?? "draft",
      submittedAt: s.submitted_at,
      updatedAt: s.updated_at,
      verifiedBy: s.verified_by,
      verifiedAt: s.verified_at,
      flagCount: flagCounts[s.id] ?? 0,
    };
  });

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Submissions</h1>
      <p className="text-sm text-gray-500 mb-6">
        FY{latestSurvey.fiscal_year} &mdash; {latestSurvey.title}
      </p>
      <SubmissionsTable submissions={tableData} fiscalYear={latestSurvey.fiscal_year} />
    </div>
  );
}
