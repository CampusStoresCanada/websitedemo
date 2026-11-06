"use client";

import { useState } from "react";
import type { OwedAgreement } from "@/lib/conference/legal-acceptance";
import { LEGAL_DOCUMENT_LABELS, type LegalDocumentType } from "@/lib/constants/conference";

/**
 * The agreements an attendee owes, shown to them on the desk's device before
 * they are checked in. Each one is read and accepted on its own; Continue
 * records them (acceptAgreementsAtDesk at the desk and kiosk, acceptMyAgreements
 * on a phone) and checks them in. Rendered like the
 * attendee welcome page's acceptance (AssigneeAcceptance): the same admin-
 * authored HTML.
 */
export default function AgreementSheet({
  personName,
  owed,
  onAccept,
  onNotNow,
  notNowLabel = "Not now (hand the device back to staff)",
}: {
  personName: string | null;
  owed: OwedAgreement[];
  onAccept: (versionIds: string[]) => Promise<string | null>;
  onNotNow: () => void;
  /** Where "not now" leaves them: the desk hands the device back; a phone sends them to the desk. */
  notNowLabel?: string;
}) {
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allAccepted = owed.every((doc) => accepted.has(doc.versionId));
  return (
    <div className="fixed inset-0 z-[95] overflow-y-auto bg-white px-5 py-8 text-gray-900">
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <div>
          <p className="text-2xl font-bold">{personName ? `${personName}, before your badge` : "Before your badge"}</p>
          <p className="mt-1 text-base text-gray-600">
            Please read and accept {owed.length === 1 ? "this agreement" : "these agreements"} for the conference.
          </p>
        </div>
        {owed.map((doc) => {
          const done = accepted.has(doc.versionId);
          return (
            <section key={doc.versionId} className="rounded-xl border border-gray-200 p-4">
              <h2 className="text-lg font-semibold">
                {LEGAL_DOCUMENT_LABELS[doc.documentType as LegalDocumentType] ?? doc.documentType}
              </h2>
              <div
                className="prose prose-sm mt-2 max-h-72 max-w-none overflow-y-auto text-sm text-gray-700"
                // Admin-authored agreement text, as the welcome page renders it.
                dangerouslySetInnerHTML={{ __html: doc.content }}
              />
              <button
                type="button"
                disabled={done}
                onClick={() => setAccepted((prev) => new Set([...prev, doc.versionId]))}
                className={`mt-3 min-h-12 w-full rounded-lg px-4 text-base font-semibold ${
                  done ? "bg-emerald-100 text-emerald-800" : "bg-gray-900 text-white"
                }`}
              >
                {done ? "✓ Accepted" : "I accept"}
              </button>
            </section>
          );
        })}
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <button
          type="button"
          disabled={!allAccepted || busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const problem = await onAccept([...accepted]);
            if (problem) {
              setError(problem);
              setBusy(false);
            }
          }}
          className="min-h-14 w-full rounded-xl bg-emerald-500 px-5 text-lg font-bold text-black disabled:opacity-40"
        >
          {busy ? "…" : allAccepted ? "Continue to my badge" : "Accept each agreement to continue"}
        </button>
        <button type="button" onClick={onNotNow} className="w-full text-center text-sm text-gray-500 underline">
          {notNowLabel}
        </button>
      </div>
    </div>
  );
}
