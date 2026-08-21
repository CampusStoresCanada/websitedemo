import { describe, it, vi } from "vitest";
import { writeFileSync } from "node:fs";

vi.mock("@/lib/email/send", () => ({ sendEmail: async () => ({ success: true }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/supabase/user-lookup", () => ({ lookupUserEmailsByIds: async () => ({}) }));

const OUT = process.env.NUDGE_PREVIEW_OUT;

describe("nudge copy preview", () => {
  it.skipIf(!OUT)("renders the four bodies exactly as buildNudgeEmail returns them", async () => {
    const { buildNudgeEmail } = await import("@/lib/onboarding/nudge-job");
    const { STEP_SCHEDULE } = await import("@/lib/onboarding/nudge-schedule");
    const { PUBLICATION_FIELDS } = await import("../completeness");
    // Derived, not listed: only steps that are actually scheduled can be sent,
    // so a step cut from the schedule drops out of the preview automatically.
    const steps = PUBLICATION_FIELDS
      .map((f) => f.step)
      .filter((k): k is string => !!k && !!STEP_SCHEDULE[k]);
    const out = [];
    for (const stepKey of steps) {
      const variants = (STEP_SCHEDULE[stepKey]?.maxReminders ?? 0) > 0 ? [false, true] : [false];
      for (const isReminder of variants) {
        const built = buildNudgeEmail({
          firstName: "Dana",
          orgName: "Ookami Promo",
          orgSlug: "ookami-promo",
          orgProvince: "Ontario",
          stepKey,
          isReminder,
        });
        if (built) out.push({ stepKey, isReminder, ...built });
      }
    }
    writeFileSync(OUT!, JSON.stringify(out, null, 2));
  });
});
