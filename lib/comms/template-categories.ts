// ─────────────────────────────────────────────────────────────────
// Chunk 22: Communications — Template category vocabulary
//
// One source for how a template category is named and ordered in the
// admin UI. Both the template list and the new-template form read it.
// ─────────────────────────────────────────────────────────────────

import type { TemplateCategory } from "./types";

/**
 * Display names for every category in TemplateCategory. Typed as an
 * exhaustive Record on purpose: adding a member to the union is a type
 * error here until it gets a label, which is what stops the UI drifting
 * behind the vocabulary again.
 */
const DECLARED_CATEGORY_LABELS: Record<TemplateCategory, string> = {
  renewal: "Renewal",
  membership: "Membership",
  conference: "Conference",
  events: "Events",
  user_mgmt: "User Management",
  benchmarking: "Benchmarking",
  governance: "Governance",
  general: "General",
};

/**
 * Labels for lookup by an arbitrary string. `message_templates.category`
 * is plain `text` — no enum, no check constraint — so a stored value need
 * not be in TemplateCategory at all. `announcement` already isn't.
 *
 * This map is NOT an allow-list. A category missing from it still gets a
 * heading, derived by humanizeTemplateCategory; the label here only makes
 * that heading nicer.
 */
export const TEMPLATE_CATEGORY_LABELS: Record<string, string> = {
  ...DECLARED_CATEGORY_LABELS,
  // Carried by campaign-scoped rows; outside the declared union.
  announcement: "Announcement",
};

/**
 * Preferred heading order. A category absent from this list is NOT
 * dropped — groupTemplatesByCategory appends it after these, alphabetically.
 *
 * That distinction is the bug this file exists to prevent: the templates
 * page used an array like this one as both an order and a filter, so
 * benchmarking, governance and events became invisible the moment they
 * were added to the vocabulary — 31 of 58 library templates listed, and
 * no way to preview or test-send the rest.
 */
export const TEMPLATE_CATEGORY_ORDER: string[] = [
  "renewal",
  "membership",
  "conference",
  "events",
  "user_mgmt",
  "benchmarking",
  "governance",
  "announcement",
  "general",
];

/** Bucket key for a row whose category is null, empty, or whitespace. */
export const UNCATEGORIZED_KEY = "uncategorized";

/** snake_case / kebab-case -> Title Case, for a category we have no label for. */
export function humanizeTemplateCategory(category: string): string {
  const words = category.trim().split(/[_\s-]+/).filter(Boolean);
  if (words.length === 0) return "Uncategorized";
  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Heading for any category value, known or not. Never returns empty. */
export function templateCategoryLabel(category: string | null | undefined): string {
  if (!category || !category.trim()) return "Uncategorized";
  return TEMPLATE_CATEGORY_LABELS[category] ?? humanizeTemplateCategory(category);
}

/**
 * Categories offered when authoring a template — the full declared
 * vocabulary, in display order. Derived from the same label map the list
 * page uses, so the dropdown can't fall behind the headings.
 */
export const TEMPLATE_CATEGORY_OPTIONS: { value: TemplateCategory; label: string }[] =
  (Object.keys(DECLARED_CATEGORY_LABELS) as TemplateCategory[])
    .sort((a, b) => {
      const ai = TEMPLATE_CATEGORY_ORDER.indexOf(a);
      const bi = TEMPLATE_CATEGORY_ORDER.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    })
    .map((value) => ({ value, label: DECLARED_CATEGORY_LABELS[value] }));

/**
 * Group templates by the categories actually present in the data — every
 * row lands in exactly one group, so the group sizes always sum back to
 * the input length. Known categories come first in TEMPLATE_CATEGORY_ORDER,
 * then anything unrecognised, alphabetically.
 */
export function groupTemplatesByCategory<T extends { category: string }>(
  templates: T[]
): { category: string; label: string; templates: T[] }[] {
  const groups = new Map<string, T[]>();

  for (const t of templates) {
    const key = t.category?.trim() || UNCATEGORIZED_KEY;
    const bucket = groups.get(key);
    if (bucket) bucket.push(t);
    else groups.set(key, [t]);
  }

  return [...groups.keys()]
    .sort((a, b) => {
      const ai = TEMPLATE_CATEGORY_ORDER.indexOf(a);
      const bi = TEMPLATE_CATEGORY_ORDER.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    })
    .map((category) => ({
      category,
      label: templateCategoryLabel(category),
      templates: groups.get(category)!,
    }));
}
