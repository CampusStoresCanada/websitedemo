import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Identity lifecycle, backed by `contacts`.
 *
 * This used to store identity in a second table, `people`, which was a
 * parallel record of the same humans with no foreign key to `contacts` —
 * the two were joined by matching email strings at runtime and had drifted
 * apart on 111 rows. `people` is retired; `contacts` is the single record.
 *
 * The exported signatures still say "person" and return `personId` so the
 * ~15 call sites did not have to change. A "person id" is now a contact id.
 */

function splitDisplayName(name: string | null | undefined): { firstName: string; lastName: string } {
  const cleaned = (name ?? "").trim();
  if (!cleaned) return { firstName: "Unknown", lastName: "User" };
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "User" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/** Only overwrite a stored value when the caller actually supplied one.
 *
 *  This is the fix for a confirmed data-loss bug: the previous version wrote
 *  `title: params.title ?? null` on every existing-record match, so any caller
 *  that didn't happen to pass a title blanked the stored one. It destroyed a
 *  real contact's job title in production on 2026-08-17 via account-recovery.
 *  A missing argument means "I don't know", never "set it to empty". */
function keepIfAbsent(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Resolve the contact behind a logged-in user.
 *
 * Previously read `public.users` — a table with zero rows — and so returned
 * null on every call in production. Now it resolves through the auth email,
 * which is what the callers actually needed.
 */
export async function ensurePersonForUser(params: {
  userId: string;
  organizationId?: string | null;
  fallbackEmail?: string | null;
}): Promise<{ personId: string | null; error?: string }> {
  const adminClient = createAdminClient();

  let email = params.fallbackEmail?.trim().toLowerCase() ?? null;
  if (!email) {
    const { data: authUser } = await adminClient.auth.admin.getUserById(params.userId);
    email = authUser?.user?.email?.trim().toLowerCase() ?? null;
  }
  if (!email) return { personId: null };

  let query = adminClient
    .from("contacts")
    .select("id")
    .is("archived_at", null)
    .or(`work_email.eq.${email},email.eq.${email}`);

  if (params.organizationId) query = query.eq("organization_id", params.organizationId);

  const { data, error } = await query.limit(1).maybeSingle();
  if (error) return { personId: null, error: error.message };
  return { personId: data?.id ?? null };
}

/**
 * Formerly wrote `users.person_id`. That table is empty, so this was a silent
 * no-op on every call. Contacts are resolved by email, so there is no link to
 * maintain; kept as a no-op so the call sites keep working unchanged.
 */
export async function linkUserToPerson(_params: {
  userId: string;
  personId: string;
}): Promise<{ success: boolean; error?: string }> {
  return { success: true };
}

/**
 * Find or create the contact for a known human in an organization.
 *
 * Matches on email first, then on name. Never blanks a stored field: absent
 * arguments are left alone rather than written as null.
 */
export async function ensureKnownPerson(params: {
  organizationId: string;
  tenantId?: string | null;
  name: string;
  email?: string | null;
  title?: string | null;
  workPhone?: string | null;
  mobilePhone?: string | null;
}): Promise<{ personId: string | null; error?: string }> {
  const adminClient = createAdminClient();
  const normalizedEmail = params.email?.trim().toLowerCase() ?? null;
  const cleanedName = params.name.trim();
  const { firstName, lastName } = splitDisplayName(cleanedName);

  if (!cleanedName) {
    return { personId: null, error: "Name is required to create a known person." };
  }

  const updates = {
    role_title: keepIfAbsent(params.title),
    work_phone_number: keepIfAbsent(params.workPhone),
    phone: keepIfAbsent(params.mobilePhone),
    updated_at: new Date().toISOString(),
  };

  if (normalizedEmail) {
    const { data: existingByEmail, error: byEmailError } = await adminClient
      .from("contacts")
      .select("id")
      .eq("organization_id", params.organizationId)
      .is("archived_at", null)
      .or(`work_email.eq.${normalizedEmail},email.eq.${normalizedEmail}`)
      .limit(1)
      .maybeSingle();

    if (byEmailError) return { personId: null, error: byEmailError.message };
    if (existingByEmail?.id) {
      await adminClient.from("contacts").update(updates).eq("id", existingByEmail.id);
      return { personId: existingByEmail.id };
    }
  }

  const { data: existingByName, error: byNameError } = await adminClient
    .from("contacts")
    .select("id")
    .eq("organization_id", params.organizationId)
    .is("archived_at", null)
    .eq("name", cleanedName)
    .limit(1)
    .maybeSingle();

  if (byNameError) return { personId: null, error: byNameError.message };
  if (existingByName?.id) {
    await adminClient
      .from("contacts")
      .update({ ...updates, work_email: normalizedEmail ?? undefined })
      .eq("id", existingByName.id);
    return { personId: existingByName.id };
  }

  let tenantId = params.tenantId ?? null;
  if (!tenantId) {
    const { data: org, error: orgError } = await adminClient
      .from("organizations")
      .select("tenant_id")
      .eq("id", params.organizationId)
      .maybeSingle();
    if (orgError) return { personId: null, error: orgError.message };
    tenantId = (org as { tenant_id?: string | null } | null)?.tenant_id ?? null;
  }

  const { data: created, error: createError } = await adminClient
    .from("contacts")
    .insert({
      organization_id: params.organizationId,
      tenant_id: tenantId,
      name: cleanedName,
      first_name: firstName,
      last_name: lastName,
      email: normalizedEmail,
      work_email: normalizedEmail,
      role_title: keepIfAbsent(params.title) ?? null,
      work_phone_number: keepIfAbsent(params.workPhone) ?? null,
      phone: keepIfAbsent(params.mobilePhone) ?? null,
      contact_type: ["directory"],
    })
    .select("id")
    .single();

  if (createError) return { personId: null, error: createError.message };
  return { personId: created?.id ?? null };
}

/**
 * Ensure a contact exists for a person, updating it with whatever the caller
 * supplied. Formerly wrote a `contacts` projection derived from the `people`
 * row — which pushed the staler record over the fresher one. Now the contact
 * IS the record, so this is a plain upsert.
 */
export async function upsertPersonContact(params: {
  organizationId: string;
  personId?: string | null;
  name?: string | null;
  email?: string | null;
  roleTitle?: string | null;
  phone?: string | null;
  workPhone?: string | null;
  contactType?: string[];
}): Promise<{ contactId: string | null; error?: string }> {
  const adminClient = createAdminClient();

  const derivedName = params.name?.trim() ?? "";
  const derivedEmail = params.email?.trim().toLowerCase() ?? null;

  // A person id is a contact id now — if the caller has one, use it directly
  // instead of re-deriving the match from strings.
  if (params.personId) {
    const { data: existing } = await adminClient
      .from("contacts")
      .select("id")
      .eq("id", params.personId)
      .maybeSingle();

    if (existing?.id) {
      const { error } = await adminClient
        .from("contacts")
        .update({
          name: derivedName || undefined,
          work_email: derivedEmail ?? undefined,
          email: derivedEmail ?? undefined,
          role_title: keepIfAbsent(params.roleTitle),
          phone: keepIfAbsent(params.phone),
          work_phone_number: keepIfAbsent(params.workPhone),
          contact_type: params.contactType,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      if (error) return { contactId: null, error: error.message };
      return { contactId: existing.id };
    }
  }

  if (!derivedName) {
    return { contactId: null, error: "Contact name is required." };
  }

  const ensured = await ensureKnownPerson({
    organizationId: params.organizationId,
    name: derivedName,
    email: derivedEmail,
    title: params.roleTitle,
    workPhone: params.workPhone,
    mobilePhone: params.phone,
  });

  if (ensured.error || !ensured.personId) {
    return { contactId: null, error: ensured.error ?? "Failed to create contact" };
  }

  if (params.contactType?.length) {
    await adminClient
      .from("contacts")
      .update({ contact_type: params.contactType })
      .eq("id", ensured.personId);
  }

  return { contactId: ensured.personId };
}

export const upsertConferenceContact = upsertPersonContact;

export async function archivePersonContact(params: {
  contactId: string;
}): Promise<{ success: boolean; error?: string }> {
  const adminClient = createAdminClient();
  const now = new Date().toISOString();

  const { error } = await adminClient
    .from("contacts")
    .update({
      archived_at: now,
      updated_at: now,
    })
    .eq("id", params.contactId);

  if (error) return { success: false, error: error.message };
  return { success: true };
}
