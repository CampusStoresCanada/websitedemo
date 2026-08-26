import type { NoticeState } from "@/lib/elections/service";

/**
 * The two By-Law Part VII obligations, with their windows on screen.
 *
 * Both are date-bound and neither belongs to the election proper, which is why
 * they are easy to miss — they are obligations of the MEETING. The notice window
 * has a ceiling as well as a floor, and for a January AGM its last days fall over
 * the holidays with no board meeting left to catch a miss. So the state is shown
 * rather than left to be worked out from a due date.
 */
export default function AgmNoticePanel({
  state,
  sendNotice,
  sendProxy,
}: {
  state: NoticeState;
  sendNotice: (formData: FormData) => Promise<void>;
  sendProxy: () => Promise<void>;
}) {
  const { notice, proxy, window: w } = state;
  const tone =
    notice.code === "too_late"
      ? "border-red-300 bg-red-50"
      : notice.code === "ok_but_closing"
        ? "border-amber-300 bg-amber-50"
        : "border-gray-200 bg-white";

  return (
    <section className={`rounded-lg border px-5 py-4 ${tone}`}>
      <h2 className="text-sm font-semibold text-gray-900">
        Notice of the annual general meeting
      </h2>
      <p className="mt-1 text-xs text-gray-600">
        By-Law Part VII S4(b) — electronic notice, <strong>21 to 35 days</strong> before the meeting.
        A window, not a deadline: too early is as defective as too late.
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-gray-500">Window opens</dt>
          <dd className="font-medium text-gray-900">{w.opensOn}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Window closes</dt>
          <dd className="font-medium text-gray-900">{w.closesOn}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Proxy form due</dt>
          <dd className="font-medium text-gray-900">{w.proxyDueOn}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Members to notify</dt>
          <dd className="font-medium text-gray-900">{state.recipients}</dd>
        </div>
      </dl>

      {w.combinedFrom && !state.noticeSentAt && (
        <p className="mt-3 text-xs text-gray-600">
          Sending both together works between <strong>{w.combinedFrom}</strong> and{" "}
          <strong>{w.combinedTo}</strong> — that discharges both obligations in one go.
        </p>
      )}

      {!state.eventPage.readyForNotice && !state.noticeSentAt && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong>
            The meeting&apos;s event page is {state.eventPage.status ?? "missing"}, so the link in
            the notice would show members &ldquo;Event not found&rdquo;.
          </strong>{" "}
          Publish <code>/events/{state.eventPage.slug}</code> before giving notice — notice with a
          dead link is defective notice, and the send refuses until it is live. Worth doing now
          rather than on the day: the window has very few usable days.
        </div>
      )}

      {state.unreachable.length > 0 && (
        <div className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-900">
          <strong>{state.unreachable.length} member{state.unreachable.length === 1 ? "" : "s"} cannot be given notice electronically</strong>{" "}
          — no administrator on record: {state.unreachable.join(", ")}. Notice has to reach every member
          entitled to vote, so this needs fixing before the window closes.
        </div>
      )}

      <div className="mt-4 space-y-4">
        {state.noticeSentAt ? (
          <p className="text-sm text-green-800">
            <strong>Notice given</strong> {state.noticeSentAt.slice(0, 10)}. It cannot be sent again —
            a second, contradictory notice in front of every member would be worse than none.
          </p>
        ) : !notice.canSend ? (
          <div className="rounded border border-red-200 bg-white p-3 text-sm text-red-900">
            {notice.message}
          </div>
        ) : (
          <form action={sendNotice} className="space-y-3">
            <div className={notice.code === "ok_but_closing" ? "text-sm font-medium text-amber-900" : "text-sm text-gray-700"}>
              {notice.message}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs text-gray-600">
                <span className="block font-medium text-gray-900">Time of the meeting</span>
                <input
                  name="agmTime"
                  placeholder="1:00 PM Eastern"
                  className="mt-1 w-48 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="text-xs text-gray-600">
                <span className="block font-medium text-gray-900">Place (optional)</span>
                <input
                  name="location"
                  placeholder="Online"
                  className="mt-1 w-56 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
              {!state.proxySentAt && (
                <label className="flex items-center gap-2 pb-2 text-xs text-gray-700">
                  <input type="checkbox" name="includeProxyForm" value="1" defaultChecked className="h-4 w-4" />
                  Send the proxy form too
                </label>
              )}
              <button
                type="submit"
                className="rounded-lg bg-[#B92026] px-4 py-2 text-sm font-medium text-white hover:bg-[#9c1b20]"
              >
                Give notice to {state.recipients} members
              </button>
            </div>
          </form>
        )}

        <div className="border-t border-gray-200 pt-3">
          {state.proxySentAt ? (
            <p className="text-sm text-green-800">
              <strong>Proxy form sent</strong> {state.proxySentAt.slice(0, 10)}.
            </p>
          ) : (
            <form action={sendProxy} className="flex items-center gap-3">
              <button
                type="submit"
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Send the proxy form on its own
              </button>
              <span className={`text-xs ${proxy.overdue ? "text-amber-700" : "text-gray-500"}`}>
                {proxy.message}
              </span>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
