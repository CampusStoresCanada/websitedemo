/**
 * Partner (Vendor Partner) category taxonomy.
 *
 * 3 primary categories with 14 secondary categories underneath.
 * Used on the partner application form and partner profile/directory.
 */

export const PARTNER_PRIMARY_CATEGORIES = [
  "Course Materials",
  "General Merchandise",
  "Operations & Support",
] as const;

export type PartnerPrimaryCategory = (typeof PARTNER_PRIMARY_CATEGORIES)[number];

export const PARTNER_SECONDARY_CATEGORIES = [
  // Course Materials
  "Textbooks",
  "Digital Course Materials",
  "Lab Supplies & Equipment",
  // General Merchandise
  "Apparel & Spirit Wear",
  "Technology & Electronics",
  "Gifts & Collectibles",
  "Health & Wellness",
  "Stationery & School Supplies",
  "Food & Beverage",
  "Convenience Items",
  // Operations & Support
  "Print & Copy Services",
  "Shipping & Fulfillment",
  "Point of Sale & Software",
  "Facilities & Furniture",
] as const;

export type PartnerSecondaryCategory = (typeof PARTNER_SECONDARY_CATEGORIES)[number];

/** Map secondary categories to their parent primary */
export const SECONDARY_TO_PRIMARY: Record<PartnerSecondaryCategory, PartnerPrimaryCategory> = {
  "Textbooks": "Course Materials",
  "Digital Course Materials": "Course Materials",
  "Lab Supplies & Equipment": "Course Materials",
  "Apparel & Spirit Wear": "General Merchandise",
  "Technology & Electronics": "General Merchandise",
  "Gifts & Collectibles": "General Merchandise",
  "Health & Wellness": "General Merchandise",
  "Stationery & School Supplies": "General Merchandise",
  "Food & Beverage": "General Merchandise",
  "Convenience Items": "General Merchandise",
  "Print & Copy Services": "Operations & Support",
  "Shipping & Fulfillment": "Operations & Support",
  "Point of Sale & Software": "Operations & Support",
  "Facilities & Furniture": "Operations & Support",
};
