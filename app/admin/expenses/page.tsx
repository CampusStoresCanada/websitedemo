/**
 * /admin/expenses: every expense claim that has been submitted, for approval.
 *
 * Admins and superadmins approve. Each claim needs its program's number of
 * approvals (two for the travel bursary) from different people, none of them
 * the claimant or linked to the organization being paid. The last approval
 * queues the QuickBooks payable.
 */

import { requireAdmin } from "@/lib/auth/guards";
import { listExpenseClaimsForReview, listExpensePrograms } from "@/lib/actions/expense-claims";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import ExpenseClaimReview from "@/components/admin/expenses/ExpenseClaimReview";
import ExpenseProgramQbo from "@/components/admin/expenses/ExpenseProgramQbo";

export const metadata = {
  title: "Expense Claims | Admin | Campus Stores Canada",
};

export const dynamic = "force-dynamic";

export default async function ExpenseClaimsPage() {
  const auth = await requireAdmin();
  if (!auth.ok) return <p className="p-6 text-sm text-gray-600">{auth.error}</p>;

  const [claims, programs] = await Promise.all([listExpenseClaimsForReview(), listExpensePrograms()]);
  const all = claims.success ? claims.data : [];
  const waiting = all.filter((c) => c.status === "submitted");
  const rest = all.filter((c) => c.status !== "submitted");

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Expense Claims"
        description="Two approvers per claim. Neither can be the claimant or linked to the organization being paid."
      />

      {!claims.success && <p className="text-sm text-red-700">{claims.error}</p>}

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Waiting for approval ({waiting.length})</h2>
        {waiting.length === 0 && <p className="text-sm text-gray-600">Nothing is waiting.</p>}
        {waiting.map((c) => (
          <ExpenseClaimReview key={c.id} claim={c} />
        ))}
      </section>

      {rest.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Decided</h2>
          {rest.map((c) => (
            <ExpenseClaimReview key={c.id} claim={c} />
          ))}
        </section>
      )}

      {programs.success && programs.data.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">Programs</h2>
          {programs.data.map((p) => (
            <ExpenseProgramQbo key={p.id} program={p} />
          ))}
        </section>
      )}
    </div>
  );
}
