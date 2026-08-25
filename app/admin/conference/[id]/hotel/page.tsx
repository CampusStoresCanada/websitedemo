import Link from "next/link";
import { getConference } from "@/lib/actions/conference";
import { parseHotelRates } from "@/lib/conference/hotel";
import HotelManager from "@/components/admin/conference/HotelManager";

export const metadata = { title: "Conference Hotel | Admin" };

export default async function ConferenceHotelPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const conferenceResult = await getConference(id);

  if (!conferenceResult.success || !conferenceResult.data) {
    return (
      <main className="space-y-4">
        <div className="text-sm text-gray-500">
          <Link href="/admin">Admin</Link> /{" "}
          <Link href="/admin/conference">Conference</Link> / Hotel
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Conference not found. {conferenceResult.error ?? ""}
        </div>
      </main>
    );
  }

  const conference = conferenceResult.data;
  const venue = [
    conference.location_venue?.trim(),
    conference.location_city?.trim(),
    conference.location_province?.trim(),
  ]
    .filter(Boolean)
    .join(", ");

  // Resolved server-side so the cutoff preview matches what the public page
  // renders, rather than the admin's own machine clock.
  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="space-y-4">
      <div className="text-sm text-gray-500">
        <Link href="/admin">Admin</Link> /{" "}
        <Link href="/admin/conference">Conference</Link> /{" "}
        <Link href={`/admin/conference/${conference.id}`}>{conference.name}</Link> / Hotel
      </div>
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Hotel</h1>
        <p className="mt-1 text-sm text-gray-600">
          The booking link and room rates shown in &ldquo;Where you&apos;ll be
          staying&rdquo; on the conference page — to members, partners, and anyone
          browsing it. The venue itself is set on the Edit tab.
        </p>
      </div>

      {!conference.location_venue && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          This conference has no venue set yet, so the section is hidden on the
          conference page entirely. Add one on the{" "}
          <Link href={`/admin/conference/${conference.id}/details`} className="underline">
            Edit tab
          </Link>{" "}
          for anything here to show.
        </div>
      )}

      <HotelManager
        conferenceId={conference.id}
        venue={venue}
        today={today}
        initial={{
          bookingUrl: conference.hotel_booking_url,
          bookingCutoff: conference.hotel_booking_cutoff,
          rates: parseHotelRates(conference.hotel_rates),
        }}
      />
    </main>
  );
}
