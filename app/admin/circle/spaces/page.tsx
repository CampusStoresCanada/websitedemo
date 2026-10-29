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
  const [rulesRes, confsRes, surveyRes, spacesRes, bodiesRes, roleRes] = await Promise.all([
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
    db.from("governance_bodies").select("key, name").order("name"),
    // The roles that actually exist, rather than a list to keep in step by
    // hand. A role nobody holds cannot be picked, which is correct: a rule
    // naming one would match nobody and read as a broken job.
    db.from("governance_role_assignments").select("body_id, role_key"),
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

  const bodies = (bodiesRes.data ?? []).map((b) => ({ key: b.key as string, name: b.name as string }));
  const bodyKeyById = new Map(
    (
      await db.from("governance_bodies").select("id, key")
    ).data?.map((b) => [b.id as string, b.key as string]) ?? []
  );
  const rolesByBody: Record<string, string[]> = {};
  for (const r of roleRes.data ?? []) {
    const key = bodyKeyById.get(r.body_id as string);
    if (!key) continue;
    (rolesByBody[key] ??= []).push(r.role_key as string);
  }
  for (const key of Object.keys(rolesByBody))
    rolesByBody[key] = [...new Set(rolesByBody[key])].sort();

  const spaceNames = new Map(spacesRes.spaces.map((s) => [s.id, s.name]));
  const views: SpaceRuleView[] = rules.map((r) => ({
    id: r.id,
    spaceId: r.space_id === null ? null : Number(r.space_id),
    spaceName: r.space_id === null ? null : spaceNames.get(Number(r.space_id)) ?? null,
    destination: (r.destination ?? "circle_space") as string,
    googleGroupEmail: r.google_group_email ?? null,
    bodyKey: r.body_key ?? null,
    roleKey: r.role_key ?? null,
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
        description="Destinations kept in step with who qualifies for them — private Circle spaces, and Google groups. Every hour, people who qualify are added; in a Circle space, people this sync added are removed once they stop qualifying. Anyone added by hand is never removed, and nobody is ever removed from a Google group."
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
        bodies={bodies}
        rolesByBody={rolesByBody}
      />
    </main>
  );
}
