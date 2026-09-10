"use client";

import { useState, useTransition } from "react";
import { decideLeadDisclosure } from "@/lib/actions/badge-scan";

/**
 * Yes / no on one queued disclosure.
 *
 * ⛔ Buttons, not links. A link is a GET, and a GET gets fetched by things that
 * are not the member — link previews, mail security scanners. If the answer
 * were reachable by fetching a URL, something other than the person could
 * answer it, which is the opposite of consent.
 */
export function DisclosureDecision({ disclosureId }: { disclosureId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const decide = (decision: "released" | "declined") =>
    startTransition(async () => {
      setError(null);
      const result = await decideLeadDisclosure(disclosureId, decision);
      if (!result.ok) setError(result.error);
    });

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => decide("released")}
          className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          Share my details
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => decide("declined")}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-60"
        >
          No thanks
        </button>
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
