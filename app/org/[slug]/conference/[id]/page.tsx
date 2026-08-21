import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { lookupUserEmailsByIds } from "@/lib/supabase/user-lookup";
import {
  isGlobalAdmin,
  requireOrgAdminOrSuperAdmin,
} from "@/lib/auth/guards";
import { resolveOrgSlug } from "@/lib/org/resolve";
import { resolveConferenceObligations } from "@/lib/actions/conference-access";
import { resolveConferenceBadges } from "@/lib/actions/conference-entities";
import { answerOrgTask } from "@/lib/actions/conference-tasks";
import { loadOrgTasks } from "@/lib/conference/checklist-tasks";
import TaskChecklist from "@/components/conference/TaskChecklist";

type OrgConferencePersonRow = {
  id: string;
  user_id: string | null;
  source_type: string;
  source_id: string;
  person_kind: string;
  display_name: string | null;
  contact_email: string | null;
  assignment_status: string;
  assigned_email_snapshot: string | null;
  schedule_scope: string;
  travel_mode: string | null;
  road_origin_address: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  data_quality_flags: string[] | null;
  badge_print_status: string;
  checked_in_at: string | null;
  hotel_name: string | null;
  hotel_confirmation_code: string | null;
  admin_notes: string | null;
};

type ConferenceInstanceRow = {
  id: string;
  name: string;
  year: number;
  edition_code: string;
};

type SchedulerRunRow = {
  id: string;
};

export const dynamic = "force-dynamic";

export default async function OrgConferencePage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id: conferenceId } = await params;
  const org = await resolveOrgSlug(slug);
  if (!org) notFound();
  const orgId = org.id;
  const orgName = org.name;

  const auth = await requireOrgAdminOrSuperAdmin(orgId);
  if (!auth.ok) {
    redirect(auth.status === 401 ? "/login" : `/org/${slug}`);
  }

  const canSeeAdminNotes = isGlobalAdmin(auth.ctx.globalRole);
  const adminClient = createAdminClient();

  const [conferenceResult, peopleResult, activeRunResult] = await Promise.all([
    adminClient
      .from("conference_instances")
      .select("id, name, year, edition_code")
      .eq("id", conferenceId)
      .maybeSingle(),
    adminClient
      .from("conference_people")
      .select(
        "id, user_id, source_type, source_id, person_kind, display_name, contact_email, assignment_status, assigned_email_snapshot, schedule_scope, travel_mode, road_origin_address, emergency_contact_name, emergency_contact_phone, data_quality_flags, badge_print_status, checked_in_at, hotel_name, hotel_confirmation_code, admin_notes"
      )
      .eq("conference_id", conferenceId)
      .eq("organization_id", orgId)
      .order("person_kind", { ascending: true })
      .order("display_name", { ascending: true }),
    adminClient
      .from("scheduler_runs")
      .select("id")
      .eq("conference_id", conferenceId)
      .eq("run_mode", "active")
      .eq("status", "completed")
      .maybeSingle(),
  ]);

  const conference = conferenceResult.data as ConferenceInstanceRow | null;
  if (!conference) {
    return <main className="max-w-6xl mx-auto px-4 py-8">Conference not found.</main>;
  }

  const people = (peopleResult.data ?? []) as OrgConferencePersonRow[];
  const activeRun = activeRunResult.data as SchedulerRunRow | null;

  const memberUserIds = people
    .map((row) => row.user_id)
    .filter((userId): userId is string => Boolean(userId));
  let profileNameByUserId: Record<string, string | null> = {};
  let emailByUserId: Record<string, string> = {};
  if (memberUserIds.length > 0) {
    const { data: profileRows } = await adminClient
      .from("profiles")
      .select("id, display_name")
      .in("id", memberUserIds);
    profileNameByUserId = Object.fromEntries(
      (profileRows ?? []).map((row) => [row.id as string, (row.display_name as string | null) ?? null])
    );

    emailByUserId = await lookupUserEmailsByIds(adminClient, memberUserIds);
  }

  // Grant-derived obligations: a person owes data because of what they hold,
  // not their role. Data-quality flags (e.g. travel-import issues) still count
  // against readiness on top of obligations.
  const obligationsResult = await resolveConferenceObligations(conferenceId, orgId);
  const obligationsByPerson = obligationsResult.success
    ? obligationsResult.data
    : new Map<string, { missing: { label: string }[]; isReady: boolean }>();

  // Badge access is DERIVED from the seats a person holds (v3), not a stored label.
  const badgesResult = await resolveConferenceBadges(conferenceId, orgId);
  const badgeAccessByPerson = badgesResult.success
    ? badgesResult.data
    : new Map<string, { id: string; name: string; kind: string }[]>();

  const readinessRows = people
    .filter((row) => row.assignment_status !== "canceled")
    .map((row) => {
      const obligations = obligationsByPerson.get(row.id);
      const flagCount = (row.data_quality_flags ?? []).filter((f) => f.trim().length > 0).length;
      const missingCount = (obligations?.missing.length ?? 0) + flagCount;
      return { person: row, missingCount, isReady: missingCount === 0 };
    });

  const notReadyCount = readinessRows.filter((row) => !row.isReady).length;
  const exhibitorRows = people.filter((row) => row.person_kind === "exhibitor");

  // The company's list: monitored items (payment, seats, directory listing) and
  // self-reported ones (Stronco, Encore) in a single view. A partner shouldn't
  // have to know which half we can see — they want what's outstanding.
  const orgTasks = await loadOrgTasks(createAdminClient(), conferenceId, orgId);

  async function handleOrgTaskAnswer(
    taskId: string,
    state: "done" | "not_applicable",
    evidence?: string
  ) {
    "use server";
    return answerOrgTask({
      organizationId: orgId, conferenceId, taskId, state, evidence,
      revalidate: `/org/${slug}/conference/${conferenceId}`,
    });
  }

  return (
    <main className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            {conference.name} - {orgName}
          </h1>
          <p className="text-sm text-gray-600">Org Conference Roster</p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/conference/${conference.year}/${conference.edition_code}`}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-400"
          >
            Open Conference Hub
          </Link>
          <Link
            href={`/org/${slug}/admin`}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-400"
          >
            Back to Org Admin
          </Link>
          <Link
            href={`/conference/${conference.year}/${conference.edition_code}/schedule`}
            className="rounded-md bg-[#EE2A2E] px-4 py-2 text-sm font-medium text-white hover:bg-[#b50001]"
          >
            Open Schedule + Swaps
          </Link>
        </div>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">Company To-Do List</h2>
        <p className="mt-0.5 text-sm text-gray-500">
          What your company still owes for this conference. Some we track automatically; the rest you tick off yourself.
        </p>
        <div className="mt-2">
          <TaskChecklist tasks={orgTasks} onAnswer={handleOrgTaskAnswer}
            emptyLabel="Nothing outstanding for your company." />
        </div>
        <p className="mt-3 text-sm">
          <Link href={`/org/${slug}/conference/${conferenceId}/listing`}
            className="font-medium text-[#163D6D] hover:underline">
            See your printed directory listing &rarr;
          </Link>
        </p>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">Org Readiness</h2>
        <p className="mt-2 text-sm text-gray-700">
          {notReadyCount === 0
            ? "All assigned conference people are ready."
            : `${notReadyCount} people need required data updates before conference readiness.`}
        </p>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">Exhibitor Shared Schedule Context</h2>
        <p className="mt-2 text-sm text-gray-700">
          Active run: {activeRun?.id ?? "Not published"} | Exhibitor records:{" "}
          {exhibitorRows.length}
        </p>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">Conference People (Org Scope)</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Person</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Kind</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Assignment</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Badge</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Access (from seats)</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Check-in</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Readiness</th>
                {canSeeAdminNotes ? (
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Admin Notes</th>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {readinessRows.map(({ person, missingCount, isReady }) => (
                <tr key={person.id}>
                  <td className="px-3 py-2 text-gray-900">
                    {person.display_name ??
                      profileNameByUserId[person.user_id ?? ""] ??
                      person.contact_email ??
                      emailByUserId[person.user_id ?? ""] ??
                      person.id}
                  </td>
                  <td className="px-3 py-2 text-gray-700">{person.person_kind}</td>
                  <td className="px-3 py-2 text-gray-700">{person.assignment_status}</td>
                  <td className="px-3 py-2 text-gray-700">{person.badge_print_status}</td>
                  <td className="px-3 py-2 text-gray-700">
                    {(() => {
                      const access = badgeAccessByPerson.get(person.id) ?? [];
                      return access.length > 0 ? access.map((a) => a.name).join(", ") : "—";
                    })()}
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {person.checked_in_at ? "Checked in" : "Not checked in"}
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {isReady ? "Ready" : `${missingCount} item(s)`}
                  </td>
                  {canSeeAdminNotes ? (
                    <td className="px-3 py-2 text-gray-700">{person.admin_notes ?? "—"}</td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
