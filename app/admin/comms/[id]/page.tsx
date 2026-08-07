import { createAdminClient } from "@/lib/supabase/admin";
import Link from "next/link";
import { notFound } from "next/navigation";
import { executeCampaignSend, cancelScheduledCampaign, scheduleCampaign } from "@/lib/comms/send";
import { previewAudience } from "@/lib/comms/audience";
import { resolveEffectiveAudience } from "@/lib/comms/campaigns";
import type {
  AudienceDefinition,
  CampaignStatus,
  DeliveryStatus,
  MessageTemplate,
} from "@/lib/comms/types";
import CampaignPreviewButton from "@/components/comms/CampaignPreviewButton";
import CampaignClickMapButton from "@/components/comms/CampaignClickMapButton";
import { parseUTC } from "@/lib/utils";

export const metadata = {
  title: "Campaign Detail | Communications | Admin | Campus Stores Canada",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60; // "Send Now" server action can push a few hundred recipients through sendEmailBatch

/** UTC ISO string -> "YYYY-MM-DDTHH:mm" in the viewer's local time, for a datetime-local input's defaultValue. Date's getters already return local components, so this is just formatting, no offset math. */
function toLocalDateTimeInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = parseUTC(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const STATUS_COLORS: Record<DeliveryStatus, string> = {
  queued: "bg-gray-100 text-gray-600",
  sent: "bg-blue-100 text-accent",
  delivered: "bg-green-100 text-green-700",
  bounced: "bg-red-100 text-red-700",
  failed: "bg-red-100 text-red-700",
  complained: "bg-orange-100 text-orange-700",
};

async function sendCampaignAction(campaignId: string) {
  "use server";
  await executeCampaignSend(campaignId);
}

async function cancelCampaignAction(campaignId: string) {
  "use server";
  await cancelScheduledCampaign(campaignId);
}

async function scheduleCampaignAction(formData: FormData) {
  "use server";
  const campaignId = formData.get("campaign_id") as string;
  const scheduledAtRaw = formData.get("scheduled_at") as string;
  if (!scheduledAtRaw) return;
  await scheduleCampaign(campaignId, new Date(scheduledAtRaw));
}

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = createAdminClient();

  const { data: campaign, error } = await db
    .from("message_campaigns")
    .select(`*, message_templates(key, name, subject, body_html, variable_keys, category, is_transactional)`)
    .eq("id", id)
    .single();

  if (error || !campaign) notFound();

  const { data: deliveries } = await db
    .from("message_deliveries")
    .select(`
      id, status, error, queued_at, sent_at, delivered_at, bounced_at, failed_at,
      opened_at, open_count, first_clicked_at, click_count,
      message_recipients(contact_email, display_name)
    `)
    .eq("campaign_id", id)
    .order("queued_at", { ascending: false })
    .limit(200);

  const { data: linkClickRows } = await db
    .from("message_link_clicks")
    .select("url")
    .eq("campaign_id", id)
    .limit(5000);

  const clicksByUrl: Record<string, number> = {};
  for (const row of linkClickRows ?? []) {
    clicksByUrl[row.url] = (clicksByUrl[row.url] ?? 0) + 1;
  }
  const totalClicks = linkClickRows?.length ?? 0;

  // Audience preview (for drafts and not-yet-sent scheduled campaigns)
  const status = campaign.status as CampaignStatus;
  const isDraft = status === "draft";
  const isScheduled = status === "scheduled";
  const canSendNow = isDraft || isScheduled;

  // Template data for email preview
  const tmpl = campaign.message_templates as Pick<
    MessageTemplate,
    "name" | "subject" | "body_html" | "variable_keys" | "category" | "is_transactional"
  > | null;
  const previewBodyHtml = tmpl?.body_html ?? campaign.body_override ?? "";
  const previewSubject = tmpl?.subject ?? campaign.subject_override ?? "";
  const previewVariableKeys = tmpl?.variable_keys ?? [];
  const previewVariableValues = (campaign.variable_values ?? {}) as Record<string, string>;
  const canPreview = !!(previewBodyHtml || previewSubject);
  const effectiveAudienceForPreview = canSendNow
    ? await resolveEffectiveAudience(
        campaign.audience_definition as unknown as AudienceDefinition,
        campaign.campaign_id
      )
    : null;
  const audiencePreview = effectiveAudienceForPreview
    ? await previewAudience(
        effectiveAudienceForPreview,
        tmpl?.is_transactional ? undefined : (tmpl?.category ?? null)
      )
    : null;

  const deliveryStats = {
    total: deliveries?.length ?? 0,
    sent: deliveries?.filter((d) => ["sent", "delivered"].includes(d.status)).length ?? 0,
    delivered: deliveries?.filter((d) => d.status === "delivered").length ?? 0,
    failed: deliveries?.filter((d) => ["bounced", "failed"].includes(d.status)).length ?? 0,
    opened: deliveries?.filter((d) => d.open_count > 0).length ?? 0,
    clicked: deliveries?.filter((d) => d.click_count > 0).length ?? 0,
  };
  const canClickMap = canPreview && deliveryStats.total > 0;

  return (
    <main>
      <Link href="/admin/comms" className="text-sm text-gray-500 hover:text-gray-700">
        ← Communications
      </Link>

      <div className="mt-2 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{campaign.name}</h1>
          <p className="mt-1 text-sm text-gray-500">
            Source: {campaign.trigger_source}
            {campaign.automation_mode && ` · ${campaign.automation_mode}`}
            {campaign.trigger_event_key && (
              <> · <code className="bg-gray-100 rounded px-1 text-xs">{campaign.trigger_event_key}</code></>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {canPreview && (
            <CampaignPreviewButton
              bodyHtml={previewBodyHtml}
              subject={previewSubject}
              variableKeys={previewVariableKeys}
              variableValues={previewVariableValues}
              isTransactional={!!tmpl?.is_transactional}
            />
          )}
          {canClickMap && (
            <CampaignClickMapButton
              bodyHtml={previewBodyHtml}
              subject={previewSubject}
              variableKeys={previewVariableKeys}
              variableValues={previewVariableValues}
              clicksByUrl={clicksByUrl}
              totalClicks={totalClicks}
              isTransactional={!!tmpl?.is_transactional}
            />
          )}
          {canSendNow && (
            <form action={scheduleCampaignAction} className="flex items-center gap-1.5">
              <input type="hidden" name="campaign_id" value={id} />
              <input
                type="datetime-local"
                name="scheduled_at"
                defaultValue={toLocalDateTimeInputValue(campaign.scheduled_at)}
                className="rounded-lg border border-gray-300 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
              <button
                type="submit"
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors whitespace-nowrap"
              >
                {isScheduled ? "Update Schedule" : "Schedule"}
              </button>
            </form>
          )}
          {isScheduled && (
            <form
              action={async () => {
                "use server";
                await cancelCampaignAction(id);
              }}
            >
              <button
                type="submit"
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancel Schedule
              </button>
            </form>
          )}
          {canSendNow && (
            <form
              action={async () => {
                "use server";
                await sendCampaignAction(id);
              }}
            >
              <button
                type="submit"
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
              >
                Send Now
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Meta */}
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <p className="text-xs text-gray-500">Status</p>
          <p className="mt-1 font-semibold text-gray-900 capitalize">{campaign.status}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <p className="text-xs text-gray-500">Template</p>
          <p className="mt-1 font-semibold text-gray-900 text-sm">
            {(campaign.message_templates as { name: string } | null)?.name ?? "—"}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <p className="text-xs text-gray-500">Created</p>
          <p className="mt-1 font-semibold text-gray-900 text-sm">
            {parseUTC(campaign.created_at).toLocaleString("en-CA")}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <p className="text-xs text-gray-500">{isScheduled ? "Scheduled For" : "Completed"}</p>
          <p className="mt-1 font-semibold text-gray-900 text-sm">
            {isScheduled
              ? campaign.scheduled_at
                ? parseUTC(campaign.scheduled_at).toLocaleString("en-CA")
                : "—"
              : campaign.completed_at
                ? parseUTC(campaign.completed_at).toLocaleString("en-CA")
                : "—"}
          </p>
        </div>
      </div>

      {/* Audience preview (draft or scheduled, not yet sent) */}
      {canSendNow && audiencePreview && (
        <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
          <p className="text-sm font-medium text-blue-800">
            Audience preview: {audiencePreview.count} recipient{audiencePreview.count !== 1 ? "s" : ""}
          </p>
          {audiencePreview.sample.length > 0 && (
            <ul className="mt-2 space-y-1">
              {audiencePreview.sample.map((r) => (
                <li key={r.email} className="text-xs text-accent">
                  {r.name ? `${r.name} <${r.email}>` : r.email}
                </li>
              ))}
              {audiencePreview.count > 5 && (
                <li className="text-xs text-blue-500">
                  +{audiencePreview.count - 5} more…
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      {/* Delivery stats */}
      {deliveryStats.total > 0 && (
        <div className="mt-4 grid grid-cols-3 gap-4 sm:grid-cols-6">
          {[
            { label: "Total", value: deliveryStats.total, color: "text-gray-900" },
            { label: "Sent", value: deliveryStats.sent, color: "text-accent" },
            { label: "Delivered", value: deliveryStats.delivered, color: "text-green-700" },
            { label: "Opened", value: deliveryStats.opened, color: "text-blue-700" },
            { label: "Clicked", value: deliveryStats.clicked, color: "text-orange-600" },
            { label: "Failed", value: deliveryStats.failed, color: "text-red-600" },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-xl border border-gray-200 bg-white p-3">
              <p className="text-xs text-gray-500">{label}</p>
              <p className={`mt-1 text-xl font-bold ${color}`}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Delivery table */}
      {deliveries && deliveries.length > 0 && (
        <div className="mt-6 rounded-xl border border-gray-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900">Delivery Log</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-2 text-left font-medium text-gray-600">Recipient</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Status</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Opens</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Clicks</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Sent At</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {deliveries.map((d) => {
                const r = Array.isArray(d.message_recipients)
                  ? d.message_recipients[0]
                  : d.message_recipients;
                return (
                  <tr key={d.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-900">
                      {r?.display_name
                        ? `${r.display_name} <${r.contact_email}>`
                        : r?.contact_email ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          STATUS_COLORS[d.status as DeliveryStatus] ?? "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {d.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {d.open_count > 0 ? d.open_count : "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {d.click_count > 0 ? d.click_count : "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {d.sent_at
                        ? parseUTC(d.sent_at).toLocaleString("en-CA")
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-red-600 text-xs">{d.error ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
