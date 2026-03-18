import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guards";
import { getEvent, approveEvent, transitionEventStatus } from "@/lib/actions/events";
import { getCheckinList } from "@/lib/actions/event-checkin";
import { createAdminClient } from "@/lib/supabase/admin";
import EventStatusBadge from "@/components/admin/events/EventStatusBadge";
import AttendeeList from "@/components/admin/events/AttendeeList";
import WaitlistTable from "@/components/admin/events/WaitlistTable";
import CheckInPanel from "@/components/admin/events/CheckInPanel";
import EventAdminControls from "@/components/admin/events/EventAdminControls";
import TicketManager from "@/components/admin/events/TicketManager";
import LocalDate from "@/components/ui/LocalDate";
import type { WaitlistRow } from "@/lib/events/types";
import type { EventTicketType } from "@/lib/events/tickets";

export const metadata: Metadata = {
  title: "Event Detail | Admin | Campus Stores Canada",
};

export default async function AdminEventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const auth = await requireAdmin();
  if (!auth.ok) return <div className="p-8 text-gray-500">Access denied.</div>;

  const { id } = await params;
  const { tab = "details" } = await searchParams;

  const adminClient = createAdminClient();

  const [eventResult, attendeesResult, ticketsResult] = await Promise.all([
    getEvent(id),
    getCheckinList(id),
    adminClient
      .from("event_ticket_types")
      .select("*")
      .eq("event_id", id)
      .order("sort_order", { ascending: true }),
  ]);

  const ticketTypes = (ticketsResult.data ?? []) as EventTicketType[];

  if (!eventResult.success) notFound();
  const event = eventResult.data;
  const attendees = attendeesResult.success ? attendeesResult.data : [];

  // Load waitlist
  const { data: waitlistRaw } = await adminClient
    .from("event_waitlist")
    .select(`id, user_id, position, joined_at, profiles!event_waitlist_user_id_fkey(display_name)`)
    .eq("event_id", id)
    .order("position", { ascending: true });

  // Get emails for waitlist
  const waitlistUserIds = (waitlistRaw ?? []).map((w: any) => w.user_id);
  let waitlistEmailMap: Record<string, string> = {};
  if (waitlistUserIds.length > 0) {
    const { data: authUsers } = await adminClient.auth.admin.listUsers();
    waitlistEmailMap = Object.fromEntries(
      (authUsers?.users ?? [])
        .filter((u) => waitlistUserIds.includes(u.id))
        .map((u) => [u.id, u.email ?? ""])
    );
  }

  const waitlist: WaitlistRow[] = (waitlistRaw ?? []).map((w: any) => ({
    waitlist_id: w.id,
    user_id: w.user_id,
    display_name: w.profiles?.display_name ?? null,
    email: waitlistEmailMap[w.user_id] ?? null,
    position: w.position,
    joined_at: w.joined_at,
  }));

  const tabs = [
    { key: "details",   label: "Details" },
    { key: "tickets",   label: `Tickets (${ticketTypes.length})` },
    { key: "attendees", label: `Attendees (${attendees.length})` },
    { key: "waitlist",  label: `Waitlist (${waitlist.length})` },
    { key: "checkin",   label: "Check-in" },
  ];


  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/admin/events"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors mb-4"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Events
        </Link>

        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <EventStatusBadge status={event.status} />
              {event.audience_mode === "members_only" && (
                <span className="text-xs text-gray-400">Members only</span>
              )}
            </div>
            <h1 className="text-2xl font-bold text-gray-900">{event.title}</h1>
            <p className="text-sm text-gray-500 mt-1"><LocalDate iso={event.starts_at} /></p>
          </div>

          <div className="flex gap-2 shrink-0">
            <Link
              href={`/admin/events/${id}/edit`}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              Edit
            </Link>
            {event.status !== "cancelled" && event.status !== "completed" && (
              <Link
                href={`/events/${event.slug}`}
                target="_blank"
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                View ↗
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Approve banner */}
      {event.status === "pending_review" && (
        <EventAdminControls eventId={id} currentStatus={event.status} showApprove />
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/admin/events/${id}?tab=${t.key}`}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? "border-[#EE2A2E] text-[#EE2A2E]"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {/* Tab content */}
      {tab === "details" && (
        <div className="space-y-6">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 text-sm">
            <div>
              <dt className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Start</dt>
              <dd className="text-gray-700"><LocalDate iso={event.starts_at} /></dd>
            </div>
            {event.ends_at && (
              <div>
                <dt className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">End</dt>
                <dd className="text-gray-700"><LocalDate iso={event.ends_at} /></dd>
              </div>
            )}
            <div>
              <dt className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                {event.is_virtual ? "Meeting Link" : "Location"}
              </dt>
              <dd className="text-gray-700 break-all">
                {event.is_virtual ? event.virtual_link ?? "—" : event.location ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Capacity</dt>
              <dd className="text-gray-700">{event.capacity ?? "Unlimited"}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Audience</dt>
              <dd className="text-gray-700">
                {event.audience_mode === "members_only" ? "Members only" : "Public"}
              </dd>
            </div>
            {event.creator_name && (
              <div>
                <dt className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Created by</dt>
                <dd className="text-gray-700">{event.creator_name}</dd>
              </div>
            )}
          </dl>

          {event.description && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Description</p>
              <p className="text-gray-700 text-sm">{event.description}</p>
            </div>
          )}

          {/* Status controls */}
          {event.status !== "pending_review" && (
            <EventAdminControls eventId={id} currentStatus={event.status} />
          )}
        </div>
      )}

      {tab === "tickets" && (
        <TicketManager eventId={id} tickets={ticketTypes} />
      )}

      {tab === "attendees" && (
        <AttendeeList attendees={attendees} eventId={id} />
      )}

      {tab === "waitlist" && (
        <WaitlistTable waitlist={waitlist} />
      )}

      {tab === "checkin" && (
        <CheckInPanel eventId={id} attendees={attendees} />
      )}
    </div>
  );
}
