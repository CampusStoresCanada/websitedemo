import { supabase } from "@/lib/supabase";
import { applyFieldMask, loadVisibilityConfig } from "@/lib/visibility/engine";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HomeMapOrg {
  id: string;
  slug: string;
  name: string;
  type: string;
  city: string | null;
  province: string | null;
  latitude: number | null;
  longitude: number | null;
  logoUrl: string | null;
  website: string | null;
  primaryCategory: string | null;
  organizationType: string | null;
  fte: number | null;
  /** Enrollment FTE from benchmarking — for By Scale lens */
  enrollmentFte: number | null;
  /** POS system from benchmarking — for Same Platform lens */
  posSystem: string | null;
  /** Services offered from benchmarking — for Services Offered lens */
  servicesOffered: string[] | null;
  /** Operations mandate from benchmarking — for Operating Model lens */
  operationsMandate: string | null;
  /** Number of store locations from benchmarking */
  numLocations: number | null;
  /** Total square footage from benchmarking */
  totalSquareFootage: number | null;
  /** Payment options from benchmarking */
  paymentOptions: string[] | null;
  /** Shopping services from benchmarking (e.g., Online, In-Store) */
  shoppingServices: string[] | null;
  /** LMS system from benchmarking */
  lmsSystem: string | null;
  /** Social media platforms from benchmarking */
  socialMediaPlatforms: string[] | null;
  /** Institution type from benchmarking */
  institutionType: string | null;
  /** Full-time employees from benchmarking */
  fulltimeEmployees: number | null;
}

interface HomeOrgRecord extends HomeMapOrg {
  companyDescription: string | null;
}

interface BenchmarkingSlice {
  orgId: string;
  posSystem: string | null;
  enrollmentFte: number | null;
  numLocations: number | null;
  totalSquareFootage: number | null;
  servicesOffered: string[] | null;
  operationsMandate: string | null;
  paymentOptions: string[] | null;
  shoppingServices: string[] | null;
  lmsSystem: string | null;
  socialMediaPlatforms: string[] | null;
  institutionType: string | null;
  fulltimeEmployees: number | null;
}

export interface MapStory {
  id: string;
  storyType:
    | "city_cluster"
    | "pos_ecosystem"
    | "institution_region"
    | "category_region"
    | "metric_region"
    | "partner_coverage"
    | "shared_services"
    | "shared_mandate"
    | "member_spotlight"
    | "partner_spotlight";
  title: string;
  description: string;
  center: { lat: number; lng: number };
  zoom: number;
  highlightedOrgIds: string[];
  highlightField: string;
  highlightValues: string[];
  /** Common traits surfaced for the group — shown as chips in the story card */
  commonTraits?: string[];
  spotlight?: {
    name: string | null;
    city: string | null;
    province: string | null;
    teaser: string | null;
    nameMasked: boolean;
    teaserMasked: boolean;
    fte: number | null;
    numLocations: number | null;
    posSystem: string | null;
  };
}

export interface HomePageStats {
  activeMembers: number;
  activePartners: number;
  provincesRepresented: number;
  totalFteServed: number;
}

export interface HomePageData {
  mapOrgs: HomeMapOrg[];
  stories: MapStory[];
  stats: HomePageStats;
  memberOrgs: Array<Pick<HomeMapOrg, "id" | "slug" | "name" | "province" | "organizationType" | "logoUrl">>;
  partnerOrgs: Array<Pick<HomeMapOrg, "id" | "slug" | "name" | "province" | "primaryCategory" | "logoUrl">>;
}

// ---------------------------------------------------------------------------
// Geography helpers
// ---------------------------------------------------------------------------

const CANADA_CENTER = { lat: 56, lng: -96 };

const PROVINCE_CENTERS: Record<string, { lat: number; lng: number }> = {
  "British Columbia": { lat: 53.7267, lng: -127.6476 },
  Alberta: { lat: 53.9333, lng: -116.5765 },
  Saskatchewan: { lat: 52.9399, lng: -106.4509 },
  Manitoba: { lat: 53.7609, lng: -98.8139 },
  Ontario: { lat: 50.0007, lng: -85.3232 },
  Quebec: { lat: 52.9399, lng: -73.5491 },
  "New Brunswick": { lat: 46.5653, lng: -66.4619 },
  "Nova Scotia": { lat: 44.682, lng: -63.7443 },
  "Prince Edward Island": { lat: 46.5107, lng: -63.4168 },
  "Newfoundland and Labrador": { lat: 53.1355, lng: -57.6604 },
  Yukon: { lat: 64.2823, lng: -135.0 },
  "Northwest Territories": { lat: 64.8255, lng: -124.8457 },
  Nunavut: { lat: 70.2998, lng: -83.1076 },
};

function resolveCoord(org: HomeMapOrg): { lat: number; lng: number } | null {
  if (org.latitude && org.longitude) return { lat: org.latitude, lng: org.longitude };
  if (org.province && PROVINCE_CENTERS[org.province]) return PROVINCE_CENTERS[org.province];
  return null;
}

function orgCenter(orgs: HomeMapOrg[]): { lat: number; lng: number } {
  const coords = orgs.map(resolveCoord).filter((c): c is { lat: number; lng: number } => c !== null);
  if (coords.length === 0) return CANADA_CENTER;
  const lat = coords.reduce((sum, c) => sum + c.lat, 0) / coords.length;
  const lng = coords.reduce((sum, c) => sum + c.lng, 0) / coords.length;
  return { lat, lng };
}

/** Compute zoom from the geographic spread of a set of orgs. Tight cluster = high zoom. */
function computeZoom(orgs: HomeMapOrg[]): number {
  const coords = orgs.map(resolveCoord).filter((c): c is { lat: number; lng: number } => c !== null);
  if (coords.length <= 1) return 9; // single org — tight city zoom

  const lats = coords.map((c) => c.lat);
  const lngs = coords.map((c) => c.lng);
  const latSpan = Math.max(...lats) - Math.min(...lats);
  const lngSpan = Math.max(...lngs) - Math.min(...lngs);
  const span = Math.max(latSpan, lngSpan * 0.7, 0.01); // lngSpan weighted for Mercator

  // log2(360/span) gives ~base zoom; offset tuned for Mapbox
  const raw = Math.log2(360 / span) - 0.5;
  return Math.min(10, Math.max(4.5, raw));
}

// ---------------------------------------------------------------------------
// Data normalization
// ---------------------------------------------------------------------------

function normalizeMapOrg(row: Record<string, unknown>): HomeOrgRecord {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    type: String(row.type ?? ""),
    city: (row.city as string | null) ?? null,
    province: (row.province as string | null) ?? null,
    latitude: typeof row.latitude === "number" ? row.latitude : null,
    longitude: typeof row.longitude === "number" ? row.longitude : null,
    logoUrl: (row.logo_url as string | null) ?? null,
    website: (row.website as string | null) ?? null,
    primaryCategory: (row.primary_category as string | null) ?? null,
    organizationType: (row.organization_type as string | null) ?? null,
    fte: typeof row.fte === "number" ? row.fte : null,
    companyDescription: (row.company_description as string | null) ?? null,
    enrollmentFte: null, // populated from benchmarking data later
    posSystem: null,
    servicesOffered: null,
    operationsMandate: null,
    numLocations: null,
    totalSquareFootage: null,
    paymentOptions: null,
    shoppingServices: null,
    lmsSystem: null,
    socialMediaPlatforms: null,
    institutionType: null,
    fulltimeEmployees: null,
  };
}

// ---------------------------------------------------------------------------
// Story generation helpers
// ---------------------------------------------------------------------------

/** Simple seeded PRNG — produces a deterministic float in [0,1). */
function seededRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return (s >>> 0) / 4294967296;
  };
}

/** Shuffle array in-place using a seeded PRNG — deterministic per ISR cycle. */
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const rng = seededRandom(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Time-rotating seed — changes every ~60s (ISR cycle). */
function cycleSeed(): number {
  return Math.floor(Date.now() / 60_000);
}

/** Group items by a key function. */
function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const current = map.get(key) ?? [];
    current.push(item);
    map.set(key, current);
  }
  return map;
}

interface StoryCandidate {
  story: MapStory;
  score: number;
}

function scoreCandidate(orgs: HomeMapOrg[], hasBenchmarking: boolean): number {
  const coords = orgs.map(resolveCoord).filter((c): c is { lat: number; lng: number } => c !== null);
  let tightness = 0;
  if (coords.length >= 2) {
    const lats = coords.map((c) => c.lat);
    const lngs = coords.map((c) => c.lng);
    const span = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lngs) - Math.min(...lngs));
    if (span < 1) tightness = 3;
    else if (span < 5) tightness = 2;
    else if (span < 15) tightness = 1;
  }
  const richness = hasBenchmarking ? 2 : 0;
  const count = Math.min(orgs.length, 5);
  return tightness + richness + count;
}

// ---------------------------------------------------------------------------
// Commonality mining — find shared traits across a group of orgs
// ---------------------------------------------------------------------------

function findCommonTraits(
  orgIds: string[],
  benchByOrg: Map<string, BenchmarkingSlice>
): string[] {
  const slices = orgIds.map((id) => benchByOrg.get(id)).filter((s): s is BenchmarkingSlice => !!s);
  if (slices.length < 2) return [];

  const traits: string[] = [];

  // Shared POS system
  const posCounts = new Map<string, number>();
  for (const s of slices) {
    if (s.posSystem) posCounts.set(s.posSystem, (posCounts.get(s.posSystem) ?? 0) + 1);
  }
  for (const [pos, count] of posCounts) {
    if (count >= 2) traits.push(`${count} run ${pos}`);
  }

  // Shared operations mandate
  const mandateCounts = new Map<string, number>();
  for (const s of slices) {
    if (s.operationsMandate) mandateCounts.set(s.operationsMandate, (mandateCounts.get(s.operationsMandate) ?? 0) + 1);
  }
  for (const [mandate, count] of mandateCounts) {
    if (count >= 2) traits.push(`${count} ${mandate.toLowerCase()}`);
  }

  // Shared services (intersection of at least 2 orgs)
  const serviceCounts = new Map<string, number>();
  for (const s of slices) {
    for (const svc of s.servicesOffered ?? []) {
      serviceCounts.set(svc, (serviceCounts.get(svc) ?? 0) + 1);
    }
  }
  const sharedServices = [...serviceCounts.entries()]
    .filter(([, count]) => count >= Math.ceil(slices.length * 0.5))
    .map(([svc]) => svc);
  if (sharedServices.length > 0) {
    traits.push(`shared: ${sharedServices.slice(0, 3).join(", ")}`);
  }

  // Shared LMS
  const lmsCounts = new Map<string, number>();
  for (const s of slices) {
    if (s.lmsSystem) lmsCounts.set(s.lmsSystem, (lmsCounts.get(s.lmsSystem) ?? 0) + 1);
  }
  for (const [lms, count] of lmsCounts) {
    if (count >= 2) traits.push(`${count} on ${lms}`);
  }

  return traits.slice(0, 4); // cap at 4 chips
}

// ---------------------------------------------------------------------------
// Spotlight stories (with visibility masking)
// ---------------------------------------------------------------------------

async function createSpotlightStory(
  org: HomeOrgRecord,
  storyType: "member_spotlight" | "partner_spotlight",
  bench: BenchmarkingSlice | undefined
): Promise<MapStory> {
  const visibility = await loadVisibilityConfig();
  const masked = applyFieldMask(
    { name: org.name, company_description: org.companyDescription },
    "public",
    visibility,
    "organizations",
    false,
    org.type
  );

  const maskedNameRaw =
    typeof masked.name === "string" && masked.name.trim().length > 0 ? masked.name : null;
  const maskedTeaserRaw =
    typeof masked.company_description === "string" ? masked.company_description : null;
  const nameMasked = maskedNameRaw !== org.name;
  const teaserMasked = maskedTeaserRaw !== org.companyDescription;
  const displayName = maskedNameRaw ?? "Organization";

  // Build a meaningful description from available data
  const details: string[] = [];
  if (org.city && org.province) details.push(`${org.city}, ${org.province}`);
  else if (org.province) details.push(org.province);
  if (org.fte) details.push(`${org.fte.toLocaleString()} FTE`);
  if (bench?.numLocations && bench.numLocations > 1)
    details.push(`${bench.numLocations} locations`);
  if (bench?.posSystem) details.push(`runs ${bench.posSystem}`);

  const description =
    details.length > 0
      ? `${displayName} — ${details.join(" · ")}`
      : `${displayName} in ${org.city ?? "Canada"}`;

  return {
    id: `${storyType}-${org.id}`,
    storyType,
    title: storyType === "member_spotlight" ? "Member Spotlight" : "Partner Spotlight",
    description,
    center: orgCenter([org]),
    zoom: 9,
    highlightedOrgIds: [org.id],
    highlightField: "spotlight",
    highlightValues: [displayName],
    spotlight: {
      name: maskedNameRaw,
      city: org.city,
      province: org.province,
      teaser: maskedTeaserRaw,
      nameMasked,
      teaserMasked,
      fte: org.fte,
      numLocations: bench?.numLocations ?? null,
      posSystem: bench?.posSystem ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Shared fetch helper — orgs + benchmarking merge
// ---------------------------------------------------------------------------

async function fetchMapOrgsWithBenchmarking(
  typeFilter?: "Member" | "Vendor Partner"
): Promise<{ orgRecords: HomeOrgRecord[]; benchByOrg: Map<string, BenchmarkingSlice> } | null> {
  let orgQuery = supabase
    .from("organizations")
    .select(
      "id, slug, name, type, membership_status, city, province, latitude, longitude, logo_url, website, primary_category, organization_type, fte, company_description"
    )
    .eq("membership_status", "active")
    .is("archived_at", null)
    .order("name", { ascending: true });

  if (typeFilter) {
    orgQuery = orgQuery.eq("type", typeFilter);
  }

  const [orgResult, benchResult] = await Promise.all([
    orgQuery,
    supabase
      .from("benchmarking")
      .select("organization_id, pos_system, enrollment_fte, num_store_locations, total_square_footage, services_offered, operations_mandate, payment_options, shopping_services, lms_system, social_media_platforms, institution_type, fulltime_employees")
      .order("fiscal_year", { ascending: false }),
  ]);

  if (orgResult.error) {
    console.error("org query failed:", orgResult.error);
    return null;
  }

  // Build benchmarking lookup — latest record per org (already sorted by fiscal_year desc)
  const benchByOrg = new Map<string, BenchmarkingSlice>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase infers `never` for wide selects
  for (const row of (benchResult.data ?? []) as Record<string, any>[]) {
    const orgId = String(row.organization_id);
    if (benchByOrg.has(orgId)) continue; // first row = latest year
    benchByOrg.set(orgId, {
      orgId,
      posSystem: (row.pos_system as string | null) ?? null,
      enrollmentFte: typeof row.enrollment_fte === "number" ? row.enrollment_fte : null,
      numLocations: typeof row.num_store_locations === "number" ? row.num_store_locations : null,
      totalSquareFootage: typeof row.total_square_footage === "number" ? row.total_square_footage : null,
      servicesOffered: Array.isArray(row.services_offered) ? (row.services_offered as string[]) : null,
      operationsMandate: (row.operations_mandate as string | null) ?? null,
      paymentOptions: Array.isArray(row.payment_options) ? (row.payment_options as string[]) : null,
      shoppingServices: Array.isArray(row.shopping_services) ? (row.shopping_services as string[]) : null,
      lmsSystem: (row.lms_system as string | null) ?? null,
      socialMediaPlatforms: Array.isArray(row.social_media_platforms) ? (row.social_media_platforms as string[]) : null,
      institutionType: (row.institution_type as string | null) ?? null,
      fulltimeEmployees: typeof row.fulltime_employees === "number" ? row.fulltime_employees : null,
    });
  }

  const orgRecords = (orgResult.data ?? []).map((row) => normalizeMapOrg(row as Record<string, unknown>));
  return { orgRecords, benchByOrg };
}

/** Merge benchmarking slices onto org records and strip companyDescription. */
function mergeOrgsWithBenchmarking(
  orgRecords: HomeOrgRecord[],
  benchByOrg: Map<string, BenchmarkingSlice>
): HomeMapOrg[] {
  return orgRecords.map((org) => {
    const { companyDescription, ...publicOrg } = org;
    void companyDescription;
    const bench = benchByOrg.get(org.id);
    return {
      ...publicOrg,
      enrollmentFte: bench?.enrollmentFte ?? null,
      posSystem: bench?.posSystem ?? null,
      servicesOffered: bench?.servicesOffered ?? null,
      operationsMandate: bench?.operationsMandate ?? null,
      numLocations: bench?.numLocations ?? null,
      totalSquareFootage: bench?.totalSquareFootage ?? null,
      paymentOptions: bench?.paymentOptions ?? null,
      shoppingServices: bench?.shoppingServices ?? null,
      lmsSystem: bench?.lmsSystem ?? null,
      socialMediaPlatforms: bench?.socialMediaPlatforms ?? null,
      institutionType: bench?.institutionType ?? null,
      fulltimeEmployees: bench?.fulltimeEmployees ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Members / Partners page data
// ---------------------------------------------------------------------------

export interface DirectoryPageData {
  mapOrgs: HomeMapOrg[];
}

export async function getMembersPageData(): Promise<DirectoryPageData> {
  const result = await fetchMapOrgsWithBenchmarking("Member");
  if (!result) return { mapOrgs: [] };
  return { mapOrgs: mergeOrgsWithBenchmarking(result.orgRecords, result.benchByOrg) };
}

export async function getPartnersPageData(): Promise<DirectoryPageData> {
  const result = await fetchMapOrgsWithBenchmarking("Vendor Partner");
  if (!result) return { mapOrgs: [] };
  return { mapOrgs: mergeOrgsWithBenchmarking(result.orgRecords, result.benchByOrg) };
}

// ---------------------------------------------------------------------------
// Main data function
// ---------------------------------------------------------------------------

const EMPTY_DATA: HomePageData = {
  mapOrgs: [],
  stories: [],
  stats: { activeMembers: 0, activePartners: 0, provincesRepresented: 0, totalFteServed: 0 },
  memberOrgs: [],
  partnerOrgs: [],
};

export async function getHomePageData(): Promise<HomePageData> {
  // 1. Fetch active orgs + latest benchmarking in parallel
  const result = await fetchMapOrgsWithBenchmarking();
  if (!result) return EMPTY_DATA;

  const { orgRecords, benchByOrg } = result;
  const members = orgRecords.filter((org) => org.type === "Member");
  const partners = orgRecords.filter((org) => org.type === "Vendor Partner");

  const provinceSet = new Set(orgRecords.map((org) => org.province).filter(Boolean));
  const totalFteServed = members.reduce((sum, org) => sum + (org.fte ?? 0), 0);

  // 3. Generate ALL story candidates — large pool, randomized later
  const candidates: StoryCandidate[] = [];
  const seed = cycleSeed();

  // --- City clusters (members in the same city, 2+) ---
  const membersByCity = groupBy(
    members.filter((m) => m.city),
    (m) => `${m.city!.toLowerCase()}::${(m.province ?? "").toLowerCase()}`
  );
  for (const [key, orgs] of membersByCity) {
    if (orgs.length < 2) continue;
    const cityName = orgs[0].city!;
    const provName = orgs[0].province ?? "";
    const traits = findCommonTraits(orgs.map((o) => o.id), benchByOrg);
    const traitDesc = traits.length > 0
      ? traits.slice(0, 2).join(" · ")
      : `a local community in ${provName}`;
    candidates.push({
      story: {
        id: `city-cluster-${key}`,
        storyType: "city_cluster",
        title: `${orgs.length} campus stores in ${cityName}`,
        description: traitDesc,
        center: orgCenter(orgs),
        zoom: computeZoom(orgs),
        highlightedOrgIds: orgs.map((o) => o.id),
        highlightField: "city",
        highlightValues: [cityName],
        commonTraits: traits,
      },
      score: scoreCandidate(orgs, traits.length > 0) + 2,
    });
  }

  // --- POS ecosystem (orgs sharing a POS system, 2+) ---
  const orgsByPos = new Map<string, HomeMapOrg[]>();
  for (const org of members) {
    const bench = benchByOrg.get(org.id);
    if (!bench?.posSystem) continue;
    const current = orgsByPos.get(bench.posSystem) ?? [];
    current.push(org);
    orgsByPos.set(bench.posSystem, current);
  }
  for (const [pos, orgs] of orgsByPos) {
    if (orgs.length < 2) continue;
    const traits = findCommonTraits(orgs.map((o) => o.id), benchByOrg);
    candidates.push({
      story: {
        id: `pos-${pos.toLowerCase().replace(/\s+/g, "-")}`,
        storyType: "pos_ecosystem",
        title: `${orgs.length} stores running ${pos}`,
        description: `Same POS platform — easy to compare operations and share tips.`,
        center: orgCenter(orgs),
        zoom: computeZoom(orgs),
        highlightedOrgIds: orgs.map((o) => o.id),
        highlightField: "pos_system",
        highlightValues: [pos],
        commonTraits: traits,
      },
      score: scoreCandidate(orgs, true) + 1,
    });
  }

  // --- Shared operations mandate across provinces (2+) ---
  const orgsByMandate = new Map<string, HomeMapOrg[]>();
  for (const org of members) {
    const bench = benchByOrg.get(org.id);
    if (!bench?.operationsMandate) continue;
    const current = orgsByMandate.get(bench.operationsMandate) ?? [];
    current.push(org);
    orgsByMandate.set(bench.operationsMandate, current);
  }
  for (const [mandate, orgs] of orgsByMandate) {
    if (orgs.length < 2) continue;
    const provs = [...new Set(orgs.map((o) => o.province).filter(Boolean))];
    const traits = findCommonTraits(orgs.map((o) => o.id), benchByOrg);
    candidates.push({
      story: {
        id: `mandate-${mandate.toLowerCase().replace(/\s+/g, "-")}`,
        storyType: "shared_mandate",
        title: `${mandate} stores`,
        description: `${orgs.length} stores with the same operating model${provs.length > 1 ? ` across ${provs.length} provinces` : ""}.`,
        center: orgCenter(orgs),
        zoom: computeZoom(orgs),
        highlightedOrgIds: orgs.map((o) => o.id),
        highlightField: "operations_mandate",
        highlightValues: [mandate],
        commonTraits: traits,
      },
      score: scoreCandidate(orgs, true),
    });
  }

  // --- Shared services (orgs offering the same services, 3+) ---
  const serviceOrgs = new Map<string, HomeMapOrg[]>();
  for (const org of members) {
    const bench = benchByOrg.get(org.id);
    for (const svc of bench?.servicesOffered ?? []) {
      const current = serviceOrgs.get(svc) ?? [];
      current.push(org);
      serviceOrgs.set(svc, current);
    }
  }
  for (const [svc, orgs] of serviceOrgs) {
    if (orgs.length < 3) continue;
    const traits = findCommonTraits(orgs.map((o) => o.id), benchByOrg);
    candidates.push({
      story: {
        id: `service-${svc.toLowerCase().replace(/\s+/g, "-")}`,
        storyType: "shared_services",
        title: `Stores offering ${svc.toLowerCase()}`,
        description: `${orgs.length} members provide this service — a chance to compare approaches.`,
        center: orgCenter(orgs),
        zoom: computeZoom(orgs),
        highlightedOrgIds: orgs.map((o) => o.id),
        highlightField: "services_offered",
        highlightValues: [svc],
        commonTraits: traits,
      },
      score: scoreCandidate(orgs, true),
    });
  }

  // --- Institution type + region (2+) ---
  const membersByTypeProvince = groupBy(
    members.filter((m) => m.organizationType && m.province),
    (m) => `${m.organizationType}::${m.province}`
  );
  for (const [key, orgs] of membersByTypeProvince) {
    if (orgs.length < 2) continue;
    const [orgType, province] = key.split("::");
    const traits = findCommonTraits(orgs.map((o) => o.id), benchByOrg);
    candidates.push({
      story: {
        id: `inst-region-${key.replace(/\s+/g, "-").toLowerCase()}`,
        storyType: "institution_region",
        title: `${orgType}s in ${province}`,
        description: traits.length > 0
          ? traits.slice(0, 2).join(" · ")
          : `${orgs.length} peer institutions with similar mandates.`,
        center: orgCenter(orgs),
        zoom: computeZoom(orgs),
        highlightedOrgIds: orgs.map((o) => o.id),
        highlightField: "institution_type",
        highlightValues: [orgType],
        commonTraits: traits,
      },
      score: scoreCandidate(orgs, traits.length > 0),
    });
  }

  // --- Partner coverage by category (2+) ---
  const partnersByCategory = groupBy(
    partners.filter((p) => p.primaryCategory),
    (p) => p.primaryCategory!
  );
  for (const [category, orgs] of partnersByCategory) {
    if (orgs.length < 2) continue;
    candidates.push({
      story: {
        id: `partner-cat-${category.toLowerCase().replace(/\s+/g, "-")}`,
        storyType: "partner_coverage",
        title: `${category} partners`,
        description: `${orgs.length} vendors serving campus stores coast to coast.`,
        center: orgCenter(orgs),
        zoom: computeZoom(orgs),
        highlightedOrgIds: orgs.map((o) => o.id),
        highlightField: "category",
        highlightValues: [category],
      },
      score: scoreCandidate(orgs, false),
    });
  }

  // --- Top FTE in a province (top 5 with FTE data) ---
  const fteByProvince = groupBy(
    members.filter((m) => m.province && typeof m.fte === "number" && m.fte > 0),
    (m) => m.province!
  );
  for (const [province, orgs] of fteByProvince) {
    if (orgs.length < 3) continue;
    const top = [...orgs].sort((a, b) => (b.fte ?? 0) - (a.fte ?? 0)).slice(0, 5);
    const totalFte = top.reduce((sum, o) => sum + (o.fte ?? 0), 0);
    const traits = findCommonTraits(top.map((o) => o.id), benchByOrg);
    candidates.push({
      story: {
        id: `fte-${province.toLowerCase().replace(/\s+/g, "-")}`,
        storyType: "metric_region",
        title: `Largest stores in ${province}`,
        description: `Serving ${totalFte.toLocaleString()} students combined.`,
        center: orgCenter(top),
        zoom: computeZoom(top),
        highlightedOrgIds: top.map((o) => o.id),
        highlightField: "fte",
        highlightValues: [totalFte.toLocaleString()],
        commonTraits: traits,
      },
      score: scoreCandidate(top, traits.length > 0),
    });
  }

  // 4. Shuffle, then pick a diverse window of stories
  //    Shuffle ensures different stories surface each ISR cycle (~60s).
  //    We still sort by score within the shuffled pool so higher-quality
  //    stories are more likely to appear, but the randomization breaks
  //    the deterministic ordering.
  seededShuffle(candidates, seed);
  // Stable-ish: group by score bucket (high/med/low) then shuffle within
  const HIGH = candidates.filter((c) => c.score >= 8);
  const MED = candidates.filter((c) => c.score >= 5 && c.score < 8);
  const LOW = candidates.filter((c) => c.score < 5);
  const ranked = [...HIGH, ...MED, ...LOW];

  const stories: MapStory[] = [];
  const MAX_STORIES = 10;
  const typeLimit = 2; // max 2 per story type

  for (const candidate of ranked) {
    if (stories.length >= MAX_STORIES) break;
    const typeCount = stories.filter((s) => s.storyType === candidate.story.storyType).length;
    if (typeCount >= typeLimit) continue;
    stories.push(candidate.story);
  }

  // 5. Spotlights — seeded random pick, not always first
  const rng = seededRandom(seed + 7); // offset seed so it's different from shuffle
  if (members.length > 0) {
    const idx = Math.floor(rng() * members.length);
    stories.push(
      await createSpotlightStory(members[idx], "member_spotlight", benchByOrg.get(members[idx].id))
    );
  }
  if (partners.length > 0) {
    const idx = Math.floor(rng() * partners.length);
    stories.push(
      await createSpotlightStory(partners[idx], "partner_spotlight", benchByOrg.get(partners[idx].id))
    );
  }

  // 6. Return projection-only payloads
  return {
    mapOrgs: mergeOrgsWithBenchmarking(orgRecords, benchByOrg),
    stories,
    stats: {
      activeMembers: members.length,
      activePartners: partners.length,
      provincesRepresented: provinceSet.size,
      totalFteServed,
    },
    memberOrgs: members.map((org) => ({
      id: org.id,
      slug: org.slug,
      name: org.name,
      province: org.province,
      organizationType: org.organizationType,
      logoUrl: org.logoUrl,
    })),
    partnerOrgs: partners.map((org) => ({
      id: org.id,
      slug: org.slug,
      name: org.name,
      province: org.province,
      primaryCategory: org.primaryCategory,
      logoUrl: org.logoUrl,
    })),
  };
}
