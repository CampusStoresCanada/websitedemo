"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import type { Organization } from "@/lib/database.types";
import type { MapRef } from "./Map";
import Image from "next/image";

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

// Region definitions with center coordinates and zoom levels
const REGIONS: Record<string, { center: [number, number]; zoom: number; name: string }> = {
  "British Columbia": { center: [-123.5, 49.5], zoom: 5.5, name: "British Columbia" },
  "Alberta": { center: [-114.5, 53.5], zoom: 5.5, name: "Alberta" },
  "Saskatchewan": { center: [-106.5, 52.0], zoom: 5.5, name: "Saskatchewan" },
  "Manitoba": { center: [-98.0, 50.0], zoom: 5.5, name: "Manitoba" },
  "Ontario": { center: [-80.0, 44.5], zoom: 5.5, name: "Ontario" },
  "Quebec": { center: [-72.5, 47.0], zoom: 5.5, name: "Quebec" },
  "Atlantic": { center: [-63.5, 45.5], zoom: 5.5, name: "Atlantic Canada" }, // NB, NS, PEI, NL combined
};

// Map provinces to regions
const PROVINCE_TO_REGION: Record<string, string> = {
  "British Columbia": "British Columbia",
  "Alberta": "Alberta",
  "Saskatchewan": "Saskatchewan",
  "Manitoba": "Manitoba",
  "Ontario": "Ontario",
  "Quebec": "Quebec",
  "New Brunswick": "Atlantic",
  "Nova Scotia": "Atlantic",
  "Prince Edward Island": "Atlantic",
  "Newfoundland and Labrador": "Atlantic",
};

// Timing constants (in ms)
const WIDE_VIEW_DURATION = 3500;      // Time at wide establishing shot
const FLY_TO_REGION_DURATION = 2000;   // Animation time to fly to region
const REGION_SHOWCASE_DURATION = 6000; // Time showing the region with cards
const FLY_BACK_DURATION = 1500;        // Animation time to fly back
const PAUSE_DURATION = 2000;           // Breathing room between regions
const INITIAL_DELAY = 2000;            // Wait before starting

// Canada-wide view
const CANADA_CENTER: [number, number] = [-96, 56];
const CANADA_ZOOM = 3.2;

type AttractPhase = "wide" | "flying-to" | "showcasing" | "flying-back" | "pausing";

export default function MapHero({ organizations }: MapHeroProps) {
  const mapRef = useRef<MapRef>(null);
  const [phase, setPhase] = useState<AttractPhase>("wide");
  const [currentRegion, setCurrentRegion] = useState<string | null>(null);
  const [featuredOrgs, setFeaturedOrgs] = useState<Organization[]>([]);
  const [hoveredOrg, setHoveredOrg] = useState<Organization | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const regionIndexRef = useRef(0);
  const pauseTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Group organizations by region
  const orgsByRegion = useRef<Record<string, Organization[]>>({});

  useEffect(() => {
    const grouped: Record<string, Organization[]> = {};

    organizations.forEach((org) => {
      if (!org.province) return;
      const region = PROVINCE_TO_REGION[org.province];
      if (!region) return;

      // Check if org has coordinates
      const hasCoords = (org.latitude && org.longitude) || (org.city && org.province);
      if (!hasCoords) return;

      if (!grouped[region]) grouped[region] = [];
      grouped[region].push(org);
    });

    orgsByRegion.current = grouped;
  }, [organizations]);

  // Get regions that have orgs, shuffled
  const activeRegions = useRef<string[]>([]);
  useEffect(() => {
    const regions = Object.keys(orgsByRegion.current).filter(
      (r) => orgsByRegion.current[r].length > 0
    );
    // Shuffle
    activeRegions.current = regions.sort(() => Math.random() - 0.5);
  }, [organizations]);

  // Select random orgs from a region (up to 4)
  const selectOrgsFromRegion = useCallback((region: string): Organization[] => {
    const regionOrgs = orgsByRegion.current[region] || [];
    const shuffled = [...regionOrgs].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 4);
  }, []);

  // Main attract mode state machine
  useEffect(() => {
    if (isPaused || activeRegions.current.length === 0) return;

    let timeout: NodeJS.Timeout;

    switch (phase) {
      case "wide":
        // Show wide view, then transition to flying
        timeout = setTimeout(() => {
          const nextRegion = activeRegions.current[regionIndexRef.current];
          setCurrentRegion(nextRegion);
          setPhase("flying-to");

          // Start flying to region
          const regionData = REGIONS[nextRegion];
          if (regionData && mapRef.current) {
            mapRef.current.flyTo(regionData.center, regionData.zoom);
          }
        }, WIDE_VIEW_DURATION);
        break;

      case "flying-to":
        // Wait for fly animation, then show cards
        timeout = setTimeout(() => {
          if (currentRegion) {
            setFeaturedOrgs(selectOrgsFromRegion(currentRegion));
          }
          setPhase("showcasing");
        }, FLY_TO_REGION_DURATION);
        break;

      case "showcasing":
        // Show cards for a while, then fly back
        timeout = setTimeout(() => {
          setPhase("flying-back");
          setFeaturedOrgs([]);
          mapRef.current?.resetView();
        }, REGION_SHOWCASE_DURATION);
        break;

      case "flying-back":
        // Wait for fly back animation
        timeout = setTimeout(() => {
          setPhase("pausing");
          setCurrentRegion(null);
        }, FLY_BACK_DURATION);
        break;

      case "pausing":
        // Brief pause, then next region
        timeout = setTimeout(() => {
          regionIndexRef.current = (regionIndexRef.current + 1) % activeRegions.current.length;
          setPhase("wide");
        }, PAUSE_DURATION);
        break;
    }

    return () => clearTimeout(timeout);
  }, [phase, isPaused, currentRegion, selectOrgsFromRegion]);

  // Initial delay before starting
  useEffect(() => {
    const initialTimeout = setTimeout(() => {
      setPhase("wide");
    }, INITIAL_DELAY);

    return () => clearTimeout(initialTimeout);
  }, []);

  // Handle user interaction - pause attract mode
  const handleUserInteraction = useCallback(() => {
    setIsPaused(true);
    setFeaturedOrgs([]);

    if (pauseTimeoutRef.current) {
      clearTimeout(pauseTimeoutRef.current);
    }

    pauseTimeoutRef.current = setTimeout(() => {
      setIsPaused(false);
      mapRef.current?.resetView();
      setPhase("wide");
      setCurrentRegion(null);
    }, 10000); // Resume after 10 seconds of no interaction
  }, []);

  const handleOrganizationHover = useCallback(
    (org: Organization | null) => {
      setHoveredOrg(org);
      if (org) handleUserInteraction();
    },
    [handleUserInteraction]
  );

  const handleOrganizationClick = useCallback(
    (org: Organization) => {
      handleUserInteraction();
      window.location.href = `/org/${org.slug}`;
    },
    [handleUserInteraction]
  );

  // Get highlighted org IDs (featured + hovered)
  const highlightedIds = hoveredOrg
    ? [hoveredOrg.id]
    : featuredOrgs.map(o => o.id);

  return (
    <section className="relative h-[calc(100vh-64px)] min-h-[600px]">
      {/* Map Background */}
      <div className="absolute inset-0">
        <Map
          ref={mapRef}
          organizations={organizations}
          onOrganizationClick={handleOrganizationClick}
          onOrganizationHover={handleOrganizationHover}
          highlightedOrgId={highlightedIds[0] || null}
        />
      </div>

      {/* Region Label - shows during showcasing */}
      {phase === "showcasing" && currentRegion && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20 animate-in fade-in slide-in-from-top-4 duration-500">
          <div className="bg-white/95 backdrop-blur-sm rounded-full px-6 py-3 shadow-lg border border-white/50">
            <span className="text-lg font-semibold text-[#1A1A1A]">
              {REGIONS[currentRegion]?.name || currentRegion}
            </span>
          </div>
        </div>
      )}

      {/* Featured Org Cards - fan out from right side */}
      {phase === "showcasing" && featuredOrgs.length > 0 && (
        <div className="absolute top-24 right-6 z-20 flex flex-col gap-3">
          {featuredOrgs.map((org, index) => (
            <div
              key={org.id}
              className="animate-in fade-in slide-in-from-right-8 duration-500"
              style={{ animationDelay: `${index * 150}ms`, animationFillMode: 'both' }}
            >
              <OrgCard org={org} onClick={() => handleOrganizationClick(org)} />
            </div>
          ))}
        </div>
      )}

      {/* Hovered Org Card - when user hovers */}
      {hoveredOrg && !featuredOrgs.find(o => o.id === hoveredOrg.id) && (
        <div className="absolute top-24 right-6 z-30 animate-in fade-in slide-in-from-right-4 duration-200">
          <OrgCard org={hoveredOrg} onClick={() => handleOrganizationClick(hoveredOrg)} />
        </div>
      )}

      {/* Attract Mode Indicator */}
      {!isPaused && phase !== "wide" && (
        <div className="absolute top-4 left-4 flex items-center gap-2 bg-white/90 backdrop-blur-sm rounded-full px-4 py-2 shadow-sm z-10">
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

// Compact org card component
function OrgCard({ org, onClick }: { org: Organization; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="bg-white rounded-xl shadow-lg p-4 w-72 border border-[#E5E5E5] hover:shadow-xl hover:border-[#D4D4D4] transition-all text-left group"
    >
      <div className="flex items-center gap-3">
        {org.logo_url ? (
          <div className="w-12 h-12 rounded-lg bg-white border border-[#E5E5E5] flex items-center justify-center flex-shrink-0 overflow-hidden">
            <Image
              src={org.logo_url}
              alt={org.name}
              width={40}
              height={40}
              className="object-contain"
              unoptimized
            />
          </div>
        ) : (
          <div
            className={`w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0 ${
              org.type === "Member" ? "bg-[#D60001]" : "bg-[#3B82F6]"
            }`}
          >
            <span className="text-white font-bold">
              {org.name.split(" ").map((w) => w[0]).filter(Boolean).slice(0, 2).join("")}
            </span>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-[#1A1A1A] truncate text-sm group-hover:text-[#D60001] transition-colors">
            {org.name}
          </h3>
          <p className="text-xs text-[#6B6B6B] truncate">
            {org.city}{org.city && org.province ? ", " : ""}{org.province}
          </p>
        </div>
        <div
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            org.type === "Member" ? "bg-[#D60001]" : "bg-[#3B82F6]"
          }`}
        />
      </div>
    </button>
  );
}
