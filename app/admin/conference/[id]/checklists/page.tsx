import { createAdminClient } from "@/lib/supabase/admin";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import ChecklistList from "@/components/admin/conference/ChecklistList";
import PersonTaskStatus from "@/components/admin/conference/PersonTaskStatus";
import { loadPersonTaskStatus } from "@/lib/conference/checklist-status";

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

  const [{ data: checklists }, { data: entities }, { data: publications }] = await Promise.all([
    db
      .from("conference_checklists")
      .select(
        `id, name, description, scope_entity_id, publication_id, deadline_at, active, created_at,
         conference_checklist_tasks(audience, active),
         conference_checklist_checkpoints(id),
         conference_checklist_tasks(name, ask_from, active),
         scope_entity:conference_entities(name), publication:publications(id, title)`
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
    db.from("publications").select("id, title").order("name"),
  ]);

  const personTaskStatus = await loadPersonTaskStatus(db, id);

  /**
   * Tasks that say "we are asking from today" while the mail says otherwise.
   *
   * `ask_from` splits when we START asking from when a thing HARDENS, and the
   * member-facing surfaces already honour it. The sending engine does not: it
   * still schedules from conference_checklist_checkpoints, which are
   * days_before_deadline per checklist. So a task can read "asked from 31
   * August" on the org page while the first email about it is months away.
   *
   * Surfaced here because a peer session made the right point — this gap is
   * worse than the original bug in one specific way: anyone reading the admin
   * surface would reasonably believe outreach had started. A discrepancy that
   * lives only in someone's head is one that gets acted on wrongly.
   */
  const askingButNotSending = (checklists ?? []).flatMap((cl) => {
    const tasks = (cl as unknown as {
      conference_checklist_tasks?: { name: string; ask_from: string | null; active: boolean }[];
    }).conference_checklist_tasks ?? [];
    return tasks
      .filter((t) => t.active && t.ask_from && t.ask_from <= new Date().toISOString().slice(0, 10))
      .map((t) => t.name);
  });

  return (
    <main>
      <AdminPageHeader
        title="Checklists"
        description="Standing task-completion reminders — nag only about what's still open, on a deadline-relative schedule, until it's done."
      />
      {askingButNotSending.length > 0 && (
        <div className="mx-auto mb-4 max-w-5xl rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">
            {askingButNotSending.length === 1 ? "One task is" : `${askingButNotSending.length} tasks are`}{" "}
            marked as being asked for now, but no mail reflects that yet.
          </p>
          <p className="mt-1">
            {askingButNotSending.join(" · ")} — these show as active asks on the org and
            attendee pages. Reminder sending still runs off the checkpoints below, which
            are relative to each checklist&rsquo;s deadline, so the first email may be
            months away. Nobody has been contacted about them.
          </p>
        </div>
      )}

      <ChecklistList
        conferenceId={id}
        checklists={checklists ?? []}
        entities={entities ?? []}
        publications={publications ?? []}
      />
      <PersonTaskStatus status={personTaskStatus} />
    </main>
  );
}
