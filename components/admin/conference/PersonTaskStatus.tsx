import type { PersonTaskStatus } from "@/lib/conference/checklist-status";

/**
 * Where attendees are on their personal tasks. Read-only: staff chase people,
 * they don't tick boxes on their behalf.
 *
 * Uses <details> rather than a client component — the only interaction is
 * expanding a list, and that is what the element is for.
 */
export default function PersonTaskStatus({ status }: { status: PersonTaskStatus }) {
  const { population, inactiveTasks, tasks } = status;
  const checklistOff = inactiveTasks.filter((t) => t.reason === "checklist_off");
  const taskOff = inactiveTasks.filter((t) => t.reason === "task_off");

  return (
    <section className="mt-8">
      <div className="mb-3">
        <h2 className="text-lg font-semibold text-gray-900">Where people are</h2>
        <p className="mt-0.5 text-sm text-gray-600">
          Personal tasks — the ones each attendee answers for themselves, like booking
          a room. Company-level tasks aren&apos;t counted here.
        </p>
      </div>

      {population === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
          Nobody is registered for this conference yet, so there is nobody to chase.
          This fills in as registrations arrive.
        </p>
      ) : tasks.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
          No personal tasks are switched on.
        </p>
      ) : (
        <ul className="space-y-2">
          {tasks.map((task) => {
            const answered = task.done + task.notApplicable;
            const pct = population > 0 ? Math.round((answered / population) * 100) : 0;
            return (
              <li
                key={task.taskId}
                className="rounded-xl border border-gray-200 bg-white p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <span className="text-sm font-semibold text-gray-900">{task.name}</span>
                    <span className="ml-2 text-xs text-gray-400">{task.checklistName}</span>
                  </div>
                  <span className="text-sm text-gray-600">
                    {answered} of {population} answered
                    {task.pending > 0 && (
                      <span className="ml-2 font-semibold text-amber-700">
                        {task.pending} outstanding
                      </span>
                    )}
                  </span>
                </div>

                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                  <div
                    className={`h-full rounded-full ${
                      task.pending === 0 ? "bg-emerald-500" : "bg-gray-900"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>

                <p className="mt-2 text-xs text-gray-500">
                  {task.done} booked or done
                  {task.derived > 0 && ` (${task.derived} from a confirmation code we hold)`}
                  {task.notApplicable > 0 && ` · ${task.notApplicable} not applicable`}
                  {task.deadline &&
                    ` · closes ${new Date(task.deadline).toLocaleDateString("en-CA", {
                      year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
                    })}`}
                </p>

                {task.outstanding.length > 0 && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs font-medium text-gray-600 hover:text-gray-900">
                      Who hasn&apos;t answered ({task.outstanding.length})
                    </summary>
                    <ul className="mt-2 space-y-1 border-t border-gray-100 pt-2">
                      {task.outstanding.map((person) => (
                        <li key={person.personId} className="text-xs text-gray-600">
                          <span className="text-gray-900">{person.name}</span>
                          <span className="text-gray-400"> · {person.organizationName}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {inactiveTasks.length > 0 && (
        <div className="mt-3 space-y-2">
          {checklistOff.length > 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <span className="font-semibold">On a checklist that is switched off:</span>{" "}
              {checklistOff.map((t) => t.name).join(", ")}. Nobody is being asked, and
              nothing is counted above, until the checklist itself is made active.
            </p>
          )}
          {taskOff.length > 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <span className="font-semibold">Switched off inside a live checklist:</span>{" "}
              {taskOff.map((t) => t.name).join(", ")}. The checklist is running; these
              tasks alone are turned off.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
