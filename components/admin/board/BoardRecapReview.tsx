"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveRecapBlock,
  approveAndPostRecap,
  skipRecap,
  type BoardRecapRow,
} from "@/lib/actions/board-recaps";

const STATUS_STYLES: Record<BoardRecapRow["status"], string> = {
  draft: "bg-amber-50 text-amber-700 border-amber-200",
  approved: "bg-blue-50 text-blue-700 border-blue-200",
  published: "bg-green-50 text-green-700 border-green-200",
  skipped: "bg-gray-50 text-gray-500 border-gray-200",
};

function Section({ title, lines }: { title: string; lines: string[] }) {
  if (!lines.length) return null;
  return (
    <div className="mb-3">
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h4>
      <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
        {lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

function RecapCard({ recap }: { recap: BoardRecapRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [block, setBlock] = useState(recap.sourceBlock);
  const [message, setMessage] = useState<string | null>(null);

  const isDraft = recap.status === "draft";
  const nothingTagged =
    !recap.decided.length && !recap.outstanding.length && !recap.nextMeeting.length;

  function run(action: () => Promise<{ ok: boolean; error?: string; url?: string | null }>, success: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      setMessage(result.ok ? success : result.error ?? "Something went wrong.");
      if (result.ok) {
        setEditing(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{recap.meetingTitle}</h3>
          <p className="text-xs text-gray-500">{recap.meetingDateLong}</p>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[recap.status]}`}>
          {recap.status}
        </span>
      </div>

      {editing ? (
        <>
          <p className="mb-2 text-xs text-gray-500">
            One line per item, each starting with <code>DECIDED:</code>, <code>OUTSTANDING:</code> or{" "}
            <code>NEXT MEETING:</code>. This is the only copy — the minutes no longer contain it.
          </p>
          <textarea
            value={block}
            onChange={(e) => setBlock(e.target.value)}
            rows={8}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs"
          />
        </>
      ) : (
        <div className="rounded-lg bg-gray-50 px-4 py-3">
          {nothingTagged ? (
            <p className="text-sm text-gray-400">Nothing tagged.</p>
          ) : (
            <>
              <Section title="Decided" lines={recap.decided} />
              <Section title="Still outstanding" lines={recap.outstanding} />
              <Section title="Agenda for next meeting" lines={recap.nextMeeting} />
            </>
          )}
        </div>
      )}

      {message && <p className="mt-3 text-xs text-gray-600">{message}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {isDraft && !editing && (
          <>
            <button
              onClick={() => run(() => approveAndPostRecap(recap.id), "Sent to the board space as a draft — publish it in Circle when ready.")}
              disabled={pending || nothingTagged}
              className="rounded-md bg-[#163D6D] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#163D6D]/90 disabled:opacity-40"
            >
              {pending ? "Sending…" : "Approve & send draft to Circle"}
            </button>
            <button
              onClick={() => setEditing(true)}
              disabled={pending}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              Edit lines
            </button>
            <button
              onClick={() => run(() => skipRecap(recap.id, "Skipped by reviewer."), "Skipped.")}
              disabled={pending}
              className="rounded-md px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 disabled:opacity-40"
            >
              Skip
            </button>
          </>
        )}

        {isDraft && editing && (
          <>
            <button
              onClick={() => run(() => saveRecapBlock(recap.id, block), "Recap rebuilt.")}
              disabled={pending}
              className="rounded-md bg-[#163D6D] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#163D6D]/90 disabled:opacity-40"
            >
              {pending ? "Saving…" : "Save & rebuild"}
            </button>
            <button
              onClick={() => {
                setBlock(recap.sourceBlock);
                setEditing(false);
                setMessage(null);
              }}
              disabled={pending}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              Cancel
            </button>
          </>
        )}

        {recap.circlePostUrl && (
          <a
            href={recap.circlePostUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-[#163D6D] underline underline-offset-2"
          >
            View in Circle ↗
          </a>
        )}
      </div>
    </div>
  );
}

export default function BoardRecapReview({ initial }: { initial: BoardRecapRow[] }) {
  if (!initial.length) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-white py-12 text-center">
        <p className="text-sm text-gray-400">
          No recaps yet. One is drafted automatically when board minutes are saved with tagged lines.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {initial.map((recap) => (
        <RecapCard key={recap.id} recap={recap} />
      ))}
    </div>
  );
}
