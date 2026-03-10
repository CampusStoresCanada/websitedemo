import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuthenticated } from "@/lib/auth/guards";
import { getPublicConference } from "@/lib/actions/conference";
import { createAdminClient } from "@/lib/supabase/admin";
import ScheduleClient from "./schedule-client";

interface MeetingRow {
  scheduleId: string;
  meetingSlotId: string;
  exhibitorRegistrationId: string;
  exhibitorOrganizationId: string;
  exhibitorName: string;
  dayNumber: number;
  slotNumber: number;
  startTime: string;
  endTime: string;
  suiteNumber: number | null;
}

function formatTime(time: string): string {
  const [hours, minutes] = time.split(":");
  const h = Number(hours);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${minutes} ${suffix}`;
}

export const metadata = { title: "My Conference Schedule" };

export default async function ConferenceSchedulePage({
  params,
}: {
  params: Promise<{ year: string; edition: string }>;
}) {
  const { year, edition } = await params;
  const auth = await requireAuthenticated();
  if (!auth.ok) redirect("/login");

  const conferenceResult = await getPublicConference(parseInt(year, 10), edition);
  if (!conferenceResult.success || !conferenceResult.data) {
    return (
      <main className="max-w-5xl mx-auto py-12 px-4">
        <h1 className="text-2xl font-semibold text-gray-900">Conference not found</h1>
      </main>
    );
  }

  const conference = conferenceResult.data;
  const adminClient = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: delegateRegistration } = (await (adminClient as any)
    .from("conference_registrations")
    .select("id")
    .eq("conference_id", conference.id)
    .eq("user_id", auth.ctx.userId)
    .in("registration_type", ["delegate", "observer"])
    .in("status", ["submitted", "confirmed"])
    .maybeSingle()) as { data: any };

  if (!delegateRegistration?.id) {
    return (
      <main className="max-w-5xl mx-auto py-8 px-4 space-y-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{conference.name}</h1>
          <p className="text-sm text-gray-600">My conference schedule</p>
        </div>
        <div className="rounded-lg border border-gray-200 p-6">
          <p className="text-sm text-gray-700">
            No submitted delegate registration found for your account.
          </p>
          <Link
            href={`/conference/${year}/${edition}/register?role=delegate`}
            className="mt-3 inline-flex rounded-md bg-[#D60001] px-4 py-2 text-sm font-medium text-white hover:bg-[#b50001]"
          >
            Complete Delegate Registration
          </Link>
        </div>
      </main>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: activeRun } = (await (adminClient as any)
    .from("scheduler_runs")
    .select("id")
    .eq("conference_id", conference.id)
    .eq("run_mode", "active")
    .eq("status", "completed")
    .maybeSingle()) as { data: any };

  if (!activeRun?.id) {
    return (
      <main className="max-w-5xl mx-auto py-8 px-4 space-y-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{conference.name}</h1>
          <p className="text-sm text-gray-600">My conference schedule</p>
        </div>
        <div className="rounded-lg border border-gray-200 p-6 text-sm text-gray-700">
          Schedule is not published yet.
        </div>
      </main>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: schedules, error: schedulesError } = (await (adminClient as any)
    .from("schedules")
    .select("*")
    .eq("conference_id", conference.id)
    .eq("scheduler_run_id", activeRun.id)
    .contains("delegate_registration_ids", [delegateRegistration.id])
    .neq("status", "canceled")) as { data: any[] | null; error: any };

  if (schedulesError) {
    return (
      <main className="max-w-5xl mx-auto py-8 px-4">
        <h1 className="text-2xl font-semibold text-gray-900">{conference.name}</h1>
        <p className="mt-2 text-sm text-red-600">{schedulesError.message}</p>
      </main>
    );
  }

  const rows = schedules ?? [];
  const meetingSlotIds = [...new Set(rows.map((row) => row.meeting_slot_id))];
  const exhibitorRegIds = [...new Set(rows.map((row) => row.exhibitor_registration_id))];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ac = adminClient as any;
  const [{ data: meetingSlots }, { data: exhibitorRegs }] = (await Promise.all([
    ac
      .from("meeting_slots")
      .select("id, day_number, slot_number, start_time, end_time, suite_id")
      .in("id", meetingSlotIds),
    ac
      .from("conference_registrations")
      .select("id, organization_id")
      .in("id", exhibitorRegIds),
  ])) as [{ data: any[] | null }, { data: any[] | null }];

  const suiteIds = [...new Set((meetingSlots ?? []).map((slot) => slot.suite_id))];
  const orgIds = [...new Set((exhibitorRegs ?? []).map((reg) => reg.organization_id))];
  const [{ data: suites }, { data: organizations }] = (await Promise.all([
    ac.from("conference_suites").select("id, suite_number").in("id", suiteIds),
    ac.from("organizations").select("id, name").in("id", orgIds),
  ])) as [{ data: any[] | null }, { data: any[] | null }];

  const slotById = new Map((meetingSlots ?? []).map((slot) => [slot.id, slot] as const));
  const exhibitorByRegId = new Map((exhibitorRegs ?? []).map((row) => [row.id, row] as const));
  const suiteById = new Map((suites ?? []).map((suite) => [suite.id, suite] as const));
  const orgById = new Map((organizations ?? []).map((org) => [org.id, org] as const));

  const meetings: MeetingRow[] = rows
    .map((row) => {
      const slot = slotById.get(row.meeting_slot_id);
      const exhibitorReg = exhibitorByRegId.get(row.exhibitor_registration_id);
      if (!slot || !exhibitorReg) return null;
      const exhibitorOrg = orgById.get(exhibitorReg.organization_id);
      const suite = suiteById.get(slot.suite_id);
      return {
        scheduleId: row.id,
        meetingSlotId: slot.id,
        exhibitorRegistrationId: exhibitorReg.id,
        exhibitorOrganizationId: exhibitorReg.organization_id,
        exhibitorName: exhibitorOrg?.name ?? "Unknown exhibitor",
        dayNumber: slot.day_number,
        slotNumber: slot.slot_number,
        startTime: formatTime(slot.start_time),
        endTime: formatTime(slot.end_time),
        suiteNumber: suite?.suite_number ?? null,
      };
    })
    .filter((meeting): meeting is MeetingRow => Boolean(meeting))
    .sort((a, b) => {
      if (a.dayNumber !== b.dayNumber) return a.dayNumber - b.dayNumber;
      if (a.slotNumber !== b.slotNumber) return a.slotNumber - b.slotNumber;
      return a.exhibitorName.localeCompare(b.exhibitorName);
    });

  return (
    <main className="max-w-5xl mx-auto py-8 px-4 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{conference.name}</h1>
          <p className="text-sm text-gray-600">My conference schedule</p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/conference/${year}/${edition}/products`}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-400"
          >
            Products
          </Link>
          <Link
            href={`/conference/${year}/${edition}/orders`}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-400"
          >
            Orders
          </Link>
        </div>
      </div>

      <ScheduleClient
        conferenceId={conference.id}
        delegateRegistrationId={delegateRegistration.id}
        meetings={meetings}
      />
    </main>
  );
}
