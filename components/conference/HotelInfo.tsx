/** Shared by the Member and Partner conference-hub views — same venue, same rate, same "not bookable yet" note. */
export default function HotelInfo({ venue }: { venue: string }) {
  if (!venue) return null;

  return (
    <section className="rounded-2xl border border-[#E5E5E5] bg-white p-6 shadow-sm">
      <h2 className="text-xl font-bold tracking-tight text-[#1A1A1A]">
        Where you&apos;ll be staying
      </h2>
      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <div className="overflow-hidden rounded-xl border border-[#E5E5E5]">
          <iframe
            title="Conference hotel location"
            src={`https://www.google.com/maps?q=${encodeURIComponent(venue)}&output=embed`}
            className="h-64 w-full"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
        <div className="flex flex-col justify-center">
          <p className="text-sm font-medium text-[#1A1A1A]">{venue}</p>
          <p className="mt-3 text-sm text-[#6B6B6B]">
            Rooms are{" "}
            <span className="font-semibold text-[#1A1A1A]">
              $185/night for single occupancy
            </span>
            , plus tax. The booking link will be live soon — check back here.
          </p>
        </div>
      </div>
    </section>
  );
}
