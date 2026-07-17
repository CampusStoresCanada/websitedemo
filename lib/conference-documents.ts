/**
 * Conference Documents — types and JSONB parsing.
 *
 * documents is stored as a JSONB array on conference_instances. Internal-use
 * only (contracts, planning docs) — the whole area lives behind
 * /admin/conference/[id]/, which already requires global admin/super_admin,
 * so entries have no per-viewer visibility tiers (unlike partner_links).
 */

export interface ConferenceDocument {
  /** Client-generated UUID */
  id: string;
  /** Human-readable label, e.g. "Venue Contract 2026" */
  label: string;
  /**
   * External URL. Mutually exclusive with storage_path.
   */
  url?: string;
  /**
   * Supabase Storage path in the conference-documents bucket.
   * Mutually exclusive with url.
   * The server generates a short-lived signed URL before passing to the client.
   */
  storage_path?: string;
}

export function parseConferenceDocuments(raw: unknown): ConferenceDocument[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is ConferenceDocument =>
      item !== null &&
      typeof item === "object" &&
      typeof (item as ConferenceDocument).id === "string" &&
      typeof (item as ConferenceDocument).label === "string"
  );
}
