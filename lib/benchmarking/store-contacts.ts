import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { listDirectoryContacts } from "@/lib/contacts/directory";

/**
 * Who to ring about a flagged figure.
 *
 * A reviewer often can't explain a number until they've asked the store. If
 * that means leaving the page to hunt for a phone number, most of them won't
 * bother — so the people are attached to the flag itself.
 *
 * Goes through listDirectoryContacts, so anyone who asked not to be listed
 * stays unlisted here too.
 */

export interface StoreContact {
  id: string;
  name: string;
  roleTitle: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
}

export interface StoreContactCard {
  organizationId: string;
  organizationName: string;
  /** The person the survey was actually addressed to this year, if confirmed. */
  respondentContactId: string | null;
  contacts: StoreContact[];
}

export async function storeContactsForFlags(
  organizationIds: string[],
  surveyId?: string | null,
): Promise<Map<string, StoreContactCard>> {
  const out = new Map<string, StoreContactCard>();
  if (organizationIds.length === 0) return out;

  const db = createAdminClient();

  const [{ data: orgs }, contacts] = await Promise.all([
    db.from("organizations").select("id, name").in("id", organizationIds),
    listDirectoryContacts<{
      id: string;
      organization_id: string | null;
      name: string | null;
      role_title: string | null;
      work_email: string | null;
      email: string | null;
      work_phone_number: string | null;
      phone: string | null;
      is_primary: boolean | null;
    }>({
      organizationIds,
      fields:
        "id, organization_id, name, role_title, work_email, email, work_phone_number, phone, is_primary",
    }),
  ]);

  // Who the survey actually went to, where a rep has confirmed it.
  const respondentByOrg = new Map<string, string>();
  if (surveyId) {
    const { data: recipients } = await db
      .from("benchmarking_recipients")
      .select("organization_id, contact_id, status")
      .eq("survey_id", surveyId)
      .in("organization_id", organizationIds)
      .in("status", ["confirmed", "corrected"]);
    for (const r of recipients ?? []) {
      if (r.contact_id) respondentByOrg.set(r.organization_id, r.contact_id);
    }
  }

  const byOrg = new Map<string, StoreContact[]>();
  for (const c of contacts) {
    if (!c.organization_id) continue;
    const list = byOrg.get(c.organization_id) ?? [];
    list.push({
      id: c.id,
      name: c.name ?? "Unnamed",
      roleTitle: c.role_title,
      email: c.work_email ?? c.email,
      phone: c.work_phone_number ?? c.phone,
      isPrimary: c.is_primary === true,
    });
    byOrg.set(c.organization_id, list);
  }

  for (const org of orgs ?? []) {
    const respondentId = respondentByOrg.get(org.id) ?? null;
    const list = (byOrg.get(org.id) ?? []).sort((a, b) => {
      // The person who filed the survey first, then the primary, then the rest.
      const rank = (c: StoreContact) =>
        c.id === respondentId ? 0 : c.isPrimary ? 1 : 2;
      const d = rank(a) - rank(b);
      return d !== 0 ? d : a.name.localeCompare(b.name);
    });
    out.set(org.id, {
      organizationId: org.id,
      organizationName: org.name,
      respondentContactId: respondentId,
      contacts: list,
    });
  }

  return out;
}
