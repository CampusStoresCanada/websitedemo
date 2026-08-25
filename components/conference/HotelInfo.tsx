import HotelMap from "./HotelMap";
import {
  cutoffUrgency,
  daysUntilCutoff,
  formatCutoffDate,
  formatRate,
  type HotelRate,
} from "@/lib/conference/hotel";

/** Shared by the Member and Partner conference-hub views — same venue, same rates, same booking link. */
export default function HotelInfo({
  venue,
  lat,
  lng,
  bookingUrl,
  bookingCutoff,
  rates = [],
}: {
  venue: string;
  /** Verified venue coordinates (conference_instances.location_latitude/longitude) — the same
   *  source MapHero's own conference pin uses. Passed straight through to skip HotelMap's
   *  live text-geocoding fallback, which has resolved to the wrong same-named Hilton before. */
  lat?: number | null;
  lng?: number | null;
  /** Room-block link. Absent until the hotel provides one — the section still
   *  renders, with a check-back note where the button goes. */
  bookingUrl?: string | null;
  /** Last day the block rate can be booked (YYYY-MM-DD). */
  bookingCutoff?: string | null;
  /** One entry per room type, in admin-chosen display order. */
  rates?: HotelRate[];
}) {
  if (!venue) return null;

  // A date, not a timestamp: the cutoff is "end of that day at the hotel", so
  // comparing whole calendar days is what the reader means by it.
  const today = new Date().toISOString().slice(0, 10);
  const urgency = cutoffUrgency(bookingCutoff ?? null, today);
  const blockClosed = urgency === "passed";
  const canBook = Boolean(bookingUrl) && !blockClosed;

  return (
    <section className="rounded-2xl border border-[#E5E5E5] bg-white p-6 shadow-sm">
      <h2 className="text-xl font-bold tracking-tight text-[#1A1A1A]">
        Where you&apos;ll be staying
      </h2>
      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <HotelMap address={venue} lat={lat} lng={lng} />
        <div className="flex flex-col justify-center">
          <p className="text-sm font-medium text-[#1A1A1A]">{venue}</p>

          {rates.length > 0 ? (
            <ul className="mt-3 space-y-1">
              {rates.map((rate) => (
                <li key={rate.id} className="text-sm text-[#6B6B6B]">
                  {rate.label}{" "}
                  <span className="font-semibold text-[#1A1A1A]">
                    {formatRate(rate.rate_cents)}/night
                  </span>
                  {rate.note ? `, ${rate.note}` : ""}
                </li>
              ))}
            </ul>
          ) : null}

          {bookingCutoff && !blockClosed && (
            <p
              className={`mt-3 text-sm ${
                urgency === "soon" ? "font-semibold text-[#B45309]" : "text-[#6B6B6B]"
              }`}
            >
              Book by {formatCutoffDate(bookingCutoff)}
              {urgency === "soon" && (
                <>
                  {" — "}
                  {daysUntilCutoff(bookingCutoff, today)}{" "}
                  {daysUntilCutoff(bookingCutoff, today) === 1 ? "day" : "days"} left at
                  this rate
                </>
              )}
            </p>
          )}

          {canBook ? (
            <a
              href={bookingUrl ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex w-fit items-center justify-center rounded-full bg-[#1A1A1A] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#3A3A3A]"
            >
              Book your room
            </a>
          ) : blockClosed ? (
            <p className="mt-3 text-sm text-[#6B6B6B]">
              Our room block has closed. The hotel may still have rooms at its standard
              rate — contact them directly.
            </p>
          ) : (
            <p className="mt-3 text-sm text-[#6B6B6B]">
              The booking link will be live soon — check back here.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
