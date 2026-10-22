import Link from "next/link";
import type { ReactNode } from "react";
import { getConference } from "@/lib/actions/conference";
import {
  listConferencePeople,
  syncConferencePeopleIndex,
} from "@/lib/actions/conference-people";
import { isGlobalAdmin, requireConferenceDeskAccess } from "@/lib/auth/guards";
import WarRoomClient, { SendToPrinterButton, type WhatsNext } from "@/components/admin/conference/WarRoomClient";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  loadStaffAnsweringOrgId,
  loadStaffChecklists,
  type StaffTaskExtra,
} from "@/lib/conference/checklist-tasks";
import { arrangeStaffChecklists } from "@/lib/conference/deadline-urgency";
import { readPreferences } from "@/lib/profile/preferences";
import { parsePrintSort, PRINT_SORT_PREFERENCE_KEY } from "@/lib/conference/badges/arrangement";

export const metadata = {
  title: "Conference War Room | Admin",
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

export default async function ConferenceWarRoomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: deskConferenceId } = await params;
  const auth = await requireConferenceDeskAccess(deskConferenceId);
  if (!auth.ok) {
    return (
      <main className="p-6 text-sm text-red-700">
        Conference ops access required.
      </main>
    );
  }

  const { id } = await params;
  const isAdmin = isGlobalAdmin(auth.ctx.globalRole);
  const canRunSync = isAdmin;
  const [conferenceResult, peopleResult] = await Promise.all([
    getConference(id),
    listConferencePeople(id),
  ]);

  if (!conferenceResult.success || !conferenceResult.data) {
    return <main className="p-6 text-sm text-red-700">Conference not found.</main>;
  }

  const rows = peopleResult.success ? peopleResult.data ?? [] : [];

  // What's next is CSC's own run-sheet: admins only. Desk temps reach this page
  // for People Lookup and never see it.
  let whatsNext: WhatsNext | null = null;
  if (isAdmin) {
    const db = createAdminClient();
    const timeZone =
      ((conferenceResult.data as { timezone?: string | null }).timezone as string | null) || "America/Toronto";
    const [answeringOrgId, preferences] = await Promise.all([
      loadStaffAnsweringOrgId(db),
      readPreferences(auth.ctx.userId),
    ]);
    const checklists = await loadStaffChecklists(db, id, answeringOrgId);
    const controlsByTaskId: Record<string, ReactNode> = {};
    for (const list of checklists) {
      for (const [taskId, extra] of Object.entries(list.extras)) {
        controlsByTaskId[taskId] = <StaffTaskControls conferenceId={id} extra={extra} />;
      }
    }
    whatsNext = {
      answeringOrgId,
      timeZone,
      groups: arrangeStaffChecklists(checklists, new Date(), timeZone),
      controlsByTaskId,
      printSort: parsePrintSort(preferences[PRINT_SORT_PREFERENCE_KEY]),
    };
  }

  return (
    <main className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">War Room</h1>
          <p className="mt-1 text-sm text-gray-600">
            {conferenceResult.data.name} ({conferenceResult.data.year}-
            {conferenceResult.data.edition_code})
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/admin/conference/${id}/badges`}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Badge Ops
          </Link>
          <Link
            href={`/admin/conference/${id}/schedule-ops`}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Schedule Ops
          </Link>
          <Link
            href={`/admin/conference/${id}/travel-import`}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Travel Import
          </Link>
          <Link
            href={`/admin/conference/${id}/check-in`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-accent bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover"
          >
            Open Check-in Desk
          </Link>
          <Link
            href={`/admin/conference/${id}`}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Back to Conference
          </Link>
          {canRunSync ? (
            <form
              action={async () => {
                "use server";
                await syncConferencePeopleIndex(id);
                revalidatePath(`/admin/conference/${id}/war-room`);
              }}
            >
              <button
                type="submit"
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Sync People Index
              </button>
            </form>
          ) : null}
        </div>
      </div>

      <WarRoomClient
        conferenceId={id}
        initialRows={rows}
        canEditAdminNotes={isAdmin}
        whatsNext={whatsNext}
      />
    </main>
  );
}
