import type { CheckType } from "./checklist-check-types";

/**
 * Where a task sends you — derived from its check type, never admin-entered, so
 * it can never point at a broken or wrong URL.
 *
 * ⛔ SPLIT OUT OF checklist-engine.ts SO BOTH AUDIENCES CAN IMPORT IT. The
 * engine constructs a Resend client at module scope; importing it from the
 * agenda would drag that in and throw without an API key. Exactly the reason
 * checklist-checks.ts and checklist-check-types.ts were split out before it.
 * The point of one module is that the two journeys can never drift into two
 * different answers for the same task.
 */

/**
 * WHO IS BEING ASKED. The same task reaches two people by two routes, and the
 * route is the difference:
 *
 *   org    — an org admin, answering for the company. Everything they do lives
 *            on /org/[slug]; that page is the one door, so its anchors are the
 *            destinations.
 *   person — a delegate, answering for themselves. Their conference lives on
 *            /me alongside their checklist and agenda. Sending them to their
 *            company's page would be sending them somewhere most of them cannot
 *            act, and for a personal answer, should not.
 */
export type TaskAudience = "org" | "person";

export type TaskCtaContext = {
  orgSlug: string;
  conferenceId: string;
  conferenceYear: number;
  conferenceEdition: string;
  organizationId: string;
};

/**
 * A delegate's own route for the tasks they can answer themselves.
 *
 * Deliberately sparse. Most check types are answered by a company — payment,
 * agreements, the directory listing — and a delegate has no personal version of
 * them, so they fall through to the org destination rather than getting a made
 * up personal one that leads to a page with no such control.
 */
const PERSON_DESTINATIONS: Partial<Record<CheckType, { label: string; path: string }>> = {
  top_choices_declared: {
    label: "Choose who you want to meet",
    path: "/me#my_top_choices",
  },
};

/**
 * The delegate's destination as a RELATIVE path, for rendering in the app.
 *
 * `getTaskCta` prefixes NEXT_PUBLIC_APP_URL because it addresses an email. The
 * agenda that shows the same task is already ON /me, so an absolute URL there
 * would navigate the reader off the page and back to reach an anchor a few
 * hundred pixels below them. Same table, two renderings — never a second table.
 */
export function getPersonTaskDestination(
  checkType: CheckType
): { label: string; path: string } | null {
  return PERSON_DESTINATIONS[checkType] ?? null;
}

export function getTaskCta(
  checkType: CheckType,
  ctx: TaskCtaContext,
  audience: TaskAudience = "org"
): { label: string; url: string } {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  if (audience === "person") {
    const personal = PERSON_DESTINATIONS[checkType];
    if (personal) return { label: personal.label, url: `${appUrl}${personal.path}` };
  }

  switch (checkType) {
    case "seat_assigned":
      // The org page's team roster has had a checkbox per conference entity
      // all along — that is where seats are assigned. A separate panel on a
      // separate route was a second way to do the same thing.
      return {
        label: "Choose who's going",
        url: `${appUrl}/org/${ctx.orgSlug}#team`,
      };
    case "entity_purchased":
      return {
        label: "Browse & purchase",
        url: `${appUrl}/conference/${ctx.conferenceYear}/${ctx.conferenceEdition}/offers?org=${ctx.organizationId}`,
      };
    case "travel_info_submitted":
      return { label: "View readiness & travel status", url: `${appUrl}/org/${ctx.orgSlug}#conference_checklist` };
    case "top_choices_declared":
      return {
        label: "Choose who you want to meet",
        url: `${appUrl}/org/${ctx.orgSlug}#meeting_preferences`,
      };
    case "payment_complete":
      return {
        label: "See what's owed",
        url: `${appUrl}/org/${ctx.orgSlug}#payment`,
      };
    case "legal_document_accepted":
      // Was "View readiness & travel status" pointing at this same page, which
      // then had no acceptance on it — a CTA that led nowhere twice over.
      return {
        label: "Read and accept",
        url: `${appUrl}/org/${ctx.orgSlug}#agreements`,
      };
    case "directory_profile_complete":
      // Straight to the org's own page, where every field this checks is edited.
      return { label: "Update your listing", url: `${appUrl}/org/${ctx.orgSlug}` };
    case "directory_profile_enriched":
      return { label: "Add your product details", url: `${appUrl}/org/${ctx.orgSlug}` };
    case "self_reported":
      // The tick-off list moved onto the org page with everything else.
      return { label: "Mark it done", url: `${appUrl}/org/${ctx.orgSlug}#conference_checklist` };
  }
}
