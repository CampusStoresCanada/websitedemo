import { redirect } from "next/navigation";
import { requireAdmin, isSuperAdmin } from "@/lib/auth/guards";
import { getPolicyDashboardData } from "@/lib/actions/policy";
import PolicyDashboard from "@/components/admin/policy/PolicyDashboard";

export const metadata = {
  title: "Policy Settings | Admin | Campus Stores Canada",
};

export default async function PolicyPage() {
  const auth = await requireAdmin();
  if (!auth.ok) {
    redirect(auth.status === 401 ? "/login" : "/");
  }
  const superAdmin = isSuperAdmin(auth.ctx.globalRole);

  const result = await getPolicyDashboardData();

  if (!result.success || !result.data) {
    return (
      <div className="text-center py-12">
        <p className="text-[var(--text-secondary)]">
          Failed to load policy data: {result.error}
        </p>
      </div>
    );
  }

  return (
    <PolicyDashboard
      activeSet={result.data.activeSet}
      draft={result.data.draft}
      activeValues={result.data.activeValues}
      draftValues={result.data.draftValues}
      isSuperAdmin={superAdmin}
    />
  );
}
