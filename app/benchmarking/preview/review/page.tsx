import { redirect } from "next/navigation";
import { requireAuthenticated } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { getFieldConfig } from "@/lib/benchmarking/default-field-config";
import FieldReviewWorkspace from "@/components/benchmarking/review/FieldReviewWorkspace";

export const metadata = {
  title: "Question Review — a look around | Campus Stores Canada",
  description:
    "See what reviewing the benchmarking questions actually involves, before deciding whether to take it on.",
};

/**
 * The review tool, open to any signed-in member, saving nothing.
 *
 * Being told about a job over the phone and seeing it are different things,
 * and some people only decide once they've had a look. This is the link that
 * goes in that conversation.
 *
 * No capability required — there is nothing here but the questions we are
 * already asking 52 stores, and no submitted data of any kind.
 */
export default async function ReviewPreviewPage() {
  const auth = await requireAuthenticated();
  if (!auth.ok) redirect("/login");

  const db = createAdminClient();
  const { data: surveys } = await db
    .from("benchmarking_surveys")
    .select("*")
    .order("fiscal_year", { ascending: false })
    .limit(1);

  const survey = surveys?.[0] ?? null;
  if (!survey) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <p className="text-sm text-gray-500">
          No survey has been set up yet, so there is nothing to look at.
        </p>
      </div>
    );
  }

  return (
    <FieldReviewWorkspace
      surveyId={survey.id}
      surveyTitle={survey.title}
      fiscalYear={survey.fiscal_year}
      reviewerName="there"
      fieldConfig={getFieldConfig(survey)}
      existingReviews={[]}
      peerComments={{}}
      peerCounts={{}}
      preview
    />
  );
}
