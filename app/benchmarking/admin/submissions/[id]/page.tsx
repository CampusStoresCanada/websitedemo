import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import SubmissionDetail from "@/components/benchmarking/admin/SubmissionDetail";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function SubmissionDetailPage({ params }: Props) {
  const { id } = await params;
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
    redirect("/benchmarking/admin/submissions");
  }

  // Fetch delta flags for this submission
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: deltaFlags } = (await (supabase as any)
    .from("delta_flags")
    .select("*")
    .eq("benchmarking_id", id)
    .order("created_at", { ascending: false })) as { data: any[] | null };

  // Fetch prior year data for comparison
  const org = submission.organization as unknown as {
    id: string;
    name: string;
    slug: string;
    province: string;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: priorYear } = (await (supabase as any)
    .from("benchmarking")
    .select("*")
    .eq("organization_id", org.id)
    .eq("fiscal_year", submission.fiscal_year - 1)
    .single()) as { data: any };

  return (
    <div>
      <SubmissionDetail
        submission={submission}
        organizationName={org.name}
        organizationProvince={org.province ?? ""}
        deltaFlags={deltaFlags ?? []}
        priorYearData={priorYear ?? null}
      />
    </div>
  );
}
