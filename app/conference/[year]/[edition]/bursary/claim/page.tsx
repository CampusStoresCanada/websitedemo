import { redirect } from "next/navigation";
import { requireAuthenticated } from "@/lib/auth/guards";
import { getPublicConference } from "@/lib/actions/conference";
import { getBursaryClaim, getBursarySchool } from "@/lib/actions/conference-bursary";
import { getExpenseClaim } from "@/lib/actions/expense-claims";
import ExpenseClaimForm from "@/components/expenses/ExpenseClaimForm";
import { loginWithNext } from "@/lib/auth/login-redirect";

export const metadata = { title: "Travel Expense Claim" };

/**
 * A member school's travel expense claim: the step after the conference,
 * apart from the request (Steve, 2026-11-05). The claim opens on first visit
 * once the request is submitted (getBursaryClaim).
 */
export default async function BursaryClaimPage({
  params,
}: {
  params: Promise<{ year: string; edition: string }>;
}) {
  const { year, edition } = await params;
  const auth = await requireAuthenticated();
  if (!auth.ok) redirect(loginWithNext(`/conference/${year}/${edition}/bursary/claim`));

  const confResult = await getPublicConference(parseInt(year, 10), edition);
  const school = await getBursarySchool();
  if (!confResult.success || !confResult.data || !school) redirect(`/conference/${year}/${edition}/bursary`);
  const conference = confResult.data;

  const claimRef = await getBursaryClaim({ conferenceId: conference.id, organizationId: school.id });
  const claim = claimRef.success && claimRef.data ? await getExpenseClaim(claimRef.data.claimId) : null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <p className="text-sm text-gray-500">{conference.name}</p>
      <h1 className="text-2xl font-semibold text-gray-900">Travel expense claim for {school.name}</h1>
      <p className="mt-1 text-sm">
        <a href={`/conference/${year}/${edition}/bursary`} className="text-[#163D6D] underline">
          Back to your travel support request
        </a>
      </p>
      {claim?.success ? (
        <>
          <p className="mt-4 text-sm text-gray-600">
            Claim what you spent and attach your receipts. Two Campus Stores Canada approvers review every claim
            before it&apos;s paid.
          </p>
          <div className="mt-4">
            <ExpenseClaimForm view={claim.data} />
          </div>
        </>
      ) : (
        <p className="mt-4 text-sm text-gray-600">
          {claimRef.success ? "Your claim opens once your travel support request is submitted." : claimRef.error}
        </p>
      )}
    </main>
  );
}
