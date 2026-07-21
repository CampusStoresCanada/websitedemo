"use client";

import { useEffect, useMemo, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import Link from "next/link";
import type { HomeMapOrg, MapStory, HomeConferencePin } from "@/lib/homepage";
import type { MapRef } from "./Map";
import { orgSubtitle } from "@/lib/explore/filters";

const STORY_CYCLE_MS = 9000;

const STORY_LABELS: Record<string, string> = {
  city_cluster: "Local Community",
  pos_ecosystem: "Shared Platform",
  institution_region: "Peer Institutions",
  category_region: "Category Focus",
  metric_region: "By the Numbers",
  partner_coverage: "Partner Network",
  shared_services: "Shared Services",
  shared_mandate: "Operating Model",
  member_spotlight: "Member Spotlight",
  partner_spotlight: "Partner Spotlight",
};

/** Reasonable venue-level zoom for the conference spotlight slide's camera pan. */
const CONFERENCE_ZOOM = 11;

interface MapAttractProps {
  organizations: HomeMapOrg[];
  stories: MapStory[];
  conferencePin: HomeConferencePin | null;
  explore: boolean;
  paused: boolean;
  storyIndex: number;
  setStoryIndex: Dispatch<SetStateAction<number>>;
  mapRef: RefObject<MapRef | null>;
  enterExplore: () => void;
  onMapMouseMove: () => void;
  onMapMouseLeave: () => void;
}

/**
 * Attract mode: the auto-cycling homepage hero — story cards, camera pans,
 * static headline/CTA, and (when a conference is published) a periodic
 * conference "spotlight slide" interleaved into the cycle.
 *
 * Never unmounts relative to <MapExplore> — both are always in the DOM,
 * toggled via opacity/pointer-events on this component's own root element
 * (same pattern MapHero used pre-split), so internal state (storyIndex,
 * the conference-slide counter) survives explore/attract transitions.
 */
export default function MapAttract({
  organizations,
  stories,
  conferencePin,
  explore,
  paused,
  storyIndex,
  setStoryIndex,
  mapRef,
  enterExplore,
  onMapMouseMove,
  onMapMouseLeave,
}: MapAttractProps) {
  const story = stories[storyIndex] ?? null;

  // Independent counter driving the conference-slide interleave — NOT
  // storyIndex itself. Every other advance (odd slotCounter), when a
  // conference pin exists, shows the conference slide instead of pulling
  // the next story; storyIndex only advances on the "story" slots so the
  // normal story sequence isn't skipped or disturbed.
  const [slotCounter, setSlotCounter] = useState(0);
  const isConferenceSlot = !!conferencePin && slotCounter % 2 === 1;

  // Story orgs for the attract-mode card
  const storyHighlighted = useMemo(() => {
    if (!story) return [];
    const orgMap = new globalThis.Map(organizations.map((o) => [o.id, o]));
    return story.highlightedOrgIds
      .map((id) => orgMap.get(id))
      .filter((o): o is HomeMapOrg => !!o)
      .slice(0, 5);
  }, [organizations, story]);

  // ---------------------------------------------------------------------------
  // Attract mode: camera pans + story/conference cycling
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (explore || !mapRef.current) return;
    if (isConferenceSlot && conferencePin) {
      mapRef.current.flyTo([conferencePin.lng, conferencePin.lat], CONFERENCE_ZOOM);
    } else if (story) {
      mapRef.current.flyTo([story.center.lng, story.center.lat], story.zoom);
    }
  }, [story, explore, isConferenceSlot, conferencePin, mapRef]);

  useEffect(() => {
    if (explore || paused || stories.length <= 1) return;
    const id = setTimeout(() => {
      setSlotCounter((c) => {
        const next = c + 1;
        // Odd slots show the conference spotlight (when available) instead
        // of pulling the next story — storyIndex is left untouched so the
        // same upcoming story is shown once the interleave returns to it.
        if (!(conferencePin && next % 2 === 1)) {
          setStoryIndex((si) => (si + 1) % stories.length);
        }
        return next;
      });
    }, STORY_CYCLE_MS);
    return () => clearTimeout(id);
  }, [stories.length, storyIndex, slotCounter, paused, explore, conferencePin, setStoryIndex]);

  const goToStory = (next: number) => {
    if (stories.length === 0) return;
    setStoryIndex((next + stories.length) % stories.length);
  };

  return (
    <div
      onMouseMove={onMapMouseMove}
      onMouseLeave={onMapMouseLeave}
      onClick={() => { if (!explore) enterExplore(); }}
      className={[
        "absolute inset-0 z-10 transition-opacity duration-500",
        explore ? "opacity-0 pointer-events-none" : "opacity-100 cursor-crosshair",
      ].join(" ")}
    >
      {/* Gradient overlay for readability */}
      <div className="absolute inset-0 bg-gradient-to-t from-white/80 via-white/35 to-transparent pointer-events-none" />

      {/* Story card — top right */}
      {isConferenceSlot && conferencePin ? (
        <div className="absolute top-6 right-6 z-20 w-[min(360px,calc(100vw-3rem))] rounded-2xl bg-white/95 backdrop-blur-sm border border-gray-200 shadow-xl p-5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs uppercase tracking-wide text-gray-500">
              {STORY_LABELS.metric_region}
            </p>
          </div>
          <h2 className="text-lg font-semibold text-gray-900">{conferencePin.name}</h2>
          <p className="mt-1.5 text-sm text-gray-600">
            {[conferencePin.venue, conferencePin.city].filter(Boolean).join(", ")}
          </p>
          <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-1">
            <p className="text-sm text-gray-700">{conferencePin.venue}</p>
            <p className="text-sm text-gray-700">
              {[conferencePin.city, conferencePin.province].filter(Boolean).join(", ")}
            </p>
          </div>
        </div>
      ) : story ? (
        <div className="absolute top-6 right-6 z-20 w-[min(360px,calc(100vw-3rem))] rounded-2xl bg-white/95 backdrop-blur-sm border border-gray-200 shadow-xl p-5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs uppercase tracking-wide text-gray-500">
              {STORY_LABELS[story.storyType] ?? story.storyType.replaceAll("_", " ")}
            </p>
            <span className="text-xs text-gray-400">
              {storyIndex + 1}/{stories.length}
            </span>
          </div>
          <h2 className="text-lg font-semibold text-gray-900">{story.title}</h2>
          <p className="mt-1.5 text-sm text-gray-600">{story.description}</p>

          {/* Common traits chips */}
          {story.commonTraits && story.commonTraits.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {story.commonTraits.map((trait) => (
                <span
                  key={trait}
                  className="inline-flex items-center rounded-md bg-red-50 border border-red-100 px-2 py-0.5 text-xs text-red-700"
                >
                  {trait}
                </span>
              ))}
            </div>
          )}

          {/* Spotlight detail — show real names, no blur */}
          {story.spotlight && (
            <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
              <p className="text-sm font-medium text-gray-900">
                {story.spotlight.name ?? "Organization"}
              </p>
              <p className="text-xs text-gray-600">
                {[story.spotlight.city, story.spotlight.province].filter(Boolean).join(", ")}
              </p>
              {(story.spotlight.fte || story.spotlight.posSystem) && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {story.spotlight.fte && (
                    <span className="rounded-md bg-gray-200/70 px-2 py-0.5 text-xs text-gray-700">
                      {story.spotlight.fte.toLocaleString()} FTE
                    </span>
                  )}
                  {story.spotlight.posSystem && (
                    <span className="rounded-md bg-gray-200/70 px-2 py-0.5 text-xs text-gray-700">
                      {story.spotlight.posSystem}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Highlighted org list (non-spotlight stories) */}
          {!story.spotlight && storyHighlighted.length > 0 && (
            <div className="mt-3 space-y-1.5 max-h-[200px] overflow-y-auto">
              {storyHighlighted.map((org) => (
                <div key={org.id} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <p className="text-sm font-medium text-gray-900">{org.name}</p>
                  <p className="text-xs text-gray-500">
                    {orgSubtitle(org) || "Member institution"}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Story navigation */}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => goToStory(storyIndex - 1)}
              className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-gray-400"
            >
              ←
            </button>
            <button
              type="button"
              onClick={() => goToStory(storyIndex + 1)}
              className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-gray-400"
            >
              →
            </button>
          </div>
        </div>
      ) : null}

      {/* Hero text — bottom left */}
      <div className="relative z-10 h-full flex flex-col justify-end pb-16 md:pb-24">
        <div className="max-w-7xl mx-auto px-6 w-full">
          <div className="max-w-3xl">
            {isConferenceSlot && conferencePin ? (
              <>
                <h1 className="text-5xl md:text-7xl font-bold text-[#1A1A1A] tracking-tight leading-[1.1] mb-6">
                  Canada Campus Store Conference
                </h1>
                <p className="text-xl md:text-2xl text-[#6B6B6B] leading-relaxed mb-8 max-w-xl">
                  The national association for campus stores and the partners who support them.
                </p>
                <div className="flex flex-col sm:flex-row gap-4">
                  <Link
                    href={conferencePin.href}
                    className="h-14 px-8 bg-[#EE2A2E] hover:bg-[#D92327] text-white text-lg font-medium rounded-full transition-all hover:shadow-lg hover:shadow-red-500/25 inline-flex items-center justify-center"
                  >
                    View Conference
                  </Link>
                </div>
              </>
            ) : (
              <>
                <h1 className="text-5xl md:text-7xl font-bold text-[#1A1A1A] tracking-tight leading-[1.1] mb-6">
                  Canada&apos;s Campus
                  <br />
                  Store Network
                </h1>
                <p className="text-xl md:text-2xl text-[#6B6B6B] leading-relaxed mb-8 max-w-xl">
                  The national association for campus stores and the partners who support them.
                </p>
                <div className="flex flex-col sm:flex-row gap-4">
                  <Link
                    href="/members"
                    className="h-14 px-8 bg-[#EE2A2E] hover:bg-[#D92327] text-white text-lg font-medium rounded-full transition-all hover:shadow-lg hover:shadow-red-500/25 inline-flex items-center justify-center"
                  >
                    Explore Members
                  </Link>
                  <Link
                    href="/partners"
                    className="h-14 px-8 bg-white hover:bg-slate-50 text-[#1A1A1A] text-lg font-medium rounded-full border border-[#E5E5E5] transition-all hover:border-[#D4D4D4] inline-flex items-center justify-center"
                  >
                    Explore Partners
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
