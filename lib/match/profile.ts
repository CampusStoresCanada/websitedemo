/**
 * Build a normalised MatchProfile from the stored organization shape.
 *
 * Pure — takes plain data, does no I/O. The runner is responsible for the query.
 *
 * Canonical parsers are imported, never restated. `parseOrgCategories` already
 * knows the aliases, infers a department from a class, and reports off-taxonomy
 * tokens instead of hiding them; `normalizeKeyDates` / `buyingCycleNotes` already
 * know that `key_dates` can be a legacy free-text string. Both matchers this
 * engine replaces wrote their own category splitter, and that is the drift being
 * removed here.
 */

import { parseOrgCategories } from "@/lib/publication/categories";
import {
  normalizeKeyDates,
  buyingCycleNotes,
  type ProcurementInfo,
  type ProcurementVisibility,
} from "@/lib/types/procurement";
import { SCALE_RANGES, type ScaleRange } from "@/lib/explore/types";
import type {
  CategoryOwnership,
  MatchProfile,
  NormalizedBuyingCycle,
  RevealedAffinity,
  RevealedTerm,
} from "./types";

/** Columns the engine reads off `organizations`. */
export interface MatchProfileInput {
  id: string;
  name: string;
  type: string | null;
  primary_category?: string | null;
  certifications?: string[] | null;
  is_cancoll_member?: boolean | null;
  province?: string | null;
  company_description?: string | null;
  website_summary?: string | null;
  fte?: number | null;
  institution_type?: string | null;
  procurement_info?: ProcurementInfo | null;
  embedding?: number[] | null;
  embedding_model?: string | null;
  /** ⚠️ 41 of 122 partner orgs are archived. See the guard in buildMatchProfile. */
  archived_at?: string | null;
  is_test?: boolean | null;
}

export interface BuildProfileOptions {
  /**
   * Rolled-up behavioural signal for this org, from the nightly job.
   *
   * Absent is normal and harmless — the profile is simply built from what was
   * declared. Behaviour is additive.
   */
  revealedTerms?: RevealedTerm[];
  revealedAffinities?: RevealedAffinity[];
  /**
   * Include orgs flagged `is_test`. Off by default.
   *
   * ⚠️ A test org is a REAL org while its flag is off — it counts in sends and
   * totals — so the flag is the only thing keeping fixtures out of live
   * recommendations. The option exists so the engine can be exercised against
   * them deliberately, never by accident.
   */
  includeTestOrgs?: boolean;
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** "April" / "Apr" → 4. Anything else → null. */
export function parseMonth(raw: string | null | undefined): number | null {
  if (!raw) return null;
  return MONTHS[raw.trim().toLowerCase().replace(/\.$/, "")] ?? null;
}

/**
 * "February - April", "Jan – June", "November to February" → a month range.
 *
 * Free text by design — an RFP window is a season, not a date — so this parses
 * what members actually wrote and gives up quietly rather than guessing. A range
 * that wraps the year end (Nov–Feb) is preserved as start > end and handled by
 * the caller; collapsing it to Feb–Nov would invert the meaning entirely.
 */
export function parseMonthRange(
  raw: string | null | undefined
): { startMonth: number; endMonth: number } | null {
  if (!raw || !raw.trim()) return null;
  const parts = raw.split(/\s*(?:-|–|—|\bto\b|\bthrough\b)\s*/i).filter(Boolean);
  if (parts.length === 1) {
    const only = parseMonth(parts[0]);
    return only ? { startMonth: only, endMonth: only } : null;
  }
  if (parts.length !== 2) return null;
  const startMonth = parseMonth(parts[0]);
  const endMonth = parseMonth(parts[1]);
  if (!startMonth || !endMonth) return null;
  return { startMonth, endMonth };
}

function normalizeBuyingCycle(info: ProcurementInfo | null | undefined): NormalizedBuyingCycle | null {
  const cycle = info?.buying_cycle;
  if (!cycle) return null;

  const keyDates = normalizeKeyDates(cycle.key_dates).map((kd) => ({
    title: kd.title,
    date: kd.date,
    recurring: kd.recurring === true,
  }));
  const notes = buyingCycleNotes(cycle);
  const fiscalYearStartMonth = parseMonth(cycle.fiscal_year_start);
  const rfpWindow = parseMonthRange(cycle.rfp_window);

  // An empty shell (the editor writes "" into every field on first save) carries
  // no signal and must not be mistaken for a stated cycle.
  if (!fiscalYearStartMonth && !rfpWindow && keyDates.length === 0 && !notes) return null;

  return { fiscalYearStartMonth, rfpWindow, keyDates, notes };
}

function scaleRangeFor(fte: number | null | undefined): ScaleRange | null {
  if (fte === null || fte === undefined) return null;
  return SCALE_RANGES.find((r) => fte >= r.min && fte <= r.max)?.key ?? null;
}

function cleanStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean);
}

function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * `organizations.type` is capitalized — "Member" / "Vendor Partner". A lowercase
 * comparison returns nothing, silently.
 */
export function profileTypeFor(orgType: string | null | undefined): "member" | "partner" | null {
  if (orgType === "Member") return "member";
  if (orgType === "Vendor Partner") return "partner";
  return null;
}

/**
 * Normalise one org, or return null if it must never be scored.
 *
 * ⛔ Archived orgs are refused HERE, not left to each caller's query.
 *
 * 41 of 122 partner orgs are archived, and archiving in this system leaves no
 * audit trail and does not stop billing — archived is not canceled. Relying on
 * every caller to remember `.is("archived_at", null)` means one forgotten filter
 * recommends a dead org to a member. Refusing at the point a profile is built
 * makes it structural: an archived org never enters a candidate pool because it
 * never becomes a profile.
 *
 * ⚠️ This is NOT the engine judging a relationship — that would be the thing it
 * must never do. Archived is an org lifecycle fact, in the same class as scoring
 * an org against itself: not a decision, just not a candidate.
 */
export function buildMatchProfile(
  row: MatchProfileInput,
  options: BuildProfileOptions = {}
): MatchProfile | null {
  const type = profileTypeFor(row.type);
  if (!type) return null;
  if (row.archived_at) return null;
  if (row.is_test === true && !options.includeTestOrgs) return null;

  const info = row.procurement_info ?? null;
  const { departments, classes } = parseOrgCategories(row.primary_category);

  // Members declare what they carry through category_buyers, not primary_category
  // (0 of 81 members have primary_category set). Both are the same vocabulary, so
  // the parser runs over the joined selection either way.
  //
  // ⛔ Two passes on purpose. The union answers "what does this org buy"; the
  // per-person map answers "who buys it" — and an earlier version computed only
  // the first, discarding the contact ids with `Object.values()`. That is the one
  // step whose loss cannot be undone downstream.
  const buyerCategories = Array.isArray(info?.category_buyers) ? info.category_buyers : [];
  const buyerTokens = new Set<string>();
  const ownershipTokens = new Map<string, Set<string>>();

  const own = (contactId: string, token: string) => {
    const set = ownershipTokens.get(contactId) ?? new Set<string>();
    set.add(token);
    ownershipTokens.set(contactId, set);
  };

  for (const entry of buyerCategories) {
    const category = typeof entry?.category === "string" ? entry.category : null;
    if (category) buyerTokens.add(category);

    // Being named on a category is ownership even with no classes specified.
    for (const contactId of cleanStrings(entry?.contact_ids)) {
      if (category) own(contactId, category);
    }

    for (const [contactId, subs] of Object.entries(entry?.contact_subcategories ?? {})) {
      if (category) own(contactId, category);
      for (const sub of cleanStrings(subs)) {
        buyerTokens.add(sub);
        own(contactId, sub);
      }
    }
  }

  const fromBuyers = parseOrgCategories([...buyerTokens].join(","));

  // Each person's tokens go through the SAME canonical parser as the org's, so a
  // class implies its department for a person exactly as it does for a store.
  const buyers: CategoryOwnership[] = [...ownershipTokens.entries()]
    .map(([contactId, tokens]) => {
      const parsed = parseOrgCategories([...tokens].join(","));
      return { contactId, departments: parsed.departments, classes: parsed.classes };
    })
    .filter((b) => b.departments.length > 0 || b.classes.length > 0);

  const visibility: ProcurementVisibility = {
    show_categories: info?.show_categories,
    show_store_services: info?.show_store_services,
    show_certifications: info?.show_certifications,
    show_provinces: info?.show_provinces,
    show_buying_cycle: info?.show_buying_cycle,
  };

  return {
    id: row.id,
    type,
    name: row.name,

    departments: [...new Set([...departments, ...fromBuyers.departments])],
    classes: [...new Set([...classes, ...fromBuyers.classes])],

    certificationsHeld: cleanStrings(row.certifications),
    certificationsWanted: cleanStrings(info?.preferred_certifications),
    isCancoll: row.is_cancoll_member === true,

    province: cleanText(row.province),
    sourcingProvinces: cleanStrings(info?.sourcing_provinces),

    buyingCycle: normalizeBuyingCycle(info),

    requirementsNotes: cleanText(info?.requirements_notes),
    descriptionText: cleanText(row.company_description) ?? cleanText(row.website_summary),

    storeServices: cleanStrings(info?.store_services),

    fte: row.fte ?? null,
    scaleRange: scaleRangeFor(row.fte),
    institutionType: cleanText(row.institution_type),

    visibility,

    buyers,

    revealedTerms: options.revealedTerms ?? [],
    revealedAffinities: options.revealedAffinities ?? [],

    embedding: row.embedding ?? null,
    embeddingModel: row.embedding_model ?? null,
  };
}
