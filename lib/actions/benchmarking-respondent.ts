"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated, isGlobalAdmin } from "@/lib/auth/guards";

/**
 * Who is filling this survey in.
 *
 * It used to be four free-text boxes, retyped every year, for a person we
 * already know — CSC holds contacts for every store, with their role title and
 * work email. Picking is faster than typing and it gives a reviewer in November
 * a real person to ring rather than whatever was typed at 4pm in October.
 *
 * ⛔ Contacts are NEVER merged here. Camosun has two rows each for Ashley
 * Neiswender and Jeffrey Matthews; a shared name and address says nothing about
 * whether they are one person, and that is a decision for a human, not a
 * survey. The list is de-duplicated for DISPLAY and the underlying rows are
 * left exactly as they are.
 */

export interface StoreContact {
  id: string;
  name: string;
  email: string | null;
  roleTitle: string | null;
  phone: string | null;
  /** Can sign in, so "give them access" is possible for this person. */
  hasLogin: boolean;
  /** This is the person currently signed in. */
  isYou: boolean;
}

export async function loadStoreContacts(
  organizationId: string,
): Promise<{ contacts: StoreContact[]; youContactId: string | null }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { contacts: [], youContactId: null };

  const db = createAdminClient();
  const { data } = await db
    .from("contacts")
    .select("id, name, first_name, last_name, email, work_email, role_title, phone, work_phone_number, profile_id")
    .eq("organization_id", organizationId)
    .order("name");

  const rows = data ?? [];
  const seen = new Set<string>();
  const contacts: StoreContact[] = [];
  let youContactId: string | null = null;

  for (const r of rows) {
    const name =
      (r.name as string | null) ??
      [r.first_name, r.last_name].filter(Boolean).join(" ").trim();
    const email = ((r.work_email as string | null) ?? (r.email as string | null)) || null;
    if (!name && !email) continue;

    // De-duplicate for DISPLAY only — see the note above. Keyed on name+email
    // because that is what a reader would call "the same row twice".
    const key = `${name.toLowerCase()}|${(email ?? "").toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const isYou = Boolean(r.profile_id) && r.profile_id === auth.ctx.userId;
    if (isYou) youContactId = r.id as string;

    contacts.push({
      id: r.id as string,
      name: name || (email as string),
      email,
      roleTitle: (r.role_title as string | null) ?? null,
      phone: ((r.work_phone_number as string | null) ?? (r.phone as string | null)) || null,
      hasLogin: Boolean(r.profile_id),
      isYou,
    });
  }

  // You first — it is your store and usually your survey.
  contacts.sort((a, b) => Number(b.isYou) - Number(a.isYou) || a.name.localeCompare(b.name));
  return { contacts, youContactId };
}

export interface SetRespondentResult {
  success: boolean;
  error?: string;
  /** Set when a new contact was created, so the picker can select it. */
  createdContactId?: string;
}

/**
 * Record who is filling this in, and optionally hand them access.
 *
 * `grantAccess` writes respondent_delegate_profile_id, which the survey page
 * honours. Deliberately NOT an org_admin promotion: filling in one survey
 * should not carry the right to manage the store's users, billing or listings
 * for the rest of time.
 */
export async function setRespondent(input: {
  benchmarkingId: string;
  contactId: string | null;
  /** Creating someone we do not know yet. */
  newContact?: { name: string; email: string; roleTitle?: string; phone?: string };
  grantAccess: boolean;
}): Promise<SetRespondentResult> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();

  const { data: row } = await db
    .from("benchmarking")
    .select("id, organization_id, status")
    .eq("id", input.benchmarkingId)
    .maybeSingle();
  if (!row) return { success: false, error: "Submission not found." };

  // Same gate the field saves use: you may write to your own store's row, or
  // you are CSC staff.
  const { data: link } = await db
    .from("user_organizations")
    .select("role")
    .eq("user_id", auth.ctx.userId)
    .eq("organization_id", row.organization_id as string)
    .eq("status", "active")
    .maybeSingle();

  const isStaff = isGlobalAdmin(auth.ctx.globalRole);
  if (!isStaff && link?.role !== "org_admin") {
    return { success: false, error: "Only the store's admin can change who is filling this in." };
  }

  if (row.status === "submitted") {
    return { success: false, error: "This submission is already in. Choose Amend first." };
  }

  let contactId = input.contactId;
  let createdContactId: string | undefined;

  if (!contactId && input.newContact) {
    const name = input.newContact.name.trim();
    const email = input.newContact.email.trim();
    if (!name || !email) {
      return { success: false, error: "A new person needs a name and an email." };
    }

    /*
      A real contact on the store, not a survey-local scribble — it is the same
      record the directory, the conference and next year's survey will use.

      ⛔ No directory_visibility is set. Consent to be listed is per person and
      is theirs to give; being named as the person who compiled a survey is not
      consent to appear anywhere public.
    */
    const { data: created, error: createErr } = await db
      .from("contacts")
      .insert({
        organization_id: row.organization_id as string,
        name,
        work_email: email,
        role_title: input.newContact.roleTitle?.trim() || null,
        work_phone_number: input.newContact.phone?.trim() || null,
      })
      .select("id")
      .single();

    if (createErr || !created) {
      console.error("[benchmarking] create respondent contact:", createErr);
      return { success: false, error: "Could not add that person." };
    }
    contactId = created.id as string;
    createdContactId = contactId;
  }

  if (!contactId) return { success: false, error: "Pick a person, or add a new one." };

  /*
    Giving access to someone with no login means making them one.

    A contact is a record of a person; it is not an account. Before this, adding
    a colleague and ticking "let them complete this survey" produced a contact
    who could not sign in, and the checkbox disabled itself with "ask CSC to set
    one up" — a dead end at exactly the moment the store was trying to delegate.

    inviteExistingContact() already does this properly (it provisions through
    provisionOrgLogin and respects the org's login policy), so it is called
    rather than reimplemented. Role "member", never org_admin: the delegation
    that matters is the one below, scoped to this submission.
  */
  if (input.grantAccess) {
    const { data: needsLogin } = await db
      .from("contacts")
      .select("profile_id")
      .eq("id", contactId)
      .maybeSingle();

    if (needsLogin && !needsLogin.profile_id) {
      const { inviteExistingContact } = await import("@/lib/actions/user-management");
      const invited = await inviteExistingContact(
        row.organization_id as string,
        contactId,
        "member",
      );
      if (!invited.success) {
        // The contact and the respondent record are still worth keeping — say
        // what failed rather than losing the rest of the change.
        console.warn("[benchmarking] could not provision login:", invited.error);
      }
    }
  }

  const { data: contact } = await db
    .from("contacts")
    .select("id, name, first_name, last_name, email, work_email, role_title, phone, work_phone_number, profile_id")
    .eq("id", contactId)
    .maybeSingle();
  if (!contact) return { success: false, error: "That person could not be found." };

  const resolvedName =
    (contact.name as string | null) ??
    [contact.first_name, contact.last_name].filter(Boolean).join(" ").trim();

  // Access is only meaningful for someone who can sign in. Asking for it on a
  // contact with no login is not an error — it just has nothing to grant.
  const delegateProfileId =
    input.grantAccess && contact.profile_id ? (contact.profile_id as string) : null;

  const { error } = await db
    .from("benchmarking")
    .update({
      respondent_contact_id: contactId,
      // Copied, not referenced: this is the record of who was named at the
      // time, and it must not change when the contact record does.
      respondent_name: resolvedName || null,
      respondent_title: (contact.role_title as string | null) ?? null,
      respondent_email:
        ((contact.work_email as string | null) ?? (contact.email as string | null)) || null,
      respondent_phone:
        ((contact.work_phone_number as string | null) ?? (contact.phone as string | null)) || null,
      respondent_delegate_profile_id: delegateProfileId,
      respondent_delegated_at: delegateProfileId ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.benchmarkingId);

  if (error) {
    console.error("[benchmarking] setRespondent:", error);
    return { success: false, error: "Could not save that." };
  }

  return { success: true, ...(createdContactId ? { createdContactId } : {}) };
}
