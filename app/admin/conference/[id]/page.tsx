import { redirect } from "next/navigation";

export const metadata = { title: "Conference | Admin" };

/** Map old ?tab= values to new route segments */
const TAB_REDIRECTS: Record<string, string> = {
  details: "details",
  overview: "overview",
  setup: "setup",
  schedule: "schedule",
  products: "products",
  rules: "rules",
  registrations: "registrations",
  legal: "legal",
  wishlist: "wishlist",
  billing_runs: "billing-runs",
  "billing-runs": "billing-runs",
  swaps: "swaps",
  status: "status",
  "war-room": "war-room",
  badges: "badges",
  "schedule-ops": "schedule-ops",
  "travel-import": "travel-import",
  "check-in": "check-in",
};

export default async function ConferenceIndexPage({
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

  // Default: land on Overview (read-only summary), not the Edit form
  redirect(`/admin/conference/${id}/overview`);
}
