import { redirect } from "next/navigation";
import { getConference } from "@/lib/actions/conference";
import { isSuperAdmin, requireAdmin } from "@/lib/auth/guards";
import ConferenceForm from "@/components/admin/conference/ConferenceForm";

export const metadata = { title: "Conference Details | Admin" };

/** Map old ?tab= values to new route segments */
const TAB_REDIRECTS: Record<string, string> = {
  overview: "overview",
  setup: "setup",
  schedule: "schedule",
  products: "products",
  rules: "rules",
  registrations: "registrations",
  legal: "legal",
  wishlist: "wishlist",
  billing_runs: "billing-runs",
  swaps: "swaps",
  status: "status",
};

export default async function ConferenceDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tab = typeof sp.tab === "string" ? sp.tab : undefined;

  // Legacy redirect: ?tab=X → /admin/conference/[id]/X
  if (tab && TAB_REDIRECTS[tab]) {
    redirect(`/admin/conference/${id}/${TAB_REDIRECTS[tab]}`);
  }

  const auth = await requireAdmin();
  const canSuperAdminOverride = auth.ok ? isSuperAdmin(auth.ctx.globalRole) : false;
  const googleMapsApiKey =
    process.env.GOOGLE_MAPS_API_KEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? null;
  const result = await getConference(id);
  if (!result.success || !result.data) {
    return (
      <div className="text-center py-12 text-gray-500">
        Conference not found. {result.error}
      </div>
    );
  }

  return (
    <ConferenceForm
      conference={result.data}
      canSuperAdminOverride={canSuperAdminOverride}
      googleMapsApiKey={googleMapsApiKey}
    />
  );
}
