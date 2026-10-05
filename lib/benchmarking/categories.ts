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
  // A format IS the leaf in §3 — there is nothing below "Print — Used" that a
  // store reports separately, so it offers no split.
  if (scope === "course_materials") return [];
  const all = CATEGORY_SUBCATEGORIES[department] ?? [];
  if (department !== "Books") return [...all];
  return [...TRADE_BOOK_SUBCATEGORIES];
}

/**
 * How a store SELLS course materials — the §3 category list.
 *
 * ⛔ Not a second taxonomy. NACS gives us what a VENDOR SUPPLIES (Textbooks,
 * Used Books, eBooks under Books), and partners pick from that list. These are
 * the formats a store sells the same goods IN, and the difference is real: one
 * textbook is new print in September, a rental in January and a digital licence
 * in the Inclusive Access cohort, from the same publisher under the same NACS
 * subcategory the whole time. §3 asks about the format because that is the axis
 * a course materials manager actually manages, and the only one where the
 * numbers differ.
 *
 * Restored from the fields this section used before the category rebuild, which
 * dropped them and left §3 offering the Books department alone.
 */
export const COURSE_MATERIAL_FORMATS = [
  "Print — New",
  "Print — Used",
  "Rentals",
  "Digital",
  "Course Packs",
  "Custom Course Materials",
  "Inclusive or Equitable Access",
  "Course-Required Supplies",
  "Other Course Materials",
] as const;

/**
 * Formats with no physical unit to count, so no sell-through to ask for.
 *
 * A digital licence is not "available" in any sense that divides into "sold",
 * and an Inclusive Access cohort is sized by enrolment rather than by what was
 * bought in. Asking anyway produces a ratio that looks like every other store's
 * and means something different at each one.
 */
export const NON_PHYSICAL_FORMATS = [
  "Digital",
  "Inclusive or Equitable Access",
] as const;

export const COURSE_MATERIAL_FORMAT_NOTES: Record<string, string> = {
  "Print — New": "New print texts and required course books, bought in for the term.",
  "Print — Used":
    "Used print, however you sourced it — buyback, wholesale, or a trade with another store.",
  Rentals: "Print or digital rented for a term. Report the rental income, not the retail value.",
  Digital: "eBooks and digital access codes sold individually, outside any IA or EA program.",
  "Course Packs": "Compiled readings, coursepacks and reprographic material you produce or resell.",
  "Custom Course Materials":
    "Custom editions and bundles built for a specific course, where the title exists only for that course.",
  "Inclusive or Equitable Access":
    "Materials supplied through your IA or EA program. Section 10 asks how the program runs and who collects the money; this is what it contained.",
  "Course-Required Supplies":
    "Non-book material a syllabus requires: lab coats, safety equipment, art supplies, calculators, dissection kits. Course-required, so it belongs here rather than in General Merchandise — do not count it in both.",
  "Other Course Materials": "Anything adopted for a course that fits none of the above.",
};

/** Departments offered in each section. */
export function departmentsFor(
  scope: "general_merchandise" | "course_materials",
): string[] {
  return scope === "course_materials"
    ? [...COURSE_MATERIAL_FORMATS]
    : SELLABLE_DEPARTMENTS;
}

export const DEPARTMENT_NOTES: Record<string, string> = {
  Books:
    "Trade books only here — the fun-to-read stuff you stock because people want it, not because a course requires it. Anything adopted for a course belongs in Course Materials.",
  "Graduation & Regalia":
    "Caps, gowns, frames, rings, announcements. Include rental programs.",
  "Campus Living":
    "Bedding, kitchen, bath, storage, decor. The move-in trade.",
  Accessories: "Bags, drinkware, stationery, desk accessories, lanyards.",
};
