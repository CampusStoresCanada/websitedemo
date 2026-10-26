import Link from "next/link";
import type { ReactNode } from "react";
import { getConference } from "@/lib/actions/conference";
import {
  listConferencePeople,
  syncConferencePeopleIndex,
} from "@/lib/actions/conference-people";
import { requireSuperAdmin } from "@/lib/auth/guards";
import WarRoomClient, {
  MeMenu,
  SendToPrinterButton,
  type WarRoomMessages,
  type WhatsNext,
} from "@/components/admin/conference/WarRoomClient";
import { executeCampaignSend } from "@/lib/comms/send";
import type { TemplateCategory } from "@/lib/comms/types";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  loadStaffAnsweringOrgId,
  loadStaffChecklists,
  type StaffTaskExtra,
} from "@/lib/conference/checklist-tasks";
import { arrangeStaffChecklists, calendarDayIn, describeUrgency } from "@/lib/conference/deadline-urgency";
import { readPreferences } from "@/lib/profile/preferences";
import { ENTITY_SELECT, buildEntityGraph } from "@/lib/conference/seats";
import { deriveAgenda, deriveAnswers } from "@/lib/conference/agenda";
import { loadWaitingOnUs } from "@/lib/conference/waiting-on-us";
import { parsePrintSort, PRINT_SORT_PREFERENCE_KEY } from "@/lib/conference/badges/arrangement";
import { stationOnline } from "@/lib/conference/badges/print-station";
import { meetingsSoFar } from "@/lib/conference/checklist-checks";
import { formatDayMonth } from "@/lib/time/supabase-timestamp";

export const metadata = {
  title: "War Room | Admin",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** A staff task's live line, its buttons and its documents, inside its own row. */
function StaffTaskControls({ conferenceId, extra }: { conferenceId: string; extra: StaffTaskExtra }) {
  return (
    <div className="space-y-2">
      {extra.detail ? <p className="text-xs text-gray-600">{extra.detail}</p> : null}
      {extra.documents.length > 0 ? (
        <ul className="space-y-1.5">
          {extra.documents.map((doc) => (
            <li key={doc.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium text-gray-800">{doc.label}</span>
              <a
                href={doc.href}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Open
              </a>
              <SendToPrinterButton conferenceId={conferenceId} documentId={doc.id} />
            </li>
          ))}
        </ul>
      ) : null}
      {extra.actions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {extra.actions.map((action) => (
            <a
              key={action.href}
              href={action.href}
              {...(action.print ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              {action.label}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * This conference's messages, for the Messages tab: the campaigns Comms holds
 * for it (tagged audience_definition.filters.conference_instance_id, the
 * conference Comms page's own scope), split into broadcasts people write and
 * the automatic emails that fire on events. Comms stays where they are sent
 * and tracked; this only shows them in context.
 */
async function loadConferenceMessages(
  db: ReturnType<typeof createAdminClient>,
  conferenceId: string
): Promise<WarRoomMessages> {
  const { data: rows } = await db
    .from("message_campaigns")
    .select(
      `id, name, status, trigger_source, automation_mode, created_at, scheduled_at, sent_at,
       subject_override, body_override, variable_values, audience_definition, campaign_id,
       message_templates(id, key, name, subject, body_html, variable_keys, category, is_transactional),
       message_deliveries(count)`
    )
    .eq("audience_definition->filters->>conference_instance_id", conferenceId)
    .order("created_at", { ascending: false })
    .limit(300);

  type Template = {
    id: string; key: string; name: string; subject: string; body_html: string;
    variable_keys: string[] | null; category: TemplateCategory | null; is_transactional: boolean | null;
  };
  const templateOf = (row: { message_templates: unknown }) =>
    (Array.isArray(row.message_templates) ? row.message_templates[0] : row.message_templates) as Template | null;
  const deliveriesOf = (row: { message_deliveries: unknown }) =>
    ((row.message_deliveries as Array<{ count: number }> | null)?.[0]?.count ?? 0) as number;

  const broadcasts: WarRoomMessages["broadcasts"] = [];
  const automatic = new Map<string, WarRoomMessages["automatic"][number]>();
  // The last reminder from the engine's own log, which is per conference.
  const { data: lastLogged } = await db
    .from("conference_checklist_reminder_log")
    .select("sent_at, conference_checklists!inner(conference_id)")
    .eq("conference_checklists.conference_id", conferenceId)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastReminder = (lastLogged?.sent_at as string | null) ?? null;

  for (const row of rows ?? []) {
    const template = templateOf(row);
    const sentAt = (row.sent_at as string | null) ?? null;
    if (row.trigger_source === "conference" && row.automation_mode === "auto_send") {
      // Reminders have their own row in the tab; one run's campaign is tagged
      // with only one of the conferences it wrote about, so it is not counted here.
      if (template?.key === "conference_checklist_reminder") continue;
      const key = template?.key ?? "unknown";
      const group = automatic.get(key) ?? { key, name: template?.name ?? key, templateId: template?.id ?? null, sent: 0, last: null };
      group.sent += deliveriesOf(row);
      group.last ??= sentAt ?? (row.created_at as string);
      automatic.set(key, group);
      continue;
    }
    const pending = row.status === "draft" || row.status === "scheduled";
    let recipients: number | null = null;
    if (pending) {
      // Who it would reach now, by Comms' own resolution (its detail page's preview).
      const { previewAudience } = await import("@/lib/comms/audience");
      const { resolveEffectiveAudience } = await import("@/lib/comms/campaigns");
      const audience = await resolveEffectiveAudience(
        row.audience_definition as never,
        (row.campaign_id as string | null) ?? null
      );
      recipients = (await previewAudience(audience, template?.is_transactional ? undefined : template?.category ?? null)).count;
    }
    broadcasts.push({
      id: row.id as string,
      name: row.name as string,
      status: row.status as string,
      when: (row.scheduled_at as string | null) ?? sentAt ?? (row.created_at as string),
      delivered: deliveriesOf(row),
      recipients,
      preview: {
        subject: template?.subject ?? (row.subject_override as string | null) ?? "",
        bodyHtml: template?.body_html ?? (row.body_override as string | null) ?? "",
        variableKeys: template?.variable_keys ?? [],
        variableValues: (row.variable_values ?? {}) as Record<string, string>,
        isTransactional: Boolean(template?.is_transactional),
      },
    });
  }

  return { broadcasts, automatic: [...automatic.values()], lastReminder };
}

/** One piece of the status line: a fact, coloured by how much it matters, linking to where you fix it. */
function StatusItem({ tone, href, children }: { tone: "alert" | "warn" | "ok" | "quiet"; href: string; children: ReactNode }) {
  const dot =
    tone === "alert" ? "bg-red-600" : tone === "warn" ? "bg-amber-500" : tone === "ok" ? "bg-green-600" : "bg-gray-300";
  return (
    <a href={href} className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-gray-700 hover:text-gray-950">
      <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
      {children}
    </a>
  );
}

/**
 * The War Room: CSC's operations centre (docs/WAR_ROOM_OPERATE_PLAN.md).
 *
 * Operate, not Manage: everything here carries out the conference that exists.
 * Its own slim header — the conference's Manage tabs and the admin sidebar step
 * aside (lib/admin/nav isWarRoomPath) — then a status line that answers "is
 * anything on fire?", then the tabs.
 *
 * ⛔ CSC staff only: super admins. Desk staff (temps) work the check-in desk
 * (Stephen, 2026-10-23), and the `admin` role is board and store people, who
 * must not see it either (Stephen, 2026-10-26).
 */
export default async function ConferenceWarRoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) {
    return <main className="p-6 text-sm text-red-700">The War Room is for CSC staff.</main>;
  }

  const { id } = await params;
  const [conferenceResult, peopleResult] = await Promise.all([getConference(id), listConferencePeople(id)]);
  if (!conferenceResult.success || !conferenceResult.data) {
    return <main className="p-6 text-sm text-red-700">Conference not found.</main>;
  }
  const conference = conferenceResult.data;
  const rows = peopleResult.success ? peopleResult.data ?? [] : [];
  const timeZone = ((conference as { timezone?: string | null }).timezone as string | null) || "America/Toronto";

  const db = createAdminClient();
  const [entityRes, refRes, waiting, answeringOrgId, preferences, stationsRes, waitingJobs, meetings, messages] = await Promise.all([
    db.from("conference_entities").select(ENTITY_SELECT).eq("conference_id", id),
    db.from("conference_entity_refs").select("from_entity_id, to_entity_id, role, quantity").eq("conference_id", id),
    loadWaitingOnUs(id),
    loadStaffAnsweringOrgId(db),
    readPreferences(auth.ctx.userId),
    db.from("print_stations").select("last_seen_at").eq("conference_id", id).is("revoked_at", null),
    db
      .from("badge_print_jobs")
      .select("id", { count: "exact", head: true })
      .eq("conference_id", id)
      .in("status", ["sent_to_printer", "rendering"]),
    meetingsSoFar(db, id).catch(() => null),
    loadConferenceMessages(db, id),
  ]);

  // Answers (Wi-Fi, coat check) and meal menus: the same graph and the same
  // readers as each person's own page, so desk and phone say the same thing.
  const entities = buildEntityGraph(entityRes.data ?? [], refRes.data ?? []);
  const answers = deriveAnswers(entities);
  const menus = deriveAgenda(entities, timeZone)
    .filter((item) => item.kind === "meal" && item.description?.startsWith("Menu: "))
    .map((item) => ({
      id: item.id,
      title: item.title,
      dayKey: item.dayKey,
      startTime: item.startTime,
      menu: item.description!.slice("Menu: ".length),
    }));

  const checklists = await loadStaffChecklists(db, id, answeringOrgId);
  const controlsByTaskId: Record<string, ReactNode> = {};
  for (const list of checklists) {
    for (const [taskId, extra] of Object.entries(list.extras)) {
      controlsByTaskId[taskId] = <StaffTaskControls conferenceId={id} extra={extra} />;
    }
  }
  const groups = arrangeStaffChecklists(checklists, new Date(), timeZone);
  const printSort = parsePrintSort(preferences[PRINT_SORT_PREFERENCE_KEY]);
  const whatsNext: WhatsNext = { answeringOrgId, timeZone, groups, controlsByTaskId, printSort };

  // ── The status line: only what is live ──────────────────────────────────
  const waitingCount = waiting.items.length;
  const urgentCount = waiting.items.filter((item) => item.urgent).length;
  const stations = stationsRes.data ?? [];
  const online = stations.some((s) => stationOnline(s.last_seen_at as string | null));
  const queued = waitingJobs.count ?? 0;
  const nextList = groups.now[0] ?? groups.next[0] ?? null;
  const today = calendarDayIn(new Date(), timeZone);
  const daysAway = nextList
    ? describeUrgency(calendarDayIn(new Date(nextList.deadline), timeZone), today).daysUntil
    : null;
  const meetingsRunning = meetings && meetings.started > 0 && meetings.started < meetings.total;

  // A link from the status line names its tab (?tab=); the client checks it.
  const tabParam = (await searchParams).tab ?? null;

  return (
    <main className="mx-auto max-w-5xl space-y-4 px-4 py-5 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">War Room</p>
          <h1 className="truncate text-xl font-bold text-gray-900">{conference.name}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={`/admin/conference/${id}/check-in`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-accent bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
          >
            Check-in Desk ↗
          </Link>
          {/* The one way back to Manage: the conference as it is defined. */}
          <Link
            href={`/admin/conference/${id}/overview`}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Manage ▸
          </Link>
          <MeMenu printSort={printSort} />
        </div>
      </header>

      <div className="flex flex-wrap gap-x-5 gap-y-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5">
        <StatusItem tone={urgentCount > 0 ? "alert" : waitingCount > 0 ? "warn" : "quiet"} href="?tab=waiting">
          {waitingCount === 0
            ? "Nobody waiting on us"
            : `${waitingCount} waiting on us${urgentCount ? `, ${urgentCount} urgent` : ""}`}
        </StatusItem>
        <StatusItem
          tone={stations.length === 0 ? "quiet" : online ? "ok" : "alert"}
          href="?tab=print"
        >
          {stations.length === 0 ? "No print station" : online ? "Print station online" : "Print station offline"}
          {queued ? ` · ${queued} waiting` : ""}
        </StatusItem>
        {nextList ? (
          <StatusItem tone={daysAway !== null && daysAway < 0 ? "alert" : daysAway !== null && daysAway <= 7 ? "warn" : "quiet"} href="?tab=whats_next">
            {daysAway !== null && daysAway < 0 ? "Overdue: " : "Next: "}
            {nextList.name}, {formatDayMonth(nextList.deadline, timeZone)}
            {daysAway !== null && daysAway >= 0 ? ` (${daysAway === 0 ? "today" : daysAway === 1 ? "tomorrow" : `${daysAway} days`})` : ""}
          </StatusItem>
        ) : null}
        {meetingsRunning ? (
          <StatusItem tone={meetings.confirmed < meetings.started ? "warn" : "ok"} href="?tab=meetings">
            {meetings.confirmed} of {meetings.started} meetings confirmed
          </StatusItem>
        ) : null}
      </div>

      <WarRoomClient
        conferenceId={id}
        initialRows={rows}
        whatsNext={whatsNext}
        answers={answers}
        menus={menus}
        waiting={waiting}
        requestedTab={tabParam}
        printStation={{ stations: stations.length, online, queued }}
        messages={messages}
        sendCampaign={async (campaignId: string) => {
          "use server";
          // ⛔ Its own checks: CSC staff, and a campaign of THIS conference.
          const guard = await requireSuperAdmin();
          if (!guard.ok) return { success: false, error: guard.error };
          const { data: owned } = await createAdminClient()
            .from("message_campaigns")
            .select("id")
            .eq("id", campaignId)
            .eq("audience_definition->filters->>conference_instance_id", id)
            .maybeSingle();
          if (!owned) return { success: false, error: "That campaign is not one of this conference's." };
          const sent = await executeCampaignSend(campaignId);
          revalidatePath(`/admin/conference/${id}/war-room`);
          if (sent.alreadySent) return { success: false, error: "It had already been sent." };
          return sent.errors.length > 0 && sent.sentCount === 0
            ? { success: false, error: sent.errors[0] }
            : { success: true };
        }}
        syncPeopleIndex={async () => {
          "use server";
          await syncConferencePeopleIndex(id);
          revalidatePath(`/admin/conference/${id}/war-room`);
        }}
      />
    </main>
  );
}
