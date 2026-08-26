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
import { splinePath } from "@/lib/utils/spline";

/**
 * Arrivals per day, in the same idiom as the renewals card. The shape is the
 * point: a ballot that is still coming in looks different from one that stalled
 * a fortnight ago, and the count alone cannot tell you which you have.
 */
function Sparkline({ daily }: { daily: { date: string; count: number }[] }) {
  if (daily.length < 2) return null;
  const max = Math.max(1, ...daily.map((d) => d.count));
  const pts = daily.map((d, i) => ({
    x: (i / (daily.length - 1)) * 100,
    y: 100 - (d.count / max) * 100,
  }));
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="mt-3 h-10 w-full"
      aria-hidden
    >
      <path
        d={splinePath(pts)}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        className="text-gray-400"
      />
    </svg>
  );
}

/** "3 in the last 7 days · 0.4 a day" — rate, not just total. */
function rateLine(d: ElectionsWidgetData, noun: string): string {
  const total = d.phase === "nominating" ? d.nominationsReceived : d.ballotsReturned;
  if (total === 0) return `No ${noun} yet.`;
  const recent =
    d.recent7 === 0
      ? `nothing in the last 7 days`
      : `${d.recent7} in the last 7 days`;
  return `${recent} · ${d.perDay} a day`;
}

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
    // Sizing belongs to the grid cell, not the card — the dashboard decides
    // how many slots this occupies.
    <div className="h-full rounded-xl border border-gray-200 bg-white p-5">
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
          <Sparkline daily={data.daily} />
          <p className="mt-1 text-xs text-gray-500">{rateLine(data, "nominations")}</p>
          <p className="mt-2 text-xs text-gray-600">
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
          <Sparkline daily={data.daily} />
          <p className="mt-1 text-xs text-gray-500">{rateLine(data, "ballots")}</p>
          {/* Clamped, because the electorate is re-derived on every render while
              the ballots are a fixed historical count. An institution can vote
              in September and be ineligible in October — a lapsed renewal, an
              archived org — at which point the raw subtraction goes NEGATIVE and
              the widget reads "-1 still to vote". Never show the operator a
              number that cannot exist; when more have voted than are currently
              eligible, say that plainly instead. */}
          <p className="mt-2 text-xs text-gray-600">
            {data.ballotsReturned > data.electorate
              ? `${data.ballotsReturned} ballots are in from ${data.electorate} currently eligible institutions — some voted before their eligibility changed.`
              : data.projected === null
                ? `${data.electorate - data.ballotsReturned} still to vote.`
                : `At this pace, about ${data.projected} of ${data.electorate} by close.`}
          </p>
        </>
      )}
    </div>
  );
}
