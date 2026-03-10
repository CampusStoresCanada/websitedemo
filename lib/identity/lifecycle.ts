import { createAdminClient } from "@/lib/supabase/admin";

function splitDisplayName(name: string | null | undefined): { firstName: string; lastName: string } {
  const cleaned = (name ?? "").trim();
  if (!cleaned) return { firstName: "Unknown", lastName: "User" };
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "User" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export async function ensurePersonForUser(params: {
  userId: string;
  organizationId?: string | null;
  fallbackEmail?: string | null;
}): Promise<{ personId: string | null; error?: string }> {
  const adminClient = createAdminClient();

  const { data: userRow, error: userError } = await adminClient
    .from("users")
    .select("id, person_id, tenant_id, email")
    .eq("id", params.userId)
    .maybeSingle();

  if (userError) return { personId: null, error: userError.message };
  if (!userRow) return { personId: null };

  if (userRow.person_id) {
    if (params.organizationId) {
      await adminClient
        .from("people")
        .update({
          organization_id: params.organizationId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userRow.person_id);
    }
    return { personId: userRow.person_id };
  }

  const { data: profile } = await adminClient
    .from("profiles")
    .select("display_name")
    .eq("id", params.userId)
    .maybeSingle();

  const nameParts = splitDisplayName(profile?.display_name);
  const personId = crypto.randomUUID();
  const primaryEmail = userRow.email ?? params.fallbackEmail ?? "unknown@example.com";

  const { error: createError } = await adminClient.from("people").insert({
    id: personId,
    first_name: nameParts.firstName,
    last_name: nameParts.lastName,
    primary_email: primaryEmail,
    organization_id: params.organizationId ?? null,
    tenant_id: userRow.tenant_id,
    updated_at: new Date().toISOString(),
  });

  if (createError) return { personId: null, error: createError.message };

  await adminClient
    .from("users")
    .update({ person_id: personId, updated_at: new Date().toISOString() })
    .eq("id", userRow.id);

  return { personId };
}

export async function linkUserToPerson(params: {
  userId: string;
  personId: string;
}): Promise<{ success: boolean; error?: string }> {
  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from("users")
    .update({ person_id: params.personId, updated_at: new Date().toISOString() })
    .eq("id", params.userId);

  if (error) return { success: false, error: error.message };
  return { success: true };
}

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

  if (normalizedEmail) {
    const { data: existingByEmail, error: byEmailError } = await adminClient
      .from("people")
      .select("id")
      .eq("organization_id", params.organizationId)
      .eq("primary_email", normalizedEmail)
      .maybeSingle();

    if (byEmailError) return { personId: null, error: byEmailError.message };
    if (existingByEmail?.id) {
      await adminClient
        .from("people")
        .update({
          title: params.title ?? null,
          work_phone: params.workPhone ?? null,
          mobile_phone: params.mobilePhone ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingByEmail.id);
      return { personId: existingByEmail.id };
    }
  }

  const { data: existingByName, error: byNameError } = await adminClient
    .from("people")
    .select("id")
    .eq("organization_id", params.organizationId)
    .eq("first_name", firstName)
    .eq("last_name", lastName)
    .maybeSingle();

  if (byNameError) return { personId: null, error: byNameError.message };
  if (existingByName?.id) {
    await adminClient
      .from("people")
      .update({
        primary_email: normalizedEmail ?? undefined,
        title: params.title ?? null,
        work_phone: params.workPhone ?? null,
        mobile_phone: params.mobilePhone ?? null,
        updated_at: new Date().toISOString(),
      })
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
    tenantId = org?.tenant_id ?? null;
  }

  if (!tenantId) {
    return {
      personId: null,
      error: "Cannot create person without tenant_id context.",
    };
  }

  const personId = crypto.randomUUID();
  const { error: createError } = await adminClient.from("people").insert({
    id: personId,
    first_name: firstName,
    last_name: lastName,
    primary_email: normalizedEmail ?? `${personId}@placeholder.local`,
    organization_id: params.organizationId,
    tenant_id: tenantId,
    title: params.title ?? null,
    work_phone: params.workPhone ?? null,
    mobile_phone: params.mobilePhone ?? null,
    updated_at: new Date().toISOString(),
  });

  if (createError) return { personId: null, error: createError.message };
  return { personId };
}

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

  let derivedName = params.name?.trim() ?? "";
  let derivedEmail = params.email?.trim() ?? null;
  let derivedRole = params.roleTitle?.trim() ?? null;
  let derivedPhone = params.phone?.trim() ?? null;
  let derivedWorkPhone = params.workPhone?.trim() ?? null;

  if (params.personId) {
    const { data: person, error: personError } = await adminClient
      .from("people")
      .select("first_name, last_name, primary_email, title, mobile_phone, work_phone")
      .eq("id", params.personId)
      .maybeSingle();

    if (personError) return { contactId: null, error: personError.message };

    if (person) {
      derivedName = derivedName || `${person.first_name} ${person.last_name}`.trim();
      derivedEmail = derivedEmail ?? person.primary_email ?? null;
      derivedRole = derivedRole ?? person.title ?? null;
      derivedPhone = derivedPhone ?? person.mobile_phone ?? null;
      derivedWorkPhone = derivedWorkPhone ?? person.work_phone ?? null;
    }
  }

  if (!derivedName) {
    return { contactId: null, error: "Contact name is required for conference sync." };
  }

  let existingId: string | null = null;

  if (derivedEmail) {
    const { data: byWorkEmail } = await adminClient
      .from("contacts")
      .select("id")
      .eq("organization_id", params.organizationId)
      .eq("work_email", derivedEmail)
      .maybeSingle();

    existingId = byWorkEmail?.id ?? null;

    if (!existingId) {
      const { data: byEmail } = await adminClient
        .from("contacts")
        .select("id")
        .eq("organization_id", params.organizationId)
        .eq("email", derivedEmail)
        .maybeSingle();
      existingId = byEmail?.id ?? null;
    }
  }

  if (!existingId) {
    const { data: byName } = await adminClient
      .from("contacts")
      .select("id")
      .eq("organization_id", params.organizationId)
      .eq("name", derivedName)
      .maybeSingle();
    existingId = byName?.id ?? null;
  }

  if (existingId) {
    const { error: updateError } = await adminClient
      .from("contacts")
      .update({
        name: derivedName,
        work_email: derivedEmail,
        email: derivedEmail,
        role_title: derivedRole,
        phone: derivedPhone,
        work_phone_number: derivedWorkPhone,
        contact_type: params.contactType ?? ["conference"],
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingId);

    if (updateError) return { contactId: null, error: updateError.message };
    return { contactId: existingId };
  }

  const { data: created, error: insertError } = await adminClient
    .from("contacts")
    .insert({
      organization_id: params.organizationId,
      name: derivedName,
      work_email: derivedEmail,
      email: derivedEmail,
      role_title: derivedRole,
      phone: derivedPhone,
      work_phone_number: derivedWorkPhone,
      contact_type: params.contactType ?? ["conference"],
    })
    .select("id")
    .single();

  if (insertError) return { contactId: null, error: insertError.message };
  return { contactId: created?.id ?? null };
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
