"use client";

import { useEffect, useRef, useState } from "react";
import { saveTopChoices, type PresentOrg } from "@/lib/actions/conference-meeting-preferences";
import OrgChoiceList from "@/components/org/OrgChoiceList";

/**
 * Pick your top five. That is the whole activity.
 *
 * ⛔ ONE ASK. This briefly also carried a "rather not" control, which made a
 * two-minute job into a screen with two different decisions on it. Refusals are
 * a real thing we collect — org_meeting_refusals exists, the scheduler honours
 * it — but they are a different question asked at a different time, and bolting
 * them on here is how a simple task stops getting done.
 *
 * ⚠️ The copy is short on purpose. The preamble already says we will try to make
 * the meeting happen if we can; an exhibitor without a meeting room obviously
 * cannot be given one, and saying so at length is the same caveat twice. The
 * "on the floor only this year" label carries it. Do not re-add the essay.
 *
 * ⛔ Floor-only exhibitors stay pickable. A standard exhibitor learning that
 * dozens of people wanted twelve minutes with them is the most useful thing
 * that pick can produce, and filtering it out would destroy the demand signal.
 */
export default function MeetingPreferencesEditor({
  conferenceId,
  orgId,
  candidates,
  initialTopChoiceOrgIds,
  limit,
}: {
  conferenceId: string;
  orgId: string;
  candidates: PresentOrg[];
  initialTopChoiceOrgIds: string[];
  limit: number;
}) {
  const [chosen, setChosen] = useState<string[]>(initialTopChoiceOrgIds);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [open, setOpen] = useState(false);

  const atLimit = chosen.length >= limit;

  /**
   * ⛔ THE SAVE BELONGS TO THE CLICK, NEVER TO A STATE WATCHER.
   *
   * This was briefly a useEffect on `chosen` guarded by a firstRender ref. React
   * invokes effects TWICE in development, so the second invocation ran with the
   * initial value and wrote it — and because a save replaces the whole list,
   * merely opening the page with an empty list DELETED whatever was stored. I
   * destroyed a real saved choice that way while testing.
   *
   * Debounced from the handler instead: local state moves instantly, boxes are
   * never disabled, and rapid ticking collapses into one write. Mounting does
   * nothing at all.
   */
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
      const result = await saveTopChoices(conferenceId, orgId, attempt);
      // A later tick has already superseded this write.
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

  /*
    Collapsed by default, with the count in the header.

    The list is every organisation at the conference — sixty-odd rows — and it
    sits inside a checklist task now. Open, it buries everything below it; the
    header answers "have I done this?" without expanding, which is the only
    question most readers have on most visits.
  */
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-left hover:border-gray-300"
      >
        <span aria-hidden className="text-gray-400">{open ? "▾" : "▸"}</span>
        <span className="text-sm font-medium text-gray-900">Who do you most want to meet?</span>
        <span className="text-xs text-gray-500">({chosen.length}/{limit} selected)</span>
        <span className="ml-auto flex items-center gap-2 text-xs">
          {status === "saving" ? <span className="text-gray-500">Saving…</span> : null}
          {status === "saved" ? <span className="text-green-700">Saved</span> : null}
          {error ? <span className="text-red-700">{error}</span> : null}
        </span>
      </button>

      {open ? (
        <OrgChoiceList
          orgs={candidates}
          selectedIds={chosen}
          onToggle={toggle}
          limit={limit}
        />
      ) : null}
    </div>
  );
}
