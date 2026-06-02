"use client";

import { useState } from "react";
import Link from "next/link";
import type { RFPWithContext } from "@/lib/types/rfp";
import { useAuth } from "@/components/providers/AuthProvider";
import { getRFPDocumentUrl, requestPublicRFPDocument } from "@/lib/actions/rfp-document";

interface PartnerRFPFeedProps {
  rfps: RFPWithContext[];
}

function formatDate(iso: string) {
  return new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso.replace(" ", "T") + "Z")
    .toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

function daysUntil(iso: string) {
  const closes = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso.replace(" ", "T") + "Z");
  const diff = Math.ceil((closes.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (diff <= 0) return null;
  if (diff === 1) return "Closes tomorrow";
  if (diff <= 7) return `Closes in ${diff} days`;
  return null;
}

function RFPFeedCard({ rfp }: { rfp: RFPWithContext }) {
  const urgency = daysUntil(rfp.closes_at);
  const { user } = useAuth();
  const isPublic = rfp.visibility === "public";
  const hasDoc = !!(rfp as any).document_storage_path;

  const [fetching, setFetching] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);

  // Email gate state (unauthenticated + public RFP only)
  const [showEmailGate, setShowEmailGate] = useState(false);
  const [gateEmail, setGateEmail] = useState("");
  const [gateSending, setGateSending] = useState(false);
  const [gateSent, setGateSent] = useState(false);

  async function handleDownload(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    // Unauthenticated visitor on a public RFP — show email gate
    if (!user && isPublic) {
      setShowEmailGate(true);
      return;
    }

    setFetching(true);
    setDocError(null);
    const result = await getRFPDocumentUrl(rfp.id);
    setFetching(false);
    if (!result.success || !result.url) {
      setDocError(result.error ?? "Could not open document.");
      return;
    }
    window.open(result.url, "_blank", "noopener,noreferrer");
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    setGateSending(true);
    setDocError(null);
    const result = await requestPublicRFPDocument(rfp.id, gateEmail);
    setGateSending(false);
    if (!result.success) {
      setDocError(result.error ?? "Something went wrong.");
      return;
    }
    setGateSent(true);
  }

  return (
    <Link
      href={`/org/${rfp.organization.slug}`}
      className="group block rounded-xl border border-gray-200 bg-white p-4 hover:border-gray-300 hover:shadow-sm transition-all space-y-2"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#1A1A1A] group-hover:text-[#EE2A2E] transition-colors line-clamp-2">
            {rfp.title}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {rfp.organization.name}
            {rfp.organization.province && <span> · {rfp.organization.province}</span>}
          </p>
        </div>
        {urgency && (
          <span className="shrink-0 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-600 border border-amber-200 whitespace-nowrap">
            {urgency}
          </span>
        )}
      </div>

      {rfp.description && (
        <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">{rfp.description}</p>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
        <span>{rfp.category}</span>
        {rfp.subcategories.length > 0 && (
          <>
            <span>·</span>
            <span>{rfp.subcategories.slice(0, 2).join(", ")}{rfp.subcategories.length > 2 ? ` +${rfp.subcategories.length - 2}` : ""}</span>
          </>
        )}
        <span>·</span>
        <span>Closes {formatDate(rfp.closes_at)}</span>
      </div>

      <div className="pt-1 border-t border-gray-100 flex items-center justify-between gap-2">
        {rfp.contact ? (
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs text-gray-500 font-medium truncate">{rfp.contact.name ?? "Contact on file"}</span>
            {rfp.contact.role_title && (
              <span className="text-xs text-gray-400 truncate">· {rfp.contact.role_title}</span>
            )}
          </div>
        ) : <span />}
        {hasDoc && !gateSent && (
          <button
            onClick={handleDownload}
            disabled={fetching}
            className="shrink-0 flex items-center gap-1 text-xs text-[#EE2A2E] hover:text-[#D92327] font-medium transition-colors disabled:opacity-50"
          >
            {fetching ? (
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
            )}
            Full RFP
          </button>
        )}
        {gateSent && (
          <span className="text-xs text-green-600 font-medium shrink-0">Link sent — check your email</span>
        )}
      </div>

      {/* Email gate — public RFP, unauthenticated visitor */}
      {showEmailGate && !gateSent && (
        <form
          onSubmit={handleEmailSubmit}
          onClick={e => e.stopPropagation()}
          className="mt-2 flex gap-2"
        >
          <input
            type="email"
            value={gateEmail}
            onChange={e => setGateEmail(e.target.value)}
            placeholder="your@email.com"
            required
            className="flex-1 px-2.5 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/30 focus:border-[#EE2A2E]"
          />
          <button
            type="submit"
            disabled={gateSending}
            className="px-3 py-1.5 bg-[#EE2A2E] hover:bg-[#D92327] text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-60 shrink-0"
          >
            {gateSending ? "Sending…" : "Send link"}
          </button>
        </form>
      )}
      {docError && <p className="text-xs text-red-500 mt-1">{docError}</p>}
    </Link>
  );
}

export default function PartnerRFPFeed({ rfps }: PartnerRFPFeedProps) {
  if (!rfps.length) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Open RFPs in Your Categories
        </h3>
        <span className="text-xs text-gray-400">{rfps.length} open</span>
      </div>
      <div className="space-y-2">
        {rfps.map(rfp => <RFPFeedCard key={rfp.id} rfp={rfp} />)}
      </div>
    </div>
  );
}
