import { getConference } from "@/lib/actions/conference";
import { requireConferenceDeskAccess } from "@/lib/auth/guards";
import ShippingDeskClient from "@/components/admin/conference/ShippingDeskClient";
import { loadDeskShipments, loadShippingOrigin, loadShippingRoster } from "@/lib/conference/shipping";

export const metadata = {
  title: "Conference Shipping Desk | Admin",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ConferenceShippingDeskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireConferenceDeskAccess(id);
  if (!auth.ok) {
    return (
      <main className="h-screen w-screen bg-white p-6 text-sm text-red-700">
        Conference desk access required.
      </main>
    );
  }

  const [conferenceResult, roster, shipments, origin] = await Promise.all([
    getConference(id),
    loadShippingRoster(id),
    loadDeskShipments(id),
    loadShippingOrigin(id),
  ]);
  if (!conferenceResult.success || !conferenceResult.data) {
    return <main className="h-screen w-screen bg-white p-6 text-sm text-red-700">Conference not found.</main>;
  }

  return (
    <ShippingDeskClient
      conferenceId={id}
      roster={roster}
      initialShipments={shipments}
      originLabel={origin ? `${origin.streetAddress.join(", ")}, ${origin.city}` : null}
      sandbox={process.env.PUROLATOR_ENV !== "production"}
    />
  );
}
