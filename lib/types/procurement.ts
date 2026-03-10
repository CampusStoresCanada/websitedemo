/**
 * Procurement information for partner-facing views of member organizations.
 * This data helps partners understand what products a store carries and
 * what requirements they have for vendors.
 */

/**
 * Fixed taxonomy of product categories that campus stores may carry.
 * Used for filtering and consistent categorization.
 */
export const PRODUCT_CATEGORIES = [
  "Textbooks",
  "Course Materials",
  "Apparel",
  "Technology",
  "Food Services",
  "School Supplies",
  "Gifts & Collectibles",
  "Health & Wellness",
  "Convenience Items",
  "Print & Copy Services",
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

/**
 * Procurement requirements that may affect vendor selection.
 */
export interface ProcurementRequirements {
  /** Whether buy-local policies apply */
  buy_local?: boolean;
  /** Details about buy-local requirements (e.g., "30% local sourcing required") */
  buy_local_notes?: string;

  /** Whether indigenous-owned vendor preferences apply */
  indigenous_owned?: boolean;
  /** Details about indigenous ownership preferences */
  indigenous_owned_notes?: string;

  /** Required sustainability certifications (e.g., "Fair Trade", "B Corp", "FSC") */
  sustainability_certs?: string[];

  /** Any other procurement requirements (insurance, certifications, etc.) */
  other_requirements?: string;
}

/**
 * Information about the organization's buying cycle and RFP timeline.
 */
export interface BuyingCycle {
  /** Month when fiscal year starts (e.g., "April") */
  fiscal_year_start?: string;

  /** RFP submission window (e.g., "January - March") */
  rfp_window?: string;

  /** Key dates for vendors to know (e.g., "Textbook adoption deadline: June 15") */
  key_dates?: string;
}

/**
 * Complete procurement information stored in organizations.procurement_info
 */
export interface ProcurementInfo {
  /** Product categories this store carries */
  product_categories?: ProductCategory[];

  /** Vendor requirements and preferences */
  requirements?: ProcurementRequirements;

  /** Buying cycle and RFP timeline */
  buying_cycle?: BuyingCycle;

  /** UUID of the primary buyer contact in the contacts table */
  buyer_contact_id?: string;
}

/**
 * Helper to check if an organization has any procurement info
 */
export function hasProcurementInfo(info: ProcurementInfo | null | undefined): boolean {
  if (!info) return false;
  return !!(
    (info.product_categories && info.product_categories.length > 0) ||
    info.requirements ||
    info.buying_cycle ||
    info.buyer_contact_id
  );
}
