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
    "banner_url",
    "product_overlay_url",
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
  // The full set of figures the org page renders, so a store can correct any
  // of its own results between cycles. Editing these is gated further in
  // update-field: only the store's newest year, and never while that year's
  // survey is open — see lib/benchmarking/manual-edit.ts. Every write here is
  // recorded as an amendment.
  //
  // Deliberately absent: derived values (sales per FTE, margins — computed, not
  // stored), workflow columns (status, submitted_at, amended_at, verified_by),
  // and disclosure_level, which has its own control with its own consequences.
  benchmarking: [
    // Store profile
    "enrollment_fte",
    "num_store_locations",
    "institution_type",
    "pos_system",
    "total_square_footage",
    // Sales
    "total_gross_sales_instore",
    "total_online_sales",
    "sales_course_supplies",
    "sales_course_supplies_online",
    "sales_general_books",
    "sales_technology",
    "sales_stationary",
    "sales_custom_merch",
    "sales_food_beverage",
    // Expenses and financials
    "net_profit",
    "total_cogs",
    "expense_hr",
    "expense_rent_maintenance",
    "marketing_spend",
    "central_funding",
    // Staffing
    "fulltime_employees",
    "parttime_fte_offpeak",
    "student_fte_average",
    "manager_years_current_position",
    "manager_years_in_industry",
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
  "organizations.banner_url",
  "organizations.product_overlay_url",
]);

export const TIER2_TABLES = new Set<EditableTable>(["site_content"]);

// organizations.action_link_url / action_link_text were allowlisted here (and
// flagged super_admin-only-approval) for a CTA feature that was never built:
// no component renders either column, and all 210 org rows hold NULL. Removed
// rather than left standing — this allowlist is a security boundary, and a
// writable field nothing displays is only a liability. Re-add both, in all
// three sets, if the CTA ships. They remain in lib/visibility/defaults.ts's
// public_allowlist, which is only about masking and costs nothing.

/** Fields that only a super_admin can approve (not regular admin). */
export const SUPER_ADMIN_ONLY_APPROVAL = new Set<string>([
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
  orgId?: string,
  /** The stored value, when what the element displays is a formatted version of
   *  it. The editor seeds its input from this instead of the rendered text.
   *  Without it, "$1.2M" or "12,500 sq ft" is what gets parsed and sent. */
  rawValue?: string | number | null
): {
  id: string;
  "data-field": string;
  "data-entity-id": string;
  "data-flaggable": true;
  "data-org-id"?: string;
  "data-organization-id"?: string;
  "data-raw-value"?: string;
} {
  return {
    id: editAnchorId(table, column as string, entityId),
    "data-field": `${table}.${column}`,
    "data-entity-id": entityId,
    "data-flaggable": true,
    // Both spellings on purpose, and they are read by different features:
    // submit-flag walks up to the nearest [data-org-id], while the Toolkit's
    // edit overlay reads [data-organization-id] off the element itself. Only
    // the first was ever emitted here, so every inline edit looked to
    // updateField like an off-org-page edit — which routed Tier 2 fields into
    // the approval queue instead of writing them, and skipped the client-side
    // check that you may edit the org you are pointing at.
    ...(orgId ? { "data-org-id": orgId, "data-organization-id": orgId } : {}),
    ...(rawValue !== undefined && rawValue !== null
      ? { "data-raw-value": String(rawValue) }
      : {}),
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
