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
