"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { HomeMapOrg, MapStory, HomeConferencePin } from "@/lib/homepage";
import type { HomeSlides } from "@/lib/homepage-slides";
import type { HeroAreaSettings } from "@/lib/hero-kinds";
import type { MapRef } from "./Map";
import type { ExploreLens } from "@/lib/explore/types";
import MapAttract from "./MapAttract";
import MapExplore, { type MapExploreEntrySeed } from "./MapExplore";

const MapComponent = dynamic(() => import("./Map"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-gradient-to-br from-slate-100 via-slate-50 to-slate-200 flex items-center justify-center">
      <div className="flex items-center gap-3">
        <div className="w-6 h-6 border-2 border-[#EE2A2E] border-t-transparent rounded-full animate-spin" />
        <span className="text-[#6B6B6B]">Loading map...</span>
      </div>
    </div>
  ),
});

const HOVER_DWELL_MS = 4000;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface MapHeroProps {
  organizations: HomeMapOrg[];
  stories: MapStory[];
  /** When provided, MapHero starts in persistent explore mode (for /members, /partners). */
  initialState?: {
    explore: boolean;
    viewMode: "map" | "table";
    lens: ExploreLens;
    focus?: "members" | "partners";
  };
  conferencePin?: HomeConferencePin | null;
  /** Generalized attract-mode slide data (conference/personalized/newest-org/sponsor). Omitted on persistent-mode pages (/members, /partners), which never render attract mode anyway. */
  slides?: HomeSlides | null;
  /** Admin-configured rotation settings (Hero Area admin page). Omitted on persistent-mode pages — falls back to DEFAULT_HERO_SETTINGS, which is never actually exercised there since attract mode's interleave effect never runs when explore starts true. */
  heroSettings?: HeroAreaSettings | null;
}

const EMPTY_SLIDES: HomeSlides = {
  conferencePin: null,
  newestOrgSlide: null,
  sponsorSlide: null,
  personalizedSlide: null,
};

/** Matches the DB defaults seeded in the hero_area_settings migration. */
const DEFAULT_HERO_SETTINGS: HeroAreaSettings = {
  cycleIntervalMs: 9000,
  kinds: {
    story: { enabled: true, weight: 4 },
    conference: { enabled: true, weight: 1 },
    personalized: { enabled: true, weight: 1 },
    newest_org: { enabled: true, weight: 1 },
    sponsor: { enabled: true, weight: 1 },
  },
};

/**
 * MapHero is a thin coordinator between two structurally different modes:
 * MapAttract (the auto-cycling homepage hero) and MapExplore (the member/
 * partner directory browser). It owns everything that must cross the seam
 * between them — the shared <Map>/mapRef (which must never unmount across
 * the attract↔explore transition), the `explore` mode flag, the
 * enterExplore/exitExplore transition functions, and the boundary state
 * both children read or write (mapHighlightedIds, selectedOrg/lens seeding,
 * viewMode). See the two children for what's cleanly single-mode.
 */
export default function MapHero({
  organizations,
  stories,
  initialState,
  conferencePin = null,
  slides = null,
  heroSettings = null,
}: MapHeroProps) {
  const mapRef = useRef<MapRef>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousBodyOverflowRef = useRef<string | null>(null);
  const exitedAtRef = useRef(0); // timestamp of last exit — cooldown guard
  const enterExploreRef = useRef<() => void>(() => {});

  // Persistent mode = initialState provided (e.g. /members, /partners pages)
  const persistent = !!initialState;

  // --- Core state shared across both modes ---
  const [explore, setExplore] = useState(persistent);
  const [paused, setPaused] = useState(persistent);
  const [storyIndex, setStoryIndex] = useState(0);
  const [pageReady, setPageReady] = useState(false);
  const [viewMode, setViewMode] = useState<"map" | "table">(initialState?.viewMode ?? "map");

  // Boundary channels into MapExplore (see MapExplore.tsx for why these
  // exist — enterExplore/exitExplore must stay here since they're the
  // shared transition functions, but the state they used to write directly
  // now lives inside MapExplore, so it's dispatched as one-shot commands).
  const [exploreEntrySeed, setExploreEntrySeed] = useState<MapExploreEntrySeed | null>(null);
  const [resetSeed, setResetSeed] = useState<number | null>(null);
  const [exploreHighlightedIds, setExploreHighlightedIds] = useState<string[]>([]);

  const story = stories[storyIndex] ?? null;

  // Map highlighted IDs: attract mode uses the active story, explore uses
  // its own filters — the one place both modes' highlight sets converge
  // before reaching <MapComponent highlightedOrgIds>.
  const mapHighlightedIds = useMemo(() => {
    if (!explore) return story?.highlightedOrgIds ?? [];
    return exploreHighlightedIds;
  }, [explore, story, exploreHighlightedIds]);

  // ---------------------------------------------------------------------------
  // Hover dwell → explore mode
  // ---------------------------------------------------------------------------

  const enterExplore = useCallback(() => {
    // Map the current story to a lens/filter seed for MapExplore to apply —
    // no camera change here (MapAttract owns the camera).
    const s = stories[storyIndex] ?? null;
    const seed: MapExploreEntrySeed = {};
    if (s) {
      const val = s.highlightValues?.[0] ?? null;
      switch (s.storyType) {
        case "pos_ecosystem":
          seed.lens = "pos_platform";
          if (val) seed.posFilter = val;
          break;
        case "shared_services":
          seed.lens = "services";
          if (val) seed.serviceFilter = val;
          break;
        case "shared_mandate":
          seed.lens = "operating_model";
          if (val) seed.mandateFilter = val;
          break;
        case "partner_coverage":
          seed.lens = "partner_category";
          if (val) seed.category = val;
          break;
        case "partner_spotlight":
          seed.lens = "partners";
          break;
        case "member_spotlight":
          seed.lens = "members";
          break;
        case "institution_region":
        case "category_region":
        case "metric_region":
        case "city_cluster":
        default:
          seed.lens = "members";
          break;
      }
      // Spotlight → select that org directly
      if ((s.storyType === "member_spotlight" || s.storyType === "partner_spotlight") && s.highlightedOrgIds.length > 0) {
        seed.selectOrgId = s.highlightedOrgIds[0];
      }
    }
    setExploreEntrySeed(seed);

    setExplore(true);
    setPaused(true);
    if (!persistent) {
      // Safety check: only lock scroll if the section is actually covering the viewport.
      // If the user scrolled away while the timer was running, abort the lock.
      if (sectionRef.current) {
        const rect = sectionRef.current.getBoundingClientRect();
        const viewH = window.innerHeight;
        // Section top must be within ~80px of the viewport top and cover most of the screen
        if (rect.top > 80 || rect.bottom < viewH * 0.5) return;
      }
      if (previousBodyOverflowRef.current === null) {
        previousBodyOverflowRef.current = document.body.style.overflow;
      }
      document.body.style.overflow = "hidden";
      window.dispatchEvent(
        new CustomEvent("mapExploreMode", { detail: { active: true } })
      );
    }
  }, [storyIndex, stories, persistent]);

  // Keep ref in sync so the timer always calls the latest enterExplore
  useEffect(() => {
    enterExploreRef.current = enterExplore;
  }, [enterExplore]);

  // Don't start the hover-to-explore timer until the page is fully loaded
  useEffect(() => {
    if (document.readyState === "complete") {
      setPageReady(true);
    } else {
      const onLoad = () => setPageReady(true);
      window.addEventListener("load", onLoad, { once: true });
      return () => window.removeEventListener("load", onLoad);
    }
  }, []);

  // Cancel the hover timer if the user scrolls away — never lock scroll with the map off-screen
  useEffect(() => {
    if (persistent) return;
    const cancelOnScroll = () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
        setPaused(false);
      }
    };
    window.addEventListener("scroll", cancelOnScroll, { passive: true });
    return () => window.removeEventListener("scroll", cancelOnScroll);
  }, [persistent]);

  const handleMapMouseMove = useCallback(() => {
    if (!pageReady || explore || persistent) return;
    setPaused(true);
    if (hoverTimerRef.current) return;
    if (Date.now() - exitedAtRef.current < 3000) return;
    hoverTimerRef.current = setTimeout(() => {
      hoverTimerRef.current = null;
      enterExploreRef.current();
    }, HOVER_DWELL_MS);
  }, [pageReady, explore, persistent]);

  const handleMapMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    if (!explore) setPaused(false);
  }, [explore]);

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      if (!persistent) {
        document.body.style.overflow = previousBodyOverflowRef.current ?? "";
        previousBodyOverflowRef.current = null;
        window.dispatchEvent(
          new CustomEvent("mapExploreMode", { detail: { active: false } })
        );
      }
    };
  }, [persistent]);

  // ---------------------------------------------------------------------------
  // Exit explore
  // ---------------------------------------------------------------------------

  const exitExplore = useCallback(() => {
    // Tell MapExplore to reset its own filter/selection state
    setResetSeed(Date.now());

    if (persistent && initialState) {
      // Persistent mode: reset to initial state, stay in explore
      setViewMode(initialState.viewMode);
      mapRef.current?.resetView();
    } else {
      // Normal mode: fully exit explore
      exitedAtRef.current = Date.now();
      setExplore(false);
      setPaused(false);
      setViewMode("map");
      document.body.style.overflow = previousBodyOverflowRef.current ?? "";
      previousBodyOverflowRef.current = null;
      mapRef.current?.resetView();
      window.dispatchEvent(
        new CustomEvent("mapExploreMode", { detail: { active: false } })
      );
    }
  }, [persistent, initialState]);

  useEffect(() => {
    if (!explore) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") exitExplore();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [explore, exitExplore]);

  // ---------------------------------------------------------------------------
  // Interactions
  // ---------------------------------------------------------------------------

  const handleMarkerClick = useCallback(
    (org: HomeMapOrg) => {
      if (!explore) enterExplore();
      // Layer the clicked org's selection on top of whatever enterExplore
      // itself just seeded (spotlight org, if any) — this dispatch always
      // wins because it runs after, in the same batched update.
      setExploreEntrySeed({ selectOrgId: org.id, closeFilterMenu: true });
      if (org.latitude != null && org.longitude != null) {
        mapRef.current?.flyTo([org.longitude, org.latitude], 10);
      }
    },
    [explore, enterExplore]
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <section
      ref={sectionRef}
      className={[
        "relative overflow-hidden",
        "transition-[height,margin-top] duration-700 ease-in-out",
        explore && !persistent
          ? "h-[calc(100vh+64px)] -mt-16 z-20" /* homepage attract→explore: slide behind nav */
          : explore && persistent
          ? "h-[calc(100vh-64px)]" /* /members, /partners: normal flow below nav */
          : "h-[calc(100vh-64px)] min-h-[620px] mt-0",
      ].join(" ")}
    >
      {/* Map layer — always in DOM, fades out in table mode */}
      <div className={[
        "absolute inset-0 z-0 transition-opacity duration-300",
        viewMode === "table" && explore ? "opacity-0 pointer-events-none" : "opacity-100",
      ].join(" ")}>
        <MapComponent
          ref={mapRef}
          organizations={organizations}
          highlightedOrgIds={mapHighlightedIds}
          onOrganizationClick={handleMarkerClick}
          conferencePin={conferencePin}
          freeScrollZoom={explore}
        />
      </div>

      {/* ================================================================= */}
      {/* ATTRACT — gradient, stories, hero text. Always in DOM, fades via  */}
      {/* opacity + pointer-events (see MapAttract's own root className).   */}
      {/* ================================================================= */}
      <MapAttract
        organizations={organizations}
        stories={stories}
        slides={slides ?? EMPTY_SLIDES}
        heroSettings={heroSettings ?? DEFAULT_HERO_SETTINGS}
        explore={explore}
        paused={paused}
        storyIndex={storyIndex}
        setStoryIndex={setStoryIndex}
        mapRef={mapRef}
        enterExplore={enterExplore}
        onMapMouseMove={handleMapMouseMove}
        onMapMouseLeave={handleMapMouseLeave}
      />

      {/* ================================================================= */}
      {/* EXPLORE — sidebar, table, close button. Always in DOM, fades via */}
      {/* translate/opacity (see MapExplore's own root elements).          */}
      {/* ================================================================= */}
      <MapExplore
        organizations={organizations}
        mapRef={mapRef}
        explore={explore}
        persistent={persistent}
        initialState={initialState}
        viewMode={viewMode}
        setViewMode={setViewMode}
        exitExplore={exitExplore}
        entrySeed={exploreEntrySeed}
        resetSeed={resetSeed}
        onHighlightedIdsChange={setExploreHighlightedIds}
      />
    </section>
  );
}
