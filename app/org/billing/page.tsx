import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuthenticated, isGlobalAdmin, canManageOrganization } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrganizations } from "@/lib/data";
import { getRenewalConfig } from "@/lib/policy/engine";
import { RenewalStatusCard } from "@/components/renewal/RenewalStatusCard";
import AdminOrgSwitcher from "@/components/conference/AdminOrgSwitcher";
import { loginWithNext } from "@/lib/auth/login-redirect";

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing | Campus Stores Canada" };

interface OrgOption {
  id: string;
  name: string;
}

export default async function OrgBillingPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; invoice?: string }>;
}) {
  const query = await searchParams;
  const auth = await requireAuthenticated();
  // Carry ?org and ?invoice through sign-in: the "invoice ready" email lands here.
  if (!auth.ok) redirect(loginWithNext("/org/billing", query));

  const db = createAdminClient();
  const isAdmin = isGlobalAdmin(auth.ctx.globalRole);

  // Global admins can view any org's billing (same "act on behalf of" pattern
  // as the conference offers/cart admin picker); everyone else is limited to
  // orgs they're actually org_admin for — this page can void invoices and
  // opt an org out of renewal, not something a plain member should reach.
  let orgOptions: OrgOption[];
  if (isAdmin) {
    orgOptions = (await getOrganizations()).map((o) => ({ id: o.id, name: o.name }));
  } else if (auth.ctx.orgAdminOrgIds.length > 0) {
    const { data } = await db.from("organizations").select("id, name").in("id", auth.ctx.orgAdminOrgIds);
    orgOptions = data ?? [];
  } else {
    orgOptions = [];
  }

  if (orgOptions.length === 0) {
    return (
      <main className="max-w-3xl mx-auto py-12 px-4">
        <h1 className="text-2xl font-semibold text-gray-900">Billing</h1>
        <p className="mt-2 text-sm text-gray-600">
          You need to be an organization admin to view billing. Contact your organization's admin, or reach out to
          Campus Stores Canada if you believe this is a mistake.
        </p>
      </main>
    );
  }

  const selectedOrg = orgOptions.find((o) => o.id === query.org) ?? (isAdmin ? null : orgOptions[0]);

  if (!selectedOrg) {
    return (
      <main className="max-w-3xl mx-auto py-8 px-4 space-y-6">
        <h1 className="text-2xl font-semibold text-gray-900">Billing</h1>
        <AdminOrgSwitcher orgs={orgOptions} selectedOrgId={null} basePath="/org/billing" />
        <p className="text-sm text-gray-600">Pick an organization above to view its billing.</p>
      </main>
    );
  }

  // Defense in depth — orgOptions was already scoped to what this viewer can
  // manage, but re-check the specific selected org directly.
  if (!canManageOrganization(auth.ctx, selectedOrg.id)) {
    redirect("/org/billing");
  }

  const { data: org } = await db
    .from("organizations")
    .select("id, name, slug, membership_status, membership_expires_at, grace_period_started_at")
    .eq("id", selectedOrg.id)
    .single();

  if (!org) redirect("/org/billing");

  const renewalConfig = await getRenewalConfig();

  // The invoice an "invoice ready" email linked to, when it belongs to this
  // org; otherwise the latest one.
  const invoiceColumns = "id, type, status, total_cents, due_date";
  const { data: linkedInvoice } = query.invoice
    ? await db
        .from("invoices")
        .select(invoiceColumns)
        .eq("id", query.invoice)
        .eq("organization_id", org.id)
        .maybeSingle()
    : { data: null };
  const { data: latestInvoice } = linkedInvoice
    ? { data: null }
    : await db
        .from("invoices")
        .select(invoiceColumns)
        .eq("organization_id", org.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
  const invoiceRow = linkedInvoice ?? latestInvoice;

  const renewalInvoice = invoiceRow
    ? {
        id: invoiceRow.id,
        label: invoiceRow.type === "membership" || invoiceRow.type === "partnership" ? "Renewal Invoice" : "Invoice",
        status: invoiceRow.status,
        totalCents: invoiceRow.total_cents,
        dueDate: invoiceRow.due_date,
      }
    : null;

  return (
    <main className="max-w-3xl mx-auto py-8 px-4 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-gray-900">Billing</h1>
        <Link href={`/org/${org.slug}`} className="text-sm text-gray-500 hover:text-gray-700">
          ← Back to organization
        </Link>
      </div>

      {isAdmin ? (
        <AdminOrgSwitcher orgs={orgOptions} selectedOrgId={org.id} basePath="/org/billing" />
      ) : orgOptions.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {orgOptions.map((o) => (
            <Link
              key={o.id}
              href={`/org/billing?org=${o.id}`}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                o.id === org.id
                  ? "border-[#EE2A2E] bg-[#fff1f1] text-[#EE2A2E]"
                  : "border-gray-300 text-gray-700 hover:border-gray-400"
              }`}
            >
              {o.name}
            </Link>
          ))}
        </div>
      ) : null}

      <RenewalStatusCard
        orgId={org.id}
        orgName={org.name}
        membershipStatus={org.membership_status}
        membershipExpiresAt={org.membership_expires_at}
        gracePeriodStartedAt={org.grace_period_started_at}
        graceDays={renewalConfig.grace_days}
        renewalInvoice={renewalInvoice}
        canManage={canManageOrganization(auth.ctx, org.id)}
      />
    </main>
  );
}
