import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuthenticated } from "@/lib/auth/guards";
import { getPublicConference } from "@/lib/actions/conference";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildAttendeeMeetingRows,
  getConferenceScheduleTimeline,
} from "@/lib/conference/schedule-service";
import ScheduleClient from "./schedule-client";

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
    .maybeSingle()) as { data: { id: string } | null };

  const scheduleTimeline = await getConferenceScheduleTimeline(conference.id, delegateRegistration?.id
    ? {
        viewerRole: "delegate",
        viewerRegistrationId: delegateRegistration.id,
        viewerMeetingRole: "delegate",
      }
    : {
        viewerRole: "observer",
      });
  const meetings = delegateRegistration?.id ? buildAttendeeMeetingRows(scheduleTimeline) : [];

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
        delegateRegistrationId={delegateRegistration?.id ?? null}
        scheduleItems={scheduleTimeline.items}
        personalizedItems={delegateRegistration?.id ? scheduleTimeline.items : null}
        meetings={meetings}
        registerHref={`/conference/${year}/${edition}/register?role=delegate`}
      />
    </main>
  );
}
