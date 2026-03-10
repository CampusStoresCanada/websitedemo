import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/guards";

/**
 * Redirects to the editor for the latest survey.
 */
export default async function SurveyEditorIndexPage() {
  const auth = await requireAdmin();
  if (!auth.ok) {
    redirect("/benchmarking/admin");
  }

  const supabase = await createClient();

  const { data: latestSurvey } = await supabase
    .from("benchmarking_surveys")
    .select("id")
    .order("fiscal_year", { ascending: false })
    .limit(1)
    .single();

  if (latestSurvey) {
    redirect(`/benchmarking/admin/editor/${latestSurvey.id}`);
  }

  // No surveys exist — redirect to dashboard
  redirect("/benchmarking/admin");
}
