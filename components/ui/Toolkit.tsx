"use client";

import { useState, useEffect, useCallback, useRef, createContext, useContext, ReactNode } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { usePathname, useRouter } from "next/navigation";
import CreateEventModal from "@/components/toolkit/CreateEventModal";
import { submitFlag } from "@/lib/actions/submit-flag";
import { updateField } from "@/lib/actions/update-field";
import { addContact } from "@/lib/actions/add-contact";
import { deleteContact } from "@/lib/actions/delete-contact";
import { addBrandColor } from "@/lib/actions/add-brand-color";
import { deleteBrandColor } from "@/lib/actions/delete-brand-color";
import { uploadOrganizationImage } from "@/lib/actions/upload-organization-image";

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

  // Check if user is a super_admin (can edit anything)
  const isSuperAdmin = profile?.global_role === "super_admin";

  // Get org IDs where user is org_admin
  const orgAdminOrgIds = organizations
    ?.filter((uo) => uo.role === "org_admin")
    ?.map((uo) => uo.organization.id) || [];

  // Function to check if user can edit a specific org
  const canEditOrg = useCallback((orgId: string): boolean => {
    return isSuperAdmin || orgAdminOrgIds.includes(orgId);
  }, [isSuperAdmin, orgAdminOrgIds]);

  // User can see Edit tool if they're super_admin OR org_admin for any org
  const isAdmin = isSuperAdmin || orgAdminOrgIds.length > 0;

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
  const { user, profile } = useAuth();
  const { editMode, setEditMode, isAdmin, canEditOrg } = useToolkit();

  // Users eligible to create events (not partner, not unauthenticated)
  const canCreateEvent =
    !!user &&
    !!profile &&
    !["partner"].includes(profile.global_role ?? "");
  const pathname = usePathname();
  const router = useRouter();
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeTool, setActiveTool] = useState<"flag" | "edit" | "explain" | "share" | "export" | "bookmark" | "create_event" | null>(null);

  // Flag selection mode state
  const [flagMode, setFlagMode] = useState(false);
  const [hoveredElement, setHoveredElement] = useState<HTMLElement | null>(null);
  const [selectedElement, setSelectedElement] = useState<{
    text: string;
    selector: string;
    rect: DOMRect;
  } | null>(null);

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
  } | null>(null);

  // Non-logged-in users: show a "Join CSC" FAB on key pages
  if (!user) {
    const showJoinPages = ["/", "/members", "/partners"];
    if (!showJoinPages.includes(pathname)) return null;
    return (
      <a
        href="/apply/member"
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
      return;
    }
    setActiveTool(tool);
    setIsExpanded(false);
  };

  const handleClose = () => {
    setActiveTool(null);
    setFlagMode(false);
    setEditMode(false);
    setSelectedElement(null);
    setHoveredElement(null);
    setEditSelectedElement(null);
    setEditHoveredElement(null);
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

      {/* Floating Toolkit Button */}
      <div className="fixed bottom-8 right-8 z-40 flex flex-col-reverse items-center gap-2">
        {/* Tool buttons (shown when expanded) */}
        {isExpanded && !flagMode && !editMode && (
          <div className="flex flex-col gap-2 mb-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
            {/* Bookmark */}
            <ToolButton
              icon={<BookmarkIcon />}
              label="Bookmark"
              onClick={() => handleToolClick("bookmark")}
              disabled
            />

            {/* Export */}
            <ToolButton
              icon={<ExportIcon />}
              label="Export"
              onClick={() => handleToolClick("export")}
              disabled
            />

            {/* Share */}
            <ToolButton
              icon={<ShareIcon />}
              label="Share"
              onClick={() => handleToolClick("share")}
              disabled
            />

            {/* Explain */}
            <ToolButton
              icon={<ExplainIcon />}
              label="Explain"
              onClick={() => handleToolClick("explain")}
              disabled
            />

            {/* Edit - Only for admins */}
            {isAdmin && (
              <ToolButton
                icon={<EditIcon />}
                label="Edit"
                onClick={() => handleToolClick("edit")}
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

        {/* Main FAB - changes to cancel button when in flag or edit mode */}
        {flagMode || editMode ? (
          <button
            onClick={handleClose}
            className={`w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-105 ${
              editMode ? "bg-emerald-500 hover:bg-emerald-600" : "bg-red-500 hover:bg-red-600"
            } text-white`}
            title={editMode ? "Cancel editing" : "Cancel flagging"}
          >
            <CloseIcon />
          </button>
        ) : (
          <button
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

      {/* Other Tool Modals */}
      {activeTool === "explain" && (
        <ComingSoonModal tool="Explain" onClose={handleClose} />
      )}

      {activeTool === "share" && (
        <ComingSoonModal tool="Share" onClose={handleClose} />
      )}

      {activeTool === "export" && (
        <ComingSoonModal tool="Export" onClose={handleClose} />
      )}

      {activeTool === "bookmark" && (
        <ComingSoonModal tool="Bookmark" onClose={handleClose} />
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
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-10 h-10 rounded-full shadow-lg flex items-center justify-center transition-all group relative ${
        disabled
          ? "bg-gray-200 text-gray-400 cursor-not-allowed"
          : "bg-white hover:bg-gray-50 text-gray-600 hover:scale-105"
      }`}
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
 * Flag Selection Overlay - User clicks on elements to flag them
 */
function FlagSelectionOverlay({
  onSelect,
  onCancel,
  hoveredElement,
  setHoveredElement,
}: {
  onSelect: (element: { text: string; selector: string; rect: DOMRect }) => void;
  onCancel: () => void;
  hoveredElement: HTMLElement | null;
  setHoveredElement: (el: HTMLElement | null) => void;
}) {
  useEffect(() => {
    /**
     * Check if an element contains flaggable (dynamic) content.
     * We only want to flag data-driven content, not static UI labels.
     */
    const isFlaggableElement = (el: HTMLElement): boolean => {
      // Must have data-flaggable attribute to be flaggable
      // This is opt-in: components must mark their dynamic content
      if (el.hasAttribute('data-flaggable')) {
        return true;
      }

      // Check if any parent has data-flaggable
      const flaggableParent = el.closest('[data-flaggable]');
      if (flaggableParent) {
        return true;
      }

      return false;
    };

    /**
     * Find the best flaggable element at or above the target.
     * Prefers the most specific (innermost) flaggable element.
     */
    const findFlaggableElement = (target: HTMLElement): HTMLElement | null => {
      // First check if the target itself is flaggable
      if (target.hasAttribute('data-flaggable')) {
        return target;
      }

      // Look for the closest flaggable ancestor (innermost first)
      const flaggable = target.closest('[data-flaggable]') as HTMLElement | null;
      return flaggable;
    };

    const handleMouseMove = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // Ignore toolkit elements
      if (target.closest('[data-toolkit]') || target.closest('[data-flag-overlay]')) {
        setHoveredElement(null);
        return;
      }

      // Find the flaggable element (if any)
      const flaggable = findFlaggableElement(target);

      if (flaggable) {
        setHoveredElement(flaggable);
      } else {
        setHoveredElement(null);
      }
    };

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // Ignore toolkit elements
      if (target.closest('[data-toolkit]') || target.closest('[data-flag-overlay]')) {
        return;
      }

      // Only proceed if we have a flaggable element hovered
      if (hoveredElement) {
        e.preventDefault();
        e.stopPropagation();

        const text = hoveredElement.textContent?.trim().slice(0, 200) || '';
        const selector = generateSelector(hoveredElement);
        const rect = hoveredElement.getBoundingClientRect();

        onSelect({ text, selector, rect });
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
  }, [hoveredElement, onSelect, onCancel, setHoveredElement]);

  return (
    <>
      {/* Instruction banner */}
      <div
        data-flag-overlay
        className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] bg-amber-500 text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2 text-sm font-medium"
      >
        <FlagIcon className="w-4 h-4" />
        Click on something to flag it
        <span className="text-amber-200 ml-2">ESC to cancel</span>
      </div>

      {/* Highlight overlay for hovered element */}
      {hoveredElement && (
        <HighlightOverlay element={hoveredElement} />
      )}
    </>
  );
}

/**
 * Highlight overlay that follows the hovered element
 */
function HighlightOverlay({ element }: { element: HTMLElement }) {
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
      data-flag-overlay
      className="fixed pointer-events-none z-[55] border-2 border-amber-500 bg-amber-500/10 rounded transition-all duration-75"
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
 * Generate a CSS selector for an element (for reference)
 */
function generateSelector(element: HTMLElement): string {
  const parts: string[] = [];
  let current: HTMLElement | null = element;

  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();

    if (current.id) {
      selector += `#${current.id}`;
      parts.unshift(selector);
      break;
    }

    if (current.className && typeof current.className === 'string') {
      const classes = current.className.split(' ').filter(c => c && !c.startsWith('hover:'));
      if (classes.length > 0) {
        selector += `.${classes.slice(0, 2).join('.')}`;
      }
    }

    parts.unshift(selector);
    current = current.parentElement;

    if (parts.length > 4) break;
  }

  return parts.join(' > ');
}

/**
 * Flag Confirmation Bubbles - Quick tap to submit with priority
 * ‼️ = high priority, ↗️ = normal priority
 */
function FlagConfirmationPopover({
  selectedElement,
  pathname,
  onClose,
}: {
  selectedElement: { text: string; selector: string; rect: DOMRect };
  pathname: string;
  onClose: () => void;
  onBack: () => void;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (priority: "normal" | "high") => {
    setIsSubmitting(true);

    try {
      const result = await submitFlag({
        pageUrl: pathname,
        priority,
        elementSelector: selectedElement.selector,
        elementContent: selectedElement.text,
      });

      if (result.success) {
        setSubmitted(true);
        setTimeout(onClose, 800);
      }
    } catch {
      // Silent fail - just close
      onClose();
    }
  };

  // Position bubbles near the selected element (to the right or below)
  const bubbleStyle = {
    top: selectedElement.rect.top + selectedElement.rect.height / 2 - 20,
    left: selectedElement.rect.right + 8,
  };

  // If bubbles would go off-screen, position below instead
  const offScreenRight = bubbleStyle.left + 100 > window.innerWidth;
  if (offScreenRight) {
    bubbleStyle.top = selectedElement.rect.bottom + 8;
    bubbleStyle.left = selectedElement.rect.left;
  }

  return (
    <>
      {/* Light backdrop - click to cancel */}
      <div
        data-flag-overlay
        className="fixed inset-0 z-[55]"
        onClick={() => !isSubmitting && onClose()}
      />

      {/* Highlight the selected element */}
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

      {/* Quick action bubbles */}
      <div
        data-flag-overlay
        className="fixed z-[60] flex gap-2"
        style={bubbleStyle}
      >
        {submitted ? (
          <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center text-white text-lg shadow-lg animate-in zoom-in duration-150">
            ✓
          </div>
        ) : isSubmitting ? (
          <div className="w-10 h-10 bg-gray-400 rounded-full flex items-center justify-center text-white shadow-lg animate-pulse">
            •••
          </div>
        ) : (
          <>
            {/* Normal priority */}
            <button
              onClick={() => handleSubmit("normal")}
              className="w-10 h-10 bg-white hover:bg-gray-50 rounded-full flex items-center justify-center text-lg shadow-lg border border-gray-200 transition-transform hover:scale-110"
              title="Flag (normal)"
            >
              ↗️
            </button>
            {/* High priority */}
            <button
              onClick={() => handleSubmit("high")}
              className="w-10 h-10 bg-white hover:bg-red-50 rounded-full flex items-center justify-center text-lg shadow-lg border border-gray-200 transition-transform hover:scale-110"
              title="Flag (urgent)"
            >
              ‼️
            </button>
          </>
        )}
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
    return (
      <AddContactPopover
        selectedElement={selectedElement}
        onClose={onClose}
        onSuccess={onSuccess}
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
    return (
      <ImageUploadPopover
        selectedElement={selectedElement}
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
function FieldEditPopover({
  selectedElement,
  onClose,
  onSuccess,
}: {
  selectedElement: { text: string; field: string; entityId: string; rect: DOMRect };
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [value, setValue] = useState(selectedElement.text);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Parse field into table and column
  const [table, column] = selectedElement.field.split('.') as [string, string];

  const handleSubmit = async () => {
    if (value === selectedElement.text) {
      // No change, just close
      onClose();
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const result = await updateField({
        table: table as "organizations" | "contacts" | "brand_colors" | "benchmarking",
        column,
        entityId: selectedElement.entityId,
        newValue: value || null,
      });

      if (result.success) {
        setSubmitted(true);
        setTimeout(onSuccess, 600);
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
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  // Position input near the selected element
  const popoverStyle = {
    top: selectedElement.rect.bottom + 8,
    left: Math.max(16, selectedElement.rect.left),
  };

  // If would go off bottom, position above
  if (popoverStyle.top + 60 > window.innerHeight) {
    popoverStyle.top = selectedElement.rect.top - 60;
  }

  // Ensure doesn't go off right edge
  const maxWidth = Math.min(400, window.innerWidth - popoverStyle.left - 16);

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
        {submitted ? (
          <div className="flex items-center gap-2 text-emerald-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
            <span className="font-medium">Saved!</span>
          </div>
        ) : (
          <>
            <div className="text-xs text-gray-400 mb-1 uppercase tracking-wider">
              {column.replace(/_/g, ' ')}
            </div>
            <div className="flex gap-2">
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
 * Add Contact Popover - Form for adding a new contact
 */
function AddContactPopover({
  selectedElement,
  onClose,
  onSuccess,
}: {
  selectedElement: { rect: DOMRect; organizationId?: string };
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [phone, setPhone] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Focus name input on mount
  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }

    if (!selectedElement.organizationId) {
      setError("Organization not found");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const result = await addContact({
        organizationId: selectedElement.organizationId,
        name: name.trim(),
        workEmail: email.trim() || undefined,
        roleTitle: role.trim() || undefined,
        workPhoneNumber: phone.trim() || undefined,
      });

      if (result.success) {
        setAdded(true);
        setTimeout(onSuccess, 600);
      } else {
        setError(result.error || "Failed to add contact");
        setIsSubmitting(false);
      }
    } catch {
      setError("An error occurred");
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
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

  if (popoverStyle.top + 200 > window.innerHeight) {
    popoverStyle.top = Math.max(16, selectedElement.rect.top - 220);
  }

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

      {/* Add contact form popover */}
      <div
        data-edit-overlay
        className="fixed z-[60] bg-white rounded-lg shadow-xl border border-gray-200 p-4 w-80"
        style={popoverStyle}
      >
        {added ? (
          <div className="flex items-center gap-2 text-emerald-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
            <span className="font-medium">Contact added!</span>
          </div>
        ) : (
          <>
            <div className="text-sm font-medium text-gray-700 mb-3">
              Add New Contact
            </div>
            <div className="space-y-2">
              <input
                ref={nameInputRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isSubmitting}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent disabled:bg-gray-100"
                placeholder="Name *"
              />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isSubmitting}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent disabled:bg-gray-100"
                placeholder="Email"
              />
              <input
                type="text"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isSubmitting}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent disabled:bg-gray-100"
                placeholder="Role/Title"
              />
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isSubmitting}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent disabled:bg-gray-100"
                placeholder="Phone"
              />
            </div>
            <div className="flex gap-2 mt-3">
              <button
                onClick={onClose}
                disabled={isSubmitting}
                className="flex-1 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="flex-1 px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
              >
                {isSubmitting ? "..." : "Add Contact"}
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

function CalendarPlusIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5m-9-6h.008v.008H12v-.008ZM12 15h.008v.008H12V15Zm0 2.25h.008v.008H12v-.008ZM9.75 15h.008v.008H9.75V15Zm0 2.25h.008v.008H9.75v-.008ZM7.5 15h.008v.008H7.5V15Zm0 2.25h.008v.008H7.5v-.008Zm6.75-4.5h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V15Zm0 2.25h.008v.008h-.008v-.008Zm2.25-4.5h.008v.008H16.5v-.008Zm0 2.25h.008v.008H16.5V15Z" />
    </svg>
  );
}

function BookmarkIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
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
