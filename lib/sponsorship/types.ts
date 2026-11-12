// ─────────────────────────────────────────────────────────────────
// Sponsorship Platform — Types
// ─────────────────────────────────────────────────────────────────

// ── Benefit keys ─────────────────────────────────────────────────
// The code registry of known benefit keys. Adding a new key with
// a coded effect requires a deploy; wiring it to a tier is GUI-only.

export const BENEFIT_KEYS = [
  // Website
  "logo_homepage_featured",
  "logo_partners_page",
  "logo_conference_page",
  "sponsors_page",
  // Reports
  "partner_report_access",
  "cancoll_report_access",
  "post_show_report",
  "member_market_report",
  // Circle
  "circle_partner_space",
  "circle_community_tag",
  "circle_ama_slots",
  "circle_sponsored_post",
  // Conference
  "conference_exhibitor",
  "conference_offsite_host",
  "conference_travel_host",
  "conference_speaking_slot",
  "conference_hot_products_care_package",
  "conference_hot_products_showcase",
  "conference_lead_capture",
  // Email
  "email_broadcast_slots",
  "email_brand_presence",
] as const;

export type BenefitKey = (typeof BENEFIT_KEYS)[number];

export type BenefitProvisioningType = "automatic" | "triggered" | "manual";

export interface BenefitDefinition {
  key: BenefitKey;
  label: string;
  category: "website" | "report" | "circle" | "conference" | "email";
  provisioning: BenefitProvisioningType;
  /** Whether this benefit references an external entity (e.g. conference instance, offsite event) */
  hasReferenceId?: boolean;
  /** Whether this benefit has a quota count (e.g. ama_slots: 2) */
  hasCount?: boolean;
  /**
   * Whether the count is spread over the term ("up to 1 per quarter, at most
   * 4"), not delivered whenever. The period lives in config.cadence.
   */
  hasCadence?: boolean;
  /**
   * The placement slot(s) an automatic benefit puts up, when they are not the
   * slot with the benefit's own key (the convention that covers the logos).
   */
  slotKeys?: readonly string[];
}

/** How often a cadenced benefit falls due within its term. */
export const BENEFIT_CADENCES = ["month", "quarter", "year"] as const;
export type BenefitCadence = (typeof BENEFIT_CADENCES)[number];

/** Canonical registry — used for UI display and provisioning logic */
export const BENEFIT_REGISTRY: Record<BenefitKey, BenefitDefinition> = {
  // The logo keys never shared a name with their slot, so until 2026-11 an
  // activation matched none of them and no logo placement was ever created.
  logo_homepage_featured:   { key: "logo_homepage_featured",   label: "Logo — Homepage (Featured)",        category: "website",    provisioning: "automatic", slotKeys: ["homepage_featured"] },
  logo_partners_page:       { key: "logo_partners_page",       label: "Logo — Partners Page",              category: "website",    provisioning: "automatic", slotKeys: ["partners_page_featured"] },
  logo_conference_page:     { key: "logo_conference_page",     label: "Logo — Conference Page",            category: "website",    provisioning: "automatic", slotKeys: ["conference_page"] },
  sponsors_page:            { key: "sponsors_page",            label: "Sponsors Page Listing",             category: "website",    provisioning: "automatic" },
  partner_report_access:    { key: "partner_report_access",    label: "State of the Industry Report",      category: "report",     provisioning: "automatic" },
  cancoll_report_access:    { key: "cancoll_report_access",    label: "Private CANCOLL Data Report",       category: "report",     provisioning: "automatic" },
  circle_partner_space:     { key: "circle_partner_space",     label: "Circle — Dedicated Partner Space",  category: "circle",     provisioning: "triggered" },
  circle_community_tag:     { key: "circle_community_tag",     label: "Circle — Community Partner Tag",    category: "circle",     provisioning: "triggered" },
  circle_ama_slots:         { key: "circle_ama_slots",         label: "Circle — AMA / Sponsored Events",   category: "circle",     provisioning: "manual",    hasCount: true },
  conference_exhibitor:     { key: "conference_exhibitor",     label: "Conference — Exhibitor Booth",      category: "conference", provisioning: "manual",    hasReferenceId: true },
  // A placement: the sponsor named on the offsite event it references. Was
  // "manual" until 2026-11, when nothing provisioned it; no tier used it.
  conference_offsite_host:  { key: "conference_offsite_host",  label: "Conference — Offsite Event Host",   category: "conference", provisioning: "automatic", hasReferenceId: true, slotKeys: ["conference_offsite"] },
  conference_travel_host:   { key: "conference_travel_host",   label: "Conference — Member Travel Host",   category: "conference", provisioning: "manual",    hasReferenceId: true },
  conference_speaking_slot: { key: "conference_speaking_slot", label: "Conference — Speaking Slot",        category: "conference", provisioning: "manual",    hasReferenceId: true },
  // Both keys below keep their stored spelling ("hot_products") after the 2026-10-05
  // rename to Conference in a Box / Pre-Conference Online Showcase: renaming a key
  // buys nothing and would strand any sponsor_agreements.custom_benefits row written
  // against the old one. Labels are display only, so only they moved.
  conference_hot_products_care_package: { key: "conference_hot_products_care_package", label: "Conference — Conference in a Box", category: "conference", provisioning: "manual" },
  conference_hot_products_showcase:      { key: "conference_hot_products_showcase",      label: "Conference — Pre-Conference Online Showcase", category: "conference", provisioning: "manual" },
  email_broadcast_slots:    { key: "email_broadcast_slots",    label: "Email — Broadcast Slots",           category: "email",      provisioning: "manual",    hasCount: true },
  // Added for sponsorships sold as their own item (Kivuto, 2026-11).
  // Automatic = a placement put up for the term; triggered = a grant;
  // manual = a deliverable somebody owes by a date.
  email_brand_presence:     { key: "email_brand_presence",     label: "Email — Brand in CSC Communications", category: "email",    provisioning: "automatic", slotKeys: ["email_header", "email_footer"] },
  circle_sponsored_post:    { key: "circle_sponsored_post",    label: "Circle — Sponsored Post from CSC",  category: "circle",     provisioning: "manual",    hasCount: true, hasCadence: true },
  conference_lead_capture:  { key: "conference_lead_capture",  label: "Conference — Badge-Scan Leads",     category: "conference", provisioning: "triggered", hasReferenceId: true },
  post_show_report:         { key: "post_show_report",         label: "Post-Show Report",                  category: "report",     provisioning: "manual",    hasReferenceId: true },
  member_market_report:     { key: "member_market_report",     label: "Member Market Report",              category: "report",     provisioning: "manual" },
};

/**
 * The slots an automatic benefit fills: its own declared slotKeys, else the
 * slot that shares its key.
 */
export function benefitSlotKeys(key: string): readonly string[] {
  const def = (BENEFIT_REGISTRY as Record<string, BenefitDefinition | undefined>)[key];
  return def?.slotKeys ?? [key];
}

// ── Benefit config (stored in jsonb) ─────────────────────────────

export interface BenefitConfig {
  key: BenefitKey | string;    // string fallback for future/unknown keys
  label: string;
  config: {
    count?: number;            // for slot-based benefits (ama_slots, broadcast_slots)
    cadence?: BenefitCadence;  // for hasCadence benefits: count is "at most", spread one per period
    reference_id?: string;     // for conference-linked benefits
    [key: string]: unknown;
  };
}

// ── Tiers ─────────────────────────────────────────────────────────

export type TierIcon = "award" | "trophy" | "shield";

export interface SponsorTier {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price_cents: number | null;
  color: string | null;
  icon: TierIcon | null;
  display_order: number;
  is_active: boolean;
  max_sponsors: number | null;
  benefits: BenefitConfig[];
  created_at: string;
  updated_at: string;
}

export type CreateSponsorTierPayload = Omit<SponsorTier, "id" | "created_at" | "updated_at">;
export type UpdateSponsorTierPayload = Partial<CreateSponsorTierPayload>;

// ── Agreements ────────────────────────────────────────────────────

export type SponsorAgreementStatus = "draft" | "active" | "expired" | "cancelled";

export const AGREEMENT_STATUS_TRANSITIONS: Record<SponsorAgreementStatus, SponsorAgreementStatus[]> = {
  draft:     ["active", "cancelled"],
  active:    ["expired", "cancelled"],
  expired:   [],
  cancelled: [],
};

export interface SponsorAgreement {
  id: string;
  organization_id: string;
  tier_id: string;
  status: SponsorAgreementStatus;
  start_date: string;   // YYYY-MM-DD
  end_date: string;     // YYYY-MM-DD
  signed_at: string | null;
  signed_by_contact_id: string | null;
  signed_doc_url: string | null;
  custom_benefits: BenefitConfig[];
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Agreement with joined tier and org name for admin list views */
export interface SponsorAgreementWithMeta extends SponsorAgreement {
  tier: Pick<SponsorTier, "id" | "name" | "slug" | "color" | "icon">;
  organization: { id: string; name: string; logo_url: string | null; slug: string; website: string | null };
}

/** Resolved benefits = tier benefits merged with any custom_benefits overrides */
export interface ResolvedBenefits {
  all: BenefitConfig[];
  byKey: Record<string, BenefitConfig>;
  hasBenefit: (key: BenefitKey) => boolean;
  getCount: (key: BenefitKey) => number;
  getReferenceId: (key: BenefitKey) => string | undefined;
}

export type CreateSponsorAgreementPayload = Pick<
  SponsorAgreement,
  | "organization_id"
  | "tier_id"
  | "start_date"
  | "end_date"
  | "notes"
  | "signed_doc_url"
  | "custom_benefits"
>;

export type UpdateSponsorAgreementPayload = Partial<
  Pick<
    SponsorAgreement,
    | "tier_id"
    | "start_date"
    | "end_date"
    | "notes"
    | "signed_doc_url"
    | "signed_at"
    | "signed_by_contact_id"
    | "custom_benefits"
  >
>;

// ── Placement slots ───────────────────────────────────────────────

export type PlacementLocation = "website" | "email" | "circle" | "conference";

export interface SponsorPlacementSlot {
  id: string;
  key: string;
  label: string;
  description: string | null;
  location: PlacementLocation;
  config_schema: Record<string, unknown>;
  is_active: boolean;
  display_order: number;
  created_at: string;
}

export type CreatePlacementSlotPayload = Omit<SponsorPlacementSlot, "id" | "created_at">;
export type UpdatePlacementSlotPayload = Partial<CreatePlacementSlotPayload>;

// ── Placements ────────────────────────────────────────────────────

export interface SponsorPlacement {
  id: string;
  agreement_id: string;
  slot_id: string;
  logo_url: string | null;
  link_url: string | null;
  config_json: Record<string, unknown>;
  display_order: number;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Placement with joined slot and agreement/org context for renderers */
export interface SponsorPlacementWithContext extends SponsorPlacement {
  slot: Pick<SponsorPlacementSlot, "id" | "key" | "label" | "location">;
  agreement: {
    id: string;
    organization_id: string;
    tier: Pick<SponsorTier, "id" | "name" | "slug" | "color" | "icon">;
    organization: { id: string; name: string; logo_url: string | null; slug: string; website: string | null };
  };
}

export type CreateSponsorPlacementPayload = Pick<
  SponsorPlacement,
  | "agreement_id"
  | "slot_id"
  | "logo_url"
  | "link_url"
  | "config_json"
  | "display_order"
  | "start_date"
  | "end_date"
  | "is_active"
>;

export type UpdateSponsorPlacementPayload = Partial<
  Pick<
    SponsorPlacement,
    | "logo_url"
    | "link_url"
    | "config_json"
    | "display_order"
    | "start_date"
    | "end_date"
    | "is_active"
  >
>;

// ── Public surface types ──────────────────────────────────────────
// Used by page components and renderers — no admin-only fields.

export interface ActiveSponsor {
  agreementId: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  organizationLogoUrl: string | null;
  tier: Pick<SponsorTier, "name" | "slug" | "color" | "icon">;
  placements: Array<{
    slotKey: string;
    logoUrl: string | null;
    linkUrl: string | null;
    displayOrder: number;
    config: Record<string, unknown>;
  }>;
}

// ── Utility ───────────────────────────────────────────────────────

/** A sponsor as one display shows them: the placement's logo wins over the org's. */
export interface SponsorInSlot {
  agreementId: string;
  organizationName: string;
  organizationSlug: string;
  logoUrl: string | null;
  /** Where the logo links: the placement's link, if one was set. */
  linkUrl: string | null;
  tier: ActiveSponsor["tier"];
}

/**
 * The sponsors a display should show: only those whose agreement has a live
 * placement in that display's slot, in the placement's order.
 *
 * Until 2026-11 the homepage strip and the partners page showed every active
 * agreement, so what a sponsor bought decided nothing about where they
 * appeared. A placement is what they bought; this is the one place that
 * reads it.
 */
export function sponsorsInSlot(sponsors: ActiveSponsor[], slotKey: string): SponsorInSlot[] {
  return sponsors
    .flatMap((s) =>
      s.placements
        .filter((p) => p.slotKey === slotKey)
        .map((p) => ({
          order: p.displayOrder,
          sponsor: {
            agreementId: s.agreementId,
            organizationName: s.organizationName,
            organizationSlug: s.organizationSlug,
            logoUrl: p.logoUrl ?? s.organizationLogoUrl,
            linkUrl: p.linkUrl ?? null,
            tier: s.tier,
          },
        }))
    )
    .sort((a, b) => a.order - b.order || a.sponsor.organizationName.localeCompare(b.sponsor.organizationName))
    .map((x) => x.sponsor);
}

/** Merge tier benefits with per-agreement custom_benefits overrides */
export function resolveAgreementBenefits(
  tierBenefits: BenefitConfig[],
  customBenefits: BenefitConfig[]
): ResolvedBenefits {
  const merged = new Map<string, BenefitConfig>();
  for (const b of tierBenefits) merged.set(b.key, b);
  for (const b of customBenefits) merged.set(b.key, { ...merged.get(b.key), ...b });

  const all = Array.from(merged.values());
  const byKey = Object.fromEntries(all.map((b) => [b.key, b]));

  return {
    all,
    byKey,
    hasBenefit: (key) => key in byKey,
    getCount:   (key) => (byKey[key]?.config?.count as number) ?? 0,
    getReferenceId: (key) => byKey[key]?.config?.reference_id as string | undefined,
  };
}

/** Check whether an agreement is currently active on a given date */
export function isAgreementActiveOn(agreement: SponsorAgreement, date: Date = new Date()): boolean {
  if (agreement.status !== "active") return false;
  const d = date.toISOString().slice(0, 10);
  return agreement.start_date <= d && agreement.end_date >= d;
}
