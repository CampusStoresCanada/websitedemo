"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatCalendarDate } from "@/lib/time/supabase-timestamp";
import type { PersonalTask } from "@/lib/conference/checklist-tasks";
import ServiceFacts from "./ServiceFacts";

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
  boothNumbers = [],
}: {
  tasks: PersonalTask[];
  onAnswer: (taskId: string, state: "done" | "not_applicable" | "pending", evidence?: string) => Promise<{ success: boolean; error?: string }>;
  emptyLabel?: string;
  /** Shown on supplier tasks — a shipping label needs the booth number. */
  boothNumbers?: string[];
}) {
  if (tasks.length === 0) {
    return <p className="text-sm text-gray-500">{emptyLabel}</p>;
  }
  return (
    <ul className="divide-y divide-gray-100">
      {tasks.map((task) => (
        <TaskRow key={task.taskId} task={task} onAnswer={onAnswer} boothNumbers={boothNumbers} />
      ))}
    </ul>
  );
}

/**
 * The three states a check-in can be in, in the order a person moves through
 * them. Labels are deliberately first-person: the reader is answering about
 * themselves, not setting a status.
 */
const ANSWERS: { state: "pending" | "done" | "not_applicable"; label: string }[] = [
  { state: "pending", label: "Not yet" },
  { state: "done", label: "Done" },
  { state: "not_applicable", label: "Doesn't apply" },
];

function TaskRow({
  task,
  onAnswer,
  boothNumbers,
}: {
  task: PersonalTask;
  boothNumbers: string[];
  onAnswer: (taskId: string, state: "done" | "not_applicable" | "pending", evidence?: string) => Promise<{ success: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const [evidence, setEvidence] = useState("");

  const answer = (state: "done" | "not_applicable" | "pending", value?: string) => {
    setError(null);
    startTransition(async () => {
      const result = await onAnswer(task.taskId, state, value);
      if (!result.success) {
        setError(result.error ?? "Couldn't save that.");
        return;
      }
      setShowEvidence(false);
      // The row's state arrives as a prop from the server component, so without
      // this the buttons keep showing the PREVIOUS answer. That was not merely
      // cosmetic: the stale render marked the wrong button active, and the
      // "already active, do nothing" guard below then swallowed the next click
      // entirely. Two answers in a row could be lost with no error shown.
      router.refresh();
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
              {/* A checklist deadline is a DAY, not an instant. It is stored as
                  a timestamptz at UTC midnight — "Your Conference" is
                  2027-01-08 00:00:00+00, meaning the 8th — and rendering that
                  in Toronto moved it back to the 7th, so the hotel row told
                  people their cutoff was a day earlier than it is. The previous
                  comment here fixed the opposite case, assuming deadlines were
                  stored as 23:59 ET; they are not all stored that way. Taking
                  the calendar date off the front never shifts. */}
              Closes {formatCalendarDate(task.deadline.slice(0, 10)) ?? task.deadline.slice(0, 10)}
            </p>
          ) : null}
          {task.service ? (
            <ServiceFacts service={task.service} boothNumbers={boothNumbers} />
          ) : null}
          {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
        </div>

        {canAnswer ? (
          /**
           * Three answers, all visible, current one marked.
           *
           * The old shape hid two of them: pending showed "Mark done" and
           * "Doesn't apply to me", and once answered it collapsed to a single
           * "Change" that silently TOGGLED between done and not-applicable.
           * So "are you booked?" could not be walked back to "not yet", and
           * clicking Change on a not-applicable item flipped it to done
           * without saying so.
           *
           * "I haven't booked yet" is a real answer, not the absence of one.
           */
          <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5">
            {ANSWERS.map((a) => {
              const active = task.state === a.state;
              return (
                <button
                  key={a.state}
                  type="button"
                  disabled={pending}
                  aria-pressed={active}
                  onClick={() => {
                    if (active) return;
                    // Only "done" asks for a reference; the other two are
                    // complete answers on their own.
                    if (a.state === "done") setShowEvidence(true);
                    else answer(a.state);
                  }}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                    active
                      ? a.state === "done"
                        ? "bg-green-700 text-white"
                        : a.state === "not_applicable"
                          ? "bg-gray-600 text-white"
                          : "bg-amber-600 text-white"
                      : "border border-gray-300 text-gray-600 hover:border-gray-400"
                  }`}
                >
                  {a.label}
                </button>
              );
            })}
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
  // "Waiting on you" told a company the system was waiting, but not what for
  // and not whether they had to come back and say so. The useful distinction
  // is whether there is a button to press: a monitored task ticks itself once
  // the underlying thing is true, a self-reported one never will.
  return task.source === "monitored" ? (
    <span
      title="We check this automatically — do it and this updates on its own."
      className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700"
    >
      Not done yet
    </span>
  ) : (
    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
      Tick when done
    </span>
  );
}
