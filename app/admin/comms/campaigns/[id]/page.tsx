import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseUTC } from "@/lib/utils";
import {
  getCampaignInitiative,
  listMilestones,
  updateCampaignInitiative,
  deleteCampaignInitiative,
  createMilestone,
} from "@/lib/comms/campaigns";
import { listTemplates, forkTemplateIntoCampaign } from "@/lib/comms/templates";
import { listConditions } from "@/lib/comms/conditions/store";
import type { CampaignInitiativeStatus } from "@/lib/comms/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function pct(n: number, of: number): string {
  if (of <= 0) return "—";
  return `${Math.round((n / of) * 100)}%`;
}

function localDatetimeValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const STATUS_COLORS: Record<CampaignInitiativeStatus, string> = {
  active: "bg-green-100 text-green-700",
  paused: "bg-yellow-100 text-yellow-700",
  ended: "bg-gray-100 text-gray-500",
};

async function updateSettingsAction(campaignId: string, formData: FormData) {
  "use server";
  const name = (formData.get("name") as string)?.trim();
  if (!name) return;
  const goal = (formData.get("goal") as string)?.trim() || null;
  const status = formData.get("status") as CampaignInitiativeStatus;
  await updateCampaignInitiative(campaignId, { name, goal, status });
}

async function deleteAction(campaignId: string) {
  "use server";
  const result = await deleteCampaignInitiative(campaignId);
  if (result.success) redirect("/admin/comms");
}

async function updateRelevanceAction(campaignId: string, formData: FormData) {
  "use server";
  const target_condition_keys = formData.getAll("target_condition_keys") as string[];
  const target_condition_match = (formData.get("target_condition_match") as "all" | "any") || "all";
  await updateCampaignInitiative(campaignId, { target_condition_keys, target_condition_match });
}

async function addMilestoneAction(campaignId: string, formData: FormData) {
  "use server";
  const note = (formData.get("note") as string)?.trim();
  if (!note) return;
  const templateId = (formData.get("template_id") as string) || undefined;
  const occurredAtRaw = formData.get("occurred_at") as string | null;
  const occurredAt = occurredAtRaw ? new Date(occurredAtRaw) : undefined;
  await createMilestone({ campaignId, note, templateId, occurredAt });
}

async function forkAction(campaignId: string, formData: FormData) {
  "use server";
  const sourceId = formData.get("source_template_id") as string;
  if (!sourceId) return;
  const result = await forkTemplateIntoCampaign(sourceId, campaignId);
  if (result.success && result.id) {
    redirect(`/admin/comms/templates/${result.id}`);
  }
}

export default async function CampaignInitiativePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = createAdminClient();

  const campaign = await getCampaignInitiative(id);
  if (!campaign) notFound();

  const [milestones, roster, libraryTemplates, { data: rosterSeries }, allConditions] = await Promise.all([
    listMilestones(id),
    listTemplates({ campaignId: id }),
    listTemplates(),
    db.from("message_campaign_series").select("*").eq("campaign_id", id),
    listConditions(),
  ]);

  const seriesByTemplateId = new Map((rosterSeries ?? []).map((s) => [s.series_key, s]));

  return (
    <main>
      <Link href="/admin/comms" className="text-sm text-gray-500 hover:text-gray-700">
        ← Communications
      </Link>

      <form action={updateSettingsAction.bind(null, id)} className="mt-2">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <input
              name="name"
              defaultValue={campaign.name}
              required
              className="block w-full text-2xl font-bold text-gray-900 border-0 border-b border-transparent hover:border-gray-200 focus:border-[#163D6D] focus:outline-none px-0 py-0.5 bg-transparent"
            />
            <textarea
              name="goal"
              defaultValue={campaign.goal ?? ""}
              rows={2}
              placeholder="Goal (optional)"
              className="mt-1 block w-full max-w-2xl text-sm text-gray-600 border-0 border-b border-transparent hover:border-gray-200 focus:border-[#163D6D] focus:outline-none px-0 py-0.5 bg-transparent resize-none"
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <select
              name="status"
              defaultValue={campaign.status}
              className={`rounded-full border-0 px-3 py-1 text-xs font-medium ${STATUS_COLORS[campaign.status]}`}
            >
              <option value="active">active</option>
              <option value="paused">paused</option>
              <option value="ended">ended</option>
            </select>
            <button
              type="submit"
              className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Save
            </button>
          </div>
        </div>
      </form>

      {campaign.sendCount === 0 && (
        <form action={deleteAction.bind(null, id)} className="mt-1">
          <button type="submit" className="text-xs text-gray-400 hover:text-red-600 transition-colors">
            Delete this campaign
          </button>
        </form>
      )}

      {/* Tier-0 totals */}
      <div className="mt-4 grid grid-cols-3 gap-4 sm:grid-cols-6">
        {[
          { label: "Sends", value: campaign.sendCount, color: "text-gray-900" },
          { label: "Delivered", value: campaign.deliveredCount, color: "text-green-700" },
          { label: "Opened", value: campaign.openedCount, color: "text-blue-700" },
          { label: "Clicked", value: campaign.clickedCount, color: "text-orange-600" },
          { label: "Failed", value: campaign.failedCount, color: "text-red-600" },
          { label: "Complained", value: campaign.complainedCount, color: "text-red-700" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-xl border border-gray-200 bg-white p-3">
            <p className="text-xs text-gray-500">{label}</p>
            <p className={`mt-1 text-xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Roster — the emails that make up this campaign */}
      <div className="mt-6 rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Emails</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Each one is its own editable copy — changes here never affect the shared library.
            </p>
          </div>
          <Link
            href={`/admin/comms/templates/new?campaign_id=${id}`}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors whitespace-nowrap"
          >
            + Start Blank
          </Link>
        </div>

        {roster.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-2 text-left font-medium text-gray-600">Email</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Sends</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Delivered</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Open Rate</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Click Rate</th>
                <th className="px-4 py-2 text-right font-medium text-gray-600"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {roster.map((t) => {
                const s = seriesByTemplateId.get(t.id);
                return (
                  <tr key={t.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{t.name}</div>
                      {t.description && <div className="text-xs text-gray-500 mt-0.5">{t.description}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{s?.send_count ?? 0}</td>
                    <td className="px-4 py-3 text-gray-700">{s?.delivered_count ?? 0}</td>
                    <td className="px-4 py-3 text-blue-700 font-medium">
                      {pct(s?.opened_count ?? 0, s?.delivered_count ?? 0)}
                    </td>
                    <td className="px-4 py-3 text-orange-600 font-medium">
                      {pct(s?.clicked_count ?? 0, s?.delivered_count ?? 0)}
                    </td>
                    <td className="px-4 py-3 text-right space-x-3 whitespace-nowrap">
                      {s && (s.send_count ?? 0) > 0 && (
                        <Link
                          href={`/admin/comms/series/${encodeURIComponent(s.series_key ?? "")}`}
                          className="text-xs text-gray-500 hover:text-gray-700 hover:underline"
                        >
                          History
                        </Link>
                      )}
                      <Link
                        href={`/admin/comms/new?campaign_id=${id}&template_id=${t.id}`}
                        className="text-xs text-accent hover:underline"
                      >
                        Send
                      </Link>
                      <Link
                        href={`/admin/comms/templates/${t.id}`}
                        className="text-xs text-accent hover:underline"
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Fork from library */}
        {libraryTemplates.length > 0 && (
          <form
            action={forkAction.bind(null, id)}
            className="flex items-center gap-2 px-4 py-3 border-t border-gray-100 bg-gray-50"
          >
            <select
              name="source_template_id"
              required
              defaultValue=""
              className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D]"
            >
              <option value="" disabled>
                Fork a library template into this campaign…
              </option>
              {libraryTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 transition-colors whitespace-nowrap"
            >
              Fork
            </button>
          </form>
        )}
      </div>

      {/* Still relevant while — ongoing audience suppression for every send under this campaign */}
      <div className="mt-6 rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Still Relevant While</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Every send under this campaign automatically excludes anyone who no longer meets these — checked fresh
            at send time, not when the send was created. e.g. stop reminding someone once they&apos;ve added their logo.
          </p>
        </div>

        <form action={updateRelevanceAction.bind(null, id)} className="p-4 space-y-2">
          {allConditions.length === 0 ? (
            <p className="text-xs text-gray-400">
              No saved conditions yet — create one from a template&apos;s &quot;Insert Conditional&quot; button first.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-3 text-xs text-gray-600 pb-1.5 mb-1 border-b border-gray-100">
                <span className="font-medium">Match:</span>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="target_condition_match"
                    value="all"
                    defaultChecked={campaign.target_condition_match !== "any"}
                    className="text-accent focus:ring-accent"
                  />
                  All of these
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="target_condition_match"
                    value="any"
                    defaultChecked={campaign.target_condition_match === "any"}
                    className="text-accent focus:ring-accent"
                  />
                  Any of these
                </label>
              </div>
              {allConditions.map((c) => (
                <label key={c.key} className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    name="target_condition_keys"
                    value={c.key}
                    defaultChecked={campaign.target_condition_keys.includes(c.key)}
                    className="rounded border-gray-300 text-accent focus:ring-accent"
                  />
                  {c.label}
                </label>
              ))}
            </>
          )}
          <button
            type="submit"
            className="mt-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Save
          </button>
        </form>
      </div>

      {/* Milestones */}
      <div className="mt-6 rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Milestones</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Notes on when something changed, so performance can be read before/after.
          </p>
        </div>

        <form action={addMilestoneAction.bind(null, id)} className="flex flex-wrap items-start gap-2 px-4 py-3 border-b border-gray-100 bg-gray-50">
          <input
            name="note"
            required
            placeholder="e.g. Rewrote Reminder #2's CTA"
            className="flex-1 min-w-[200px] rounded-lg border border-gray-300 px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D]"
          />
          <input
            name="occurred_at"
            type="datetime-local"
            defaultValue={localDatetimeValue(new Date())}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D]"
          />
          {roster.length > 0 && (
            <select
              name="template_id"
              defaultValue=""
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D]"
            >
              <option value="">(not tied to one email)</option>
              {roster.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="submit"
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover transition-colors whitespace-nowrap"
          >
            Add Milestone
          </button>
        </form>

        {milestones.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-500">No milestones yet.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {milestones.map((m) => {
              const tmpl = roster.find((t) => t.id === m.template_id);
              return (
                <li key={m.id} className="px-4 py-3 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm text-gray-900">{m.note}</p>
                    {tmpl && (
                      <span className="mt-1 inline-flex items-center rounded bg-blue-50 px-1.5 py-0.5 text-xs text-accent">
                        {tmpl.name}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-gray-500 whitespace-nowrap">
                    {parseUTC(m.occurred_at).toLocaleString("en-CA")}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
