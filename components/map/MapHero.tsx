"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import HoverCard from "./HoverCard";
import type { Organization } from "@/lib/database.types";
import type { MapRef } from "./Map";

// Dynamically import Map to avoid SSR issues with Mapbox
const Map = dynamic(() => import("./Map"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-gradient-to-br from-slate-100 via-slate-50 to-slate-200 flex items-center justify-center">
      <div className="flex items-center gap-3">
        <div className="w-6 h-6 border-2 border-[#D60001] border-t-transparent rounded-full animate-spin" />
        <span className="text-[#6B6B6B]">Loading map...</span>
      </div>
    </div>
  ),
});

interface MapHeroProps {
  organizations: Organization[];
}

// Attract mode settings
const CYCLE_INTERVAL = 5000; // Time to show each org before moving to next
const PAUSE_ON_INTERACTION = 8000; // How long to pause after user interaction
const INITIAL_DELAY = 3000; // Wait before starting attract mode

export default function MapHero({ organizations }: MapHeroProps) {
  const mapRef = useRef<MapRef>(null);
  const [featuredOrg, setFeaturedOrg] = useState<Organization | null>(null);
  const [hoveredOrg, setHoveredOrg] = useState<Organization | null>(null);
  const [isAttractMode, setIsAttractMode] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const currentIndexRef = useRef(0);
  const pauseTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Filter to only organizations that have coordinates
  const orgsWithCoords = organizations.filter((org) => {
    if (mapRef.current) {
      return mapRef.current.getCoordinatesForOrg(org) !== null;
    }
    // Fallback check without map ref
    return (
      (org.latitude && org.longitude) ||
      (org.city && org.province)
    );
  });

  // Shuffle array for variety (seeded by day so it's consistent for a session)
  const shuffledOrgs = useRef<Organization[]>([]);
  useEffect(() => {
    const shuffled = [...orgsWithCoords].sort(() => Math.random() - 0.5);
    shuffledOrgs.current = shuffled;
  }, [orgsWithCoords]);

  // Move to next organization in the cycle
  const cycleToNext = useCallback(() => {
    if (shuffledOrgs.current.length === 0) return;

    const nextIndex = (currentIndexRef.current + 1) % shuffledOrgs.current.length;
    currentIndexRef.current = nextIndex;

    const nextOrg = shuffledOrgs.current[nextIndex];
    setFeaturedOrg(nextOrg);

    // Fly to the organization
    if (mapRef.current) {
      const coords = mapRef.current.getCoordinatesForOrg(nextOrg);
      if (coords) {
        mapRef.current.flyTo(coords, 7);
      }
    }
  }, []);

  // Start attract mode after initial delay
  useEffect(() => {
    const startTimeout = setTimeout(() => {
      if (shuffledOrgs.current.length > 0) {
        cycleToNext();
      }
    }, INITIAL_DELAY);

    return () => clearTimeout(startTimeout);
  }, [cycleToNext]);

  // Main attract mode cycle
  useEffect(() => {
    if (!isAttractMode || isPaused || shuffledOrgs.current.length === 0) return;

    const interval = setInterval(() => {
      cycleToNext();
    }, CYCLE_INTERVAL);

    return () => clearInterval(interval);
  }, [isAttractMode, isPaused, cycleToNext]);

  // Handle user interaction - pause attract mode temporarily
  const handleUserInteraction = useCallback(() => {
    setIsPaused(true);

    // Clear existing timeout
    if (pauseTimeoutRef.current) {
      clearTimeout(pauseTimeoutRef.current);
    }

    // Resume after pause duration
    pauseTimeoutRef.current = setTimeout(() => {
      setIsPaused(false);
      // Reset view before resuming
      mapRef.current?.resetView();
      setFeaturedOrg(null);
    }, PAUSE_ON_INTERACTION);
  }, []);

  // Handle org hover from map
  const handleOrganizationHover = useCallback(
    (org: Organization | null) => {
      setHoveredOrg(org);
      if (org) {
        handleUserInteraction();
      }
    },
    [handleUserInteraction]
  );

  // Handle org click
  const handleOrganizationClick = useCallback(
    (org: Organization) => {
      handleUserInteraction();
      // Navigate to org profile page
      window.location.href = `/org/${org.slug}`;
    },
    [handleUserInteraction]
  );

  // The org to display in the card - hovered takes priority over featured
  const displayedOrg = hoveredOrg || featuredOrg;

  return (
    <section className="relative h-[calc(100vh-64px)] min-h-[600px]">
      {/* Map Background */}
      <div className="absolute inset-0">
        <Map
          ref={mapRef}
          organizations={organizations}
          onOrganizationClick={handleOrganizationClick}
          onOrganizationHover={handleOrganizationHover}
          highlightedOrgId={displayedOrg?.id || null}
        />
      </div>

      {/* Featured/Hover Card */}
      <HoverCard organization={displayedOrg} />

      {/* Attract Mode Indicator */}
      {isAttractMode && !isPaused && featuredOrg && (
        <div className="absolute top-4 left-4 flex items-center gap-2 bg-white/90 backdrop-blur-sm rounded-full px-4 py-2 shadow-sm">
          <div className="w-2 h-2 rounded-full bg-[#D60001] animate-pulse" />
          <span className="text-sm text-[#6B6B6B]">Exploring the network</span>
        </div>
      )}

      {/* Gradient overlay for text readability */}
      <div className="absolute inset-x-0 bottom-0 h-80 bg-gradient-to-t from-white via-white/80 to-transparent pointer-events-none" />

      {/* Hero Content */}
      <div className="relative h-full flex flex-col justify-end pb-16 md:pb-24 pointer-events-none">
        <div className="max-w-7xl mx-auto px-6 w-full">
          <div className="max-w-3xl pointer-events-auto">
            <h1 className="text-5xl md:text-7xl font-bold text-[#1A1A1A] tracking-tight leading-[1.1] mb-6">
              Canada&apos;s Campus
              <br />
              Store Network
            </h1>
            <p className="text-xl md:text-2xl text-[#6B6B6B] leading-relaxed mb-8 max-w-xl">
              Connecting campus stores coast-to-coast with resources,
              partnerships, and expertise.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <button className="h-14 px-8 bg-[#D60001] hover:bg-[#B00001] text-white text-lg font-medium rounded-full transition-all hover:shadow-lg hover:shadow-red-500/25">
                Explore the Network
              </button>
              <button className="h-14 px-8 bg-white hover:bg-slate-50 text-[#1A1A1A] text-lg font-medium rounded-full border border-[#E5E5E5] transition-all hover:border-[#D4D4D4]">
                Learn More
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 right-4 bg-white/90 backdrop-blur-sm rounded-lg px-4 py-2 flex items-center gap-4 text-sm shadow-sm">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-[#D60001]" />
          <span className="text-[#6B6B6B]">Members</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-[#3B82F6]" />
          <span className="text-[#6B6B6B]">Partners</span>
        </div>
      </div>
    </section>
  );
}
