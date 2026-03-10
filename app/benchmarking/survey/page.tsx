import { redirect } from "next/navigation";
import BenchmarkingSurveyForm from "@/components/benchmarking/BenchmarkingSurveyForm";
import { getFieldConfig } from "@/lib/benchmarking/default-field-config";
import { isGlobalAdmin, requireAuthenticated } from "@/lib/auth/guards";

export const metadata = {
  title: "Benchmarking Survey | Campus Stores Canada",
  description: "Complete your annual benchmarking survey.",
};

export default async function BenchmarkingSurveyPage() {
  const auth = await requireAuthenticated();
  if (!auth.ok) {
    redirect("/login");
  }
  const { supabase, userId, globalRole } = auth.ctx;

  // 2. Get user profile and org
  const isAdmin = isGlobalAdmin(globalRole);

  // 3. Find user's member org where they're org_admin
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: userOrgs } = (await (supabase as any)
    .from("user_organizations")
    .select(
      `
      organization_id,
      role,
      organization:organizations(id, name, slug, type, province)
    `
    )
    .eq("user_id", userId)
    .eq("status", "active")) as { data: any[] | null };

  const memberOrgLink = userOrgs?.find((uo) => {
    const org = uo.organization as unknown as { type: string } | null;
    return org?.type === "Member" && (uo.role === "org_admin" || isAdmin);
  });

  if (!memberOrgLink && !isAdmin) {
    redirect("/benchmarking");
  }

  const organization = memberOrgLink?.organization as unknown as {
    id: string;
    name: string;
    slug: string;
    type: string;
    province: string;
  } | null;

  if (!organization) {
    redirect("/benchmarking");
  }

  // 4. Check active survey
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: activeSurvey } = (await (supabase as any)
    .from("benchmarking_surveys")
    .select("*")
    .eq("status", "open")
    .single()) as { data: any };

  if (!activeSurvey) {
    redirect("/benchmarking");
  }

  // 5. Fetch or create the draft row for this org + fiscal year
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let { data: currentRow } = (await (supabase as any)
    .from("benchmarking")
    .select("*")
    .eq("organization_id", organization.id)
    .eq("fiscal_year", activeSurvey.fiscal_year)
    .single()) as { data: any };

  if (!currentRow) {
    // Create a new draft row
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: newRow, error: insertError } = (await (supabase as any)
      .from("benchmarking")
      .insert({
        organization_id: organization.id,
        fiscal_year: activeSurvey.fiscal_year,
        status: "draft",
        respondent_user_id: userId,
      })
      .select("*")
      .single()) as { data: any; error: any };

    if (insertError) {
      console.error("Error creating benchmarking draft:", insertError);
      redirect("/benchmarking");
    }

    currentRow = newRow;
  }

  // 6. Fetch prior year data (for reference values and delta flags)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: priorYearRow } = (await (supabase as any)
    .from("benchmarking")
    .select("*")
    .eq("organization_id", organization.id)
    .eq("fiscal_year", activeSurvey.fiscal_year - 1)
    .single()) as { data: any };

  // 7. Fetch existing delta flags for this row
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: deltaFlags } = (await (supabase as any)
    .from("delta_flags")
    .select("*")
    .eq("benchmarking_id", currentRow!.id)) as { data: any[] | null };

  // 8. Get the field config for this survey (or DEFAULT if null)
  const fieldConfig = getFieldConfig(activeSurvey);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <BenchmarkingSurveyForm
        benchmarkingId={currentRow!.id}
        fiscalYear={activeSurvey.fiscal_year}
        organizationName={organization.name}
        organizationProvince={organization.province}
        currentData={currentRow!}
        priorYearData={priorYearRow}
        deltaFlags={deltaFlags ?? []}
        surveyClosesAt={activeSurvey.closes_at}
        fieldConfig={fieldConfig}
      />
    </div>
  );
}
