/**
 * The nominating committee's representation lens.
 *
 * This is what replaced the formal approval gate. The committee's real work
 * during the nomination window is conversational: talking to nominees who are
 * unlikely to be elected about whether they want to stand, and looking at
 * whether the emerging slate reflects the membership -- college and university,
 * large and small, across the country. That is human-in-the-loop review, not
 * electioneering, and it is continuous rather than a single yes/no moment.
 *
 * So the software's job is not to approve anything. It is to make the picture
 * legible WHILE THERE IS STILL TIME TO ACT ON IT, and to keep the comparison
 * honest by always showing the nominee pool against the membership it is drawn
 * from. A gap only means something next to the population.
 *
 * Nothing here gates, scores, or ranks a nominee. A committee that wants a
 * particular balance can see where it stands; the decision stays theirs.
 */

export type InstitutionType = "university" | "college" | "polytechnic" | "institute" | "other";

/**
 * By-Law No. 1 definitions (g) and (q): Eastern Region is east of Manitoba,
 * Western Region is Manitoba and west. Nothing in Part V uses these -- they are
 * vestigial in the elections process -- but they are the association's own
 * language for geography, which beats inventing a new split.
 *
 * `organizations.province` holds FULL NAMES ("British Columbia"), not the
 * two-letter codes an earlier version of this assumed -- which silently sorted
 * every institution into "unknown" and made the region breakdown useless without
 * erroring. Both forms are accepted, plus the French names, because a column
 * that is free text today can hold either tomorrow.
 */
const WESTERN = new Set([
  "MB", "SK", "AB", "BC", "YT", "NT", "NU",
  "MANITOBA", "SASKATCHEWAN", "ALBERTA", "BRITISH COLUMBIA", "YUKON",
  "NORTHWEST TERRITORIES", "NUNAVUT",
  "COLOMBIE-BRITANNIQUE", "TERRITOIRES DU NORD-OUEST",
]);

const EASTERN = new Set([
  "ON", "QC", "NB", "NS", "PE", "PEI", "NL", "NF",
  "ONTARIO", "QUEBEC", "QUÉBEC", "NEW BRUNSWICK", "NOVA SCOTIA",
  "PRINCE EDWARD ISLAND", "NEWFOUNDLAND AND LABRADOR", "NEWFOUNDLAND & LABRADOR",
  "NEWFOUNDLAND", "NOUVEAU-BRUNSWICK", "NOUVELLE-ÉCOSSE",
  "ÎLE-DU-PRINCE-ÉDOUARD", "TERRE-NEUVE-ET-LABRADOR",
]);

export type Region = "eastern" | "western" | "unknown";

export function resolveRegion(province: string | null): Region {
  if (!province) return "unknown";
  const key = province.trim().toUpperCase();
  if (WESTERN.has(key)) return "western";
  if (EASTERN.has(key)) return "eastern";
  // Unrecognized rather than guessed. An unfamiliar value showing as "unknown"
  // is a prompt to look; quietly filing it east would not be.
  return "unknown";
}

/** "BRITISH COLUMBIA" → "British Columbia", for display. */
export function titleCaseProvince(value: string): string {
  return value
    .toLowerCase()
    .replace(/(^|[\s\-])([a-zà-ÿ])/g, (_, sep, ch) => sep + ch.toUpperCase());
}

/**
 * Guess an institution type from the store's name.
 *
 * Deliberately a read-time derivation rather than a backfilled column: it is
 * right for 50 of CSC's 52 member stores, which is good enough to make the lens
 * useful on day one and NOT good enough to write over real records. A confirmed
 * value lives in `organizations.institution_type` and always wins; this only
 * fills the gap, and callers surface which is which so a committee never mistakes
 * a guess for a fact.
 */
export function deriveInstitutionType(name: string): InstitutionType {
  const n = name.toLowerCase();
  if (n.includes("polytechnic")) return "polytechnic";
  if (n.includes("universit")) return "university"; // universit-y / -é / -ies
  if (n.includes("college") || n.includes("collège") || n.includes("cégep") || n.includes("cegep"))
    return "college";
  if (n.includes("institut")) return "institute";
  return "other";
}

export function resolveInstitutionType(
  name: string,
  confirmed: string | null
): { value: InstitutionType; confirmed: boolean } {
  if (confirmed) return { value: confirmed as InstitutionType, confirmed: true };
  return { value: deriveInstitutionType(name), confirmed: false };
}

export type SizeBand = "small" | "medium" | "large";

/**
 * FTE bands. Thresholds are a presentation choice, not a rule from anywhere --
 * they exist so "size diversity" is discussable, and they are here in one place
 * so a committee that disagrees can move them without hunting through the UI.
 */
export const SIZE_BANDS: { band: SizeBand; label: string; maxFte: number | null }[] = [
  { band: "small", label: "Under 5,000 FTE", maxFte: 5_000 },
  { band: "medium", label: "5,000–19,999 FTE", maxFte: 20_000 },
  { band: "large", label: "20,000+ FTE", maxFte: null },
];

export function resolveSizeBand(fte: number | null): SizeBand | null {
  if (fte === null || fte === undefined) return null;
  for (const b of SIZE_BANDS) {
    if (b.maxFte === null || fte < b.maxFte) return b.band;
  }
  return "large";
}

export interface OrgProfile {
  organizationId: string;
  name: string;
  province: string | null;
  fte: number | null;
  institutionTypeConfirmed: string | null;
}

export interface DimensionBreakdown {
  key: string;
  label: string;
  /** Bucket → count among the nominee pool. */
  nominees: Record<string, number>;
  /** Bucket → count among eligible member institutions. */
  membership: Record<string, number>;
  /**
   * Buckets present in the membership but absent from the nominee pool. Stated
   * as an observation for the committee, never as a defect to be corrected.
   */
  unrepresented: string[];
  /** True where any institution in this dimension relied on a derived guess. */
  containsDerivedValues: boolean;
}

export interface RepresentationSnapshot {
  nomineeCount: number;
  /** Distinct institutions the nominees come from. */
  nomineeOrgCount: number;
  eligibleOrgCount: number;
  dimensions: DimensionBreakdown[];
  /** Institutions with more than one nominee — worth the committee knowing. */
  orgsWithMultipleNominees: { organizationId: string; name: string; count: number }[];
}

function tally(values: (string | null)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) {
    const key = v ?? "unknown";
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

/**
 * Compare the nominee pool against the eligible membership across the three
 * dimensions the committee actually talks about.
 *
 * `nomineeOrgs` may contain the same institution more than once where it has put
 * forward several nominees; that repetition is meaningful and is preserved.
 */
export function buildRepresentationSnapshot(
  nomineeOrgs: OrgProfile[],
  eligibleOrgs: OrgProfile[]
): RepresentationSnapshot {
  const typeOf = (o: OrgProfile) => resolveInstitutionType(o.name, o.institutionTypeConfirmed);

  const anyDerived = (orgs: OrgProfile[]) => orgs.some((o) => !typeOf(o).confirmed);

  const dimensions: DimensionBreakdown[] = [
    {
      key: "institution_type",
      label: "Institution type",
      nominees: tally(nomineeOrgs.map((o) => typeOf(o).value)),
      membership: tally(eligibleOrgs.map((o) => typeOf(o).value)),
      unrepresented: [],
      containsDerivedValues: anyDerived([...nomineeOrgs, ...eligibleOrgs]),
    },
    {
      key: "region",
      label: "Region",
      nominees: tally(nomineeOrgs.map((o) => resolveRegion(o.province))),
      membership: tally(eligibleOrgs.map((o) => resolveRegion(o.province))),
      unrepresented: [],
      containsDerivedValues: false,
    },
    {
      key: "province",
      label: "Province",
      nominees: tally(nomineeOrgs.map((o) => o.province?.toUpperCase() ?? null)),
      membership: tally(eligibleOrgs.map((o) => o.province?.toUpperCase() ?? null)),
      unrepresented: [],
      containsDerivedValues: false,
    },
    {
      key: "size",
      label: "Size",
      nominees: tally(nomineeOrgs.map((o) => resolveSizeBand(o.fte))),
      membership: tally(eligibleOrgs.map((o) => resolveSizeBand(o.fte))),
      unrepresented: [],
      containsDerivedValues: false,
    },
  ];

  for (const d of dimensions) {
    d.unrepresented = Object.keys(d.membership).filter((bucket) => !d.nominees[bucket]);
  }

  const byOrg = new Map<string, { organizationId: string; name: string; count: number }>();
  for (const o of nomineeOrgs) {
    const existing = byOrg.get(o.organizationId);
    if (existing) existing.count++;
    else byOrg.set(o.organizationId, { organizationId: o.organizationId, name: o.name, count: 1 });
  }

  return {
    nomineeCount: nomineeOrgs.length,
    nomineeOrgCount: byOrg.size,
    eligibleOrgCount: eligibleOrgs.length,
    dimensions,
    orgsWithMultipleNominees: [...byOrg.values()].filter((o) => o.count > 1),
  };
}
