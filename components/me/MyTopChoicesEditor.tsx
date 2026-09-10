"use client";

import { useEffect, useRef, useState } from "react";
import { saveMyTopChoices, type PresentOrg } from "@/lib/actions/conference-meeting-preferences";
import OrgChoiceList from "@/components/org/OrgChoiceList";

/**
 * The delegate's own picker. Same list and same row as the exhibitor's, saving
 * against the caller rather than against the company.
 *
 * ⛔ The save belongs to the CLICK, never to a state watcher. A useEffect on the
 * selection is invoked twice by React in development, so the second invocation
 * writes the initial value — and because a save replaces the whole list, merely
 * opening the page with an empty list DELETES what was stored. That happened on
 * the org version and destroyed a real saved choice.
 *
 * ⛔ Boxes are never disabled while saving. Disabling on each write dropped
 * ticks at normal clicking speed — two clicks, one registered — which for a
 * "tick five boxes" task is the whole job failing.
 */
export default function MyTopChoicesEditor({
  conferenceId,
  candidates,
  initialChosenOrgIds,
  limit,
}: {
  conferenceId: string;
  candidates: PresentOrg[];
  initialChosenOrgIds: string[];
  limit: number;
}) {
  const [chosen, setChosen] = useState<string[]>(initialChosenOrgIds);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string[] | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function queueSave(next: string[]) {
    pending.current = next;
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const attempt = pending.current;
      if (!attempt) return;
      const result = await saveMyTopChoices(conferenceId, attempt);
      // Superseded by a later tick.
      if (pending.current !== attempt) return;
      if (!result.success) {
        setError(result.error);
        setStatus("idle");
        return;
      }
      setError(null);
      setStatus("saved");
    }, 500);
  }

  function toggle(targetOrgId: string) {
    setChosen((current) => {
      let next: string[];
      if (current.includes(targetOrgId)) {
        next = current.filter((id) => id !== targetOrgId);
      } else if (current.length >= limit) {
        return current;
      } else {
        next = [...current, targetOrgId];
      }
      queueSave(next);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs">
        <span className="font-medium text-gray-700">
          {chosen.length} of {limit} chosen
        </span>
        {status === "saving" ? <span className="text-gray-500">Saving…</span> : null}
        {status === "saved" ? <span className="text-green-700">Saved</span> : null}
        {error ? <span className="text-red-700">{error}</span> : null}
      </div>

      <OrgChoiceList
        orgs={candidates}
        selectedIds={chosen}
        onToggle={toggle}
        limit={limit}
      />
    </div>
  );
}
