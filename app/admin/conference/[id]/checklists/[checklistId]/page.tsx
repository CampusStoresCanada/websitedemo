import { notFound } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import ChecklistDetail from "@/components/admin/conference/ChecklistDetail";

export const metadata = { title: "Checklist | Conference | Admin" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ChecklistDetailPage({
  params,
}: {
  params: Promise<{ id: string; checklistId: string }>;
}) {
  const { id, checklistId } = await params;
  const db = createAdminClient();

  const [{ data: checklist }, { data: tasks }, { data: checkpoints }, { data: entities }, { data: log }] =
    await Promise.all([
      db.from("conference_checklists").select("*").eq("id", checklistId).single(),
      db
        .from("conference_checklist_tasks")
        .select("*")
        .eq("checklist_id", checklistId)
        .order("sort_order", { ascending: true }),
      db
        .from("conference_checklist_checkpoints")
        .select("*")
        .eq("checklist_id", checklistId)
        .order("days_before_deadline", { ascending: false }),
      db
        .from("conference_entities")
        .select("id, name, kind")
        .eq("conference_id", id)
        .eq("is_for_sale", true)
        .order("kind")
        .order("name"),
      db
        .from("conference_checklist_reminder_log")
        .select("id, sent_at, organization:organizations(name), checkpoint:conference_checklist_checkpoints(days_before_deadline)")
        .eq("checklist_id", checklistId)
        .order("sent_at", { ascending: false })
        .limit(30),
    ]);

  if (!checklist) notFound();

  return (
    <main>
      <Link href={`/admin/conference/${id}/checklists`} className="text-sm text-gray-500 hover:text-gray-700">
        ← Checklists
      </Link>
      <AdminPageHeader title={checklist.name} description={checklist.description ?? undefined} />
      <ChecklistDetail
        conferenceId={id}
        checklist={checklist}
        tasks={tasks ?? []}
        checkpoints={checkpoints ?? []}
        entities={entities ?? []}
        log={log ?? []}
      />
    </main>
  );
}
