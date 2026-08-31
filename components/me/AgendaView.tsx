import Link from "next/link";
import type { PersonAgenda } from "@/lib/conference/person-agenda";
import { describeUrgency, URGENCY_CLASS } from "@/lib/conference/deadline-urgency";

/**
 * A person's days, in order.
 *
 * Grouped by day because that is how anyone at a conference thinks about it —
 * not by kind, not by what it cost. Times in the conference's own timezone,
 * never the reader's: someone in Vancouver looking at a Toronto agenda needs
 * to know when to be in the room, not when it is happening at home.
 */
export default function AgendaView({
  agenda,
  mapHref,
}: {
  agenda: PersonAgenda;
  mapHref: string;
}) {
  if (agenda.items.length === 0) {
    return (
      <p className="text-sm text-gray-600">
        Nothing on your agenda yet. It fills in as your registration and any extras
        are assigned to you.
      </p>
    );
  }

  const conflicted = new Set(agenda.conflicts.flatMap((c) => [c.a, c.b]));
  // One "today" for the whole render, so two rows cannot disagree about it.
  const todayISO = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      {agenda.deadlines.length > 0 && (
        // Before the days, because these are all due before the conference —
        // a timeline that starts now and ends when the doors open.
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
            Before you go
          </h3>
          <p className="mt-0.5 text-sm text-gray-500">
            Only you can answer these.
          </p>
          <ul className="mt-2 space-y-2">
            {agenda.deadlines.map((d) => (
              <li key={d.key} className="text-sm">
                <span className="font-medium text-gray-900">{d.label}</span>
                {d.dueOn ? (
                  <span className={URGENCY_CLASS[describeUrgency(d.dueOn, todayISO).tone]}>
                    {" "}— by {formatDayHeading(d.dueOn)}
                    {d.hardensBecause && (
                      // The consequence, not just the date. "By 11 January" is
                      // a fact; "after that, badges go to print and you collect
                      // yours at the desk" is a reason to act today.
                      <span className="block text-xs text-gray-500">
                        After that, {d.hardensBecause}.
                      </span>
                    )}
                    {/* Soft, and saying so matters: someone who reads a passed
                        date as a closed door stops telling us about an allergy,
                        which is the opposite of what the deadline is for. */}
                    {d.key === "dietary_restrictions" && (
                      <span className="text-gray-500">, or as soon as you can after</span>
                    )}
                  </span>
                ) : (
                  <span className="text-gray-500"> — needed {d.waitingOn}</span>
                )}
              </li>
            ))}
          </ul>
          {/* One way in, for every kind of thing owed. Fields are typed and
              check-ins are ticked, but both are answered in the same place —
              a person should not have to learn which of their own details
              lives behind which control. */}
          <a
            href="#edit-conference"
            className="mt-3 inline-block rounded-md bg-[#163D6D] px-3 py-2 text-sm font-semibold text-white hover:bg-[#12325a]"
          >
            {agenda.deadlines.length === 1 ? "Answer it" : "Answer these"}
          </a>
        </div>
      )}
      {agenda.conflicts.length > 0 && (
        // Flagged, never resolved for them. Two things at once is sometimes
        // deliberate — you leave the session early to get to your booth — and
        // silently dropping one would hide a decision that is theirs.
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {agenda.conflicts.length === 1
            ? "Two things overlap on your agenda."
            : `${agenda.conflicts.length} pairs of things overlap on your agenda.`}{" "}
          They&rsquo;re marked below — you may well be doing both.
        </p>
      )}

      {agenda.dayKeys.map((dayKey) => {
        const dayItems = agenda.items.filter((i) => i.dayKeyLocal === dayKey);
        return (
          <section key={dayKey}>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
              {formatDayHeading(dayKey)}
            </h3>
            <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
              {dayItems.map((item) => (
                <li key={item.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2.5">
                  <span className="w-28 shrink-0 text-sm font-medium tabular-nums text-gray-900">
                    {timeRange(item.startsAt, item.endsAt, agenda.timeZone)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-sm font-medium text-gray-900">{item.title}</span>
                    {item.reason === "meeting" && item.meetingAssignment && (
                      <span className="ml-2 text-sm text-gray-600">
                        with {item.meetingAssignment.exhibitorName}
                        {item.meetingAssignment.suiteNumber != null &&
                          ` · suite ${item.meetingAssignment.suiteNumber}`}
                      </span>
                    )}
                    {item.locationLabel && (
                      <span className="ml-2 text-sm text-gray-500">{item.locationLabel}</span>
                    )}
                    {conflicted.has(item.id) && (
                      <span className="ml-2 text-xs font-semibold text-amber-700">overlaps</span>
                    )}
                  </span>
                  {item.locationLabel && item.locationLabel !== "TBD" && (
                    // Straight to the map with the place already searched —
                    // "where is that" is the next question every single time.
                    <Link
                      href={`${mapHref}?find=${encodeURIComponent(item.locationLabel)}`}
                      className="text-xs font-medium text-[#163D6D] hover:underline"
                    >
                      Find it
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** "2027-02-03" → "Wednesday 3 February". Formatted from the digits, never
 *  parsed into an instant — a day key is a calendar date, not a moment. */
function formatDayHeading(dayKey: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) return dayKey;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return date.toLocaleDateString("en-CA", {
    weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
  });
}

/**
 * Formatted from the INSTANT, in the conference's timezone, 24-hour.
 *
 * The first version scraped the clock out of the already-formatted string the
 * schedule service produces — which uses `hour: "numeric"` and so carries a
 * meridiem. The regex took "5:30" out of "Feb 1, 5:30 PM" and dropped the PM,
 * rendering a 17:30 reception as 5:30. Someone would have shown up twelve
 * hours early.
 *
 * 24-hour on purpose: a schedule read at a glance in a corridor should not
 * depend on spotting two small letters.
 */
function timeRange(startsAt: string, endsAt: string, timeZone: string): string {
  const start = clockOf(startsAt, timeZone);
  if (!start) return "All day";
  const end = clockOf(endsAt, timeZone);
  return end ? `${start}–${end}` : start;
}

function clockOf(iso: string, timeZone: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}
