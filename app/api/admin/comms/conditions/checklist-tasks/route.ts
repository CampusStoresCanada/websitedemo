import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/admin/comms/conditions/checklist-tasks — options for the
 * "which task" reference picker when a condition's subject is Checklist
 * Task. Title includes the parent checklist + conference year since the
 * same task name (e.g. "Assign your seats") can recur across checklists.
 */
export async function GET() {
  const db = createAdminClient();
  const { data, error } = await db
    .from("conference_checklist_tasks")
    .select("id, name, active, checklist:conference_checklists(name, conference:conference_instances(year))")
    .eq("active", true)
    .order("name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const options = (data ?? []).map((task) => {
    const checklist = Array.isArray(task.checklist) ? task.checklist[0] : task.checklist;
    const conference = checklist ? (Array.isArray(checklist.conference) ? checklist.conference[0] : checklist.conference) : null;
    const suffix = [checklist?.name, conference?.year].filter(Boolean).join(" · ");
    return { id: task.id, title: suffix ? `${task.name} (${suffix})` : task.name };
  });

  return NextResponse.json({ options });
}
