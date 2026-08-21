import { redirect } from "next/navigation";
import { requireAuthenticated, isGlobalAdmin } from "@/lib/auth/guards";
import { getFieldConfig } from "@/lib/benchmarking/default-field-config";
import FieldReviewWorkspace from "@/components/benchmarking/review/FieldReviewWorkspace";

export const metadata = {
  title: "Question Review | Campus Stores Canada",
  description:
    "Review the benchmarking survey questions and write worked examples.",
};

export default async function BenchmarkingReviewPage() {
  const auth = await requireAuthenticated();
  if (!auth.ok) redirect("/login");

  const { supabase, userId, globalRole } = auth.ctx;
  const admin = isGlobalAdmin(globalRole);

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();

  const isContentReviewer = auth.ctx.isBenchmarkingContentReviewer;

  if (!isContentReviewer && !admin) redirect("/benchmarking");

  // Newest survey wins. Deliberately not .eq("status","open").single() — that
  // throws on zero surveys and on two, and review happens before a survey opens.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: surveys } = (await (supabase as any)
    .from("benchmarking_surveys")
    .select("*")
    .order("fiscal_year", { ascending: false })
    .limit(1)) as { data: any[] | null };

  const survey = surveys?.[0] ?? null;
  if (!survey) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <h1 className="text-xl font-semibold text-gray-900 mb-2">
          No survey to review yet
        </h1>
        <p className="text-sm text-gray-500">
          A survey has to exist before its questions can be reviewed. Check back
          once this year&rsquo;s is set up.
        </p>
      </div>
    );
  }

  const fieldConfig = getFieldConfig(survey);

  // Every review on this survey. Reviewers can read each other's — but a
  // field's peer comments are held back until you have answered it yourself,
  // so your first read of a question stays your own.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: allReviews } = (await (supabase as any)
    .from("benchmarking_field_reviews")
    .select("*")
    .eq("survey_id", survey.id)) as { data: any[] | null };

  const rows = allReviews ?? [];
  const myReviews = rows.filter((r) => r.reviewer_id === userId);

  // Which fields has this reviewer already answered? Only those unlock.
  const answered = new Set(
    myReviews
      .filter((r) => r.status && r.status !== "pending")
      .map((r) => r.field_name),
  );

  const reviewerIds = Array.from(
    new Set(rows.map((r) => r.reviewer_id).filter((id) => id !== userId)),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: peerProfiles } = (await (supabase as any)
    .from("profiles")
    .select("id, display_name")
    .in(
      "id",
      reviewerIds.length
        ? reviewerIds
        : ["00000000-0000-0000-0000-000000000000"],
    )) as { data: any[] | null };
  const nameById = new Map(
    (peerProfiles ?? []).map((p) => [p.id, p.display_name ?? "A reviewer"]),
  );

  const peerComments: Record<
    string,
    {
      reviewerName: string;
      status: string;
      comment: string | null;
      proposedExample: string | null;
      proposedExampleCredit: string | null;
    }[]
  > = {};
  const peerCounts: Record<string, number> = {};

  for (const r of rows) {
    if (r.reviewer_id === userId) continue;
    if (!r.status || r.status === "pending") continue;
    peerCounts[r.field_name] = (peerCounts[r.field_name] ?? 0) + 1;
    if (!answered.has(r.field_name)) continue; // locked until you answer
    (peerComments[r.field_name] ??= []).push({
      reviewerName: nameById.get(r.reviewer_id) ?? "A reviewer",
      status: r.status,
      comment: r.comment ?? null,
      proposedExample: r.proposed_example ?? null,
      proposedExampleCredit: r.proposed_example_credit ?? null,
    });
  }

  return (
    <FieldReviewWorkspace
      surveyId={survey.id}
      surveyTitle={survey.title}
      fiscalYear={survey.fiscal_year}
      reviewerName={
        (profile as { display_name?: string | null } | null)?.display_name ??
        "there"
      }
      fieldConfig={fieldConfig}
      existingReviews={myReviews}
      peerComments={peerComments}
      peerCounts={peerCounts}
    />
  );
}
