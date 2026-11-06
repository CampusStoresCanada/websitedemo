"use client";

import { useState } from "react";
import AgreementSheet from "@/components/conference/AgreementSheet";
import { acceptMyAgreements, checkMeIn } from "@/lib/actions/self-check-in";
import type { OwedAgreement } from "@/lib/conference/legal-acceptance";
import {
  selfCheckInOutcomeText,
  selfCheckInRefusalText,
  type SelfCheckInOutcome,
} from "@/lib/conference/self-check-in";

/**
 * "Check me in" on the attendee's own phone. The page above it wrote nothing;
 * this button is the check-in (lib/actions/self-check-in.ts).
 */
export default function SelfCheckInPhone({
  token,
  conferenceName,
  alreadyCheckedIn,
  open,
}: {
  token: string;
  conferenceName: string;
  alreadyCheckedIn: boolean;
  open: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [owed, setOwed] = useState<OwedAgreement[] | null>(null);
  const [done, setDone] = useState<{ outcome: SelfCheckInOutcome; note: string | null } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setProblem(null);
    const res = await checkMeIn({ token });
    setBusy(false);
    if (!res.success) {
      setProblem(res.error);
      return;
    }
    const { state, outcome, note } = res.data;
    if (state === "legal_not_accepted" && res.data.owed.length > 0) {
      setOwed(res.data.owed);
      return;
    }
    if (outcome) {
      setDone({ outcome, note });
      return;
    }
    setProblem(selfCheckInRefusalText(state));
  };

  if (owed) {
    return (
      <AgreementSheet
        personName={null}
        owed={owed}
        notNowLabel="Not now (see the registration desk)"
        onAccept={async (versionIds) => {
          const res = await acceptMyAgreements({ token, versionIds });
          if (!res.success) return res.error;
          setOwed(null);
          await run();
          return null;
        }}
        onNotNow={() => {
          setOwed(null);
          setProblem("You are not checked in yet. Please see the registration desk.");
        }}
      />
    );
  }

  if (done) {
    return (
      <div className="space-y-3">
        <p className="text-lg font-semibold text-emerald-700">You are checked in.</p>
        <p className="text-slate-700">{selfCheckInOutcomeText(done.outcome)}</p>
        {done.note ? <p className="text-slate-600">{done.note}</p> : null}
      </div>
    );
  }

  if (!open) {
    return (
      <p className="text-slate-600">
        You can check in here on the days of {conferenceName}. Until then, there is nothing to do.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-slate-600">
        {alreadyCheckedIn
          ? `You are already checked in to ${conferenceName}. Tap below to see where to pick up your badge.`
          : `Check in to ${conferenceName} when you arrive.`}
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={run}
        className="min-h-14 w-full rounded-xl bg-slate-900 px-5 text-lg font-semibold text-white disabled:opacity-50"
      >
        {busy ? "Checking you in…" : alreadyCheckedIn ? "Show my badge pickup" : "Check me in"}
      </button>
      {problem ? <p className="text-sm text-red-700">{problem}</p> : null}
    </div>
  );
}
