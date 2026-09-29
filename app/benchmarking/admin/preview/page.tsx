import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Preview Survey | Benchmarking Admin" };

/**
 * "Preview the survey" means opening the survey.
 *
 * This used to render SurveyPreview — a third rendering of the questions that
 * was neither the editor nor the form. It read the field config and drew its
 * own approximation with a "Fill Sample Data" button, so it could show you the
 * questions existed but not whether the thing WORKS: not the title page, not
 * the consent, not carried values, not saving, not the deadline, not a single
 * real control. A preview that cannot be wrong about the survey is not telling
 * you anything about the survey.
 *
 * So it is gone, and this redirects into the real one as the test store. Every
 * count on the dashboard excludes test orgs and loadRecipients() refuses to
 * mail them, so the genuine article can be walked end to end without putting a
 * draft against a member store or a receipt in anyone's inbox.
 */
export default async function PreviewPage() {
  const db = createAdminClient();

  const { data: testOrg } = await db
    .from("organizations")
    .select("id")
    .eq("type", "Member")
    .eq("is_test", true)
    .is("archived_at", null)
    .order("name")
    .limit(1)
    .maybeSingle();

  if (!testOrg) {
    // No test store configured. The picker is the next best thing — it at least
    // lands on the real survey rather than an imitation of it.
    redirect("/benchmarking/survey");
  }

  /*
    Start the walk at the beginning.

    The title page shows until the store has made its disclosure choice, which
    is right for a member and wrong for a preview: tick the acknowledgement once
    and the intro, the consent and the results ladder are invisible from then
    on, which are exactly the parts most worth previewing.

    Clearing the two consent stamps is enough to bring it back, and it leaves
    any figures already typed alone. Test store only — this would be tampering
    with a submission anywhere else.
  */
  await db
    .from("benchmarking")
    .update({
      disclosure_level_set_at: null,
      disclosure_level_set_by: null,
      terms_acknowledged_at: null,
      terms_acknowledged_by: null,
    })
    .eq("organization_id", testOrg.id)
    .eq("status", "draft");

  // preview=1 pins the resolution to the test store — ?org= is ignored from
  // here on, so no amount of clicking lands on a real store's submission.
  redirect(`/benchmarking/survey?org=${testOrg.id}&preview=1`);
}
