"use client";

import { useCallback, useEffect, useMemo, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useAuth } from "@/components/providers/AuthProvider";
import { hasPermission } from "@/lib/auth/permissions";
import { getPrimaryContactsForMap } from "@/lib/actions/map-contacts";
import type { HomeMapOrg } from "@/lib/homepage";
import type { MapRef } from "./Map";
import type { ExploreLens, ScaleRange, CompoundFilters } from "@/lib/explore/types";
import { SCALE_RANGES } from "@/lib/explore/types";
import { VENDOR_CATEGORIES, CATEGORY_SUBCATEGORIES } from "@/lib/types/procurement";
import { orgSubtitle, hasActiveCompounds } from "@/lib/explore/filters";
import { CompoundFilterBar } from "@/components/explore/CompoundFilterBar";
import { OrgDetailPanel } from "@/components/explore/OrgDetailPanel";
import {
  getPartnerOrgProfile,
  getOrgProcurementPanel,
  getMemberOrgProfile,
  type PartnerOrgProfile,
  type ProcurementPanelData,
  type MemberOrgProfile,
} from "@/lib/actions/partner-context";
import { GroupSummary } from "@/components/explore/GroupSummary";

const DirectoryTable = dynamic(
  () => import("@/components/directory/DirectoryTable"),
  { ssr: false }
);

// ---------------------------------------------------------------------------
// Constants / helpers (explore-only)
// ---------------------------------------------------------------------------

// ── Partner category helpers ──────────────────────────────────────────────────
const PARENT_CATEGORY_SET = new Set<string>(VENDOR_CATEGORIES as readonly string[]);
const SUB_TO_PARENT_MAP = new Map<string, string>();
for (const [parent, subs] of Object.entries(CATEGORY_SUBCATEGORIES)) {
  for (const sub of subs ?? []) SUB_TO_PARENT_MAP.set(sub, parent);
}

/** Split a comma-separated primary_category string and identify parent categories */
function parsePartnerCategories(raw: string | null): { parents: string[]; subcategories: string[] } {
  if (!raw) return { parents: [], subcategories: [] };
  const items = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const parents: string[] = [];
  const subcategories: string[] = [];
  for (const item of items) {
    if (PARENT_CATEGORY_SET.has(item)) parents.push(item);
    else subcategories.push(item);
  }
  return { parents, subcategories };
}

/** Check if an org's primary_category contains a given parent category */
function orgHasParentCategory(org: HomeMapOrg, cat: string): boolean {
  if (!org.primaryCategory) return false;
  const { parents } = parsePartnerCategories(org.primaryCategory);
  return parents.includes(cat);
}

/** Check if an org's primary_category contains a given subcategory */
function orgHasSubcategory(org: HomeMapOrg, sub: string): boolean {
  if (!org.primaryCategory) return false;
  return org.primaryCategory.split(",").map((s) => s.trim()).includes(sub);
}
// ─────────────────────────────────────────────────────────────────────────────

const CANADIAN_PROVINCES = new Set([
  "AB","BC","MB","NB","NL","NS","NT","NU","ON","PE","QC","SK","YT",
  "Alberta","British Columbia","Manitoba","New Brunswick","Newfoundland and Labrador",
  "Nova Scotia","Northwest Territories","Nunavut","Ontario","Prince Edward Island",
  "Quebec","Saskatchewan","Yukon",
]);
function matchesProvinceFilter(orgProvince: string | null, filter: string): boolean {
  if (filter === "__international__") return !orgProvince || !CANADIAN_PROVINCES.has(orgProvince);
  return orgProvince === filter;
}

const LENS_LABELS: Record<string, string> = {
  members: "Members",
  partners: "Partners",
  partner_category: "Partner Categories",
  scale: "By Scale",
  pos_platform: "Same Platform",
  services: "Services Offered",
  operating_model: "Operating Model",
};

// ---------------------------------------------------------------------------
// Boundary types — one-shot commands MapHero dispatches into MapExplore
// ---------------------------------------------------------------------------

/**
 * One-shot "enter explore" seed. MapHero builds a fresh object (new
 * reference) every time explore is entered (hover-dwell, overlay click, or
 * a marker click while still in attract mode) or a marker is clicked while
 * already exploring, and this component applies it via an effect keyed on
 * the object's identity. When both an entry mapping AND a marker click
 * happen in the same tick (clicking a marker while in attract mode),
 * MapHero dispatches two seeds back-to-back; only the later one survives
 * React's same-tick state batching, which reproduces the original
 * behaviour of the clicked org overriding whatever spotlight org the
 * story mapping selected.
 */
export interface MapExploreEntrySeed {
  lens?: ExploreLens;
  posFilter?: string;
  serviceFilter?: string;
  mandateFilter?: string;
  category?: string;
  selectOrgId?: string | null;
  closeFilterMenu?: boolean;
}

export interface MapExploreInitialState {
  explore: boolean;
  viewMode: "map" | "table";
  lens: ExploreLens;
  focus?: "members" | "partners";
}

interface MapExploreProps {
  organizations: HomeMapOrg[];
  mapRef: RefObject<MapRef | null>;
  explore: boolean;
  persistent: boolean;
  initialState?: MapExploreInitialState;
  viewMode: "map" | "table";
  setViewMode: Dispatch<SetStateAction<"map" | "table">>;
  exitExplore: () => void;
  /** Set (new reference) by MapHero whenever it wants this component to apply a lens/filter/selection seed. */
  entrySeed: MapExploreEntrySeed | null;
  /** Bumped by MapHero's exitExplore — triggers this component's own filter/selection reset. */
  resetSeed: number | null;
  onHighlightedIdsChange: Dispatch<SetStateAction<string[]>>;
}

export default function MapExplore({
  organizations,
  mapRef,
  explore,
  persistent,
  initialState,
  viewMode,
  setViewMode,
  exitExplore,
  entrySeed,
  resetSeed,
  onHighlightedIdsChange,
}: MapExploreProps) {
  const { user, permissionState, isCancollMember } = useAuth();
  const isMember = !!user && hasPermission(permissionState, "member");
  const isPartnerViewing = !!user && !isMember;
  const canViewCancoll = isMember || isCancollMember;

  const discoveryFocus = initialState?.focus ?? "all";

  // Partner profile — fetched once for fit scoring and panel personalisation
  const [partnerProfile, setPartnerProfile] = useState<PartnerOrgProfile | null>(null);
  useEffect(() => {
    if (!isPartnerViewing) return;
    getPartnerOrgProfile().then((p) => setPartnerProfile(p));
  }, [isPartnerViewing]);

  // Member procurement profile — fetched once so we can personalise the partner detail panel
  const [memberProfile, setMemberProfile] = useState<MemberOrgProfile | null>(null);
  useEffect(() => {
    if (!isMember) return;
    getMemberOrgProfile().then((p) => setMemberProfile(p));
  }, [isMember]);

  // Procurement panel — fetched per selected member org, scoped to partner's category
  const [procurementPanel, setProcurementPanel] = useState<ProcurementPanelData | null>(null);
  const [procurementPanelLoading, setProcurementPanelLoading] = useState(false);

  // --- Explore state ---
  const [lens, setLens] = useState<ExploreLens>(initialState?.lens ?? null);
  const [scaleFilter, setScaleFilter] = useState<ScaleRange | null>(null);
  const [checkedCategories, setCheckedCategories] = useState<Set<string>>(new Set());
  const [checkedSubcategories, setCheckedSubcategories] = useState<Set<string>>(new Set());
  const [posFilter, setPosFilter] = useState<string | null>(null);
  const [serviceFilter, setServiceFilter] = useState<string | null>(null);
  const [mandateFilter, setMandateFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedOrg, setSelectedOrg] = useState<HomeMapOrg | null>(null);

  // --- Compound cross-lens filters ---
  const [compoundFilters, setCompoundFilters] = useState<CompoundFilters>({});
  const [showFilterMenu, setShowFilterMenu] = useState(false);

  // --- Semantic search state (partner focus only) ---
  // null = no semantic search active; array = ranked partner IDs from Voyage
  const [semanticResults, setSemanticResults] = useState<{ id: string; score: number }[] | null>(null);
  const [semanticLoading, setSemanticLoading] = useState(false);

  // ---------------------------------------------------------------------------
  // Boundary: apply MapHero's one-shot enter-explore seed / reset signal
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!entrySeed) return;
    if (entrySeed.lens !== undefined) setLens(entrySeed.lens);
    if (entrySeed.posFilter) setPosFilter(entrySeed.posFilter);
    if (entrySeed.serviceFilter) setServiceFilter(entrySeed.serviceFilter);
    if (entrySeed.mandateFilter) setMandateFilter(entrySeed.mandateFilter);
    if (entrySeed.category) setCheckedCategories(new Set([entrySeed.category]));
    if (entrySeed.selectOrgId !== undefined) {
      if (entrySeed.selectOrgId === null) {
        setSelectedOrg(null);
      } else {
        const org = organizations.find((o) => o.id === entrySeed.selectOrgId) ?? null;
        if (org) setSelectedOrg(org);
      }
    }
    if (entrySeed.closeFilterMenu) setShowFilterMenu(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entrySeed]);

  useEffect(() => {
    if (resetSeed == null) return;
    setSelectedOrg(null);
    setSearchQuery("");
    setScaleFilter(null);
    setCheckedCategories(new Set());
    setCheckedSubcategories(new Set());
    setPosFilter(null);
    setServiceFilter(null);
    setMandateFilter(null);
    setCompoundFilters({});
    setShowFilterMenu(false);
    if (persistent && initialState) {
      setLens(initialState.lens);
    } else {
      setLens(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSeed]);

  // Debounced semantic search: fires 400ms after the user stops typing,
  // but only on the partners page where embeddings are meaningful.
  useEffect(() => {
    if (discoveryFocus !== "partners" || !searchQuery.trim()) {
      setSemanticResults(null);
      return;
    }
    setSemanticLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search/partners?q=${encodeURIComponent(searchQuery.trim())}`);
        if (res.ok) {
          const data = await res.json();
          setSemanticResults(Array.isArray(data) ? data : null);
        }
      } catch {
        // fall back to text search silently
      } finally {
        setSemanticLoading(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery, discoveryFocus]);

  // --- Primary contacts for selected org (fetched on-demand, all is_primary=true) ---
  const [contactsForOrg, setContactsForOrg] = useState<{
    name: string;
    roleTitle: string | null;
    email: string | null;
    phone: string | null;
    avatarUrl: string | null;
  }[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedOrg) {
      setContactsForOrg([]);
      return () => { cancelled = true; };
    }
    getPrimaryContactsForMap(selectedOrg.id, selectedOrg.type ?? null).then((rows) => {
      if (cancelled) return;
      setContactsForOrg(rows);
    });
    return () => { cancelled = true; };
  }, [selectedOrg?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Procurement panel — only when a partner selects a member org
  useEffect(() => {
    if (!selectedOrg || selectedOrg.type !== "Member" || !isPartnerViewing) {
      setProcurementPanel(null);
      return;
    }
    let cancelled = false;
    setProcurementPanelLoading(true);
    setProcurementPanel(null);
    getOrgProcurementPanel(selectedOrg.id, partnerProfile?.primaryCategory ?? null).then((data) => {
      if (cancelled) return;
      setProcurementPanel(data);
      setProcurementPanelLoading(false);
    });
    return () => { cancelled = true; };
  }, [selectedOrg?.id, isPartnerViewing, partnerProfile?.primaryCategory]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Pool after lens + sub-lens filter but BEFORE compound filters.
  // All dimension counts derive from this so they reflect the current cohort,
  // not the full global set.
  const lensPool = useMemo((): HomeMapOrg[] => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      // Respect the current focus so counts/filters stay scoped to the right cohort
      const scope =
        discoveryFocus === "partners" ? partners
        : discoveryFocus === "members" ? members
        : organizations;
      return scope.filter(
        (o) =>
          o.name.toLowerCase().includes(q) ||
          (o.city && o.city.toLowerCase().includes(q)) ||
          (o.province && o.province.toLowerCase().includes(q))
      );
    }
    switch (lens) {
      case "members": return [...members];
      case "partners": return [...partners];
      case "partner_category": {
        let pool = partners.filter((o) => !!o.primaryCategory);
        if (checkedSubcategories.size > 0) {
          pool = pool.filter((o) => [...checkedSubcategories].some((sub) => orgHasSubcategory(o, sub)));
        } else if (checkedCategories.size > 0) {
          pool = pool.filter((o) => [...checkedCategories].some((cat) => orgHasParentCategory(o, cat)));
        }
        return pool;
      }
      case "scale":
        if (scaleFilter) {
          const range = SCALE_RANGES.find((r) => r.key === scaleFilter)!;
          return members.filter((o) => o.enrollmentFte != null && o.enrollmentFte >= range.min && o.enrollmentFte <= range.max);
        }
        return members.filter((o) => o.enrollmentFte != null);
      case "pos_platform":
        return posFilter
          ? members.filter((o) => o.posSystem === posFilter)
          : members.filter((o) => o.posSystem != null);
      case "services":
        return serviceFilter
          ? members.filter((o) => o.servicesOffered?.includes(serviceFilter))
          : members.filter((o) => o.servicesOffered != null && o.servicesOffered.length > 0);
      case "operating_model":
        return mandateFilter
          ? members.filter((o) => o.operationsMandate === mandateFilter)
          : members.filter((o) => o.operationsMandate != null);
      default:
        return [...organizations];
    }
  }, [organizations, members, partners, lens, scaleFilter, checkedCategories, checkedSubcategories, posFilter, serviceFilter, mandateFilter, searchQuery, discoveryFocus]);

  // Apply active compound filters on top of lensPool so all dimension counts
  // reflect the full current cohort (cross-filtered facets).
  const cohortPool = useMemo(() => {
    let pool = [...lensPool];
    if (compoundFilters.province) pool = pool.filter((o) => matchesProvinceFilter(o.province, compoundFilters.province!));
    if (compoundFilters.pos && lens !== "pos_platform") pool = pool.filter((o) => o.posSystem === compoundFilters.pos);
    if (compoundFilters.service && lens !== "services") pool = pool.filter((o) => o.servicesOffered?.includes(compoundFilters.service!));
    if (compoundFilters.mandate && lens !== "operating_model") pool = pool.filter((o) => o.operationsMandate === compoundFilters.mandate);
    if (compoundFilters.scaleRange && lens !== "scale") {
      const range = SCALE_RANGES.find((r) => r.key === compoundFilters.scaleRange)!;
      if (range) pool = pool.filter((o) => o.enrollmentFte != null && o.enrollmentFte >= range.min && o.enrollmentFte <= range.max);
    }
    if (compoundFilters.payment) pool = pool.filter((o) => o.paymentOptions?.includes(compoundFilters.payment!));
    if (compoundFilters.shopping) pool = pool.filter((o) => o.shoppingServices?.includes(compoundFilters.shopping!));
    if (compoundFilters.hasCatalogue === "true") pool = pool.filter((o) => !!o.catalogueUrl);
    if (compoundFilters.category && lens !== "partner_category") pool = pool.filter((o) => orgHasParentCategory(o, compoundFilters.category!));
    // Refine panel category checkboxes — applied outside partner_category lens
    // so they work on /partners where the lens is forced to "partners"
    if (lens !== "partner_category") {
      if (checkedSubcategories.size > 0) {
        pool = pool.filter((o) => [...checkedSubcategories].some((sub) => orgHasSubcategory(o, sub)));
      } else if (checkedCategories.size > 0) {
        pool = pool.filter((o) => [...checkedCategories].some((cat) => orgHasParentCategory(o, cat)));
      }
    }
    if (compoundFilters.certification) {
      const cert = compoundFilters.certification;
      pool = pool.filter((o) =>
        o.certifications?.includes(cert)
      );
    }
    if (compoundFilters.cancoll === "true") pool = pool.filter((o) => o.certifications?.includes("CANCOLL"));
    return pool;
  }, [lensPool, compoundFilters, lens, checkedCategories, checkedSubcategories]);

  const lensMembers = useMemo(() => cohortPool.filter((o) => o.type === "Member"), [cohortPool]);
  const lensPartners = useMemo(() => cohortPool.filter((o) => o.type === "Vendor Partner"), [cohortPool]);

  const scaleCounts = useMemo(() => {
    const counts: Record<ScaleRange, number> = { small: 0, medium: 0, large: 0, xlarge: 0 };
    for (const org of lensMembers) {
      if (org.enrollmentFte == null) continue;
      for (const range of SCALE_RANGES) {
        if (org.enrollmentFte >= range.min && org.enrollmentFte <= range.max) {
          counts[range.key]++;
          break;
        }
      }
    }
    return counts;
  }, [lensMembers]);

  const membersWithFte = useMemo(
    () => lensMembers.filter((o) => o.enrollmentFte != null).length,
    [lensMembers]
  );

  const posCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const org of lensMembers) {
      if (org.posSystem) counts[org.posSystem] = (counts[org.posSystem] || 0) + 1;
    }
    return counts;
  }, [lensMembers]);

  const membersWithPos = useMemo(
    () => lensMembers.filter((o) => o.posSystem != null).length,
    [lensMembers]
  );

  const serviceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const org of lensMembers) {
      if (org.servicesOffered) {
        for (const svc of org.servicesOffered) {
          counts[svc] = (counts[svc] || 0) + 1;
        }
      }
    }
    return counts;
  }, [lensMembers]);

  const membersWithServices = useMemo(
    () => lensMembers.filter((o) => o.servicesOffered != null && o.servicesOffered.length > 0).length,
    [lensMembers]
  );

  const mandateCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const org of lensMembers) {
      if (org.operationsMandate) counts[org.operationsMandate] = (counts[org.operationsMandate] || 0) + 1;
    }
    return counts;
  }, [lensMembers]);

  const membersWithMandate = useMemo(
    () => lensMembers.filter((o) => o.operationsMandate != null).length,
    [lensMembers]
  );

  // Count by parent category (split the comma-separated field)
  const partnerCategoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const org of lensPartners) {
      if (!org.primaryCategory) continue;
      const { parents } = parsePartnerCategories(org.primaryCategory);
      // If no recognised parents, fall back to counting the first item as-is
      const toCount = parents.length > 0 ? parents : [org.primaryCategory.split(",")[0].trim()];
      for (const p of toCount) {
        counts[p] = (counts[p] || 0) + 1;
      }
    }
    return counts;
  }, [lensPartners]);

  // Subcategory counts per checked parent category
  const partnerSubcategoryCounts = useMemo(() => {
    const counts: Record<string, Record<string, number>> = {};
    for (const cat of checkedCategories) {
      counts[cat] = {};
      const subs = CATEGORY_SUBCATEGORIES[cat] ?? [];
      for (const org of lensPartners) {
        if (!orgHasParentCategory(org, cat)) continue;
        const { subcategories } = parsePartnerCategories(org.primaryCategory);
        for (const sub of subcategories) {
          if (subs.includes(sub as never)) {
            counts[cat][sub] = (counts[cat][sub] || 0) + 1;
          }
        }
      }
    }
    return counts;
  }, [lensPartners, checkedCategories]);

  const certificationCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const org of lensPartners) {
      for (const cert of (org.certifications ?? [])) {
        counts[cert] = (counts[cert] || 0) + 1;
      }
    }
    return counts;
  }, [lensPartners]);

  const partnersWithCategory = useMemo(
    () => lensPartners.filter((o) => !!o.primaryCategory).length,
    [lensPartners]
  );

  // Unique provinces for compound filter dropdown — from lensPool so counts
  // reflect the current cohort rather than the global set.
  const uniqueProvinces = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const org of lensPool) {
      if (org.province && org.province !== "Out of Canada") {
        counts[org.province] = (counts[org.province] || 0) + 1;
      }
    }
    return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
  }, [lensPool]);

  // --- Compute filtered orgs and map highlights based on explore state ---
  const { filteredOrgs, highlightedIds, searchRanking } = useMemo(() => {
    if (selectedOrg && viewMode !== "table") {
      return { filteredOrgs: [] as HomeMapOrg[], highlightedIds: [selectedOrg.id] };
    }

    if (searchQuery.trim()) {
      // Partners page: hybrid search — text matches surface instantly, semantic
      // results (from Voyage, 400ms debounce) fill in below them.
      if (discoveryFocus === "partners") {
        const q = searchQuery.toLowerCase();

        // Text match: name / city / province (instant, client-side)
        const textMatchIds = new Set(
          partners
            .filter(
              (o) =>
                o.name.toLowerCase().includes(q) ||
                (o.city && o.city.toLowerCase().includes(q)) ||
                (o.province && o.province.toLowerCase().includes(q))
            )
            .map((o) => o.id)
        );

        // Semantic match: null = still loading (debounce), [] = API returned nothing
        const semanticIdToScore = new Map(
          (semanticResults ?? []).map((r) => [r.id, r.score])
        );

        // Union of both sets — text matches score 1.0, semantic fills the rest
        const allIds = new Set([...textMatchIds, ...semanticIdToScore.keys()]);
        const rankingMap = new Map<string, number>();
        for (const id of allIds) {
          rankingMap.set(id, textMatchIds.has(id) ? 1.0 : (semanticIdToScore.get(id) ?? 0));
        }
        let pool = partners
          .filter((o) => allIds.has(o.id))
          .sort((a, b) => (rankingMap.get(b.id) ?? 0) - (rankingMap.get(a.id) ?? 0));

        if (compoundFilters.province) pool = pool.filter((o) => matchesProvinceFilter(o.province, compoundFilters.province!));
        if (compoundFilters.category) pool = pool.filter((o) => o.primaryCategory === compoundFilters.category);
        if (compoundFilters.certification) {
          const cert = compoundFilters.certification;
          pool = pool.filter((o) =>
            o.certifications?.includes(cert)
          );
        }
        if (compoundFilters.cancoll === "true") pool = pool.filter((o) => o.certifications?.includes("CANCOLL"));
        return { filteredOrgs: pool, highlightedIds: pool.map((o) => o.id), searchRanking: rankingMap.size > 0 ? rankingMap : undefined };
      }

      // All other pages: existing text match on name / city / province
      const q = searchQuery.toLowerCase();
      let pool = organizations.filter(
        (o) =>
          o.name.toLowerCase().includes(q) ||
          (o.city && o.city.toLowerCase().includes(q)) ||
          (o.province && o.province.toLowerCase().includes(q))
      );
      // Apply compound filters even on search results
      if (compoundFilters.province) pool = pool.filter((o) => matchesProvinceFilter(o.province, compoundFilters.province!));
      if (compoundFilters.cancoll === "true") pool = pool.filter((o) => o.certifications?.includes("CANCOLL"));
      return { filteredOrgs: pool, highlightedIds: pool.map((o) => o.id) };
    }

    // Start with lens-based pool
    let pool: HomeMapOrg[];
    switch (lens) {
      case "members":
        pool = [...members]; break;
      case "partners":
        pool = [...partners]; break;
      case "partner_category": {
        let catPool = partners.filter((o) => !!o.primaryCategory);
        if (checkedSubcategories.size > 0) {
          catPool = catPool.filter((o) => [...checkedSubcategories].some((sub) => orgHasSubcategory(o, sub)));
        } else if (checkedCategories.size > 0) {
          catPool = catPool.filter((o) => [...checkedCategories].some((cat) => orgHasParentCategory(o, cat)));
        }
        pool = catPool;
        break;
      }
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
    if (compoundFilters.province) pool = pool.filter((o) => matchesProvinceFilter(o.province, compoundFilters.province!));
    if (compoundFilters.pos && lens !== "pos_platform") pool = pool.filter((o) => o.posSystem === compoundFilters.pos);
    if (compoundFilters.service && lens !== "services") pool = pool.filter((o) => o.servicesOffered?.includes(compoundFilters.service!));
    if (compoundFilters.mandate && lens !== "operating_model") pool = pool.filter((o) => o.operationsMandate === compoundFilters.mandate);
    if (compoundFilters.scaleRange && lens !== "scale") {
      const range = SCALE_RANGES.find((r) => r.key === compoundFilters.scaleRange)!;
      pool = pool.filter((o) => o.enrollmentFte != null && o.enrollmentFte >= range.min && o.enrollmentFte <= range.max);
    }
    if (compoundFilters.payment) pool = pool.filter((o) => o.paymentOptions?.includes(compoundFilters.payment!));
    if (compoundFilters.shopping) pool = pool.filter((o) => o.shoppingServices?.includes(compoundFilters.shopping!));
    if (compoundFilters.hasCatalogue === "true") pool = pool.filter((o) => !!o.catalogueUrl);
    if (compoundFilters.category && lens !== "partner_category") pool = pool.filter((o) => orgHasParentCategory(o, compoundFilters.category!));
    if (lens !== "partner_category") {
      if (checkedSubcategories.size > 0) {
        pool = pool.filter((o) => [...checkedSubcategories].some((sub) => orgHasSubcategory(o, sub)));
      } else if (checkedCategories.size > 0) {
        pool = pool.filter((o) => [...checkedCategories].some((cat) => orgHasParentCategory(o, cat)));
      }
    }
    if (compoundFilters.certification) {
      const cert = compoundFilters.certification;
      pool = pool.filter((o) =>
        o.certifications?.includes(cert)
      );
    }
    if (compoundFilters.cancoll === "true") pool = pool.filter((o) => o.certifications?.includes("CANCOLL"));

    return { filteredOrgs: pool, highlightedIds: pool.map((o) => o.id) };
  }, [organizations, members, partners, lens, scaleFilter, checkedCategories, checkedSubcategories, posFilter, serviceFilter, mandateFilter, searchQuery, selectedOrg, compoundFilters, viewMode, semanticResults, discoveryFocus]);

  // Report highlighted IDs up to MapHero — the boundary point that feeds
  // <MapComponent highlightedOrgIds> alongside attract-mode's story highlights.
  useEffect(() => {
    onHighlightedIdsChange(highlightedIds);
  }, [highlightedIds, onHighlightedIdsChange]);

  // Fit map to filtered orgs whenever switching to map view
  useEffect(() => {
    if (viewMode !== "map" || !explore) return;
    const orgs = filteredOrgs.length > 0 ? filteredOrgs : organizations;
    setTimeout(() => mapRef.current?.fitOrgs(orgs), 350);
  }, [viewMode, explore]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Interactions
  // ---------------------------------------------------------------------------

  const handleOrgClick = useCallback((org: HomeMapOrg) => {
    setSelectedOrg(org);
    setShowFilterMenu(false);
    // Fly to the selected org
    if (org.latitude != null && org.longitude != null) {
      mapRef.current?.flyTo([org.longitude, org.latitude], 10);
    }
  }, [mapRef]);

  /** Drill from a profile value — additive: drops lens, merges into compound filters */
  const handleFilterByValue = useCallback((_filterLens: ExploreLens, filters: CompoundFilters) => {
    setSelectedOrg(null);
    setShowFilterMenu(false);
    // Drop lens and all sub-filters — go to compound-only mode
    setLens(null);
    setScaleFilter(null);
    setCheckedCategories(new Set());
    setCheckedSubcategories(new Set());
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
    } else if (checkedSubcategories.size > 0) {
      setCheckedSubcategories(new Set());
    } else if (checkedCategories.size > 0) {
      setCheckedCategories(new Set());
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
  }, [selectedOrg, scaleFilter, checkedCategories, checkedSubcategories, posFilter, serviceFilter, mandateFilter, lens, searchQuery, compoundFilters]);

  /** Jump straight back to the discovery menu (lens picker). */
  const goHome = useCallback(() => {
    setSelectedOrg(null);
    setLens(initialState?.lens ?? null);
    setSearchQuery("");
    setScaleFilter(null);
    setCheckedCategories(new Set());
    setCheckedSubcategories(new Set());
    setPosFilter(null);
    setServiceFilter(null);
    setMandateFilter(null);
    setCompoundFilters({});
    setShowFilterMenu(false);
  }, [initialState?.lens]);

  // ---------------------------------------------------------------------------
  // Breadcrumb segments — each is { label, action } where action jumps to that level
  // ---------------------------------------------------------------------------

  const breadcrumbs = useMemo(() => {
    const crumbs: { label: string; action: () => void }[] = [];

    // Lens level
    if (lens) {
      crumbs.push({
        label: LENS_LABELS[lens] ?? lens,
        action: () => {
          setSelectedOrg(null);
          setScaleFilter(null);
          setCheckedCategories(new Set());
          setCheckedSubcategories(new Set());
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
    } else if (lens === "partner_category" && checkedCategories.size > 0) {
      const label = checkedCategories.size === 1 ? [...checkedCategories][0] : `${checkedCategories.size} categories`;
      crumbs.push({ label, action: () => { setSelectedOrg(null); } });
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
  }, [lens, scaleFilter, checkedCategories, checkedSubcategories, posFilter, serviceFilter, mandateFilter, selectedOrg, searchQuery, compoundFilters]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasNavContext = breadcrumbs.length > 0;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
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
        <div className={`flex-shrink-0 ${persistent ? "pt-4" : "pt-20"} px-5 pb-4 border-b border-gray-100`}>
          {/* Top row: home + breadcrumbs + close */}
          <div className="flex items-center justify-between mb-4 gap-2">
            <div className="flex items-center gap-1 min-w-0 flex-1">
              {/* Home / title */}
              {hasNavContext ? (
                <button
                  type="button"
                  onClick={goHome}
                  className="flex-shrink-0 text-gray-400 hover:text-[#EE2A2E] transition-colors"
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
                        className="text-sm text-gray-500 hover:text-[#EE2A2E] transition-colors truncate max-w-[120px]"
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
                data-onboarding="view-toggle"
                onClick={() => {
                  const next = viewMode === "map" ? "table" : "map";
                  setViewMode(next);
                  window.dispatchEvent(new CustomEvent("csc:view-mode-changed", { detail: { mode: next } }));
                }}
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
                className="w-full rounded-lg border border-gray-200 bg-gray-50 pl-10 pr-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-[#EE2A2E] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#EE2A2E] transition-colors"
              />
              {semanticLoading && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-[#EE2A2E] border-t-transparent rounded-full animate-spin" />
              )}
              {searchQuery && !semanticLoading && (
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
              partnerCategoryCounts={partnerCategoryCounts}
              certificationCounts={certificationCounts}
              canViewCancoll={canViewCancoll}
              checkedCategories={checkedCategories}
              setCheckedCategories={setCheckedCategories}
              checkedSubcategories={checkedSubcategories}
              setCheckedSubcategories={setCheckedSubcategories}
              partnerSubcategoryCounts={partnerSubcategoryCounts}
              lens={lens}
              setLens={setLens}
              defaultLens={initialState?.lens ?? null}
              scaleFilter={scaleFilter}
              setScaleFilter={setScaleFilter}
              posFilter={posFilter}
              setPosFilter={setPosFilter}
              serviceFilter={serviceFilter}
              setServiceFilter={setServiceFilter}
              mandateFilter={mandateFilter}
              setMandateFilter={setMandateFilter}
              isMember={isMember}
              focus={discoveryFocus}
            />
          )}
        </div>

        {/* ------ Back bar — visible when drilled into anything ------ */}
        {hasNavContext && (
          <div className="flex-shrink-0 px-5 py-2 border-b border-gray-100 flex items-center gap-2">
            <button
              type="button"
              onClick={goBack}
              className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#EE2A2E] transition-colors"
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
              className="text-sm text-gray-500 hover:text-[#EE2A2E] transition-colors"
            >
              All lenses
            </button>
          </div>
        )}

        {/* ------ Sidebar content ------ */}
        <div className="flex-1 overflow-y-auto">
          {selectedOrg ? (
            <OrgDetailPanel
              org={selectedOrg}
              isMember={isMember}
              canViewCancoll={canViewCancoll}
              contacts={selectedOrg ? contactsForOrg : []}
              onFilterByValue={handleFilterByValue}
              partnerCategory={isPartnerViewing ? (partnerProfile?.primaryCategory ?? null) : null}
              procurementPanel={procurementPanel}
              procurementPanelLoading={procurementPanelLoading}
              memberProfile={isMember ? memberProfile : null}
            />
          ) : searchQuery.trim() ? (
            <div>
              <GroupSummary orgs={filteredOrgs} lens={lens} />
              <OrgList orgs={filteredOrgs} onOrgClick={handleOrgClick} isMember={isMember} focus={discoveryFocus} />
            </div>
          ) : lens === null && hasActiveCompounds(compoundFilters) ? (
            <div>
              <GroupSummary orgs={filteredOrgs} lens={lens} />
              <OrgList orgs={filteredOrgs} onOrgClick={handleOrgClick} isMember={isMember} focus={discoveryFocus} />
            </div>
          ) : lens === null ? (
            <DiscoveryMenu
              members={members}
              partners={partners}
              provinceCount={provinceCount}
              scaleCounts={scaleCounts}
              partnerCategoryCounts={partnerCategoryCounts}
              membersWithPos={membersWithPos}
              membersWithServices={membersWithServices}
              membersWithMandate={membersWithMandate}
              onSelectLens={setLens}
              user={user}
              focus={discoveryFocus}
            />
          ) : lens === "members" ? (
            <div>
              <GroupSummary orgs={filteredOrgs} lens={lens} />
              <OrgList orgs={filteredOrgs} onOrgClick={handleOrgClick} isMember={isMember} focus={discoveryFocus} />
            </div>
          ) : lens === "partners" ? (
            <div>
              <GroupSummary orgs={filteredOrgs} lens={lens} />
              <OrgList orgs={filteredOrgs} onOrgClick={handleOrgClick} isMember={isMember} focus={discoveryFocus} />
            </div>
          ) : lens === "partner_category" ? (
            <div>
              {/* Header summary */}
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                <p className="text-sm text-gray-600">
                  <span className="font-semibold text-gray-900">{partnersWithCategory}</span> categorized partners
                </p>
                {(checkedCategories.size > 0 || checkedSubcategories.size > 0 || compoundFilters.hasCatalogue) && (
                  <button
                    type="button"
                    onClick={() => { setCheckedCategories(new Set()); setCheckedSubcategories(new Set()); setCompoundFilters({}); }}
                    className="text-xs text-[#EE2A2E] hover:text-[#D92327] font-medium transition-colors"
                  >
                    Clear all
                  </button>
                )}
              </div>

              {/* Checkbox list */}
              <div className="overflow-y-auto p-3 space-y-1">
                {Object.entries(partnerCategoryCounts)
                  .sort(([, a], [, b]) => b - a)
                  .map(([category, count]) => {
                    const isChecked = checkedCategories.has(category);
                    const subsForCat = partnerSubcategoryCounts[category] ?? {};
                    const hasSubs = Object.keys(subsForCat).length > 0;
                    return (
                      <div key={category}>
                        {/* Parent category checkbox */}
                        <label className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-gray-50 cursor-pointer group">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {
                              setCheckedCategories((prev) => {
                                const next = new Set(prev);
                                if (next.has(category)) {
                                  next.delete(category);
                                  // Clear any subcategories belonging to this parent
                                  const catSubs = CATEGORY_SUBCATEGORIES[category] ?? [];
                                  setCheckedSubcategories((prevSubs) => {
                                    const ns = new Set(prevSubs);
                                    for (const s of catSubs) ns.delete(s);
                                    return ns;
                                  });
                                } else {
                                  next.add(category);
                                }
                                return next;
                              });
                            }}
                            className="h-4 w-4 rounded border-gray-300 text-[#EE2A2E] focus:ring-[#EE2A2E] cursor-pointer"
                          />
                          <span className={`flex-1 text-sm font-medium transition-colors ${isChecked ? "text-[#1A1A1A]" : "text-gray-700"}`}>
                            {category}
                          </span>
                          <span className="text-xs text-gray-400 tabular-nums">{count}</span>
                        </label>

                        {/* Subcategory checkboxes — shown when parent is checked and has subs */}
                        {isChecked && hasSubs && (
                          <div className="ml-7 mb-1 space-y-0.5">
                            {Object.entries(subsForCat)
                              .sort(([, a], [, b]) => b - a)
                              .map(([sub, subCount]) => {
                                const subChecked = checkedSubcategories.has(sub);
                                return (
                                  <label key={sub} className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-gray-50 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={subChecked}
                                      onChange={() => {
                                        setCheckedSubcategories((prev) => {
                                          const next = new Set(prev);
                                          next.has(sub) ? next.delete(sub) : next.add(sub);
                                          return next;
                                        });
                                      }}
                                      className="h-3.5 w-3.5 rounded border-gray-300 text-[#EE2A2E] focus:ring-[#EE2A2E] cursor-pointer"
                                    />
                                    <span className={`flex-1 text-xs transition-colors ${subChecked ? "text-[#1A1A1A] font-medium" : "text-gray-500"}`}>
                                      {sub}
                                    </span>
                                    <span className="text-[10px] text-gray-400 tabular-nums">{subCount}</span>
                                  </label>
                                );
                              })}
                          </div>
                        )}
                      </div>
                    );
                  })}

                {/* Has catalogue filter */}
                {partners.some((o) => o.catalogueUrl) && (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-3 mb-1">Resources</p>
                    <label className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={compoundFilters.hasCatalogue === "true"}
                        onChange={() => setCompoundFilters((f) => ({ ...f, hasCatalogue: f.hasCatalogue === "true" ? undefined : "true" }))}
                        className="h-4 w-4 rounded border-gray-300 text-[#EE2A2E] focus:ring-[#EE2A2E] cursor-pointer"
                      />
                      <span className="text-sm text-gray-700">Has catalogue</span>
                      <span className="text-xs text-gray-400 tabular-nums ml-auto">{partners.filter((o) => o.catalogueUrl).length}</span>
                    </label>
                  </div>
                )}
              </div>

              {/* Results */}
              {(checkedCategories.size > 0 || checkedSubcategories.size > 0 || compoundFilters.hasCatalogue) && (
                <div className="border-t border-gray-100">
                  <GroupSummary orgs={filteredOrgs} lens={lens} />
                  <OrgList orgs={filteredOrgs} onOrgClick={handleOrgClick} isMember={isMember} focus={discoveryFocus} />
                </div>
              )}
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
                        <p className="text-sm font-semibold text-gray-900 group-hover:text-[#EE2A2E] transition-colors">
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
              <OrgList orgs={filteredOrgs} onOrgClick={handleOrgClick} isMember={isMember} focus={discoveryFocus} />
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
                        <p className="text-sm font-semibold text-gray-900 group-hover:text-[#EE2A2E] transition-colors">
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
              <OrgList orgs={filteredOrgs} onOrgClick={handleOrgClick} isMember={isMember} focus={discoveryFocus} />
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
                        <p className="text-sm font-semibold text-gray-900 group-hover:text-[#EE2A2E] transition-colors">
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
              <OrgList orgs={filteredOrgs} onOrgClick={handleOrgClick} isMember={isMember} focus={discoveryFocus} />
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
                        <p className="text-sm font-semibold text-gray-900 group-hover:text-[#EE2A2E] transition-colors">
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
              <OrgList orgs={filteredOrgs} onOrgClick={handleOrgClick} isMember={isMember} focus={discoveryFocus} />
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
        <div className={`absolute top-0 bottom-0 right-0 z-20 bg-gray-50 overflow-y-auto ${persistent ? "pt-4" : "pt-20"} px-4 pb-4 left-[380px]`}>
          <DirectoryTable
            organizations={filteredOrgs}
            onOrgClick={handleOrgClick}
            searchRanking={searchRanking}
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
          `absolute ${persistent ? "top-4" : "top-20"} right-4 z-40 w-10 h-10 rounded-full`,
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
    </>
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
  partnerCategoryCounts,
  membersWithPos,
  membersWithServices,
  membersWithMandate,
  onSelectLens,
  user,
  focus,
}: {
  members: HomeMapOrg[];
  partners: HomeMapOrg[];
  provinceCount: number;
  scaleCounts: Record<ScaleRange, number>;
  partnerCategoryCounts: Record<string, number>;
  membersWithPos: number;
  membersWithServices: number;
  membersWithMandate: number;
  onSelectLens: (lens: ExploreLens) => void;
  user: unknown;
  focus: "all" | "members" | "partners";
}) {
  const totalScale = Object.values(scaleCounts).reduce((a, b) => a + b, 0);
  const totalPartnerCategories = Object.keys(partnerCategoryCounts).length;
  const partnerFocused = focus === "partners";
  const memberFocused = focus === "members";

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
          {!partnerFocused && (
            <button
              type="button"
              onClick={() => onSelectLens("members")}
              className="w-full rounded-xl border border-gray-200 px-4 py-3.5 text-left hover:border-red-200 hover:bg-red-50/30 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-[#EE2A2E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 group-hover:text-[#EE2A2E] transition-colors">
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
          )}

          {!memberFocused && (
            <button
              type="button"
              onClick={() => onSelectLens("partners")}
              className="w-full rounded-xl border border-gray-200 px-4 py-3.5 text-left hover:border-blue-200 hover:bg-blue-50/30 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-[#EE2A2E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0M12 12.75h.008v.008H12v-.008z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 group-hover:text-[#EE2A2E] transition-colors">
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
          )}
        </div>
      </div>

      <div className="border-t border-gray-100" />

      {/* Discover section */}
      <div>
        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Discover
        </p>
        <div className="space-y-2">
          {!partnerFocused && (
            <>
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
            </>
          )}

          {!memberFocused && (
            <button
              type="button"
              onClick={() => onSelectLens("partner_category")}
              className="w-full rounded-xl border border-gray-200 px-4 py-3.5 text-left hover:border-blue-200 hover:bg-blue-50/30 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-[#EE2A2E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 6A2.25 2.25 0 016 3.75h12A2.25 2.25 0 0120.25 6v12A2.25 2.25 0 0118 20.25H6A2.25 2.25 0 013.75 18V6z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.25 8.25h7.5M8.25 12h7.5M8.25 15.75h4.5" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 group-hover:text-[#EE2A2E] transition-colors">
                    By Partner Category
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Explore partners by primary category
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs font-medium text-gray-400">{totalPartnerCategories}</span>
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </button>
          )}
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
  focus,
}: {
  orgs: HomeMapOrg[];
  onOrgClick: (org: HomeMapOrg) => void;
  isMember: boolean;
  focus?: "all" | "members" | "partners";
}) {
  if (orgs.length === 0) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-gray-500">No organizations found.</p>
      </div>
    );
  }

  const isPartnerFocus = focus === "partners";

  return (
    <div className="divide-y divide-gray-100">
      {orgs.map((org) => (
        <button
          key={org.id}
          type="button"
          onClick={() => onOrgClick(org)}
          data-org-id={org.id}
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
              <p className="text-sm font-medium text-gray-900 truncate group-hover:text-[#EE2A2E] transition-colors">
                {org.name}
              </p>
              <p className="text-xs text-gray-500 truncate">
                {isPartnerFocus
                  ? (org.primaryCategory ?? "Industry partner")
                  : (orgSubtitle(org) || "Member institution")}
              </p>
            </div>
            <svg className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>

          {/* Partner card: category only — detail lives in the table */}
          {isPartnerFocus ? null : (
            /* Member card: data chips */
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
          )}
        </button>
      ))}
    </div>
  );
}

// OrgDetailPanel, GroupSummary, and CompoundFilterBar are imported from components/explore/
// Only DiscoveryMenu and OrgList remain inline below as map-sidebar-specific components.
