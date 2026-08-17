"use client";

import { useState, useEffect, useCallback, useMemo, useRef, createContext, useContext, ReactNode } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { hasPermission } from "@/lib/auth/permissions";
import { isOrgAccessActive } from "@/lib/membership/status";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import CreateEventModal from "@/components/toolkit/CreateEventModal";
import { submitFlag } from "@/lib/actions/submit-flag";
import { updateField } from "@/lib/actions/update-field";
import { addBookmark, removeBookmark, getUserBookmarks, updateBookmarkNote, isBookmarked as checkIsBookmarked, type Bookmark } from "@/lib/actions/bookmarks";
import { createShareLink, getMyShareLinks, deleteShareLink, type ShareLink } from "@/lib/actions/share-links";
import { captureAndCreateSnapshot, shareInternally, searchMembersForShare, type MemberSearchResult } from "@/lib/actions/snapshots";
import { submitExplainRequest } from "@/lib/actions/explain-requests";
import { detectPageContext } from "@/lib/utils/page-context";
import { findElementBySelector, findElementByText } from "@/lib/utils/dom-highlight";
import { exportOrgContacts, exportOrgInfo, exportEventICS, exportEventAttendees, canExportEventAttendees, exportMembersDirectory, exportPartnersDirectory, exportMemberBuyersCSV, exportPartnerMarketCSV, exportFullMemberDirectoryCSV } from "@/lib/actions/export-page";
import { checkNudgeCooldown, notifyMembersWithoutProcurement } from "@/lib/actions/partner-market";
import { peekReviewToken, consumeReviewToken } from "@/lib/actions/content-change-tokens";
import { approvePendingChange, rejectPendingChange } from "@/lib/actions/pending-content-changes";
import type { PendingContentChange } from "@/lib/types/db";
import { deleteContact } from "@/lib/actions/delete-contact";
import ContactEditModal from "@/components/org/ContactEditModal";
import { addBrandColor } from "@/lib/actions/add-brand-color";
import { deleteBrandColor } from "@/lib/actions/delete-brand-color";
import { uploadOrganizationImage } from "@/lib/actions/upload-organization-image";
import ImageUploadModal, { type OrgImageType } from "@/components/ui/ImageUploadModal";

// Context to expose edit mode to child components
interface ToolkitContextValue {
  editMode: boolean;
  isAdmin: boolean;
  canEditOrg: (orgId: string) => boolean;
  setEditMode: (mode: boolean) => void;
}

const ToolkitContext = createContext<ToolkitContextValue>({
  editMode: false,
  isAdmin: false,
  canEditOrg: () => false,
  setEditMode: () => {},
});

export function useToolkit() {
  return useContext(ToolkitContext);
}

/**
 * ToolkitProvider - Wraps the app to provide edit mode context
 * This must wrap the page content so child components can access editMode
 */
export function ToolkitProvider({ children }: { children: ReactNode }) {
  const { profile, organizations } = useAuth();
  const [editMode, setEditMode] = useState(false);

  // Global admins can edit any organization.
  const isGlobalAdmin = profile?.global_role === "super_admin" || profile?.global_role === "admin";

  // Get org IDs where user is org_admin
  const orgAdminOrgIds = useMemo(
    () =>
      organizations
        // A lapsed org's own admin loses edit-mode (logo, brand colors,
        // contacts) on their own page — same rule as the masking layer.
        ?.filter((uo) => uo.role === "org_admin" && isOrgAccessActive(uo.organization.membership_status ?? null))
        ?.map((uo) => uo.organization.id) ?? [],
    [organizations]
  );

  // Function to check if user can edit a specific org
  const canEditOrg = useCallback((orgId: string): boolean => {
    return isGlobalAdmin || orgAdminOrgIds.includes(orgId);
  }, [isGlobalAdmin, orgAdminOrgIds]);

  // User can see Edit tool if they're super_admin OR org_admin for any org
  const isAdmin = isGlobalAdmin || orgAdminOrgIds.length > 0;

  return (
    <ToolkitContext.Provider value={{ editMode, isAdmin, canEditOrg, setEditMode }}>
      {children}
    </ToolkitContext.Provider>
  );
}

/**
 * Global Toolkit - A floating action button with context-aware tools.
 * Available to all logged-in users across the site.
 *
 * Tools:
 * - Flag: "I don't think this is right" - click on element to flag it
 * - Explain: "Help me understand" - summon someone to clarify (future)
 * - Share: Share internally to other CSC users (future)
 * - Export: Export allowed data (events, pages, not personal info) (future)
 * - Bookmark: Save to internal favorites (future)
 */
export default function Toolkit({ googleMapsApiKey = null }: { googleMapsApiKey?: string | null }) {
  const { user, profile, permissionState, organizations } = useAuth();
  const { editMode, setEditMode, isAdmin, canEditOrg } = useToolkit();
  const isPartnerViewing = !!user && hasPermission(permissionState, "partner") && !hasPermission(permissionState, "member");
  const partnerOwnOrgSlugs = organizations
    .filter(uo => uo.organization?.type === "Vendor Partner" && uo.role === "org_admin")
    .map(uo => uo.organization?.slug)
    .filter(Boolean) as string[];
  const pathname = usePathname();
  // Printable, single-document pages (e.g. the business-case one-pager) skip the
  // element-picker and share the whole page by default, plus get a
  // "Print / Save as PDF" action inside the Share modal instead of a bespoke
  // per-page button.
  const isPrintablePage = /\/business-case\/?$/.test(pathname);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Users eligible to create events (not partner, not unauthenticated)
  const canCreateEvent =
    !!user &&
    !!profile &&
    !["partner"].includes(profile.global_role ?? "");

  // Detect if we're on an org profile page where the current user is the org_admin
  const context = detectPageContext(pathname);
  const orgAdminSlug = useMemo(() => {
    if (context.type !== "org") return null;
    const match = (organizations ?? []).find(
      (uo) => uo.role === "org_admin" && uo.organization.slug === context.slug
    );
    return match ? context.slug : null;
  }, [context, organizations]);
  const [isExpanded, setIsExpanded] = useState(false);

  // Onboarding — highlight a specific tool button when guided tour requests it
  const [onboardingHighlight, setOnboardingHighlight] = useState<string | null>(null);

  useEffect(() => {
    function onHighlightTool(e: Event) {
      const { tool } = (e as CustomEvent<{ tool: string }>).detail;
      setOnboardingHighlight(tool);
    }
    window.addEventListener("csc:onboarding:highlight-edit", onHighlightTool);
    return () => window.removeEventListener("csc:onboarding:highlight-edit", onHighlightTool);
  }, []);

  // Review mode — activated when ?review_token= is present in the URL
  const [reviewChange, setReviewChange] = useState<PendingContentChange | null>(null);
  const [reviewToken, setReviewToken] = useState<string | null>(null);
  const [reviewTokenState, setReviewTokenState] = useState<"idle" | "loading" | "invalid" | "ready">("idle");
  const [reviewError, setReviewError] = useState<string | null>(null);

  useEffect(() => {
    const token = searchParams.get("review_token");
    if (!token || !isAdmin) return;

    setReviewTokenState("loading");
    peekReviewToken(token).then((result) => {
      if (result.valid && result.change) {
        setReviewChange(result.change);
        setReviewToken(token);
        setReviewTokenState("ready");
        // Scroll to the anchor element
        if (result.change.anchor_id) {
          setTimeout(() => {
            document.getElementById(result.change!.anchor_id!)?.scrollIntoView({
              behavior: "smooth",
              block: "center",
            });
          }, 300);
        }
      } else {
        const msgs: Record<string, string> = {
          used: "This review link has already been used.",
          expired: "This review link has expired.",
          change_not_pending: "This change has already been actioned.",
          not_found: "Review link not found.",
        };
        setReviewError(msgs[result.reason ?? "not_found"] ?? "Invalid review link.");
        setReviewTokenState("invalid");
      }
    }).catch(() => {
      setReviewError("Failed to validate review link.");
      setReviewTokenState("invalid");
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [activeTool, setActiveTool] = useState<"flag" | "edit" | "explain" | "share" | "export" | "bookmark" | "create_event" | null>(null);

  // Flag selection mode state
  const [flagMode, setFlagMode] = useState(false);
  const [hoveredElement, setHoveredElement] = useState<HTMLElement | null>(null);
  const [selectedElement, setSelectedElement] = useState<{
    text: string;
    selector: string;
    rect: DOMRect;
    orgId?: string;
  } | null>(null);

  // Explain selection mode state
  const [explainMode, setExplainMode] = useState(false);
  const [explainHoveredElement, setExplainHoveredElement] = useState<HTMLElement | null>(null);
  const [explainSelectedElement, setExplainSelectedElement] = useState<{
    text: string;
    selector: string;
    rect: DOMRect;
    orgId?: string;
    endSelector?: string;
  } | null>(null);

  // Share selection mode state
  const [shareMode, setShareMode] = useState(false);
  const [shareHoveredElement, setShareHoveredElement] = useState<HTMLElement | null>(null);
  const [shareSelectedElement, setShareSelectedElement] = useState<{
    text: string;
    selector: string;
    endSelector?: string;
  } | null>(null);

  // Bookmark selection mode state
  const [bookmarkMode, setBookmarkMode] = useState(false);
  const [bookmarkHoveredElement, setBookmarkHoveredElement] = useState<HTMLElement | null>(null);
  const [bookmarkSelectedElement, setBookmarkSelectedElement] = useState<{
    text: string;
    selector: string;
    endSelector?: string;
  } | null>(null);
  const [isCurrentPageBookmarked, setIsCurrentPageBookmarked] = useState(false);

  // Edit selection mode state
  const [editHoveredElement, setEditHoveredElement] = useState<HTMLElement | null>(null);
  const [editSelectedElement, setEditSelectedElement] = useState<{
    text: string;
    field: string;
    entityId: string;
    rect: DOMRect;
    isRowAction?: boolean; // True when clicking a row without specific field (for delete)
    isAddAction?: boolean; // True when clicking "add contact" row
    isAddColorAction?: boolean; // True when clicking "add color" button
    isDeleteColorAction?: boolean; // True when clicking color delete button
    isImageField?: boolean; // True when clicking an image field (hero_image_url, logo_url, etc.)
    colorType?: 'primary' | 'secondary'; // For add color action
    organizationId?: string; // For add contact/color action
    conferenceId?: string;
  } | null>(null);

  // Check bookmark status for current page
  useEffect(() => {
    if (!user) return;
    checkIsBookmarked(pathname).then(setIsCurrentPageBookmarked);
  }, [pathname, user]);

  // Non-logged-in users: no account to power Flag/Edit/Bookmark/Send-to-member,
  // so business-case pages get a standalone Print FAB instead of the full
  // toolkit — this is the one action a director with no CSC account still needs.
  if (!user) {
    if (isPrintablePage) {
      return (
        <button
          onClick={() => window.print()}
          className="fixed bottom-6 right-6 z-50 print:hidden px-5 py-3 bg-[#1A1A1A] hover:bg-gray-800 text-white text-sm font-semibold rounded-full shadow-lg hover:shadow-xl transition-all flex items-center gap-2"
        >
          <PrintIcon className="w-4 h-4" />
          Print / Save as PDF
        </button>
      );
    }
    const showJoinPages = ["/", "/members", "/partners"];
    if (!showJoinPages.includes(pathname)) return null;
    return (
      <a
        href="/membership"
        className="fixed bottom-6 right-6 z-50 px-5 py-3 bg-[#EE2A2E] hover:bg-[#D92327] text-white text-sm font-semibold rounded-full shadow-lg hover:shadow-xl transition-all flex items-center gap-2"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
        </svg>
        Join CSC
      </a>
    );
  }

  const handleToolClick = (tool: typeof activeTool) => {
    if (tool === "flag") {
      // Enter flag selection mode
      setFlagMode(true);
      setIsExpanded(false);
      return;
    }
    if (tool === "edit") {
      // Enter edit selection mode
      setEditMode(true);
      setIsExpanded(false);
      setOnboardingHighlight(null);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("csc:edit-mode-changed", { detail: { active: true } }));
      }
      return;
    }
    if (tool === "explain") {
      // Enter explain selection mode
      setExplainMode(true);
      setIsExpanded(false);
      return;
    }
    if (tool === "share") {
      if (isPrintablePage) {
        // Single cohesive document — skip the element-picker and go straight
        // to sharing the whole page.
        setShareSelectedElement(null);
        setActiveTool("share");
        setIsExpanded(false);
        return;
      }
      // Enter share selection mode (pick-first, like flag/explain)
      setShareMode(true);
      setShareSelectedElement(null);
      setIsExpanded(false);
      return;
    }
    if (tool === "bookmark") {
      if (isCurrentPageBookmarked) {
        // Already bookmarked — open modal directly to manage it
        setActiveTool("bookmark");
        setIsExpanded(false);
      } else {
        // Not bookmarked — enter pick-first selection mode
        setBookmarkMode(true);
        setBookmarkSelectedElement(null);
        setIsExpanded(false);
      }
      return;
    }
    setActiveTool(tool);
    setIsExpanded(false);
  };

  const handleClose = () => {
    setActiveTool(null);
    setFlagMode(false);
    setEditMode(false);
    setExplainMode(false);
    setSelectedElement(null);
    setHoveredElement(null);
    setEditSelectedElement(null);
    setEditHoveredElement(null);
    setExplainSelectedElement(null);
    setExplainHoveredElement(null);
    setShareMode(false);
    setShareSelectedElement(null);
    setShareHoveredElement(null);
    setBookmarkMode(false);
    setBookmarkSelectedElement(null);
    setBookmarkHoveredElement(null);
  };

  const handleEditSuccess = () => {
    // Refresh the page to show updated data
    router.refresh();
    handleClose();
  };

  return (
    <>
      {/* Flag Selection Mode Overlay */}
      {flagMode && !selectedElement && (
        <FlagSelectionOverlay
          onSelect={(element) => setSelectedElement(element)}
          onCancel={handleClose}
          hoveredElement={hoveredElement}
          setHoveredElement={setHoveredElement}
        />
      )}

      {/* Flag Confirmation Popover (after selecting an element) */}
      {flagMode && selectedElement && (
        <FlagConfirmationPopover
          selectedElement={selectedElement}
          pathname={pathname}
          onClose={handleClose}
          onBack={() => setSelectedElement(null)}
        />
      )}

      {/* Edit Selection Mode Overlay */}
      {editMode && !editSelectedElement && (
        <EditSelectionOverlay
          onSelect={(element) => setEditSelectedElement(element)}
          onCancel={handleClose}
          hoveredElement={editHoveredElement}
          setHoveredElement={setEditHoveredElement}
          canEditOrg={canEditOrg}
        />
      )}

      {/* Edit Confirmation Popover (after selecting an element) */}
      {editMode && editSelectedElement && (
        <EditConfirmationPopover
          selectedElement={editSelectedElement}
          onClose={handleClose}
          onSuccess={handleEditSuccess}
          onBack={() => setEditSelectedElement(null)}
        />
      )}

      {/* Explain Selection Mode Overlay */}
      {explainMode && !explainSelectedElement && (
        <ExplainSelectionOverlay
          onSelect={(element) => setExplainSelectedElement(element)}
          onCancel={handleClose}
          hoveredElement={explainHoveredElement}
          setHoveredElement={setExplainHoveredElement}
        />
      )}

      {/* Explain Confirmation Popover */}
      {explainMode && explainSelectedElement && (
        <ExplainConfirmationPopover
          selectedElement={explainSelectedElement}
          pathname={pathname}
          onClose={handleClose}
          onBack={() => setExplainSelectedElement(null)}
        />
      )}

      {/* Bookmark Selection Mode Overlay */}
      {bookmarkMode && (
        <BookmarkSelectionOverlay
          onSelect={(element) => {
            setBookmarkSelectedElement({ text: element.text, selector: element.selector, endSelector: element.endSelector });
            setBookmarkMode(false);
            setActiveTool("bookmark");
          }}
          onSkip={() => {
            setBookmarkSelectedElement(null);
            setBookmarkMode(false);
            setActiveTool("bookmark");
          }}
          onCancel={handleClose}
          hoveredElement={bookmarkHoveredElement}
          setHoveredElement={setBookmarkHoveredElement}
        />
      )}

      {/* Share Selection Mode Overlay */}
      {shareMode && (
        <ShareSelectionOverlay
          onSelect={(element) => {
            setShareSelectedElement({ text: element.text, selector: element.selector, endSelector: element.endSelector });
            setShareMode(false);
            setActiveTool("share");
          }}
          onSkip={() => {
            setShareSelectedElement(null);
            setShareMode(false);
            setActiveTool("share");
          }}
          onCancel={handleClose}
          hoveredElement={shareHoveredElement}
          setHoveredElement={setShareHoveredElement}
        />
      )}

      {/* Review mode — second-signer approval overlay */}
      {reviewTokenState === "ready" && reviewChange && reviewToken && (
        <ReviewOverlay
          change={reviewChange}
          rawToken={reviewToken}
          onApproved={() => {
            setReviewChange(null);
            setReviewTokenState("idle");
            router.refresh();
          }}
          onRejected={() => {
            setReviewChange(null);
            setReviewTokenState("idle");
          }}
        />
      )}

      {/* Invalid review token banner */}
      {reviewTokenState === "invalid" && reviewError && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[70] bg-amber-50 border border-amber-300 text-amber-800 text-sm px-4 py-3 rounded-lg shadow-lg flex items-center gap-3">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          {reviewError}
          <button onClick={() => setReviewTokenState("idle")} className="ml-2 text-amber-600 hover:text-amber-800">✕</button>
        </div>
      )}

      {/* Floating Toolkit Button */}
      <div className="fixed bottom-8 right-8 z-40 flex flex-col-reverse items-center gap-2 w-12 print:hidden">
        {/* Tool buttons (shown when expanded) */}
        {isExpanded && !flagMode && !editMode && !explainMode && !shareMode && !bookmarkMode && (
          <div className="absolute bottom-14 right-0 flex flex-col items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
            {/* Bookmark */}
            <ToolButton
              icon={<BookmarkIcon filled={isCurrentPageBookmarked} />}
              label={isCurrentPageBookmarked ? "Manage bookmarks" : "Bookmark"}
              onClick={() => handleToolClick("bookmark")}
            />

            {/* Export */}
            <ToolButton
              icon={<ExportIcon />}
              label="Export"
              onClick={() => handleToolClick("export")}
            />

            {/* Share */}
            <ToolButton
              icon={<ShareIcon />}
              label="Share"
              onClick={() => handleToolClick("share")}
            />

            {/* Explain */}
            <ToolButton
              icon={<ExplainIcon />}
              label="Explain"
              onClick={() => handleToolClick("explain")}
            />

            {/*
             * TODO (post-launch): Fold org-admin management into Edit mode on the org profile page.
             *
             * One feature still lives at a standalone page but belongs inline in Edit mode:
             *
             * 1. MANAGE TEAM — /org/[slug]/admin/users
             *    A table of all org members with roles + statuses. Should become a "Manage Team"
             *    section inside Edit mode, visible only to org_admin / super_admin.
             *    Inline role/status editing per row; invite via InviteUserDialog.
             *    Components: app/org/[slug]/admin/users/page.tsx, OrgUserTable, InviteUserDialog
             *
             * 2. TRANSFER ADMIN — DONE. Retired /org/[slug]/admin/transfer and moved it onto the
             *    org profile: an Admin column in the people table grants/revokes co-admins
             *    immediately, and "Hand over admin" beneath it runs the unchanged
             *    admin_transfer_requests ceremony (accept + timeout) for handing over sole control.
             *    Components: components/org/OrgAdminAssignment.tsx, AdminTransferFlow
             *    Cron: app/api/cron/admin-transfer-timeout/route.ts
             */}

            {/* Edit - Only for admins */}
            {isAdmin && (
              <ToolButton
                icon={<EditIcon />}
                label="Edit"
                onClick={() => handleToolClick("edit")}
                highlighted={onboardingHighlight === "edit"}
              />
            )}

            {/* Create Event - authenticated non-partner users */}
            {canCreateEvent && (
              <ToolButton
                icon={<CalendarPlusIcon />}
                label="Create Event"
                onClick={() => handleToolClick("create_event")}
              />
            )}

            {/* Flag */}
            <ToolButton
              icon={<FlagIcon />}
              label="Flag"
              onClick={() => handleToolClick("flag")}
            />
          </div>
        )}

        {/* Main FAB - changes to cancel button when in selection mode */}
        {flagMode || editMode || explainMode || shareMode || bookmarkMode ? (
          <button
            onClick={handleClose}
            className={`w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-105 ${
              editMode ? "bg-emerald-500 hover:bg-emerald-600"
              : explainMode ? "bg-blue-500 hover:bg-blue-600"
              : shareMode ? "bg-violet-500 hover:bg-violet-600"
              : bookmarkMode ? "bg-yellow-500 hover:bg-yellow-600"
              : "bg-red-500 hover:bg-red-600"
            } text-white`}
            title={editMode ? "Cancel editing" : explainMode ? "Cancel explain" : shareMode ? "Cancel selection" : bookmarkMode ? "Cancel bookmark" : "Cancel flagging"}
          >
            <CloseIcon />
          </button>
        ) : (
          <button
            data-toolkit-fab
            onClick={() => setIsExpanded(!isExpanded)}
            className={`w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-105 ${
              isExpanded
                ? "bg-gray-600 hover:bg-gray-700 text-white"
                : "bg-gray-700 hover:bg-gray-800 text-white"
            }`}
            title={isExpanded ? "Close toolkit" : "Open toolkit"}
          >
            <div className={`transition-transform duration-200 ${isExpanded ? "rotate-45" : ""}`}>
              <PlusIcon />
            </div>
          </button>
        )}
      </div>

      {/* Tool Modals */}
      {activeTool === "bookmark" && (
        <BookmarkModal
          pathname={pathname}
          onClose={handleClose}
          selectedElement={bookmarkSelectedElement}
          onClearSelectedElement={() => setBookmarkSelectedElement(null)}
          onBookmarkChange={(bookmarked) => setIsCurrentPageBookmarked(bookmarked)}
        />
      )}

      {activeTool === "export" && (
        <ExportModal
          pathname={pathname}
          onClose={handleClose}
          isPartner={isPartnerViewing}
          partnerOwnOrgSlugs={partnerOwnOrgSlugs}
        />
      )}

      {activeTool === "share" && (
        <ShareModal
          pathname={pathname}
          onClose={handleClose}
          selectedElement={shareSelectedElement}
          onClearSelectedElement={() => setShareSelectedElement(null)}
          defaultTab={shareSelectedElement ? "internal" : "external"}
          showPrintOption={isPrintablePage}
        />
      )}

      {activeTool === "create_event" && (
        <CreateEventModal onClose={handleClose} googleMapsApiKey={googleMapsApiKey} />
      )}
    </>
  );
}

/**
 * Individual tool button in the expanded toolkit
 */
function ToolButton({
  icon,
  label,
  onClick,
  disabled = false,
  highlighted = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  highlighted?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-10 h-10 rounded-full shadow-lg flex items-center justify-center transition-all group relative ${
        disabled
          ? "bg-gray-200 text-gray-400 cursor-not-allowed"
          : "bg-white hover:bg-gray-50 text-gray-600 hover:scale-105"
      } ${highlighted ? "ring-2 ring-[#EE2A2E] ring-offset-2 animate-pulse" : ""}`}
      title={label}
    >
      {icon}
      <span className="absolute right-full mr-3 px-2 py-1 bg-gray-900 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        {label}
        {disabled && " (Coming soon)"}
      </span>
    </button>
  );
}

/**
 * Flag Selection Overlay - Click or drag to flag a data-flaggable element.
 * Flag is always single-element; dragging picks the best-covered flaggable
 * element within the drawn rect (largest intersection area).
 */
function FlagSelectionOverlay({
  onSelect,
  onCancel,
  hoveredElement,
  setHoveredElement,
}: {
  onSelect: (element: { text: string; selector: string; rect: DOMRect; orgId?: string }) => void;
  onCancel: () => void;
  hoveredElement: HTMLElement | null;
  setHoveredElement: (el: HTMLElement | null) => void;
}) {
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);
  const hoveredElementRef = useRef<HTMLElement | null>(null);
  const [dragRect, setDragRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const DRAG_THRESHOLD = 6;

  useEffect(() => { hoveredElementRef.current = hoveredElement; }, [hoveredElement]);

  // Hover detection — only flaggable elements light up
  useEffect(() => {
    const findFlaggableElement = (target: HTMLElement): HTMLElement | null => {
      if (target.hasAttribute("data-flaggable")) return target;
      return target.closest("[data-flaggable]") as HTMLElement | null;
    };
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingRef.current) return;
      const target = e.target as HTMLElement;
      if (target.closest("[data-toolkit]") || target.closest("[data-flag-overlay]")) {
        setHoveredElement(null);
        return;
      }
      setHoveredElement(findFlaggableElement(target));
    };
    document.addEventListener("mousemove", handleMouseMove);
    return () => document.removeEventListener("mousemove", handleMouseMove);
  }, [setHoveredElement]);

  // Drag + click
  useEffect(() => {
    /** Pick the flaggable element with the largest intersection area inside the drag rect. */
    const bestFlaggableInRect = (sel: { left: number; top: number; right: number; bottom: number }): HTMLElement | null => {
      const all = Array.from(document.querySelectorAll("[data-flaggable]")) as HTMLElement[];
      let best: HTMLElement | null = null;
      let bestArea = 0;
      for (const el of all) {
        const r = el.getBoundingClientRect();
        const iw = Math.max(0, Math.min(r.right, sel.right) - Math.max(r.left, sel.left));
        const ih = Math.max(0, Math.min(r.bottom, sel.bottom) - Math.max(r.top, sel.top));
        const area = iw * ih;
        if (area > bestArea) { bestArea = area; best = el; }
      }
      return best;
    };

    const handleMouseDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("[data-toolkit]") || (e.target as HTMLElement).closest("[data-flag-overlay]")) return;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      document.body.style.userSelect = "none";
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
        isDraggingRef.current = true;
        setDragRect({
          x: Math.min(e.clientX, dragStartRef.current.x),
          y: Math.min(e.clientY, dragStartRef.current.y),
          w: Math.abs(dx), h: Math.abs(dy),
        });
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      const start = dragStartRef.current;
      const wasDragging = isDraggingRef.current;
      dragStartRef.current = null;
      isDraggingRef.current = false;
      document.body.style.userSelect = "";
      setDragRect(null);
      if (!start) return;
      if ((e.target as HTMLElement).closest("[data-toolkit]") || (e.target as HTMLElement).closest("[data-flag-overlay]")) return;

      if (wasDragging) {
        const selRect = {
          left: Math.min(e.clientX, start.x), top: Math.min(e.clientY, start.y),
          right: Math.max(e.clientX, start.x), bottom: Math.max(e.clientY, start.y),
        };
        const el = bestFlaggableInRect(selRect);
        if (!el) return;
        onSelect({
          text: el.textContent?.trim().slice(0, 200) ?? "",
          selector: generateSelector(el),
          rect: el.getBoundingClientRect(),
          orgId: findOrgId(el),
        });
      } else {
        const hovered = hoveredElementRef.current;
        if (hovered) {
          e.preventDefault();
          e.stopPropagation();
          onSelect({
            text: hovered.textContent?.trim().slice(0, 200) ?? "",
            selector: generateSelector(hovered),
            rect: hovered.getBoundingClientRect(),
            orgId: findOrgId(hovered),
          });
        }
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
    };
  }, [onSelect]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  useEffect(() => {
    document.body.style.cursor = "crosshair";
    return () => { document.body.style.cursor = ""; };
  }, []);

  return (
    <>
      <div
        data-flag-overlay
        className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] bg-amber-500 text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2 text-sm font-medium"
      >
        <FlagIcon className="w-4 h-4" />
        Click or drag to flag something
        <span className="text-amber-200 ml-2">ESC to cancel</span>
      </div>

      {hoveredElement && !dragRect && (
        <HighlightOverlay element={hoveredElement} />
      )}

      {dragRect && (
        <div
          data-flag-overlay
          className="fixed pointer-events-none z-[59]"
          style={{
            left: dragRect.x, top: dragRect.y,
            width: dragRect.w, height: dragRect.h,
            border: "2px solid #F59E0B",
            backgroundColor: "rgba(245, 158, 11, 0.08)",
            borderRadius: "3px",
          }}
        />
      )}
    </>
  );
}

/**
 * Highlight overlay that follows the hovered element
 */
function HighlightOverlay({ element, color = "amber" }: { element: HTMLElement; color?: "amber" | "blue" | "violet" | "yellow" }) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const updateRect = () => {
      setRect(element.getBoundingClientRect());
    };

    updateRect();
    window.addEventListener('scroll', updateRect);
    window.addEventListener('resize', updateRect);

    return () => {
      window.removeEventListener('scroll', updateRect);
      window.removeEventListener('resize', updateRect);
    };
  }, [element]);

  if (!rect) return null;

  const colorClass = color === "blue"
    ? "border-blue-500 bg-blue-500/10"
    : color === "violet"
    ? "border-violet-500 bg-violet-500/10"
    : color === "yellow"
    ? "border-yellow-500 bg-yellow-500/10"
    : "border-amber-500 bg-amber-500/10";

  return (
    <div
      data-flag-overlay
      className={`fixed pointer-events-none z-[55] border-2 ${colorClass} rounded transition-all duration-75`}
      style={{
        top: rect.top - 2,
        left: rect.left - 2,
        width: rect.width + 4,
        height: rect.height + 4,
      }}
    />
  );
}

/**
 * Walk up the DOM from an element to find the nearest data-org-id attribute.
 * Used by both Flag and Explain to identify which org is being questioned/flagged
 * on pages where multiple orgs appear (directories, benchmarking, maps).
 */
function findOrgId(element: HTMLElement): string | undefined {
  const el = element.closest("[data-org-id]") as HTMLElement | null;
  return el?.dataset.orgId ?? undefined;
}

/**
 * Generate a CSS selector for an element (for reference)
 */
function generateSelector(element: HTMLElement): string {
  const parts: string[] = [];
  let current: HTMLElement | null = element;

  while (current && current !== document.body) {
    // Stable ID anchor — stop here, no need to go further up
    if (current.id) {
      parts.unshift(`#${current.id}`);
      break;
    }

    // nth-child is stable across class name / style changes
    const tag = current.tagName.toLowerCase();
    const parent = current.parentElement;
    if (parent) {
      const index = Array.from(parent.children).indexOf(current) + 1;
      parts.unshift(`${tag}:nth-child(${index})`);
    } else {
      parts.unshift(tag);
    }

    current = current.parentElement;
    if (parts.length > 5) break;
  }

  return parts.join(" > ");
}

/**
 * Flag Confirmation Popover — card UI with note field and optional urgency toggle.
 */
function FlagConfirmationPopover({
  selectedElement,
  pathname,
  onClose,
  onBack,
}: {
  selectedElement: { text: string; selector: string; rect: DOMRect; orgId?: string };
  pathname: string;
  onClose: () => void;
  onBack: () => void;
}) {
  const [note, setNote] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const popupStyle: React.CSSProperties = {
    position: "fixed",
    top: Math.min(selectedElement.rect.bottom + 12, window.innerHeight - 320),
    left: Math.max(16, Math.min(selectedElement.rect.left, window.innerWidth - 360)),
    width: Math.min(340, window.innerWidth - 32),
    zIndex: 70,
  };

  const handleSubmit = async () => {
    setStatus("submitting");
    setError(null);
    try {
      const result = await submitFlag({
        pageUrl: pathname,
        priority: urgent ? "high" : "normal",
        note: note.trim() || undefined,
        elementSelector: selectedElement.selector,
        elementContent: selectedElement.text,
        organizationId: selectedElement.orgId,
      });
      if (result.success) {
        setStatus("done");
        setTimeout(onClose, 2000);
      } else {
        setError(result.error ?? "Failed to submit");
        setStatus("error");
      }
    } catch {
      setError("Something went wrong. Try again.");
      setStatus("error");
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        data-flag-overlay
        className="fixed inset-0 z-[55]"
        onClick={() => status === "idle" && onClose()}
      />

      {/* Amber highlight on the selected element */}
      <div
        data-flag-overlay
        className="fixed pointer-events-none z-[56] border-2 border-amber-500 bg-amber-500/20 rounded"
        style={{
          top: selectedElement.rect.top - 2,
          left: selectedElement.rect.left - 2,
          width: selectedElement.rect.width + 4,
          height: selectedElement.rect.height + 4,
        }}
      />

      <div style={popupStyle} className="bg-white rounded-xl shadow-2xl border border-amber-200 overflow-hidden">
        {/* Header */}
        <div className="bg-amber-50 border-b border-amber-100 px-4 py-3 flex items-center gap-2">
          <span className="text-amber-600 text-base">⚑</span>
          <span className="text-sm font-semibold text-amber-800">Flag an issue</span>
          <button
            onClick={onBack}
            className="ml-auto text-amber-400 hover:text-amber-600 text-xs"
            disabled={status === "submitting"}
          >
            ← back
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* Element preview */}
          {selectedElement.text && (
            <div className="bg-gray-50 rounded-lg px-3 py-2 text-xs text-gray-500 italic line-clamp-2">
              "{selectedElement.text}"
            </div>
          )}

          {status === "done" ? (
            <div className="flex items-center gap-2 text-emerald-600 font-medium text-sm py-2">
              <CheckIcon />
              Flagged — we'll look into it.
            </div>
          ) : (
            <>
              <textarea
                placeholder="What's wrong with this? (optional, but helpful)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                disabled={status === "submitting"}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-amber-300 disabled:opacity-50"
              />

              {/* Urgent toggle */}
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={urgent}
                  onChange={(e) => setUrgent(e.target.checked)}
                  disabled={status === "submitting"}
                  className="rounded border-gray-300 text-red-500 focus:ring-red-400"
                />
                <span className="text-sm text-gray-600">
                  This is urgent or misleading
                </span>
              </label>

              {error && (
                <p className="text-xs text-red-500">{error}</p>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={onClose}
                  disabled={status === "submitting"}
                  className="flex-1 px-3 py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={status === "submitting"}
                  className="flex-1 px-3 py-2 text-sm font-medium bg-amber-500 hover:bg-amber-600 text-white rounded-lg disabled:opacity-50 transition-colors"
                >
                  {status === "submitting" ? "Sending…" : "Submit flag"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * Edit Selection Overlay - Admin clicks on elements to edit them
 * Similar to FlagSelectionOverlay but looks for data-field attribute
 *
 * Also supports:
 * - Row-level actions: clicking a row with data-entity-id but no data-field triggers delete
 * - Add actions: clicking data-add-contact triggers add contact flow
 */
// Image fields that should show upload UI
const IMAGE_FIELDS = [
  'organizations.hero_image_url',
  'organizations.logo_url',
  'organizations.logo_horizontal_url',
  'organizations.product_overlay_url',
  'organizations.banner_url',
];

function EditSelectionOverlay({
  onSelect,
  onCancel,
  hoveredElement,
  setHoveredElement,
  canEditOrg,
}: {
  onSelect: (element: {
    text: string;
    field: string;
    entityId: string;
    rect: DOMRect;
    isRowAction?: boolean;
    isAddAction?: boolean;
    isAddColorAction?: boolean;
    isDeleteColorAction?: boolean;
    isImageField?: boolean;
    colorType?: 'primary' | 'secondary';
    organizationId?: string;
    conferenceId?: string;
  }) => void;
  onCancel: () => void;
  hoveredElement: HTMLElement | null;
  setHoveredElement: (el: HTMLElement | null) => void;
  canEditOrg: (orgId: string) => boolean;
}) {
  useEffect(() => {
    const getOrganizationIdForElement = (element: HTMLElement): string | null => {
      const explicitOrgId = element.getAttribute("data-organization-id");
      if (explicitOrgId) return explicitOrgId;

      const field = element.getAttribute("data-field");
      const entityId = element.getAttribute("data-entity-id");
      if (field?.startsWith("organizations.") && entityId) {
        return entityId;
      }

      return null;
    };

    /**
     * Find the editable element - prioritizes specific fields over row-level actions
     */
    const findEditableElement = (target: HTMLElement): { element: HTMLElement; type: 'field' | 'row' | 'add' | 'add-color' | 'delete-color' } | null => {
      // First check for add-color action
      if (target.hasAttribute('data-add-color')) {
        return { element: target, type: 'add-color' };
      }
      const addColor = target.closest('[data-add-color]') as HTMLElement | null;
      if (addColor) {
        return { element: addColor, type: 'add-color' };
      }

      // Check for delete-color action
      if (target.hasAttribute('data-delete-color')) {
        return { element: target, type: 'delete-color' };
      }
      const deleteColor = target.closest('[data-delete-color]') as HTMLElement | null;
      if (deleteColor) {
        return { element: deleteColor, type: 'delete-color' };
      }

      // Check for add-contact action
      if (target.hasAttribute('data-add-contact')) {
        return { element: target, type: 'add' };
      }
      const addContact = target.closest('[data-add-contact]') as HTMLElement | null;
      if (addContact) {
        return { element: addContact, type: 'add' };
      }

      // Check if target has data-field (specific field edit)
      if (target.hasAttribute('data-field') && target.hasAttribute('data-entity-id')) {
        return { element: target, type: 'field' };
      }

      // Look for closest ancestor with data-field
      const fieldEditable = target.closest('[data-field][data-entity-id]') as HTMLElement | null;
      if (fieldEditable) {
        return { element: fieldEditable, type: 'field' };
      }

      // Check for row-level action (has entity-id but not field - for delete)
      if (target.hasAttribute('data-entity-id') && target.hasAttribute('data-deletable')) {
        return { element: target, type: 'row' };
      }
      const rowElement = target.closest('[data-entity-id][data-deletable]') as HTMLElement | null;
      if (rowElement && !rowElement.hasAttribute('data-field')) {
        return { element: rowElement, type: 'row' };
      }

      return null;
    };

    const handleMouseMove = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // Ignore toolkit elements
      if (target.closest('[data-toolkit]') || target.closest('[data-edit-overlay]')) {
        setHoveredElement(null);
        return;
      }

      const result = findEditableElement(target);
      if (result) {
        const orgId = getOrganizationIdForElement(result.element);
        if (orgId && !canEditOrg(orgId)) {
          setHoveredElement(null);
          return;
        }
        setHoveredElement(result.element);
      } else {
        setHoveredElement(null);
      }
    };

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // Ignore toolkit elements
      if (target.closest('[data-toolkit]') || target.closest('[data-edit-overlay]')) {
        return;
      }

      if (hoveredElement) {
        const orgId = getOrganizationIdForElement(hoveredElement);
        if (orgId && !canEditOrg(orgId)) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();

        const text = hoveredElement.textContent?.trim() || '';
        const field = hoveredElement.getAttribute('data-field') || '';
        const entityId = hoveredElement.getAttribute('data-entity-id') || '';
        const organizationId = hoveredElement.getAttribute('data-organization-id') || '';
        const conferenceId = hoveredElement.getAttribute('data-conference-id') || '';
        const colorType = hoveredElement.getAttribute('data-color-type') as 'primary' | 'secondary' | null;
        const rect = hoveredElement.getBoundingClientRect();

        // Determine action type
        const isAddColorAction = hoveredElement.hasAttribute('data-add-color');
        const isDeleteColorAction = hoveredElement.hasAttribute('data-delete-color');
        const isAddAction = hoveredElement.hasAttribute('data-add-contact');
        const isRowAction = !isAddAction && !isAddColorAction && !isDeleteColorAction && !field && !!entityId && hoveredElement.hasAttribute('data-deletable');
        const isImageField = IMAGE_FIELDS.includes(field);

        onSelect({
          text,
          field,
          entityId,
          rect,
          isRowAction: isRowAction || undefined,
          isAddAction: isAddAction || undefined,
          isAddColorAction: isAddColorAction || undefined,
          isDeleteColorAction: isDeleteColorAction || undefined,
          isImageField: isImageField || undefined,
          colorType: colorType || undefined,
          organizationId: organizationId || undefined,
          conferenceId: conferenceId || undefined,
        });
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('keydown', handleKeyDown);

    // Add cursor style
    document.body.style.cursor = 'crosshair';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.cursor = '';
    };
  }, [hoveredElement, onSelect, onCancel, setHoveredElement, canEditOrg]);

  return (
    <>
      {/* Instruction banner */}
      <div
        data-edit-overlay
        className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] bg-emerald-500 text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2 text-sm font-medium"
      >
        <EditIcon className="w-4 h-4" />
        Click on something to edit it
        <span className="text-emerald-200 ml-2">ESC to cancel</span>
      </div>

      {/* Highlight overlay for hovered element */}
      {hoveredElement && (
        <EditHighlightOverlay element={hoveredElement} />
      )}
    </>
  );
}

/**
 * Edit highlight overlay - green instead of amber
 */
function EditHighlightOverlay({ element }: { element: HTMLElement }) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const updateRect = () => {
      setRect(element.getBoundingClientRect());
    };

    updateRect();
    window.addEventListener('scroll', updateRect);
    window.addEventListener('resize', updateRect);

    return () => {
      window.removeEventListener('scroll', updateRect);
      window.removeEventListener('resize', updateRect);
    };
  }, [element]);

  if (!rect) return null;

  return (
    <div
      data-edit-overlay
      className="fixed pointer-events-none z-[55] border-2 border-emerald-500 bg-emerald-500/10 rounded transition-all duration-75"
      style={{
        top: rect.top - 2,
        left: rect.left - 2,
        width: rect.width + 4,
        height: rect.height + 4,
      }}
    />
  );
}

/**
 * Edit Confirmation Popover - Handles field edits, delete, and add actions
 */
function EditConfirmationPopover({
  selectedElement,
  onClose,
  onSuccess,
  onBack,
}: {
  selectedElement: {
    text: string;
    field: string;
    entityId: string;
    rect: DOMRect;
    isRowAction?: boolean;
    isAddAction?: boolean;
    isAddColorAction?: boolean;
    isDeleteColorAction?: boolean;
    isImageField?: boolean;
    colorType?: 'primary' | 'secondary';
    organizationId?: string;
    conferenceId?: string;
  };
  onClose: () => void;
  onSuccess: () => void;
  onBack: () => void;
}) {
  // Route to appropriate popover based on action type
  if (selectedElement.isAddColorAction) {
    return (
      <AddBrandColorPopover
        selectedElement={selectedElement}
        onClose={onClose}
        onSuccess={onSuccess}
      />
    );
  }

  if (selectedElement.isDeleteColorAction) {
    return (
      <DeleteBrandColorPopover
        selectedElement={selectedElement}
        onClose={onClose}
        onSuccess={onSuccess}
      />
    );
  }

  if (selectedElement.isAddAction) {
    // Same modal as editing an existing contact (ContactEditModal with
    // contact: null) — add and edit used to be two different-looking
    // components on this same page; this is the fix for that mismatch.
    return (
      <ContactEditModal
        contact={null}
        organizationId={selectedElement.organizationId ?? ""}
        onClose={onClose}
        onCreated={onSuccess}
      />
    );
  }

  if (selectedElement.isRowAction) {
    return (
      <DeleteContactPopover
        selectedElement={selectedElement}
        onClose={onClose}
        onSuccess={onSuccess}
      />
    );
  }

  if (selectedElement.isImageField) {
    const [, column] = selectedElement.field.split(".");
    const imageTypeMap: Record<string, OrgImageType> = {
      hero_image_url: "hero_image",
      logo_url: "logo",
      logo_horizontal_url: "logo_horizontal",
      product_overlay_url: "product_overlay",
      banner_url: "hero_image",
    };
    const imageType: OrgImageType = imageTypeMap[column] ?? "hero_image";
    return (
      <ImageUploadModal
        imageType={imageType}
        orgId={selectedElement.entityId}
        onClose={onClose}
        onSuccess={onSuccess}
      />
    );
  }

  // Default: field edit
  return (
    <FieldEditPopover
      selectedElement={selectedElement}
      onClose={onClose}
      onSuccess={onSuccess}
    />
  );
}

/**
 * Field Edit Popover - Inline text input for editing a specific field
 */
// Columns that warrant a textarea — long-form prose, not a short label/URL
const MULTILINE_COLUMNS = new Set([
  "company_description",
  "highlight_product_description",
  "highlight_the_deal",
  "body",
  "notes",
  "subtitle",
]);

function isMultilineField(column: string, currentValue: string): boolean {
  if (MULTILINE_COLUMNS.has(column)) return true;
  // Also treat any value with a newline or over 120 chars as multiline
  if (currentValue.includes("\n") || currentValue.length > 120) return true;
  return false;
}

function FieldEditPopover({
  selectedElement,
  onClose,
  onSuccess,
}: {
  selectedElement: { text: string; field: string; entityId: string; rect: DOMRect };
  onClose: () => void;
  onSuccess: () => void;
}) {
  // Parse field into table and column up front (used for multiline detection)
  const [table, column] = selectedElement.field.split('.') as [string, string];

  // Strip display formatting from the initial value so the input shows a clean,
  // editable value. formatNumber() adds commas; square_footage appends " sq ft".
  const cleanInitialText = (() => {
    const stripped = selectedElement.text.replace(/,/g, '').replace(/\s*sq\s*ft$/i, '').trim();
    return stripped || selectedElement.text;
  })();

  const [value, setValue] = useState(cleanInitialText);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<"saved" | "pending" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const multiline = isMultilineField(column, selectedElement.text);

  // Focus input on mount + lock body scroll
  useEffect(() => {
    if (multiline) {
      textareaRef.current?.focus();
      // Place cursor at end
      const len = textareaRef.current?.value.length ?? 0;
      textareaRef.current?.setSelectionRange(len, len);
    } else {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    // Prevent background scroll while popover is open
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [multiline]);

  const handleSubmit = async () => {
    if (value === cleanInitialText) {
      // No change, just close
      onClose();
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Coerce to number for numeric columns.
      // formatNumber() adds commas (e.g. "12,500") and sq ft suffixes — strip those
      // before sending so Postgres doesn't reject the cast.
      const stripped = value.replace(/,/g, '').replace(/\s*sq\s*ft$/i, '').trim();
      const asNum = stripped !== '' ? Number(stripped) : NaN;
      const coercedValue: string | number | null = (!isNaN(asNum) && stripped !== '')
        ? asNum
        : (value || null);

      const result = await updateField({
        table: table as "organizations" | "contacts" | "brand_colors" | "benchmarking",
        column,
        entityId: selectedElement.entityId,
        newValue: coercedValue,
      });

      if (result.success) {
        // Notify any listeners (e.g. onboarding callouts) that a field was saved
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("csc:field-updated", {
            detail: { table, column, entityId: selectedElement.entityId },
          }));
        }
        if (result.requiresApproval) {
          setSubmitResult("pending");
          setTimeout(onClose, 2000);
        } else {
          setSubmitResult("saved");
          setTimeout(onSuccess, 600);
        }
      } else {
        setError(result.error || "Failed to update");
        setIsSubmitting(false);
      }
    } catch {
      setError("An error occurred");
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (e.key === 'Enter') {
      if (multiline) {
        // Textarea: Cmd/Ctrl+Enter submits, plain Enter adds a newline
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          handleSubmit();
        }
      } else {
        e.preventDefault();
        handleSubmit();
      }
    }
  };

  // Position input near the selected element
  const popoverStyle = {
    top: selectedElement.rect.bottom + 8,
    left: Math.max(16, selectedElement.rect.left),
  };

  // If would go off bottom, position above
  const estimatedHeight = multiline ? 300 : 90;
  if (popoverStyle.top + estimatedHeight > window.innerHeight) {
    popoverStyle.top = Math.max(8, selectedElement.rect.top - estimatedHeight - 8);
  }
  // Final safety clamp — a stale/glitched rect (e.g. captured mid-layout on first
  // load) must never strand the popover off-screen and inaccessible.
  popoverStyle.top = Math.min(Math.max(8, popoverStyle.top), window.innerHeight - estimatedHeight - 8);

  // Ensure doesn't go off right edge — multiline fields get more room
  const maxWidth = Math.min(
    multiline ? 600 : 400,
    window.innerWidth - popoverStyle.left - 16
  );

  return (
    <>
      {/* Light backdrop - click to cancel */}
      <div
        data-edit-overlay
        className="fixed inset-0 z-[55] bg-black/10"
        onClick={() => !isSubmitting && onClose()}
      />

      {/* Highlight the selected element */}
      <div
        data-edit-overlay
        className="fixed pointer-events-none z-[56] border-2 border-emerald-500 bg-emerald-500/20 rounded"
        style={{
          top: selectedElement.rect.top - 2,
          left: selectedElement.rect.left - 2,
          width: selectedElement.rect.width + 4,
          height: selectedElement.rect.height + 4,
        }}
      />

      {/* Edit popover */}
      <div
        data-edit-overlay
        className="fixed z-[60] bg-white rounded-lg shadow-xl border border-gray-200 p-3"
        style={{
          ...popoverStyle,
          width: maxWidth,
        }}
      >
        {submitResult === "saved" ? (
          <div className="flex items-center gap-2 text-emerald-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
            <span className="font-medium">Saved!</span>
          </div>
        ) : submitResult === "pending" ? (
          <div className="flex items-center gap-2 text-amber-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
            </svg>
            <div>
              <div className="font-medium">Awaiting approval</div>
              <div className="text-xs text-amber-500">A second admin must approve this before it goes live.</div>
            </div>
          </div>
        ) : (
          <>
            <div className="text-xs text-gray-400 mb-1 uppercase tracking-wider">
              {column.replace(/_/g, ' ')}
            </div>
            <div className={`flex gap-2 ${multiline ? 'flex-col' : ''}`}>
              {multiline ? (
                <>
                  <textarea
                    ref={textareaRef}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={isSubmitting}
                    rows={6}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent disabled:bg-gray-100 resize-y"
                    placeholder="Enter text…"
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">
                      {value.length} chars · ⌘↵ to save · Esc to cancel
                    </span>
                    <button
                      onClick={handleSubmit}
                      disabled={isSubmitting}
                      className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                    >
                      {isSubmitting ? (
                        <span className="animate-pulse">Saving…</span>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                          </svg>
                          Save
                        </>
                      )}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <input
                    ref={inputRef}
                    type="text"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={isSubmitting}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent disabled:bg-gray-100"
                    placeholder="Enter new value..."
                  />
                  <button
                    onClick={handleSubmit}
                    disabled={isSubmitting}
                    className="px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? (
                      <span className="animate-pulse">...</span>
                    ) : (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                    )}
                  </button>
                </>
              )}
            </div>
            {error && (
              <div className="text-red-500 text-xs mt-2">{error}</div>
            )}
          </>
        )}
      </div>
    </>
  );
}

/**
 * Delete Contact Popover - Confirmation for deleting a contact row
 */
function DeleteContactPopover({
  selectedElement,
  onClose,
  onSuccess,
}: {
  selectedElement: { text: string; entityId: string; rect: DOMRect };
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      const result = await deleteContact({
        contactId: selectedElement.entityId,
      });

      if (result.success) {
        setDeleted(true);
        setTimeout(onSuccess, 600);
      } else {
        setError(result.error || "Failed to delete");
        setIsSubmitting(false);
      }
    } catch {
      setError("An error occurred");
      setIsSubmitting(false);
    }
  };

  // Position near the selected element
  const popoverStyle = {
    top: selectedElement.rect.bottom + 8,
    left: Math.max(16, selectedElement.rect.left),
  };

  if (popoverStyle.top + 80 > window.innerHeight) {
    popoverStyle.top = selectedElement.rect.top - 80;
  }
  // Final safety clamp so a stale rect can't strand the popover off-screen.
  popoverStyle.top = Math.min(Math.max(8, popoverStyle.top), window.innerHeight - 80 - 8);

  return (
    <>
      {/* Light backdrop */}
      <div
        data-edit-overlay
        className="fixed inset-0 z-[55] bg-black/10"
        onClick={() => !isSubmitting && onClose()}
      />

      {/* Highlight the selected row */}
      <div
        data-edit-overlay
        className="fixed pointer-events-none z-[56] border-2 border-red-500 bg-red-500/20 rounded"
        style={{
          top: selectedElement.rect.top - 2,
          left: selectedElement.rect.left - 2,
          width: selectedElement.rect.width + 4,
          height: selectedElement.rect.height + 4,
        }}
      />

      {/* Delete confirmation popover */}
      <div
        data-edit-overlay
        className="fixed z-[60] bg-white rounded-lg shadow-xl border border-gray-200 p-4"
        style={popoverStyle}
      >
        {deleted ? (
          <div className="flex items-center gap-2 text-red-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
            <span className="font-medium">Deleted!</span>
          </div>
        ) : (
          <>
            <div className="text-sm text-gray-700 mb-3">
              Delete this contact?
              <span className="block text-gray-500 text-xs mt-1">
                {selectedElement.text.slice(0, 50)}{selectedElement.text.length > 50 ? '...' : ''}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                disabled={isSubmitting}
                className="flex-1 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={isSubmitting}
                className="flex-1 px-3 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
              >
                {isSubmitting ? "..." : "Delete"}
              </button>
            </div>
            {error && (
              <div className="text-red-500 text-xs mt-2">{error}</div>
            )}
          </>
        )}
      </div>
    </>
  );
}

/**
 * Add Brand Color Popover - Form for adding a new brand color
 */
function AddBrandColorPopover({
  selectedElement,
  onClose,
  onSuccess,
}: {
  selectedElement: { rect: DOMRect; organizationId?: string; colorType?: 'primary' | 'secondary' };
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [hex, setHex] = useState("#");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Validate hex color
  const isValidHex = (value: string): boolean => {
    return /^#[0-9A-Fa-f]{6}$/.test(value);
  };

  // Get preview color (or gray if invalid)
  const previewColor = isValidHex(hex) ? hex : "#888888";

  const handleSubmit = async () => {
    if (!isValidHex(hex)) {
      setError("Please enter a valid hex color (e.g., #FF0000)");
      return;
    }

    if (!selectedElement.organizationId) {
      setError("Organization not found");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    // Determine sort order based on color type
    // Primary colors: 1-5, Secondary: 6+
    const isPrimary = selectedElement.colorType === 'primary';

    try {
      const result = await addBrandColor({
        organizationId: selectedElement.organizationId,
        hex: hex.toUpperCase(),
        name: isPrimary ? 'Primary' : 'Secondary',
        // Sort order will be auto-calculated by the action
      });

      if (result.success) {
        setAdded(true);
        setTimeout(onSuccess, 600);
      } else {
        setError(result.error || "Failed to add color");
        setIsSubmitting(false);
      }
    } catch {
      setError("An error occurred");
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  // Position near the selected element
  const popoverStyle = {
    top: selectedElement.rect.bottom + 8,
    left: Math.max(16, selectedElement.rect.left),
  };

  if (popoverStyle.top + 150 > window.innerHeight) {
    popoverStyle.top = Math.max(16, selectedElement.rect.top - 160);
  }
  // Final safety clamp so a stale rect can't strand the popover off-screen.
  popoverStyle.top = Math.min(Math.max(8, popoverStyle.top), window.innerHeight - 160 - 8);

  return (
    <>
      {/* Light backdrop */}
      <div
        data-edit-overlay
        className="fixed inset-0 z-[55] bg-black/10"
        onClick={() => !isSubmitting && onClose()}
      />

      {/* Highlight the add button */}
      <div
        data-edit-overlay
        className="fixed pointer-events-none z-[56] border-2 border-emerald-500 bg-emerald-500/20 rounded"
        style={{
          top: selectedElement.rect.top - 2,
          left: selectedElement.rect.left - 2,
          width: selectedElement.rect.width + 4,
          height: selectedElement.rect.height + 4,
        }}
      />

      {/* Add color form popover */}
      <div
        data-edit-overlay
        className="fixed z-[60] bg-white rounded-lg shadow-xl border border-gray-200 p-4 w-64"
        style={popoverStyle}
      >
        {added ? (
          <div className="flex items-center gap-2 text-emerald-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
            <span className="font-medium">Color added!</span>
          </div>
        ) : (
          <>
            <div className="text-sm font-medium text-gray-700 mb-3">
              Add {selectedElement.colorType === 'secondary' ? 'Secondary' : 'Primary'} Color
            </div>
            <div className="flex gap-3 items-center mb-3">
              {/* Color preview */}
              <div
                className="w-10 h-10 rounded-full border-2 border-gray-200 flex-shrink-0"
                style={{ backgroundColor: previewColor }}
              />
              {/* Hex input */}
              <input
                ref={inputRef}
                type="text"
                value={hex}
                onChange={(e) => {
                  let val = e.target.value.toUpperCase();
                  if (!val.startsWith('#')) val = '#' + val.replace('#', '');
                  if (val.length <= 7) setHex(val);
                }}
                onKeyDown={handleKeyDown}
                disabled={isSubmitting}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent disabled:bg-gray-100"
                placeholder="#000000"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                disabled={isSubmitting}
                className="flex-1 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || !isValidHex(hex)}
                className="flex-1 px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? "..." : "Add"}
              </button>
            </div>
            {error && (
              <div className="text-red-500 text-xs mt-2">{error}</div>
            )}
          </>
        )}
      </div>
    </>
  );
}

/**
 * Delete Brand Color Popover - Confirmation for deleting a brand color
 */
function DeleteBrandColorPopover({
  selectedElement,
  onClose,
  onSuccess,
}: {
  selectedElement: { text: string; entityId: string; rect: DOMRect };
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      const result = await deleteBrandColor({
        colorId: selectedElement.entityId,
      });

      if (result.success) {
        setDeleted(true);
        setTimeout(onSuccess, 600);
      } else {
        setError(result.error || "Failed to delete");
        setIsSubmitting(false);
      }
    } catch {
      setError("An error occurred");
      setIsSubmitting(false);
    }
  };

  // Position near the selected element
  const popoverStyle = {
    top: selectedElement.rect.bottom + 8,
    left: Math.max(16, selectedElement.rect.left),
  };

  if (popoverStyle.top + 80 > window.innerHeight) {
    popoverStyle.top = selectedElement.rect.top - 80;
  }
  // Final safety clamp so a stale rect can't strand the popover off-screen.
  popoverStyle.top = Math.min(Math.max(8, popoverStyle.top), window.innerHeight - 80 - 8);

  return (
    <>
      {/* Light backdrop */}
      <div
        data-edit-overlay
        className="fixed inset-0 z-[55] bg-black/10"
        onClick={() => !isSubmitting && onClose()}
      />

      {/* Highlight the selected color */}
      <div
        data-edit-overlay
        className="fixed pointer-events-none z-[56] border-2 border-red-500 bg-red-500/20 rounded-full"
        style={{
          top: selectedElement.rect.top - 2,
          left: selectedElement.rect.left - 2,
          width: selectedElement.rect.width + 4,
          height: selectedElement.rect.height + 4,
        }}
      />

      {/* Delete confirmation popover */}
      <div
        data-edit-overlay
        className="fixed z-[60] bg-white rounded-lg shadow-xl border border-gray-200 p-4"
        style={popoverStyle}
      >
        {deleted ? (
          <div className="flex items-center gap-2 text-red-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
            <span className="font-medium">Deleted!</span>
          </div>
        ) : (
          <>
            <div className="text-sm text-gray-700 mb-3">
              Delete this color?
              <span className="block text-gray-500 text-xs mt-1 font-mono">
                {selectedElement.text}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                disabled={isSubmitting}
                className="flex-1 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={isSubmitting}
                className="flex-1 px-3 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
              >
                {isSubmitting ? "..." : "Delete"}
              </button>
            </div>
            {error && (
              <div className="text-red-500 text-xs mt-2">{error}</div>
            )}
          </>
        )}
      </div>
    </>
  );
}

/**
 * Image Upload Popover - Handles image uploads for hero, logo, etc.
 */
function ImageUploadPopover({
  selectedElement,
  onClose,
  onSuccess,
}: {
  selectedElement: { field: string; entityId: string; rect: DOMRect };
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Parse field to get image type
  const [, column] = selectedElement.field.split('.') as [string, string];
  const imageTypeMap: Record<string, 'hero_image' | 'logo' | 'logo_horizontal' | 'product_overlay'> = {
    hero_image_url: 'hero_image',
    logo_url: 'logo',
    logo_horizontal_url: 'logo_horizontal',
    product_overlay_url: 'product_overlay',
    banner_url: 'hero_image', // banner_url maps to hero_image
  };
  const imageType = imageTypeMap[column] || 'hero_image';

  // Friendly names for display
  const fieldNames: Record<string, string> = {
    hero_image_url: 'Hero Image',
    logo_url: 'Logo',
    logo_horizontal_url: 'Horizontal Logo',
    product_overlay_url: 'Product Overlay',
    banner_url: 'Hero Banner',
  };
  const fieldName = fieldNames[column] || column;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
    if (!allowedTypes.includes(file.type)) {
      setError('Please select a valid image file (JPEG, PNG, WebP, GIF, or SVG)');
      return;
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      setError('File size must be less than 10MB');
      return;
    }

    setSelectedFile(file);
    setError(null);

    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setPreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleUpload = async () => {
    if (!selectedFile || !preview) return;

    setIsUploading(true);
    setError(null);

    try {
      const result = await uploadOrganizationImage({
        organizationId: selectedElement.entityId,
        imageType,
        fileData: preview,
        fileName: selectedFile.name,
        contentType: selectedFile.type,
      });

      if (result.success) {
        setUploaded(true);
        setTimeout(onSuccess, 800);
      } else {
        setError(result.error || 'Failed to upload image');
        setIsUploading(false);
      }
    } catch {
      setError('An error occurred during upload');
      setIsUploading(false);
    }
  };

  // Position popover near the selected element
  const popoverStyle = {
    top: Math.min(selectedElement.rect.bottom + 8, window.innerHeight - 350),
    left: Math.max(16, Math.min(selectedElement.rect.left, window.innerWidth - 340)),
  };

  return (
    <>
      {/* Light backdrop */}
      <div
        data-edit-overlay
        className="fixed inset-0 z-[55] bg-black/10"
        onClick={() => !isUploading && onClose()}
      />

      {/* Highlight the selected image area */}
      <div
        data-edit-overlay
        className="fixed pointer-events-none z-[56] border-2 border-emerald-500 bg-emerald-500/20 rounded"
        style={{
          top: selectedElement.rect.top - 2,
          left: selectedElement.rect.left - 2,
          width: selectedElement.rect.width + 4,
          height: selectedElement.rect.height + 4,
        }}
      />

      {/* Upload popover */}
      <div
        data-edit-overlay
        className="fixed z-[60] bg-white rounded-lg shadow-xl border border-gray-200 p-4 w-80"
        style={popoverStyle}
      >
        {uploaded ? (
          <div className="flex items-center gap-2 text-emerald-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
            <span className="font-medium">Image uploaded!</span>
          </div>
        ) : (
          <>
            <div className="text-sm font-medium text-gray-700 mb-3">
              Upload {fieldName}
            </div>

            {/* Preview area */}
            {preview ? (
              <div className="mb-3 relative">
                <img
                  src={preview}
                  alt="Preview"
                  className="w-full h-32 object-contain bg-gray-100 rounded-lg"
                />
                <button
                  onClick={() => {
                    setPreview(null);
                    setSelectedFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                  className="absolute top-2 right-2 w-6 h-6 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center text-white"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="mb-3 w-full h-32 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-emerald-400 hover:bg-emerald-50 transition-colors"
              >
                <svg className="w-8 h-8 text-gray-400 mb-2" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                </svg>
                <span className="text-sm text-gray-500">Click to select image</span>
                <span className="text-xs text-gray-400 mt-1">JPEG, PNG, WebP, GIF, SVG (max 10MB)</span>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
              onChange={handleFileSelect}
              className="hidden"
            />

            <div className="flex gap-2">
              <button
                onClick={onClose}
                disabled={isUploading}
                className="flex-1 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleUpload}
                disabled={isUploading || !selectedFile}
                className="flex-1 px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isUploading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Uploading...
                  </span>
                ) : (
                  'Upload'
                )}
              </button>
            </div>

            {error && (
              <div className="text-red-500 text-xs mt-2">{error}</div>
            )}

            <div className="text-xs text-gray-400 mt-3">
              Tip: For best results, use high-resolution images. Hero images work best at 1920×1080 or larger.
            </div>
          </>
        )}
      </div>
    </>
  );
}

/**
 * Coming Soon Modal for unimplemented tools
 */
function ComingSoonModal({
  tool,
  onClose,
}: {
  tool: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-xs p-6 text-center">
        <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
          <WrenchIcon />
        </div>
        <h3 className="text-lg font-semibold text-[#1A1A1A]">{tool}</h3>
        <p className="text-gray-500 text-sm mt-1 mb-4">Coming soon!</p>
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
        >
          Close
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BookmarkModal
// ─────────────────────────────────────────────────────────────────────────────

function BookmarkModal({
  pathname,
  onClose,
  selectedElement,
  onClearSelectedElement,
  onBookmarkChange,
}: {
  pathname: string;
  onClose: () => void;
  selectedElement: { text: string; selector: string; endSelector?: string } | null;
  onClearSelectedElement: () => void;
  onBookmarkChange: (bookmarked: boolean) => void;
}) {
  const router = useRouter();

  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentBookmark, setCurrentBookmark] = useState<Bookmark | null>(null);

  // Add-new state
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // List state
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNoteValue, setEditNoteValue] = useState("");

  const pageTitle = typeof document !== "undefined" ? document.title.split(" | ")[0] : pathname;

  useEffect(() => {
    getUserBookmarks().then(({ bookmarks: bms }) => {
      setBookmarks(bms);
      const existing = bms.find((b) => b.url === pathname) ?? null;
      setCurrentBookmark(existing);
      setLoading(false);
    });
  }, [pathname]);

  const handleAdd = async () => {
    setSaving(true);
    setError(null);
    const { bookmark, error: err } = await addBookmark(
      pathname,
      pageTitle,
      note || undefined,
      selectedElement?.selector,
      selectedElement?.endSelector,
      selectedElement?.text,
    );
    if (err || !bookmark) { setError(err ?? "Failed"); setSaving(false); return; }
    setCurrentBookmark(bookmark);
    setBookmarks((prev) => [bookmark, ...prev]);
    onBookmarkChange(true);
    setSaved(true);
    setSaving(false);
  };

  const handleRemoveCurrent = async () => {
    setSaving(true);
    const { error: err } = await removeBookmark(pathname);
    if (err) { setError(err); setSaving(false); return; }
    setCurrentBookmark(null);
    setBookmarks((prev) => prev.filter((b) => b.url !== pathname));
    onBookmarkChange(false);
    setSaving(false);
  };

  const handleRemoveById = async (id: string, url: string) => {
    await removeBookmark(url);
    setBookmarks((prev) => prev.filter((b) => b.id !== id));
    if (url === pathname) {
      setCurrentBookmark(null);
      onBookmarkChange(false);
    }
  };

  const startEditNote = (b: Bookmark) => {
    setEditingId(b.id);
    setEditNoteValue(b.note ?? "");
  };

  const handleSaveNote = async (id: string) => {
    await updateBookmarkNote(id, editNoteValue);
    setBookmarks((prev) => prev.map((b) => b.id === id ? { ...b, note: editNoteValue || null } : b));
    if (currentBookmark?.id === id) {
      setCurrentBookmark((prev) => prev ? { ...prev, note: editNoteValue || null } : prev);
    }
    setEditingId(null);
  };

  const handleJump = (b: Bookmark) => {
    onClose();
    if (b.url === pathname) {
      // Same page — scroll directly
      let el: Element | null = null;
      if (b.element_selector) el = findElementBySelector(b.element_selector);
      if (!el && b.element_text) el = findElementByText(b.element_text);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      // Different page — navigate with params
      const params = new URLSearchParams();
      if (b.element_selector) params.set("bmhs", b.element_selector);
      if (b.element_end_selector) params.set("bmhe", b.element_end_selector);
      if (b.element_text) params.set("bmt", encodeURIComponent(b.element_text));
      const qs = params.toString();
      router.push(qs ? `${b.url}?${qs}` : b.url);
    }
  };

  const filteredBookmarks = bookmarks.filter((b) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      b.title.toLowerCase().includes(q) ||
      b.url.toLowerCase().includes(q) ||
      (b.note ?? "").toLowerCase().includes(q) ||
      (b.element_text ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2">
            <BookmarkIcon filled={!!currentBookmark} />
            <span className="font-semibold text-[#1A1A1A]">Bookmarks</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <CloseIcon />
          </button>
        </div>

        {/* Add / current-page section */}
        {loading ? (
          <div className="px-5 py-4 border-b border-gray-100 shrink-0">
            <div className="h-4 bg-gray-100 rounded animate-pulse w-2/3" />
          </div>
        ) : currentBookmark ? (
          /* ── Already bookmarked ── */
          <div className="px-5 py-4 border-b border-gray-100 bg-yellow-50 shrink-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-yellow-700 bg-yellow-100 px-2 py-0.5 rounded-full">
                📌 Bookmarked
              </span>
              <span className="text-xs text-gray-500 truncate flex-1">{pageTitle}</span>
            </div>

            {/* Element chip */}
            {currentBookmark.element_text && (
              <div className="text-xs text-gray-500 bg-white border border-yellow-200 rounded-lg px-3 py-1.5 mb-2 line-clamp-2 italic">
                &ldquo;{currentBookmark.element_text.slice(0, 120)}&rdquo;
              </div>
            )}

            {/* Inline note edit */}
            {editingId === currentBookmark.id ? (
              <div className="flex gap-2 mb-2">
                <input
                  className="flex-1 text-sm border border-yellow-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-yellow-300"
                  value={editNoteValue}
                  autoFocus
                  onChange={(e) => setEditNoteValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveNote(currentBookmark.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  placeholder="Add a note…"
                />
                <button
                  onClick={() => handleSaveNote(currentBookmark.id)}
                  className="text-xs text-yellow-700 font-medium hover:text-yellow-900"
                >
                  Save
                </button>
              </div>
            ) : (
              <p
                className="text-xs text-gray-500 mb-2 cursor-pointer hover:text-gray-700 min-h-[1.25rem]"
                onClick={() => startEditNote(currentBookmark)}
              >
                {currentBookmark.note ?? <span className="text-gray-300 italic">click to add a note…</span>}
              </p>
            )}

            <div className="flex gap-2">
              {currentBookmark.element_selector || currentBookmark.element_text ? (
                <button
                  onClick={() => handleJump(currentBookmark)}
                  className="flex-1 text-xs font-medium px-3 py-1.5 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg transition-colors"
                >
                  ↓ Jump to section
                </button>
              ) : null}
              <button
                onClick={handleRemoveCurrent}
                disabled={saving}
                className="flex-1 text-xs font-medium px-3 py-1.5 bg-white hover:bg-red-50 text-red-500 border border-red-200 rounded-lg transition-colors disabled:opacity-50"
              >
                {saving ? "Removing…" : "Remove bookmark"}
              </button>
            </div>
            {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
          </div>
        ) : saved ? (
          /* ── Just saved ── */
          <div className="px-5 py-4 border-b border-gray-100 bg-yellow-50 shrink-0">
            <div className="flex items-center gap-2 text-yellow-700 font-medium text-sm">
              <svg className="w-4 h-4 text-yellow-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
              Bookmarked!
            </div>
          </div>
        ) : (
          /* ── Not yet bookmarked — add form ── */
          <div className="px-5 py-4 border-b border-gray-100 shrink-0">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Save this page</p>

            {/* Element chip (from selection) */}
            {selectedElement?.text && (
              <div className="flex items-start gap-2 mb-3 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-yellow-700 font-medium mb-0.5">Selected section</p>
                  <p className="text-xs text-gray-600 italic line-clamp-2">&ldquo;{selectedElement.text.slice(0, 120)}&rdquo;</p>
                </div>
                <button
                  onClick={onClearSelectedElement}
                  className="text-yellow-400 hover:text-yellow-600 shrink-0 mt-0.5"
                  title="Remove section selection"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}

            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note… (optional)"
              rows={2}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-yellow-300 mb-3"
            />

            {error && <p className="text-red-500 text-xs mb-2">{error}</p>}

            <button
              onClick={handleAdd}
              disabled={saving}
              className="w-full py-2 bg-yellow-500 hover:bg-yellow-600 text-white font-medium text-sm rounded-lg transition-colors disabled:opacity-50"
            >
              {saving ? "Saving…" : selectedElement ? "Bookmark this section" : "Bookmark this page"}
            </button>
          </div>
        )}

        {/* Search */}
        {bookmarks.length > 3 && (
          <div className="px-5 py-2 border-b border-gray-100 shrink-0">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search bookmarks…"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-yellow-300"
            />
          </div>
        )}

        {/* Bookmark list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-5 text-center text-gray-400 text-sm">Loading…</div>
          ) : filteredBookmarks.length === 0 ? (
            <div className="p-5 text-center text-gray-400 text-sm">
              {search ? "No matches." : "No bookmarks yet."}
            </div>
          ) : (
            <ul className="divide-y divide-gray-50">
              {filteredBookmarks.map((b) => (
                <li key={b.id} className="px-5 py-3 group hover:bg-gray-50">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <button
                          onClick={() => handleJump(b)}
                          className="font-medium text-sm text-yellow-700 hover:text-yellow-900 hover:underline truncate text-left"
                        >
                          {b.title}
                        </button>
                        {(b.element_selector || b.element_text) && (
                          <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 bg-yellow-100 text-yellow-600 rounded-full">
                            section
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 truncate">{b.url}</p>

                      {/* Element text snippet */}
                      {b.element_text && (
                        <p className="text-xs text-gray-400 italic mt-0.5 line-clamp-1">
                          &ldquo;{b.element_text.slice(0, 80)}&rdquo;
                        </p>
                      )}

                      {/* Note */}
                      {editingId === b.id ? (
                        <div className="mt-1.5 flex gap-2">
                          <input
                            className="flex-1 text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-yellow-300"
                            value={editNoteValue}
                            autoFocus
                            onChange={(e) => setEditNoteValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveNote(b.id);
                              if (e.key === "Escape") setEditingId(null);
                            }}
                            placeholder="Add a note…"
                          />
                          <button
                            className="text-xs text-yellow-600 hover:underline"
                            onClick={() => handleSaveNote(b.id)}
                          >
                            Save
                          </button>
                        </div>
                      ) : b.note ? (
                        <p
                          className="text-xs text-gray-500 mt-0.5 cursor-pointer hover:text-gray-700"
                          onClick={() => startEditNote(b)}
                        >
                          {b.note}
                        </p>
                      ) : (
                        <button
                          className="text-xs text-gray-300 hover:text-gray-500 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => startEditNote(b)}
                        >
                          + add note
                        </button>
                      )}
                    </div>
                    <button
                      onClick={() => handleRemoveById(b.id, b.url)}
                      className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all p-0.5 shrink-0"
                      title="Remove bookmark"
                    >
                      <CloseIcon />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ExportModal
// ─────────────────────────────────────────────────────────────────────────────

function ExportModal({ pathname, onClose, isPartner = false, partnerOwnOrgSlugs = [] }: { pathname: string; onClose: () => void; isPartner?: boolean; partnerOwnOrgSlugs?: string[] }) {
  const context = detectPageContext(pathname);
  const isPartnerOwnPage = context.type === "org" && partnerOwnOrgSlugs.includes(context.slug);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canExportAttendees, setCanExportAttendees] = useState(false);

  useEffect(() => {
    if (context.type !== "event") return;
    canExportEventAttendees(context.slug).then(setCanExportAttendees);
  }, [context.type === "event" && context.slug]);

  const downloadBlob = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const run = async (label: string, fn: () => Promise<{ csv?: string; ics?: string; filename?: string; error?: string }>) => {
    setDownloading(label);
    setError(null);
    const result = await fn();
    if (result.error) { setError(result.error); setDownloading(null); return; }
    if (result.csv && result.filename) downloadBlob(result.csv, result.filename, "text/csv;charset=utf-8;");
    if (result.ics && result.filename) downloadBlob(result.ics, result.filename, "text/calendar;charset=utf-8;");
    setDownloading(null);
  };

  type ExportOption = { label: string; description: string; icon: string; action: () => Promise<void> };
  let options: ExportOption[] = [];

  if (context.type === "org") {
    options = [
      {
        label: "Contacts CSV",
        description: "Names, titles, emails, and phone numbers",
        icon: "👤",
        action: () => run("Contacts CSV", () => exportOrgContacts(context.slug)),
      },
      {
        label: "Org Info CSV",
        description: "Location, website, staff count, and type",
        icon: "🏢",
        action: () => run("Org Info CSV", () => exportOrgInfo(context.slug)),
      },
      ...(isPartnerOwnPage ? [
        {
          label: "My Market Buyers CSV",
          description: "All member stores in your categories — buyer name, title, email, and match confidence",
          icon: "📇",
          action: () => run("My Market Buyers CSV", () => exportPartnerMarketCSV()),
        },
      ] : []),
    ];
  } else if (context.type === "event") {
    options = [
      {
        label: "Add to Calendar",
        description: "Download .ics file for any calendar app",
        icon: "📅",
        action: () => run("Add to Calendar", () => exportEventICS(context.slug)),
      },
      ...(canExportAttendees ? [{
        label: "Attendee List CSV",
        description: "Names, emails, registration status, and check-in times",
        icon: "📋",
        action: () => run("Attendee List CSV", () => exportEventAttendees(context.slug)),
      }] : []),
    ];
  } else if (context.type === "members_directory") {
    if (isPartner) {
      options = [
        {
          label: "My Buyer Contacts",
          description: "One row per member that carries your category — buyer name, email, phone, buying window",
          icon: "📇",
          action: () => run("My Buyer Contacts", () => exportMemberBuyersCSV()),
        },
        {
          label: "Full Member Directory CSV",
          description: "Every visible member and every contact on file there — one row per person. Anyone who's hidden their info is excluded, not just blanked.",
          icon: "📚",
          action: () => run("Full Member Directory CSV", () => exportFullMemberDirectoryCSV()),
        },
      ];
    } else {
      options = [
        {
          label: "Member Directory CSV",
          description: "Name, city, province, and website for all members",
          icon: "📋",
          action: () => run("Member Directory CSV", () => exportMembersDirectory()),
        },
      ];
    }
  } else if (context.type === "partners_directory") {
    options = [
      {
        label: "Partner Directory CSV",
        description: "Name, category, city, province, and website for all partners",
        icon: "📋",
        action: () => run("Partner Directory CSV", () => exportPartnersDirectory()),
      },
    ];
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <ExportIcon />
            <span className="font-semibold text-[#1A1A1A]">Export</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <CloseIcon />
          </button>
        </div>

        <div className="p-5">
          {options.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-gray-400 text-sm">Nothing exportable on this page.</p>
              <p className="text-gray-300 text-xs mt-1">Try visiting an org profile or event page.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {options.map((opt) => (
                <button
                  key={opt.label}
                  onClick={opt.action}
                  disabled={downloading !== null}
                  className="w-full flex items-center gap-4 p-4 rounded-xl border border-gray-200 hover:border-blue-200 hover:bg-blue-50 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="text-2xl">{opt.icon}</span>
                  <div>
                    <p className="font-medium text-sm text-[#1A1A1A]">
                      {downloading === opt.label ? "Downloading…" : opt.label}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">{opt.description}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
          {error && <p className="text-red-500 text-xs mt-3 text-center">{error}</p>}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ShareModal — two paths: External (snapshot link) and Internal (DM a member)
// ─────────────────────────────────────────────────────────────────────────────

function ShareModal({
  pathname,
  onClose,
  selectedElement,
  onClearSelectedElement,
  defaultTab = "external",
  showPrintOption = false,
}: {
  pathname: string;
  onClose: () => void;
  selectedElement: { text: string; selector: string; endSelector?: string } | null;
  onClearSelectedElement: () => void;
  defaultTab?: "external" | "internal";
  showPrintOption?: boolean;
}) {
  const [tab, setTab] = useState<"external" | "internal">(defaultTab);

  const pageTitle = typeof document !== "undefined" ? document.title.split(" | ")[0] : pathname;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <ShareIcon />
            <span className="font-semibold text-[#1A1A1A]">Share</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <CloseIcon />
          </button>
        </div>

        {/* Page being shared */}
        <div className="px-5 pt-4">
          <div className="bg-gray-50 rounded-xl px-4 py-3">
            <p className="font-medium text-sm text-[#1A1A1A] truncate">{pageTitle}</p>
            <p className="text-xs text-gray-400 truncate">{pathname}</p>
          </div>
        </div>

        {/* Print / Save as PDF — only offered on pages designed to print well */}
        {showPrintOption && (
          <div className="px-5 pt-3">
            <button
              onClick={() => {
                onClose();
                setTimeout(() => window.print(), 50);
              }}
              className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 hover:text-gray-900 transition-colors"
            >
              <PrintIcon className="w-4 h-4" />
              Print / Save as PDF
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 px-5 pt-3">
          <button
            onClick={() => setTab("external")}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tab === "external"
                ? "bg-[#1A1A1A] text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            Copy link
          </button>
          <button
            onClick={() => setTab("internal")}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tab === "internal"
                ? "bg-[#1A1A1A] text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            Send to member
          </button>
        </div>

        <div className="p-5">
          {tab === "external" ? (
            <ShareExternalTab pathname={pathname} pageTitle={pageTitle} selectedElement={selectedElement} />
          ) : (
            <ShareInternalTab
              pathname={pathname}
              pageTitle={pageTitle}
              onDone={onClose}
              selectedElement={selectedElement}
              onClearSelectedElement={onClearSelectedElement}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── External tab: snapshot → copy link ───────────────────────────────────────

function ShareExternalTab({ pathname, pageTitle, selectedElement }: {
  pathname: string;
  pageTitle: string;
  selectedElement: { text: string; selector: string; endSelector?: string } | null;
}) {
  const [note, setNote] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || (typeof window !== "undefined" ? window.location.origin : "");

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    const result = await captureAndCreateSnapshot({ pathname, pageTitle, note: note || undefined });
    if (result.error || !result.id) {
      setError(result.error ?? "Failed to create snapshot");
      setCreating(false);
      return;
    }
    const baseUrl = `${appUrl}/s/${result.id}`;
    if (selectedElement) {
      const hp = new URLSearchParams();
      hp.set("hs", selectedElement.selector);
      if (selectedElement.endSelector) hp.set("he", selectedElement.endSelector);
      hp.set("ht", selectedElement.text.slice(0, 200));
      setCreatedUrl(`${baseUrl}?${hp.toString()}`);
    } else {
      setCreatedUrl(baseUrl);
    }
    setCreating(false);
  };

  const handleCopy = () => {
    if (!createdUrl) return;
    navigator.clipboard.writeText(createdUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (createdUrl) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-gray-600">Snapshot created — link is valid for 4 days:</p>
        <div className="flex gap-2">
          <input
            readOnly
            value={createdUrl}
            className="flex-1 text-xs border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 font-mono"
          />
          <button
            onClick={handleCopy}
            className={`shrink-0 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
              copied ? "bg-emerald-500 text-white" : "bg-gray-100 hover:bg-gray-200 text-gray-700"
            }`}
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <button
          onClick={() => { setCreatedUrl(null); setNote(""); }}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          Create another
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        Creates a snapshot of this page's current data — viewable by anyone with the link, no sign-in required.
      </p>

      {/* Selected element chip — read-only, set before modal opened */}
      {selectedElement && (
        <div className="flex items-start gap-2 bg-violet-50 border border-violet-100 rounded-lg px-3 py-2">
          <span className="text-violet-400 mt-0.5 shrink-0 text-sm">◎</span>
          <p className="flex-1 text-xs text-violet-800 line-clamp-2 min-w-0">
            {selectedElement.text.slice(0, 120)}
          </p>
        </div>
      )}

      <div>
        <label className="text-xs text-gray-500 font-medium mb-1 block">Note (optional)</label>
        <input
          type="text"
          placeholder="Add context for the recipient…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
      </div>
      {error && <p className="text-red-500 text-xs">{error}</p>}
      <button
        onClick={handleCreate}
        disabled={creating}
        className="w-full py-2.5 bg-[#1A1A1A] hover:bg-gray-800 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
      >
        {creating ? "Capturing…" : "Create link"}
      </button>
    </div>
  );
}

// ── Internal tab: fuzzy member search → send via Circle DM / email ────────────

function ShareInternalTab({
  pathname,
  pageTitle,
  onDone,
  selectedElement,
  onClearSelectedElement,
}: {
  pathname: string;
  pageTitle: string;
  onDone: () => void;
  selectedElement: { text: string; selector: string; endSelector?: string } | null;
  onClearSelectedElement: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemberSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<MemberSearchResult | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (query.length < 2) { setResults([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      const res = await searchMembersForShare(query);
      setResults(res);
      setSearching(false);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const handleSend = async () => {
    if (!selected) return;
    setSending(true);
    setError(null);
    const result = await shareInternally({
      pathname,
      pageTitle,
      recipientId: selected.id,
      note: note || undefined,
      elementSelector: selectedElement?.selector,
      elementEndSelector: selectedElement?.endSelector,
      elementText: selectedElement?.text,
    });
    if (!result.success) {
      setError(result.error ?? "Failed to send");
      setSending(false);
      return;
    }
    setSent(true);
    setSending(false);
    setTimeout(onDone, 2000);
  };

  if (sent) {
    return (
      <div className="text-center py-4">
        <p className="text-emerald-600 font-semibold text-sm">✓ Sent!</p>
        <p className="text-xs text-gray-400 mt-1">{selected?.display_name ?? selected?.email} will receive a link via Circle or email.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        Send a link to another CSC member via Circle message or email.
      </p>

      {/* Selected element chip (set before modal opened via pick-first) */}
      {selectedElement && (
        <div className="flex items-start gap-2 bg-violet-50 border border-violet-100 rounded-lg px-3 py-2">
          <span className="text-violet-400 mt-0.5 shrink-0 text-sm">◎</span>
          <p className="flex-1 text-xs text-violet-800 line-clamp-2 min-w-0">
            {selectedElement.text.slice(0, 120)}
          </p>
          <button
            onClick={onClearSelectedElement}
            className="text-violet-300 hover:text-violet-500 shrink-0 mt-0.5"
            title="Remove selection"
          >
            <CloseIcon />
          </button>
        </div>
      )}

      {/* Recipient search */}
      {!selected ? (
        <div>
          <label className="text-xs text-gray-500 font-medium mb-1 block">Search members</label>
          <input
            type="text"
            placeholder="Name or organization…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200"
            autoFocus
          />
          {searching && <p className="text-xs text-gray-400 mt-1">Searching…</p>}
          {results.length > 0 && (
            <ul className="mt-1 border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100">
              {results.map((m) => (
                <li key={m.id}>
                  <button
                    onClick={() => { setSelected(m); setQuery(""); setResults([]); }}
                    className="w-full text-left px-3 py-2 hover:bg-blue-50 transition-colors"
                  >
                    <p className="text-sm font-medium text-gray-800">{m.display_name ?? m.email}</p>
                    {m.organization_name && (
                      <p className="text-xs text-gray-400">{m.organization_name}</p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {query.length >= 2 && !searching && results.length === 0 && (
            <p className="text-xs text-gray-400 mt-1">No members found.</p>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
          <div className="w-7 h-7 rounded-full bg-blue-200 flex items-center justify-center shrink-0">
            <span className="text-xs font-bold text-blue-700">
              {(selected.display_name ?? selected.email ?? "?").charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-800 truncate">{selected.display_name ?? selected.email}</p>
            {selected.organization_name && (
              <p className="text-xs text-gray-400 truncate">{selected.organization_name}</p>
            )}
          </div>
          <button
            onClick={() => setSelected(null)}
            className="text-gray-400 hover:text-gray-600 shrink-0"
          >
            <CloseIcon />
          </button>
        </div>
      )}

      {/* Note */}
      {selected && (
        <div>
          <label className="text-xs text-gray-500 font-medium mb-1 block">Message (optional)</label>
          <input
            type="text"
            placeholder="Add a personal note…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
        </div>
      )}

      {error && <p className="text-red-500 text-xs">{error}</p>}

      {selected && (
        <button
          onClick={handleSend}
          disabled={sending}
          className="w-full py-2.5 bg-[#163D6D] hover:bg-[#122f55] text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
        >
          {sending ? "Sending…" : `Send to ${selected.display_name ?? "member"}`}
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Explain — selection overlay + confirmation popover
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Share — selection overlay (same mechanics as Explain, violet colour)
// ─────────────────────────────────────────────────────────────────────────────

function ShareSelectionOverlay({
  onSelect,
  onSkip,
  onCancel,
  hoveredElement,
  setHoveredElement,
}: {
  onSelect: (element: { text: string; selector: string; endSelector?: string }) => void;
  onSkip: () => void;
  onCancel: () => void;
  hoveredElement: HTMLElement | null;
  setHoveredElement: (el: HTMLElement | null) => void;
}) {
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);
  const hoveredElementRef = useRef<HTMLElement | null>(null);
  const [dragRect, setDragRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const DRAG_THRESHOLD = 6;

  // Keep ref in sync with prop so stable handlers can read it
  useEffect(() => {
    hoveredElementRef.current = hoveredElement;
  }, [hoveredElement]);

  // Hover detection (separate effect — no dep on drag state)
  useEffect(() => {
    const isSelectable = (el: HTMLElement): boolean => {
      const tag = el.tagName.toLowerCase();
      if (["script", "style", "head", "html", "body"].includes(tag)) return false;
      if (el.closest("[data-toolkit]") || el.closest("[data-flag-overlay]")) return false;
      const text = el.textContent?.trim() ?? "";
      return !!text && text.length >= 3;
    };

    const findBestElement = (target: HTMLElement): HTMLElement | null => {
      let el: HTMLElement | null = target;
      while (el && el !== document.body) {
        if (isSelectable(el) && (el.textContent?.trim()?.length ?? 0) < 500) return el;
        el = el.parentElement;
      }
      return null;
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingRef.current) return; // suppress hover during drag
      const target = e.target as HTMLElement;
      if (target.closest("[data-toolkit]") || target.closest("[data-flag-overlay]")) {
        setHoveredElement(null);
        return;
      }
      setHoveredElement(findBestElement(target));
    };

    document.addEventListener("mousemove", handleMouseMove);
    return () => document.removeEventListener("mousemove", handleMouseMove);
  }, [setHoveredElement]);

  // Drag + click handler (stable — no dep on hoveredElement state)
  useEffect(() => {
    const collectInRect = (sel: { left: number; top: number; right: number; bottom: number }): HTMLElement[] => {
      const candidates = Array.from(
        document.querySelectorAll("p, h1, h2, h3, h4, h5, h6, td, th, li, span, a, dt, dd, label, div")
      ) as HTMLElement[];

      const inRect = candidates.filter((el) => {
        if (el.closest("[data-toolkit]") || el.closest("[data-flag-overlay]")) return false;
        const text = el.textContent?.trim() ?? "";
        if (!text || text.length < 3) return false;
        const r = el.getBoundingClientRect();
        return r.left < sel.right && r.right > sel.left && r.top < sel.bottom && r.bottom > sel.top;
      });

      // Keep only leaf-ish nodes (remove containers whose children are also captured)
      return inRect
        .filter((el, _, arr) => !arr.some((other) => other !== el && el.contains(other)))
        .sort((a, b) => {
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          return ra.top !== rb.top ? ra.top - rb.top : ra.left - rb.left;
        });
    };

    const handleMouseDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("[data-toolkit]") || (e.target as HTMLElement).closest("[data-flag-overlay]")) return;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      document.body.style.userSelect = "none";
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
        isDraggingRef.current = true;
        setDragRect({
          x: Math.min(e.clientX, dragStartRef.current.x),
          y: Math.min(e.clientY, dragStartRef.current.y),
          w: Math.abs(dx),
          h: Math.abs(dy),
        });
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      const start = dragStartRef.current;
      const wasDragging = isDraggingRef.current;
      dragStartRef.current = null;
      isDraggingRef.current = false;
      document.body.style.userSelect = "";
      setDragRect(null);

      if (!start) return;
      if ((e.target as HTMLElement).closest("[data-toolkit]") || (e.target as HTMLElement).closest("[data-flag-overlay]")) return;

      if (wasDragging) {
        const selRect = {
          left: Math.min(e.clientX, start.x),
          top:  Math.min(e.clientY, start.y),
          right: Math.max(e.clientX, start.x),
          bottom: Math.max(e.clientY, start.y),
        };
        const els = collectInRect(selRect);
        if (els.length === 0) return;

        const first = els[0];
        const last  = els[els.length - 1];
        const text  = els.map((el) => el.textContent?.trim()).filter(Boolean).join(" ").slice(0, 400);

        onSelect({
          text,
          selector: generateSelector(first),
          endSelector: last !== first ? generateSelector(last) : undefined,
        });
      } else {
        const hovered = hoveredElementRef.current;
        if (hovered) {
          e.preventDefault();
          e.stopPropagation();
          onSelect({
            text: hovered.textContent?.trim().slice(0, 300) ?? "",
            selector: generateSelector(hovered),
          });
        }
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
    };
  }, [onSelect]);

  // Keyboard cancel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  // Crosshair cursor
  useEffect(() => {
    document.body.style.cursor = "crosshair";
    return () => { document.body.style.cursor = ""; };
  }, []);

  return (
    <>
      {/* Instruction banner */}
      <div
        data-flag-overlay
        className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] bg-violet-600 text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-3 text-sm font-medium"
      >
        <ShareIcon />
        Click or drag to pick what to share
        <button
          onClick={onSkip}
          className="ml-1 px-2.5 py-0.5 rounded-full bg-white/20 hover:bg-white/30 text-white text-xs font-medium transition-colors"
        >
          Share whole page →
        </button>
        <span className="text-violet-200">ESC to cancel</span>
      </div>

      {/* Single-element hover highlight */}
      {hoveredElement && !dragRect && (
        <HighlightOverlay element={hoveredElement} color="violet" />
      )}

      {/* Rubber-band drag rectangle */}
      {dragRect && (
        <div
          data-flag-overlay
          className="fixed pointer-events-none z-[59]"
          style={{
            left: dragRect.x,
            top: dragRect.y,
            width: dragRect.w,
            height: dragRect.h,
            border: "2px solid #8B5CF6",
            backgroundColor: "rgba(139, 92, 246, 0.08)",
            borderRadius: "3px",
          }}
        />
      )}
    </>
  );
}

function ExplainSelectionOverlay({
  onSelect,
  onCancel,
  hoveredElement,
  setHoveredElement,
}: {
  onSelect: (element: { text: string; selector: string; rect: DOMRect; orgId?: string; endSelector?: string }) => void;
  onCancel: () => void;
  hoveredElement: HTMLElement | null;
  setHoveredElement: (el: HTMLElement | null) => void;
}) {
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);
  const hoveredElementRef = useRef<HTMLElement | null>(null);
  const [dragRect, setDragRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const DRAG_THRESHOLD = 6;

  useEffect(() => { hoveredElementRef.current = hoveredElement; }, [hoveredElement]);

  // Hover detection
  useEffect(() => {
    const isSelectable = (el: HTMLElement): boolean => {
      const tag = el.tagName.toLowerCase();
      if (["script", "style", "head", "html", "body"].includes(tag)) return false;
      if (el.closest("[data-toolkit]") || el.closest("[data-flag-overlay]")) return false;
      const text = el.textContent?.trim() ?? "";
      return !!text && text.length >= 3;
    };
    const findBestElement = (target: HTMLElement): HTMLElement | null => {
      let el: HTMLElement | null = target;
      while (el && el !== document.body) {
        if (isSelectable(el) && (el.textContent?.trim()?.length ?? 0) < 500) return el;
        el = el.parentElement;
      }
      return null;
    };
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingRef.current) return;
      const target = e.target as HTMLElement;
      if (target.closest("[data-toolkit]") || target.closest("[data-flag-overlay]")) {
        setHoveredElement(null);
        return;
      }
      setHoveredElement(findBestElement(target));
    };
    document.addEventListener("mousemove", handleMouseMove);
    return () => document.removeEventListener("mousemove", handleMouseMove);
  }, [setHoveredElement]);

  // Drag + click
  useEffect(() => {
    const collectInRect = (sel: { left: number; top: number; right: number; bottom: number }): HTMLElement[] => {
      const candidates = Array.from(
        document.querySelectorAll("p, h1, h2, h3, h4, h5, h6, td, th, li, span, a, dt, dd, label, div")
      ) as HTMLElement[];
      return candidates
        .filter((el) => {
          if (el.closest("[data-toolkit]") || el.closest("[data-flag-overlay]")) return false;
          const text = el.textContent?.trim() ?? "";
          if (!text || text.length < 3) return false;
          const r = el.getBoundingClientRect();
          return r.left < sel.right && r.right > sel.left && r.top < sel.bottom && r.bottom > sel.top;
        })
        .filter((el, _, arr) => !arr.some((other) => other !== el && el.contains(other)))
        .sort((a, b) => {
          const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
          return ra.top !== rb.top ? ra.top - rb.top : ra.left - rb.left;
        });
    };

    const handleMouseDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("[data-toolkit]") || (e.target as HTMLElement).closest("[data-flag-overlay]")) return;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      document.body.style.userSelect = "none";
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
        isDraggingRef.current = true;
        setDragRect({
          x: Math.min(e.clientX, dragStartRef.current.x),
          y: Math.min(e.clientY, dragStartRef.current.y),
          w: Math.abs(dx), h: Math.abs(dy),
        });
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      const start = dragStartRef.current;
      const wasDragging = isDraggingRef.current;
      dragStartRef.current = null;
      isDraggingRef.current = false;
      document.body.style.userSelect = "";
      setDragRect(null);
      if (!start) return;
      if ((e.target as HTMLElement).closest("[data-toolkit]") || (e.target as HTMLElement).closest("[data-flag-overlay]")) return;

      if (wasDragging) {
        const selRect = {
          left: Math.min(e.clientX, start.x), top: Math.min(e.clientY, start.y),
          right: Math.max(e.clientX, start.x), bottom: Math.max(e.clientY, start.y),
        };
        const els = collectInRect(selRect);
        if (els.length === 0) return;
        const first = els[0], last = els[els.length - 1];
        const rects = els.map((el) => el.getBoundingClientRect());
        const unionRect = new DOMRect(
          Math.min(...rects.map((r) => r.left)),
          Math.min(...rects.map((r) => r.top)),
          Math.max(...rects.map((r) => r.right)) - Math.min(...rects.map((r) => r.left)),
          Math.max(...rects.map((r) => r.bottom)) - Math.min(...rects.map((r) => r.top)),
        );
        onSelect({
          text: els.map((el) => el.textContent?.trim()).filter(Boolean).join(" ").slice(0, 400),
          selector: generateSelector(first),
          rect: unionRect,
          orgId: findOrgId(first),
          endSelector: last !== first ? generateSelector(last) : undefined,
        });
      } else {
        const hovered = hoveredElementRef.current;
        if (hovered) {
          e.preventDefault();
          e.stopPropagation();
          onSelect({
            text: hovered.textContent?.trim().slice(0, 300) ?? "",
            selector: generateSelector(hovered),
            rect: hovered.getBoundingClientRect(),
            orgId: findOrgId(hovered),
          });
        }
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
    };
  }, [onSelect]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  useEffect(() => {
    document.body.style.cursor = "crosshair";
    return () => { document.body.style.cursor = ""; };
  }, []);

  return (
    <>
      <div
        data-flag-overlay
        className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] bg-blue-500 text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2 text-sm font-medium"
      >
        <ExplainIcon />
        Click or drag to select what you&apos;d like explained
        <span className="text-blue-200 ml-2">ESC to cancel</span>
      </div>
      {hoveredElement && !dragRect && (
        <HighlightOverlay element={hoveredElement} color="blue" />
      )}
      {dragRect && (
        <div
          data-flag-overlay
          className="fixed pointer-events-none z-[59]"
          style={{
            left: dragRect.x, top: dragRect.y,
            width: dragRect.w, height: dragRect.h,
            border: "2px solid #3B82F6",
            backgroundColor: "rgba(59, 130, 246, 0.08)",
            borderRadius: "3px",
          }}
        />
      )}
    </>
  );
}

function ExplainConfirmationPopover({
  selectedElement,
  pathname,
  onClose,
  onBack,
}: {
  selectedElement: { text: string; selector: string; rect: DOMRect; orgId?: string; endSelector?: string };
  pathname: string;
  onClose: () => void;
  onBack: () => void;
}) {
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const popupStyle: React.CSSProperties = {
    position: "fixed",
    top: Math.min(selectedElement.rect.bottom + 12, window.innerHeight - 300),
    left: Math.max(16, Math.min(selectedElement.rect.left, window.innerWidth - 360)),
    width: Math.min(340, window.innerWidth - 32),
    zIndex: 70,
  };

  const handleSubmit = async () => {
    if (!note.trim()) { setError("Please describe what you'd like explained."); return; }
    setStatus("submitting");
    setError(null);
    const result = await submitExplainRequest({
      pageUrl: pathname,
      note: note.trim(),
      elementText: selectedElement.text,
      elementSelector: selectedElement.selector,
      organizationId: selectedElement.orgId,
    });
    if (result.success) {
      setStatus("done");
      setTimeout(onClose, 1800);
    } else {
      setError(result.error ?? "Failed to submit");
      setStatus("idle");
    }
  };

  return (
    <>
      {/* Blue highlight on the selected element */}
      <div
        className="fixed pointer-events-none z-[65] border-2 border-blue-400 bg-blue-400/20 rounded"
        style={{
          top: selectedElement.rect.top - 2,
          left: selectedElement.rect.left - 2,
          width: selectedElement.rect.width + 4,
          height: selectedElement.rect.height + 4,
        }}
      />

      <div style={popupStyle} className="bg-white rounded-xl shadow-2xl border border-blue-200 overflow-hidden">
        <div className="bg-blue-50 border-b border-blue-100 px-4 py-3 flex items-center gap-2">
          <ExplainIcon />
          <span className="text-sm font-semibold text-blue-800">What would you like explained?</span>
        </div>
        <div className="p-4 space-y-3">
          {selectedElement.text && (
            <div className="bg-gray-50 rounded-lg px-3 py-2 text-xs text-gray-500 italic line-clamp-2">
              "{selectedElement.text}"
            </div>
          )}

          {status === "done" ? (
            <div className="flex items-center gap-2 text-emerald-600 font-medium text-sm py-2">
              <CheckIcon />
              Sent — someone will follow up soon.
            </div>
          ) : (
            <>
              <textarea
                placeholder="What don't you understand about this? The more context, the better."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                autoFocus
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200 resize-none"
              />
              {error && <p className="text-red-500 text-xs">{error}</p>}
              <div className="flex gap-2">
                <button
                  onClick={handleSubmit}
                  disabled={status === "submitting"}
                  className="flex-1 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {status === "submitting" ? "Sending…" : "Send Request"}
                </button>
                <button
                  onClick={onBack}
                  className="px-3 py-2 border border-gray-200 text-gray-500 rounded-lg text-sm hover:bg-gray-50"
                >
                  Back
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BookmarkSelectionOverlay — pick-first selection for bookmarks (yellow theme)
// ─────────────────────────────────────────────────────────────────────────────

function BookmarkSelectionOverlay({
  onSelect,
  onSkip,
  onCancel,
  hoveredElement,
  setHoveredElement,
}: {
  onSelect: (element: { text: string; selector: string; endSelector?: string }) => void;
  onSkip: () => void;
  onCancel: () => void;
  hoveredElement: HTMLElement | null;
  setHoveredElement: (el: HTMLElement | null) => void;
}) {
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);
  const hoveredElementRef = useRef<HTMLElement | null>(null);
  const [dragRect, setDragRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const DRAG_THRESHOLD = 6;

  useEffect(() => { hoveredElementRef.current = hoveredElement; }, [hoveredElement]);

  // Hover detection (no dep on drag state)
  useEffect(() => {
    const isSelectable = (el: HTMLElement): boolean => {
      const tag = el.tagName.toLowerCase();
      if (["script", "style", "head", "html", "body"].includes(tag)) return false;
      if (el.closest("[data-toolkit]") || el.closest("[data-flag-overlay]")) return false;
      const text = el.textContent?.trim() ?? "";
      return !!text && text.length >= 3;
    };

    const findBestElement = (target: HTMLElement): HTMLElement | null => {
      let el: HTMLElement | null = target;
      while (el && el !== document.body) {
        if (isSelectable(el) && (el.textContent?.trim()?.length ?? 0) < 500) return el;
        el = el.parentElement;
      }
      return null;
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingRef.current) return;
      const target = e.target as HTMLElement;
      if (target.closest("[data-toolkit]") || target.closest("[data-flag-overlay]")) {
        setHoveredElement(null);
        return;
      }
      setHoveredElement(findBestElement(target));
    };

    document.addEventListener("mousemove", handleMouseMove);
    return () => document.removeEventListener("mousemove", handleMouseMove);
  }, [setHoveredElement]);

  // Drag + click handler (stable)
  useEffect(() => {
    const collectInRect = (sel: { left: number; top: number; right: number; bottom: number }): HTMLElement[] => {
      const candidates = Array.from(
        document.querySelectorAll("p, h1, h2, h3, h4, h5, h6, td, th, li, span, a, dt, dd, label, div")
      ) as HTMLElement[];

      const inRect = candidates.filter((el) => {
        if (el.closest("[data-toolkit]") || el.closest("[data-flag-overlay]")) return false;
        const text = el.textContent?.trim() ?? "";
        if (!text || text.length < 3) return false;
        const r = el.getBoundingClientRect();
        return r.left < sel.right && r.right > sel.left && r.top < sel.bottom && r.bottom > sel.top;
      });

      return inRect
        .filter((el, _, arr) => !arr.some((other) => other !== el && el.contains(other)))
        .sort((a, b) => {
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          return ra.top !== rb.top ? ra.top - rb.top : ra.left - rb.left;
        });
    };

    const handleMouseDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("[data-toolkit]") || (e.target as HTMLElement).closest("[data-flag-overlay]")) return;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      document.body.style.userSelect = "none";
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
        isDraggingRef.current = true;
        setDragRect({
          x: Math.min(e.clientX, dragStartRef.current.x),
          y: Math.min(e.clientY, dragStartRef.current.y),
          w: Math.abs(dx),
          h: Math.abs(dy),
        });
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      const start = dragStartRef.current;
      const wasDragging = isDraggingRef.current;
      dragStartRef.current = null;
      isDraggingRef.current = false;
      document.body.style.userSelect = "";
      setDragRect(null);

      if (!start) return;
      if ((e.target as HTMLElement).closest("[data-toolkit]") || (e.target as HTMLElement).closest("[data-flag-overlay]")) return;

      if (wasDragging) {
        const selRect = {
          left: Math.min(e.clientX, start.x),
          top:  Math.min(e.clientY, start.y),
          right: Math.max(e.clientX, start.x),
          bottom: Math.max(e.clientY, start.y),
        };
        const els = collectInRect(selRect);
        if (els.length === 0) return;

        const first = els[0];
        const last  = els[els.length - 1];
        const text  = els.map((el) => el.textContent?.trim()).filter(Boolean).join(" ").slice(0, 400);

        onSelect({
          text,
          selector: generateSelector(first),
          endSelector: last !== first ? generateSelector(last) : undefined,
        });
      } else {
        const hovered = hoveredElementRef.current;
        if (hovered) {
          e.preventDefault();
          e.stopPropagation();
          onSelect({
            text: hovered.textContent?.trim().slice(0, 300) ?? "",
            selector: generateSelector(hovered),
          });
        }
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
    };
  }, [onSelect]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  useEffect(() => {
    document.body.style.cursor = "crosshair";
    return () => { document.body.style.cursor = ""; };
  }, []);

  return (
    <>
      <div
        data-flag-overlay
        className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] bg-yellow-500 text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-3 text-sm font-medium"
      >
        <BookmarkIcon />
        Click or drag to pick what to bookmark
        <button
          onClick={onSkip}
          className="ml-1 px-2.5 py-0.5 rounded-full bg-white/20 hover:bg-white/30 text-white text-xs font-medium transition-colors"
        >
          Bookmark whole page →
        </button>
        <span className="text-yellow-100">ESC to cancel</span>
      </div>

      {hoveredElement && !dragRect && (
        <HighlightOverlay element={hoveredElement} color="yellow" />
      )}

      {dragRect && (
        <div
          data-flag-overlay
          className="fixed pointer-events-none z-[59]"
          style={{
            left: dragRect.x,
            top: dragRect.y,
            width: dragRect.w,
            height: dragRect.h,
            border: "2px solid #EAB308",
            backgroundColor: "rgba(234, 179, 8, 0.08)",
            borderRadius: "3px",
          }}
        />
      )}
    </>
  );
}

// Icons
function PlusIcon() {
  return (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function FlagIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={`w-5 h-5 ${className}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v1.5M3 21v-6m0 0 2.77-.693a9 9 0 0 1 6.208.682l.108.054a9 9 0 0 0 6.086.71l3.114-.732a48.524 48.524 0 0 1-.005-10.499l-3.11.732a9 9 0 0 1-6.085-.711l-.108-.054a9 9 0 0 0-6.208-.682L3 4.5M3 15V4.5" />
    </svg>
  );
}

function EditIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={`w-5 h-5 ${className}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
    </svg>
  );
}

function ExplainIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z" />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
    </svg>
  );
}

function PrintIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5Zm-3 0h.008v.008H15V10.5Z" />
    </svg>
  );
}

function CalendarPlusIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5m-9-6h.008v.008H12v-.008ZM12 15h.008v.008H12V15Zm0 2.25h.008v.008H12v-.008ZM9.75 15h.008v.008H9.75V15Zm0 2.25h.008v.008H9.75v-.008ZM7.5 15h.008v.008H7.5V15Zm0 2.25h.008v.008H7.5v-.008Zm6.75-4.5h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V15Zm0 2.25h.008v.008h-.008v-.008Zm2.25-4.5h.008v.008H16.5v-.008Zm0 2.25h.008v.008H16.5V15Z" />
    </svg>
  );
}

function BookmarkIcon({ filled = false }: { filled?: boolean }) {
  return (
    <svg className="w-5 h-5" fill={filled ? "currentColor" : "none"} viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}

function WrenchIcon() {
  return (
    <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437 1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008Z" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ReviewOverlay — second-signer in-context approve/reject UI
// Activated when ?review_token= is present and validates successfully.
// Positions itself anchored to the field element on the page.
// ─────────────────────────────────────────────────────────────────────────────

function ReviewOverlay({
  change,
  rawToken,
  onApproved,
  onRejected,
}: {
  change: PendingContentChange;
  rawToken: string;
  onApproved: () => void;
  onRejected: () => void;
}) {
  const [status, setStatus] = useState<"idle" | "approving" | "rejecting" | "done_approve" | "done_reject">("idle");
  const [rejectNote, setRejectNote] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  // Find the anchor element and get its position
  useEffect(() => {
    if (!change.anchor_id) return;
    const el = document.getElementById(change.anchor_id);
    if (el) {
      setAnchorRect(el.getBoundingClientRect());
    }
  }, [change.anchor_id]);

  const handleApprove = async () => {
    setStatus("approving");
    setError(null);
    // Consume the token first — prevents replay even if the approve call fails midway
    const consumed = await consumeReviewToken(rawToken);
    if (!consumed.ok) {
      setError("This review link has already been used.");
      setStatus("idle");
      return;
    }
    const result = await approvePendingChange(change.id);
    if (result.success) {
      setStatus("done_approve");
      setTimeout(onApproved, 1500);
    } else {
      setError(result.error ?? "Failed to approve");
      setStatus("idle");
    }
  };

  const handleReject = async () => {
    setStatus("rejecting");
    setError(null);
    // Consume the token first
    const consumed = await consumeReviewToken(rawToken);
    if (!consumed.ok) {
      setError("This review link has already been used.");
      setStatus("idle");
      return;
    }
    const result = await rejectPendingChange(change.id, { note: rejectNote || undefined });
    if (result.success) {
      setStatus("done_reject");
      setTimeout(onRejected, 1500);
    } else {
      setError(result.error ?? "Failed to reject");
      setStatus("idle");
    }
  };

  const isActing = status === "approving" || status === "rejecting";
  const previousVal = change.previous_value !== null ? String(change.previous_value) : "—";
  const proposedVal = change.proposed_value !== null ? String(change.proposed_value) : "—";

  // Anchor the panel just below the target element, or fixed center if element not found
  const panelStyle: React.CSSProperties = anchorRect
    ? {
        position: "fixed",
        top: Math.min(anchorRect.bottom + 12, window.innerHeight - 280),
        left: Math.max(16, Math.min(anchorRect.left, window.innerWidth - 420)),
        width: Math.min(400, window.innerWidth - 32),
        zIndex: 70,
      }
    : {
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: Math.min(400, window.innerWidth - 32),
        zIndex: 70,
      };

  return (
    <>
      {/* Amber highlight on the target element */}
      {anchorRect && (
        <div
          className="fixed pointer-events-none z-[65] border-2 border-amber-400 bg-amber-400/20 rounded"
          style={{
            top: anchorRect.top - 2,
            left: anchorRect.left - 2,
            width: anchorRect.width + 4,
            height: anchorRect.height + 4,
          }}
        />
      )}

      {/* Review panel */}
      <div style={panelStyle} className="bg-white rounded-lg shadow-2xl border border-amber-200 overflow-hidden">
        {/* Header */}
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 flex items-center gap-2">
          <svg className="w-4 h-4 text-amber-600 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
          </svg>
          <span className="text-sm font-semibold text-amber-800">Content Change Awaiting Approval</span>
        </div>

        <div className="p-4 space-y-3">
          {/* Field context */}
          <div className="text-xs text-gray-500 uppercase tracking-wider font-medium">
            {change.field_display_label ?? change.target_column} — {change.entity_display_name}
          </div>

          {/* Before / After */}
          <div className="space-y-1.5">
            <div className="flex gap-2 items-start">
              <span className="text-xs font-medium text-gray-400 w-14 shrink-0 pt-0.5">Before</span>
              <span className="text-sm text-gray-400 line-through break-all">{previousVal}</span>
            </div>
            <div className="flex gap-2 items-start">
              <span className="text-xs font-medium text-gray-400 w-14 shrink-0 pt-0.5">After</span>
              <span className="text-sm font-semibold text-gray-900 break-all">{proposedVal}</span>
            </div>
          </div>

          {error && (
            <div className="text-red-600 text-xs bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>
          )}

          {/* Done states */}
          {status === "done_approve" && (
            <div className="flex items-center gap-2 text-emerald-600 font-medium text-sm">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
              Approved — change is now live.
            </div>
          )}
          {status === "done_reject" && (
            <div className="flex items-center gap-2 text-gray-500 font-medium text-sm">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
              Rejected — requester has been notified.
            </div>
          )}

          {/* Reject note input */}
          {showRejectInput && status === "idle" && (
            <div className="space-y-2">
              <textarea
                placeholder="Rejection note (optional)..."
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                rows={2}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-300 resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleReject}
                  className="flex-1 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Confirm Rejection
                </button>
                <button
                  onClick={() => setShowRejectInput(false)}
                  className="px-3 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm transition-colors hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Action buttons */}
          {!showRejectInput && status !== "done_approve" && status !== "done_reject" && (
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleApprove}
                disabled={isActing}
                className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {status === "approving" ? "Approving..." : "Approve"}
              </button>
              <button
                onClick={() => setShowRejectInput(true)}
                disabled={isActing}
                className="flex-1 py-2 border border-red-300 text-red-600 hover:bg-red-50 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Reject
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
