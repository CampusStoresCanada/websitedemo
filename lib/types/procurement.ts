/**
 * Procurement information for partner-facing views of member organizations.
 * Stored as JSONB in organizations.procurement_info.
 *
 * Design rules:
 *  - Contacts are referenced by UUID (FK → contacts.id), never by name strings.
 *  - Categories come from VENDOR_CATEGORIES and map 1:1 to vendor primary_category.
 *  - Certification preferences and province sourcing are store-level, not per-category.
 */

import { CERTIFICATION_NAMES } from "@/lib/certifications";

/**
 * Vendor category taxonomy — matches the primary_category values used by partner orgs.
 * Members select from this list to indicate what they carry.
 */
export const VENDOR_CATEGORIES = [
  "Accessories",
  "Apparel",
  "Books",
  "Campus Living",
  "Food & Beverages",
  "Gifts & Promotional Products",
  "Graduation & Regalia",
  "Professional Services",
  "School Office & Lab Supplies",
  "Store Fixtures & Equipment",
  "Store Operations",
  "Store Services",
  "Technology & Electronics",
] as const;

export type VendorCategory = (typeof VENDOR_CATEGORIES)[number];

/**
 * A single category → buyers mapping.
 * One category can have multiple buyers; a buyer can appear in multiple categories.
 * Subcategories are per-buyer — each contact selects the subcategories they're
 * personally responsible for within the category.
 */
export interface CategoryBuyer {
  /** Vendor category name — from VENDOR_CATEGORIES */
  category: string;
  /** UUIDs of contacts responsible for purchasing in this category */
  contact_ids: string[];
  /** Per-contact subcategory selections: contact_id → subcategories they own */
  contact_subcategories?: Record<string, string[]>;
}

/**
 * Subcategory taxonomy — keyed by VENDOR_CATEGORIES value.
 * Not every category has subcategories.
 */
/**
 * Store operations / ancillary services a campus store may offer.
 * Sourced from benchmarking survey values.
 * Also used as subcategories for the "Store Services" vendor category.
 */
export const STORE_SERVICES = [
  "Campus Card Services",
  "Campus Mail",
  "Custom Goods & Engraving",
  "Equipment Rentals",
  "Gown Rentals",
  "Locker Sales",
  "Lottery Ticket Sales",
  "Post Office",
  "Print & Photocopy",
  "Student Mail Services",
  "Transit & Parking Pass Sales",
] as const;

export type StoreService = (typeof STORE_SERVICES)[number];

export const CATEGORY_SUBCATEGORIES: Partial<Record<string, readonly string[]>> = {
  "Accessories": ["Bags & Backpacks", "Drinkware", "Stationery", "Desk Accessories", "Lanyards & Badges"],
  "Apparel": ["Men's / Unisex", "Women's", "Youth", "Infant & Toddler", "Activewear", "Headwear"],
  "Books": ["Textbooks", "Trade Books", "Course Materials", "Used Books", "eBooks"],
  "Campus Living": ["Bedding", "Kitchen", "Bath", "Storage & Organization", "Decor"],
  "Food & Beverages": ["Ready-to-Eat", "Snacks", "Beverages", "Health Foods", "Branded / Licensed"],
  "Gifts & Promotional Products": ["Gifts", "Spirit Items", "Souvenirs", "Novelties", "Custom / Branded"],
  "Graduation & Regalia": ["Caps & Gowns", "Diploma Frames", "Announcements", "Class Rings", "Rental Programs"],
  "Professional Services": ["Consulting & Advisory", "Staff Training & Development", "Marketing & Branding", "Audit & Compliance", "Recruitment & HR"],
  "School Office & Lab Supplies": ["Office Supplies", "Lab Supplies", "Art Supplies", "Planners & Agendas"],
  "Store Fixtures & Equipment": ["Shelving & Displays", "Checkout Counters", "Signage & Wayfinding", "Lighting", "Security & Loss Prevention", "Storage & Back Office"],
  "Store Operations": ["Point of Sale Systems", "Inventory Management", "E-commerce Platforms", "Textbook Management", "Analytics & Reporting", "Payment Processing"],
  "Store Services": [...STORE_SERVICES],
  "Technology & Electronics": ["Computers & Tablets", "Peripherals & Accessories", "Calculators", "Software", "Audio & Video"],
};


/**
 * A single structured key date entry.
 */
export interface KeyDate {
  title: string;
  date: string;         // ISO date string "YYYY-MM-DD"
  recurring?: boolean;  // repeats annually
}

/**
 * Information about the organization's buying cycle and RFP timeline.
 */
export interface BuyingCycle {
  /** Month when fiscal year starts (e.g., "April") */
  fiscal_year_start?: string;
  /** Structured list of key dates */
  key_dates?: KeyDate[];
}

/**
 * Visibility flags for each procurement section.
 * All default to true (visible) when absent.
 * Controlled by org admins via eye-icon toggles in edit mode.
 */
export interface ProcurementVisibility {
  show_categories?: boolean;     // "What We Carry" section (categories + buyers) visible to partners
  show_store_services?: boolean; // store services visible to partners
  show_certifications?: boolean; // vendor preferences visible to partners
  show_provinces?: boolean;      // sourcing provinces visible to partners
  show_buying_cycle?: boolean;   // buying cycle visible to partners
  // Note: individual buyer contact visibility is inherited from the Staffing hidden flag —
  // contacts hidden there will never appear in the partner procurement view.
}

/**
 * Complete procurement information stored in organizations.procurement_info.
 */
export interface ProcurementInfo extends ProcurementVisibility {
  /**
   * Per-category buyer assignments.
   * The set of categories carried by the store = category_buyers.map(b => b.category).
   */
  category_buyers?: CategoryBuyer[];

  /**
   * Store-level vendor certification preferences.
   * Values come from CERTIFICATION_NAMES (e.g. "B Corp", "Canadian Owned").
   */
  preferred_certifications?: string[];

  /**
   * Canadian provinces/territories the store prefers or is required to source from.
   */
  sourcing_provinces?: string[];

  /**
   * Ancillary store operations / services offered.
   * Values come from STORE_SERVICES.
   */
  store_services?: string[];

  /** Buying cycle and RFP timeline */
  buying_cycle?: BuyingCycle;
}

/** Canadian provinces and territories for the sourcing preference selector */
export const CANADIAN_PROVINCES = [
  "Alberta",
  "British Columbia",
  "Manitoba",
  "New Brunswick",
  "Newfoundland and Labrador",
  "Nova Scotia",
  "Ontario",
  "Prince Edward Island",
  "Quebec",
  "Saskatchewan",
  "Northwest Territories",
  "Nunavut",
  "Yukon",
] as const;

/**
 * Returns true if the procurement info has any data worth displaying.
 */
export function hasProcurementInfo(info: ProcurementInfo | null | undefined): boolean {
  if (!info) return false;
  return !!(
    (info.category_buyers && info.category_buyers.length > 0) ||
    (info.preferred_certifications && info.preferred_certifications.length > 0) ||
    (info.sourcing_provinces && info.sourcing_provinces.length > 0) ||
    info.buying_cycle
  );
}

// Re-export for convenience — procurement preferences use the same cert list
export { CERTIFICATION_NAMES };
