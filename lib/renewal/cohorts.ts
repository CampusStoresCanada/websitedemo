import type { RenewalOrgType } from "./renewal-progress";

/**
 * Cohort identity for the board renewal report. Deliberately a LEAF module:
 * type-only imports, nothing from Supabase, Stripe or the policy engine.
 *
 * It exists separately from board-report.ts because `MeetingRenewalsTab` is a
 * "use client" component and needs the `LAPSED_COHORT` value to decide how to
 * frame a panel. Importing that value from board-report.ts pulls the whole
 * server module into the client bundle — createAdminClient and the Stripe
 * client with it — and the page dies at runtime with "STRIPE_SECRET_KEY is not
 * set". Both `tsc` and `next build` pass while that is true; only loading the
 * page catches it. Same reasoning as lib/membership/status.ts.
 */
export const LAPSED_COHORT = "Lapsed" as const;

/**
 * Former member stores, reported alongside the two renewing populations.
 *
 * Not an org type — every one of them is still `type = "Member"`. It is a third
 * COHORT, because the board's job with them is different: not chasing a renewal
 * that is due, but asking a store that left whether it wants to come back. The
 * machinery underneath is identical (renewal_assignments, renewal_contact_log),
 * which is the point: a director picks up a win-back conversation the same way
 * they pick up a renewal call, and it lands on the same call list.
 */
export type BoardRenewalCohort = RenewalOrgType | typeof LAPSED_COHORT;
