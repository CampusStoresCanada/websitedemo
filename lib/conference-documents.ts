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

/**
 * Where to fetch a linked document as a PDF, for the print station.
 *
 * Stephen keeps speeches in Google Docs. Google serves any Doc, Sheet or Slides
 * deck as a PDF at its export address — but only to someone allowed to see it,
 * so the file must be shared as "anyone with the link can view". Anything else
 * is fetched as it is and must already be a PDF.
 */
export function pdfSourceUrl(url: string): string {
  const match = /^https:\/\/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([A-Za-z0-9_-]+)/.exec(url.trim());
  if (!match) return url.trim();
  const [, kind, id] = match;
  return kind === "presentation"
    ? `https://docs.google.com/presentation/d/${id}/export/pdf`
    : `https://docs.google.com/${kind}/d/${id}/export?format=pdf`;
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
