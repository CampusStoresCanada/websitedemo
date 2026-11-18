import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guards";
import { loginWithNext } from "@/lib/auth/login-redirect";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadQuickBooksBalances, type QuickBooksBalance } from "@/lib/billing/quickbooks-balances";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import QuickBooksBalances from "@/components/admin/QuickBooksBalances";

export const metadata = { title: "QuickBooks Balances | Admin" };
export const dynamic = "force-dynamic";

export default async function QuickBooksBalancesPage() {
  const auth = await requireAdmin();
  if (!auth.ok) redirect(loginWithNext("/admin/membership/balances"));

  let balances: QuickBooksBalance[] = [];
  let error: string | null = null;
  try {
    balances = await loadQuickBooksBalances(createAdminClient());
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return (
    <main>
      <AdminPageHeader
        title="QuickBooks Balances"
        description="Every invoice QuickBooks shows a balance on, beside what the site has open for it. QuickBooks is the standard: nothing here changes it."
      />
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          QuickBooks could not be read, so there is nothing to show: {error}
        </p>
      ) : (
        <QuickBooksBalances balances={balances} />
      )}
    </main>
  );
}
