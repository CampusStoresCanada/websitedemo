/**
 * Publication completeness — "is this org's listing printable?"
 *
 * DERIVED FROM THE ACTUAL COLUMNS, never from onboarding state. That distinction
 * is the whole point of this module:
 *
 *   - `user_onboarding_progress` is keyed on the USER and only exists after that
 *     user logs in (`initJourney()` calls `requireAuthenticated()`). As of
 *     2026-08-20, 50 of 78 Vendor Partner orgs have no journey rows at all — an
 *     org can be perfectly complete, or completely blank, and the onboarding
 *     tables would say the same thing about both: nothing.
 *   - A publication's unit is the ORG. It prints what's on `organizations`.
 *
 * So completeness reads columns. One query, one truth, three consumers:
 * the partner-facing meter, the staff gap report, and the print-readiness gate.
 * The gap report and the nudge list are the same question asked twice.
 *
 * Categories come from `primary_category` parsed against the NACS taxonomy —
 * see ./categories.ts for why that column, and not the AI-computed
 * `nacs_department`, is the category of record.
 *
 * Scope note: this measures PRESENCE, not correctness. CSC staff populated many
 * partner categories by guessing; a value here is an unverified assumption, not
 * a confirmation. A wrong category is invisible on screen and permanent on
 * paper. Getting a human to check is what the profile_categories nudge is for —
 * it deliberately never auto-completes.
 */

import { hasListableCategories } from "./categories";

/** Field keys the publication knows how to print. */
export type PublicationFieldKey =
  | "logo"
  | "description"
  | "categories"
  | "contacts"
  | "featured_product"
  | "catalogue"
  | "hero";

/**
 * `required` blocks a printable listing — without it the entry is a name and a
 * booth number. `enhanced` is what makes the listing worth reading. Tiering is a
 * policy choice; it lives here so changing it is a one-line edit, not a hunt.
 */
export type FieldTier = "required" | "enhanced";

export type PublicationField = {
  key: PublicationFieldKey;
  label: string;
  tier: FieldTier;
  /**
   * The onboarding step that asks for this, if any — this is the join between
   * "what the directory is missing" and "who we can nudge about it".
   * `null` means no step asks for it and a gap can only be closed by staff.
   */
  step: string | null;
  /** Shown to a partner in the meter, and to staff in the gap report. */
  fixHint: string;
};

export const PUBLICATION_FIELDS: PublicationField[] = [
  { key: "logo",             label: "Logo",              tier: "required", step: "profile_logo",              fixHint: "Upload a logo — it prints beside your listing." },
  { key: "description",      label: "Description",       tier: "required", step: "profile_description",       fixHint: "Describe what your company does, in a sentence or two." },
  { key: "categories",       label: "Categories",        tier: "required", step: "profile_categories",        fixHint: "Set what you sell — it decides where you appear in the index." },
  { key: "contacts",         label: "Contacts",          tier: "required", step: "contacts_sorted",           fixHint: "List at least one person members can reach." },
  { key: "featured_product", label: "Featured product",  tier: "enhanced", step: "profile_featured_product",  fixHint: "Name the one product you want members to notice." },
  { key: "catalogue",        label: "Catalogue or links",tier: "enhanced", step: "profile_links_docs",        fixHint: "Add a catalogue link so members can browse your range." },
  { key: "hero",             label: "Hero image",        tier: "enhanced", step: "profile_hero",              fixHint: "Add a hero image for your profile page." },
  // `background` (organizations.banner_url) was dropped 2026-08-20: empty for
  // all 78 partners, cut from the nudge schedule, and never printed — so it
  // would have sat permanently at 78/78 missing, dominating the gap report
  // with a number nobody intended to act on.
];

export const PUBLICATION_FIELD_BY_KEY: Record<PublicationFieldKey, PublicationField> =
  Object.fromEntries(PUBLICATION_FIELDS.map((f) => [f.key, f])) as Record<PublicationFieldKey, PublicationField>;

/**
 * The org columns completeness reads. Exported so callers select exactly these
 * and nothing drifts between the loader, the nudge job, and any future consumer.
 */
export const COMPLETENESS_ORG_COLUMNS =
  "id, name, slug, logo_url, company_description, primary_category, " +
  "highlight_product_name, highlight_product_description, catalogue_url, partner_links, " +
  "hero_image_url";

/** Exactly the shape `COMPLETENESS_ORG_COLUMNS` returns, plus a contact count. */
export type OrgCompletenessSource = {
  id: string;
  name: string;
  slug: string | null;
  logo_url: string | null;
  company_description: string | null;
  /** Comma-joined NACS taxonomy selections — parsed by ./categories.ts. */
  primary_category: string | null;
  highlight_product_name: string | null;
  highlight_product_description: string | null;
  catalogue_url: string | null;
  partner_links: unknown;
  hero_image_url: string | null;
  /** Count of contacts on the org — a separate query, joined in by the loader. */
  contactCount: number;
};

export type FieldState = {
  key: PublicationFieldKey;
  label: string;
  tier: FieldTier;
  step: string | null;
  filled: boolean;
  fixHint: string;
};

export type OrgCompleteness = {
  orgId: string;
  orgName: string;
  orgSlug: string | null;
  fields: FieldState[];
  requiredFilled: number;
  requiredTotal: number;
  enhancedFilled: number;
  enhancedTotal: number;
  /** 0–100 over ALL fields — what a partner-facing meter shows. */
  overallPct: number;
  /** Keys still missing, required first — the nudge list for this org. */
  missing: PublicationFieldKey[];
  /** True when every `required` field is present: the print-readiness gate. */
  isPrintReady: boolean;
};

const text = (v: string | null | undefined): boolean => typeof v === "string" && v.trim().length > 0;

/** A non-empty JSON array of links. `partner_links` is jsonb and often null. */
function hasLinks(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0;
}

/**
 * Presence test per field. Kept as one switch so the definition of "filled"
 * lives in exactly one place — the meter, the gap report, and the nudge job's
 * auto-complete all resolve to this.
 */
export function isFieldFilled(key: PublicationFieldKey, org: OrgCompletenessSource): boolean {
  switch (key) {
    case "logo":        return text(org.logo_url);
    case "description": return text(org.company_description);
    // At least one real NACS department to be indexed under. `primary_category`
    // is the selection of record; a class implies its department (see
    // parseOrgCategories), so picking only "Caps & Gowns" still counts.
    case "categories":  return hasListableCategories(org.primary_category);
    case "contacts":    return org.contactCount > 0;
    // The deal/description is the useful half, but a bare name still prints.
    case "featured_product": return text(org.highlight_product_name);
    case "catalogue":   return text(org.catalogue_url) || hasLinks(org.partner_links);
    case "hero":        return text(org.hero_image_url);
  }
}

/** Pure — no DB. Given one org row, say how printable it is. */
export function computeOrgCompleteness(org: OrgCompletenessSource): OrgCompleteness {
  const fields: FieldState[] = PUBLICATION_FIELDS.map((f) => ({
    key: f.key,
    label: f.label,
    tier: f.tier,
    step: f.step,
    fixHint: f.fixHint,
    filled: isFieldFilled(f.key, org),
  }));

  const required = fields.filter((f) => f.tier === "required");
  const enhanced = fields.filter((f) => f.tier === "enhanced");
  const requiredFilled = required.filter((f) => f.filled).length;
  const enhancedFilled = enhanced.filter((f) => f.filled).length;
  const filledTotal = requiredFilled + enhancedFilled;

  return {
    orgId: org.id,
    orgName: org.name,
    orgSlug: org.slug,
    fields,
    requiredFilled,
    requiredTotal: required.length,
    enhancedFilled,
    enhancedTotal: enhanced.length,
    overallPct: fields.length === 0 ? 100 : Math.round((filledTotal / fields.length) * 100),
    // Required first: that's the order to ask a partner to fix things in.
    missing: [...required, ...enhanced].filter((f) => !f.filled).map((f) => f.key),
    isPrintReady: requiredFilled === required.length,
  };
}

export type CompletenessSummary = {
  orgs: number;
  printReady: number;
  blocked: number;
  /** Per-field totals — the staff gap report, worst gap first. */
  byField: Array<{ key: PublicationFieldKey; label: string; tier: FieldTier; step: string | null; filled: number; missing: number }>;
};

/** Pure — roll a set of orgs up into the numbers a gap report shows. */
export function summarizeCompleteness(rows: OrgCompleteness[]): CompletenessSummary {
  const byField = PUBLICATION_FIELDS.map((f) => {
    const filled = rows.filter((r) => r.fields.find((x) => x.key === f.key)?.filled).length;
    return { key: f.key, label: f.label, tier: f.tier, step: f.step, filled, missing: rows.length - filled };
  }).sort((a, b) => b.missing - a.missing);

  return {
    orgs: rows.length,
    printReady: rows.filter((r) => r.isPrintReady).length,
    blocked: rows.filter((r) => !r.isPrintReady).length,
    byField,
  };
}
