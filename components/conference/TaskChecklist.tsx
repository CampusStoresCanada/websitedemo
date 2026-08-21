"use client";

import { useState, useTransition } from "react";
import type { PersonalTask } from "@/lib/conference/checklist-tasks";

/**
 * The tick-off list. One list mixing what the site can see with what only the
 * exhibitor knows — they want to know what's outstanding, not which half of it
 * we happen to be able to observe.
 *
 * Three answers, not two. "Not applicable" is a first-class button, not hidden
 * behind a menu: someone staying at their own hotel needs a way to stop being
 * asked, or they learn to ignore the reminders that DO cost money if missed.
 * Any answer can be changed later — nothing here is a one-way door.
 */
export default function TaskChecklist({
  tasks,
  onAnswer,
  emptyLabel = "Nothing outstanding.",
}: {
  tasks: PersonalTask[];
  onAnswer: (taskId: string, state: "done" | "not_applicable", evidence?: string) => Promise<{ success: boolean; error?: string }>;
  emptyLabel?: string;
}) {
  if (tasks.length === 0) {
    return <p className="text-sm text-gray-500">{emptyLabel}</p>;
  }
  return (
    <ul className="divide-y divide-gray-100">
      {tasks.map((task) => (
        <TaskRow key={task.taskId} task={task} onAnswer={onAnswer} />
      ))}
    </ul>
  );
}

function TaskRow({
  task,
  onAnswer,
}: {
  task: PersonalTask;
  onAnswer: (taskId: string, state: "done" | "not_applicable", evidence?: string) => Promise<{ success: boolean; error?: string }>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const [evidence, setEvidence] = useState("");

  const answer = (state: "done" | "not_applicable", value?: string) => {
    setError(null);
    startTransition(async () => {
      const result = await onAnswer(task.taskId, state, value);
      if (!result.success) setError(result.error ?? "Couldn't save that.");
      else setShowEvidence(false);
    });
  };

  const canAnswer = task.source === "self_reported";

  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-gray-900">{task.name}</span>
            <StateBadge task={task} />
          </div>
          <p className="mt-0.5 text-sm text-gray-600">{task.description}</p>
          {task.evidence ? (
            <p className="mt-1 text-xs text-gray-500">
              Reference: <span className="font-medium text-gray-700">{task.evidence}</span>
            </p>
          ) : null}
          {task.deadline ? (
            <p className="mt-1 text-xs text-gray-400">
              Closes {new Date(task.deadline).toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}
            </p>
          ) : null}
          {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
        </div>

        {canAnswer ? (
          <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
            {task.state === "pending" ? (
              <>
                <button type="button" disabled={pending}
                  onClick={() => setShowEvidence((v) => !v)}
                  className="rounded-md bg-[#163D6D] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#12325a] disabled:opacity-50">
                  Mark done
                </button>
                <button type="button" disabled={pending}
                  onClick={() => answer("not_applicable")}
                  className="text-xs font-medium text-gray-500 hover:text-gray-700 hover:underline disabled:opacity-50">
                  Doesn&rsquo;t apply to me
                </button>
              </>
            ) : (
              <button type="button" disabled={pending}
                onClick={() => { setShowEvidence(false); answer(task.state === "done" ? "not_applicable" : "done"); }}
                className="text-xs font-medium text-gray-500 hover:text-gray-700 hover:underline disabled:opacity-50">
                Change
              </button>
            )}
          </div>
        ) : null}
      </div>

      {showEvidence && canAnswer ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            placeholder="Confirmation or order number (optional)"
            className="min-w-0 flex-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
          />
          <button type="button" disabled={pending}
            onClick={() => answer("done", evidence)}
            className="rounded-md bg-[#163D6D] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#12325a] disabled:opacity-50">
            {pending ? "Saving…" : "Save"}
          </button>
          <button type="button" disabled={pending}
            onClick={() => answer("done")}
            className="text-xs font-medium text-gray-500 hover:underline disabled:opacity-50">
            Skip
          </button>
        </div>
      ) : null}
    </li>
  );
}

function StateBadge({ task }: { task: PersonalTask }) {
  if (task.state === "done") {
    return (
      <span className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700">
        {task.derived ? "Confirmed" : "Done"}
      </span>
    );
  }
  if (task.state === "not_applicable") {
    return <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500">Not applicable</span>;
  }
  return (
    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
      {task.source === "monitored" ? "Waiting on you" : "To do"}
    </span>
  );
}
