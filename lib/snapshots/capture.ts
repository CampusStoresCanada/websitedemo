"use server";

/**
 * Snapshot capture functions — one per shareable page type.
 * Each function fetches the page's data as the CURRENT authenticated viewer
 * and returns a typed snapshot object ready to store in page_snapshots.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated } from "@/lib/auth/guards";
import { getViewerContext } from "@/lib/visibility/viewer";
import { loadVisibilityConfig, applyFieldMask } from "@/lib/visibility/engine";
import type { Contact } from "@/lib/types/db";
import type {
  OrgProfileSnapshot,
  EventSnapshot,
  ConferenceSnapshot,
  ResourcesSnapshot,
  PartnersSnapshot,
} from "./types";

// ---------------------------------------------------------------------------
// Org / Member profile
// ---------------------------------------------------------------------------

export async function captureOrgProfileSnapshot(
  slug: string
): Promise<OrgProfileSnapshot | null> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return null;

  const supabase = createAdminClient();

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select(
      "id, name, slug, type, province, city, website, logo_url, company_description, fte, square_footage, certifications"
    )
    .eq("slug", slug)
    .maybeSingle();

  if (orgError || !org) return null;

  const { data: contactRows } = await supabase
    .from("contacts")
    .select("name, role_title, email, phone")
    .eq("organization_id", org.id)
    .is("archived_at", null)
    .order("name");

  // Mask per the CURRENT authenticated viewer's level, same rules as the
  // org profile page itself — a snapshot should never reveal more than the
  // capturing user could already see by visiting the page.
  const viewer = await getViewerContext();
  const visibilityConfig = await loadVisibilityConfig();
  const isOwnOrg = viewer.viewerOrgAdminIds.includes(org.id);

  const contacts = (contactRows ?? []).map((c) => {
    const masked = applyFieldMask(
      c as unknown as Record<string, unknown>,
      viewer.viewerLevel,
      visibilityConfig,
      "contacts",
      isOwnOrg,
      org.type
    ) as Partial<Contact>;

    return {
      name: (masked.name as string) ?? "",
      role_title: (masked.role_title as string) ?? null,
      email: (masked.email as string) ?? null,
      phone: (masked.phone as string) ?? null,
    };
  });

  return {
    type: "org_profile",
    organization: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      type: org.type,
      province: org.province ?? null,
      city: org.city ?? null,
      website: org.website ?? null,
      logo_url: org.logo_url ?? null,
      company_description: org.company_description ?? null,
      fte: org.fte != null ? Number(org.fte) : null,
      square_footage: org.square_footage ?? null,
      certifications: (org.certifications as string[]) ?? [],
    },
    contacts,
  };
}

// ---------------------------------------------------------------------------
// Event
// ---------------------------------------------------------------------------

/**
 * Capture an event snapshot. `slugOrId` may be a slug (from URL) or a UUID.
 */
export async function captureEventSnapshot(
  slugOrId: string
): Promise<EventSnapshot | null> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return null;

  const { supabase } = auth.ctx;

  // Try slug first, fall back to id
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slugOrId);
  const query = supabase
    .from("events")
    .select("id, title, slug, description, starts_at, ends_at, location, is_virtual");
  const { data: event, error } = await (isUuid
    ? query.eq("id", slugOrId)
    : query.eq("slug", slugOrId)
  ).maybeSingle();

  if (error || !event) return null;

  return {
    type: "event",
    event: {
      id: event.id,
      title: event.title,
      slug: event.slug ?? "",
      description: event.description ?? null,
      starts_at: event.starts_at ?? "",
      ends_at: event.ends_at ?? null,
      location: event.location ?? null,
      is_virtual: event.is_virtual ?? false,
    },
  };
}

// ---------------------------------------------------------------------------
// Conference
// ---------------------------------------------------------------------------

/**
 * Capture a conference snapshot by year + edition_code (from URL),
 * or by UUID if conferenceId is a UUID.
 */
export async function captureConferenceSnapshot(
  yearOrId: string,
  editionCode?: string
): Promise<ConferenceSnapshot | null> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return null;

  const { supabase } = auth.ctx;

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(yearOrId);
  let query = supabase
    .from("conference_instances")
    .select("id, name, year, edition_code, start_date, end_date, location_city, location_province, location_venue");

  if (isUuid) {
    query = query.eq("id", yearOrId) as typeof query;
  } else if (editionCode) {
    query = query.eq("year", parseInt(yearOrId, 10)).eq("edition_code", editionCode) as typeof query;
  } else {
    return null;
  }

  const { data: conf, error } = await query.maybeSingle();

  if (error || !conf) return null;

  return {
    type: "conference",
    conference: {
      id: conf.id,
      name: conf.name,
      year: conf.year,
      edition_code: conf.edition_code,
      start_date: conf.start_date ?? null,
      end_date: conf.end_date ?? null,
      location_city: conf.location_city ?? null,
      location_province: conf.location_province ?? null,
      location_venue: conf.location_venue ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Resources (metadata only — the page is largely public)
// ---------------------------------------------------------------------------

export async function captureResourcesSnapshot(
  pageUrl: string
): Promise<ResourcesSnapshot> {
  return {
    type: "resources",
    title: "Resources",
    page_url: pageUrl,
    captured_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Partners (metadata only)
// ---------------------------------------------------------------------------

export async function capturePartnersSnapshot(): Promise<PartnersSnapshot> {
  return {
    type: "partners",
    captured_at: new Date().toISOString(),
  };
}
