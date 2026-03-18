import { redirect } from "next/navigation";
import Link from "next/link";
import { requireAuthenticated } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = {
  title: "My Events | Campus Stores Canada",
};

function fmtDate(iso: string) {
  // Supabase returns "YYYY-MM-DD HH:mm:ss" without tz — force UTC
  const utc = iso.endsWith("Z") || iso.includes("+") ? iso : iso.replace(" ", "T") + "Z";
  return new Date(utc).toLocaleString("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

const eventStatusLabel: Record<string, string> = {
  pending_review: "Awaiting Review",
  draft: "Draft",
  published: "Published",
  cancelled: "Cancelled",
  completed: "Completed",
};

const eventStatusColor: Record<string, string> = {
  pending_review: "bg-amber-100 text-amber-700",
  draft:          "bg-gray-100 text-gray-600",
  published:      "bg-green-100 text-green-700",
  cancelled:      "bg-red-100 text-red-700",
  completed:      "bg-blue-100 text-blue-700",
};

const regStatusLabel: Record<string, string> = {
  registered: "Registered",
  waitlisted: "Waitlisted",
  promoted:   "Registered",
  cancelled:  "Cancelled",
};

const regStatusColor: Record<string, string> = {
  registered: "bg-green-100 text-green-700",
  waitlisted: "bg-amber-100 text-amber-700",
  promoted:   "bg-green-100 text-green-700",
  cancelled:  "bg-red-100 text-red-700",
};

export default async function MyEventsPage() {
  const auth = await requireAuthenticated();
  if (!auth.ok) redirect("/login");

  const adminClient = createAdminClient();
  const userId = auth.ctx.userId;
  const now = new Date().toISOString();

  // Events I'm hosting (created)
  const { data: hostedEvents } = await adminClient
    .from("events")
    .select("id, title, slug, starts_at, ends_at, status, capacity, is_virtual, virtual_link, location")
    .eq("created_by", userId)
    .order("starts_at", { ascending: false }) as { data: any[] | null };

  // Count registrations per hosted event in one query
  const hostedIds = (hostedEvents ?? []).map((e) => e.id);
  const registrantCountMap = new Map<string, number>();
  if (hostedIds.length > 0) {
    const { data: regCounts } = await adminClient
      .from("event_registrations")
      .select("event_id")
      .in("event_id", hostedIds)
      .in("status", ["registered", "promoted"]) as { data: any[] | null };
    for (const r of regCounts ?? []) {
      registrantCountMap.set(r.event_id, (registrantCountMap.get(r.event_id) ?? 0) + 1);
    }
  }

  // Events I've RSVP'd to
  const { data: myRegistrations } = await adminClient
    .from("event_registrations")
    .select("id, status, registered_at, event:events!inner(id, title, slug, starts_at, is_virtual, virtual_link, status, audience_mode)")
    .eq("user_id", userId)
    .in("status", ["registered", "waitlisted", "promoted"])
    .order("registered_at", { ascending: false }) as { data: any[] | null };

  const upcomingRsvps = (myRegistrations ?? []).filter(
    (r: any) => r.event?.starts_at >= now
  );
  const pastRsvps = (myRegistrations ?? []).filter(
    (r: any) => r.event?.starts_at < now
  );

  const upcomingHosted = (hostedEvents ?? []).filter((e) => e.starts_at >= now);
  const pastHosted     = (hostedEvents ?? []).filter((e) => e.starts_at < now);

  return (
    <main className="max-w-4xl mx-auto px-4 py-10 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/me" className="text-sm text-gray-500 hover:text-gray-700">My Account</Link>
            <span className="text-gray-300">/</span>
            <span className="text-sm text-gray-900 font-medium">My Events</span>
          </div>
          <h1 className="text-3xl font-bold text-gray-900">My Events</h1>
        </div>
        <Link
          href="/events"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 hover:border-gray-300 hover:bg-gray-50 transition-colors"
        >
          Browse Events
        </Link>
      </div>

      {/* ── Hosting ───────────────────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Hosting</h2>

        {(hostedEvents ?? []).length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center">
            <p className="text-sm text-gray-500">You haven't created any events yet.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {upcomingHosted.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-400 mb-2">Upcoming</p>
                <div className="space-y-3">
                  {upcomingHosted.map((ev: any) => (
                    <HostedEventRow
                      key={ev.id}
                      ev={ev}
                      registrantCount={registrantCountMap.get(ev.id) ?? 0}
                    />
                  ))}
                </div>
              </div>
            )}
            {pastHosted.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-400 mb-2">Past</p>
                <div className="space-y-3 opacity-60">
                  {pastHosted.map((ev: any) => (
                    <HostedEventRow
                      key={ev.id}
                      ev={ev}
                      registrantCount={registrantCountMap.get(ev.id) ?? 0}
                      isPast
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── RSVP'd ────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">RSVP'd</h2>

        {(myRegistrations ?? []).length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center">
            <p className="text-sm text-gray-500">
              No event registrations yet.{" "}
              <Link href="/events" className="text-[#EE2A2E] hover:underline">Browse events →</Link>
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {upcomingRsvps.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-400 mb-2">Upcoming</p>
                <div className="space-y-3">
                  {upcomingRsvps.map((reg: any) => (
                    <RsvpRow key={reg.id} reg={reg} />
                  ))}
                </div>
              </div>
            )}
            {pastRsvps.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-400 mb-2">Past</p>
                <div className="space-y-3 opacity-60">
                  {pastRsvps.map((reg: any) => (
                    <RsvpRow key={reg.id} reg={reg} isPast />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

// ── Sub-components ────────────────────────────────────────────────

function HostedEventRow({
  ev,
  registrantCount,
  isPast = false,
}: {
  ev: any;
  registrantCount: number;
  isPast?: boolean;
}) {
  const capacityText = ev.capacity
    ? `${registrantCount} / ${ev.capacity} registered`
    : `${registrantCount} registered`;

  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-900 truncate">{ev.title}</span>
          <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-medium ${eventStatusColor[ev.status] ?? "bg-gray-100 text-gray-600"}`}>
            {eventStatusLabel[ev.status] ?? ev.status}
          </span>
          {ev.is_virtual && (
            <span className="inline-block px-1.5 py-0.5 rounded text-[11px] font-medium bg-purple-50 text-purple-700">
              Virtual
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-0.5">{fmtDate(ev.starts_at)}</p>
        <p className="text-xs text-gray-400 mt-0.5">{capacityText}</p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {/* Attendees — links to attendee management (coming soon) */}
        <Link
          href={`/me/events/${ev.id}/attendees`}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:border-gray-300 hover:bg-gray-50 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Attendees
        </Link>

        {ev.slug && (
          <Link
            href={`/events/${ev.slug}`}
            className="inline-flex items-center px-3 py-1.5 rounded-lg bg-[#EE2A2E] hover:bg-[#D92327] text-white text-xs font-bold transition-colors"
          >
            {isPast ? "See Details" : "View Event"}
          </Link>
        )}
      </div>
    </div>
  );
}

function RsvpRow({ reg, isPast = false }: { reg: any; isPast?: boolean }) {
  const ev = reg.event;
  const isVirtual = ev?.is_virtual;
  const meetLink  = ev?.virtual_link;
  const isActive  = reg.status === "registered" || reg.status === "promoted";

  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-900 truncate">{ev?.title}</span>
          <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-medium ${regStatusColor[reg.status] ?? "bg-gray-100 text-gray-600"}`}>
            {regStatusLabel[reg.status] ?? reg.status}
          </span>
          {isVirtual && (
            <span className="inline-block px-1.5 py-0.5 rounded text-[11px] font-medium bg-purple-50 text-purple-700">
              Virtual
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-0.5">
          {ev?.starts_at ? fmtDate(ev.starts_at) : ""}
        </p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {!isPast && isActive && isVirtual && meetLink ? (
          <a
            href={meetLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#EE2A2E] hover:bg-[#D92327] text-white text-xs font-bold transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.361a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2z" />
            </svg>
            Join Now
          </a>
        ) : ev?.slug ? (
          <Link
            href={`/events/${ev.slug}`}
            className="inline-flex items-center px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:border-gray-300 hover:bg-gray-50 transition-colors"
          >
            See Details
          </Link>
        ) : null}
      </div>
    </div>
  );
}
