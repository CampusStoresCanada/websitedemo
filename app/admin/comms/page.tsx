import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseUTC } from "@/lib/utils";
import { listTemplates } from "@/lib/comms/templates";
import { listCampaignInitiatives } from "@/lib/comms/campaigns";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import AutomationRulesPanel from "@/components/comms/AutomationRulesPanel";

export const metadata = {
  title: "Communications | Admin | Campus Stores Canada",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

function pct(n: number, of: number): string {
  if (of <= 0) return "—";
  return `${Math.round((n / of) * 100)}%`;
}

const INITIATIVE_STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  paused: "bg-yellow-100 text-yellow-700",
  ended: "bg-gray-100 text-gray-500",
};

export default async function CommsPage() {
  const db = createAdminClient();

  const initiatives = await listCampaignInitiatives();

  // "Other sends" — series (grouped by email) with no parent campaign
  // initiative: automated/transactional stuff (renewal reminders, etc.)
  // and one-off sends nobody's tagged yet. Secondary, not the headline.
  const { data: otherSeries } = await db
    .from("message_campaign_series")
    .select("*")
    .is("campaign_id", null)
    .order("last_sent_at", { ascending: false })
    .limit(50);

  const { data: totals } = await db
    .from("message_deliveries")
    .select("status, open_count, click_count");

  const totalSent = totals?.length ?? 0;
  const totalDelivered = totals?.filter((d) => d.status === "delivered").length ?? 0;
  const totalOpened = totals?.filter((d) => d.open_count > 0).length ?? 0;
  const totalClicked = totals?.filter((d) => d.click_count > 0).length ?? 0;
  const totalFailed = totals?.filter((d) => ["bounced", "failed"].includes(d.status)).length ?? 0;
  const totalComplained = totals?.filter((d) => d.status === "complained").length ?? 0;

  const [{ data: rules }, templates] = await Promise.all([
    db.from("automation_rules").select("id, rule_key, label, template_key, automation_mode, enabled").order("label"),
    listTemplates(),
  ]);

  return (
    <main>
      <AdminPageHeader
        title="Communications"
        description="Ongoing campaigns, templates, and automated operational messaging."
        actions={
          <>
            <Link
              href="/admin/comms/suppressions"
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Suppressions
            </Link>
            <Link
              href="/admin/comms/templates"
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Templates
            </Link>
            <Link
              href="/admin/comms/campaigns/new"
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover transition-colors"
            >
              New Campaign
            </Link>
          </>
        }
      />

      {/* Stats strip — overall totals across every send */}
      <div className="grid grid-cols-3 gap-4 sm:grid-cols-6">
        {[
          { label: "Sent", value: totalSent, color: "text-gray-900" },
          { label: "Delivered", value: totalDelivered, color: "text-green-700" },
          { label: "Opened", value: totalOpened, color: "text-blue-700" },
          { label: "Clicked", value: totalClicked, color: "text-orange-600" },
          { label: "Bounced / Failed", value: totalFailed, color: "text-red-600" },
          { label: "Complained", value: totalComplained, color: "text-red-700" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
            <p className={`mt-1 text-2xl font-bold ${color}`}>{value.toLocaleString()}</p>
          </div>
        ))}
      </div>

      <AutomationRulesPanel rules={rules ?? []} templates={templates} />

      {/* Campaigns — the primary surface: ongoing initiatives, not individual sends */}
      <div className="mt-6 rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Campaigns</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Ongoing initiatives, combining every email and every resend that's part of them.
          </p>
        </div>

        {!initiatives.length ? (
          <div className="px-4 py-12 text-center text-sm text-gray-500">
            No campaigns yet.{" "}
            <Link href="/admin/comms/campaigns/new" className="text-accent hover:underline">
              Create one
            </Link>
            .
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-2 text-left font-medium text-gray-600">Campaign</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Status</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Sends</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Delivered</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Open Rate</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Click Rate</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Last Activity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {initiatives.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/comms/campaigns/${c.id}`} className="font-medium text-accent hover:underline">
                      {c.name}
                    </Link>
                    {c.goal && <div className="text-xs text-gray-500 mt-0.5">{c.goal}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        INITIATIVE_STATUS_COLORS[c.status] ?? "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{c.sendCount}</td>
                  <td className="px-4 py-3 text-gray-700">{c.deliveredCount}</td>
                  <td className="px-4 py-3 text-blue-700 font-medium">{pct(c.openedCount, c.deliveredCount)}</td>
                  <td className="px-4 py-3 text-orange-600 font-medium">{pct(c.clickedCount, c.deliveredCount)}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {c.lastSentAt ? parseUTC(c.lastSentAt).toLocaleDateString("en-CA") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Other sends — automated/transactional/uncategorized, not attached to a campaign */}
      <div className="mt-6 rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Other Sends</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Automated and one-off sends not attached to a campaign (renewal reminders, confirmations, etc.).
          </p>
        </div>

        {!otherSeries?.length ? (
          <div className="px-4 py-8 text-center text-sm text-gray-500">Nothing here.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-2 text-left font-medium text-gray-600">Email</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Sends</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Delivered</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Open Rate</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Click Rate</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Last Sent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {otherSeries.map((s) => (
                <tr key={s.series_key} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/comms/series/${encodeURIComponent(s.series_key ?? "")}`}
                      className="font-medium text-accent hover:underline"
                    >
                      {s.series_label}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{s.send_count}</td>
                  <td className="px-4 py-3 text-gray-700">{s.delivered_count}</td>
                  <td className="px-4 py-3 text-blue-700 font-medium">
                    {pct(s.opened_count ?? 0, s.delivered_count ?? 0)}
                  </td>
                  <td className="px-4 py-3 text-orange-600 font-medium">
                    {pct(s.clicked_count ?? 0, s.delivered_count ?? 0)}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {s.last_sent_at ? parseUTC(s.last_sent_at).toLocaleDateString("en-CA") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
