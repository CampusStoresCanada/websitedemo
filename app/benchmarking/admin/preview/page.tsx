import { createClient } from "@/lib/supabase/server";
import { getFieldConfig } from "@/lib/benchmarking/default-field-config";
import SurveyPreview from "@/components/benchmarking/admin/SurveyPreview";

export default async function PreviewPage() {
  const supabase = await createClient();

  // Get the latest survey's field_config for preview
  const { data: latestSurvey } = await supabase
    .from("benchmarking_surveys")
    .select("*")
    .order("fiscal_year", { ascending: false })
    .limit(1)
    .single();

  const fieldConfig = latestSurvey ? getFieldConfig(latestSurvey) : null;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Survey Preview</h1>
      <p className="text-sm text-gray-500 mb-6">
        Preview all sections and their questions. Use &ldquo;Fill Sample Data&rdquo; to see
        realistic values.
      </p>
      <SurveyPreview fieldConfig={fieldConfig} />
    </div>
  );
}
