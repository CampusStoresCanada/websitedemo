import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { composePublication, type Publication } from "./composition";
import { loadEntriesForPublication } from "./composition-loader";
import { loadPublication } from "./store";

/**
 * Asking each person, for themselves, whether they want to be in the book.
 *
 * ⚠️ This goes to the INDIVIDUAL, never to their org admin. An admin cannot
 * answer for their staff and is not offered the chance to — an override that
 * stands in for someone's silence is opt-out with a different label.
 *
 * Silence is a no. Someone who never answers is never printed, so a failure to
 * reach them costs them a listing, not their privacy. That asymmetry is why
 * this is safe to run repeatedly and safe to get wrong.
 */

export interface AskCandidate {
  contactId: string;
  name: string;
  email: string;
  orgId: string;
  orgName: string;
  roleTitle: string | null;
  phone: string | null;
  askedAt: string | null;
}

export interface AskSummary {
  /** Everyone listed in the publication's organisations. */
  listed: number;
  decided: number;
  undecided: number;
  /** Undecided people we can actually reach. */
  askable: number;
  /** Undecided, but no email on file — they cannot be asked at all. */
  noEmail: number;
  /** Already asked and still silent; excluded unless re-asking. */
  alreadyAsked: number;
  /** On the suppression list, so we will not mail them. */
  suppressed: number;
  candidates: AskCandidate[];
}

type ContactRow = {
  id: string; name: string | null; role_title: string | null;
  work_email: string | null; email: string | null;
  work_phone_number: string | null; phone: string | null;
  organization_id: string | null;
  directory_visibility: string | null;
  directory_visibility_asked_at: string | null;
};

/**
 * Who still needs asking, and who cannot be reached.
 *
 * `reAskBefore` lets a later round pick up people asked long ago and still
 * silent. Omit it and anyone already asked is left alone.
 */
export async function summarizeConsentAsk(
  publicationOrId: string | Publication,
  options: { reAskBefore?: Date } = {}
): Promise<AskSummary> {
  const db = createAdminClient();

  const publication =
    typeof publicationOrId === "string"
      ? (await loadPublication(publicationOrId))?.publication
      : publicationOrId;

  const empty: AskSummary = {
    listed: 0, decided: 0, undecided: 0, askable: 0,
    noEmail: 0, alreadyAsked: 0, suppressed: 0, candidates: [],
  };
  if (!publication) return empty;

  const doc = composePublication(publication, await loadEntriesForPublication(publication));
  const orgIds = doc.entries.map((e) => e.orgId);
  if (orgIds.length === 0) return empty;
  const orgNameById = new Map(doc.entries.map((e) => [e.orgId, e.orgName]));

  // Deliberately NOT listDirectoryContacts: that applies display filters, and
  // this needs the people who are currently INVISIBLE too — someone hidden by
  // the old opt-out flag has still never been asked the new question.
  const { data } = await db
    .from("contacts")
    .select(
      "id, name, role_title, work_email, email, work_phone_number, phone, " +
      "organization_id, directory_visibility, directory_visibility_asked_at"
    )
    .in("organization_id", orgIds)
    .is("archived_at", null);

  const rows = (data ?? []) as unknown as ContactRow[];
  const summary: AskSummary = { ...empty, listed: rows.length, candidates: [] };

  const pending: ContactRow[] = [];
  for (const row of rows) {
    const decided =
      row.directory_visibility === "hidden" ||
      row.directory_visibility === "members" ||
      row.directory_visibility === "public";
    if (decided) { summary.decided += 1; continue; }
    summary.undecided += 1;

    if (!row.name?.trim() || !(row.work_email?.trim() || row.email?.trim())) {
      // No name or no address: nothing to ask, and nothing that could print.
      summary.noEmail += 1;
      continue;
    }
    if (row.directory_visibility_asked_at) {
      const asked = new Date(row.directory_visibility_asked_at);
      if (!options.reAskBefore || asked >= options.reAskBefore) {
        summary.alreadyAsked += 1;
        continue;
      }
    }
    pending.push(row);
  }

  // Suppressed people are simply never asked. That leaves them unprinted,
  // which is the safe direction — we are not entitled to mail someone who
  // asked us to stop just because we want an answer from them.
  const addresses = pending
    .map((r) => (r.work_email?.trim() || r.email?.trim() || "").toLowerCase())
    .filter(Boolean);
  const suppressed = new Set<string>();
  if (addresses.length > 0) {
    const { data: rowsS } = await db
      .from("comms_suppressions")
      .select("email")
      .in("email", addresses);
    for (const s of rowsS ?? []) if (s.email) suppressed.add(s.email.toLowerCase());
  }

  for (const row of pending) {
    const address = (row.work_email?.trim() || row.email?.trim() || "").toLowerCase();
    if (suppressed.has(address)) { summary.suppressed += 1; continue; }
    summary.candidates.push({
      contactId: row.id,
      name: row.name!.trim(),
      email: address,
      orgId: row.organization_id!,
      orgName: orgNameById.get(row.organization_id!) ?? "your organisation",
      roleTitle: row.role_title?.trim() || null,
      phone: row.work_phone_number?.trim() || row.phone?.trim() || null,
    askedAt: row.directory_visibility_asked_at,
    });
  }
  summary.askable = summary.candidates.length;
  return summary;
}

/** Escape for embedding a value inside the email body. */
const esc = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The person's own details, shown back to them exactly as they would print.
 *
 * Showing the real values is the whole point — "do you consent to be listed" is
 * unanswerable in the abstract, and someone whose title is four years out of
 * date will only notice when they see it.
 */
export function printedDetailsHtml(c: AskCandidate): string {
  const line = (label: string, value: string | null) =>
    value
      ? `<tr><td style="padding:2px 12px 2px 0;color:#6b7280;font-size:14px">${label}</td>` +
        `<td style="padding:2px 0;color:#111827;font-size:14px"><strong>${esc(value)}</strong></td></tr>`
      : "";
  return `<table style="margin:8px 0 16px;border-left:3px solid #163D6D;padding-left:14px" cellpadding="0" cellspacing="0">
${line("Name", c.name)}${line("Title", c.roleTitle)}${line("Phone", c.phone)}${line("Email", c.email)}${line("Organisation", c.orgName)}
</table>`;
}
