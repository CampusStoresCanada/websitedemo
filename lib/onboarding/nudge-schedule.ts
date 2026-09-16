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
  // ── Ordering principle: find your people first, housekeeping after ────────
  //
  // Seven of the steps below (toolkit_tour, view_org_page, public_contact_email,
  // procurement, my_suppliers, my_market, opening_rfp) sat in the persona lists
  // with no entry here at all, so the cron skipped them and they were never once
  // sent — the same failure recorded further down for the directory fields.
  //
  // Adding them exposed a worse problem in the order that remained. The two
  // steps that actually show someone why this site is worth their time —
  // network_members and network_partners, "here are your peers" and "here is
  // your market" — sat at day 14, behind every profile-maintenance chore. So a
  // person's first fortnight was a list of housekeeping for a site whose value
  // they had not yet seen, and the payoff arrived after most of them had
  // stopped reading.
  //
  // Inverted here. Days 0–8 are the network: what this is, who else is in it,
  // what's on. Days 10+ are the upkeep, which is worth asking for only once
  // somebody has a reason to care. Numbers are spaced 2 apart to match the
  // pacing floor in nudge-job.ts — they set the ORDER, not the calendar.
  toolkit_tour: {
    sendAfterDays: 0, // The door: what this is, and how to set a password.
    reminderEveryDays: 6,
    maxReminders: 1,
    channel: "email",
  },
  view_org_page: {
    sendAfterDays: 8, // Member-role personas — the Toolkit, and what others see.
    reminderEveryDays: null,
    maxReminders: 0,
    channel: "email",
  },
  procurement: {
    sendAfterDays: 10,
    reminderEveryDays: 9,
    maxReminders: 1,
    channel: "email",
  },
  public_contact_email: {
    sendAfterDays: 12, // Org admins. Irreversible in print, so it leads the profile arc.
    reminderEveryDays: 12,
    maxReminders: 1,
    channel: "email",
  },
  // Both of these RENDER LISTS BUILT FROM procurement categories, so they are
  // deliberately parked well behind it: 65 of 79 stores have no categories set,
  // and an empty list is a worse first impression than no email at all.
  my_suppliers: {
    sendAfterDays: 32,
    reminderEveryDays: 14,
    maxReminders: 1,
    channel: "email",
  },
  my_market: {
    sendAfterDays: 32,
    reminderEveryDays: 14,
    maxReminders: 1,
    channel: "email",
  },
  opening_rfp: {
    sendAfterDays: 34, // Last: only lands once procurement is real.
    reminderEveryDays: null,
    maxReminders: 0,
    channel: "email",
  },

  profile_description: {
    sendAfterDays: 16,
    reminderEveryDays: 5, // Day 7 if not done
    maxReminders: 1,
    channel: "email",
  },
  profile_logo: {
    sendAfterDays: 18,
    reminderEveryDays: 8, // Day 10 if not done
    maxReminders: 1,
    channel: "email",
  },
  profile_hero: {
    sendAfterDays: 20,
    reminderEveryDays: 11, // Day 14 if not done
    maxReminders: 1,
    channel: "email",
  },
  contacts_sorted: {
    sendAfterDays: 22,
    reminderEveryDays: 10, // Day 14 if not done
    maxReminders: 1,
    channel: "email",
  },
  contact_photos: {
    sendAfterDays: 24,
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
    sendAfterDays: 26,
    reminderEveryDays: 9, // Day 15 if not done
    maxReminders: 1,
    channel: "email",
  },
  profile_featured_product: {
    sendAfterDays: 28,
    reminderEveryDays: 10, // Day 17 if not done
    maxReminders: 1,
    channel: "email",
  },
  profile_links_docs: {
    sendAfterDays: 30,
    reminderEveryDays: 11, // Day 19 if not done
    maxReminders: 1,
    channel: "email",
  },
  visibility_intro: {
    sendAfterDays: 14,
    reminderEveryDays: 11, // Day 21 if not done
    maxReminders: 1,
    channel: "email",
  },
  network_members: {
    sendAfterDays: 2,
    reminderEveryDays: null,
    maxReminders: 0,
    channel: "email",
  },
  network_partners: {
    sendAfterDays: 4,
    reminderEveryDays: null,
    maxReminders: 0,
    channel: "email",
  },
  network_member_space: {
    sendAfterDays: 36,
    reminderEveryDays: 11, // Day 28 if not done
    maxReminders: 1,
    channel: "email",
  },
  events_discovery: {
    sendAfterDays: 6,
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
