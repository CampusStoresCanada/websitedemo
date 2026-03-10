"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useAuth } from "@/components/providers/AuthProvider";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/client";
import type { HomeMapOrg, MapStory } from "@/lib/homepage";
import type { MapRef } from "./Map";
import type { ExploreLens, ScaleRange, CompoundFilters } from "@/lib/explore/types";
import { SCALE_RANGES } from "@/lib/explore/types";
import { orgSubtitle, hasActiveCompounds } from "@/lib/explore/filters";
import { CompoundFilterBar } from "@/components/explore/CompoundFilterBar";
import { OrgDetailPanel } from "@/components/explore/OrgDetailPanel";
import { GroupSummary } from "@/components/explore/GroupSummary";

const MapComponent = dynamic(() => import("./Map"), {
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

const DirectoryTable = dynamic(
  () => import("@/components/directory/DirectoryTable"),
  { ssr: false }
);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORY_CYCLE_MS = 9000;
const HOVER_DWELL_MS = 2000;

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

// Types (ExploreLens, ScaleRange, SCALE_RANGES) and orgSubtitle() imported from shared modules

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
  };
}

export default function MapHero({
  organizations,
  stories,
  initialState,
}: MapHeroProps) {
  const { user, permissionState } = useAuth();
  const isMember = !!user && hasPermission(permissionState, "member");
  const mapRef = useRef<MapRef>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitedAtRef = useRef(0); // timestamp of last exit — cooldown guard
  const enterExploreRef = useRef<() => void>(() => {});

  // Persistent mode = initialState provided (e.g. /members, /partners pages)
  const persistent = !!initialState;

  // --- Core state ---
  const [explore, setExplore] = useState(persistent);
  const [storyIndex, setStoryIndex] = useState(0);
  const [paused, setPaused] = useState(persistent);

  // --- Explore state ---
  const [lens, setLens] = useState<ExploreLens>(initialState?.lens ?? null);
  const [scaleFilter, setScaleFilter] = useState<ScaleRange | null>(null);
  const [posFilter, setPosFilter] = useState<string | null>(null);
  const [serviceFilter, setServiceFilter] = useState<string | null>(null);
  const [mandateFilter, setMandateFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedOrg, setSelectedOrg] = useState<HomeMapOrg | null>(null);

  // --- Compound cross-lens filters ---
  const [compoundFilters, setCompoundFilters] = useState<{
    province?: string;
    scaleRange?: ScaleRange;
    pos?: string;
    service?: string;
    mandate?: string;
  }>({});
  const [showFilterMenu, setShowFilterMenu] = useState(false);

  // --- View mode: map or table ---
  const [viewMode, setViewMode] = useState<"map" | "table">(initialState?.viewMode ?? "map");

  // --- Primary contact for selected org (fetched on-demand) ---
  const [contactForOrg, setContactForOrg] = useState<{
    name: string;
    roleTitle: string | null;
    email: string | null;
    phone: string | null;
    avatarUrl: string | null;
  } | null>(null);

  useEffect(() => {
    if (!selectedOrg) {
      setContactForOrg(null);
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("contacts")
      .select("name, role_title, work_email, email, work_phone_number, phone, profile_picture_url")
      .eq("organization_id", selectedOrg.id)
      .is("archived_at", null)
      .order("name")
      .limit(1)
      .then(({ data }) => {
        if (cancelled) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const row = (data as any)?.[0];
        if (row) {
          setContactForOrg({
            name: row.name ?? "Unknown",
            roleTitle: row.role_title ?? null,
            email: row.work_email || row.email || null,
            phone: row.work_phone_number || row.phone || null,
            avatarUrl: row.profile_picture_url ?? null,
          });
        } else {
          setContactForOrg(null);
        }
      });
    return () => { cancelled = true; };
  }, [selectedOrg?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const story = stories[storyIndex] ?? null;

  // --- Derived data ---
  const members = useMemo(
    () => organizations.filter((o) => o.type === "Member"),
    [organizations]
  );
  const partners = useMemo(
    () => organizations.filter((o) => o.type === "Vendor Partner"),
    [organizations]
  );
  const provinceCount = useMemo(() => {
    const set = new Set(
      organizations.map((o) => o.province).filter((p) => p && p !== "Out of Canada")
    );
    return set.size;
  }, [organizations]);

  const scaleCounts = useMemo(() => {
    const counts: Record<ScaleRange, number> = { small: 0, medium: 0, large: 0, xlarge: 0 };
    for (const org of members) {
      if (org.enrollmentFte == null) continue;
      for (const range of SCALE_RANGES) {
        if (org.enrollmentFte >= range.min && org.enrollmentFte <= range.max) {
          counts[range.key]++;
          break;
        }
      }
    }
    return counts;
  }, [members]);

  const membersWithFte = useMemo(
    () => members.filter((o) => o.enrollmentFte != null).length,
    [members]
  );

  // POS system counts (two-level: system → orgs)
  const posCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const org of members) {
      if (org.posSystem) counts[org.posSystem] = (counts[org.posSystem] || 0) + 1;
    }
    return counts;
  }, [members]);

  const membersWithPos = useMemo(
    () => members.filter((o) => o.posSystem != null).length,
    [members]
  );

  // Services offered counts (two-level: service → orgs)
  const serviceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const org of members) {
      if (org.servicesOffered) {
        for (const svc of org.servicesOffered) {
          counts[svc] = (counts[svc] || 0) + 1;
        }
      }
    }
    return counts;
  }, [members]);

  const membersWithServices = useMemo(
    () => members.filter((o) => o.servicesOffered != null && o.servicesOffered.length > 0).length,
    [members]
  );

  // Operating model counts (two-level: mandate → orgs)
  const mandateCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const org of members) {
      if (org.operationsMandate) counts[org.operationsMandate] = (counts[org.operationsMandate] || 0) + 1;
    }
    return counts;
  }, [members]);

  const membersWithMandate = useMemo(
    () => members.filter((o) => o.operationsMandate != null).length,
    [members]
  );

  // --- Unique values for compound filter dropdowns ---
  const uniqueProvinces = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const org of organizations) {
      if (org.province && org.province !== "Out of Canada") {
        counts[org.province] = (counts[org.province] || 0) + 1;
      }
    }
    return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
  }, [organizations]);

  // --- Compute filtered orgs and map highlights based on explore state ---
  const { filteredOrgs, highlightedIds } = useMemo(() => {
    if (selectedOrg && viewMode !== "table") {
      return { filteredOrgs: [] as HomeMapOrg[], highlightedIds: [selectedOrg.id] };
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      let pool = organizations.filter(
        (o) =>
          o.name.toLowerCase().includes(q) ||
          (o.city && o.city.toLowerCase().includes(q)) ||
          (o.province && o.province.toLowerCase().includes(q))
      );
      // Apply compound filters even on search results
      if (compoundFilters.province) pool = pool.filter((o) => o.province === compoundFilters.province);
      return { filteredOrgs: pool, highlightedIds: pool.map((o) => o.id) };
    }

    // Start with lens-based pool
    let pool: HomeMapOrg[];
    switch (lens) {
      case "members":
        pool = [...members]; break;
      case "partners":
        pool = [...partners]; break;
      case "scale":
        if (scaleFilter) {
          const range = SCALE_RANGES.find((r) => r.key === scaleFilter)!;
          pool = members.filter(
            (o) => o.enrollmentFte != null && o.enrollmentFte >= range.min && o.enrollmentFte <= range.max
          );
        } else {
          pool = members.filter((o) => o.enrollmentFte != null);
        }
        break;
      case "pos_platform":
        if (posFilter) {
          pool = members.filter((o) => o.posSystem === posFilter);
        } else {
          pool = members.filter((o) => o.posSystem != null);
        }
        break;
      case "services":
        if (serviceFilter) {
          pool = members.filter((o) => o.servicesOffered?.includes(serviceFilter));
        } else {
          pool = members.filter((o) => o.servicesOffered != null && o.servicesOffered.length > 0);
        }
        break;
      case "operating_model":
        if (mandateFilter) {
          pool = members.filter((o) => o.operationsMandate === mandateFilter);
        } else {
          pool = members.filter((o) => o.operationsMandate != null);
        }
        break;
      default:
        pool = [...organizations];
        break;
    }

    // Apply compound cross-lens filters (skip if same dimension as primary lens)
    if (compoundFilters.province) pool = pool.filter((o) => o.province === compoundFilters.province);
    if (compoundFilters.pos && lens !== "pos_platform") pool = pool.filter((o) => o.posSystem === compoundFilters.pos);
    if (compoundFilters.service && lens !== "services") pool = pool.filter((o) => o.servicesOffered?.includes(compoundFilters.service!));
    if (compoundFilters.mandate && lens !== "operating_model") pool = pool.filter((o) => o.operationsMandate === compoundFilters.mandate);
    if (compoundFilters.scaleRange && lens !== "scale") {
      const range = SCALE_RANGES.find((r) => r.key === compoundFilters.scaleRange)!;
      pool = pool.filter((o) => o.enrollmentFte != null && o.enrollmentFte >= range.min && o.enrollmentFte <= range.max);
    }
    if (compoundFilters.payment) pool = pool.filter((o) => o.paymentOptions?.includes(compoundFilters.payment!));
    if (compoundFilters.shopping) pool = pool.filter((o) => o.shoppingServices?.includes(compoundFilters.shopping!));

    return { filteredOrgs: pool, highlightedIds: pool.map((o) => o.id) };
  }, [organizations, members, partners, lens, scaleFilter, posFilter, serviceFilter, mandateFilter, searchQuery, selectedOrg, compoundFilters, viewMode]);

  // Map highlighted IDs: attract mode uses stories, explore uses filters
  const mapHighlightedIds = useMemo(() => {
    if (!explore) return story?.highlightedOrgIds ?? [];
    return highlightedIds;
  }, [explore, story, highlightedIds]);

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
  // Attract mode: story cycling
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (explore || !story || !mapRef.current) return;
    mapRef.current.flyTo([story.center.lng, story.center.lat], story.zoom);
  }, [story, explore]);

  useEffect(() => {
    if (explore || paused || stories.length <= 1) return;
    const id = setTimeout(() => {
      setStoryIndex((c) => (c + 1) % stories.length);
    }, STORY_CYCLE_MS);
    return () => clearTimeout(id);
  }, [stories.length, storyIndex, paused, explore]);

  const goToStory = (next: number) => {
    if (stories.length === 0) return;
    setStoryIndex((next + stories.length) % stories.length);
  };

  // ---------------------------------------------------------------------------
  // Hover dwell → explore mode
  // ---------------------------------------------------------------------------

  const enterExplore = useCallback(() => {
    // Map the current story to real lens/filters — no camera change
    const s = stories[storyIndex] ?? null;
    if (s) {
      const val = s.highlightValues?.[0] ?? null;
      switch (s.storyType) {
        case "pos_ecosystem":
          setLens("pos_platform");
          if (val) setPosFilter(val);
          break;
        case "shared_services":
          setLens("services");
          if (val) setServiceFilter(val);
          break;
        case "shared_mandate":
          setLens("operating_model");
          if (val) setMandateFilter(val);
          break;
        case "partner_coverage":
        case "partner_spotlight":
          setLens("partners");
          break;
        case "member_spotlight":
          setLens("members");
          break;
        case "institution_region":
        case "category_region":
        case "metric_region":
        case "city_cluster":
        default:
          setLens("members");
          break;
      }
      // Spotlight → select that org directly
      if ((s.storyType === "member_spotlight" || s.storyType === "partner_spotlight") && s.highlightedOrgIds.length > 0) {
        const orgMap = new globalThis.Map(organizations.map((o) => [o.id, o]));
        const spotlightOrg = orgMap.get(s.highlightedOrgIds[0]);
        if (spotlightOrg) setSelectedOrg(spotlightOrg);
      }
    }

    setExplore(true);
    setPaused(true);
    if (!persistent) {
      document.body.style.overflow = "hidden";
      window.dispatchEvent(
        new CustomEvent("mapExploreMode", { detail: { active: true } })
      );
    }
  }, [storyIndex, stories, organizations, persistent]);

  // Keep ref in sync so the timer always calls the latest enterExplore
  enterExploreRef.current = enterExplore;

  const handleMapMouseMove = useCallback(() => {
    if (explore || persistent) return;
    setPaused(true);
    if (hoverTimerRef.current) return;
    if (Date.now() - exitedAtRef.current < 3000) return;
    hoverTimerRef.current = setTimeout(() => {
      hoverTimerRef.current = null;
      enterExploreRef.current();
    }, HOVER_DWELL_MS);
  }, [explore, persistent]);

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
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Exit explore
  // ---------------------------------------------------------------------------

  const exitExplore = useCallback(() => {
    // Reset filters / selection
    setSelectedOrg(null);
    setSearchQuery("");
    setScaleFilter(null);
    setPosFilter(null);
    setServiceFilter(null);
    setMandateFilter(null);
    setCompoundFilters({});
    setShowFilterMenu(false);

    if (persistent && initialState) {
      // Persistent mode: reset to initial state, stay in explore
      setLens(initialState.lens);
      setViewMode(initialState.viewMode);
      mapRef.current?.resetView();
    } else {
      // Normal mode: fully exit explore
      exitedAtRef.current = Date.now();
      setExplore(false);
      setPaused(false);
      setLens(null);
      setViewMode("map");
      document.body.style.overflow = "";
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
      setSelectedOrg(org);
      setShowFilterMenu(false);
      // Fly to the selected org
      if (org.latitude != null && org.longitude != null) {
        mapRef.current?.flyTo([org.longitude, org.latitude], 10);
      }
    },
    [explore, enterExplore]
  );

  const handleOrgClick = useCallback((org: HomeMapOrg) => {
    setSelectedOrg(org);
    setShowFilterMenu(false);
    // Fly to the selected org
    if (org.latitude != null && org.longitude != null) {
      mapRef.current?.flyTo([org.longitude, org.latitude], 10);
    }
  }, []);

  /** Drill from a profile value — additive: drops lens, merges into compound filters */
  const handleFilterByValue = useCallback((_filterLens: ExploreLens, filters: CompoundFilters) => {
    setSelectedOrg(null);
    setShowFilterMenu(false);
    // Drop lens and all sub-filters — go to compound-only mode
    setLens(null);
    setScaleFilter(null);
    setPosFilter(null);
    setServiceFilter(null);
    setMandateFilter(null);
    // Merge new filter into existing compound filters (additive AND)
    setCompoundFilters((prev) => ({ ...prev, ...filters }));
  }, []);

  /** Go back one level in the sidebar navigation stack. */
  const goBack = useCallback(() => {
    if (selectedOrg) {
      setSelectedOrg(null);
    } else if (scaleFilter) {
      setScaleFilter(null);
      setCompoundFilters({});
    } else if (posFilter) {
      setPosFilter(null);
      setCompoundFilters({});
    } else if (serviceFilter) {
      setServiceFilter(null);
      setCompoundFilters({});
    } else if (mandateFilter) {
      setMandateFilter(null);
      setCompoundFilters({});
    } else if (lens || searchQuery) {
      setLens(null);
      setSearchQuery("");
      setCompoundFilters({});
      setShowFilterMenu(false);
    } else if (hasActiveCompounds(compoundFilters)) {
      // Compound-only mode — clear all compound filters
      setCompoundFilters({});
      setShowFilterMenu(false);
    }
  }, [selectedOrg, scaleFilter, posFilter, serviceFilter, mandateFilter, lens, searchQuery, compoundFilters]);

  /** Jump straight back to the discovery menu (lens picker). */
  const goHome = useCallback(() => {
    setSelectedOrg(null);
    setLens(null);
    setSearchQuery("");
    setScaleFilter(null);
    setPosFilter(null);
    setServiceFilter(null);
    setMandateFilter(null);
    setCompoundFilters({});
    setShowFilterMenu(false);
  }, []);

  // ---------------------------------------------------------------------------
  // Breadcrumb segments — each is { label, action } where action jumps to that level
  // ---------------------------------------------------------------------------

  const LENS_LABELS: Record<string, string> = {
    members: "Members",
    partners: "Partners",
    scale: "By Scale",
    pos_platform: "Same Platform",
    services: "Services Offered",
    operating_model: "Operating Model",
  };

  const breadcrumbs = useMemo(() => {
    const crumbs: { label: string; action: () => void }[] = [];

    // Lens level
    if (lens) {
      crumbs.push({
        label: LENS_LABELS[lens] ?? lens,
        action: () => {
          setSelectedOrg(null);
          setScaleFilter(null);
          setPosFilter(null);
          setServiceFilter(null);
          setMandateFilter(null);
          setCompoundFilters({});
        },
      });
    } else if (searchQuery) {
      crumbs.push({
        label: `"${searchQuery.slice(0, 20)}${searchQuery.length > 20 ? "…" : ""}"`,
        action: () => { setSelectedOrg(null); },
      });
    } else if (hasActiveCompounds(compoundFilters)) {
      crumbs.push({
        label: "Filtered Results",
        action: () => { setSelectedOrg(null); },
      });
    }

    // Sub-filter level
    if (lens === "scale" && scaleFilter) {
      const range = SCALE_RANGES.find((r) => r.key === scaleFilter);
      crumbs.push({ label: range?.label ?? scaleFilter, action: () => { setSelectedOrg(null); } });
    } else if (lens === "pos_platform" && posFilter) {
      crumbs.push({ label: posFilter, action: () => { setSelectedOrg(null); } });
    } else if (lens === "services" && serviceFilter) {
      crumbs.push({ label: serviceFilter, action: () => { setSelectedOrg(null); } });
    } else if (lens === "operating_model" && mandateFilter) {
      crumbs.push({ label: mandateFilter, action: () => { setSelectedOrg(null); } });
    }

    // Org level
    if (selectedOrg) {
      crumbs.push({ label: selectedOrg.name, action: () => {} }); // current — no action
    }

    return crumbs;
  }, [lens, scaleFilter, posFilter, serviceFilter, mandateFilter, selectedOrg, searchQuery, compoundFilters]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasNavContext = breadcrumbs.length > 0;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <section
      className={[
        "relative overflow-hidden",
        "transition-[height,margin-top] duration-700 ease-in-out",
        explore
          ? "h-[calc(100vh+64px)] -mt-16 z-20" /* slide up behind nav + extend past fold */
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
          freeScrollZoom={explore}
        />
      </div>

      {/* ================================================================= */}
      {/* ATTRACT OVERLAYS — gradient, stories, hero text                   */}
      {/* Always in DOM, fade via opacity + pointer-events                  */}
      {/* The overlay captures mouse events to trigger explore mode.         */}
      {/* ================================================================= */}
      <div
        onMouseMove={handleMapMouseMove}
        onMouseLeave={handleMapMouseLeave}
        onClick={() => { if (!explore) enterExplore(); }}
        className={[
          "absolute inset-0 z-10 transition-opacity duration-500",
          explore ? "opacity-0 pointer-events-none" : "opacity-100 cursor-pointer",
        ].join(" ")}
      >
        {/* Gradient overlay for readability */}
        <div className="absolute inset-0 bg-gradient-to-t from-white via-white/75 to-white/15 pointer-events-none" />

        {/* Story card — top right */}
        {story && (
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
        )}

        {/* Hero text — bottom left */}
        <div className="relative z-10 h-full flex flex-col justify-end pb-16 md:pb-24">
          <div className="max-w-7xl mx-auto px-6 w-full">
            <div className="max-w-3xl">
              <h1 className="text-5xl md:text-7xl font-bold text-[#1A1A1A] tracking-tight leading-[1.1] mb-6">
                Canada&apos;s Campus
                <br />
                Store Network
              </h1>
              <p className="text-xl md:text-2xl text-[#6B6B6B] leading-relaxed mb-8 max-w-xl">
                Hover over the map to explore the network, or browse
                our members and partners below.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Link
                  href="/members"
                  className="h-14 px-8 bg-[#D60001] hover:bg-[#B00001] text-white text-lg font-medium rounded-full transition-all hover:shadow-lg hover:shadow-red-500/25 inline-flex items-center justify-center"
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
            </div>
          </div>
        </div>
      </div>

      {/* ================================================================= */}
      {/* EXPLORE SIDEBAR — slides in from left; slides out in table mode  */}
      {/* ================================================================= */}
      <div
        className={[
          "absolute top-0 left-0 bottom-0 z-30",
          "bg-white/95 backdrop-blur-md border-r border-gray-200 shadow-2xl",
          "flex flex-col isolate",
          "transition-all duration-500 ease-in-out",
          explore ? "translate-x-0" : "-translate-x-full",
          "w-[380px] max-w-[85vw]",
        ].join(" ")}
      >
        {/* ------ Sidebar header ------ */}
        <div className="flex-shrink-0 pt-20 px-5 pb-4 border-b border-gray-100">
          {/* Top row: home + breadcrumbs + close */}
          <div className="flex items-center justify-between mb-4 gap-2">
            <div className="flex items-center gap-1 min-w-0 flex-1">
              {/* Home / title */}
              {hasNavContext ? (
                <button
                  type="button"
                  onClick={goHome}
                  className="flex-shrink-0 text-gray-400 hover:text-[#D60001] transition-colors"
                  title="Back to Explore menu"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4" />
                  </svg>
                </button>
              ) : (
                <h2 className="text-lg font-semibold text-gray-900">Explore</h2>
              )}

              {/* Breadcrumb segments */}
              {breadcrumbs.map((crumb, i) => {
                const isLast = i === breadcrumbs.length - 1;
                return (
                  <span key={i} className="flex items-center gap-1 min-w-0">
                    <svg className="w-3 h-3 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    {isLast ? (
                      <span className="text-sm font-semibold text-gray-900 truncate max-w-[180px]">
                        {crumb.label}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={crumb.action}
                        className="text-sm text-gray-500 hover:text-[#D60001] transition-colors truncate max-w-[120px]"
                      >
                        {crumb.label}
                      </button>
                    )}
                  </span>
                );
              })}
            </div>

            <div className="flex items-center gap-1.5 flex-shrink-0">
              {/* Table / Map toggle */}
              <button
                type="button"
                onClick={() => setViewMode(viewMode === "map" ? "table" : "map")}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 hover:text-gray-700 transition-colors"
                title={viewMode === "map" ? "Switch to table view" : "Switch to map view"}
              >
                {viewMode === "map" ? (
                  /* Table grid icon */
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M3 9h18M3 15h18M9 3v18" />
                  </svg>
                ) : (
                  /* Map icon */
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
                  </svg>
                )}
              </button>

              {/* Close button */}
              <button
                type="button"
                onClick={exitExplore}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 hover:text-gray-700 transition-colors"
                title="Close (Esc)"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Search — always visible in sidebar header */}
          {!selectedOrg && (
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search organizations..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSelectedOrg(null);
                  if (e.target.value.trim()) {
                    setLens(null);
                    setScaleFilter(null);
                  }
                }}
                className="w-full rounded-lg border border-gray-200 bg-gray-50 pl-10 pr-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-[#D60001] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#D60001] transition-colors"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          )}

          {/* Active lens pills + refinement controls — visible when lens is active, searching, or in table mode */}
          {(lens || searchQuery || viewMode === "table") && (
            <CompoundFilterBar
              compoundFilters={compoundFilters}
              setCompoundFilters={setCompoundFilters}
              showFilterMenu={showFilterMenu}
              setShowFilterMenu={setShowFilterMenu}
              uniqueProvinces={uniqueProvinces}
              posCounts={posCounts}
              serviceCounts={serviceCounts}
              mandateCounts={mandateCounts}
              lens={lens}
              setLens={setLens}
              scaleFilter={scaleFilter}
              setScaleFilter={setScaleFilter}
              posFilter={posFilter}
              setPosFilter={setPosFilter}
              serviceFilter={serviceFilter}
              setServiceFilter={setServiceFilter}
              mandateFilter={mandateFilter}
              setMandateFilter={setMandateFilter}
              isMember={isMember}
            />
          )}
        </div>

        {/* ------ Back bar — visible when drilled into anything ------ */}
        {hasNavContext && (
          <div className="flex-shrink-0 px-5 py-2 border-b border-gray-100 flex items-center gap-2">
            <button
              type="button"
              onClick={goBack}
              className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#D60001] transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </button>
            <span className="text-gray-300">·</span>
            <button
              type="button"
              onClick={goHome}
              className="text-sm text-gray-500 hover:text-[#D60001] transition-colors"
            >
              All lenses
            </button>
          </div>
        )}

        {/* ------ Sidebar content ------ */}
        <div className="flex-1 overflow-y-auto">
          {selectedOrg ? (
            <OrgDetailPanel org={selectedOrg} isMember={isMember} contact={contactForOrg} onFilterByValue={handleFilterByValue} />
          ) : searchQuery.trim() ? (
            <div>
              <GroupSummary orgs={filteredOrgs} lens={lens} />
              <OrgList orgs={filteredOrgs} onOrgClick={handleOrgClick} isMember={isMember} />
            </div>
          ) : lens === null && hasActiveCompounds(compoundFilters) ? (
            <div>
              <GroupSummary orgs={filteredOrgs} lens={lens} />
              <OrgList orgs={filteredOrgs} onOrgClick={handleOrgClick} isMember={isMember} />
            </div>
          ) : lens === null ? (
            <DiscoveryMenu
              members={members}
              partners={partners}
              provinceCount={provinceCount}
              scaleCounts={scaleCounts}
              membersWithFte={membersWithFte}
              membersWithPos={membersWithPos}
              membersWithServices={membersWithServices}
              membersWithMandate={membersWithMandate}
              onSelectLens={setLens}
              user={user}
              isMember={isMember}
            />
          ) : lens === "members" ? (
            <div>
              <GroupSummary orgs={filteredOrgs} lens={lens} />
              <OrgList orgs={filteredOrgs} onOrgClick={handleOrgClick} isMember={isMember} />
            </div>
          ) : lens === "partners" ? (
            <div>
              <GroupSummary orgs={filteredOrgs} lens={lens} />
              <OrgList orgs={filteredOrgs} onOrgClick={handleOrgClick} isMember={isMember} />
            </div>
          ) : lens === "scale" && !scaleFilter ? (
            <div>
              <div className="px-5 py-4 bg-gray-50 border-b border-gray-100">
                <p className="text-sm text-gray-600">
                  Enrollment size across{" "}
                  <span className="font-semibold text-gray-900">{membersWithFte}</span> reporting
                  institutions
                </p>
              </div>
              <div className="p-4 space-y-2">
                {SCALE_RANGES.map((range) => (
                  <button
                    key={range.key}
                    type="button"
                    onClick={() => {
                      setScaleFilter(range.key);
                    }}
                    disabled={scaleCounts[range.key] === 0}
                    className="w-full rounded-xl border border-gray-200 px-4 py-3.5 text-left hover:border-gray-300 hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed group"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-gray-900 group-hover:text-[#D60001] transition-colors">
                          {range.label} FTE
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">{range.description}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-bold text-gray-900">
                          {scaleCounts[range.key]}
                        </span>
                        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              {members.length - membersWithFte > 0 && (
                <div className="px-5 py-3 text-xs text-gray-400 border-t border-gray-100">
                  {members.length - membersWithFte} members haven&apos;t reported enrollment data yet
                </div>
              )}
            </div>
          ) : lens === "scale" && scaleFilter ? (
            <div>
              <GroupSummary orgs={filteredOrgs} lens={lens} />
              <OrgList orgs={filteredOrgs} onOrgClick={handleOrgClick} isMember={isMember} />
            </div>
          ) : lens === "pos_platform" && !posFilter ? (
            <div>
              <div className="px-5 py-4 bg-gray-50 border-b border-gray-100">
                <p className="text-sm text-gray-600">
                  POS platforms across{" "}
                  <span className="font-semibold text-gray-900">{membersWithPos}</span> reporting
                  institutions
                </p>
              </div>
              <div className="p-4 space-y-2">
                {Object.entries(posCounts)
                  .sort(([, a], [, b]) => b - a)
                  .map(([system, count]) => (
                    <button
                      key={system}
                      type="button"
                      onClick={() => {
                        setPosFilter(system);
                      }}
                      className="w-full rounded-xl border border-gray-200 px-4 py-3.5 text-left hover:border-gray-300 hover:bg-gray-50 transition-colors group"
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-gray-900 group-hover:text-[#D60001] transition-colors">
                          {system}
                        </p>
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-bold text-gray-900">{count}</span>
                          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                      </div>
                    </button>
                  ))}
              </div>
              {members.length - membersWithPos > 0 && (
                <div className="px-5 py-3 text-xs text-gray-400 border-t border-gray-100">
                  {members.length - membersWithPos} members haven&apos;t reported POS data yet
                </div>
              )}
            </div>
          ) : lens === "pos_platform" && posFilter ? (
            <div>
              <GroupSummary orgs={filteredOrgs} lens={lens} />
              <OrgList orgs={filteredOrgs} onOrgClick={handleOrgClick} isMember={isMember} />
            </div>
          ) : lens === "services" && !serviceFilter ? (
            <div>
              <div className="px-5 py-4 bg-gray-50 border-b border-gray-100">
                <p className="text-sm text-gray-600">
                  Services offered by{" "}
                  <span className="font-semibold text-gray-900">{membersWithServices}</span> reporting
                  institutions
                </p>
              </div>
              <div className="p-4 space-y-2">
                {Object.entries(serviceCounts)
                  .sort(([, a], [, b]) => b - a)
                  .map(([service, count]) => (
                    <button
                      key={service}
                      type="button"
                      onClick={() => {
                        setServiceFilter(service);
                      }}
                      className="w-full rounded-xl border border-gray-200 px-4 py-3.5 text-left hover:border-gray-300 hover:bg-gray-50 transition-colors group"
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-gray-900 group-hover:text-[#D60001] transition-colors">
                          {service}
                        </p>
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-bold text-gray-900">{count}</span>
                          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                      </div>
                    </button>
                  ))}
              </div>
              {members.length - membersWithServices > 0 && (
                <div className="px-5 py-3 text-xs text-gray-400 border-t border-gray-100">
                  {members.length - membersWithServices} members haven&apos;t reported services data yet
                </div>
              )}
            </div>
          ) : lens === "services" && serviceFilter ? (
            <div>
              <GroupSummary orgs={filteredOrgs} lens={lens} />
              <OrgList orgs={filteredOrgs} onOrgClick={handleOrgClick} isMember={isMember} />
            </div>
          ) : lens === "operating_model" && !mandateFilter ? (
            <div>
              <div className="px-5 py-4 bg-gray-50 border-b border-gray-100">
                <p className="text-sm text-gray-600">
                  Operating models across{" "}
                  <span className="font-semibold text-gray-900">{membersWithMandate}</span> reporting
                  institutions
                </p>
              </div>
              <div className="p-4 space-y-2">
                {Object.entries(mandateCounts)
                  .sort(([, a], [, b]) => b - a)
                  .map(([mandate, count]) => (
                    <button
                      key={mandate}
                      type="button"
                      onClick={() => {
                        setMandateFilter(mandate);
                      }}
                      className="w-full rounded-xl border border-gray-200 px-4 py-3.5 text-left hover:border-gray-300 hover:bg-gray-50 transition-colors group"
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-gray-900 group-hover:text-[#D60001] transition-colors">
                          {mandate}
                        </p>
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-bold text-gray-900">{count}</span>
                          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                      </div>
                    </button>
                  ))}
              </div>
              {members.length - membersWithMandate > 0 && (
                <div className="px-5 py-3 text-xs text-gray-400 border-t border-gray-100">
                  {members.length - membersWithMandate} members haven&apos;t reported operating model yet
                </div>
              )}
            </div>
          ) : lens === "operating_model" && mandateFilter ? (
            <div>
              <GroupSummary orgs={filteredOrgs} lens={lens} />
              <OrgList orgs={filteredOrgs} onOrgClick={handleOrgClick} isMember={isMember} />
            </div>
          ) : null}
        </div>

        {/* ------ Sidebar footer ------ */}
        {(lens || searchQuery) && !selectedOrg && (
          <div className="flex-shrink-0 px-5 py-3 border-t border-gray-100 bg-gray-50/80">
            <p className="text-xs text-gray-400 text-center">
              {filteredOrgs.length} organization{filteredOrgs.length !== 1 ? "s" : ""}{viewMode === "map" ? " highlighted on map" : ""}
            </p>
          </div>
        )}
      </div>


      {/* ================================================================= */}
      {/* EXPLORE: Table visualization (right of sidebar, replaces map)     */}
      {/* ================================================================= */}
      {explore && viewMode === "table" && (lens || searchQuery.trim() || hasActiveCompounds(compoundFilters)) && (
        <div className="absolute top-0 bottom-0 right-0 z-20 bg-gray-50 overflow-y-auto pt-20 px-4 pb-4 left-[380px]">
          <DirectoryTable
            organizations={filteredOrgs}
            onOrgClick={handleOrgClick}
          />
        </div>
      )}

      {/* ================================================================= */}
      {/* EXPLORE: Close button (top-right, over map) — fades in            */}
      {/* ================================================================= */}
      <button
        type="button"
        onClick={exitExplore}
        className={[
          "absolute top-20 right-4 z-40 w-10 h-10 rounded-full",
          "bg-white/90 backdrop-blur-sm border border-gray-200 shadow-lg",
          "flex items-center justify-center text-gray-600 hover:text-gray-900 hover:bg-white",
          "transition-all duration-500",
          explore ? "opacity-100 scale-100" : "opacity-0 scale-75 pointer-events-none",
        ].join(" ")}
        title="Close explore mode (Esc)"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </section>
  );
}

// =============================================================================
// Sub-components
// =============================================================================

/** Discovery menu — top-level lens picker */
function DiscoveryMenu({
  members,
  partners,
  provinceCount,
  scaleCounts,
  membersWithFte,
  membersWithPos,
  membersWithServices,
  membersWithMandate,
  onSelectLens,
  user,
  isMember,
}: {
  members: HomeMapOrg[];
  partners: HomeMapOrg[];
  provinceCount: number;
  scaleCounts: Record<ScaleRange, number>;
  membersWithFte: number;
  membersWithPos: number;
  membersWithServices: number;
  membersWithMandate: number;
  onSelectLens: (lens: ExploreLens) => void;
  user: unknown;
  isMember: boolean;
}) {
  const totalScale = Object.values(scaleCounts).reduce((a, b) => a + b, 0);

  return (
    <div className="p-5 space-y-5">
      {/* Network overview stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="text-center">
          <p className="text-2xl font-bold text-gray-900">{members.length}</p>
          <p className="text-xs text-gray-500 mt-0.5">Members</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-gray-900">{partners.length}</p>
          <p className="text-xs text-gray-500 mt-0.5">Partners</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-gray-900">{provinceCount}</p>
          <p className="text-xs text-gray-500 mt-0.5">Provinces</p>
        </div>
      </div>

      <div className="border-t border-gray-100" />

      {/* Browse section */}
      <div>
        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Browse
        </p>
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => onSelectLens("members")}
            className="w-full rounded-xl border border-gray-200 px-4 py-3.5 text-left hover:border-red-200 hover:bg-red-50/30 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-[#D60001]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 group-hover:text-[#D60001] transition-colors">
                  Campus Stores
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {members.length} member institutions
                </p>
              </div>
              <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onSelectLens("partners")}
            className="w-full rounded-xl border border-gray-200 px-4 py-3.5 text-left hover:border-blue-200 hover:bg-blue-50/30 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0M12 12.75h.008v.008H12v-.008z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                  Industry Partners
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {partners.length} vendors and suppliers
                </p>
              </div>
              <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        </div>
      </div>

      <div className="border-t border-gray-100" />

      {/* Discover section */}
      <div>
        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Discover
        </p>
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => onSelectLens("scale")}
            className="w-full rounded-xl border border-gray-200 px-4 py-3.5 text-left hover:border-amber-200 hover:bg-amber-50/30 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 group-hover:text-amber-700 transition-colors">
                  By Scale
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Compare stores by enrollment size
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-xs font-medium text-gray-400">{totalScale}</span>
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onSelectLens("pos_platform")}
            className="w-full rounded-xl border border-gray-200 px-4 py-3.5 text-left hover:border-purple-200 hover:bg-purple-50/30 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 group-hover:text-purple-700 transition-colors">
                  Same Platform
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  See who runs the same POS system
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-xs font-medium text-gray-400">{membersWithPos}</span>
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onSelectLens("services")}
            className="w-full rounded-xl border border-gray-200 px-4 py-3.5 text-left hover:border-emerald-200 hover:bg-emerald-50/30 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 6h.008v.008H6V6z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 group-hover:text-emerald-700 transition-colors">
                  Services Offered
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Compare what stores offer students
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-xs font-medium text-gray-400">{membersWithServices}</span>
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onSelectLens("operating_model")}
            className="w-full rounded-xl border border-gray-200 px-4 py-3.5 text-left hover:border-orange-200 hover:bg-orange-50/30 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-orange-50 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 group-hover:text-orange-700 transition-colors">
                  Operating Model
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Self-operated, outsourced, or hybrid
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-xs font-medium text-gray-400">{membersWithMandate}</span>
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Sign-in CTA for non-logged-in users */}
      {!user && (
        <>
          <div className="border-t border-gray-100" />
          <div className="rounded-xl bg-gradient-to-br from-gray-50 to-gray-100 border border-gray-200 p-4 text-center">
            <p className="text-sm text-gray-600 mb-3">
              Sign in to access contact details, benchmarking data, and deeper comparisons.
            </p>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#1A1A1A] text-white text-sm font-medium rounded-full hover:bg-gray-800 transition-colors"
            >
              Sign In
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

/** Scrollable org list — shows context + data chips for each org */
function OrgList({
  orgs,
  onOrgClick,
  isMember,
}: {
  orgs: HomeMapOrg[];
  onOrgClick: (org: HomeMapOrg) => void;
  isMember: boolean;
}) {
  if (orgs.length === 0) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-gray-500">No organizations found.</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-100">
      {orgs.map((org) => (
        <button
          key={org.id}
          type="button"
          onClick={() => onOrgClick(org)}
          className="w-full px-5 py-3 text-left hover:bg-gray-50 transition-colors group"
        >
          <div className="flex items-center gap-3">
            {org.logoUrl ? (
              <img
                src={org.logoUrl}
                alt=""
                className="w-9 h-9 rounded-lg object-contain bg-gray-50 border border-gray-100 flex-shrink-0"
              />
            ) : (
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  org.type === "Member" ? "bg-red-50" : "bg-blue-50"
                }`}
              >
                <span
                  className={`text-xs font-bold ${
                    org.type === "Member" ? "text-red-400" : "text-blue-400"
                  }`}
                >
                  {org.name.charAt(0).toUpperCase()}
                </span>
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900 truncate group-hover:text-[#D60001] transition-colors">
                {org.name}
              </p>
              <p className="text-xs text-gray-500 truncate">
                {orgSubtitle(org) || (org.type === "Member" ? "Member institution" : "Industry partner")}
              </p>
            </div>
            <svg className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
          {/* Data chips */}
          <div className="flex flex-wrap gap-1 mt-1.5 ml-12">
            {org.enrollmentFte != null && (
              <span className="rounded bg-amber-50 border border-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                {org.enrollmentFte >= 1000
                  ? `${(org.enrollmentFte / 1000).toFixed(1)}k FTE`
                  : `${org.enrollmentFte} FTE`}
              </span>
            )}
            {org.posSystem && (
              isMember ? (
                <span className="rounded bg-purple-50 border border-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">
                  {org.posSystem}
                </span>
              ) : (
                <span className="rounded bg-gray-100 w-12 h-4 inline-block blur-[3px]" />
              )
            )}
            {org.operationsMandate && (
              isMember ? (
                <span className="rounded bg-orange-50 border border-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-700">
                  {org.operationsMandate}
                </span>
              ) : (
                <span className="rounded bg-gray-100 w-10 h-4 inline-block blur-[3px]" />
              )
            )}
            {org.servicesOffered && org.servicesOffered.length > 0 && (
              isMember ? (
                <span className="rounded bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                  {org.servicesOffered.length} services
                </span>
              ) : (
                <span className="rounded bg-gray-100 w-14 h-4 inline-block blur-[3px]" />
              )
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

// OrgDetailPanel, GroupSummary, and CompoundFilterBar are imported from components/explore/
// Only DiscoveryMenu and OrgList remain inline below as map-sidebar-specific components.

