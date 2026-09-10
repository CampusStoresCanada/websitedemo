import { describe, expect, it } from "vitest";
import { STEP_SCHEDULE } from "@/lib/onboarding/nudge-schedule";
import { ORG_ADMIN_PARTNER_STEPS } from "@/lib/onboarding/steps";
import { PUBLICATION_FIELDS } from "../completeness";

/**
 * The bug this guards against: a step can live in a persona's step list, show
 * up in the in-app wizard, accumulate progress rows — and never be sent,
 * because nothing in the cron references it. Four directory-critical steps
 * (profile_featured_product, profile_links_docs, profile_background,
 * profile_categories) sat that way across 182 rows with 0 sends.
 */
describe("nudge coverage for publication fields", () => {
  /**
   * Steps that exist in the journey but deliberately carry no email schedule.
   * Listing them here is the point: an accidental omission still fails the
   * test, while a considered one is recorded with its reason.
   *   profile_background — purely cosmetic, empty for all 78 partners, not
   *   worth spending a send on (cut 2026-08-20).
   */
  const DELIBERATELY_UNSCHEDULED = new Set(["profile_background"]);

  it("schedules every step a publication field depends on", () => {
    const unscheduled = PUBLICATION_FIELDS
      .filter((f) => f.step && !STEP_SCHEDULE[f.step] && !DELIBERATELY_UNSCHEDULED.has(f.step))
      .map((f) => `${f.key} -> ${f.step}`);
    expect(unscheduled).toEqual([]);
  });

  it("never lets a required field go unscheduled, deliberately or otherwise", () => {
    // Enhanced fields are droppable; a required one is what blocks print.
    const gaps = PUBLICATION_FIELDS
      .filter((f) => f.tier === "required" && (!f.step || !STEP_SCHEDULE[f.step]))
      .map((f) => f.key);
    expect(gaps).toEqual([]);
  });

  it("keeps every publication field's step in the partner journey", () => {
    // A scheduled step nobody is enrolled in is just as silent as an
    // unscheduled one.
    const partnerSteps = new Set<string>(ORG_ADMIN_PARTNER_STEPS);
    const orphaned = PUBLICATION_FIELDS
      .filter((f) => f.step && !partnerSteps.has(f.step as never))
      .map((f) => `${f.key} -> ${f.step}`);
    expect(orphaned).toEqual([]);
  });
});
