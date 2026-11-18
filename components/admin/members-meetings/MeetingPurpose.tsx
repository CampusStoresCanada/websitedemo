"use client";

/**
 * What a special meeting of the members is called to transact.
 *
 * ⛔ By-Law Part VII: only the business set out in the notice may be transacted
 * at a special meeting. So this is not a description — it is the limit on what
 * the meeting can lawfully do, and members read it on the event page.
 *
 * Shown only for a special meeting. An AGM's business is fixed by the by-law,
 * and a box asking a person to restate it would invite them to narrow it.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveMembersMeetingPurposeAction } from "@/lib/actions/members-meetings";

export default function MeetingPurpose({
  meetingId,
  purpose,
  noticeSentAt,
}: {
  meetingId: string;
  purpose: string | null;
  noticeSentAt: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [text, setText] = useState(purpose ?? "");

  const locked = !!noticeSentAt;

  return (
    <section className="rounded-lg border border-gray-200 bg-white px-5 py-4">
      <h2 className="text-sm font-semibold text-gray-900">
        The business of this meeting
      </h2>
      <p className="mt-1 text-xs text-gray-500">
        By-Law Part VII. Only what the notice states may be transacted, so this is the limit on
        what the meeting can do — not a description of it. Members read this on the event page.
      </p>

      <textarea
        value={text}
        disabled={pending || locked}
        onChange={(e) => {
          setText(e.target.value);
          setSaved(false);
        }}
        rows={4}
        placeholder="To consider and, if thought fit, approve…"
        className="mt-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
      />

      {locked ? (
        <p className="mt-2 text-xs text-amber-700">
          Notice went out on {noticeSentAt!.slice(0, 10)} stating this business. Only what
          members were told may be transacted, so changing it now needs fresh notice rather
          than an edit.
        </p>
      ) : (
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                setSaved(false);
                const fd = new FormData();
                fd.set("meetingId", meetingId);
                fd.set("purpose", text);
                const r = await saveMembersMeetingPurposeAction(fd);
                if (!r.ok) setError(r.error);
                else {
                  setSaved(true);
                  router.refresh();
                }
              })
            }
            className="rounded-md bg-[#163D6D] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#122f54] disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save the business"}
          </button>
          {saved && !error && <span className="text-xs text-green-700">Saved.</span>}
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </section>
  );
}
