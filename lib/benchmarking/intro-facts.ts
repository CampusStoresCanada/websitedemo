/**
 * What the survey's opening page tells a store, kept as data rather than prose
 * baked into JSX.
 *
 * Every claim on that page is a promise to 52 member stores, made at the moment
 * they are deciding whether to trust us with their financials. So the numbers
 * come from the field config that actually renders, not from a copywriter's
 * estimate — if a section is added, the count here moves with it.
 *
 * ⚠️ Nothing in here may describe a capability that does not exist. The page is
 * the one place where an overstatement is not a bug in a feature, it IS the
 * feature failing.
 */

import { DEFAULT_FIELD_CONFIG } from "./default-field-config";
import { MIN_CUT_SIZE } from "./disclosure";

export interface SurveyScope {
  sections: number;
  fields: number;
  /** Fields needing a figure off the year-end statements. */
  financialFields: number;
  sectionTitles: string[];
  /** id + title per section, so the intro can pair each with its note. */
  sections_detail: { id: string; title: string }[];
}

/** Measured from the config that renders, so it cannot drift from the form. */
export function surveyScope(config = DEFAULT_FIELD_CONFIG): SurveyScope {
  const sections = config.sections ?? [];
  const fields = sections.flatMap((s) => s.fields ?? []);
  return {
    sections: sections.length,
    fields: fields.length,
    financialFields: fields.filter((f) => f.type === "currency").length,
    sectionTitles: sections.map((s) => s.title),
    sections_detail: sections.map((s) => ({ id: s.id, title: s.title })),
  };
}


/**
 * What each section is actually asking for, and why.
 *
 * The intro used to say "8 sections, 99 questions" and stop, which tells a
 * store the size of the job and nothing about its shape. Someone deciding
 * whether to start needs to know which of these they can answer off a printout
 * and which need a colleague.
 *
 * Keyed by section id from the field config, so a section added without a note
 * shows its title alone rather than silently disappearing.
 */
export const SECTION_NOTES: Record<string, string> = {
  institution_profile:
    "Who you are and who compiled the figures, plus enrolment FTE and square footage. The FTE you report here is the number that sets your CSC rate for the year ahead, so it is worth getting from the registrar rather than memory.",
  sales_revenue:
    "Gross sales for the year, split in-store and online. The split is what drives every online-share comparison, so an estimate here shows up in four places later.",
  financial_metrics:
    "Cost of goods, payroll, rent and net profit. These are the figures that build margin and expense ratios, and they are the ones stores most often want a peer group for.",
  staffing:
    "Headcount as full-time equivalent, including students. Part-time converted to FTE, not counted as bodies, or your staffing cost per FTE will not compare to anyone.",
  course_materials:
    "Course materials revenue by category, each with its online portion. The longest section, and the one where a POS export saves the most time.",
  general_merchandise:
    "Everything that is not course materials: apparel, gifts, technology, supplies, food. Categories follow the NACS taxonomy so the cuts line up year to year.",
  technology_systems:
    "Your POS and e-commerce platforms by name. No figures. It is here because 'what do stores like us run' is one of the most asked questions on the member forum.",
  store_operations:
    "Hours, services offered, shrink, and the newer KPIs. Several of these are optional and marked so.",
};

/**
 * What you get back for what you give — the ladder, said plainly.
 *
 * It is enforced by resultsTierFor(), and a store should be told it BEFORE
 * choosing rather than discovering it when the results arrive thinner than
 * expected. The page previously described the choice as being about naming
 * alone, which understates what aggregate-only costs.
 */
export const RESULTS_LADDER = [
  {
    who: "Stores that do not take part",
    gets: "Nothing",
    detail:
      "No medians, no counts, no distributions. The exchange is not a public resource, and a store contributing none of its own figures does not receive the group's.",
  },
  {
    who: "Stores that contribute without being named",
    gets: "Aggregate results",
    detail:
      "Your figures count toward every median, count and distribution, and you see those same aggregates. You do not see other stores as named rows, because naming works both ways.",
  },
  {
    who: "Stores that contribute and agree to be named",
    gets: "Full results",
    detail:
      "Everything above, plus named peer rows for the other stores that also agreed. This is what most stores choose and what makes the report worth reading.",
  },
] as const;

/**
 * What a store needs in front of them before starting.
 *
 * Deliberately not a minute estimate. We have never measured how long this
 * takes — the 2025 cycle was collected outside this system, so its rows carry a
 * backfill timestamp rather than a real duration — and inventing a number would
 * make the first sentence on the trust page the first promise we break. What we
 * can say truthfully is what they will be reaching for.
 */
export const WHAT_TO_GATHER = [
  "Your year-end financial statements — sales by category, cost of goods, and operating expenses",
  "Staffing counts, including part-time expressed as full-time equivalent",
  "Store square footage, split by selling floor, storage and office",
  "Enrolment FTE for the same fiscal year",
  "Your POS and e-commerce platform names",
] as const;

/**
 * The confidentiality commitments, in the order a suspicious reader asks them.
 *
 * Each maps to something enforced in code, named here so a reviewer can check
 * the claim rather than take it:
 *   nothing public   → mayReceivePeerSet() in lib/benchmarking/org-page-visibility.ts
 *   reciprocity      → lib/benchmarking/org-page-visibility.ts
 *   minimum group    → lib/benchmarking/disclosure.ts (MIN_CUT_SIZE)
 *   aggregate-only   → disclosure_level on the submission
 *   traceable copies → lib/benchmarking/canary.ts
 */
export function confidentialityPoints(minCutSize = MIN_CUT_SIZE) {
  return [
    {
      heading: "Nothing is published outside the stores that take part",
      body:
        "Not a median, not a count, not a range. No figure from this survey goes on " +
        "the public site, to vendor partners, or into anything CSC circulates " +
        "without the consent of the stores it came from. Aggregates are not an " +
        "exception to that — an average of you and your peers is still your " +
        "information.",
    },
    {
      heading: `No group smaller than ${minCutSize} stores is ever shown`,
      body:
        "A comparison too small to hide anyone in is withheld entirely, even from " +
        "the stores inside it. Where naming those who agreed would leave a single " +
        "store unnamed, nobody is named — one unnamed store in a group is not " +
        "anonymous, it is a subtraction.",
    },
    {
      heading: "You choose whether your store is named",
      body:
        "Your figures count toward every median either way. Naming is a separate " +
        "choice, it works both ways, and you can change it at any point while this " +
        "year's survey is open.",
    },
    {
      heading: "Every copy is traceable to the member it was prepared for",
      body:
        "Figures for other stores carry marks worth a few dollars, different for " +
        "each recipient, so a forwarded report can be traced back. Your own figures " +
        "are never altered — what you see of your store is exactly what you filed.",
    },
  ];
}

/**
 * What a store gets back, and when.
 *
 * `built` distinguishes what exists today from what is committed for this
 * cycle. The page says so plainly rather than listing both as though they were
 * the same promise: a store reading this in October should be able to tell what
 * it can rely on now from what is coming, and CSC should be able to see at a
 * glance what it has undertaken to build.
 */
export interface Deliverable {
  title: string;
  body: string;
  when: string;
  built: boolean;
}

export const DELIVERABLES: Deliverable[] = [
  {
    title: "Your store against its peers, on the website",
    body:
      "Four comparisons — all participating stores, stores of your type, your " +
      "region, and stores your size — with your position against each median.",
    when: "When results are released",
    built: true,
  },
  {
    title: "A printable copy of your own submission",
    body:
      "Everything you filed, with your previous years alongside it, formatted to " +
      "print for a board or finance meeting.",
    when: "Available now, and throughout the cycle",
    built: true,
  },
  {
    title: "A PDF and Excel package for your store",
    body:
      "Your figures, your peer groups and your position in each, as documents you " +
      "can circulate internally without sending anyone to the website.",
    when: "With the results release",
    built: false,
  },
  {
    title: "Year-over-year movement",
    body:
      "How each of your figures has moved since last year — revenue, gross and net " +
      "margin, staffing share, online share, and sales per student and per square " +
      "foot. FY2025 is on file for all 39 stores that took part, so this arrives " +
      "with this year's results rather than waiting for a third year.",
    when: "With the results release",
    built: true,
  },
  {
    // Separated from the movement above because it is a genuinely different
    // constraint: GMROI and turns need an AVERAGE of two year-end inventory
    // figures, and fye_inventory_value is empty for all 39 FY2025 rows — it was
    // not asked. So the first pair of year-ends is 2026 and 2027.
    title: "Inventory performance — GMROI and stock turns",
    body:
      "Margin return and turns against average inventory at cost. These need two " +
      "consecutive year-end inventory figures to average, and FY2025 did not ask " +
      "for one, so the first pair is this year and next.",
    when: "2027",
    built: false,
  },
];
