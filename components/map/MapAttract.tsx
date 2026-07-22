"use client";

import { useEffect, useMemo, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import Link from "next/link";
import type { HomeMapOrg, MapStory, HomeConferencePin } from "@/lib/homepage";
import type {
  HomeSlides,
  HomeNewestOrgSlide,
  HomeSponsorSlide,
  HomePersonalizedSlide,
} from "@/lib/homepage-slides";
import type { MapRef } from "./Map";
import { orgSubtitle } from "@/lib/explore/filters";
import { fieldProps } from "@/lib/editable-fields";

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

/** Reasonable venue/org-level zoom for a special slide's camera pan. */
const SPOTLIGHT_ZOOM = 11;

/**
 * The set of "special" attract-mode slide kinds, generalized from the
 * conference-only spotlight in Phase 1. Each variant carries its own source
 * data (HomeConferencePin / HomePersonalizedSlide / HomeNewestOrgSlide /
 * HomeSponsorSlide) tagged with `kind` so the render switch below is
 * exhaustively typed.
 */
export type SpecialSlide =
  | ({ kind: "conference" } & HomeConferencePin)
  | ({ kind: "personalized" } & HomePersonalizedSlide)
  | ({ kind: "newest_org" } & HomeNewestOrgSlide)
  | ({ kind: "sponsor" } & HomeSponsorSlide);

const SPECIAL_LABELS: Record<SpecialSlide["kind"], string> = {
  conference: STORY_LABELS.metric_region, // "By the Numbers" — unchanged from Phase 1
  personalized: "For You",
  newest_org: "New to the Network",
  sponsor: "Our Sponsors",
};

interface MapAttractProps {
  organizations: HomeMapOrg[];
  stories: MapStory[];
  slides: HomeSlides;
  explore: boolean;
  paused: boolean;
  storyIndex: number;
  setStoryIndex: Dispatch<SetStateAction<number>>;
  mapRef: RefObject<MapRef | null>;
  enterExplore: () => void;
  onMapMouseMove: () => void;
  onMapMouseLeave: () => void;
}

/** Format a `date`-typed (no time component) ISO string without a UTC-midnight day-shift. */
function formatJoinDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString("en-CA", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Attract mode: the auto-cycling homepage hero — story cards, camera pans,
 * static headline/CTA, and (when any are active) a periodic "special" slide
 * — conference / personalized match / newest member-or-partner / sponsor
 * showcase — interleaved into the cycle.
 *
 * Never unmounts relative to <MapExplore> — both are always in the DOM,
 * toggled via opacity/pointer-events on this component's own root element
 * (same pattern MapHero used pre-split), so internal state (storyIndex,
 * the special-slide counters) survives explore/attract transitions.
 */
export default function MapAttract({
  organizations,
  stories,
  slides,
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

  // Every real, currently-active special slide, in a fixed display order.
  // Absent data sources (null) are simply omitted — no placeholder/fake
  // content is ever synthesized here.
  const activeSpecials = useMemo<SpecialSlide[]>(() => {
    const list: SpecialSlide[] = [];
    if (slides.conferencePin) list.push({ kind: "conference", ...slides.conferencePin });
    if (slides.personalizedSlide) list.push({ kind: "personalized", ...slides.personalizedSlide });
    if (slides.newestOrgSlide) list.push({ kind: "newest_org", ...slides.newestOrgSlide });
    if (slides.sponsorSlide) list.push({ kind: "sponsor", ...slides.sponsorSlide });
    return list;
  }, [slides]);

  const orgById = useMemo(() => new globalThis.Map(organizations.map((o) => [o.id, o])), [organizations]);

  // Independent counters driving the special-slide interleave — NOT
  // storyIndex itself. Every other advance (odd slotCounter), when at least
  // one special slide is active, shows a special slide instead of pulling
  // the next story; storyIndex only advances on the "story" slots so the
  // normal story sequence isn't skipped or disturbed. specialSlotIndex
  // round-robins through activeSpecials across consecutive special-slot
  // showings — it advances once per special showing (never reset), so
  // repeated cycles work through conference → personalized → newest-org →
  // sponsor (whichever combination is active) rather than always repeating
  // the first one.
  const [slotCounter, setSlotCounter] = useState(0);
  const [specialSlotIndex, setSpecialSlotIndex] = useState(0);

  const isSpecialSlot = activeSpecials.length > 0 && slotCounter % 2 === 1;
  const activeSpecial = isSpecialSlot ? activeSpecials[specialSlotIndex % activeSpecials.length] : null;

  // Story orgs for the attract-mode card
  const storyHighlighted = useMemo(() => {
    if (!story) return [];
    return story.highlightedOrgIds
      .map((id) => orgById.get(id))
      .filter((o): o is HomeMapOrg => !!o)
      .slice(0, 5);
  }, [orgById, story]);

  // ---------------------------------------------------------------------------
  // Attract mode: camera pans + story/special cycling
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (explore || !mapRef.current) return;
    if (activeSpecial) {
      switch (activeSpecial.kind) {
        case "conference":
          mapRef.current.flyTo([activeSpecial.lng, activeSpecial.lat], SPOTLIGHT_ZOOM);
          break;
        case "newest_org":
          // No coords on this org — leave the camera wherever it last was
          // rather than flying to a bogus (0,0).
          if (activeSpecial.latitude != null && activeSpecial.longitude != null) {
            mapRef.current.flyTo([activeSpecial.longitude, activeSpecial.latitude], SPOTLIGHT_ZOOM);
          }
          break;
        case "personalized": {
          const matchOrg = orgById.get(activeSpecial.matchOrgId);
          if (matchOrg?.latitude != null && matchOrg?.longitude != null) {
            mapRef.current.flyTo([matchOrg.longitude, matchOrg.latitude], SPOTLIGHT_ZOOM);
          }
          break;
        }
        case "sponsor":
          // Multi-org showcase — no single obvious point to fly to; leave
          // the camera as-is rather than picking an arbitrary sponsor.
          break;
      }
    } else if (story) {
      mapRef.current.flyTo([story.center.lng, story.center.lat], story.zoom);
    }
  }, [story, explore, activeSpecial, orgById, mapRef]);

  useEffect(() => {
    if (explore || paused || stories.length <= 1) return;
    const id = setTimeout(() => {
      // Each setState call below is independent and top-level — not nested
      // inside another component's updater callback. Nesting setStoryIndex
      // (MapHero's setter) inside setSlotCounter's functional updater was
      // triggering React's "Cannot update a component while rendering a
      // different component" warning and dropping/misordering updates
      // (confirmed live: it silently skipped the newest-org special some
      // cycles). The effect already lists `slotCounter` as a dependency, so
      // the closed-over value here is always current — no functional
      // updater needed for it.
      const next = slotCounter + 1;
      const wasSpecial = activeSpecials.length > 0 && slotCounter % 2 === 1;
      const landsOnSpecial = activeSpecials.length > 0 && next % 2 === 1;

      setSlotCounter(next);
      // Odd slots show a special slide (when any are available) instead of
      // pulling the next story — storyIndex is left untouched so the same
      // upcoming story is shown once the interleave returns to it.
      if (!landsOnSpecial) {
        setStoryIndex((si) => (si + 1) % stories.length);
      }
      // Leaving a special slot (not landing on one) is when we advance the
      // round-robin — so the special slot we just showed uses
      // specialSlotIndex as-is, and the *next* special showing picks the
      // following one in activeSpecials.
      if (wasSpecial) {
        setSpecialSlotIndex((i) => i + 1);
      }
    }, STORY_CYCLE_MS);
    return () => clearTimeout(id);
  }, [stories.length, storyIndex, slotCounter, paused, explore, activeSpecials.length, setStoryIndex]);

  const goToStory = (next: number) => {
    if (stories.length === 0) return;
    setStoryIndex((next + stories.length) % stories.length);
  };

  // ---------------------------------------------------------------------------
  // Special-slide content (label / H1 / CTA) — placeholder-quality copy,
  // consistent with the conference slide's own placeholder precedent.
  // ---------------------------------------------------------------------------

  const specialCta = useMemo(() => {
    if (!activeSpecial) return null;
    switch (activeSpecial.kind) {
      case "conference":
        return { href: activeSpecial.ctaHref, label: activeSpecial.ctaLabel };
      case "personalized":
        return { href: `/org/${activeSpecial.matchOrgSlug}`, label: "View Match" };
      case "newest_org":
        return { href: `/org/${activeSpecial.slug}`, label: "View Profile" };
      case "sponsor":
        return { href: "/partnership", label: "Become a Sponsor" };
    }
  }, [activeSpecial]);

  const specialH1 = useMemo(() => {
    if (!activeSpecial) return null;
    switch (activeSpecial.kind) {
      case "conference":
        return activeSpecial.slideTitle;
      case "personalized":
        return activeSpecial.viewerOrgType === "member"
          ? "Suppliers Matched to You"
          : "Members Buying What You Sell";
      case "newest_org":
        return `Welcome, ${activeSpecial.name}`;
      case "sponsor":
        return "Thank You to Our Sponsors";
    }
  }, [activeSpecial]);

  // Conference is the one special kind backed by admin-editable site_content
  // (title/subtitle) — the rest keep the shared generic subtitle since no
  // per-kind content block exists for them yet.
  const specialSubtitle = useMemo(() => {
    if (!activeSpecial) return null;
    if (activeSpecial.kind === "conference") return activeSpecial.slideSubtitle;
    return "The national association for campus stores and the partners who support them.";
  }, [activeSpecial]);

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
      {activeSpecial ? (
        <div className="absolute top-6 right-6 z-20 w-[min(360px,calc(100vw-3rem))] rounded-2xl bg-white/95 backdrop-blur-sm border border-gray-200 shadow-xl p-5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs uppercase tracking-wide text-gray-500">
              {SPECIAL_LABELS[activeSpecial.kind]}
            </p>
          </div>

          {activeSpecial.kind === "conference" && (
            <>
              <h2 className="text-lg font-semibold text-gray-900">{activeSpecial.name}</h2>
              <p className="mt-1.5 text-sm text-gray-600">
                {[activeSpecial.venue, activeSpecial.city].filter(Boolean).join(", ")}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                  <p className="text-xl font-bold text-gray-900">{activeSpecial.boothCount}</p>
                  <p className="text-xs text-gray-500">Exhibitor Booths</p>
                </div>
                {activeSpecial.statValue && (
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                    <p
                      className="text-xl font-bold text-gray-900"
                      {...(activeSpecial.statContentId ? fieldProps("site_content", "title", activeSpecial.statContentId) : {})}
                    >
                      {activeSpecial.statValue}
                    </p>
                    <p
                      className="text-xs text-gray-500"
                      {...(activeSpecial.statContentId ? fieldProps("site_content", "subtitle", activeSpecial.statContentId) : {})}
                    >
                      {activeSpecial.statLabel}
                    </p>
                  </div>
                )}
              </div>
              {activeSpecial.includedItems.length > 0 && (
                <ul
                  className="mt-3 space-y-1"
                  {...(activeSpecial.includedContentId ? fieldProps("site_content", "body", activeSpecial.includedContentId) : {})}
                >
                  {activeSpecial.includedItems.map((item) => (
                    <li key={item} className="text-sm text-gray-700 flex items-start gap-1.5">
                      <span className="text-green-600 mt-0.5">✓</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {activeSpecial.kind === "personalized" && (
            <>
              <h2 className="text-lg font-semibold text-gray-900">{activeSpecial.matchOrgName}</h2>
              <p className="mt-1.5 text-sm text-gray-600">
                {activeSpecial.viewerOrgType === "member"
                  ? "A supplier matched to your buying categories"
                  : "A member buying in your category"}
              </p>
              <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-1">
                {activeSpecial.matchCategory && (
                  <span className="inline-flex items-center rounded-md bg-red-50 border border-red-100 px-2 py-0.5 text-xs text-red-700">
                    {activeSpecial.matchCategory}
                  </span>
                )}
                {activeSpecial.totalMatches > 1 && (
                  <p className="text-xs text-gray-500">
                    +{activeSpecial.totalMatches - 1} more match{activeSpecial.totalMatches - 1 === 1 ? "" : "es"}
                  </p>
                )}
              </div>
            </>
          )}

          {activeSpecial.kind === "newest_org" && (
            <>
              <h2 className="text-lg font-semibold text-gray-900">{activeSpecial.name}</h2>
              <p className="mt-1.5 text-sm text-gray-600">
                {[activeSpecial.city, activeSpecial.province].filter(Boolean).join(", ") || activeSpecial.type}
              </p>
              <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-1">
                <p className="text-sm text-gray-700">Joined {formatJoinDate(activeSpecial.membershipStartedAt)}</p>
              </div>
            </>
          )}

          {activeSpecial.kind === "sponsor" && (
            <>
              <h2 className="text-lg font-semibold text-gray-900">
                {activeSpecial.sponsors.length} active sponsor{activeSpecial.sponsors.length === 1 ? "" : "s"}
              </h2>
              <p className="mt-1.5 text-sm text-gray-600">Supporting the campus store network</p>
              <div className="mt-3 space-y-1.5 max-h-[200px] overflow-y-auto">
                {activeSpecial.sponsors.map((s) => (
                  <div key={s.organizationId} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-900">{s.organizationName}</p>
                    <span className="text-xs text-gray-500">{s.tierName}</span>
                  </div>
                ))}
              </div>
            </>
          )}
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
            {activeSpecial && specialCta ? (
              <>
                <h1
                  className="text-5xl md:text-7xl font-bold text-[#1A1A1A] tracking-tight leading-[1.1] mb-6"
                  {...(activeSpecial.kind === "conference" && activeSpecial.slideContentId
                    ? fieldProps("site_content", "title", activeSpecial.slideContentId)
                    : {})}
                >
                  {specialH1}
                </h1>
                <p className="text-xl md:text-2xl text-[#6B6B6B] leading-relaxed mb-8 max-w-xl">
                  {specialSubtitle}
                </p>
                <div className="flex flex-col sm:flex-row gap-4">
                  <Link
                    href={specialCta.href}
                    className="h-14 px-8 bg-[#EE2A2E] hover:bg-[#D92327] text-white text-lg font-medium rounded-full transition-all hover:shadow-lg hover:shadow-red-500/25 inline-flex items-center justify-center"
                  >
                    {specialCta.label}
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
