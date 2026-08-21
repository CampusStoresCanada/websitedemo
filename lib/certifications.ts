/**
 * Canonical list of partner certifications.
 * Slug maps 1:1 to /public/certifications/{slug}.svg
 */
export interface Certification {
  name: string;
  slug: string;
  /** Full filename in /public/certifications/ — defaults to {slug}.svg if omitted */
  filename?: string;
  description: string;
}

export const CERTIFICATIONS: Certification[] = [
  {
    name: "B Corp",
    slug: "bcorp",
    description: "B Corp — a business standard focused on balancing profit with social and environmental responsibility.",
  },
  {
    name: "Canadian Owned",
    slug: "canadian-owned",
    description: "Canadian Owned — majority ownership and operation by Canadian residents or citizens.",
  },
  {
    name: "Fair Labour",
    slug: "fair-labour",
    description: "Fair Labour — products made under conditions that prioritize safe workplaces, fair wages, and workers' rights throughout the supply chain.",
  },
  {
    name: "Fair Trade",
    slug: "fair-trade",
    description: "Fair Trade — products sourced to support equitable pricing, safe conditions, and sustainable livelihoods for producers.",
  },
  {
    name: "Indigenous Owned",
    slug: "indigenous-owned",
    description: "Indigenous Owned — majority owned and operated by First Nations, Métis, or Inuit peoples.",
  },
  {
    name: "Women Owned",
    slug: "women-owned",
    description: "Women Owned — majority owned and operated by women.",
  },
  {
    name: "Buy Ontario",
    slug: "buy-ontario",
    filename: "Buy Ontario.svg",
    description: "Buy Ontario — procurement initiative prioritizing goods and services produced in Ontario.",
  },
  {
    name: "En Français",
    slug: "en-francais",
    filename: "En Francais.svg",
    description: "En Français — vendor offers products, services, and support in French.",
  },
];

/** CANCOLL is not a self-declared certification — it's admin-managed and visibility-gated */
export const CANCOLL_CERT: Certification = {
  name: "CANCOLL",
  slug: "cancoll",
  filename: "CANCOLL.jpeg",
  description: "Canada's largest college & university purchasing group — negotiates discounted pricing with vendors to help campus stores save students money.",
};

/** Map from certification name → config — includes CANCOLL for rendering */
export const CERTIFICATION_BY_NAME = Object.fromEntries(
  [...CERTIFICATIONS, CANCOLL_CERT].map((c) => [c.name, c])
);

/** All valid certification names — use for validation */
export const CERTIFICATION_NAMES = CERTIFICATIONS.map((c) => c.name);

/**
 * "Exhibitor" — a DERIVED badge, not a stored one.
 *
 * Unlike CERTIFICATIONS (self-declared, toggled by the org) and CANCOLL
 * (admin-toggled), this one is computed from booth ownership every render —
 * it must never be written into `organizations.certifications`, or it would
 * survive a booth being released and become a lie the org can't clear.
 * That's why it's a factory rather than a constant: the description carries
 * the live booth numbers.
 *
 * See lib/conference/exhibitor-status.ts for where the booths come from.
 */
/**
 * "New Partner" — a DERIVED badge, on the same footing as Exhibitor.
 *
 * Computed from the org's first activation (`membership_state_log`,
 * `approved → active`) every render, and shown only while that is inside the
 * 90-day window. It must never be written into `organizations.certifications`
 * for the same reason Exhibitor must not: it would outlive its window and
 * become a permanent claim of newness the org has no way to clear.
 *
 * Returning partners are excluded upstream — `fetchRecentFirstActivations()`
 * only matches `approved → active`, so a partner coming back after years away
 * never picks this up.
 *
 * @param joinedOn YYYY-MM-DD, the day they became active.
 */
export function newPartnerCertification(joinedOn: string): Certification {
  const joined = new Date(`${joinedOn}T00:00:00`);
  const label = Number.isNaN(joined.getTime())
    ? null
    : joined.toLocaleDateString("en-CA", { month: "long", year: "numeric" });

  return {
    name: "New Partner",
    slug: "new-partner",
    description: label
      ? `New Partner — joined Campus Stores Canada in ${label}.`
      : "New Partner — recently joined Campus Stores Canada.",
  };
}

export function exhibitorCertification(
  boothNumbers: string[],
  conferenceName: string
): Certification {
  const boothLabel =
    boothNumbers.length === 0
      ? ""
      : ` — Booth${boothNumbers.length > 1 ? "s" : ""} ${boothNumbers.join(", ")}`;
  return {
    name: "Exhibitor",
    slug: "exhibitor-2027",
    description: `Exhibiting at ${conferenceName}${boothLabel}.`,
  };
}
