/**
 * Elections, on the admin console's front page.
 *
 * Shows nominations while they are open and turnout while voting is open, and
 * renders nothing the rest of the year.
 *
 * ⚠️ Turnout is a COUNT. No candidate is named, no total is shown, and there is
 * no view here that could reconstruct one. "How many institutions have voted"
 * is a fact about participation; "how they voted" is the thing the seal exists
 * to destroy.
 */

import Link from "next/link";
import type { ElectionsWidgetData } from "@/lib/elections/dashboard-widget";

function Bar({ done, total, tone }: { done: number; total: number; tone: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="mt-2">
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-gray-500">{pct}%</p>
    </div>
  );
}

function deadlineLine(daysLeft: number, deadline: string): string {
  if (daysLeft > 1) return `${daysLeft} days left — closes ${deadline}`;
  if (daysLeft === 1) return `Closes tomorrow, ${deadline}`;
  if (daysLeft === 0) return `Closes today`;
  return `Closed ${deadline}`;
}

export function ElectionsWidget({ data }: { data: ElectionsWidgetData }) {
  const nominating = data.phase === "nominating";

  return (
    <div className="min-w-[380px] flex-1 rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            {data.cycleYear} Board election
          </p>
          <h2 className="mt-0.5 text-sm font-semibold text-gray-900">
            {nominating ? "Nominations are open" : "Voting is open"}
          </h2>
        </div>
        <Link
          href={`/admin/elections/${data.slug}`}
          className="shrink-0 text-xs text-accent hover:underline"
        >
          Open
        </Link>
      </div>

      <p className="mt-1 text-xs text-gray-500">
        {deadlineLine(data.daysLeft, data.deadline)}
      </p>

      {nominating ? (
        <>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div>
              <p className="text-2xl font-semibold tabular-nums text-gray-900">
                {data.validatedNominees}
              </p>
              <p className="text-xs text-gray-500">complete</p>
            </div>
            <div>
              <p className="text-2xl font-semibold tabular-nums text-amber-700">
                {data.incompleteNominations}
              </p>
              <p className="text-xs text-gray-500">incomplete</p>
            </div>
            <div>
              <p className="text-2xl font-semibold tabular-nums text-gray-900">{data.seats}</p>
              <p className="text-xs text-gray-500">seats</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-gray-600">
            {data.validatedNominees > data.seats
              ? "More nominees than seats — a ballot will be required."
              : data.validatedNominees === data.seats
                ? "Exactly enough nominees — acclamation, unless another stands."
                : `${data.seats - data.validatedNominees} seat${data.seats - data.validatedNominees === 1 ? "" : "s"} still without a nominee.`}
          </p>
        </>
      ) : (
        <>
          <div className="mt-4 flex items-baseline gap-2">
            <p className="text-3xl font-semibold tabular-nums text-gray-900">
              {data.ballotsReturned}
            </p>
            <p className="text-sm text-gray-600">
              of {data.electorate} institutions have voted
            </p>
          </div>
          <Bar done={data.ballotsReturned} total={data.electorate} tone="bg-gray-900" />
          <p className="mt-2 text-xs text-gray-500">
            {data.electorate - data.ballotsReturned} still to vote. How each institution voted is
            not recorded anywhere this page can reach.
          </p>
        </>
      )}
    </div>
  );
}
