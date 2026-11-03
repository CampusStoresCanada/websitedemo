"use client";

import { type ReactNode } from "react";
import TaskChecklist from "@/components/conference/TaskChecklist";
import { answerOrgTask } from "@/lib/actions/conference-tasks";
import type { StaffChecklist } from "@/lib/conference/checklist-tasks";
import type { StaffChecklistGroups } from "@/lib/conference/deadline-urgency";
import { formatDayMonth } from "@/lib/time/supabase-timestamp";
import { type PrintSortKey } from "@/lib/conference/badges/arrangement";


/**
 * CSC's run-sheet for the conference: the staff checklists, in order.
 *
 * Built on the server (the checks read the database; each task's live line and
 * buttons arrive as rendered nodes) and only for admins.
 */
export type WhatsNext = {
  /** CSC's own organization — whom a staff tick is filed under. */
  answeringOrgId: string | null;
  timeZone: string;
  groups: StaffChecklistGroups<StaffChecklist>;
  controlsByTaskId: Record<string, ReactNode>;
  /** The viewer's own order for printed name lists. */
  printSort: PrintSortKey;
};

/**
 * Now, Next, Later, Done — what needs doing surfaces, what's finished folds away.
 *
 * Stephen, 2026-10-22: the look of /admin/membership, the behaviour of the
 * /admin widgets. Each checklist is a card; its tasks are the same tick-off
 * list org admins and attendees answer (TaskChecklist), here answered by CSC
 * for the conference.
 */
export function WhatsNextView({ conferenceId, whatsNext }: { conferenceId: string; whatsNext: WhatsNext }) {
  const { groups } = whatsNext;
  const open = groups.now.length + groups.next.length + groups.later.length;

  if (open + groups.done.length === 0) {
    return (
      <div className="space-y-6">
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">Nothing on the run-sheet yet</h2>
        <p className="mt-1 text-sm text-gray-600">
          What&apos;s next is built from checklists answered by CSC staff. Add one under{" "}
          <a href={`/admin/conference/${conferenceId}/checklists`} className="text-accent hover:underline">
            Checklists
          </a>{" "}
          and set its tasks to &ldquo;CSC staff, in the War Room&rdquo;.
        </p>
      </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {groups.now.length > 0 ? (
        <ChecklistGroup title="Now" lists={groups.now} whatsNext={whatsNext} conferenceId={conferenceId} />
      ) : null}
      {groups.next.length > 0 ? (
        <ChecklistGroup title="Next" lists={groups.next} whatsNext={whatsNext} conferenceId={conferenceId} />
      ) : null}
      {groups.later.length > 0 ? (
        <ChecklistGroup title="Later" lists={groups.later} whatsNext={whatsNext} conferenceId={conferenceId} folded />
      ) : null}
      {groups.done.length > 0 ? (
        <ChecklistGroup title="Done" lists={groups.done} whatsNext={whatsNext} conferenceId={conferenceId} folded />
      ) : null}
      <p className="text-xs text-gray-500">
        These are the conference&apos;s{" "}
        <a href={`/admin/conference/${conferenceId}/checklists`} className="text-accent hover:underline">
          checklists
        </a>{" "}
        answered by CSC staff. Edit them there.
      </p>
    </div>
  );
}

function ChecklistGroup({
  title,
  lists,
  whatsNext,
  conferenceId,
  folded = false,
}: {
  title: string;
  lists: StaffChecklist[];
  whatsNext: WhatsNext;
  conferenceId: string;
  folded?: boolean;
}) {
  const cards = (
    <div className="space-y-4">
      {lists.map((list) => (
        <StaffChecklistCard key={list.id} list={list} whatsNext={whatsNext} conferenceId={conferenceId} />
      ))}
    </div>
  );
  const heading = (
    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
      {title} · {lists.length}
    </span>
  );
  if (folded) {
    return (
      <details className="group">
        <summary className="cursor-pointer list-none">{heading}</summary>
        <div className="mt-3">{cards}</div>
      </details>
    );
  }
  return (
    <section className="space-y-3">
      <h2>{heading}</h2>
      {cards}
    </section>
  );
}

function StaffChecklistCard({
  list,
  whatsNext,
  conferenceId,
}: {
  list: StaffChecklist;
  whatsNext: WhatsNext;
  conferenceId: string;
}) {
  const answered = list.tasks.filter((t) => t.state !== "pending").length;
  const when = formatDayMonth(list.deadline, whatsNext.timeZone);
  return (
    <section className="rounded-xl border border-gray-200 bg-white px-[18px] py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[15.5px] font-medium leading-tight text-[#16345a]">{list.name}</h3>
          {list.description ? <p className="mt-0.5 text-[12.5px] text-gray-500">{list.description}</p> : null}
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          {when ? <span>{when}</span> : null}
          <span
            className={`rounded-full px-2 py-0.5 font-semibold ${
              answered === list.tasks.length ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-600"
            }`}
          >
            {answered} of {list.tasks.length}
          </span>
        </div>
      </div>
      <div className="mt-2">
        <TaskChecklist
          tasks={list.tasks}
          controlsByTaskId={whatsNext.controlsByTaskId}
          onAnswer={async (taskId, state, evidence) => {
            if (!whatsNext.answeringOrgId) {
              return { success: false, error: "CSC's own organization record is missing, so a tick has nowhere to go." };
            }
            return answerOrgTask({
              organizationId: whatsNext.answeringOrgId,
              conferenceId,
              taskId,
              state,
              evidence,
            });
          }}
        />
      </div>
    </section>
  );
}
