/**
 * Single source of truth for inline-editable fields.
 *
 * SECURITY: This allowlist is enforced server-side in update-field.ts.
 * Adding a column here does NOT make it editable until the server action
 * also references this map — which it does by importing EDITABLE_COLUMNS.
 *
 * TIERS:
 *   Tier 1 — org-scoped, low blast radius. Writes immediately.
 *             When called from an org page (orgId provided), ALL fields are Tier 1.
 *   Tier 2 — site-wide / public URLs / images. Requires second-signer approval
 *             when edited outside an org page context (e.g. site_content, static pages).
 *             On org pages, Tier 2 fields write immediately but send a super_admin FYI.
 */

export const EDITABLE_COLUMNS = {
  organizations: [
    "company_description",
    "website",
    "email",
    "phone",
    "square_footage",
    "fte",
    "logo_url",
    "logo_horizontal_url",
    "hero_image_url",
    "product_overlay_url",
    "action_link_text",
    "action_link_url",
    "primary_category",
    "highlight_product_name",
    "highlight_product_description",
    "highlight_the_deal",
  ],
  contacts: [
    "name",
    "work_email",
    "email",
    "role_title",
    "work_phone_number",
    "phone",
    "profile_picture_url",
  ],
  brand_colors: [
    "hex",
    "name",
  ],
  benchmarking: [
    "enrollment_fte",
    "num_store_locations",
    "institution_type",
    "pos_system",
    "total_square_footage",
    "fulltime_employees",
  ],
  site_content: [
    "title",
    "subtitle",
    "body",
    "image_url",
    "cta_text",
    "cta_url",
  ],
} as const;

export type EditableTable = keyof typeof EDITABLE_COLUMNS;
export type EditableColumn<T extends EditableTable> = typeof EDITABLE_COLUMNS[T][number];

/**
 * Tier 2 fields require second-signer approval when edited outside org-page context.
 * On org pages (orgId provided to updateField), these write immediately + send FYI.
 * Fields in TIER2_TABLES are all Tier 2 by definition.
 */
export const TIER2_FIELDS = new Set<string>([
  "organizations.website",
  "organizations.logo_url",
  "organizations.logo_horizontal_url",
  "organizations.hero_image_url",
  "organizations.product_overlay_url",
  "organizations.action_link_text",
  "organizations.action_link_url",
]);

export const TIER2_TABLES = new Set<EditableTable>(["site_content"]);

/** Fields that only a super_admin can approve (not regular admin). */
export const SUPER_ADMIN_ONLY_APPROVAL = new Set<string>([
  "organizations.action_link_url",
  "organizations.action_link_text",
  "site_content.cta_url",
  "site_content.cta_text",
  // slot → contact assignment: super_admin writes directly via assignSlotContact()
  // (not routed through the inline editor / pending queue)
  "site_content.contact_id",
]);

export function isTier2(table: EditableTable, column: string): boolean {
  if (TIER2_TABLES.has(table)) return true;
  return TIER2_FIELDS.has(`${table}.${column}`);
}

export function requiresSuperAdminApproval(table: EditableTable, column: string): boolean {
  return SUPER_ADMIN_ONLY_APPROVAL.has(`${table}.${column}`);
}

/**
 * Derives the stable HTML anchor ID for a given editable field instance.
 * Used in both the email deep-link and the rendered element's id attribute.
 *
 * Format: review-{table}-{column}-{entityId}
 * e.g.   review-site_content-hero_title-a3f2b1c4...
 *
 * Safe for HTML5 id attributes (UUIDs contain only [0-9a-f-] which are valid).
 */
export function editAnchorId(
  table: string,
  column: string,
  entityId: string
): string {
  return `review-${table}-${column}-${entityId}`;
}

/**
 * Returns the standard HTML attributes for an inline-editable field element.
 *
 * Use this plain function (not the hook) when rendering inside loops or
 * when memoization is unnecessary. Spread the result onto any element:
 *
 *   <span {...fieldProps("organizations", "email", org.id, org.id)}>
 *
 * For React components that benefit from memoization, use the `useEditableField`
 * hook in hooks/useEditableField.ts instead.
 */
export function fieldProps<T extends EditableTable>(
  table: T,
  column: EditableColumn<T>,
  entityId: string,
  /** Pass the org's UUID when this field is on an org page (/org/[slug]).
   *  Org-page edits bypass the second-signer queue and write immediately. */
  orgId?: string
): {
  id: string;
  "data-field": string;
  "data-entity-id": string;
  "data-flaggable": true;
  "data-org-id"?: string;
} {
  return {
    id: editAnchorId(table, column as string, entityId),
    "data-field": `${table}.${column}`,
    "data-entity-id": entityId,
    "data-flaggable": true,
    ...(orgId ? { "data-org-id": orgId } : {}),
  };
}

/**
 * Human-readable label for a column name.
 * Converts snake_case to Title Case, e.g. "action_link_url" → "Action Link URL"
 */
export function fieldDisplayLabel(column: string): string {
  return column
    .split("_")
    .map((word) => {
      // Keep common abbreviations uppercase
      if (["url", "fte", "pos", "id"].includes(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}
