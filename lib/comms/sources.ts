import type { MessagingSource } from "@/lib/comms/dispatch";
import { runOnboardingNudgeJob } from "@/lib/onboarding/nudge-job";

/**
 * Every sender that writes mail WE chose to send.
 *
 * ⛔ Nothing transactional belongs here. A reset, a receipt, a ticket, an
 * invitation: sent directly by whatever earned it, never arbitrated, never
 * delayed.
 *
 * ⚠️ Onboarding is the only member today, on purpose. Renewals, the conference
 * checklist, elections reminders and campaigns still send for themselves. They
 * are the refactor, and the conference checklist and the nomination close are
 * days away — moving either of those onto a new dispatcher first would be
 * putting a deadline behind an untested code path. Onboarding is the safe one
 * to go first precisely because nothing in it expires.
 *
 * To add one: give it a `candidates()` that decides but does not send, and
 * returns a closure carrying its own bookkeeping. It must be safe to ask twice
 * — a candidate that loses today is asked again tomorrow.
 */
export function messagingSources(): MessagingSource[] {
  return [
    {
      name: "onboarding",
      candidates: async () => (await runOnboardingNudgeJob()).candidates,
    },
  ];
}
