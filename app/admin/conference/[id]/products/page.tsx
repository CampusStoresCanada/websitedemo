import { getConference } from "@/lib/actions/conference";
import { listConferenceScheduleModules } from "@/lib/actions/conference-schedule-design";
import ProductManager from "@/components/admin/conference/ProductManager";

export const metadata = { title: "Conference Products | Admin" };

export default async function ConferenceProductsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [result, modulesResult] = await Promise.all([
    getConference(id),
    listConferenceScheduleModules(id),
  ]);
  if (!result.success || !result.data) {
    return <div className="text-center py-12 text-gray-500">Conference not found.</div>;
  }

  return (
    <ProductManager
      conferenceId={result.data.id}
      initialProducts={result.data.conference_products ?? []}
      initialScheduleModules={modulesResult.success ? modulesResult.data ?? [] : []}
    />
  );
}
