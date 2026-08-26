import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated } from "@/lib/auth/guards";
import { answerPersonalTask } from "@/lib/actions/conference-tasks";
import { loadPersonalTasks } from "@/lib/conference/checklist-tasks";
import TaskChecklist from "@/components/conference/TaskChecklist";

/**
 * The attendee's own conference to-dos, on the page they already use.
 *
 * Mirrors what ConferenceChecklistSection does for an organisation. The
 * details a person supplies — dietary, travel, emergency contact — are not
 * here: those live behind Edit, in the same modal they use to change their
 * name, because that is the one path for "change something about me".
 *
 * What is left is genuinely a checklist: things only they can confirm, where
 * "doesn't apply to me" is a complete answer.
 */
export default async function MyConferenceSection() {
  const auth = await requireAuthenticated();
  if (!auth.ok) return null;

  const db = createAdminClient();
  const { data: people } = await db
    .from("conference_people")
    .select("id, conference_id, conference_instances!inner(name, year, edition_code)")
    .eq("user_id", auth.ctx.userId)
    .neq("assignment_status", "canceled")
    .order("updated_at", { ascending: false })
    .limit(1);

  const person = (people ?? [])[0] as unknown as {
    id: string;
    conference_id: string;
    conference_instances: { name: string; year: number; edition_code: string } | null;
  } | undefined;
  if (!person) return null;

  const tasks = await loadPersonalTasks(db, person.conference_id, person.id);
  const conference = person.conference_instances;

  // No tasks and nothing to link to is not a section, it is a heading.
  if (tasks.length === 0 && !conference) return null;

  const personId = person.id;
  async function handleTaskAnswer(
    taskId: string,
    state: "done" | "not_applicable",
    evidence?: string
  ) {
    "use server";
    return answerPersonalTask({ personId, taskId, state, evidence, revalidate: "/me" });
  }

  return (
    <section id="conference_checklist" className="scroll-mt-20 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-900">
          {conference?.name ?? "Conference"}
        </h2>
        {conference && (
          <Link
            href={`/conference/${conference.year}/${conference.edition_code}/schedule`}
            className="text-sm font-medium text-[#163D6D] hover:underline"
          >
            Your schedule &rarr;
          </Link>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="text-base font-semibold text-gray-900">Things to confirm</h3>
        <p className="mt-0.5 text-sm text-gray-500">
          Tick them off as you go — or tell us one doesn&rsquo;t apply and we&rsquo;ll stop
          asking. Dietary needs, travel and your emergency contact are under Edit.
        </p>
        <div className="mt-2">
          <TaskChecklist tasks={tasks} onAnswer={handleTaskAnswer}
            emptyLabel="Nothing to confirm right now." />
        </div>
      </div>
    </section>
  );
}
