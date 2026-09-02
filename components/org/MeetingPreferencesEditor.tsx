"use client";

import { useState, useTransition } from "react";
import { saveTopChoices, type PresentOrg } from "@/lib/actions/conference-meeting-preferences";

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
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const atLimit = chosen.length >= limit;

  function toggle(targetOrgId: string) {
    const next = chosen.includes(targetOrgId)
      ? chosen.filter((id) => id !== targetOrgId)
      : [...chosen, targetOrgId];
    if (next.length > limit) return;

    const previous = chosen;
    setChosen(next);
    setError(null);
    setSaved(false);

    startTransition(async () => {
      const result = await saveTopChoices(conferenceId, orgId, next);
      if (!result.success) {
        setChosen(previous);
        setError(result.error);
        return;
      }
      setSaved(true);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs">
        <span className="font-medium text-gray-700">
          {chosen.length} of {limit} chosen
        </span>
        {isPending ? <span className="text-gray-500">Saving…</span> : null}
        {saved && !isPending ? <span className="text-green-700">Saved</span> : null}
        {error ? <span className="text-red-700">{error}</span> : null}
      </div>

      <ul className="divide-y divide-gray-200 rounded-md border border-gray-200">
        {candidates.map((org) => {
          const isChosen = chosen.includes(org.id);
          return (
            <li key={org.id} className="flex items-center justify-between gap-4 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">{org.name}</p>
                <p className="text-xs text-gray-500">
                  {org.type}
                  {org.takesMeetings ? null : (
                    <>
                      {org.type ? " · " : null}
                      <span className="text-amber-700">on the floor only this year</span>
                    </>
                  )}
                </p>
              </div>

              <button
                type="button"
                onClick={() => toggle(org.id)}
                aria-pressed={isChosen}
                // Disabled only when the list is full AND this one is not in it,
                // so the button that would free a slot is always available.
                disabled={isPending || (atLimit && !isChosen)}
                className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-40 ${
                  isChosen
                    ? "bg-[#163D6D] text-white"
                    : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                {isChosen ? "Chosen" : "Add"}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
