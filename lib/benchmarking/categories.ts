/**
 * Which NACS departments a campus store SELLS, and which it only buys.
 *
 * ⛔ Plain module, not "use server" — see lib/benchmarking/location-kinds.ts.
 *
 * The taxonomy is one list (VENDOR_CATEGORIES + CATEGORY_SUBCATEGORIES) used by
 * members, partners and the publication alike. What differs is not the
 * vocabulary but the question: everything here can be purchased by a store,
 * and only some of it is put on a shelf and sold to a student.
 */

import { VENDOR_CATEGORIES, CATEGORY_SUBCATEGORIES } from "@/lib/types/procurement";

/**
 * Bought to run the store, never sold across the counter. They carry buyers and
 * vendors, so they belong in procurement; they have no floor space, no margin
 * and no inventory, so they have no line in §2.
 *
 *   Professional Services      consulting, training, audit, recruitment
 *   Store Fixtures & Equipment shelving, tills, signage, lighting, security
 *   Store Operations           POS, inventory and e-commerce systems
 */
export const NON_SELLABLE_DEPARTMENTS = [
  "Professional Services",
  "Store Fixtures & Equipment",
  "Store Operations",
] as const;

/**
 * Earns money but is not merchandise: printing, lockers, transit passes, gown
 * rental. No inventory to turn and no margin in the retail sense, so it is
 * reported in Other Income rather than as a sales category.
 */
export const SERVICE_DEPARTMENT = "Store Services";

/** The nine departments that occupy floor and carry a margin. */
export const SELLABLE_DEPARTMENTS: string[] = VENDOR_CATEGORIES.filter(
  (d) =>
    !(NON_SELLABLE_DEPARTMENTS as readonly string[]).includes(d) &&
    d !== SERVICE_DEPARTMENT,
);

/**
 * Books straddles §2 and §3 and is the only department that does.
 *
 * Trade Books are general merchandise — the fun-to-read stuff, not stocked for
 * any particular course. Everything else under Books is course materials.
 */
export const TRADE_BOOK_SUBCATEGORIES = ["Trade Books"] as const;

export const COURSE_MATERIAL_SUBCATEGORIES = (
  CATEGORY_SUBCATEGORIES["Books"] ?? []
).filter((s) => !(TRADE_BOOK_SUBCATEGORIES as readonly string[]).includes(s));

/** Subcategories offered for a department, within a given section. */
export function subcategoriesFor(
  department: string,
  scope: "general_merchandise" | "course_materials",
): string[] {
  const all = CATEGORY_SUBCATEGORIES[department] ?? [];
  if (department !== "Books") return [...all];
  return scope === "course_materials"
    ? [...COURSE_MATERIAL_SUBCATEGORIES]
    : [...TRADE_BOOK_SUBCATEGORIES];
}

/** Departments offered in each section. */
export function departmentsFor(
  scope: "general_merchandise" | "course_materials",
): string[] {
  return scope === "course_materials"
    ? ["Books"]
    : SELLABLE_DEPARTMENTS;
}

export const DEPARTMENT_NOTES: Record<string, string> = {
  Books:
    "Trade books only here — the fun-to-read stuff you stock because people want it, not because a course requires it. Anything adopted for a course belongs in Course Materials.",
  "Graduation & Regalia":
    "Caps, gowns, frames, rings, announcements. Include rental programmes.",
  "Campus Living":
    "Bedding, kitchen, bath, storage, decor. The move-in trade.",
  Accessories: "Bags, drinkware, stationery, desk accessories, lanyards.",
};
