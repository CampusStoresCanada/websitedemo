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
  };
}

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
 *   reciprocity      → lib/benchmarking/org-page-visibility.ts
 *   minimum group    → lib/benchmarking/disclosure.ts (MIN_CUT_SIZE)
 *   aggregate-only   → disclosure_level on the submission
 *   traceable copies → lib/benchmarking/canary.ts
 */
export function confidentialityPoints(minCutSize = MIN_CUT_SIZE) {
  return [
    {
      heading: "Only participating stores see the results",
      body:
        "Detailed figures are exchanged between stores that take part. A member who " +
        "has not filed sees the group's shape, never another store's numbers.",
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
      "How each of your figures has moved since last year, once two comparable " +
      "years exist. This is the first year collected through this system, so the " +
      "first movement appears in the 2027 cycle.",
    when: "2027",
    built: false,
  },
];
