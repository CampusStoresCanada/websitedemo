"use client";

/**
 * Recording notice and the proxy form for a members' meeting with no election.
 *
 * ⛔ Not a second notice system. It writes the same two columns the election's
 * senders write and the spine reads. A special meeting of the members has no
 * sender yet — the senders build their content from an election — so whoever
 * calls one emails the membership and records the date here, and the spine
 * stops saying notice has not been given.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordMembersMeetingSendAction } from "@/lib/actions/members-meetings";

export default function RecordSendByHand({
  meetingId,
  noticeSentAt,
  proxyFormSentAt,
}: {
  meetingId: string;
  noticeSentAt: string | null;
  proxyFormSentAt: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState(noticeSentAt?.slice(0, 10) ?? "");
  const [proxy, setProxy] = useState(proxyFormSentAt?.slice(0, 10) ?? "");

  return (
    <div className="mt-3 border-t border-gray-200 pt-3">
      <p className="text-xs font-medium text-gray-700">Record what has gone out</p>
      <p className="mt-1 text-xs text-gray-500">
        There is no election for this meeting, so notice and the proxy form are not sent from
        here — send them yourself and put the dates in, so the list above is true.
      </p>

      <div className="mt-2 flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-600">
          <span className="block font-medium text-gray-900">Notice given on</span>
          <input
            type="date"
            value={notice}
            disabled={pending}
            onChange={(e) => setNotice(e.target.value)}
            className="mt-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs text-gray-600">
          <span className="block font-medium text-gray-900">Proxy form sent on</span>
          <input
            type="date"
            value={proxy}
            disabled={pending}
            onChange={(e) => setProxy(e.target.value)}
            className="mt-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          />
        </label>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const fd = new FormData();
              fd.set("meetingId", meetingId);
              if (notice) fd.set("noticeGivenOn", notice);
              if (proxy) fd.set("proxyFormSentOn", proxy);
              const r = await recordMembersMeetingSendAction(fd);
              if (!r.ok) setError(r.error);
              else router.refresh();
            })
          }
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Record it"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
