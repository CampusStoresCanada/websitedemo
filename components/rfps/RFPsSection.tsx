"use client";

import { useState } from "react";
import type { RFPWithContext } from "@/lib/types/rfp";
import { VISIBILITY_LABELS } from "@/lib/types/rfp";
import type { VisibleContact } from "@/lib/visibility/data";
import RFPEditor from "./RFPEditor";
import { getRFPDocumentUrl } from "@/lib/actions/rfp-document";

interface RFPsSectionProps {
  organizationId: string;
  contacts: VisibleContact[];
  initialRFPs: RFPWithContext[];
  canEdit: boolean;
}

function formatDate(iso: string) {
  return new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso.replace(" ", "T") + "Z")
    .toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

function RFPCard({ rfp }: { rfp: RFPWithContext & { document_storage_path?: string | null } }) {
  const [fetching, setFetching] = useState(false);

  async function handleDownload() {
    setFetching(true);
    const result = await getRFPDocumentUrl(rfp.id);
    setFetching(false);
    if (result.url) window.open(result.url, "_blank", "noopener,noreferrer");
  }
  const now = new Date();
  const closes = new Date(rfp.closes_at.endsWith("Z") || rfp.closes_at.includes("+")
    ? rfp.closes_at : rfp.closes_at.replace(" ", "T") + "Z");
  const isExpiredOrClosed = rfp.status === "closed" || closes < now;

  return (
    <div className={`rounded-xl border p-4 space-y-2 ${isExpiredOrClosed ? "border-gray-100 bg-gray-50 opacity-60" : "border-gray-200 bg-white"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#1A1A1A]">{rfp.title}</p>
          <p className="text-xs text-gray-400 mt-0.5">{rfp.category}
            {rfp.subcategories.length > 0 && (
              <span className="ml-1">· {rfp.subcategories.slice(0, 3).join(", ")}{rfp.subcategories.length > 3 ? ` +${rfp.subcategories.length - 3}` : ""}</span>
            )}
          </p>
        </div>
        {!isExpiredOrClosed && (
          <span className="shrink-0 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">
            Open
          </span>
        )}
      </div>

      {rfp.description && (
        <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">{rfp.description}</p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
          <span>Closes {formatDate(rfp.closes_at)}</span>
          <span>·</span>
          <span>{VISIBILITY_LABELS[rfp.visibility]}</span>
          {rfp.contact && (
            <>
              <span>·</span>
              <span>{rfp.contact.name ?? "Contact on file"}</span>
            </>
          )}
        </div>
        {rfp.document_storage_path && (
          <button
            onClick={() => void handleDownload()}
            disabled={fetching}
            className="flex items-center gap-1 text-xs text-[#EE2A2E] hover:text-[#D92327] font-medium transition-colors disabled:opacity-50 shrink-0"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            {fetching ? "Opening…" : "Full RFP"}
          </button>
        )}
      </div>
    </div>
  );
}

export default function RFPsSection({
  organizationId,
  contacts,
  initialRFPs,
  canEdit,
}: RFPsSectionProps) {
  const [rfps, setRFPs] = useState<RFPWithContext[]>(initialRFPs);
  const [showEditor, setShowEditor] = useState(false);

  const now = new Date();
  const activeRFPs = rfps.filter(r => {
    if (r.status === "closed") return false;
    const opens = new Date(r.opens_at.endsWith("Z") || r.opens_at.includes("+")
      ? r.opens_at : r.opens_at.replace(" ", "T") + "Z");
    const closes = new Date(r.closes_at.endsWith("Z") || r.closes_at.includes("+")
      ? r.closes_at : r.closes_at.replace(" ", "T") + "Z");
    return opens <= now && closes > now;
  });

  const hasAnything = rfps.length > 0;

  if (!hasAnything && !canEdit) return null;

  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Open RFPs
        </h3>
        {canEdit && (
          <button
            onClick={() => setShowEditor(true)}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
            </svg>
            Manage
          </button>
        )}
      </div>

      {/* Active RFP cards */}
      {activeRFPs.length > 0 && (
        <div className="space-y-2">
          {activeRFPs.map(rfp => <RFPCard key={rfp.id} rfp={rfp} />)}
        </div>
      )}

      {/* Empty state for editors */}
      {canEdit && !hasAnything && (
        <button
          onClick={() => setShowEditor(true)}
          className="w-full flex items-center justify-center gap-2 px-4 py-4 rounded-xl border-2 border-dashed border-gray-200 text-sm text-gray-400 hover:border-gray-400 hover:text-gray-600 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Post your first RFP
        </button>
      )}

      {/* Editor modal */}
      {showEditor && (
        <RFPEditor
          organizationId={organizationId}
          contacts={contacts}
          initialRFPs={rfps}
          onClose={() => setShowEditor(false)}
          onSaved={(updated) => setRFPs(updated)}
        />
      )}
    </div>
  );
}
