/**
 * One section of the committee's screen, sized to whether it still matters.
 *
 * ⛔ COLLAPSED, NEVER REMOVED. A phase that has passed is the record of what
 * happened, and somebody reconstructing a decision months later needs it. This
 * is a claim about attention, not about relevance — `<details>` keeps every
 * panel on the page and one click from open, with no JavaScript and no state
 * to get out of step.
 *
 * The summary line is the point. A collapsed section that says only
 * "Nominations" has cost the reader a click to learn nothing; one that says
 * "Closed 23 October · 4 validated · acclaimed" has answered the question they
 * were going to open it to ask.
 */

import type { ReactNode } from "react";
import type { SectionState } from "@/lib/elections/phases";

export default function PhaseSection({
  state,
  title,
  summary,
  children,
}: {
  state: SectionState;
  title: string;
  /** One line that answers what the reader would have opened it to find out. */
  summary: string;
  children: ReactNode;
}) {
  if (state === "current") {
    return <section className="rounded-lg border border-gray-200 bg-white px-5 py-4">{children}</section>;
  }

  const done = state === "past";
  return (
    <details
      className={`group rounded-lg border px-5 py-3 ${
        done ? "border-gray-200 bg-gray-50" : "border-dashed border-gray-300 bg-white"
      }`}
    >
      <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span className={done ? "font-medium text-gray-700" : "font-medium text-gray-500"}>
          {title}
        </span>
        <span className="text-xs text-gray-500">{summary}</span>
        <span className="ml-auto text-xs text-gray-400 group-open:hidden">open</span>
        <span className="ml-auto hidden text-xs text-gray-400 group-open:inline">close</span>
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}
