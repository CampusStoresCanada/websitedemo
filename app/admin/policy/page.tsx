import { redirect } from "next/navigation";
import { requireAdmin, isSuperAdmin } from "@/lib/auth/guards";
import { getPolicyDashboardData } from "@/lib/actions/policy";
import { getPlatformConfig, getPlatformFeatures } from "@/lib/actions/platform";
import PolicyDashboard from "@/components/admin/policy/PolicyDashboard";
import BootstrapWizard from "@/components/admin/policy/BootstrapWizard";

export const metadata = {
  title: "Policy Settings | Admin | Campus Stores Canada",
};

export default async function PolicyPage() {
  const auth = await requireAdmin();
  if (!auth.ok) {
    redirect(auth.status === 401 ? "/login" : "/");
  }
  const superAdmin = isSuperAdmin(auth.ctx.globalRole);

  // Load platform config and features
  const [configResult, featuresResult, policyResult] = await Promise.all([
    getPlatformConfig(),
    getPlatformFeatures(),
    getPolicyDashboardData(),
  ]);

  const platformConfig = configResult.data ?? null;
  const features = featuresResult.data ?? [];
  const needsBootstrap = !platformConfig?.bootstrapped_at;

  // Show bootstrap wizard if not yet provisioned
  if (needsBootstrap) {
    if (!superAdmin) {
      return (
        <div className="text-center py-12">
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
            Platform Setup Required
          </h2>
          <p className="text-sm text-[var(--text-secondary)]">
            A super admin needs to complete the initial platform setup before
            policy settings are available.
          </p>
        </div>
      );
    }

    return (
      <BootstrapWizard
        features={features}
        hasPolicySet={!!policyResult.data?.activeSet}
      />
    );
  }

  if (!policyResult.success || !policyResult.data) {
    return (
      <div className="text-center py-12">
        <p className="text-[var(--text-secondary)]">
          Failed to load policy data: {policyResult.error}
        </p>
      </div>
    );
  }

  return (
    <PolicyDashboard
      activeSet={policyResult.data.activeSet}
      draft={policyResult.data.draft}
      activeValues={policyResult.data.activeValues}
      draftValues={policyResult.data.draftValues}
      isSuperAdmin={superAdmin}
      features={features}
      platformConfig={platformConfig}
    />
  );
}
