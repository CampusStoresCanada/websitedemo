import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseUTC } from "@/lib/utils";
import type { CampaignStatus } from "@/lib/comms/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function pct(n: number, of: number): string {
  if (of <= 0) return "—";
  return `${Math.round((n / of) * 100)}%`;
}

const STATUS_COLORS: Record<CampaignStatus, string> = {
  draft: "bg-gray-100 text-gray-700",
  scheduled: "bg-blue-100 text-blue-700",
  sending: "bg-yellow-100 text-yellow-700",
  completed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  canceled: "bg-gray-100 text-gray-500",
};

export default async function SeriesPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const db = createAdminClient();

  const isNameFallback = key.startsWith("name:");
  const templateId = isNameFallback ? null : key;
  const name = isNameFallback ? key.slice(5) : null;

  let query = db
    .from("message_campaigns")
    .select("id, name, status, created_at, sent_at, completed_at, campaign_id");

  query = templateId ? query.eq("template_id", templateId) : query.is("template_id", null).eq("name", name ?? "");

  const { data: sends } = await query.order("created_at", { ascending: false });

  if (!sends?.length) notFound();

  const sendIds = sends.map((s) => s.id);
  const { data: deliveries } = await db
    .from("message_deliveries")
    .select("campaign_id, status, open_count, click_count")
    .in("campaign_id", sendIds);

  const statsBySend = new Map<string, { total: number; delivered: number; opened: number; clicked: number; failed: number }>();
  for (const s of sendIds) statsBySend.set(s, { total: 0, delivered: 0, opened: 0, clicked: 0, failed: 0 });
  for (const d of deliveries ?? []) {
    const stat = statsBySend.get(d.campaign_id);
    if (!stat) continue;
    stat.total++;
    if (d.status === "delivered") stat.delivered++;
    if (d.open_count > 0) stat.opened++;
    if (d.click_count > 0) stat.clicked++;
    if (["bounced", "failed"].includes(d.status)) stat.failed++;
  }

  const campaignId = sends.find((s) => s.campaign_id)?.campaign_id ?? null;

  return (
    <main>
      {campaignId ? (
        <Link href={`/admin/comms/campaigns/${campaignId}`} className="text-sm text-gray-500 hover:text-gray-700">
          ← Campaign
        </Link>
      ) : (
        <Link href="/admin/comms" className="text-sm text-gray-500 hover:text-gray-700">
          ← Communications
        </Link>
      )}
      <h1 className="mt-2 text-2xl font-bold text-gray-900">{sends[0].name}</h1>
      <p className="mt-1 text-sm text-gray-600">
        {sends.length} send{sends.length !== 1 ? "s" : ""} of this email.
      </p>

      <div className="mt-6 rounded-xl border border-gray-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="px-4 py-2 text-left font-medium text-gray-600">Send</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Status</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Delivered</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Open Rate</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Click Rate</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Sent</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sends.map((send) => {
              const stat = statsBySend.get(send.id)!;
              return (
                <tr key={send.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/comms/${send.id}`} className="font-medium text-accent hover:underline">
                      {parseUTC(send.created_at).toLocaleDateString("en-CA")}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        STATUS_COLORS[send.status as CampaignStatus] ?? "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {send.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{stat.delivered}</td>
                  <td className="px-4 py-3 text-blue-700 font-medium">{pct(stat.opened, stat.delivered)}</td>
                  <td className="px-4 py-3 text-orange-600 font-medium">{pct(stat.clicked, stat.delivered)}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {send.sent_at ? parseUTC(send.sent_at).toLocaleString("en-CA") : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
