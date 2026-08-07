import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseUTC } from "@/lib/utils";
import type { CampaignStatus } from "@/lib/comms/types";

export const metadata = { title: "Conference Communications | Admin" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

const STATUS_COLORS: Record<CampaignStatus, string> = {
  draft: "bg-gray-100 text-gray-700",
  scheduled: "bg-blue-100 text-blue-700",
  sending: "bg-yellow-100 text-yellow-700",
  completed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  canceled: "bg-gray-100 text-gray-500",
};

export default async function ConferenceCommsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = createAdminClient();

  // Scoped to campaigns tagged with this conference — automated triggers set
  // this on audience_definition.filters.conference_instance_id regardless of
  // audience type, and manual broadcasts (all/holders/org admins/etc.) do
  // the same when scoped to an instance.
  const { data: campaigns } = await db
    .from("message_campaigns")
    .select(
      `id, name, status, trigger_source, automation_mode,
       created_at, scheduled_at, sent_at, completed_at,
       message_deliveries(count)`
    )
    .eq("audience_definition->filters->>conference_instance_id", id)
    .order("created_at", { ascending: false })
    .limit(100);

  const campaignIds = (campaigns ?? []).map((c) => c.id);
  const { data: deliveryStats } = campaignIds.length
    ? await db.from("message_deliveries").select("status, campaign_id").in("campaign_id", campaignIds)
    : { data: [] as { status: string; campaign_id: string }[] };

  const delivered = (deliveryStats ?? []).filter((d) => d.status === "delivered" || d.status === "sent").length;
  const bounced = (deliveryStats ?? []).filter((d) => ["bounced", "failed"].includes(d.status)).length;
  const total = deliveryStats?.length ?? 0;

  return (
    <main>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Communications</h2>
          <p className="text-sm text-gray-500">
            Registration confirmations, reminders, and campaigns sent for this conference.
          </p>
        </div>
        <Link
          href={`/admin/comms/new?conference_id=${id}`}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover transition-colors"
        >
          New Campaign
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total Sent</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{total.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Delivered</p>
          <p className="mt-1 text-2xl font-bold text-green-700">{delivered.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Bounced / Failed</p>
          <p className="mt-1 text-2xl font-bold text-red-600">{bounced.toLocaleString()}</p>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Campaigns</h3>
          <Link href="/admin/comms" className="text-xs text-accent hover:underline">
            View all communications ↗
          </Link>
        </div>

        {!campaigns?.length ? (
          <div className="px-4 py-12 text-center text-sm text-gray-500">
            No campaigns for this conference yet. Registration confirmations send automatically as
            people register.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-2 text-left font-medium text-gray-600">Name</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Status</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Source</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Mode</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Sends</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {campaigns.map((c) => {
                const sendCount = Array.isArray(c.message_deliveries) ? c.message_deliveries.length : 0;
                return (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link href={`/admin/comms/${c.id}`} className="font-medium text-accent hover:underline">
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          STATUS_COLORS[c.status as CampaignStatus] ?? "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{c.trigger_source}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{c.automation_mode ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-700">{sendCount}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {parseUTC(c.created_at).toLocaleDateString("en-CA")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
