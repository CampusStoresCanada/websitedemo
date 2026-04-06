import { getConference } from "@/lib/actions/conference";
import { isSuperAdmin, requireAdmin } from "@/lib/auth/guards";
import ConferenceForm from "@/components/admin/conference/ConferenceForm";

export const metadata = { title: "Edit Conference | Admin" };

export default async function ConferenceEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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
