import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import SubmissionDetail from "@/components/benchmarking/admin/SubmissionDetail";

interface Props {
  params: Promise<{ year: string; id: string }>;
}

export default async function SubmissionDetailPage({ params }: Props) {
  const { year, id } = await params;
  const supabase = await createClient();

  // Fetch the benchmarking row with org info
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: submission } = (await (supabase as any)
    .from("benchmarking")
    .select(
      `
      *,
      organization:organizations(id, name, slug, province)
    `
    )
    .eq("id", id)
    .single()) as { data: any };

  if (!submission) {
    redirect(`/benchmarking/admin/${year}/submissions`);
  }

  // Fetch delta flags for this submission
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: deltaFlags } = (await (supabase as any)
    .from("delta_flags")
    .select("*")
    .eq("benchmarking_id", id)
    .order("created_at", { ascending: false })) as { data: any[] | null };

  const org = submission.organization as unknown as {
    id: string;
    name: string;
    slug: string;
    province: string;
  };

  /*
    The config this store was asked, and the lists it filed.

    ⛔ Both, or the page is back where it started. The questions come from the
    survey's own field_config, so a retired column cannot reappear here; the
    lists come from their own tables, because since the category rebuild the
    sales figures are rows in benchmarking_categories and not columns on the
    submission. Rendering the submission without them is what made this screen
    show a year-old revenue figure and none of this year's.

    No prior-year row is loaded any more. The year-on-year comparison a reviewer
    needs is the delta flags below, which carry previous and current together
    and say which is which.
  */
  const { data: survey } = await supabase
    .from("benchmarking_surveys")
    .select("*")
    .eq("fiscal_year", submission.fiscal_year)
    .maybeSingle();

  const { getFieldConfig } = await import("@/lib/benchmarking/default-field-config");
  const { loadCategories } = await import("@/lib/actions/benchmarking-categories");
  const { loadOtherIncome, loadOtherExpenses, loadStaff } = await import(
    "@/lib/actions/benchmarking-financials"
  );
  const { loadCompetitors } = await import("@/lib/actions/benchmarking-competitors");
  const { loadLocations } = await import("@/lib/actions/benchmarking-locations");
  const { loadKeyDates } = await import("@/lib/actions/benchmarking-profile");

  const [
    gmCategories,
    cmCategories,
    otherIncome,
    otherExpenses,
    staff,
    competitors,
    locations,
    keyDates,
  ] = await Promise.all([
    loadCategories(id, "general_merchandise"),
    loadCategories(id, "course_materials"),
    loadOtherIncome(id),
    loadOtherExpenses(id),
    loadStaff(id),
    loadCompetitors(id),
    loadLocations(id),
    loadKeyDates(org.id),
  ]);

  return (
    <div>
      <SubmissionDetail
        submission={submission}
        organizationName={org.name}
        deltaFlags={deltaFlags ?? []}
        // No survey row for that year leaves getFieldConfig on its default,
        // which is the structure the form falls back to as well.
        config={getFieldConfig(survey ?? {})}
        lists={{
          gmCategories,
          cmCategories,
          otherIncome,
          otherExpenses,
          staff,
          competitors,
          locations,
          keyDates,
        }}
      />
    </div>
  );
}
