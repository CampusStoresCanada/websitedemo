// ---------------------------------------------------------------------------
// Snapshot types — one per shareable page type.
// Each type defines exactly what data gets frozen at share time.
// ---------------------------------------------------------------------------

export type SnapshotType = "org_profile" | "event" | "resources" | "partners" | "conference";

// ── Org / Member profile ────────────────────────────────────────────────────

export interface OrgProfileSnapshot {
  type: "org_profile";
  organization: {
    id: string;
    name: string;
    slug: string;
    type: string;
    province: string | null;
    city: string | null;
    website: string | null;
    logo_url: string | null;
    company_description: string | null;
    fte: number | null;
    square_footage: number | null;
    certifications: string[];
  };
  contacts: Array<{
    name: string;
    role_title: string | null;
    email: string | null;
    phone: string | null;
  }>;
}

// ── Event ───────────────────────────────────────────────────────────────────

export interface EventSnapshot {
  type: "event";
  event: {
    id: string;
    title: string;
    slug: string;
    description: string | null;
    starts_at: string;
    ends_at: string | null;
    location: string | null;
    is_virtual: boolean;
  };
}

// ── Resources ───────────────────────────────────────────────────────────────

export interface ResourcesSnapshot {
  type: "resources";
  title: string;
  page_url: string;
  // Resources page is largely public — snapshot is just metadata
  captured_at: string;
}

// ── Partners ────────────────────────────────────────────────────────────────

export interface PartnersSnapshot {
  type: "partners";
  captured_at: string;
}

// ── Conference ──────────────────────────────────────────────────────────────

export interface ConferenceSnapshot {
  type: "conference";
  conference: {
    id: string;
    name: string;
    year: number;
    edition_code: string;
    start_date: string | null;
    end_date: string | null;
    location_city: string | null;
    location_province: string | null;
    location_venue: string | null;
  };
}

// ── Union ───────────────────────────────────────────────────────────────────

export type AnySnapshot =
  | OrgProfileSnapshot
  | EventSnapshot
  | ResourcesSnapshot
  | PartnersSnapshot
  | ConferenceSnapshot;

// ── DB row ──────────────────────────────────────────────────────────────────

export interface SnapshotRecord {
  id: string;
  type: SnapshotType;
  snapshot: AnySnapshot;
  page_url: string;
  page_title: string;
  note: string | null;
  created_by: string;
  recipient_email: string | null;
  expires_at: string;
  created_at: string;
}
