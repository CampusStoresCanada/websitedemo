"use client";

import { useState, useTransition } from "react";
import { setMyRefusal, type PresentOrg } from "@/lib/actions/conference-meeting-preferences";
import OrgChoiceList from "@/components/org/OrgChoiceList";

/**
 * A delegate's own blackout. Same list, same row, opposite meaning to the five.
 *
 * ⛔ MINE, NOT MY COMPANY'S. This writes a person-grain row, so it binds this
 * one seat: a colleague may still want that meeting, my employer has refused
 * nothing, and the vendor has not refused us. The org-level list on the org page
 * is a different statement made by a different subject, and my org's admins can
 * neither see nor untick this one.
 *
 * ⛔ NO REASON FIELD. "Doesn't matter why" — asking makes people justify
 * something they are entitled to simply decide, and a half-explained reason
 * invites someone to weigh it.
 *
 * ⚠️ NO CAP. Five is the shape of a wish list, not of a grievance.
 *
 * ⚠️ It STANDS BEYOND THIS CONFERENCE — org_meeting_refusals is a standing fact
 * with annual reaffirmation, not a this-year pick. The note under the list says
 * so, because ticking a box that quietly becomes permanent is a trap.
 */
export default function MyBlackoutEditor({
  conferenceId,
  candidates,
  initialRefusedOrgIds,
}: {
  conferenceId: string;
  candidates: PresentOrg[];
  initialRefusedOrgIds: string[];
}) {
  const [refused, setRefused] = useState<string[]>(initialRefusedOrgIds);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
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
      const result = await setMyRefusal({
        conferenceId,
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

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs">
        <span className="font-medium text-gray-700">{refused.length} selected</span>
        {isPending ? <span className="text-gray-500">Saving…</span> : null}
        {saved && !isPending ? <span className="text-green-700">Saved</span> : null}
        {error ? <span className="text-red-700">{error}</span> : null}
      </div>

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
    </div>
  );
}
