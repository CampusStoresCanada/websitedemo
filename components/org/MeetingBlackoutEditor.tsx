"use client";

import { useState, useTransition } from "react";
import { setRefusal, type PresentOrg } from "@/lib/actions/conference-meeting-preferences";
import OrgChoiceList from "@/components/org/OrgChoiceList";

/**
 * Who you would not meet. Same list, same row, opposite meaning.
 *
 * ⛔ SEPARATE FROM THE TOP FIVE, deliberately. They were briefly one screen with
 * two controls per row, which turns a two-minute job into two jobs and is how
 * the first one stops getting done. Two lists, one question each.
 *
 * ⛔ NO REASON FIELD. "Doesn't matter why" — asking would make people justify
 * something they are entitled to simply decide, and a half-explained reason in a
 * free-text box is worse than no reason at all: it invites someone to weigh it.
 *
 * ⚠️ NO CAP. Five is the shape of a wish list, not of a grievance. An org with
 * eleven vendors it will not sit with gets to say so.
 *
 * ⚠️ A refusal STANDS BEYOND THIS CONFERENCE — org_meeting_refusals is a
 * standing relationship fact with annual reaffirmation, unlike a top choice
 * which is scoped to who is present this year. Ticking one here is not a
 * this-year decision, which is why the note under the list says so.
 */
export default function MeetingBlackoutEditor({
  orgId,
  candidates,
  initialRefusedOrgIds,
}: {
  orgId: string;
  candidates: PresentOrg[];
  initialRefusedOrgIds: string[];
}) {
  const [refused, setRefused] = useState<string[]>(initialRefusedOrgIds);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function toggle(targetOrgId: string) {
    const nowRefused = !refused.includes(targetOrgId);
    const previous = refused;
    setRefused(
      nowRefused ? [...refused, targetOrgId] : refused.filter((id) => id !== targetOrgId)
    );
    setError(null);
    setSaved(false);

    startTransition(async () => {
      const result = await setRefusal({
        declaringOrgId: orgId,
        refusedOrgId: targetOrgId,
        refused: nowRefused,
      });
      if (!result.success) {
        setRefused(previous);
        setError(result.error);
        return;
      }
      setSaved(true);
    });
  }

  // Collapsed by default, same reasoning as the want-to-meet list: the header
  // answers "have I done this?" and the sixty rows stay out of the way.
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-left hover:border-gray-300"
      >
        <span aria-hidden className="text-gray-400">{open ? "▾" : "▸"}</span>
        <span className="text-sm font-medium text-gray-900">Who do you least want to meet?</span>
        <span className="text-xs text-gray-500">({refused.length} selected)</span>
        <span className="ml-auto flex items-center gap-2 text-xs">
          {isPending ? <span className="text-gray-500">Saving…</span> : null}
          {saved && !isPending ? <span className="text-green-700">Saved</span> : null}
          {error ? <span className="text-red-700">{error}</span> : null}
        </span>
      </button>

      {open ? (
      <>

      {/*
        ⛔ Never disabled while saving. Disabling on each write dropped ticks in
        the other list at normal clicking speed — found by clicking it. Each
        refusal is its own row keyed to one org, so overlapping writes touch
        different rows and cannot race.
      */}
      <OrgChoiceList
        orgs={candidates}
        selectedIds={refused}
        onToggle={toggle}
        accentClassName="accent-red-700"
      />

      <p className="text-xs text-gray-500">
        Stays in place for future conferences until you change it.
      </p>
      </>
      ) : null}
    </div>
  );
}
