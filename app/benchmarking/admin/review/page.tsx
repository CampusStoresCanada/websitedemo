import { redirect } from "next/navigation";
import { requireAuthenticated, isGlobalAdmin } from "@/lib/auth/guards";
import { getFieldConfig } from "@/lib/benchmarking/default-field-config";
import type { FieldConfig } from "@/lib/benchmarking/default-field-config";
import FacilitatorBoard from "@/components/benchmarking/review/FacilitatorBoard";

export const metadata = { title: "Question Review | Benchmarking Admin" };

export default async function ReviewAdminPage() {
  const auth = await requireAuthenticated();
  if (!auth.ok) redirect("/login");
  if (!isGlobalAdmin(auth.ctx.globalRole)) redirect("/benchmarking");

  const { supabase } = auth.ctx;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: surveys } = (await (supabase as any)
    .from("benchmarking_surveys")
    .select("*")
    .order("fiscal_year", { ascending: false })
    .limit(1)) as { data: any[] | null };

  const survey = surveys?.[0] ?? null;
  if (!survey) {
    return (
      <div className="py-12 text-center text-sm text-gray-500">
        No survey exists yet.
      </div>
    );
  }

  const config = getFieldConfig(survey);
  const fieldIndex = new Map<string, { section: string; field: FieldConfig }>();
  for (const section of config.sections) {
    for (const field of section.fields) {
      fieldIndex.set(field.name, { section: section.title, field });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: reviews } = (await (supabase as any)
    .from("benchmarking_field_reviews")
    .select("*")
    .eq("survey_id", survey.id)) as { data: any[] | null };

  const reviewerIds = Array.from(
    new Set((reviews ?? []).map((r) => r.reviewer_id)),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profiles } = (await (supabase as any)
    .from("profiles")
    .select("id, display_name")
    .in(
      "id",
      reviewerIds.length
        ? reviewerIds
        : ["00000000-0000-0000-0000-000000000000"],
    )) as {
    data: any[] | null;
  };
  const nameById = new Map(
    (profiles ?? []).map((p) => [p.id, p.display_name ?? "Unknown"]),
  );

  // Group by field, then order by contention: fields where reviewers disagree
  // come first, because those are the ones the live session exists to settle.
  const byField = new Map<string, any[]>();
  for (const r of reviews ?? []) {
    const list = byField.get(r.field_name) ?? [];
    list.push(r);
    byField.set(r.field_name, list);
  }

  const groups = Array.from(byField.entries()).map(([fieldName, rows]) => {
    const meta = fieldIndex.get(fieldName);
    const statuses = new Set(rows.map((r) => r.status));
    const concerns = rows.filter((r) => r.status !== "ok").length;
    const openRows = rows.filter((r) => r.resolution === "open").length;
    const proposals = rows.filter(
      (r) => r.proposed_example || r.proposed_help_text,
    ).length;
    return {
      fieldName,
      label: meta?.field.label ?? fieldName,
      section: meta?.section ?? "—",
      reviewerNote: meta?.field.reviewerNote ?? null,
      currentHelpText: meta?.field.helpText ?? null,
      currentExample: meta?.field.example ?? null,
      disagreement: statuses.size > 1,
      concerns,
      openRows,
      proposals,
      rows: rows.map((r) => ({
        id: r.id,
        reviewerName: nameById.get(r.reviewer_id) ?? "Unknown",
        status: r.status as string,
        comment: r.comment as string | null,
        proposedExample: r.proposed_example as string | null,
        proposedExampleCredit: r.proposed_example_credit as string | null,
        proposedHelpText: r.proposed_help_text as string | null,
        resolution: r.resolution as string,
        resolutionNote: r.resolution_note as string | null,
      })),
    };
  });

  groups.sort((a, b) => {
    if (a.disagreement !== b.disagreement) return a.disagreement ? -1 : 1;
    if (b.concerns !== a.concerns) return b.concerns - a.concerns;
    if (b.openRows !== a.openRows) return b.openRows - a.openRows;
    return a.label.localeCompare(b.label);
  });

  return (
    <FacilitatorBoard
      surveyTitle={survey.title}
      fiscalYear={survey.fiscal_year}
      reviewerCount={reviewerIds.length}
      groups={groups}
    />
  );
}
