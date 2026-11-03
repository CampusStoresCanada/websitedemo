import Link from "next/link";
import { getConference } from "@/lib/actions/conference";
import StatusControls from "@/components/admin/conference/StatusControls";

export const metadata = { title: "Status Controls | Admin" };

/**
 * Duplicate and delete. Moving the conference through its lifecycle (going
 * live) is the one panel on Overview (WAR_ROOM_OPERATE_PLAN §8.5): it used to
 * render here as well, two places for one verb.
 */
export default async function ConferenceStatusPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getConference(id);
  if (!result.success || !result.data) {
    return <div className="text-center py-12 text-gray-500">Conference not found.</div>;
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600">
        To change the conference&apos;s status or go live, use the{" "}
        <Link href={`/admin/conference/${id}/overview`} className="font-medium text-accent hover:underline">
          launch checklist on Overview
        </Link>
        .
      </p>
      <StatusControls conference={result.data} />
    </div>
  );
}
