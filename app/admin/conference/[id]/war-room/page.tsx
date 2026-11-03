import Link from "next/link";
import { Suspense, type ReactElement, type ReactNode } from "react";
import { getConference } from "@/lib/actions/conference";
import { listConferencePeople, syncConferencePeopleIndex } from "@/lib/actions/conference-people";
import { isSuperAdmin, requireConferenceOpsAccess, requireSuperAdmin } from "@/lib/auth/guards";
import { MeMenu, SendToPrinterButton } from "@/components/admin/conference/war-room/shared";
import { WaitingView } from "@/components/admin/conference/war-room/WaitingTab";
import { WhatsNextView, type WhatsNext } from "@/components/admin/conference/war-room/WhatsNextTab";
import { PrintView } from "@/components/admin/conference/war-room/PrintTab";
import { MeetingsView } from "@/components/admin/conference/war-room/MeetingsTab";
import { MessagesView, type WarRoomMessages } from "@/components/admin/conference/war-room/MessagesTab";
import { PeopleView } from "@/components/admin/conference/war-room/PeopleTab";
import { DataView, type WarRoomDataCounts } from "@/components/admin/conference/war-room/DataTab";
import { AnswersView } from "@/components/admin/conference/war-room/AnswersTab";
import StatusLine, { StatusLineFrame, loadArrangedChecklists, loadPrintStationState } from "./StatusLine";
import { executeCampaignSend } from "@/lib/comms/send";
import type { TemplateCategory } from "@/lib/comms/types";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import type { StaffTaskExtra } from "@/lib/conference/checklist-tasks";
import { readPreferences } from "@/lib/profile/preferences";
import { ENTITY_SELECT, buildEntityGraph } from "@/lib/conference/seats";
import { deriveAgenda, deriveAnswers } from "@/lib/conference/agenda";
import { loadWaitingOnUs } from "@/lib/conference/waiting-on-us";
import { parsePrintSort, PRINT_SORT_PREFERENCE_KEY } from "@/lib/conference/badges/arrangement";
import { loadDoorRoster } from "@/lib/conference/attendance";

/** The War Room's tabs (WAR_ROOM_OPERATE_PLAN §5), in the order they sit. */
const OPS_TABS = [
  { id: "waiting", label: "Waiting on us" },
  { id: "whats_next", label: "What's next" },
  { id: "print", label: "Print" },
  { id: "meetings", label: "Meetings" },
  { id: "messages", label: "Messages" },
  { id: "people", label: "People" },
  { id: "data", label: "Data" },
  { id: "answers", label: "Answers" },
] as const;
type OpsTab = (typeof OPS_TABS)[number]["id"];

function isOpsTab(value: string | undefined): value is OpsTab {
  return OPS_TABS.some((tab) => tab.id === value);
}

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
  conferenceId: string,
): Promise<WarRoomMessages> {
  const { data: rows } = await db
    .from("message_campaigns")
    .select(
      `id, name, status, trigger_source, automation_mode, created_at, scheduled_at, sent_at,
       subject_override, body_override, variable_values, audience_definition, campaign_id,
       message_templates(id, key, name, subject, body_html, variable_keys, category, is_transactional),
       message_deliveries(count)`,
    )
    .eq("audience_definition->filters->>conference_instance_id", conferenceId)
    .order("created_at", { ascending: false })
    .limit(300);

  type Template = {
    id: string;
    key: string;
    name: string;
    subject: string;
    body_html: string;
    variable_keys: string[] | null;
    category: TemplateCategory | null;
    is_transactional: boolean | null;
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
      const group = automatic.get(key) ?? {
        key,
        name: template?.name ?? key,
        templateId: template?.id ?? null,
        sent: 0,
        last: null,
      };
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
        (row.campaign_id as string | null) ?? null,
      );
      recipients = (
        await previewAudience(audience, template?.is_transactional ? undefined : (template?.category ?? null))
      ).count;
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

/**
 * How many people each Data export holds: the attendee list's own roster
 * (loadDoorRoster), joined to each person's conference record exactly as
 * exportConferenceRoster joins it, so a row's count is its file's length.
 */
async function loadDataCounts(
  db: ReturnType<typeof createAdminClient>,
  conferenceId: string,
): Promise<WarRoomDataCounts> {
  const [roster, { data: people }] = await Promise.all([
    loadDoorRoster(db, conferenceId, null),
    db
      .from("conference_people")
      .select("id, dietary_restrictions, accessibility_needs, emergency_contact_name, emergency_contact_phone")
      .eq("conference_id", conferenceId)
      .neq("assignment_status", "canceled"),
  ]);
  // A seat's holder IS the conference_people row (loadSeatHoldings).
  const byPerson = new Map((people ?? []).map((p) => [p.id as string, p]));
  const has = (value: unknown) => typeof value === "string" && value.trim().length > 0;
  const count = (test: (p: NonNullable<typeof people>[number]) => boolean) =>
    roster.filter((r) => {
      const p = byPerson.get(r.personId);
      return p ? test(p) : false;
    }).length;
  return {
    attending: roster.length,
    dietary: count((p) => has(p.dietary_restrictions)),
    accessibility: count((p) => has(p.accessibility_needs)),
    emergency: count((p) => has(p.emergency_contact_name) || has(p.emergency_contact_phone)),
  };
}

/** Answers (Wi-Fi, coat check) and meal menus: the same graph and readers as each person's own page. */
async function loadAnswersAndMenus(db: ReturnType<typeof createAdminClient>, conferenceId: string, timeZone: string) {
  const [entityRes, refRes] = await Promise.all([
    db.from("conference_entities").select(ENTITY_SELECT).eq("conference_id", conferenceId),
    db
      .from("conference_entity_refs")
      .select("from_entity_id, to_entity_id, role, quantity")
      .eq("conference_id", conferenceId),
  ]);
  const entities = buildEntityGraph(entityRes.data ?? [], refRes.data ?? []);
  const menus = deriveAgenda(entities, timeZone)
    .filter((item) => item.kind === "meal" && item.description?.startsWith("Menu: "))
    .map((item) => ({
      id: item.id,
      title: item.title,
      dayKey: item.dayKey,
      startTime: item.startTime,
      menu: item.description!.slice("Menu: ".length),
    }));
  return { answers: deriveAnswers(entities), menus };
}

/**
 * The War Room: CSC's operations centre (docs/WAR_ROOM_OPERATE_PLAN.md).
 *
 * Operate, not Manage: everything here carries out the conference that exists.
 * Its own slim header — the conference's Manage tabs and the admin sidebar step
 * aside (lib/admin/nav isWarRoomPath) — then a status line that answers "is
 * anything on fire?", then the tabs.
 *
 * ⛔ Only the open tab is loaded. Each tab is a link (`?tab=`), so switching asks
 * the server for that tab alone; the status line streams in its own Suspense
 * boundary rather than holding the page (2026-10-26: every load used to read
 * every tab, about four seconds of queries, whichever one you opened).
 *
 * Admins (Stephen, 2026-10-26). Desk staff (temps) work the check-in desk.
 */
export default async function ConferenceWarRoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) {
    return <main className="p-6 text-sm text-red-700">The War Room is for CSC staff.</main>;
  }

  const { id } = await params;
  const requested = (await searchParams).tab;
  const db = createAdminClient();
  // Who is waiting decides the default tab and the tab's count, so it is read
  // on every load; everything else belongs to one tab.
  const [conferenceResult, waiting, preferences] = await Promise.all([
    getConference(id),
    loadWaitingOnUs(id),
    readPreferences(auth.ctx.userId),
  ]);
  if (!conferenceResult.success || !conferenceResult.data) {
    return <main className="p-6 text-sm text-red-700">Conference not found.</main>;
  }
  const conference = conferenceResult.data;
  const timeZone = ((conference as { timezone?: string | null }).timezone as string | null) || "America/Toronto";
  const printSort = parsePrintSort(preferences[PRINT_SORT_PREFERENCE_KEY]);
  const superAdmin = isSuperAdmin(auth.ctx.globalRole);
  const waitingCount = waiting.items.length;
  const urgentCount = waiting.items.filter((item) => item.urgent).length;
  // A tab the address names; otherwise whatever has someone waiting, then the run-sheet.
  const tab: OpsTab = isOpsTab(requested) ? requested : waitingCount > 0 ? "waiting" : "whats_next";

  // The open tab's content, rendered as a promise inside its own Suspense
  // boundary: the header, status line and tabs show at once, and the tab fills
  // in when its reads finish (What's next runs every checklist check).
  const body: Promise<ReactElement> = (async () => {
    switch (tab) {
      case "waiting":
        return <WaitingView conferenceId={id} waiting={waiting} />;
      case "whats_next": {
        const { answeringOrgId, checklists, groups } = await loadArrangedChecklists(id, timeZone);
        const controlsByTaskId: Record<string, ReactNode> = {};
        for (const list of checklists) {
          for (const [taskId, extra] of Object.entries(list.extras)) {
            controlsByTaskId[taskId] = <StaffTaskControls conferenceId={id} extra={extra} />;
          }
        }
        const whatsNext: WhatsNext = {
          answeringOrgId,
          timeZone,
          groups,
          controlsByTaskId,
          printSort,
        };
        return <WhatsNextView conferenceId={id} whatsNext={whatsNext} />;
      }
      case "print": {
        // The people, for the one-off reprint's search.
        const [station, people] = await Promise.all([loadPrintStationState(id), listConferencePeople(id)]);
        return <PrintView conferenceId={id} people={people.success ? (people.data ?? []) : []} station={station} />;
      }
      case "meetings":
        return <MeetingsView conferenceId={id} />;
      case "messages":
        return (
          <MessagesView
            conferenceId={id}
            messages={await loadConferenceMessages(db, id)}
            canSend={superAdmin}
            sendCampaign={async (campaignId: string) => {
              "use server";
              // ⛔ Its own checks: a super admin, and a campaign of THIS conference.
              const guard = await requireSuperAdmin();
              if (!guard.ok) return { success: false, error: guard.error };
              const { data: owned } = await createAdminClient()
                .from("message_campaigns")
                .select("id")
                .eq("id", campaignId)
                .eq("audience_definition->filters->>conference_instance_id", id)
                .maybeSingle();
              if (!owned)
                return {
                  success: false,
                  error: "That campaign is not one of this conference's.",
                };
              const sent = await executeCampaignSend(campaignId);
              revalidatePath(`/admin/conference/${id}/war-room`);
              if (sent.alreadySent) return { success: false, error: "It had already been sent." };
              return sent.errors.length > 0 && sent.sentCount === 0
                ? { success: false, error: sent.errors[0] }
                : { success: true };
            }}
          />
        );
      case "people":
        return (
          <PeopleView
            conferenceId={id}
            syncPeopleIndex={async () => {
              "use server";
              await syncConferencePeopleIndex(id);
              revalidatePath(`/admin/conference/${id}/war-room`);
            }}
          />
        );
      case "data":
        return <DataView conferenceId={id} counts={await loadDataCounts(db, id)} canExport={superAdmin} />;
      case "answers": {
        const { answers, menus } = await loadAnswersAndMenus(db, id, timeZone);
        return <AnswersView conferenceId={id} answers={answers} menus={menus} canEdit />;
      }
    }
  })();

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

      <Suspense fallback={<StatusLineFrame>{null}</StatusLineFrame>}>
        <StatusLine conferenceId={id} timeZone={timeZone} waitingCount={waitingCount} urgentCount={urgentCount} />
      </Suspense>

      <div className="space-y-5">
        {/* The page's main control, not a card around buttons. Links, not state:
            each tab is its own request, and the address says where you are. */}
        <nav className="-mx-4 overflow-x-auto border-b border-gray-200 px-4 sm:mx-0 sm:px-0" aria-label="War Room">
          <div className="flex gap-5">
            {OPS_TABS.map((t) => {
              const active = tab === t.id;
              const count = t.id === "waiting" ? waitingCount : 0;
              return (
                <Link
                  key={t.id}
                  href={`?tab=${t.id}`}
                  prefetch={false}
                  scroll={false}
                  aria-current={active ? "page" : undefined}
                  className={`-mb-px whitespace-nowrap border-b-2 py-2.5 text-sm font-medium ${
                    active ? "border-accent text-accent" : "border-transparent text-gray-500 hover:text-gray-800"
                  }`}
                >
                  {t.label}
                  {count > 0 ? (
                    <span
                      className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                        urgentCount > 0 ? "bg-red-600 text-white" : "bg-gray-200 text-gray-700"
                      }`}
                    >
                      {count}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        </nav>
        <Suspense key={tab} fallback={<p className="text-sm text-gray-500">Loading…</p>}>
          {body}
        </Suspense>
      </div>
    </main>
  );
}
