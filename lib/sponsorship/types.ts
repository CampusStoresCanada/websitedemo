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
  // Circle
  "circle_partner_space",
  "circle_community_tag",
  "circle_ama_slots",
  // Conference
  "conference_exhibitor",
  "conference_offsite_host",
  "conference_travel_host",
  "conference_speaking_slot",
  // Email
  "email_broadcast_slots",
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
}

/** Canonical registry — used for UI display and provisioning logic */
export const BENEFIT_REGISTRY: Record<BenefitKey, BenefitDefinition> = {
  logo_homepage_featured:   { key: "logo_homepage_featured",   label: "Logo — Homepage (Featured)",        category: "website",    provisioning: "automatic" },
  logo_partners_page:       { key: "logo_partners_page",       label: "Logo — Partners Page",              category: "website",    provisioning: "automatic" },
  logo_conference_page:     { key: "logo_conference_page",     label: "Logo — Conference Page",            category: "website",    provisioning: "automatic" },
  sponsors_page:            { key: "sponsors_page",            label: "Sponsors Page Listing",             category: "website",    provisioning: "automatic" },
  partner_report_access:    { key: "partner_report_access",    label: "State of the Industry Report",      category: "report",     provisioning: "automatic" },
  cancoll_report_access:    { key: "cancoll_report_access",    label: "Private CANCOLL Data Report",       category: "report",     provisioning: "automatic" },
  circle_partner_space:     { key: "circle_partner_space",     label: "Circle — Dedicated Partner Space",  category: "circle",     provisioning: "triggered" },
  circle_community_tag:     { key: "circle_community_tag",     label: "Circle — Community Partner Tag",    category: "circle",     provisioning: "triggered" },
  circle_ama_slots:         { key: "circle_ama_slots",         label: "Circle — AMA / Sponsored Events",   category: "circle",     provisioning: "manual",    hasCount: true },
  conference_exhibitor:     { key: "conference_exhibitor",     label: "Conference — Exhibitor Booth",      category: "conference", provisioning: "manual",    hasReferenceId: true },
  conference_offsite_host:  { key: "conference_offsite_host",  label: "Conference — Offsite Event Host",   category: "conference", provisioning: "manual",    hasReferenceId: true },
  conference_travel_host:   { key: "conference_travel_host",   label: "Conference — Member Travel Host",   category: "conference", provisioning: "manual",    hasReferenceId: true },
  conference_speaking_slot: { key: "conference_speaking_slot", label: "Conference — Speaking Slot",        category: "conference", provisioning: "manual",    hasReferenceId: true },
  email_broadcast_slots:    { key: "email_broadcast_slots",    label: "Email — Broadcast Slots",           category: "email",      provisioning: "manual",    hasCount: true },
};

// ── Benefit config (stored in jsonb) ─────────────────────────────

export interface BenefitConfig {
  key: BenefitKey | string;    // string fallback for future/unknown keys
  label: string;
  config: {
    count?: number;            // for slot-based benefits (ama_slots, broadcast_slots)
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
