"use client";

import { useState, useMemo } from "react";
import EventCard from "@/components/events/EventCard";
import { MEMBER_ROLE_LABELS } from "@/lib/events/tags";
import type { EventWithOrgContext } from "@/lib/events/types";

interface EventsFilteredListProps {
  events: (EventWithOrgContext & {
    spots_remaining?: number | null;
    user_registration_status?: "registered" | "waitlisted" | "cancelled" | null;
  })[];
  isAuthenticated: boolean;
  userTags: string[];
  activeTab: "upcoming" | "past";
}

export default function EventsFilteredList({
  events,
  isAuthenticated,
  userTags,
  activeTab,
}: EventsFilteredListProps) {
  const [activeTag, setActiveTag] = useState<string | null>(null);

  // Derive which tags actually appear on these events — only show useful filters
  const availableTags = useMemo(() => {
    const tagCounts = new Map<string, number>();
    for (const event of events) {
      const meta = event.metadata as Record<string, unknown> | null;
      const tags = Array.isArray(meta?.tags) ? meta.tags as string[] : [];
      for (const t of tags) {
        tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
      }
    }
    // Sort by count desc, then alpha
    return [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag]) => tag);
  }, [events]);

  // Filter events by selected tag
  const filtered = useMemo(() => {
    if (!activeTag) return events;
    return events.filter((event) => {
      const meta = event.metadata as Record<string, unknown> | null;
      const tags = Array.isArray(meta?.tags) ? meta.tags as string[] : [];
      return tags.some((t) => t.toLowerCase() === activeTag.toLowerCase());
    });
  }, [events, activeTag]);

  // When available tags change (tab switch), reset filter if current tag gone
  const safeActiveTag =
    activeTag && availableTags.includes(activeTag) ? activeTag : null;

  const displayTag = safeActiveTag;

  function tagLabel(tag: string): string {
    return MEMBER_ROLE_LABELS[tag] ?? tag;
  }

  return (
    <div>
      {/* Tag filter strip — only shown if there are tags to filter by */}
      {availableTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-6">
          <button
            onClick={() => setActiveTag(null)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              !displayTag
                ? "bg-[#163D6D] text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            All
          </button>
          {availableTags.map((tag) => (
            <button
              key={tag}
              onClick={() => setActiveTag(tag === displayTag ? null : tag)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                displayTag === tag
                  ? "bg-[#163D6D] text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {tagLabel(tag)}
            </button>
          ))}
        </div>
      )}

      {/* Empty state after filtering */}
      {filtered.length === 0 && activeTag && (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg font-medium">No events tagged &ldquo;{tagLabel(activeTag)}&rdquo;</p>
          <button
            onClick={() => setActiveTag(null)}
            className="text-sm mt-2 text-[#163D6D] hover:underline"
          >
            Clear filter
          </button>
        </div>
      )}

      {/* Empty state for tab */}
      {events.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          {activeTab === "upcoming" ? (
            <>
              <p className="text-lg font-medium">No upcoming events</p>
              <p className="text-sm mt-1">Check back soon — new events are added regularly.</p>
            </>
          ) : (
            <>
              <p className="text-lg font-medium">No past events yet</p>
              <p className="text-sm mt-1">Attended events will appear here.</p>
            </>
          )}
        </div>
      )}

      {/* Event list */}
      {filtered.length > 0 && (
        <div className={`space-y-4 ${activeTab === "past" ? "opacity-80" : ""}`}>
          {filtered.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              isAuthenticated={isAuthenticated}
              forYou={
                activeTab === "upcoming" &&
                isAuthenticated &&
                (() => {
                  const meta = event.metadata as Record<string, unknown> | null;
                  const tags = Array.isArray(meta?.tags) ? meta.tags as string[] : [];
                  const userTagSet = new Set(userTags.map((t) => t.toLowerCase()));
                  return tags.some((t) => userTagSet.has(String(t).toLowerCase()));
                })()
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
