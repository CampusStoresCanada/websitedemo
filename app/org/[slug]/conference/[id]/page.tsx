import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  requireOrgAdminOrSuperAdmin,
} from "@/lib/auth/guards";
import { resolveOrgSlug } from "@/lib/org/resolve";
import { resolveConferenceObligations } from "@/lib/actions/conference-access";
import { answerOrgTask } from "@/lib/actions/conference-tasks";
import { loadOrgTasks } from "@/lib/conference/checklist-tasks";
import TaskChecklist from "@/components/conference/TaskChecklist";
import SeatAssignment from "@/components/org/SeatAssignment";
import OrgAgreements from "@/components/org/OrgAgreements";
import OrgPayments from "@/components/org/OrgPayments";
import { loadOrgPayments } from "@/lib/conference/org-payments";
import { loadOrgLegalStatus } from "@/lib/conference/org-legal";
import { listEntitySeatsForOrg } from "@/lib/actions/conference-entity-commerce";

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

  const memberUserIds = people
    .map((row) => row.user_id)
    .filter((userId): userId is string => Boolean(userId));
  let profileNameByUserId: Record<string, string | null> = {};
  if (memberUserIds.length > 0) {
    const { data: profileRows } = await adminClient
      .from("profiles")
      .select("id, display_name")
      .in("id", memberUserIds);
    profileNameByUserId = Object.fromEntries(
      (profileRows ?? []).map((row) => [row.id as string, (row.display_name as string | null) ?? null])
    );

  }

  // Grant-derived obligations: a person owes data because of what they hold,
  // not their role. Data-quality flags (e.g. travel-import issues) still count
  // against readiness on top of obligations.
  const obligationsResult = await resolveConferenceObligations(conferenceId, orgId);
  const obligationsByPerson = obligationsResult.success
    ? obligationsResult.data
    : new Map<string, { missing: { label: string }[]; isReady: boolean }>();

  const readinessRows = people
    .filter((row) => row.assignment_status !== "canceled")
    .map((row) => {
      const obligations = obligationsByPerson.get(row.id);
      const flagCount = (row.data_quality_flags ?? []).filter((f) => f.trim().length > 0).length;
      const missingCount = (obligations?.missing.length ?? 0) + flagCount;
      return { person: row, missingCount, isReady: missingCount === 0 };
    });


  /**
   * Seats this org holds with nobody on them.
   *
   * Readiness used to count only the data quality of people already ASSIGNED,
   * so a company that had assigned nobody read as "All assigned conference
   * people are ready" — true, and useless. Across this conference that hid 163
   * empty seats, including both social-event tickets. An empty seat is the
   * larger problem: a badge that cannot be printed and a place at a dinner
   * nobody can attend.
   */
  const seatsResult = await listEntitySeatsForOrg(conferenceId, orgId);
  const seatRows = seatsResult.success ? seatsResult.data : [];


  // Anyone already on this conference for this org is assignable. Not filtered
  // to the unseated: one person legitimately holds a registration AND a ticket
  // to the offsite.
  // Agreements split by who owes them: the buyer signs for the company, each
  // attendee signs their own.
  const legalStatus = await loadOrgLegalStatus(adminClient, conferenceId, orgId, auth.ctx.userId);
  const payments = await loadOrgPayments(adminClient, conferenceId, orgId);

  // One status record per person, folded into the seat list below — this is
  // what the separate "Conference People" table used to spell out in the
  // database's own vocabulary.
  const statusByPerson: Record<string, {
    hasAccount: boolean; missingCount: number; badgePrinted: boolean; checkedIn: boolean;
  }> = {};
  for (const { person, missingCount } of readinessRows) {
    statusByPerson[person.id] = {
      hasAccount: !!person.user_id,
      missingCount,
      badgePrinted: person.badge_print_status === "printed",
      checkedIn: !!person.checked_in_at,
    };
  }

  const attendeeOptions = people
    .filter((row) => row.assignment_status !== "canceled")
    .map((row) => ({
      id: row.id,
      name: row.display_name ?? profileNameByUserId[row.user_id ?? ""] ?? row.contact_email ?? "Unnamed",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

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

      <OrgPayments summary={payments} />

      <OrgAgreements status={legalStatus} />

      <SeatAssignment
        seats={seatRows}
        people={attendeeOptions}
        statusByPerson={statusByPerson}
        conferenceId={conferenceId}
        organizationId={orgId}
      />

    </main>
  );
}
