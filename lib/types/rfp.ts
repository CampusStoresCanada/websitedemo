export type RFPVisibility = 'public' | 'network' | 'members' | 'partners';
export type RFPStatus = 'active' | 'closed';

export interface RFP {
  id: string;
  organization_id: string;
  contact_id: string | null;
  title: string;
  description: string | null;
  category: string;
  subcategories: string[];
  opens_at: string;
  closes_at: string;
  visibility: RFPVisibility;
  status: RFPStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** RFP joined with org and contact info for display */
export interface RFPWithContext extends RFP {
  organization: {
    id: string;
    name: string;
    slug: string;
    province: string | null;
  };
  contact: {
    id: string;
    name: string | null;
    work_email: string | null;
    email: string | null;
    role_title: string | null;
  } | null;
}

/**
 * The four operational categories that go to RFP.
 * Merchandise categories (Apparel, Books, etc.) are bought through normal
 * purchasing cycles and don't belong in the RFP system.
 */
export const RFP_CATEGORIES = [
  "Professional Services",
  "Store Fixtures & Equipment",
  "Store Operations",
  "Store Services",
] as const;

export type RFPCategory = (typeof RFP_CATEGORIES)[number];

export const VISIBILITY_LABELS: Record<RFPVisibility, string> = {
  public:   'Public',
  network:  'CSC Network',
  members:  'Members only',
  partners: 'Partners only',
};

export const VISIBILITY_DESCRIPTIONS: Record<RFPVisibility, string> = {
  public:   'Visible to anyone, including non-members',
  network:  'Visible to all logged-in CSC members and partners',
  members:  'Visible only to other member institutions',
  partners: 'Visible only to vendor and partner organizations',
};
