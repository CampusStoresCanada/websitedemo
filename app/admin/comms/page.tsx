import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CampaignStatus } from "@/lib/comms/types";

export const metadata = {
  title: "Communications | Admin | Campus Stores Canada",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

const STATUS_COLORS: Record<CampaignStatus, string> = {
  draft: "bg-gray-100 text-gray-700",
  scheduled: "bg-blue-100 text-[#D92327]",
  sending: "bg-yellow-100 text-yellow-700",
  completed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  canceled: "bg-gray-100 text-gray-500",
};

export default async function CommsPage() {
  const db = createAdminClient();

  const { data: campaigns } = await db
    .from("message_campaigns")
    .select(
      `id, name, status, trigger_source, automation_mode,
       created_at, scheduled_at, sent_at, completed_at,
       message_deliveries(count)`
    )
    .order("created_at", { ascending: false })
    .limit(50);

  // Summary stats
  const { data: stats } = await db
    .from("message_deliveries")
    .select("status");

  const delivered = stats?.filter((d) => d.status === "delivered").length ?? 0;
  const bounced = stats?.filter((d) => ["bounced", "failed"].includes(d.status)).length ?? 0;
  const total = stats?.length ?? 0;

  return (
    <main>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Communications</h1>
          <p className="mt-1 text-sm text-gray-600">
            Audience-targeted campaigns, templates, and automated operational messaging.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/admin/comms/templates"
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Templates
          </Link>
          <Link
            href="/admin/comms/new"
            className="rounded-lg bg-[#EE2A2E] px-4 py-2 text-sm font-medium text-white hover:bg-[#D92327] transition-colors"
          >
            New Campaign
          </Link>
        </div>
      </div>

      {/* Stats strip */}
      <div className="mt-6 grid grid-cols-3 gap-4">
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

      {/* v1.4 stub — Automation Rules */}
      <div className="mt-6 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-gray-700">Automation Rules</h2>
              <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                v1.4
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-500 max-w-xl">
              Configure which templates fire automatically on system events (membership renewals,
              conference registrations, admin transfers, etc.), and switch individual automations
              between <code className="bg-white rounded px-1">auto_send</code> and{" "}
              <code className="bg-white rounded px-1">draft_only</code> mode.
              Currently all automation rules are hardcoded — this panel will make them configurable.
            </p>
          </div>
        </div>
      </div>

      {/* Campaign list */}
      <div className="mt-6 rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Campaigns</h2>
        </div>

        {!campaigns?.length ? (
          <div className="px-4 py-12 text-center text-sm text-gray-500">
            No campaigns yet.{" "}
            <Link href="/admin/comms/new" className="text-[#EE2A2E] hover:underline">
              Create one
            </Link>
            .
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
                const sendCount = Array.isArray(c.message_deliveries)
                  ? c.message_deliveries.length
                  : 0;
                return (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/comms/${c.id}`}
                        className="font-medium text-[#EE2A2E] hover:underline"
                      >
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
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {c.automation_mode ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{sendCount}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(c.created_at).toLocaleDateString("en-CA")}
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
