import type { Metadata } from "next";
import { listPublishedEventsWithOrgContext } from "@/lib/actions/events";
import { getOptionalAuthContext } from "@/lib/auth/guards";
import EventCard from "@/components/events/EventCard";

export const metadata: Metadata = {
  title: "Events | Campus Stores Canada",
  description: "Upcoming webinars, member sessions, and partner showcases from Campus Stores Canada.",
};

export const revalidate = 60;

export default async function EventsPage() {
  const authCtx = await getOptionalAuthContext();
  const userId  = authCtx?.userId;

  const eventsResult = await listPublishedEventsWithOrgContext(userId);
  const isAuthenticated = !!authCtx;
  const events = eventsResult.success ? eventsResult.data : [];

  const visibleEvents = isAuthenticated
    ? events
    : events.filter((e) => e.audience_mode === "public");

  const membersOnlyCount = isAuthenticated
    ? 0
    : events.filter((e) => e.audience_mode === "members_only").length;

  const now = new Date().toISOString();
  const upcoming = visibleEvents.filter((e) => e.starts_at >= now);
  const past     = visibleEvents.filter((e) => e.starts_at < now);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Events</h1>
        <p className="text-gray-500 mt-2">
          Webinars, member sessions, and partner showcases from CSC.
        </p>
      </div>

      {!isAuthenticated && membersOnlyCount > 0 && (
        <div className="mb-8 flex items-start gap-3 p-4 rounded-xl bg-blue-50 border border-blue-200">
          <svg className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
          <p className="text-sm text-blue-800">
            {membersOnlyCount} member-only event{membersOnlyCount !== 1 ? "s" : ""} not shown.{" "}
            <a href="/login" className="font-medium underline hover:no-underline">Sign in</a>{" "}
            to see all events.
          </p>
        </div>
      )}

      {upcoming.length === 0 && past.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg font-medium">No upcoming events</p>
          <p className="text-sm mt-1">Check back soon.</p>
        </div>
      )}

      {upcoming.length > 0 && (
        <section className="mb-10">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
            Upcoming
          </h2>
          <div className="space-y-4">
            {upcoming.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        </section>
      )}

      {past.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
            Past Events
          </h2>
          <div className="space-y-4 opacity-60">
            {past.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
