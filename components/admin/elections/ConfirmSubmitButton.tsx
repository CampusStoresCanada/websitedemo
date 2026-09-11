"use client";

/**
 * The same arm-then-confirm as ConfirmSendButton, but for a send that lives
 * inside an existing form.
 *
 * The AGM package carries an acknowledgement checkbox, so its button cannot be
 * moved into a form of its own without dropping that field. This stays put and
 * only changes when it submits: the first press arms, the second sends.
 */

import { useState } from "react";
import { AlertTriangle } from "lucide-react";

export default function ConfirmSubmitButton({
  label,
  recipients,
  audience,
  className,
}: {
  label: string;
  recipients: number | null;
  audience: string;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        className={className ?? "mt-3 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
      <p className="flex items-start gap-1.5 text-xs font-medium text-amber-900">
        <AlertTriangle size={14} className="mt-px shrink-0" />
        <span>
          This sends a real email to {recipients === null ? "everyone eligible" : recipients}{" "}
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
    </div>
  );
}
