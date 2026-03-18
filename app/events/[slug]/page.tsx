import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getEventBySlugWithOrgContext, getPublicAttendees } from "@/lib/actions/events";
import { resolveTicketsForUser } from "@/lib/actions/event-tickets";
import { getOptionalAuthContext } from "@/lib/auth/guards";
import EventRegistrationButton from "@/components/events/EventRegistrationButton";
import TicketSelector from "@/components/events/TicketSelector";
import EventDetailBanner from "@/components/events/EventDetailBanner";
import OrgMemberRegistrationPanel from "@/components/events/OrgMemberRegistrationPanel";
import LocalDate from "@/components/ui/LocalDate";

export const revalidate = 30;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const result = await getEventBySlugWithOrgContext(slug);
  if (!result.success) return { title: "Event | Campus Stores Canada" };
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return {
    title: `${result.data.title} | Events | Campus Stores Canada`,
    description: result.data.description ?? undefined,
    openGraph: {
      title: result.data.title,
      description: result.data.description ?? undefined,
      images: appUrl ? [`${appUrl}/api/og/events/${slug}`] : [],
    },
    twitter: {
      card: "summary_large_image",
      title: result.data.title,
      description: result.data.description ?? undefined,
      images: appUrl ? [`${appUrl}/api/og/events/${slug}`] : [],
    },
  };
}

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const authCtx = await getOptionalAuthContext();
  const userId = authCtx?.userId;

  const result = await getEventBySlugWithOrgContext(slug, userId);
  if (!result.success) notFound();

  const event = result.data;
  const isAuthenticated = !!authCtx;

  // Org admin: fetch org name for the panel
  const orgAdminOrgId = authCtx?.orgAdminOrgIds?.[0] ?? null;
  let orgAdminOrgName: string | null = null;
  if (orgAdminOrgId) {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const adminClient = createAdminClient();
    const { data: org } = await adminClient
      .from("organizations")
      .select("name")
      .eq("id", orgAdminOrgId)
      .single();
    orgAdminOrgName = org?.name ?? null;
  }

  // Resolve ticket types for this user (empty = use legacy free registration flow)
  const [ticketsResult, attendeesResult] = await Promise.all([
    resolveTicketsForUser(event.id),
    getPublicAttendees(event.id),
  ]);
  const tickets = ticketsResult.success ? ticketsResult.data : null;
  const attendeeData = attendeesResult.success ? attendeesResult.data : null;
  const hasTickets = tickets && !tickets.noTicketsConfigured;
  const isMembersOnly = event.audience_mode === "members_only";
  const isCSC = event.creator_org_name === "Campus Stores Canada";

  // Members-only event: unauthenticated users see teaser but not full body
  const canViewFull = !isMembersOnly || isAuthenticated;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
      <div className="mb-6">
        <Link
          href="/events"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          All Events
        </Link>
      </div>

      {/* Visual banner — Mapbox map + org colour tint */}
      <EventDetailBanner
        startsAt={event.starts_at}
        primaryColor={event.creator_primary_color}
        lat={event.creator_lat}
        lng={event.creator_lng}
        zoom={event.creator_zoom}
        creatorDisplayName={event.creator_display_name}
        orgName={event.creator_org_name}
        isCSC={isCSC}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main content */}
        <div className="lg:col-span-2">
          <div className="flex flex-wrap gap-2 mb-3">
            {isMembersOnly && (
              <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                </svg>
                Members Only
              </span>
            )}
            {event.is_virtual && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-50 text-purple-700">
                Virtual
              </span>
            )}
          </div>

          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-4">{event.title}</h1>

          {event.description && (
            <p className="text-gray-600 text-lg mb-6 leading-relaxed">{event.description}</p>
          )}

          {canViewFull && event.body_html ? (
            <div
              className="prose prose-gray max-w-none"
              dangerouslySetInnerHTML={{ __html: event.body_html }}
            />
          ) : !canViewFull ? (
            <div className="rounded-xl bg-blue-50 border border-blue-200 p-6 text-center">
              <p className="text-blue-800 font-medium mb-3">
                This is a members-only event. Sign in to view full details and register.
              </p>
              <a
                href="/login"
                className="inline-block px-5 py-2.5 rounded-lg bg-[#EE2A2E] hover:bg-[#D92327] text-white font-semibold text-sm transition-colors"
              >
                Sign In
              </a>
            </div>
          ) : null}
        </div>

        {/* Sidebar */}
        <div className="lg:col-span-1">
          <div className="rounded-xl border border-gray-200 p-5 space-y-5 sticky top-6">
            {/* Date & Time */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                Date & Time
              </p>
              <p className="text-sm text-gray-700 font-medium"><LocalDate iso={event.starts_at} /></p>
              {event.ends_at && (
                <p className="text-sm text-gray-500 mt-0.5">
                  Until <LocalDate iso={event.ends_at} />
                </p>
              )}
            </div>

            {/* Location — in-person only; virtual events use the Join button */}
            {!event.is_virtual && event.location && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                  Location
                </p>
                <p className="text-sm text-gray-700 mb-1">{event.location}</p>
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(event.location)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#EE2A2E] hover:underline"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Get Directions ↗
                </a>
              </div>
            )}

            {/* Capacity */}
            {event.capacity !== null && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                  Capacity
                </p>
                <p
                  className={`text-sm font-medium ${
                    event.spots_remaining === 0
                      ? "text-red-600"
                      : (event.spots_remaining ?? 99) <= 5
                      ? "text-amber-600"
                      : "text-gray-700"
                  }`}
                >
                  {event.spots_remaining === 0
                    ? "Full — waitlist available"
                    : `${event.spots_remaining} of ${event.capacity} spots remaining`}
                </p>
              </div>
            )}

            {/* Registration CTA */}
            {hasTickets && !event.user_registration_status ? (
              <TicketSelector
                eventId={event.id}
                available={tickets!.available}
                locked={tickets!.locked}
                isAuthenticated={isAuthenticated}
              />
            ) : (
              <EventRegistrationButton
                eventId={event.id}
                eventTitle={event.title}
                status={event.user_registration_status}
                spotsRemaining={event.spots_remaining}
                isAuthenticated={isAuthenticated}
                isMembersOnly={isMembersOnly}
                isVirtual={event.is_virtual}
                meetLink={event.virtual_link}
              />
            )}

            {/* Org admin: register members from their org */}
            {orgAdminOrgId && orgAdminOrgName && (
              <OrgMemberRegistrationPanel
                eventId={event.id}
                orgId={orgAdminOrgId}
                orgName={orgAdminOrgName}
                availableTickets={
                  hasTickets
                    ? tickets!.available.map((t) => ({
                        id: t.ticket.id,
                        name: t.ticket.name,
                        price_cents: t.ticket.price_cents,
                        priceLabel: t.priceLabel,
                      }))
                    : undefined
                }
              />
            )}
          </div>
        </div>
      </div>

      {/* Who's Coming */}
      {attendeeData && attendeeData.total > 0 && (
        <div className="mt-10 pt-8 border-t border-gray-100">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Who&rsquo;s Coming
          </h2>
          {isAuthenticated ? (
            <div className="flex flex-wrap items-center gap-2">
              {attendeeData.names.slice(0, 20).map((name, i) => (
                <span
                  key={i}
                  className="inline-flex items-center px-3 py-1 rounded-full bg-gray-100 text-gray-700 text-sm font-medium"
                >
                  {name ?? "Member"}
                </span>
              ))}
              {attendeeData.total > 20 && (
                <span className="text-sm text-gray-400 font-medium">
                  +{attendeeData.total - 20} more
                </span>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              <strong className="text-gray-900">{attendeeData.total}</strong>{" "}
              {attendeeData.total === 1 ? "person is" : "people are"} coming.{" "}
              <a href="/login" className="text-[#EE2A2E] hover:underline">Sign in</a> to see who.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
