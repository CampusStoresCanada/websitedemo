import { createAdminClient } from "@/lib/supabase/admin";
import { canManageOrganization, requireAuthenticated } from "@/lib/auth/guards";
import { answerOrgTask } from "@/lib/actions/conference-tasks";
import { loadOrgTasks } from "@/lib/conference/checklist-tasks";
import { loadOrgPayments } from "@/lib/conference/org-payments";
import { loadOrgLegalStatus } from "@/lib/conference/org-legal";
import { getExhibitorStatusForOrg } from "@/lib/conference/exhibitor-status";
import TaskChecklist from "@/components/conference/TaskChecklist";
import OrgAgreements from "@/components/org/OrgAgreements";
import OrgPayments from "@/components/org/OrgPayments";
import PrintReadiness from "@/components/org/PrintReadiness";

/**
 * Everything this organisation owes for the conference, on the page they were
 * already on.
 *
 * This used to be a separate route (/org/[slug]/conference/[id]) carrying its
 * own to-do list, payment table, agreements and — worst of it — a second
 * implementation of seat assignment, when the roster on this very page has had
 * a per-person checkbox for every conference entity all along. One path, one
 * spot: scroll to #conference_checklist, see what is outstanding, act on it
 * without leaving.
 *
 * A server component so it can load its own data, rendered into the client
 * profile components through a slot. Returns null when the org holds nothing —
 * an empty conference block on every org page is noise for the 100+ orgs that
 * have not bought anything.
 */
export default async function ConferenceChecklistSection({
  orgId,
  slug,
  conferenceId,
}: {
  orgId: string;
  slug: string;
  conferenceId: string | null;
}) {
  if (!conferenceId) return null;

  // Payments and agreements name what this company bought and what it signed.
  // The page around this is readable by anyone signed in; this block is not.
  const auth = await requireAuthenticated();
  if (!auth.ok || !canManageOrganization(auth.ctx, orgId)) return null;

  const db = createAdminClient();
  const [allOrgTasks, payments, legalStatus, exhibitor] = await Promise.all([
    loadOrgTasks(db, conferenceId, orgId),
    loadOrgPayments(db, conferenceId, orgId),
    loadOrgLegalStatus(db, conferenceId, orgId, auth.ctx.userId),
    // Booth numbers go on a shipping label, so they belong beside the supplier
    // order — not two screens away on the storefront.
    getExhibitorStatusForOrg(orgId),
  ]);
  const boothNumbers = exhibitor?.boothNumbers ?? [];

  /**
   * A task earns a place in the list only if the list is where you act on it.
   *
   * Payment and agreements each own a block below with the real controls, and
   * seat assignment is the roster's checkbox column further up this same page.
   * Naming them here as well would be a table of contents written as prose —
   * restating work the reader can already see, above the buttons that do it.
   */
  const HANDLED_ELSEWHERE_ON_THIS_PAGE = new Set([
    "payment_complete",
    "legal_document_accepted",
    "seat_assigned",
  ]);
  const orgTasks = allOrgTasks.filter(
    (t) => !HANDLED_ELSEWHERE_ON_THIS_PAGE.has(t.checkType ?? "")
  );

  const nothingToShow =
    orgTasks.length === 0 && payments.orders.length === 0 &&
    legalStatus.mine.length === 0 && legalStatus.theirsTitles.length === 0;
  if (nothingToShow) return null;

  async function handleOrgTaskAnswer(
    taskId: string,
    state: "done" | "not_applicable" | "pending",
    evidence?: string
  ) {
    "use server";
    return answerOrgTask({
      organizationId: orgId, conferenceId: conferenceId!, taskId, state, evidence,
      revalidate: `/org/${slug}`,
    });
  }

  return (
    <section id="conference_checklist" className="max-w-6xl mx-auto px-4 pb-10 space-y-4 scroll-mt-20">
      <h2 className="text-lg font-semibold text-gray-900">Conference checklist</h2>

      {orgTasks.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="text-base font-semibold text-gray-900">Still to do</h3>
          <p className="mt-0.5 text-sm text-gray-500">
            Some we track for you; the rest you tick off. Assigning people happens in
            your team list above.
          </p>
          <div className="mt-2">
            <TaskChecklist tasks={orgTasks} onAnswer={handleOrgTaskAnswer}
              boothNumbers={boothNumbers}
              emptyLabel="Nothing outstanding for your company." />
          </div>
        </div>
      )}

      <OrgPayments summary={payments} />
      <OrgAgreements status={legalStatus} />

      {/* Replaces a bare "see your listing" link. A link tells you where to
          look; this tells you what is wrong and how to change it. */}
      <PrintReadiness
        orgId={orgId}
        listingHref={`/org/${slug}/conference/${conferenceId}/listing`}
      />
    </section>
  );
}
