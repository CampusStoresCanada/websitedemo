import { createAdminClient } from "@/lib/supabase/admin";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import ChecklistList from "@/components/admin/conference/ChecklistList";

export const metadata = { title: "Checklists | Conference | Admin" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ConferenceChecklistsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = createAdminClient();

  const [{ data: checklists }, { data: entities }] = await Promise.all([
    db
      .from("conference_checklists")
      .select(
        `id, name, description, scope_entity_id, deadline_at, active, created_at,
         conference_checklist_tasks(count), conference_checklist_checkpoints(count),
         scope_entity:conference_entities(name)`
      )
      .eq("conference_id", id)
      .order("created_at", { ascending: false }),
    db
      .from("conference_entities")
      .select("id, name, kind")
      .eq("conference_id", id)
      .eq("is_for_sale", true)
      .order("kind")
      .order("name"),
  ]);

  return (
    <main>
      <AdminPageHeader
        title="Checklists"
        description="Standing task-completion reminders — nag only about what's still open, on a deadline-relative schedule, until it's done."
      />
      <ChecklistList conferenceId={id} checklists={checklists ?? []} entities={entities ?? []} />
    </main>
  );
}
