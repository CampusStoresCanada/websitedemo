import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCircleClient } from "@/lib/circle/client";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import SpaceRulesClient, { type SpaceRuleView } from "@/components/admin/circle/SpaceRulesClient";
import { SPACE_RULE_COLUMNS, SURVEY_ARRAY_FIELDS, type RuleLastRun, type SpaceRuleRow } from "@/lib/circle/space-rules";

export const metadata = {
  title: "Circle Spaces | Admin | Campus Stores Canada",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CircleSpaceRulesPage() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) redirect("/admin");

  const db = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  const circle = getCircleClient();
  const [rulesRes, confsRes, surveyRes, spacesRes] = await Promise.all([
    db.from("circle_space_rules").select(SPACE_RULE_COLUMNS).order("label"),
    db
      .from("conference_instances")
      .select("id, name, end_date")
      .order("start_date", { ascending: false }),
    // Read-only: the distinct answers offered for a survey rule.
    db.from("benchmarking").select(SURVEY_ARRAY_FIELDS.map((f) => f.field).join(", ")),
    circle
      ? circle.listSpaces().then(
          (s) => ({ spaces: s, error: null as string | null }),
          (e: unknown) => ({ spaces: [], error: e instanceof Error ? e.message : String(e) })
        )
      : Promise.resolve({ spaces: [], error: "Circle is not configured." }),
  ]);

  const rules = (rulesRes.data ?? []) as SpaceRuleRow[];
  const ruleConfIds = new Set(rules.map((r) => r.conference_id).filter(Boolean));
  // Offer conferences that have not ended, plus any a rule already points at.
  const conferences = (confsRes.data ?? []).filter(
    (c) => !c.end_date || c.end_date >= today || ruleConfIds.has(c.id)
  );

  const { data: passRows } = conferences.length
    ? await db
        .from("conference_entities")
        .select("id, conference_id, name")
        .eq("kind", "registration")
        .in("conference_id", conferences.map((c) => c.id))
        .order("name")
    : { data: [] };

  const answers: Record<string, string[]> = {};
  for (const { field } of SURVEY_ARRAY_FIELDS) {
    const seen = new Set<string>();
    for (const row of (surveyRes.data ?? []) as unknown as Record<string, string[] | null>[]) {
      for (const v of row[field] ?? []) if (v) seen.add(v);
    }
    answers[field] = [...seen].sort((a, b) => a.localeCompare(b));
  }

  const spaceNames = new Map(spacesRes.spaces.map((s) => [s.id, s.name]));
  const views: SpaceRuleView[] = rules.map((r) => ({
    id: r.id,
    spaceId: Number(r.space_id),
    spaceName: spaceNames.get(Number(r.space_id)) ?? null,
    label: r.label,
    kind: r.kind,
    conferenceId: r.conference_id,
    passEntityIds: r.pass_entity_ids,
    surveyField: r.survey_field,
    surveyValue: r.survey_value,
    lastRun: (r.last_run as RuleLastRun | null) ?? null,
    lastRunAt: r.last_run_at,
  }));

  const loadError = rulesRes.error?.message ?? confsRes.error?.message ?? surveyRes.error?.message ?? null;

  return (
    <main>
      <AdminPageHeader
        title="Circle Spaces"
        description="Private Circle spaces kept in step with who qualifies for them. Every hour, people who qualify and have a Circle account are added; people this sync added are removed once they stop qualifying. Anyone added by hand is never removed."
        actions={
          <Link
            href="/admin/circle"
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            ← Circle
          </Link>
        }
      />
      {loadError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Could not load everything on this page: {loadError}
        </div>
      )}
      <SpaceRulesClient
        rules={views}
        spaces={spacesRes.spaces
          .map((s) => ({ id: s.id, name: s.name, isPrivate: s.is_private }))
          .sort((a, b) => a.name.localeCompare(b.name))}
        spacesError={spacesRes.error}
        conferences={conferences.map((c) => ({ id: c.id, name: c.name }))}
        passes={(passRows ?? []).map((p) => ({ id: p.id, conferenceId: p.conference_id, name: p.name }))}
        surveyFields={SURVEY_ARRAY_FIELDS.map((f) => ({ field: f.field, label: f.label }))}
        surveyAnswers={answers}
      />
    </main>
  );
}
