"use server";

import {
  canManageOrganization,
  isGlobalAdmin,
  requireAdmin,
  requireConferenceOpsAccess,
  requireAuthenticated,
} from "@/lib/auth/guards";
import { inviteOrgUser } from "@/lib/actions/user-management";
import {
  calculateConferenceRefund,
  requestConferenceRefund,
} from "@/lib/actions/conference-commerce";
import {
  requestBadgeReprint,
  type BadgeReprintReason,
} from "@/lib/actions/conference-badges";
import { ensureKnownPerson, ensurePersonForUser } from "@/lib/identity/lifecycle";
import { getMyConferenceLegalGate, getPersonAssigneeLegalGate } from "@/lib/actions/conference-legal";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { createHash } from "node:crypto";

type ConferencePersonRow = {
  id: string;
  conference_id: string;
  organization_id: string;
  user_id: string | null;
  canonical_person_id: string | null;
  registration_id: string | null;
  conference_staff_id: string | null;
  source_type: "registration" | "staff" | "manual";
  source_id: string;
  person_kind: "delegate" | "exhibitor" | "staff" | "observer" | "unassigned";
  display_name: string | null;
  legal_name: string | null;
  role_title: string | null;
  contact_email: string | null;
  assignment_status:
    | "unassigned"
    | "assigned"
    | "pending_user_activation"
    | "reassigned"
    | "canceled";
  assigned_email_snapshot: string | null;
  assigned_at: string | null;
  assigned_by: string | null;
  reassigned_from_user_id: string | null;
  assignment_cutoff_at: string | null;
  schedule_scope: "person" | "organization";
  travel_mode: "flight" | "road" | null;
  road_origin_address: string | null;
  arrival_flight_details: string | null;
  departure_flight_details: string | null;
  hotel_name: string | null;
  hotel_confirmation_code: string | null;
  seat_preference: string | null;
  preferred_departure_airport: string | null;
  dietary_restrictions: string | null;
  accessibility_needs: string | null;
  mobile_phone: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  badge_print_status: "not_printed" | "printed" | "reprinted";
  badge_printed_at: string | null;
  badge_reprint_count: number;
  checked_in_at: string | null;
  check_in_source: "badge_pickup" | "manual" | null;
  admin_notes: string | null;
  data_quality_flags: string[] | null;
  retention_sensitive_fields: string[] | null;
  created_at: string;
  updated_at: string;
};

type SyncResult = {
  registrationUpserts: number;
  staffUpserts: number;
};

type CpqRows = Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>;
type CpqRow = Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
type CpqChain = {
  eq: (column: string, value: string) => CpqChain;
  order: (column: string, opts?: { ascending?: boolean }) => CpqRows;
  in: (column: string, values: string[]) => CpqRows;
  maybeSingle: () => CpqRow;
};
type CpqSelect = CpqChain & {
  // direct terminations without filters
  order: (column: string, opts?: { ascending?: boolean }) => CpqRows;
  maybeSingle: () => CpqRow;
};

function conferencePeopleClient() {
  return createAdminClient() as unknown as {
    from: (table: string) => {
      select: (columns: string) => CpqSelect;
      upsert: (
        values: Record<string, unknown> | Record<string, unknown>[],
        opts?: { onConflict?: string }
      ) => Promise<{ error: { message: string } | null }>;
      update: (values: Record<string, unknown>) => {
        eq: (column: string, value: string) => Promise<{ error: { message: string } | null }>;
      };
      insert: (
        values: Record<string, unknown> | Record<string, unknown>[]
      ) => Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>;
      limit: (
        n: number
      ) => Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>;
    };
  };
}

function redactAdminNotes<T extends { admin_notes?: string | null }>(row: T): T {
  return { ...row, admin_notes: null };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

async function resolveCanonicalPersonId(params: {
  userId?: string | null;
  organizationId: string;
  displayName?: string | null;
  email?: string | null;
  roleTitle?: string | null;
}): Promise<string | null> {
  if (params.userId) {
    const person = await ensurePersonForUser({
      userId: params.userId,
      organizationId: params.organizationId,
      fallbackEmail: params.email ?? null,
    });
    return person.personId ?? null;
  }
  const name = params.displayName?.trim() ?? "";
  const email = params.email?.trim() ?? null;
  if (!name || !email) return null;
  const known = await ensureKnownPerson({
    organizationId: params.organizationId,
    name,
    email,
    title: params.roleTitle ?? null,
  });
  return known.personId ?? null;
}

export async function syncConferencePeopleIndex(
  conferenceId: string
): Promise<{ success: boolean; error?: string; data?: SyncResult }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = conferencePeopleClient();
  const adminDb = createAdminClient();

  const [{ data: registrations, error: regError }, { data: staffRows, error: staffError }] =
    await Promise.all([
      adminDb
        .from("conference_registrations")
        .select("*")
        .eq("conference_id", conferenceId),
      adminDb
        .from("conference_staff")
        .select("*")
        .eq("conference_id", conferenceId),
    ]);

  if (regError) {
    return { success: false, error: `Failed to read registrations: ${regError.message}` };
  }
  if (staffError) {
    return { success: false, error: `Failed to read staff: ${staffError.message}` };
  }

  let registrationUpserts = 0;
  let staffUpserts = 0;

  for (const reg of registrations ?? []) {
    const row = reg as Record<string, unknown>;
    const registrationType = String(row.registration_type ?? "observer");
    const personKind =
      registrationType === "delegate" ||
      registrationType === "exhibitor" ||
      registrationType === "staff" ||
      registrationType === "observer"
        ? registrationType
        : "observer";
    const scheduleScope = registrationType === "delegate" ? "person" : "organization";
    const displayName =
      (row.delegate_name as string | null) ??
      (row.legal_name as string | null) ??
      null;
    const userId = (row.user_id as string | null) ?? null;
    const contactEmail = (row.delegate_email as string | null) ?? null;
    const roleTitle = (row.delegate_title as string | null) ?? null;
    const canonicalPersonId = await resolveCanonicalPersonId({
      userId,
      organizationId: row.organization_id as string,
      displayName,
      email: contactEmail,
      roleTitle,
    });

    const { error } = await db.from("conference_people").upsert(
      {
        conference_id: row.conference_id as string,
        organization_id: row.organization_id as string,
        user_id: userId,
        canonical_person_id: canonicalPersonId,
        registration_id: row.id as string,
        conference_staff_id: null,
        source_type: "registration",
        source_id: row.id as string,
        person_kind: personKind,
        display_name: displayName,
        legal_name: (row.legal_name as string | null) ?? null,
        role_title: roleTitle,
        contact_email: contactEmail,
        assignment_status:
          (row.assignment_status as string | null) ?? "assigned",
        assigned_email_snapshot:
          (row.assigned_email_snapshot as string | null) ?? null,
        assigned_at: (row.assigned_at as string | null) ?? null,
        assigned_by: (row.assigned_by as string | null) ?? null,
        reassigned_from_user_id:
          (row.reassigned_from_user_id as string | null) ?? null,
        assignment_cutoff_at:
          (row.assignment_cutoff_at as string | null) ?? null,
        schedule_scope: scheduleScope,
        schedule_registration_id: row.id as string,
        travel_mode: (row.travel_mode as string | null) ?? null,
        road_origin_address: (row.road_origin_address as string | null) ?? null,
        arrival_flight_details:
          (row.arrival_flight_details as string | null) ?? null,
        departure_flight_details:
          (row.departure_flight_details as string | null) ?? null,
        hotel_name: (row.hotel_name as string | null) ?? null,
        hotel_confirmation_code:
          (row.hotel_confirmation_code as string | null) ?? null,
        seat_preference: (row.seat_preference as string | null) ?? null,
        preferred_departure_airport:
          (row.preferred_departure_airport as string | null) ?? null,
        dietary_restrictions:
          (row.dietary_restrictions as string | null) ?? null,
        accessibility_needs:
          (row.accessibility_needs as string | null) ?? null,
        mobile_phone: (row.mobile_phone as string | null) ?? null,
        emergency_contact_name:
          (row.emergency_contact_name as string | null) ?? null,
        emergency_contact_phone:
          (row.emergency_contact_phone as string | null) ?? null,
        badge_print_status:
          (row.badge_print_status as string | null) ?? "not_printed",
        badge_printed_at: (row.badge_printed_at as string | null) ?? null,
        badge_reprint_count: (row.badge_reprint_count as number | null) ?? 0,
        checked_in_at: (row.checked_in_at as string | null) ?? null,
        check_in_source: (row.check_in_source as string | null) ?? null,
        admin_notes: (row.admin_notes as string | null) ?? null,
        data_quality_flags: (row.data_quality_flags as string[] | null) ?? [],
        travel_import_run_id:
          (row.travel_import_run_id as string | null) ?? null,
        travel_import_row_ref:
          (row.travel_import_row_ref as string | null) ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "conference_id,source_type,source_id" }
    );
    if (error) {
      return { success: false, error: `Failed to upsert registration person row: ${error.message}` };
    }
    registrationUpserts += 1;
  }

  for (const staff of staffRows ?? []) {
    const userId = (staff.user_id as string | null) ?? null;
    const displayName = (staff.name as string | null) ?? null;
    const contactEmail = (staff.email as string | null) ?? null;
    const canonicalPersonId = await resolveCanonicalPersonId({
      userId,
      organizationId: staff.organization_id as string,
      displayName,
      email: contactEmail,
      roleTitle: null,
    });
    const { error } = await db.from("conference_people").upsert(
      {
        conference_id: staff.conference_id,
        organization_id: staff.organization_id,
        user_id: userId,
        canonical_person_id: canonicalPersonId,
        registration_id: staff.registration_id ?? null,
        conference_staff_id: staff.id,
        source_type: "staff",
        source_id: staff.id,
        person_kind: "staff",
        display_name: displayName,
        role_title: null,
        contact_email: contactEmail,
        assignment_status: "assigned",
        schedule_scope: "organization",
        badge_print_status: "not_printed",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "conference_id,source_type,source_id" }
    );
    if (error) {
      return { success: false, error: `Failed to upsert staff person row: ${error.message}` };
    }
    staffUpserts += 1;
  }

  await logAuditEventSafe({
    action: "conference_people_sync",
    entityType: "conference_instance",
    entityId: conferenceId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { registrationUpserts, staffUpserts },
  });

  return { success: true, data: { registrationUpserts, staffUpserts } };
}

export async function listConferencePeople(
  conferenceId: string
): Promise<{ success: boolean; error?: string; data?: ConferencePersonRow[] }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = conferencePeopleClient();
  const isAdmin = isGlobalAdmin(auth.ctx.globalRole);
  const orgScope = auth.ctx.orgAdminOrgIds;

  const { data, error } = await db
    .from("conference_people")
    .select("*")
    .eq("conference_id", conferenceId)
    .order("updated_at", { ascending: false });

  if (error) {
    return { success: false, error: `Failed to load conference people: ${error.message}` };
  }

  const rows = (data ?? []) as ConferencePersonRow[];
  const canonicalIds = Array.from(
    new Set(
      rows
        .map((row) => row.canonical_person_id)
        .filter((value): value is string => Boolean(value))
    )
  );
  const canonicalById = new Map<
    string,
    { first_name: string | null; last_name: string | null; primary_email: string | null; title: string | null }
  >();
  if (canonicalIds.length > 0) {
    const { data: peopleRows } = await db
      .from("contacts")
      .select("id, first_name, last_name, primary_email:work_email, title:role_title")
      .in("id", canonicalIds);
    for (const person of (peopleRows ?? []) as Array<Record<string, unknown>>) {
      const id = person.id as string | null;
      if (!id) continue;
      canonicalById.set(id, {
        first_name: (person.first_name as string | null) ?? null,
        last_name: (person.last_name as string | null) ?? null,
        primary_email: (person.primary_email as string | null) ?? null,
        title: (person.title as string | null) ?? null,
      });
    }
  }

  const resolvedRows = rows.map((row) => {
    const canonical = row.canonical_person_id
      ? canonicalById.get(row.canonical_person_id) ?? null
      : null;
    const resolvedDisplayName = canonical
      ? `${canonical.first_name ?? ""} ${canonical.last_name ?? ""}`.trim() || null
      : null;
    return {
      ...row,
      display_name: resolvedDisplayName ?? row.display_name,
      contact_email: canonical?.primary_email ?? row.contact_email,
      role_title: canonical?.title ?? row.role_title,
    };
  });

  let scoped: ConferencePersonRow[];
  if (isAdmin) {
    scoped = resolvedRows;
  } else if (orgScope.length > 0) {
    scoped = resolvedRows
      .filter((row) => orgScope.includes(row.organization_id) || row.user_id === auth.ctx.userId)
      .map((row) => redactAdminNotes(row));
  } else {
    scoped = resolvedRows
      .filter((row) => row.user_id === auth.ctx.userId)
      .map((row) => redactAdminNotes(row));
  }

  return { success: true, data: scoped };
}

const SELF_EDITABLE_FIELDS = new Set([
  "travel_mode",
  "road_origin_address",
  "seat_preference",
  "preferred_departure_airport",
  "dietary_restrictions",
  "accessibility_needs",
  "mobile_phone",
  "emergency_contact_name",
  "emergency_contact_phone",
]);

const IDENTITY_PROJECTION_FIELDS = new Set([
  "display_name",
  "contact_email",
  "role_title",
]);

export async function updateConferencePersonSelf(
  personId: string,
  patch: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = conferencePeopleClient();
  const { data: row, error: rowError } = await db
    .from("conference_people")
    .select("id,user_id")
    .eq("id", personId)
    .maybeSingle();

  if (rowError || !row) {
    return { success: false, error: "Conference person record not found." };
  }
  if ((row.user_id as string | null) !== auth.ctx.userId) {
    return { success: false, error: "Not authorized." };
  }

  const attemptedIdentityFields = Object.keys(patch).filter((key) =>
    IDENTITY_PROJECTION_FIELDS.has(key)
  );
  if (attemptedIdentityFields.length > 0) {
    return {
      success: false,
      error:
        "Identity fields must be edited through canonical person/contact updates, not conference projection self-edit.",
    };
  }

  const sanitized = Object.fromEntries(
    Object.entries(patch).filter(([key]) => SELF_EDITABLE_FIELDS.has(key))
  );
  const { error } = await db
    .from("conference_people")
    .update({ ...sanitized, updated_at: new Date().toISOString() })
    .eq("id", personId);
  if (error) return { success: false, error: error.message };

  return { success: true };
}

const OPS_EDITABLE_FIELDS = new Set([
  "assignment_status",
  "assigned_email_snapshot",
  "assigned_at",
  "assigned_by",
  "reassigned_from_user_id",
  "assignment_cutoff_at",
  "schedule_scope",
  "schedule_registration_id",
  "schedule_run_id",
  "hotel_name",
  "hotel_confirmation_code",
  "arrival_flight_details",
  "departure_flight_details",
  "badge_print_status",
  "badge_printed_at",
  "badge_reprint_count",
  "checked_in_at",
  "check_in_source",
  "admin_notes",
  "data_quality_flags",
  "travel_import_run_id",
  "travel_import_row_ref",
]);

function splitName(name: string): { firstName: string; lastName: string } {
  const cleaned = name.trim();
  if (!cleaned) return { firstName: "", lastName: "" };
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export async function updateConferencePersonOps(
  personId: string,
  patch: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) return { success: false, error: auth.error };

  const attemptedIdentityFields = Object.keys(patch).filter((key) =>
    IDENTITY_PROJECTION_FIELDS.has(key)
  );
  if (attemptedIdentityFields.length > 0) {
    return {
      success: false,
      error:
        "Identity fields must be edited through applyCanonicalConferencePersonIdentityEdit (canonical-first), not conference projection ops update.",
    };
  }

  const db = conferencePeopleClient();
  const sanitized = Object.fromEntries(
    Object.entries(patch).filter(([key]) => OPS_EDITABLE_FIELDS.has(key))
  );
  if (
    !isGlobalAdmin(auth.ctx.globalRole) &&
    Object.prototype.hasOwnProperty.call(sanitized, "admin_notes")
  ) {
    return { success: false, error: "Admin notes require admin access." };
  }

  const { error } = await db
    .from("conference_people")
    .update({ ...sanitized, updated_at: new Date().toISOString() })
    .eq("id", personId);

  if (error) return { success: false, error: error.message };

  await logAuditEventSafe({
    action: "conference_person_ops_update",
    entityType: "conference_people",
    entityId: personId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { fields: Object.keys(sanitized) },
  });

  return { success: true };
}

export async function applyCanonicalConferencePersonIdentityEdit(
  personId: string,
  patch: {
    displayName?: string | null;
    contactEmail?: string | null;
    roleTitle?: string | null;
  }
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { data: person, error: personError } = await db
    .from("conference_people")
    .select(
      "id, conference_id, organization_id, user_id, canonical_person_id, registration_id, display_name, contact_email, role_title"
    )
    .eq("id", personId)
    .maybeSingle();

  if (personError || !person) {
    return { success: false, error: personError?.message ?? "Conference person not found." };
  }

  const nextDisplayName = patch.displayName?.trim() || null;
  const nextContactEmail = patch.contactEmail?.trim().toLowerCase() || null;
  const nextRoleTitle = patch.roleTitle?.trim() || null;
  const nowIso = new Date().toISOString();

  const canonicalPersonId =
    (person.canonical_person_id as string | null) ??
    (person.user_id
      ? (
          await ensurePersonForUser({
            userId: person.user_id,
            organizationId: person.organization_id,
            fallbackEmail: nextContactEmail ?? person.contact_email ?? null,
          })
        ).personId
      : null);

  if (person.user_id && nextDisplayName) {
    await db
      .from("profiles")
      .update({ display_name: nextDisplayName, updated_at: nowIso })
      .eq("id", person.user_id);

    const { data: userRow } = await db
      .from("users")
      .select("person_id")
      .eq("id", person.user_id)
      .maybeSingle();
    if (userRow?.person_id) {
      const parts = splitName(nextDisplayName);
      await db
        .from("contacts")
        .update({
          first_name: parts.firstName || undefined,
          last_name: parts.lastName || undefined,
          updated_at: nowIso,
        })
        .eq("id", userRow.person_id);
    }
  }

  if (canonicalPersonId && (nextContactEmail || nextRoleTitle || nextDisplayName)) {
    const peoplePatch: Record<string, unknown> = { updated_at: nowIso };
    if (nextDisplayName) {
      const parts = splitName(nextDisplayName);
      peoplePatch.first_name = parts.firstName || null;
      peoplePatch.last_name = parts.lastName || null;
    }
    if (nextContactEmail) peoplePatch.work_email = nextContactEmail;
    if (nextRoleTitle !== null) peoplePatch.role_title = nextRoleTitle;
    await db.from("contacts").update(peoplePatch).eq("id", canonicalPersonId);
  }

  if (nextContactEmail || nextRoleTitle || nextDisplayName) {
    const oldEmail = person.contact_email?.trim().toLowerCase() ?? null;
    const contactPatch: Record<string, unknown> = { updated_at: nowIso };
    if (nextDisplayName) contactPatch.name = nextDisplayName;
    if (nextContactEmail) {
      contactPatch.work_email = nextContactEmail;
      contactPatch.email = nextContactEmail;
    }
    if (nextRoleTitle !== null) contactPatch.role_title = nextRoleTitle;

    if (oldEmail) {
      await db
        .from("contacts")
        .update(contactPatch)
        .eq("organization_id", person.organization_id)
        .or(`work_email.eq.${oldEmail},email.eq.${oldEmail}`);
    } else if (person.display_name) {
      await db
        .from("contacts")
        .update(contactPatch)
        .eq("organization_id", person.organization_id)
        .eq("name", person.display_name);
    }
  }

  if (person.registration_id) {
    const registrationPatch: Record<string, unknown> = { updated_at: nowIso };
    if (nextDisplayName) {
      registrationPatch.delegate_name = nextDisplayName;
      registrationPatch.legal_name = nextDisplayName;
    }
    if (nextContactEmail) registrationPatch.delegate_email = nextContactEmail;
    if (nextRoleTitle !== null) registrationPatch.delegate_title = nextRoleTitle;
    await db
      .from("conference_registrations")
      .update(registrationPatch)
      .eq("id", person.registration_id);
  }

  const projectionPatch: Record<string, unknown> = { updated_at: nowIso };
  if (nextDisplayName) projectionPatch.display_name = nextDisplayName;
  if (nextContactEmail) projectionPatch.contact_email = nextContactEmail;
  if (nextRoleTitle !== null) projectionPatch.role_title = nextRoleTitle;
  if (canonicalPersonId) projectionPatch.canonical_person_id = canonicalPersonId;
  await db.from("conference_people").update(projectionPatch).eq("id", personId);

  await logAuditEventSafe({
    action: "conference_person_identity_edit_canonical",
    entityType: "conference_people",
    entityId: personId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: {
      conferenceId: person.conference_id,
      organizationId: person.organization_id,
      updated: {
        displayName: Boolean(nextDisplayName),
        contactEmail: Boolean(nextContactEmail),
        roleTitle: patch.roleTitle !== undefined,
      },
    },
  });

  return { success: true };
}

export async function resolveConferencePersonCanonicalLink(
  personId: string
): Promise<{ success: boolean; error?: string; data?: { canonicalPersonId: string } }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { data: person, error } = await db
    .from("conference_people")
    .select(
      "id, conference_id, organization_id, user_id, canonical_person_id, display_name, contact_email, role_title"
    )
    .eq("id", personId)
    .maybeSingle();

  if (error || !person) {
    return { success: false, error: error?.message ?? "Conference person not found." };
  }
  if (person.canonical_person_id) {
    return {
      success: true,
      data: { canonicalPersonId: person.canonical_person_id as string },
    };
  }

  const userId = (person.user_id as string | null) ?? null;
  const organizationId = person.organization_id as string;
  const displayName = (person.display_name as string | null) ?? null;
  const contactEmail = (person.contact_email as string | null) ?? null;
  const roleTitle = (person.role_title as string | null) ?? null;

  let canonicalPersonId: string | null = null;
  let resolutionMethod: "user" | "email_unique" | "org_name_unique" | "ensure_known_person" | null =
    null;
  const diagnostics: string[] = [];

  if (userId) {
    const linked = await ensurePersonForUser({
      userId,
      organizationId,
      fallbackEmail: contactEmail,
    });
    if (linked.error) diagnostics.push(`user_link_error=${linked.error}`);
    if (linked.personId) {
      canonicalPersonId = linked.personId;
      resolutionMethod = "user";
    }
  } else {
    diagnostics.push("no_user_id");
  }

  if (!canonicalPersonId && contactEmail?.trim()) {
    const normalizedEmail = contactEmail.trim().toLowerCase();
    const { data: emailMatches, error: emailError } = await db
      .from("contacts")
      .select("id")
      .ilike("work_email", normalizedEmail);
    if (emailError) diagnostics.push(`email_lookup_error=${emailError.message}`);
    const emailIds = Array.from(
      new Set(((emailMatches ?? []) as Array<{ id: string }>).map((row) => row.id))
    );
    diagnostics.push(`email_match_count=${emailIds.length}`);
    if (emailIds.length === 1) {
      canonicalPersonId = emailIds[0];
      resolutionMethod = "email_unique";
    }
  } else if (!canonicalPersonId) {
    diagnostics.push("no_contact_email");
  }

  if (!canonicalPersonId && displayName?.trim()) {
    const parts = splitName(displayName);
    if (parts.firstName && parts.lastName) {
      const { data: nameMatches, error: nameError } = await db
        .from("contacts")
        .select("id")
        .eq("organization_id", organizationId)
        .ilike("first_name", parts.firstName)
        .ilike("last_name", parts.lastName);
      if (nameError) diagnostics.push(`org_name_lookup_error=${nameError.message}`);
      const nameIds = Array.from(
        new Set(((nameMatches ?? []) as Array<{ id: string }>).map((row) => row.id))
      );
      diagnostics.push(`org_name_match_count=${nameIds.length}`);
      if (nameIds.length === 1) {
        canonicalPersonId = nameIds[0];
        resolutionMethod = "org_name_unique";
      }
    } else {
      diagnostics.push("name_parse_incomplete");
    }
  } else if (!canonicalPersonId) {
    diagnostics.push("no_display_name");
  }

  const derivedNameFromEmail = (() => {
    const email = contactEmail?.trim().toLowerCase() ?? "";
    if (!email.includes("@")) return null;
    const local = email.split("@")[0]?.trim();
    if (!local) return null;
    const cleaned = local
      .replace(/[._-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return cleaned.length > 0 ? cleaned : null;
  })();
  const fallbackName = displayName?.trim() || derivedNameFromEmail;

  if (!canonicalPersonId && fallbackName) {
    const ensured = await ensureKnownPerson({
      organizationId,
      name: fallbackName,
      email: contactEmail,
      title: roleTitle,
    });
    if (ensured.error) diagnostics.push(`ensure_known_person_error=${ensured.error}`);
    if (ensured.personId) {
      canonicalPersonId = ensured.personId;
      resolutionMethod = "ensure_known_person";
    }
  } else if (!canonicalPersonId) {
    diagnostics.push("no_name_or_email_for_creation");
  }

  if (!canonicalPersonId) {
    const actionable: string[] = [];
    if (!displayName?.trim() && !contactEmail?.trim()) {
      actionable.push(
        "Missing both name and email on conference row. Add at least one (name preferred), then retry auto-link."
      );
    } else if (!displayName?.trim()) {
      actionable.push(
        "Missing display name; auto-link attempted email-derived fallback. If still failing, set manual canonical link."
      );
    } else if (!contactEmail?.trim()) {
      actionable.push(
        "Missing contact email; auto-link attempted name-based creation. If still failing, set manual canonical link."
      );
    }
    return {
      success: false,
      error: `Auto-link could not resolve a canonical person (${diagnostics.join(", ")}). ${
        actionable.join(" ") || "Use manual link."
      }`,
    };
  }

  const nowIso = new Date().toISOString();
  const { error: updateError } = await db
    .from("conference_people")
    .update({
      canonical_person_id: canonicalPersonId,
      updated_at: nowIso,
    })
    .eq("id", personId);

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  await logAuditEventSafe({
    action: "conference_person_canonical_link_resolve",
    entityType: "conference_people",
    entityId: personId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: {
      conferenceId: person.conference_id,
      organizationId: person.organization_id,
      canonicalPersonId,
      resolutionMethod,
    },
  });

  return { success: true, data: { canonicalPersonId } };
}

export async function setConferencePersonCanonicalLink(params: {
  personId: string;
  canonicalPersonId: string;
}): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const personId = params.personId.trim();
  const canonicalPersonId = params.canonicalPersonId.trim().toLowerCase();
  if (!isUuid(personId) || !isUuid(canonicalPersonId)) {
    return {
      success: false,
      error: "Person ID and canonical person ID must both be valid UUIDs.",
    };
  }

  const db = createAdminClient();
  const [{ data: conferencePerson, error: personError }, { data: canonicalPerson, error: canonicalError }] =
    await Promise.all([
      db
        .from("conference_people")
        .select(
          "id, conference_id, organization_id, display_name, legal_name, contact_email, role_title"
        )
        .eq("id", personId)
        .maybeSingle(),
      db
        .from("contacts")
        .select("id, first_name, last_name, primary_email:work_email, title:role_title")
        .eq("id", canonicalPersonId)
        .maybeSingle(),
    ]);

  if (personError || !conferencePerson) {
    return {
      success: false,
      error: personError?.message ?? "Conference person not found.",
    };
  }
  if (canonicalError || !canonicalPerson) {
    return {
      success: false,
      error: canonicalError?.message ?? "Canonical person ID not found in people.",
    };
  }

  const { error: updateError } = await db
    .from("conference_people")
    .update({
      canonical_person_id: canonicalPersonId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", personId);
  if (updateError) return { success: false, error: updateError.message };

  const conferenceDisplayName =
    (conferencePerson.display_name as string | null)?.trim() ||
    (conferencePerson.legal_name as string | null)?.trim() ||
    "";
  const split = splitName(conferenceDisplayName);
  const conferenceEmail = (conferencePerson.contact_email as string | null)?.trim().toLowerCase() || "";
  const conferenceTitle = (conferencePerson.role_title as string | null)?.trim() || "";
  const canonicalPatch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  let canonicalFieldsUpdated = false;

  if (split.firstName) {
    canonicalPatch.first_name = split.firstName;
    canonicalFieldsUpdated = true;
  }
  if (split.lastName) {
    canonicalPatch.last_name = split.lastName;
    canonicalFieldsUpdated = true;
  }
  if (conferenceEmail) {
    canonicalPatch.primary_email = conferenceEmail;
    canonicalFieldsUpdated = true;
  }
  if (conferenceTitle) {
    canonicalPatch.title = conferenceTitle;
    canonicalFieldsUpdated = true;
  }

  if (canonicalFieldsUpdated) {
    const { error: canonicalUpdateError } = await db
      .from("contacts")
      .update(canonicalPatch)
      .eq("id", canonicalPersonId);
    if (canonicalUpdateError) {
      return { success: false, error: canonicalUpdateError.message };
    }
  }

  await logAuditEventSafe({
    action: "conference_person_canonical_link_set_manual",
    entityType: "conference_people",
    entityId: personId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: {
      conferenceId: conferencePerson.conference_id,
      organizationId: conferencePerson.organization_id,
      canonicalPersonId,
      canonicalWriteback: {
        displayName: Boolean(conferenceDisplayName),
        email: Boolean(conferenceEmail),
        title: Boolean(conferenceTitle),
      },
    },
  });

  return { success: true };
}

export async function markConferencePersonCheckedInManual(
  personId: string
): Promise<{ success: boolean; error?: string; data?: { checkedInAt: string } }> {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { data: person, error: personError } = await db
    .from("conference_people")
    .select("id, conference_id, checked_in_at")
    .eq("id", personId)
    .maybeSingle();
  if (personError || !person) {
    return { success: false, error: "Conference person not found." };
  }

  const checkedInAt = person.checked_in_at ?? new Date().toISOString();
  if (!person.checked_in_at) {
    const { error: updateError } = await db
      .from("conference_people")
      .update({
        checked_in_at: checkedInAt,
        check_in_source: "manual",
        updated_at: new Date().toISOString(),
      })
      .eq("id", personId);
    if (updateError) return { success: false, error: updateError.message };
  }

  await db.from("conference_check_in_events").insert({
    conference_id: person.conference_id,
    person_id: person.id,
    checked_in_at: checkedInAt,
    checked_in_by: auth.ctx.userId,
    check_in_source: "manual",
    scan_token_id: null,
    device_id: null,
    result_state: person.checked_in_at ? "already_checked_in" : "valid",
  });

  await logAuditEventSafe({
    action: "conference_check_in_manual",
    entityType: "conference_people",
    entityId: personId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: {
      conferenceId: person.conference_id,
      checkedInAt,
      resultState: person.checked_in_at ? "already_checked_in" : "valid",
    },
  });

  return { success: true, data: { checkedInAt } };
}

export async function reprintConferenceBadge(
  personId: string,
  reason: BadgeReprintReason,
  note?: string | null
): Promise<{
  success: boolean;
  error?: string;
  data?: {
    badgePrintStatus: string;
    badgeReprintCount: number;
    badgePrintedAt: string;
    badgePrintJobId: string;
    qrPayload: string;
  };
}> {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { data: person, error: personError } = await db
    .from("conference_people")
    .select("id, conference_id, badge_reprint_count")
    .eq("id", personId)
    .maybeSingle();
  if (personError || !person) {
    return { success: false, error: "Conference person not found." };
  }

  const reprintJob = await requestBadgeReprint({
    conferenceId: person.conference_id,
    personId,
    reason,
    note: note ?? null,
    transportMethod: "pdf",
  });
  if (!reprintJob.success || !reprintJob.data) {
    return { success: false, error: reprintJob.error ?? "Failed to queue badge reprint." };
  }

  const nextReprintCount = (person.badge_reprint_count ?? 0) + 1;
  const badgePrintedAt = new Date().toISOString();
  const { error: updateError } = await db
    .from("conference_people")
    .update({
      badge_print_status: "reprinted",
      badge_reprint_count: nextReprintCount,
      badge_printed_at: badgePrintedAt,
      updated_at: badgePrintedAt,
    })
    .eq("id", personId);
  if (updateError) return { success: false, error: updateError.message };

  await logAuditEventSafe({
    action: "conference_badge_reprint",
    entityType: "conference_people",
    entityId: personId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: {
      conferenceId: person.conference_id,
      badgeReprintCount: nextReprintCount,
      badgePrintedAt,
      reason,
      note: note ?? null,
      badgePrintJobId: reprintJob.data.jobId,
    },
  });

  return {
    success: true,
    data: {
      badgePrintStatus: "reprinted",
      badgeReprintCount: nextReprintCount,
      badgePrintedAt,
      badgePrintJobId: reprintJob.data.jobId,
      qrPayload: reprintJob.data.qrPayload,
    },
  };
}

type ResolvedAssignee = {
  targetUserId: string | null;
  assignmentStatus: Extract<ConferencePersonRow["assignment_status"], "assigned" | "pending_user_activation">;
  normalizedEmail: string | null;
  canonicalPersonId: string | null;
};

/**
 * Resolve who a seat should be assigned to, given an optional known userId
 * and/or a target email. If an email is given with no known userId, invites
 * them via inviteOrgUser() and parks the assignment as
 * pending_user_activation — finalizePendingConferenceAssignmentsForCurrentUser()
 * picks it up on that user's next login regardless of source_type. If a
 * userId is already known, resolves their canonical person immediately and
 * marks assigned.
 */
export async function resolveAssigneeForEmail(params: {
  organizationId: string;
  targetUserId?: string | null;
  targetEmail?: string | null;
}): Promise<{ success: true; data: ResolvedAssignee } | { success: false; error: string }> {
  let targetUserId = params.targetUserId ?? null;
  let assignmentStatus: ResolvedAssignee["assignmentStatus"] = "assigned";
  const normalizedEmail = params.targetEmail?.trim().toLowerCase() ?? null;
  let canonicalPersonId: string | null = null;

  if (!targetUserId && normalizedEmail) {
    const invite = await inviteOrgUser(params.organizationId, normalizedEmail, "member");
    if (!invite.success) return { success: false, error: invite.error ?? "Failed to send invite." };
    // Invite flow does not guarantee immediate activated user mapping.
    // Keep assignment user null and track intended assignee by email.
    targetUserId = null;
    assignmentStatus = "pending_user_activation";

    const adminDb = createAdminClient();
    const { data: contact } = await adminDb
      .from("contacts")
      .select("name, role_title")
      .eq("organization_id", params.organizationId)
      .or(`work_email.eq.${normalizedEmail},email.eq.${normalizedEmail}`)
      .limit(1)
      .maybeSingle();
    const fallbackName =
      (contact?.name as string | null) ??
      normalizedEmail.split("@")[0]?.replace(/[._-]+/g, " ") ??
      normalizedEmail;
    const known = await ensureKnownPerson({
      organizationId: params.organizationId,
      name: fallbackName,
      email: normalizedEmail,
      title: (contact?.role_title as string | null) ?? null,
    });
    canonicalPersonId = known.personId ?? null;
  } else if (targetUserId) {
    const person = await ensurePersonForUser({
      userId: targetUserId,
      organizationId: params.organizationId,
      fallbackEmail: normalizedEmail,
    });
    canonicalPersonId = person.personId ?? null;
  }

  return { success: true, data: { targetUserId, assignmentStatus, normalizedEmail, canonicalPersonId } };
}


export async function finalizePendingConferenceAssignmentsForCurrentUser(): Promise<{
  success: boolean;
  error?: string;
  data?: {
    finalizedCount: number;
    personIds: string[];
    outstandingLegal: Array<{ conferenceId: string; missing: string[] }>;
  };
}> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!auth.ctx.userEmail) {
    return { success: true, data: { finalizedCount: 0, personIds: [], outstandingLegal: [] } };
  }

  const email = auth.ctx.userEmail.trim().toLowerCase();
  const activeOrgIds = auth.ctx.activeOrgIds;
  if (activeOrgIds.length === 0) {
    return { success: true, data: { finalizedCount: 0, personIds: [], outstandingLegal: [] } };
  }

  const db = createAdminClient();
  const { data: pendingRows, error: pendingError } = await db
    .from("conference_people")
    .select(
      "id,conference_id,organization_id,user_id,assignment_status,assigned_email_snapshot"
    )
    .eq("assignment_status", "pending_user_activation")
    .eq("assigned_email_snapshot", email)
    .in("organization_id", activeOrgIds);

  if (pendingError) {
    return {
      success: false,
      error: `Failed to resolve pending conference assignments: ${pendingError.message}`,
    };
  }

  const rows = (pendingRows ?? []) as Array<Record<string, unknown>>;
  const personIds: string[] = [];
  const claimedConferenceIds = new Set<string>();
  for (const row of rows) {
    const personId = row.id as string;
    const conferenceId = row.conference_id as string;
    claimedConferenceIds.add(conferenceId);
    const organizationId = row.organization_id as string;
    const previousUserId = (row.user_id as string | null) ?? null;

    const { error: updateError } = await db
      .from("conference_people")
      .update({
        user_id: auth.ctx.userId,
        canonical_person_id: (
          await ensurePersonForUser({
            userId: auth.ctx.userId,
            organizationId,
            fallbackEmail: email,
          })
        ).personId,
        assignment_status: "assigned",
        assigned_at: new Date().toISOString(),
        reassigned_from_user_id: previousUserId,
        person_kind: "delegate",
        updated_at: new Date().toISOString(),
      })
      .eq("id", personId);
    if (updateError) {
      return {
        success: false,
        error: `Failed to finalize pending assignment: ${updateError.message}`,
      };
    }
    personIds.push(personId);

    await logAuditEventSafe({
      action: "conference_assignment_notification_hook",
      entityType: "conference_people",
      entityId: personId,
      actorId: auth.ctx.userId,
      actorType: "user",
      details: {
        hook: "pending_assignment_finalized",
        conferenceId,
        organizationId,
      },
    });
  }

  // After claiming the seats, surface the assignee legal gate for each conference
  // the user just joined, so the activation surface can prompt them to accept
  // their personal documents before participating. Best-effort — never fail the
  // finalization itself over a gate computation.
  const outstandingLegal: Array<{ conferenceId: string; missing: string[] }> = [];
  for (const conferenceId of claimedConferenceIds) {
    try {
      const gate = await getMyConferenceLegalGate(conferenceId);
      if (gate.success && gate.data && !gate.data.allAccepted) {
        outstandingLegal.push({ conferenceId, missing: gate.data.missing });
      }
    } catch {
      // ignore — gate is advisory here
    }
  }

  return {
    success: true,
    data: { finalizedCount: personIds.length, personIds, outstandingLegal },
  };
}

export type CheckInScanResultState =
  | "valid"
  | "already_checked_in"
  | "invalid_token"
  | "revoked_token"
  | "not_found"
  | "legal_not_accepted";

export async function scanConferenceCheckInToken(params: {
  conferenceId: string;
  qrToken: string;
  scanTimestamp?: string | null;
  deviceId?: string | null;
}): Promise<{
  success: boolean;
  error?: string;
  data?: {
    state: CheckInScanResultState;
    personId: string | null;
    checkedInAt: string | null;
  };
}> {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) return { success: false, error: auth.error };

  const conferenceId = params.conferenceId;
  const token = params.qrToken.trim();
  const deviceId = params.deviceId?.trim() || null;
  const scannedAt = params.scanTimestamp
    ? new Date(params.scanTimestamp).toISOString()
    : new Date().toISOString();
  const db = createAdminClient();

  const insertEvent = async (
    state: CheckInScanResultState,
    personId: string | null,
    scanTokenId: string | null
  ) => {
    await db.from("conference_check_in_events").insert({
      conference_id: conferenceId,
      person_id: personId,
      checked_in_at: scannedAt,
      checked_in_by: auth.ctx.userId,
      check_in_source: "qr",
      scan_token_id: scanTokenId,
      device_id: deviceId,
      result_state: state,
    });
  };

  if (!token) {
    await insertEvent("invalid_token", null, null);
    return {
      success: true,
      data: { state: "invalid_token", personId: null, checkedInAt: null },
    };
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { data: tokenRow, error: tokenError } = await db
    .from("conference_badge_tokens")
    .select("id, person_id, revoked_at")
    .eq("conference_id", conferenceId)
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (tokenError) {
    return { success: false, error: `Failed to resolve scan token: ${tokenError.message}` };
  }

  let resolvedTokenRow = tokenRow;
  if (!resolvedTokenRow) {
    // Immutable v1 token model: QR payload can be the conference_people UUID directly.
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(token)) {
      await insertEvent("invalid_token", null, null);
      return {
        success: true,
        data: { state: "invalid_token", personId: null, checkedInAt: null },
      };
    }

    const { data: personByUuid, error: personByUuidError } = await db
      .from("conference_people")
      .select("id")
      .eq("conference_id", conferenceId)
      .eq("id", token)
      .maybeSingle();
    if (personByUuidError || !personByUuid) {
      await insertEvent("invalid_token", null, null);
      return {
        success: true,
        data: { state: "invalid_token", personId: null, checkedInAt: null },
      };
    }

    const { data: ensuredTokenRows, error: ensureTokenError } = await db.rpc(
      "ensure_conference_badge_token_for_person",
      {
        p_conference_id: conferenceId,
        p_person_id: token,
        p_actor_id: auth.ctx.userId,
      }
    );
    if (ensureTokenError || !Array.isArray(ensuredTokenRows) || ensuredTokenRows.length === 0) {
      return {
        success: false,
        error: ensureTokenError?.message ?? "Failed to ensure badge token for UUID payload.",
      };
    }

    const ensuredTokenId = (ensuredTokenRows[0] as { token_id: string }).token_id;
    const { data: tokenById, error: tokenByIdError } = await db
      .from("conference_badge_tokens")
      .select("id, person_id, revoked_at")
      .eq("id", ensuredTokenId)
      .maybeSingle();
    if (tokenByIdError || !tokenById) {
      return {
        success: false,
        error: tokenByIdError?.message ?? "Failed to resolve ensured token row.",
      };
    }
    resolvedTokenRow = tokenById;
  }

  if (resolvedTokenRow.revoked_at) {
    await insertEvent("revoked_token", resolvedTokenRow.person_id, resolvedTokenRow.id);
    return {
      success: true,
      data: { state: "revoked_token", personId: resolvedTokenRow.person_id, checkedInAt: null },
    };
  }

  const { data: personRow, error: personError } = await db
    .from("conference_people")
    .select("id, checked_in_at, assignment_status")
    .eq("conference_id", conferenceId)
    .eq("id", resolvedTokenRow.person_id)
    .maybeSingle();

  if (personError) {
    return { success: false, error: `Failed to load conference person: ${personError.message}` };
  }

  if (!personRow || personRow.assignment_status === "canceled") {
    await insertEvent("not_found", resolvedTokenRow.person_id, resolvedTokenRow.id);
    return {
      success: true,
      data: { state: "not_found", personId: resolvedTokenRow.person_id, checkedInAt: null },
    };
  }

  if (personRow.checked_in_at) {
    await insertEvent("already_checked_in", personRow.id, resolvedTokenRow.id);
    return {
      success: true,
      data: {
        state: "already_checked_in",
        personId: personRow.id,
        checkedInAt: personRow.checked_in_at,
      },
    };
  }

  // Gate: the attendee must have accepted their personal (assignee) documents
  // before they can be checked in. Best-effort — a gate error never blocks
  // check-in, but an explicit "not accepted" result does.
  try {
    const gate = await getPersonAssigneeLegalGate(conferenceId, personRow.id);
    if (gate.success && gate.data && !gate.data.allAccepted) {
      await insertEvent("legal_not_accepted", personRow.id, resolvedTokenRow.id);
      return {
        success: true,
        data: { state: "legal_not_accepted", personId: personRow.id, checkedInAt: null },
      };
    }
  } catch {
    // ignore — don't let a gate failure block the desk
  }

  const checkedInAt = new Date().toISOString();
  const { error: updateError } = await db
    .from("conference_people")
    .update({
      checked_in_at: checkedInAt,
      check_in_source: "badge_pickup",
      updated_at: checkedInAt,
    })
    .eq("id", personRow.id);
  if (updateError) {
    return { success: false, error: `Failed to set check-in state: ${updateError.message}` };
  }

  await insertEvent("valid", personRow.id, resolvedTokenRow.id);
  await logAuditEventSafe({
    action: "conference_check_in_scan",
    entityType: "conference_people",
    entityId: personRow.id,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: {
      conferenceId,
      scanTokenId: resolvedTokenRow.id,
      resultState: "valid",
      checkedInAt,
      deviceId,
    },
  });

  return {
    success: true,
    data: { state: "valid", personId: personRow.id, checkedInAt },
  };
}
