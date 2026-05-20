/**
 * Partner Links — types, visibility logic, and server-side resolution.
 *
 * partner_links is stored as a JSONB array on organizations.
 * Each entry is a PartnerLink; the server resolves visible entries per viewer.
 */

import type { ViewerLevel } from "@/lib/visibility/defaults";

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export type PartnerLinkType =
  | "catalogue"
  | "price_list"
  | "order_portal"
  | "line_sheet"
  | "custom";

/**
 * Who can see this link:
 *   public    — everyone, including unauthenticated visitors
 *   member    — members, org_admins, admins, super_admins
 *   org_admin — org_admins, admins, super_admins only
 */
export type PartnerLinkVisibility = "public" | "member" | "org_admin";

export interface PartnerLink {
  /** Client-generated UUID */
  id: string;
  type: PartnerLinkType;
  /** Human-readable label, e.g. "Spring 2026 Catalogue" */
  label: string;
  visibility: PartnerLinkVisibility;
  /**
   * External URL. Mutually exclusive with storage_path.
   * For order portals, custom links, etc.
   */
  url?: string;
  /**
   * Supabase Storage path in the partner-documents bucket.
   * Mutually exclusive with url.
   * The server generates a short-lived signed URL before passing to the client.
   */
  storage_path?: string;
}

/**
 * A PartnerLink that has been resolved for display — storage_path has been
 * replaced with a time-limited signed_url; the raw path is never sent to the client.
 */
export interface ResolvedPartnerLink {
  id: string;
  type: PartnerLinkType;
  label: string;
  visibility: PartnerLinkVisibility;
  /** The URL to open — either the original external url or a signed URL */
  href: string;
  /** true if the href is a signed URL for a stored document */
  isDocument: boolean;
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export const LINK_TYPE_LABELS: Record<PartnerLinkType, string> = {
  catalogue:    "Catalogue",
  price_list:   "Price List",
  order_portal: "Order Portal",
  line_sheet:   "Line Sheet",
  custom:       "Link",
};

export const LINK_TYPE_ICONS: Record<PartnerLinkType, string> = {
  catalogue:    "📄",
  price_list:   "💲",
  order_portal: "🛒",
  line_sheet:   "📋",
  custom:       "🔗",
};

export const VISIBILITY_LABELS: Record<PartnerLinkVisibility, string> = {
  public:    "Everyone",
  member:    "Members only",
  org_admin: "Admins only",
};

// ---------------------------------------------------------------------------
// Visibility logic
// ---------------------------------------------------------------------------

/**
 * Numeric rank per viewer level — higher is more privileged.
 * Matches the hierarchy in lib/visibility/viewer.ts.
 */
const VIEWER_RANK: Record<ViewerLevel, number> = {
  public:      0,
  authenticated: 1,
  partner:     2,
  member:      3,
  org_admin:   4,
  admin:       5,
  super_admin: 6,
};

/** Minimum viewer rank required for each visibility tier. */
const VISIBILITY_RANK: Record<PartnerLinkVisibility, number> = {
  public:    0,
  member:    3, // member rank
  org_admin: 4, // org_admin rank
};

export function canViewLink(
  link: PartnerLink,
  viewerLevel: ViewerLevel
): boolean {
  return VIEWER_RANK[viewerLevel] >= VISIBILITY_RANK[link.visibility];
}

/**
 * Returns true if the viewer has member-level access or above.
 * Used for the "gated" UI state decisions.
 */
export function isMemberOrAbove(viewerLevel: ViewerLevel): boolean {
  return VIEWER_RANK[viewerLevel] >= VIEWER_RANK["member"];
}

export function isPartnerViewer(viewerLevel: ViewerLevel): boolean {
  return viewerLevel === "partner";
}

// ---------------------------------------------------------------------------
// Parse raw JSONB safely
// ---------------------------------------------------------------------------

export function parsePartnerLinks(raw: unknown): PartnerLink[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is PartnerLink =>
      item !== null &&
      typeof item === "object" &&
      typeof (item as PartnerLink).id === "string" &&
      typeof (item as PartnerLink).type === "string" &&
      typeof (item as PartnerLink).label === "string"
  );
}
