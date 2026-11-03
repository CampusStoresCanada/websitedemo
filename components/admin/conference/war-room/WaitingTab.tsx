"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { submitFlag } from "@/lib/actions/submit-flag";
import { resolveFlag } from "@/lib/actions/flags";
import { decideSwapCapIncreaseRequest } from "@/lib/actions/conference-swaps";
import { setBursaryApplicationStatus } from "@/lib/actions/conference-bursary";
import type { WaitingItem, WaitingOnUs } from "@/lib/conference/waiting-on-us";
import ConfirmAction from "@/components/ui/ConfirmAction";

import { whenMountain } from "./shared";

/**
 * Waiting on us: everyone waiting on CSC, in one list (loadWaitingOnUs) — asks,
 * extra meeting swaps, bursary decisions. Urgent first, then longest waiting.
 *
 * Stephen, 2026-10-22: no owners — anyone adds an ask, whoever handles it ticks
 * it off. Every action here is asked twice and says what it does.
 */
export function WaitingView({
  conferenceId,
  waiting,
}: {
  conferenceId: string;
  waiting: WaitingOnUs;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [urgent, setUrgent] = useState(false);
  const { items, doneAsks } = waiting;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-gray-200 bg-white px-[18px] py-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What does someone need? e.g. Suite 12 needs a power bar"
            className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />
            Urgent
          </label>
          {/* Adding one messages CSC staff in Circle, so it is asked twice. */}
          <ConfirmAction
            label="Add"
            disabled={!note.trim()}
            consequence={`Adds this to the list and messages CSC staff in Circle${urgent ? ", marked urgent" : ""}.`}
            onConfirm={async () => {
              const result = await submitFlag({
                pageUrl: `/admin/conference/${conferenceId}/war-room`,
                priority: urgent ? "high" : "normal",
                note: note.trim(),
              });
              if (!result.success) return { success: false, error: result.error ?? "Couldn't save that." };
              setNote("");
              setUrgent(false);
              router.refresh();
              return { success: true };
            }}
          />
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Waiting · {items.length}</h2>
        {items.length === 0 ? <p className="text-sm text-gray-500">Nobody is waiting on us.</p> : null}
        {items.map((item) => (
          <WaitingRow key={`${item.kind}:${item.id}`} item={item} />
        ))}
      </section>

      {doneAsks.length > 0 ? (
        <details>
          <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-wide text-gray-500">
            Handled asks · {doneAsks.length}
          </summary>
          <div className="mt-2 space-y-2">
            {doneAsks.map((ask) => (
              <div key={ask.id} className="rounded-xl border border-gray-200 bg-white px-[18px] py-3 text-sm text-gray-600">
                {ask.note || "(no note)"}
                <span className="ml-2 text-xs text-gray-400">
                  {ask.flaggerName ?? "Someone"} · {whenMountain(ask.createdAt)}
                </span>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
const KIND_LABEL: Record<WaitingItem["kind"], string> = {
  ask: "Ask",
  swap_cap: "Meeting swaps",
  bursary: "Travel bursary",
};

/** One person waiting, and the actions that answer them. */
function WaitingRow({ item }: { item: WaitingItem }) {
  const router = useRouter();
  const name = item.who ?? "Someone";
  const after = (result: { success: boolean; error?: string }) => {
    if (result.success) router.refresh();
    return result;
  };

  const actions =
    item.kind === "ask" ? (
      <ConfirmAction
        label="Done"
        consequence={`Marks ${name}'s ask as handled. Reply to them in Circle first if they need an answer.`}
        onConfirm={async () => after(await resolveFlag(item.id))}
      />
    ) : item.kind === "swap_cap" ? (
      <>
        <ConfirmAction
          label="Approve"
          consequence={`Gives ${name} ${item.extraSwaps ?? "the"} more meeting swap${item.extraSwaps === 1 ? "" : "s"}. They can use them on their own page straight away.`}
          onConfirm={async () => after(await decideSwapCapIncreaseRequest(item.id, "approved"))}
        />
        <ConfirmAction
          label="Deny"
          tone="danger"
          consequence={`Declines ${name}'s request for more swaps. Their current schedule stays as it is.`}
          onConfirm={async () => after(await decideSwapCapIncreaseRequest(item.id, "denied"))}
        />
      </>
    ) : (
      <>
        <ConfirmAction
          label="Approve"
          consequence={`Records the travel bursary for ${item.org ?? name} as approved. No email is sent.`}
          onConfirm={async () => after(await setBursaryApplicationStatus({ applicationId: item.id, status: "approved" }))}
        />
        <ConfirmAction
          label="Decline"
          tone="danger"
          consequence={`Records the travel bursary for ${item.org ?? name} as declined. No email is sent.`}
          onConfirm={async () => after(await setBursaryApplicationStatus({ applicationId: item.id, status: "denied" }))}
        />
      </>
    );

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-gray-200 bg-white px-[18px] py-3">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
          {item.urgent ? (
            <span className="rounded bg-red-600 px-1.5 py-0.5 text-[11px] font-semibold text-white">Urgent</span>
          ) : null}
          <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-700">{KIND_LABEL[item.kind]}</span>
          <span className="font-medium text-gray-800">{name}</span>
          {item.org ? <span>{item.org}</span> : null}
          <span>· {whenMountain(item.since)}</span>
          {item.source ? <span>· from {item.source}</span> : null}
        </p>
        <p className="mt-1 text-sm text-gray-900">{item.what}</p>
        {item.details ? <p className="mt-1 whitespace-pre-line text-xs text-gray-600">{item.details}</p> : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-start gap-2">{actions}</div>
    </div>
  );
}
