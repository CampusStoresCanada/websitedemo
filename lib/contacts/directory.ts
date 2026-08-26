import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Reading contacts to SHOW THEM TO SOMEONE.
 *
 * `contacts` has no anon/authenticated SELECT policy — it was scoped to the
 * service role in 20260723220000 as a PII fix. So every read that displays
 * contacts runs on the admin client, and the access decision lives in the
 * calling route's guard plus lib/visibility masking.
 *
 * The trap is that the admin client happily returns rows a person has asked
 * not to be shown. Every caller then has to remember the same two filters by
 * hand, and the failure is silent: you get a confident, wrong list rather than
 * an error. This helper is where those filters live once.
 *
 * ── Use this when ────────────────────────────────────────────────
 *   a human is going to read the result: directories, search, pickers,
 *   printed output, QR landing pages, the recipient queue.
 *
 * ── Do NOT use this for ──────────────────────────────────────────
 *   sync (Circle webhooks), identity lifecycle, board rosters, or comms
 *   audiences. Those need every row, and `hidden` is a directory-display
 *   preference — it is NOT an unsubscribe. Filtering there would silently
 *   drop people from emails they are entitled to receive.
 */

/** The columns a directory-style view usually wants. */
export const DIRECTORY_CONTACT_FIELDS =
  "id, organization_id, name, role_title, work_email, email, work_phone_number, phone, is_primary, hidden, directory_visibility, last_contact_date";

export interface DirectoryContactOptions {
  /** Restrict to these organizations. Omit for all. */
  organizationIds?: string[];
  /** Case-insensitive partial match on name. */
  nameSearch?: string;
  limit?: number;
  /** Defaults to DIRECTORY_CONTACT_FIELDS. */
  fields?: string;
  /** Include people who asked not to be listed. Almost always false. */
  includeHidden?: boolean;
  /** Include people who have left. Almost always false. */
  includeArchived?: boolean;
  /**
   * Only people who have explicitly agreed to be PRINTED.
   *
   * A stricter rule than the website's, on purpose: `hidden = false` is the
   * absence of an opt-out, not the presence of consent. Undecided people stay
   * visible on the site — where a mistake is fixable — and stay out of the
   * book, where it is not.
   */
  printableOnly?: boolean;
}

/**
 * Contacts for display, with the two opt-outs applied.
 * Returns [] rather than throwing — a display surface should degrade, not 500.
 */
export async function listDirectoryContacts<T = Record<string, unknown>>(
  opts: DirectoryContactOptions = {},
): Promise<T[]> {
  const {
    organizationIds,
    nameSearch,
    limit,
    fields = DIRECTORY_CONTACT_FIELDS,
    includeHidden = false,
    includeArchived = false,
    printableOnly = false,
  } = opts;

  // An empty org list means "no organizations", not "all organizations" —
  // without this an caller that filtered its org list to nothing would
  // suddenly read every contact in the database.
  if (organizationIds && organizationIds.length === 0) return [];

  const db = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (db as any).from("contacts").select(fields);

  if (organizationIds) query = query.in("organization_id", organizationIds);
  if (nameSearch) query = query.ilike("name", `%${nameSearch}%`);
  if (!includeArchived) query = query.is("archived_at", null);
  // hidden is nullable, so "not true" has to be spelled out.
  if (!includeHidden) query = query.or("hidden.is.null,hidden.eq.false");
  // Silence prints nobody: an explicit choice is required, not merely the
  // absence of an opt-out.
  if (printableOnly) query = query.in("directory_visibility", ["members", "public"]);
  if (limit) query = query.limit(limit);

  const { data, error } = await query;
  if (error) {
    console.error("[contacts/directory] read failed:", error);
    return [];
  }
  return (data ?? []) as T[];
}
