"use client";

import { useState } from "react";
import Link from "next/link";
import { acceptLegalDocument } from "@/lib/actions/conference-legal";
import { LEGAL_DOCUMENT_LABELS, type LegalDocumentType } from "@/lib/constants/conference";
import type { Database } from "@/lib/database.types";

type LegalVersionRow = Database["public"]["Tables"]["conference_legal_versions"]["Row"];
type LegalAcceptanceRow = Database["public"]["Tables"]["legal_acceptances"]["Row"];

export default function AssigneeAcceptance({
  docs,
  acceptances,
  hubHref,
}: {
  docs: LegalVersionRow[];
  acceptances: LegalAcceptanceRow[];
  hubHref: string;
}) {
  const [acceptedIds, setAcceptedIds] = useState<Set<string>>(
    new Set(acceptances.map((a) => a.legal_version_id))
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allAccepted = docs.every((d) => acceptedIds.has(d.id));

  const accept = async (id: string) => {
    setBusyId(id);
    setError(null);
    const res = await acceptLegalDocument(id);
    setBusyId(null);
    if (res.success) setAcceptedIds((prev) => new Set([...prev, id]));
    else setError(res.error ?? "Couldn't record your acceptance — please try again.");
  };

  if (docs.length === 0 || allAccepted) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
        <p className="text-base font-semibold text-green-800">You&rsquo;re all set 🎉</p>
        <p className="mt-1 text-sm text-green-700">
          {docs.length === 0
            ? "There&rsquo;s nothing for you to accept right now."
            : "All required documents are accepted — you can start participating."}
        </p>
        <Link
          href={hubHref}
          className="mt-4 inline-flex rounded-md bg-[#EE2A2E] px-4 py-2 text-sm font-medium text-white hover:bg-[#b50001]"
        >
          Go to the Conference Hub
        </Link>
      </div>
    );
  }

  const remaining = docs.filter((d) => !acceptedIds.has(d.id)).length;

  return (
    <div className="space-y-4">
      <div className="text-sm text-gray-600">
        {remaining} document{remaining === 1 ? "" : "s"} left to accept before you can participate.
      </div>
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}
      {docs.map((doc) => {
        const accepted = acceptedIds.has(doc.id);
        return (
          <div key={doc.id} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="mb-2 flex items-start justify-between gap-3">
              <h2 className="text-sm font-semibold text-gray-900">
                {LEGAL_DOCUMENT_LABELS[doc.document_type as LegalDocumentType] ?? doc.document_type}
              </h2>
              {accepted && <span className="text-xs font-medium text-green-700">Accepted</span>}
            </div>
            <div
              className="prose prose-sm max-h-48 max-w-none overflow-y-auto text-xs text-gray-600"
              dangerouslySetInnerHTML={{ __html: doc.content }}
            />
            {!accepted && (
              <button
                onClick={() => accept(doc.id)}
                disabled={busyId === doc.id}
                className="mt-3 rounded-md bg-[#EE2A2E] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#b50001] disabled:opacity-50"
              >
                {busyId === doc.id ? "Saving…" : "I accept these terms"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
