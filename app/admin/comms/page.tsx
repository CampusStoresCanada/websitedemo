import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseUTC } from "@/lib/utils";
import { listTemplates } from "@/lib/comms/templates";
import type { CampaignStatus } from "@/lib/comms/types";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import AutomationRulesPanel from "@/components/comms/AutomationRulesPanel";

export const metadata = {
  title: "Communications | Admin | Campus Stores Canada",
};

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

  const [{ data: rules }, templates] = await Promise.all([
    db.from("automation_rules").select("id, rule_key, label, template_key, automation_mode, enabled").order("label"),
    listTemplates(),
  ]);

  return (
    <main>
      <AdminPageHeader
        title="Communications"
        description="Audience-targeted campaigns, templates, and automated operational messaging."
        actions={
          <>
            <Link
              href="/admin/comms/templates"
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Templates
            </Link>
            <Link
              href="/admin/comms/new"
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover transition-colors"
            >
              New Campaign
            </Link>
          </>
        }
      />

      {/* Stats strip */}
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

      <AutomationRulesPanel rules={rules ?? []} templates={templates} />

      {/* Campaign list */}
      <div className="mt-6 rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Campaigns</h2>
        </div>

        {!campaigns?.length ? (
          <div className="px-4 py-12 text-center text-sm text-gray-500">
            No campaigns yet.{" "}
            <Link href="/admin/comms/new" className="text-accent hover:underline">
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
                        className="font-medium text-accent hover:underline"
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
