import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guards";
import { listEvents } from "@/lib/actions/events";
import EventStatusBadge from "@/components/admin/events/EventStatusBadge";
import LocalDate from "@/components/ui/LocalDate";
import type { EventStatus } from "@/lib/events/types";

export const metadata: Metadata = {
  title: "Events | Admin | Campus Stores Canada",
};

export default async function AdminEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return <div className="p-8 text-gray-500">Access denied.</div>;
  }

  const { status } = await searchParams;

  const result = await listEvents({ status: status as EventStatus | undefined });
  if (!result.success) {
    return <div className="p-8 text-red-600">Failed to load events: {result.error}</div>;
  }
  const events = result.data;

  const pendingReview = events.filter((e) => e.status === "pending_review");

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Events</h1>
          <p className="text-sm text-gray-500 mt-1">Non-conference events managed by CSC</p>
        </div>
        {/* Create via Toolkit modal — point to a fallback direct route */}
        <Link
          href="/admin/events/new"
          className="px-4 py-2 rounded-lg bg-[#EE2A2E] hover:bg-[#D92327] text-white text-sm font-semibold transition-colors"
        >
          + New Event
        </Link>
      </div>

      {/* Pending review banner */}
      {pendingReview.length > 0 && !status && (
        <div className="mb-6 flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
          <svg className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <div>
            <p className="text-sm font-medium text-amber-800">
              {pendingReview.length} event{pendingReview.length !== 1 ? "s" : ""} awaiting your approval
            </p>
            <Link
              href="/admin/events?status=pending_review"
              className="text-xs text-amber-700 underline hover:no-underline mt-0.5 inline-block"
            >
              View pending events
            </Link>
          </div>
        </div>
      )}

      {/* Status filter tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {(["", "pending_review", "draft", "published", "completed", "cancelled"] as const).map(
          (s) => {
            const label =
              s === ""
                ? "All"
                : s === "pending_review"
                ? "Awaiting Approval"
                : s.charAt(0).toUpperCase() + s.slice(1);
            const isActive = (status ?? "") === s;
            return (
              <Link
                key={s}
                href={s ? `/admin/events?status=${s}` : "/admin/events"}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  isActive
                    ? "border-[#EE2A2E] text-[#EE2A2E]"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {label}
              </Link>
            );
          }
        )}
      </div>

      {events.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg font-medium">No events found</p>
          <p className="text-sm mt-1">
            {status ? "Try a different filter." : "Create your first event."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((event) => (
            <Link
              key={event.id}
              href={`/admin/events/${event.id}`}
              className="flex items-center justify-between p-4 rounded-xl border border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm transition-all group"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <EventStatusBadge status={event.status} />
                  {event.audience_mode === "members_only" && (
                    <span className="text-xs text-gray-400">Members only</span>
                  )}
                </div>
                <p className="font-medium text-gray-900 group-hover:text-[#EE2A2E] transition-colors truncate">
                  {event.title}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  <LocalDate iso={event.starts_at} format="date-only" />
                  {event.creator_name && ` · Created by ${event.creator_name}`}
                </p>
              </div>
              <div className="ml-4 shrink-0 text-right text-sm text-gray-500">
                <p>{event.registration_count} registered</p>
                {event.waitlist_count > 0 && (
                  <p className="text-xs text-amber-600">{event.waitlist_count} waitlisted</p>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
