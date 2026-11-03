import { redirect } from "next/navigation";
import { requireAuthenticated } from "@/lib/auth/guards";
import { getPublicConference } from "@/lib/actions/conference";
import { getBursaryClaim, getBursaryRequest } from "@/lib/actions/conference-bursary";
import { getExpenseClaim } from "@/lib/actions/expense-claims";
import ExpenseClaimForm from "@/components/expenses/ExpenseClaimForm";
import { loginWithNext } from "@/lib/auth/login-redirect";
import { createAdminClient } from "@/lib/supabase/admin";
import BursaryRequestForm from "./BursaryRequestForm";

export const metadata = { title: "Travel Support Request" };

/**
 * A member school's travel bursary request. One per school; anyone registered
 * from the school, or its admin, can fill it in.
 *
 * The school is the viewer's member organisation, the same pick the conference
 * page makes for its bursary button.
 */
export default async function BursaryRequestPage({
  params,
}: {
  params: Promise<{ year: string; edition: string }>;
}) {
  const { year, edition } = await params;
  const auth = await requireAuthenticated();
  if (!auth.ok) redirect(loginWithNext(`/conference/${year}/${edition}/bursary`));

  const confResult = await getPublicConference(parseInt(year, 10), edition);
  if (!confResult.success || !confResult.data) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-xl font-semibold text-gray-900">Conference not found</h1>
      </main>
    );
  }
  const conference = confResult.data;

  const { data: orgRows } = auth.ctx.activeOrgIds.length
    ? await createAdminClient().from("organizations").select("id, name, type").in("id", auth.ctx.activeOrgIds)
    : { data: [] as Array<{ id: string; name: string; type: string | null }> };
  const school = (orgRows ?? []).find((o) => o.type === "Member") ?? null;

  if (!school) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-xl font-semibold text-gray-900">Travel support</h1>
        <p className="mt-2 text-sm text-gray-600">Travel support is for CSC member institutions.</p>
      </main>
    );
  }

  const request = await getBursaryRequest({ conferenceId: conference.id, organizationId: school.id });
  // Once the request is submitted, the expense claim follows it on this page.
  const claimRef = await getBursaryClaim({ conferenceId: conference.id, organizationId: school.id });
  const claim =
    claimRef.success && claimRef.data ? await getExpenseClaim(claimRef.data.claimId) : null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <p className="text-sm text-gray-500">{conference.name}</p>
      <h1 className="text-2xl font-semibold text-gray-900">Travel support for {school.name}</h1>
      {request.success ? (
        <BursaryRequestForm
          conferenceId={conference.id}
          organizationId={school.id}
          view={request.data}
          registerHref={`/conference/${year}/${edition}/register`}
        />
      ) : (
        <p className="mt-4 text-sm text-gray-600">{request.error}</p>
      )}
      {claim?.success && (
        <section className="mt-10">
          <h2 className="text-xl font-semibold text-gray-900">Your expense claim</h2>
          <p className="mt-1 text-sm text-gray-600">
            After the conference, claim what you spent and attach your receipts. Two Campus Stores Canada
            approvers review every claim before it&apos;s paid.
          </p>
          <div className="mt-4">
            <ExpenseClaimForm view={claim.data} />
          </div>
        </section>
      )}
    </main>
  );
}
