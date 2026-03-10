import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuthenticated } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { updateConferencePersonSelf } from "@/lib/actions/conference-people";
import {
  computeConferenceReadiness,
  type ConferenceReadinessSnapshot,
} from "@/lib/conference/readiness";

type ConferencePersonRow = {
  id: string;
  registration_id: string | null;
  display_name: string | null;
  contact_email: string | null;
  person_kind: string;
  assignment_status: string;
  travel_mode: string | null;
  road_origin_address: string | null;
  preferred_departure_airport: string | null;
  seat_preference: string | null;
  dietary_restrictions: string | null;
  accessibility_needs: string | null;
  mobile_phone: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  arrival_flight_details: string | null;
  departure_flight_details: string | null;
  hotel_name: string | null;
  hotel_confirmation_code: string | null;
  badge_print_status: string;
  checked_in_at: string | null;
  data_quality_flags: string[] | null;
};

type NextMeeting = {
  exhibitorName: string;
  dayNumber: number;
  slotNumber: number;
  startTime: string;
  endTime: string;
  suiteNumber: number | null;
} | null;

function toNullable(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatTime(time: string): string {
  const [hours, minutes] = time.split(":");
  const h = Number(hours);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${minutes} ${suffix}`;
}

async function loadNextMeeting(params: {
  conferenceId: string;
  registrationId: string;
}): Promise<NextMeeting> {
  const adminClient = createAdminClient();
  const { data: activeRun } = await adminClient
    .from("scheduler_runs")
    .select("id")
    .eq("conference_id", params.conferenceId)
    .eq("run_mode", "active")
    .eq("status", "completed")
    .maybeSingle();

  if (!activeRun?.id) return null;

  const { data: schedules } = await adminClient
    .from("schedules")
    .select("meeting_slot_id, exhibitor_registration_id")
    .eq("conference_id", params.conferenceId)
    .eq("scheduler_run_id", activeRun.id)
    .contains("delegate_registration_ids", [params.registrationId])
    .neq("status", "canceled");

  if (!schedules || schedules.length === 0) return null;

  const meetingSlotIds = [...new Set(schedules.map((row) => row.meeting_slot_id))];
  const exhibitorRegIds = [...new Set(schedules.map((row) => row.exhibitor_registration_id))];

  const [{ data: meetingSlots }, { data: exhibitorRegs }] = await Promise.all([
    adminClient
      .from("meeting_slots")
      .select("id, day_number, slot_number, start_time, end_time, suite_id")
      .in("id", meetingSlotIds),
    adminClient
      .from("conference_registrations")
      .select("id, organization_id")
      .in("id", exhibitorRegIds),
  ]);

  const suiteIds = [...new Set((meetingSlots ?? []).map((slot) => slot.suite_id))];
  const orgIds = [...new Set((exhibitorRegs ?? []).map((reg) => reg.organization_id))];
  const [{ data: suites }, { data: organizations }] = await Promise.all([
    adminClient.from("conference_suites").select("id, suite_number").in("id", suiteIds),
    adminClient.from("organizations").select("id, name").in("id", orgIds),
  ]);

  const slotById = new Map((meetingSlots ?? []).map((slot) => [slot.id, slot] as const));
  const exhibitorByRegId = new Map((exhibitorRegs ?? []).map((row) => [row.id, row] as const));
  const suiteById = new Map((suites ?? []).map((suite) => [suite.id, suite] as const));
  const orgById = new Map((organizations ?? []).map((org) => [org.id, org] as const));

  const meetings = schedules
    .map((row) => {
      const slot = slotById.get(row.meeting_slot_id);
      const exhibitorReg = exhibitorByRegId.get(row.exhibitor_registration_id);
      if (!slot || !exhibitorReg) return null;
      const exhibitorOrg = orgById.get(exhibitorReg.organization_id);
      const suite = suiteById.get(slot.suite_id);
      return {
        exhibitorName: exhibitorOrg?.name ?? "Unknown exhibitor",
        dayNumber: slot.day_number,
        slotNumber: slot.slot_number,
        startTime: formatTime(slot.start_time),
        endTime: formatTime(slot.end_time),
        suiteNumber: suite?.suite_number ?? null,
      };
    })
    .filter((meeting): meeting is NonNullable<typeof meeting> => Boolean(meeting))
    .sort((a, b) => {
      if (a.dayNumber !== b.dayNumber) return a.dayNumber - b.dayNumber;
      if (a.slotNumber !== b.slotNumber) return a.slotNumber - b.slotNumber;
      return a.exhibitorName.localeCompare(b.exhibitorName);
    });

  return meetings[0] ?? null;
}

export const dynamic = "force-dynamic";

export default async function MyConferencePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const auth = await requireAuthenticated();
  if (!auth.ok) redirect("/login");

  const { id: conferenceId } = await params;
  const adminClient = createAdminClient();

  const [{ data: conference }, { data: peopleRows }] = await Promise.all([
    adminClient
      .from("conference_instances")
      .select("id, name, year, edition_code")
      .eq("id", conferenceId)
      .maybeSingle(),
    adminClient
      .from("conference_people")
      .select(
        "id, registration_id, display_name, contact_email, person_kind, assignment_status, travel_mode, road_origin_address, preferred_departure_airport, seat_preference, dietary_restrictions, accessibility_needs, mobile_phone, emergency_contact_name, emergency_contact_phone, arrival_flight_details, departure_flight_details, hotel_name, hotel_confirmation_code, badge_print_status, checked_in_at, data_quality_flags"
      )
      .eq("conference_id", conferenceId)
      .eq("user_id", auth.ctx.userId)
      .neq("assignment_status", "canceled")
      .order("updated_at", { ascending: false }),
  ]);

  if (!conference) {
    return <main className="max-w-5xl mx-auto px-4 py-8">Conference not found.</main>;
  }

  const person = ((peopleRows ?? [])[0] as ConferencePersonRow | undefined) ?? null;
  if (!person) {
    return (
      <main className="max-w-5xl mx-auto px-4 py-8 space-y-4">
        <h1 className="text-2xl font-semibold text-gray-900">{conference.name}</h1>
        <p className="text-sm text-gray-600">No conference profile is assigned to your account yet.</p>
      </main>
    );
  }

  const readiness: ConferenceReadinessSnapshot = computeConferenceReadiness({
    personKind: person.person_kind,
    displayName: person.display_name,
    contactEmail: person.contact_email,
    assignmentStatus: person.assignment_status,
    travelMode: person.travel_mode,
    roadOriginAddress: person.road_origin_address,
    emergencyContactName: person.emergency_contact_name,
    emergencyContactPhone: person.emergency_contact_phone,
    dataQualityFlags: person.data_quality_flags,
  });

  const nextMeeting =
    person.registration_id
      ? await loadNextMeeting({
          conferenceId,
          registrationId: person.registration_id,
        })
      : null;

  const conferenceHubHref = `/conference/${conference.year}/${conference.edition_code}`;
  const scheduleHref = `${conferenceHubHref}/schedule`;

  async function savePreferences(formData: FormData) {
    "use server";
    const patch: Record<string, unknown> = {
      travel_mode: toNullable(formData.get("travel_mode")),
      road_origin_address: toNullable(formData.get("road_origin_address")),
      preferred_departure_airport: toNullable(formData.get("preferred_departure_airport")),
      seat_preference: toNullable(formData.get("seat_preference")),
      dietary_restrictions: toNullable(formData.get("dietary_restrictions")),
      accessibility_needs: toNullable(formData.get("accessibility_needs")),
      mobile_phone: toNullable(formData.get("mobile_phone")),
      emergency_contact_name: toNullable(formData.get("emergency_contact_name")),
      emergency_contact_phone: toNullable(formData.get("emergency_contact_phone")),
    };
    const result = await updateConferencePersonSelf(person.id, patch);
    if (result.success) {
      revalidatePath(`/me/conference/${conferenceId}`);
    }
  }

  return (
    <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{conference.name}</h1>
          <p className="text-sm text-gray-600">My Conference</p>
        </div>
        <div className="flex gap-2">
          <Link
            href={conferenceHubHref}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-400"
          >
            Open Conference Hub
          </Link>
          <Link
            href={scheduleHref}
            className="rounded-md bg-[#D60001] px-4 py-2 text-sm font-medium text-white hover:bg-[#b50001]"
          >
            View Full Schedule
          </Link>
          <Link
            href={scheduleHref}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-400"
          >
            See Potential Swaps
          </Link>
        </div>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">Readiness Checklist</h2>
        {readiness.isReady ? (
          <p className="mt-2 text-sm text-emerald-700">Ready for conference operations.</p>
        ) : (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-800">
            {readiness.missing.map((item) => (
              <li key={`missing:${item}`}>Missing: {item}</li>
            ))}
            {readiness.blockers.map((item) => (
              <li key={`blocker:${item}`}>Flag: {item}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">Next Meeting</h2>
        {nextMeeting ? (
          <p className="mt-2 text-sm text-gray-700">
            Day {nextMeeting.dayNumber}, Slot {nextMeeting.slotNumber}: {nextMeeting.exhibitorName} (
            {nextMeeting.startTime} - {nextMeeting.endTime})
            {nextMeeting.suiteNumber ? ` • Suite ${nextMeeting.suiteNumber}` : ""}
          </p>
        ) : (
          <p className="mt-2 text-sm text-gray-600">No active meeting assignment published yet.</p>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">Admin Confirmations (Read-only)</h2>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-gray-500">Hotel</dt>
            <dd className="text-gray-900">{person.hotel_name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Hotel Confirmation</dt>
            <dd className="text-gray-900">{person.hotel_confirmation_code ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Arrival Flight</dt>
            <dd className="text-gray-900">{person.arrival_flight_details ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Departure Flight</dt>
            <dd className="text-gray-900">{person.departure_flight_details ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Badge Status</dt>
            <dd className="text-gray-900">{person.badge_print_status}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Check-in</dt>
            <dd className="text-gray-900">{person.checked_in_at ? "Checked in" : "Not checked in"}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">Preferences</h2>
        <form action={savePreferences} className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-gray-700">
            Travel mode
            <select
              name="travel_mode"
              defaultValue={person.travel_mode ?? ""}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
            >
              <option value="">Select</option>
              <option value="flight">Flight</option>
              <option value="road">Road</option>
            </select>
          </label>
          <label className="text-sm text-gray-700">
            Road origin address
            <input
              name="road_origin_address"
              defaultValue={person.road_origin_address ?? ""}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </label>
          <label className="text-sm text-gray-700">
            Preferred departure airport
            <input
              name="preferred_departure_airport"
              defaultValue={person.preferred_departure_airport ?? ""}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </label>
          <label className="text-sm text-gray-700">
            Seat preference
            <input
              name="seat_preference"
              defaultValue={person.seat_preference ?? ""}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </label>
          <label className="text-sm text-gray-700 sm:col-span-2">
            Dietary restrictions
            <input
              name="dietary_restrictions"
              defaultValue={person.dietary_restrictions ?? ""}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </label>
          <label className="text-sm text-gray-700 sm:col-span-2">
            Accessibility needs
            <input
              name="accessibility_needs"
              defaultValue={person.accessibility_needs ?? ""}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </label>
          <label className="text-sm text-gray-700">
            Mobile phone
            <input
              name="mobile_phone"
              defaultValue={person.mobile_phone ?? ""}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </label>
          <label className="text-sm text-gray-700">
            Emergency contact name
            <input
              name="emergency_contact_name"
              defaultValue={person.emergency_contact_name ?? ""}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </label>
          <label className="text-sm text-gray-700">
            Emergency contact phone
            <input
              name="emergency_contact_phone"
              defaultValue={person.emergency_contact_phone ?? ""}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </label>

          <div className="sm:col-span-2">
            <button
              type="submit"
              className="rounded-md bg-[#D60001] px-4 py-2 text-sm font-medium text-white hover:bg-[#b50001]"
            >
              Save Preferences
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
