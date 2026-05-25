"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { registerForEvent } from "@/lib/actions/event-registration";
import EventDateTile from "@/components/events/EventDateTile";
import LocalDate from "@/components/ui/LocalDate";
import type { EventWithOrgContext } from "@/lib/events/types";

interface EventCardProps {
  event: EventWithOrgContext;
  forYou?: boolean;
  isAuthenticated?: boolean;
}

export default function EventCard({ event, forYou = false, isAuthenticated = false }: EventCardProps) {
  const router    = useRouter();
  const [isPending, startTransition] = useTransition();
  const [optimisticStatus, setOptimisticStatus] = useState(event.user_registration_status);

  const isCSC        = event.creator_org_name === "Campus Stores Canada";
  const isVirtual    = event.is_virtual;
  const isPublic     = event.audience_mode === "public";
  const isBoardOnly  = event.audience_mode === "board";
  const regStatus    = optimisticStatus;
  const isRegistered = regStatus === "registered" || regStatus === "promoted" as any;
  const isWaitlisted = regStatus === "waitlisted";
  const meetLink     = event.virtual_link;
  const isPast       = new Date(event.starts_at) < new Date();
  const href         = `/events/${event.slug}`;

  const handleRegister = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isAuthenticated) { router.push(`/login?next=${encodeURIComponent(href)}`); return; }
    startTransition(async () => {
      const result = await registerForEvent(event.id);
      if (result.success) {
        setOptimisticStatus(result.result === "waitlisted" ? "waitlisted" : "registered");
      }
    });
  };

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => router.push(href)}
      onKeyDown={(e) => e.key === "Enter" && router.push(href)}
      className="group flex items-stretch gap-4 rounded-2xl border border-gray-200 bg-white hover:border-gray-300 hover:shadow-md transition-all p-4 cursor-pointer"
    >
      {/* Date tile */}
      <EventDateTile
        startsAt={event.starts_at}
        primaryColor={event.creator_primary_color}
        lat={event.creator_lat}
        lng={event.creator_lng}
        zoom={event.creator_zoom}
        size={96}
        isCSC={isCSC}
      />

      {/* Content */}
      <div className="flex-1 min-w-0 flex flex-col justify-between gap-2">
        {/* Top: badges + title */}
        <div>
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {forYou && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 ring-1 ring-teal-200">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
                For you
              </span>
            )}
            {isBoardOnly && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#163D6D]/10 text-[#163D6D]">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                </svg>
                Board Only
              </span>
            )}
            {!isPublic && !isBoardOnly && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                </svg>
                Members Only
              </span>
            )}
            {isVirtual && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-purple-50 text-purple-700">
                Virtual
              </span>
            )}
            {isRegistered && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-green-50 text-green-700">
                ✓ Registered
              </span>
            )}
            {isWaitlisted && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
                On Waitlist
              </span>
            )}
          </div>

          <h3 className="font-bold text-gray-900 group-hover:text-[#EE2A2E] transition-colors leading-snug">
            {event.title}
          </h3>

          {event.description && (
            <p className="text-sm text-gray-500 mt-1 line-clamp-2 leading-relaxed">
              {event.description}
            </p>
          )}
        </div>

        {/* Bottom: meta + CTA */}
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div className="space-y-0.5">
            <p className="text-xs text-gray-500"><LocalDate iso={event.starts_at} format="short" /></p>

            <p className="text-xs text-gray-400">
              Hosted by{" "}
              <span className="font-medium text-gray-600">
                {event.creator_display_name
                  ? `${event.creator_display_name} — ${event.creator_org_name}`
                  : event.creator_org_name}
              </span>
            </p>

            {!isVirtual && event.location && (
              <p className="text-xs text-gray-400 flex items-center gap-1">
                <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                {event.location}
              </p>
            )}

            {event.spots_remaining !== null && event.spots_remaining <= 10 && (
              <p className={`text-xs font-medium ${event.spots_remaining === 0 ? "text-red-600" : "text-amber-600"}`}>
                {event.spots_remaining === 0 ? "Full — waitlist available" : `${event.spots_remaining} spot${event.spots_remaining === 1 ? "" : "s"} left`}
              </p>
            )}
          </div>

          {/* CTA */}
          <div>
            {isPast ? (
              <span className="inline-flex items-center px-4 py-2 rounded-lg bg-gray-100 text-gray-500 text-xs font-bold">
                See Details
              </span>
            ) : isRegistered && isVirtual && meetLink ? (
              <a
                href={meetLink}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#EE2A2E] hover:bg-[#D92327] text-white text-xs font-bold transition-colors whitespace-nowrap"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.361a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2z" />
                </svg>
                Join Now
              </a>
            ) : isRegistered ? (
              <a
                href={href}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center px-4 py-2 rounded-lg border border-gray-200 text-gray-600 text-xs font-bold hover:border-gray-300 hover:bg-gray-50 transition-colors whitespace-nowrap"
              >
                See Details
              </a>
            ) : isWaitlisted ? (
              <span className="inline-flex items-center px-4 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs font-bold">
                On Waitlist
              </span>
            ) : (
              <button
                onClick={handleRegister}
                disabled={isPending}
                className="inline-flex items-center px-4 py-2 rounded-lg bg-[#EE2A2E] hover:bg-[#D92327] disabled:opacity-60 text-white text-xs font-bold transition-colors whitespace-nowrap"
              >
                {isPending ? "…" : event.spots_remaining === 0 ? "Join Waitlist" : "Register →"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
