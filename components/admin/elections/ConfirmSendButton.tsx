"use client";

/**
 * A send that states its blast radius and asks twice.
 *
 * On 2026-09-11 the call for nominations went to 39 member administrators
 * because someone opened the production console looking for the preview, found
 * a button labelled "Send the call for nominations", and pressed it. One
 * press, no confirmation, 39 real emails in 120 milliseconds — and nothing on
 * the way there said how many people were on the other side of it.
 *
 * So the first press only ARMS it, and the confirmation names the count. A
 * generic "are you sure?" would not have stopped that: the answer is always
 * yes, because the person pressing already believes they know what it does.
 * "This emails 39 institutions" is the sentence that stops someone who thinks
 * they are on the dev server, because the number is the thing that surprises.
 *
 * ⛔ A count of ZERO is not a send. On 2026-10-30 the benchmarking chase went to
 * all 52 stores, the page came back with this button looking exactly as it had
 * before, and it was pressed again — 52 stores received the same email twice.
 * The planner now blocks a store chased within the gap, so the second press
 * counts nobody; this is the half that makes that visible. A button that is
 * still there, still armable, and would mail no one is the control telling the
 * operator nothing happened.
 *
 * `null` is different and stays pressable: it means the count is unavailable,
 * not that the audience is empty.
 */

import { useState } from "react";
import { AlertTriangle } from "lucide-react";

export default function ConfirmSendButton({
  action,
  label,
  recipients,
  audience,
}: {
  action: (formData: FormData) => Promise<void>;
  label: string;
  /** How many people this reaches right now. Null when it cannot be counted. */
  recipients: number | null;
  /** What they are, in words — "member institutions", "institutions yet to vote". */
  audience: string;
}) {
  const [armed, setArmed] = useState(false);

  if (recipients === 0) {
    return (
      <p className="mt-2 text-xs text-gray-600">
        Nothing to send — no {audience} are waiting on this right now.
      </p>
    );
  }

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        className="mt-2 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
      >
        {label}
      </button>
    );
  }

  const count = recipients === null ? "everyone eligible" : `${recipients}`;

  return (
    <form action={action} className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
      <p className="flex items-start gap-1.5 text-xs font-medium text-amber-900">
        <AlertTriangle size={14} className="mt-px shrink-0" />
        <span>
          This sends a real email to {count}{" "}
          {recipients === 1 ? audience.replace(/s\b/, "") : audience}, now. It cannot be
          recalled.
        </span>
      </p>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="submit"
          className="rounded-lg bg-[#B92026] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#9c1b20]"
        >
          {recipients === null ? `Yes — ${label.toLowerCase()}` : `Yes — email ${recipients}`}
        </button>
        <button
          type="button"
          onClick={() => setArmed(false)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
