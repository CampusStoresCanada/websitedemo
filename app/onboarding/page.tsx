import { redirect } from "next/navigation";
import { getServerAuthState } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { isGlobalAdmin } from "@/lib/auth/guards";
import { OnboardingWizard } from "./OnboardingWizard";

export const metadata = {
  title: "Onboarding | Campus Stores Canada",
};

export default async function OnboardingPage() {
  const auth = await getServerAuthState();

  if (!auth.user) {
    redirect("/login");
  }

  // Find the user's organization (they should have exactly one as org_admin)
  const orgMembership = auth.organizations.find(
    (o) => o.role === "org_admin"
  );

  // Admins might be accessing on behalf of an org — check query param handled client-side
  const isAdmin = isGlobalAdmin(auth.globalRole);

  if (!orgMembership && !isAdmin) {
    redirect("/dashboard");
  }

  const orgId = orgMembership?.organization_id;

  if (!orgId && !isAdmin) {
    redirect("/dashboard");
  }

  // Fetch org data for the wizard
  const supabase = await createClient();

  let org = null;
  if (orgId) {
    const { data } = await supabase
      .from("organizations")
      .select(
        "id, name, type, slug, website, email, phone, street_address, city, province, postal_code, logo_url, company_description, metadata, procurement_info, onboarding_step, onboarding_completed_at, onboarding_reset_required, onboarding_reset_reason"
      )
      .eq("id", orgId)
      .single();
    org = data;
  }

  if (!org) {
    redirect("/dashboard");
  }

  // If onboarding already completed and no reset required, redirect
  if (org.onboarding_completed_at && !org.onboarding_reset_required) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-[70vh] px-4 py-12">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-gray-900">
            Welcome to Campus Stores Canada
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            Let&apos;s set up <strong>{org.name}</strong> — this should only
            take a few minutes.
          </p>
          {org.onboarding_reset_required && (
            <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-sm text-amber-800">
                {org.onboarding_reset_reason === "org_admin_changed"
                  ? "As the new organization admin, please review and confirm your organization details."
                  : "An administrator has requested that you review your onboarding information."}
              </p>
            </div>
          )}
        </div>
        <OnboardingWizard
          org={org as Record<string, unknown>}
          orgType={org.type as "Member" | "Vendor Partner"}
          initialStep={org.onboarding_step ?? 0}
        />
      </div>
    </div>
  );
}
