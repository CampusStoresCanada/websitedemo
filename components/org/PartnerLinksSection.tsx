"use client";

import { useState } from "react";
import type { ResolvedPartnerLink, PartnerLink, PartnerLinkType } from "@/lib/partner-links";
import { LINK_TYPE_LABELS } from "@/lib/partner-links";
import type { ViewerLevel } from "@/lib/visibility/defaults";
import { hadPriorSession } from "@/lib/auth/persona-cookie";
import PartnerLinksEditor from "./PartnerLinksEditor";

// ---------------------------------------------------------------------------
// Link type icons (inline SVG, no external dep)
// ---------------------------------------------------------------------------

function LinkIcon({ type }: { type: PartnerLinkType }) {
  switch (type) {
    case "catalogue":
      return (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      );
    case "price_list":
      return (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case "order_portal":
      return (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
        </svg>
      );
    case "line_sheet":
      return (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
        </svg>
      );
    default:
      return (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
        </svg>
      );
  }
}

// ---------------------------------------------------------------------------
// Gated content placeholder
// ---------------------------------------------------------------------------

function GatedPlaceholder({
  viewerLevel,
  primaryColor,
}: {
  viewerLevel: ViewerLevel;
  primaryColor: string;
}) {
  // Detect if user has previously resolved to an identity via a persistent
  // cookie, so we can distinguish "signed out known user" from "never signed in".
  const hadSession = hadPriorSession();

  if (viewerLevel === "partner") {
    return (
      <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-5 py-4 text-center">
        <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-2">
          <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </div>
        <p className="text-sm font-medium text-gray-600">Member-oriented content</p>
        <p className="text-xs text-gray-400 mt-0.5">
          Price lists and catalogues are shared with member stores only.
        </p>
      </div>
    );
  }

  // Public / unauthenticated
  return (
    <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-5 py-4 text-center">
      <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-2">
        <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
        </svg>
      </div>
      {hadSession ? (
        <>
          <p className="text-sm font-medium text-gray-600">Sign in to see more</p>
          <p className="text-xs text-gray-400 mt-0.5 mb-3">
            Catalogues and price lists are available to members.
          </p>
          <a
            href="/login"
            className="inline-block px-4 py-1.5 rounded-full text-xs font-semibold text-white transition-all hover:opacity-90"
            style={{ backgroundColor: primaryColor }}
          >
            Log in
          </a>
        </>
      ) : (
        <>
          <p className="text-sm font-medium text-gray-600">More available for members</p>
          <p className="text-xs text-gray-400 mt-0.5 mb-3">
            Catalogues, price lists, and order portals are shared with CSC member stores.
          </p>
          <a
            href="/join"
            className="inline-block px-4 py-1.5 rounded-full text-xs font-semibold text-white transition-all hover:opacity-90"
            style={{ backgroundColor: primaryColor }}
          >
            Become a member
          </a>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single link row
// ---------------------------------------------------------------------------

function LinkRow({ link, primaryColor }: { link: ResolvedPartnerLink; primaryColor: string }) {
  const [opening, setOpening] = useState(false);

  const handleOpen = () => {
    if (link.isDocument) {
      setOpening(true);
      // Open in new tab; browser handles PDF rendering
      window.open(link.href, "_blank", "noopener,noreferrer");
      setTimeout(() => setOpening(false), 1500);
    } else {
      window.open(link.href, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <button
      onClick={handleOpen}
      disabled={opening}
      className="group w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-100 bg-white hover:border-gray-200 hover:shadow-sm transition-all text-left disabled:opacity-70"
    >
      <span
        className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-white transition-opacity"
        style={{ backgroundColor: primaryColor }}
      >
        <LinkIcon type={link.type} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[#1A1A1A] truncate">{link.label}</p>
        <p className="text-xs text-gray-400">{LINK_TYPE_LABELS[link.type]}</p>
      </div>
      <span className="flex-shrink-0 text-gray-300 group-hover:text-gray-500 transition-colors">
        {link.isDocument ? (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
          </svg>
        )}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main section component
// ---------------------------------------------------------------------------

interface PartnerLinksSectionProps {
  orgId: string;
  orgName: string;
  primaryColor: string;
  viewerLevel: ViewerLevel;
  /** Pre-resolved visible links (signed URLs generated server-side) */
  visibleLinks: ResolvedPartnerLink[];
  /** Are there links the viewer can't see? */
  hasGated: boolean;
  /** Raw links for org admins to manage (only passed when viewer can edit) */
  rawLinks?: PartnerLink[];
  canEdit: boolean;
}

export default function PartnerLinksSection({
  orgId,
  orgName,
  primaryColor,
  viewerLevel,
  visibleLinks,
  hasGated,
  rawLinks,
  canEdit,
}: PartnerLinksSectionProps) {
  const [showEditor, setShowEditor] = useState(false);
  const [optimisticLinks, setOptimisticLinks] = useState<PartnerLink[] | null>(null);

  // After editor saves, we can't re-resolve server-side without a reload.
  // Show a "refresh to see changes" nudge for now — signed URLs require server render.
  const [savedSinceLoad, setSavedSinceLoad] = useState(false);

  const hasAnything = visibleLinks.length > 0 || hasGated;

  // If there's nothing to show and the viewer can't edit, render nothing
  if (!hasAnything && !canEdit) return null;

  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Links &amp; Documents
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

      {/* Visible links */}
      {visibleLinks.length > 0 && (
        <div className="space-y-2">
          {visibleLinks.map((link) => (
            <LinkRow key={link.id} link={link} primaryColor={primaryColor} />
          ))}
        </div>
      )}

      {/* Gated placeholder */}
      {hasGated && (
        <GatedPlaceholder viewerLevel={viewerLevel} primaryColor={primaryColor} />
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
          Add catalogues, price lists &amp; portals
        </button>
      )}

      {/* Refresh nudge after editor save */}
      {savedSinceLoad && (
        <p className="text-xs text-gray-400 text-center">
          Reload the page to see the updated list.
        </p>
      )}

      {/* Editor modal */}
      {showEditor && (
        <PartnerLinksEditor
          orgId={orgId}
          orgName={orgName}
          initialLinks={optimisticLinks ?? rawLinks ?? []}
          primaryColor={primaryColor}
          onClose={() => setShowEditor(false)}
          onSaved={(links) => {
            setOptimisticLinks(links);
            setSavedSinceLoad(true);
          }}
        />
      )}
    </div>
  );
}
