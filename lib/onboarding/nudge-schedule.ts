/**
 * Step schedule — one entry per nudge-able step.
 * session_1_welcome is handled by WelcomeModal (in-app only), not here.
 *
 * Split out of nudge-job.ts on purpose, the same way steps.ts is split from the
 * server actions: this is configuration, and a test (or any other reader) must
 * be able to import it without dragging in the email client and the admin
 * Supabase client. A step can sit in a persona's list with no entry here and be
 * silently skipped forever — which is exactly how four directory-critical steps
 * went unsent for months — so the table needs to be cheaply assertable.
 */

export type StepSchedule = {
  /** Days after journey_started_at to send the initial nudge */
  sendAfterDays: number;
  /** Days after last send/reminder to fire a reminder (null = no reminder) */
  reminderEveryDays: number | null;
  /** Max reminders before giving up (0 = no reminders, 1 = one reminder, etc.) */
  maxReminders: number;
  /** Delivery channel for this step */
  channel: "email" | "in_app" | "both";
  /** If set, this step only fires when a specific platform condition is true */
  conditional?: "conference_within_60_days" | "benchmarking_open";
};

/**
 * Exported for the regression guard in lib/publication/__tests__ — a step can
 * sit in a persona's list with no entry here and be silently skipped forever,
 * which is exactly how four directory-critical steps went unsent for months.
 */
export const STEP_SCHEDULE: Record<string, StepSchedule> = {
  profile_description: {
    sendAfterDays: 2,
    reminderEveryDays: 5, // Day 7 if not done
    maxReminders: 1,
    channel: "email",
  },
  profile_logo: {
    sendAfterDays: 2,
    reminderEveryDays: 8, // Day 10 if not done
    maxReminders: 1,
    channel: "email",
  },
  profile_hero: {
    sendAfterDays: 3,
    reminderEveryDays: 11, // Day 14 if not done
    maxReminders: 1,
    channel: "email",
  },
  contacts_sorted: {
    sendAfterDays: 4,
    reminderEveryDays: 10, // Day 14 if not done
    maxReminders: 1,
    channel: "email",
  },
  contact_photos: {
    sendAfterDays: 5,
    reminderEveryDays: 16, // Day 21 if not done
    maxReminders: 1,
    channel: "email",
  },
  conference_delegates: {
    sendAfterDays: 5,
    reminderEveryDays: 7, // Weekly
    maxReminders: 4,
    channel: "both",
    conditional: "conference_within_60_days",
  },
  // These sat in ORG_ADMIN_PARTNER_STEPS with no schedule entry, so the cron
  // skipped them and they were never once sent (0 sent / 0 completed across
  // 182 rows as of 2026-08-20) — while being exactly the fields the printed
  // directory is short of. Slotted after the essentials so the arc still reads
  // description → logo → hero → contacts → what you sell.
  //
  // profile_background is deliberately NOT here: it's purely cosmetic, empty
  // for all 78 partners, and not worth spending a send on. The email copy and
  // auto-complete case for it remain in nudge-job.ts, so re-enabling is a
  // single entry added back here. See DELIBERATELY_UNSCHEDULED in
  // lib/publication/__tests__/nudge-coverage.test.ts.
  profile_categories: {
    sendAfterDays: 6,
    reminderEveryDays: 9, // Day 15 if not done
    maxReminders: 1,
    channel: "email",
  },
  profile_featured_product: {
    sendAfterDays: 7,
    reminderEveryDays: 10, // Day 17 if not done
    maxReminders: 1,
    channel: "email",
  },
  profile_links_docs: {
    sendAfterDays: 8,
    reminderEveryDays: 11, // Day 19 if not done
    maxReminders: 1,
    channel: "email",
  },
  visibility_intro: {
    sendAfterDays: 10,
    reminderEveryDays: 11, // Day 21 if not done
    maxReminders: 1,
    channel: "email",
  },
  network_members: {
    sendAfterDays: 14,
    reminderEveryDays: null,
    maxReminders: 0,
    channel: "email",
  },
  network_partners: {
    sendAfterDays: 14,
    reminderEveryDays: null,
    maxReminders: 0,
    channel: "email",
  },
  network_member_space: {
    sendAfterDays: 17,
    reminderEveryDays: 11, // Day 28 if not done
    maxReminders: 1,
    channel: "email",
  },
  events_discovery: {
    sendAfterDays: 18,
    reminderEveryDays: 12, // Day 30 if not done
    maxReminders: 1,
    channel: "email",
  },
  benchmarking_survey: {
    sendAfterDays: 0, // Fires immediately when survey opens (conditional)
    reminderEveryDays: 14,
    maxReminders: 2,
    channel: "both",
    conditional: "benchmarking_open",
  },
};
