import type { OnboardingStep } from "@/lib/actions/onboarding";

/**
 * Is this step still asking something of the person?
 *
 * One answer for the four places that used to each decide it inline, and each
 * decided it slightly wrong: `OnboardingGate`, `DirectoryOnboardingCallout`, and
 * both branches of `OrgOnboardingCallout` all tested `completed_at` alone.
 *
 * ⛔ A row carries THREE resolutions, not two. `completed_at` is "they did it",
 * `skipped_at` is "nobody is going to ask them" — set either by the person or,
 * as on 2026-10-15, by retiring a back catalogue so that switching a step on
 * does not re-onboard 144 people already underway. The nudge job has always
 * read both (`.is("completed_at", null).is("skipped_at", null)`); the in-app
 * surfaces read only one, so a step retired for mail kept prompting on the page.
 *
 * A missing row is open: the journey has not reached that step yet, and the
 * callouts have always treated it that way.
 */
export function isStepOpen(step: OnboardingStep | null | undefined): boolean {
  if (!step) return true;
  return !step.completed_at && !step.skipped_at;
}
