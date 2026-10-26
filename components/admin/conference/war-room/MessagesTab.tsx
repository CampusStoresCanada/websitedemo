"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import CampaignPreviewButton from "@/components/comms/CampaignPreviewButton";
import { runConferenceRemindersNow } from "@/lib/actions/conference-checklists";
import type { ChecklistRunResult } from "@/lib/conference/checklist-engine";
import OperateRow from "@/components/ui/OperateRow";

import { plural, whenMountain } from "./shared";

/** This conference's messages, as the page read them from Comms. */
export type WarRoomMessages = {
  broadcasts: Array<{
    id: string;
    name: string;
    status: string;
    /** Scheduled for, sent, or created (ISO). */
    when: string;
    delivered: number;
    /** Who a draft or scheduled campaign reaches now; null once sent. */
    recipients: number | null;
    preview: { subject: string; bodyHtml: string; variableKeys: string[]; variableValues: Record<string, string>; isTransactional: boolean };
  }>;
  /** Emails that fire on events, by template. */
  automatic: Array<{ key: string; name: string; templateId: string | null; sent: number; last: string | null }>;
  /** When checklist reminders last went to this conference (ISO). */
  lastReminder: string | null;
};

const CAMPAIGN_STATUS_WORDS: Record<string, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  sending: "Sending",
  completed: "Sent",
  failed: "Failed",
  canceled: "Cancelled",
};

/**
 * Messages (WAR_ROOM_OPERATE_PLAN §5): this conference's email, in context.
 * Comms stays where messages are written, sent and tracked; Edit goes there,
 * and every send here goes through Comms' own send.
 */
export function MessagesView({
  conferenceId,
  messages,
  sendCampaign,
  canSend,
}: {
  conferenceId: string;
  messages: WarRoomMessages;
  sendCampaign: (campaignId: string) => Promise<{ success: boolean; error?: string }>;
  /** Email to members goes only with a super admin; others see what there is. */
  canSend: boolean;
}) {
  const [reminders, setReminders] = useState<ChecklistRunResult | null>(null);
  const [reminderError, setReminderError] = useState<string | null>(null);
  const [remindersSent, setRemindersSent] = useState<string | null>(null);
  const router = useRouter();

  // The dry run is the count and the preview: who would get what, nothing sent.
  const checkReminders = useCallback(async () => {
    const res = await runConferenceRemindersNow(conferenceId, { dryRun: true });
    if (res.success) setReminders(res.data);
    else setReminderError(res.error);
  }, [conferenceId]);
  useEffect(() => {
    if (!canSend) return;
    let live = true;
    void runConferenceRemindersNow(conferenceId, { dryRun: true }).then((res) => {
      if (!live) return;
      if (res.success) setReminders(res.data);
      else setReminderError(res.error);
    });
    return () => {
      live = false;
    };
  }, [conferenceId, canSend]);

  const due = reminders?.preview ?? [];
  const reminderState = !canSend
    ? `Only a super admin can check or send reminders${
        messages.lastReminder ? ` (last sent ${whenMountain(messages.lastReminder)})` : ""
      }.`
    : reminderError
    ? reminderError
    : !reminders
      ? "Working out who is due a reminder (about half a minute)…"
      : `${due.length === 0 ? "Nobody is due a reminder today" : `${plural(due.length, "organization")} due a reminder`}${
          messages.lastReminder ? ` (last sent ${whenMountain(messages.lastReminder)})` : ""
        }.${remindersSent ? ` ${remindersSent}` : ""}`;

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-gray-200 bg-white px-4">
        <h3 className="pt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Reminders</h3>
        <div className="divide-y divide-gray-100">
          <OperateRow
            title="Checklist reminders"
            state={`${reminderState} They also go out on their own every business day.`}
            tone={reminderError ? "blocked" : due.length > 0 ? "attention" : "neutral"}
            edit={{ href: `/admin/conference/${conferenceId}/checklists`, label: "Checklists" }}
            preview={
              due.length > 0
                ? {
                    title: "Who would get a reminder",
                    content: (
                      <ul className="divide-y divide-gray-100 text-sm">
                        {due.map((org) => (
                          <li key={org.organizationId} className="py-2">
                            <p className="font-medium text-gray-900">{org.organization}</p>
                            <p className="text-xs text-gray-500">{org.recipients.join(", ")}</p>
                            <p className="mt-0.5 text-xs text-gray-700">{org.items.join(" · ")}</p>
                          </li>
                        ))}
                      </ul>
                    ),
                  }
                : null
            }
            action={
              due.length > 0
                ? {
                    label: "Send now",
                    consequence: `Emails the admins of ${plural(due.length, "organization")} what they still owe for this conference. Anyone already reminded at this point is skipped.`,
                    onConfirm: async () => {
                      const res = await runConferenceRemindersNow(conferenceId);
                      if (!res.success) return res;
                      setRemindersSent(
                        res.data.errors.length > 0
                          ? `Sent to ${plural(res.data.orgsReminded, "organization")}; ${res.data.errors[0]}`
                          : `Sent to ${plural(res.data.orgsReminded, "organization")}.`
                      );
                      await checkReminders();
                      router.refresh();
                      return { success: true };
                    },
                  }
                : null
            }
          />
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white px-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2 pt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Campaigns</h3>
          <a
            href={`/admin/comms/new?conference_id=${conferenceId}`}
            className="text-xs font-medium text-gray-600 hover:text-gray-900"
          >
            New campaign in Comms ▸
          </a>
        </div>
        {messages.broadcasts.length === 0 ? (
          <p className="py-3 text-sm text-gray-500">No campaigns for this conference yet.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {messages.broadcasts.map((c) => {
              const pending = c.status === "draft" || c.status === "scheduled";
              return (
                <OperateRow
                  key={c.id}
                  title={c.name}
                  state={`${CAMPAIGN_STATUS_WORDS[c.status] ?? c.status} ${whenMountain(c.when)}${
                    pending && c.recipients !== null ? ` · reaches ${plural(c.recipients, "person")}` : ""
                  }${!pending && c.delivered > 0 ? ` · ${plural(c.delivered, "email")}` : ""}.`}
                  tone={c.status === "failed" ? "blocked" : pending ? "attention" : "neutral"}
                  edit={{ href: `/admin/comms/${c.id}`, label: "Comms" }}
                  extra={
                    c.preview.bodyHtml || c.preview.subject ? (
                      <CampaignPreviewButton
                        bodyHtml={c.preview.bodyHtml}
                        subject={c.preview.subject}
                        variableKeys={c.preview.variableKeys}
                        variableValues={c.preview.variableValues}
                        isTransactional={c.preview.isTransactional}
                        compact
                      />
                    ) : null
                  }
                  action={
                    canSend && pending && c.recipients !== null && c.recipients > 0
                      ? {
                          label: "Send now",
                          consequence: `Emails ${plural(c.recipients, "person")} now${
                            c.status === "scheduled" ? ", instead of at the scheduled time" : ""
                          }.`,
                          onConfirm: async () => {
                            const res = await sendCampaign(c.id);
                            if (res.success) router.refresh();
                            return res;
                          },
                        }
                      : null
                  }
                />
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white px-4 pb-2">
        <h3 className="pt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Automatic emails</h3>
        <p className="text-xs text-gray-500">They go out on their own when something happens. Edit the wording in Comms.</p>
        {messages.automatic.length === 0 ? (
          <p className="py-3 text-sm text-gray-500">None have gone out for this conference yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {messages.automatic.map((a) => (
              <li key={a.key} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <div className="min-w-0">
                  <span className="font-medium text-gray-900">{a.name}</span>
                  <span className="ml-2 text-xs text-gray-500">
                    {plural(a.sent, "email")}
                    {a.last ? `, last ${whenMountain(a.last)}` : ""}
                  </span>
                </div>
                {a.templateId ? (
                  <a
                    href={`/admin/comms/templates/${a.templateId}`}
                    className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Edit
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
