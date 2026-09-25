import { describe, expect, it, vi } from "vitest";
import { STEP_SCHEDULE } from "@/lib/onboarding/nudge-schedule";
import { ORG_ADMIN_PARTNER_STEPS, PERSONAS, STEPS_BY_PERSONA } from "@/lib/onboarding/steps";
import type { Persona } from "@/lib/onboarding/steps";
import { PUBLICATION_FIELDS } from "../completeness";

// nudge-job pulls in the Resend client and the admin Supabase client at module
// scope. Same stubs as render-nudge-preview.test.ts.
vi.mock("@/lib/email/send", () => ({ sendEmail: async () => ({ success: true }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/supabase/user-lookup", () => ({ lookupUserEmailsByIds: async () => ({}) }));

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
      .filter((f) => f.tier === "required" && !f.unnudgedBecause && (!f.step || !STEP_SCHEDULE[f.step]))
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

/**
 * The same bug class, widened past the partner directory.
 *
 * The three tests above only look at PUBLICATION_FIELDS, which is explicitly
 * partner-scoped. That is why five steps — toolkit_tour, public_contact_email,
 * view_org_page, opening_rfp, my_market — sat in persona step lists for months
 * having sent zero emails to anybody, with nothing failing. toolkit_tour is in
 * CORE_STEPS_BY_PERSONA for all four personas, so nobody's onboarding could
 * read as complete, and no email had ever gone out asking.
 *
 * A (persona, step) pair is SENDABLE when it has a schedule entry AND
 * buildNudgeEmail renders copy for that persona. Copy is persona-branched, so
 * a step can be live for one persona and silent for another: checking the
 * schedule alone would miss it.
 *
 * Every pair must land in exactly one of three buckets:
 *   sendable · DELIBERATELY_SILENT (with a reason) · UNWRITTEN (a known gap)
 *
 * UNWRITTEN is a ratchet. It may only shrink. Write the copy, delete the line.
 */
describe("nudge coverage across every persona", () => {
  /** (persona, step) pairs that will never email. "*" means all personas. */
  const DELIBERATELY_SILENT: Record<string, string> = {
    "*/session_1_welcome":
      "WelcomeModal completes it on first login. There is nothing to chase by email.",
    "*/profile_background":
      "Purely cosmetic and empty for every partner. Cut 2026-08-20; copy and auto-complete remain.",
    "member_member/view_org_page":
      "Its in-app copy points at the Toolkit, which is toolkit_tour's ask. One ask, not two. " +
      "Not true of member_partner, where the step genuinely means 'this is your company on the network'.",
  };

  /**
   * Known gaps. Each line is a persona that reaches a step and is told nothing.
   * Delete a line by writing that persona's copy in buildNudgeEmail.
   */
  const UNWRITTEN = new Set<string>([
    "org_admin_member/public_contact_email",
    "org_admin_member/toolkit_tour",
    "org_admin_member/opening_rfp",
    "org_admin_partner/public_contact_email",
    "org_admin_partner/toolkit_tour",
    "member_partner/view_org_page",
    "member_partner/toolkit_tour",
    "member_partner/my_market",
  ]);

  /** Lower this as UNWRITTEN shrinks. It must never go up. */
  const UNWRITTEN_CEILING = 8;

  const silentReason = (persona: string, step: string) =>
    DELIBERATELY_SILENT[`${persona}/${step}`] ?? DELIBERATELY_SILENT[`*/${step}`];

  async function sendablePairs() {
    const { buildNudgeEmail } = await import("@/lib/onboarding/nudge-job");
    const sendable = new Set<string>();
    for (const persona of PERSONAS) {
      for (const step of STEPS_BY_PERSONA[persona as Persona]) {
        if (!STEP_SCHEDULE[step]) continue;
        const built = buildNudgeEmail({
          firstName: "Dana",
          orgName: "Test Org",
          orgSlug: "test-org",
          orgProvince: "Alberta",
          stepKey: step,
          isReminder: false,
          persona: persona as Persona,
        });
        if (built) sendable.add(`${persona}/${step}`);
      }
    }
    return sendable;
  }

  it("accounts for every step in every persona's journey", async () => {
    const sendable = await sendablePairs();
    const unaccounted: string[] = [];
    for (const persona of PERSONAS) {
      for (const step of STEPS_BY_PERSONA[persona as Persona]) {
        const pair = `${persona}/${step}`;
        if (sendable.has(pair)) continue;
        if (silentReason(persona, step)) continue;
        if (UNWRITTEN.has(pair)) continue;
        unaccounted.push(pair);
      }
    }
    // A new silent step must be classified, not discovered in production.
    expect(unaccounted).toEqual([]);
  });

  it("drops a pair from UNWRITTEN as soon as its copy exists", async () => {
    const sendable = await sendablePairs();
    const stale = [...UNWRITTEN].filter((pair) => sendable.has(pair));
    // Forces the list to shrink when the work is done, rather than rotting.
    expect(stale).toEqual([]);
  });

  it("holds the burn-down ratchet", () => {
    expect(UNWRITTEN.size).toBeLessThanOrEqual(UNWRITTEN_CEILING);
  });

  it("never marks a pair both deliberately silent and unwritten", () => {
    const both = [...UNWRITTEN].filter((pair) => {
      const [persona, step] = pair.split("/");
      return Boolean(silentReason(persona, step));
    });
    expect(both).toEqual([]);
  });

  it("gives every deliberately silent step a reason", () => {
    const blank = Object.entries(DELIBERATELY_SILENT)
      .filter(([, reason]) => reason.trim().length < 20)
      .map(([pair]) => pair);
    expect(blank).toEqual([]);
  });
});
