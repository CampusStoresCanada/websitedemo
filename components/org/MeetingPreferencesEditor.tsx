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
 *
 * ⚠️ THE COPY IS SHORT ON PURPOSE. The preamble above the list already says we
 * will try to make the meeting happen if we can. A paragraph underneath
 * explaining that an org without a meeting room cannot be given a meeting is
 * restating the same caveat in more words — Steve: "I can't make the meeting
 * happen with an org that doesn't have a meeting. So, you know, life goes on."
 * The "on the floor only this year" label carries it. Do not re-add the essay.
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
        &ldquo;Rather not&rdquo; weighs heavily against a pairing when we build the
        schedule, and stays in place for future conferences until you change it.
      </p>

    </div>
  );
}
