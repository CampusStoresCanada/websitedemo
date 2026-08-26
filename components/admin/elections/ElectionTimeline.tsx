/**
 * The cycle as one chronological spine, with the action on each stage.
 *
 * The controls used to be scattered across panels in the order they were built.
 * That works if you already know the process, and this runs once a year — so
 * nobody ever does. Here everything sits where it happens, each stage says what
 * it is waiting for, and the action that moves it is on the stage rather than
 * somewhere else on the page.
 *
 * A blocked action renders as text, not a disabled button. A greyed control
 * invites clicking and explains nothing; a sentence saying "the window opens
 * 17 December" answers the question the click was going to ask.
 */

import type { TimelineStage } from "@/lib/elections/timeline";

const DOT: Record<TimelineStage["state"], string> = {
  done: "bg-green-600",
  current: "bg-gray-900",
  overdue: "bg-red-500",
  upcoming: "bg-gray-300",
  blocked: "bg-gray-300",
  not_applicable: "bg-gray-200",
};

const LABEL: Record<TimelineStage["state"], string> = {
  done: "text-gray-500",
  current: "text-gray-900",
  overdue: "text-red-900",
  upcoming: "text-gray-700",
  blocked: "text-gray-500",
  not_applicable: "text-gray-400",
};

function when(stage: TimelineStage): string | null {
  if (stage.windowLabel) return stage.windowLabel;
  return stage.on;
}

export default function ElectionTimeline({
  stages,
  actions,
}: {
  stages: TimelineStage[];
  /**
   * Keyed the same way the stages are. A function is run directly from the
   * timeline; a STRING is the id of the panel that owns the real form.
   *
   * Some stages cannot be a one-click button and should not be: closing
   * nominations needs its confirmation ticked, and the AGM notice needs the
   * meeting's time typed in. The timeline used to render a bare submit for
   * those too, which posted an empty form and failed every single time — a
   * button that cannot succeed is worse than no button, because it reads as
   * broken software rather than as a step with a form attached.
   */
  actions: Record<string, ((formData: FormData) => Promise<void>) | string | undefined>;
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white px-5 py-4">
      <h2 className="text-sm font-semibold text-gray-900">The cycle</h2>
      <p className="mt-1 text-xs text-gray-500">
        Everything in the order it happens. Dates move with the AGM.
      </p>

      <ol className="mt-4">
        {stages.map((stage, i) => {
          const act = stage.action;
          const runnable = act && !act.blockedBy ? actions[act.key] : undefined;
          const last = i === stages.length - 1;

          return (
            <li key={stage.key} className="relative flex gap-3 pb-5">
              {!last && (
                <span
                  className="absolute left-[5px] top-4 w-px bg-gray-200"
                  style={{ bottom: 0 }}
                  aria-hidden
                />
              )}
              <span
                className={`relative z-10 mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full ring-2 ring-white ${DOT[stage.state]}`}
                aria-hidden
              />

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <p className={`text-sm font-medium ${LABEL[stage.state]}`}>{stage.label}</p>
                  {when(stage) && (
                    <span className="text-xs tabular-nums text-gray-500">{when(stage)}</span>
                  )}
                  {stage.state === "overdue" && (
                    <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-800">
                      overdue
                    </span>
                  )}
                </div>

                {stage.detail && (
                  <p className="mt-0.5 text-xs text-gray-600">{stage.detail}</p>
                )}

                {act && typeof runnable === "function" && (
                  <form action={runnable} className="mt-2">
                    <button
                      type="submit"
                      className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
                    >
                      {act.label}
                    </button>
                  </form>
                )}

                {act && typeof runnable === "string" && (
                  <a
                    href={`#${runnable}`}
                    className="mt-2 inline-block rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
                  >
                    {act.label} →
                  </a>
                )}

                {/* Blocked reads as a sentence. A disabled button would invite a
                    click and answer nothing. */}
                {act?.blockedBy && (
                  <p className="mt-1.5 text-xs text-gray-500">
                    <span className="font-medium text-gray-700">{act.label}</span> —{" "}
                    {act.blockedBy}
                  </p>
                )}

                {/* An action with no handler wired yet says so rather than
                    rendering a button that does nothing. */}
                {act && !act.blockedBy && !runnable && (
                  <p className="mt-1.5 text-xs text-amber-700">
                    {act.label} — available from the panels below.
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
