/**
 * The members' AGM package — what is in it, and what is holding it up.
 *
 * Ordered so the blocked items read first, because that is the only part
 * anybody can act on. Everything else is either generated from data we hold or
 * already supplied, and a list that leads with seven ticks buries the one line
 * that matters.
 *
 * Each outstanding item names a person. "Missing" without an owner is a status;
 * with an owner it is a next step.
 */

import type { PackageItem } from "@/lib/elections/documents/agm-package";

const STATE_STYLE: Record<PackageItem["state"], { dot: string; label: string }> = {
  missing: { dot: "bg-red-500", label: "Outstanding" },
  supplied: { dot: "bg-green-600", label: "Supplied" },
  generated: { dot: "bg-green-600", label: "Generated" },
  not_applicable: { dot: "bg-gray-300", label: "Not needed" },
};

function Item({ item }: { item: PackageItem }) {
  const style = STATE_STYLE[item.state];
  return (
    <li className="flex gap-3 py-2">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
      <div className="min-w-0">
        <p
          className={`text-sm ${
            item.state === "not_applicable" ? "text-gray-500" : "font-medium text-gray-900"
          }`}
        >
          {item.title}
        </p>
        <p className="text-xs text-gray-500">{item.because}</p>
        {item.state === "missing" && item.waitingOn && (
          <p className="mt-0.5 text-xs text-red-700">Waiting on {item.waitingOn}.</p>
        )}
        {item.source && <p className="mt-0.5 text-xs text-gray-600">{item.source}</p>}
      </div>
    </li>
  );
}

export default function AgmPackagePanel({
  items,
  outstanding,
  complete,
  summary,
  hasMeeting,
  financialsSupplied,
  upload,
  generateAgenda,
  agendaSupplied,
  send,
  sentAt,
  sendCount,
  error,
  uploaded,
  sent,
  agendaGenerated,
}: {
  items: PackageItem[];
  outstanding: PackageItem[];
  complete: boolean;
  summary: string;
  hasMeeting: boolean;
  financialsSupplied: boolean;
  upload: (formData: FormData) => Promise<void>;
  generateAgenda: (formData: FormData) => Promise<void>;
  agendaSupplied: boolean;
  send: (formData: FormData) => Promise<void>;
  sentAt: string | null;
  sendCount: number;
  error?: string;
  uploaded?: boolean;
  sent?: boolean;
  agendaGenerated?: boolean;
}) {
  const blocked = items.filter((i) => i.state === "missing");
  const settled = items.filter((i) => i.state !== "missing");

  return (
    <section className="rounded-lg border border-gray-200 bg-white px-5 py-4">
      <h2 className="text-sm font-semibold text-gray-900">Members&apos; AGM package</h2>
      <p
        className={`mt-1 text-sm ${complete ? "text-green-800" : "text-gray-700"}`}
      >
        {summary}
      </p>

      {error && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          {error}
        </div>
      )}
      {sent && (
        <div className="mt-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
          The package is on its way to member stores.
        </div>
      )}
      {agendaGenerated && (
        <div className="mt-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
          Agenda generated and saved to the meeting.
        </div>
      )}
      {uploaded && (
        <div className="mt-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
          Financial statements attached to the meeting.
        </div>
      )}

      {blocked.length > 0 && (
        <ul className="mt-3 divide-y divide-gray-100 border-y border-gray-100">
          {blocked.map((i) => (
            <Item key={i.key} item={i} />
          ))}
        </ul>
      )}

      <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 px-4 py-3">
        <p className="text-sm font-medium text-gray-900">Agenda</p>
        <p className="mt-0.5 text-xs text-gray-600">
          Generated from the same running order as the chair&apos;s script, so the two cannot
          drift. Saved onto the meeting, where you can edit it afterwards.
        </p>
        <form action={generateAgenda} className="mt-3 flex flex-wrap items-center gap-3">
          <input
            name="meetingUrl"
            placeholder="Meeting link (optional)"
            className="w-64 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
          {agendaSupplied && (
            <label className="flex items-center gap-2 text-xs text-gray-700">
              <input type="checkbox" name="replace" value="1" />
              Replace the existing agenda
            </label>
          )}
          <button
            type="submit"
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50"
          >
            {agendaSupplied ? "Regenerate agenda" : "Generate agenda"}
          </button>
        </form>
        {agendaSupplied && (
          <p className="mt-2 text-xs text-gray-500">
            An agenda already exists. Regenerating discards anything edited into it, so it needs
            the box ticked.
          </p>
        )}
      </div>

      <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 px-4 py-3">
        <p className="text-sm font-medium text-gray-900">
          Reviewed financial statements
        </p>
        <p className="mt-0.5 text-xs text-gray-600">
          The one item nothing here can produce — it comes from the public accountant. Attaching
          it stores it against the AGM meeting, alongside the agenda and minutes.
        </p>
        {!hasMeeting ? (
          <p className="mt-2 text-xs text-amber-700">
            There is no AGM meeting record yet, so there is nothing to attach this to.
          </p>
        ) : (
          <form action={upload} className="mt-3 flex flex-wrap items-center gap-3">
            <input
              type="file"
              name="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx"
              className="text-sm text-gray-700 file:mr-3 file:rounded-md file:border file:border-gray-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium"
            />
            <button
              type="submit"
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
            >
              {financialsSupplied ? "Replace statements" : "Attach statements"}
            </button>
            {financialsSupplied && (
              <span className="text-xs text-gray-500">
                Replacing supersedes the current set; the earlier one is kept.
              </span>
            )}
          </form>
        )}
      </div>

      <details className="mt-4">
        <summary className="cursor-pointer text-xs font-medium text-gray-600">
          Everything else in the package ({settled.length})
        </summary>
        <ul className="mt-2 divide-y divide-gray-100">
          {settled.map((i) => (
            <Item key={i.key} item={i} />
          ))}
        </ul>
      </details>

      <form action={send} className="mt-4 border-t border-gray-200 pt-4">
        <p className="text-sm font-medium text-gray-900">Send it to member stores</p>
        <p className="mt-0.5 text-xs text-gray-600">
          Emails every administrator at each eligible institution a link to the package page.
          Nothing is attached — the statements are members-only and stay behind the login.
          {sentAt && ` Last sent ${sentAt}${sendCount > 1 ? ` (${sendCount} times)` : ""}.`}
        </p>
        {outstanding.length > 0 && (
          <label className="mt-3 flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" name="acknowledgeOutstanding" value="1" className="mt-0.5" />
            <span>
              Send with {outstanding.length} item{outstanding.length === 1 ? "" : "s"} still
              outstanding. Members will be told what is still to come and that it will appear on
              the same page.
            </span>
          </label>
        )}
        <button
          type="submit"
          className="mt-3 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          {sentAt ? "Send again" : "Send the package"}
        </button>
      </form>
    </section>
  );
}
