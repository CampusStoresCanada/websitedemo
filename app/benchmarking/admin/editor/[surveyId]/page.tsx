import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/guards";
import { getFieldConfig } from "@/lib/benchmarking/default-field-config";
import SurveyEditor from "@/components/benchmarking/admin/SurveyEditor";

export const metadata = {
  title: "Survey Editor | Benchmarking Admin",
};

export default async function SurveyEditorPage({
  params,
}: {
  params: Promise<{ surveyId: string }>;
}) {
  const { surveyId } = await params;
  const auth = await requireAdmin();
  if (!auth.ok) {
    redirect("/benchmarking/admin");
  }

  const supabase = await createClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: survey } = (await supabase
    .from("benchmarking_surveys")
    .select("*")
    .eq("id", surveyId)
    .single()) as { data: any };

  if (!survey) {
    notFound();
  }

  const fieldConfig = getFieldConfig(survey);

  return (
    <SurveyEditor
      surveyId={survey.id}
      surveyTitle={survey.title}
      fiscalYear={survey.fiscal_year}
      initialConfig={fieldConfig}
    />
  );
}
