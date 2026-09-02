"use client";

import { useState, useTransition } from "react";
import { saveTopChoices, setRefusal, type PresentOrg } from "@/lib/actions/conference-meeting-preferences";

/**
 * Two lists, one for each direction of intent.
 *
 * ⚠️ The copy matters as much as the storage here, because both of these are
 * easy to misread as promises:
 *
 *   A top choice is an EXPRESSION OF INTEREST. We try to fit it in. Telling
 *   somebody "you will meet these five" and then not managing it is worse than
 *   never having asked, so nothing on this screen says "will".
 *
 *   A refusal is weighted heavily against, and is NOT sold as an absolute block.
 *   "We will do everything we can to avoid it" is true; "you will never be put
 *   in a room with them" is not something the scheduler can promise.
 *
 * ⛔ An org may not both choose and refuse the same organization — picking one
 * clears the other rather than storing a contradiction for the engine to
 * resolve. It cannot resolve it; only the human can.
 */
export default function MeetingPreferencesEditor({
  conferenceId,
  orgId,
  candidates,
  initialTopChoiceOrgIds,
  initialRefusedOrgIds,
  limit,
}: {
  conferenceId: string;
  orgId: string;
  candidates: PresentOrg[];
  initialTopChoiceOrgIds: string[];
  initialRefusedOrgIds: string[];
  limit: number;
}) {
  const [chosen, setChosen] = useState<string[]>(initialTopChoiceOrgIds);
  const [refused, setRefused] = useState<string[]>(initialRefusedOrgIds);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const atLimit = chosen.length >= limit;

  function toggleChoice(targetOrgId: string) {
    setError(null);
    setSaved(null);
    const next = chosen.includes(targetOrgId)
      ? chosen.filter((id) => id !== targetOrgId)
      : atLimit
        ? chosen
        : [...chosen, targetOrgId];
    if (next === chosen) return;

    // Choosing someone you had refused withdraws the refusal — the alternative
    // is storing "we want to meet them and we refuse to" and asking a solver to
    // decide which one you meant.
    const wasRefused = refused.includes(targetOrgId);
    setChosen(next);
    if (wasRefused) setRefused(refused.filter((id) => id !== targetOrgId));

    startTransition(async () => {
      const result = await saveTopChoices(conferenceId, orgId, next);
      if (!result.success) {
        setChosen(chosen);
        setError(result.error);
        return;
      }
      if (wasRefused) {
        await setRefusal({ declaringOrgId: orgId, refusedOrgId: targetOrgId, refused: false });
      }
      setSaved("Saved");
    });
  }

  function toggleRefusal(targetOrgId: string) {
    setError(null);
    setSaved(null);
    const nowRefused = !refused.includes(targetOrgId);
    const nextRefused = nowRefused
      ? [...refused, targetOrgId]
      : refused.filter((id) => id !== targetOrgId);
    const nextChosen = nowRefused ? chosen.filter((id) => id !== targetOrgId) : chosen;

    setRefused(nextRefused);
    setChosen(nextChosen);

    startTransition(async () => {
      const result = await setRefusal({
        declaringOrgId: orgId,
        refusedOrgId: targetOrgId,
        refused: nowRefused,
      });
      if (!result.success) {
        setRefused(refused);
        setChosen(chosen);
        setError(result.error);
        return;
      }
      if (nowRefused && nextChosen.length !== chosen.length) {
        await saveTopChoices(conferenceId, orgId, nextChosen);
      }
      setSaved("Saved");
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs">
        <span className="font-medium text-gray-700">
          {chosen.length} of {limit} chosen
        </span>
        {isPending ? <span className="text-gray-500">Saving…</span> : null}
        {saved && !isPending ? <span className="text-green-700">{saved}</span> : null}
        {error ? <span className="text-red-700">{error}</span> : null}
      </div>

      <ul className="divide-y divide-gray-200 rounded-md border border-gray-200">
        {candidates.map((org) => {
          const isChosen = chosen.includes(org.id);
          const isRefused = refused.includes(org.id);
          return (
            <li key={org.id} className="flex items-center justify-between gap-4 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">{org.name}</p>
                {org.type ? <p className="text-xs text-gray-500">{org.type}</p> : null}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggleChoice(org.id)}
                  aria-pressed={isChosen}
                  // Disabled only when the list is full AND this one is not in it,
                  // so the button that would remove one is always available.
                  disabled={isPending || (atLimit && !isChosen)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-40 ${
                    isChosen
                      ? "bg-[#163D6D] text-white"
                      : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {isChosen ? "Want to meet" : "Add"}
                </button>

                <button
                  type="button"
                  onClick={() => toggleRefusal(org.id)}
                  aria-pressed={isRefused}
                  disabled={isPending}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-40 ${
                    isRefused
                      ? "bg-red-700 text-white"
                      : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {isRefused ? "Rather not" : "Rather not"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-gray-500">
        &ldquo;Rather not&rdquo; is weighted heavily against when we build the schedule. We
        will do everything we can to avoid it, though we can&apos;t promise it will never
        happen. It stays in place for future conferences until you change it.
      </p>
    </div>
  );
}
