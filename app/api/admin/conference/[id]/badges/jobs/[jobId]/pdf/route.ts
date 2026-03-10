import { NextResponse } from "next/server";
import { requireConferenceOpsAccess } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  DEFAULT_BADGE_TEMPLATE_CONFIG_V1,
  normalizeBadgeTemplateConfig,
  type BadgePersonRecord,
} from "@/lib/conference/badges/template";
import { renderJobDocumentHtml } from "@/lib/conference/badges/render-html";

export const dynamic = "force-dynamic";

type BadgeJobRow = {
  id: string;
  conference_id: string;
  person_id: string | null;
  pipeline_type: string;
  batch_order_mode: string | null;
  batch_order_direction: "asc" | "desc" | null;
  template_version: number | null;
  metadata: Record<string, unknown> | null;
};

type DelegateOrderMode = "delegate_first_name" | "delegate_last_name";
type ExhibitorOrderMode = "exhibitor_room_number" | "exhibitor_org_name";
type GroupDirection = "asc" | "desc";

function compareMaybe(a: string | null | undefined, b: string | null | undefined): number {
  return (a ?? "").localeCompare(b ?? "", "en", { sensitivity: "base" });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function deriveNames(row: Record<string, unknown>): {
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
} {
  const first = typeof row.first_name === "string" ? row.first_name.trim() : "";
  const last = typeof row.last_name === "string" ? row.last_name.trim() : "";
  const display = typeof row.display_name === "string" ? row.display_name.trim() : "";
  if (first || last) {
    return {
      firstName: first || null,
      lastName: last || null,
      displayName: `${first} ${last}`.trim() || null,
    };
  }
  if (!display) return { firstName: null, lastName: null, displayName: null };
  const parts = display.split(/\s+/);
  return {
    firstName: parts[0] || null,
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : null,
    displayName: display,
  };
}

function applyOrdering(params: {
  people: HydratedBadgePerson[];
  delegateMode: DelegateOrderMode;
  delegateDirection: GroupDirection;
  exhibitorMode: ExhibitorOrderMode;
  exhibitorDirection: GroupDirection;
}): HydratedBadgePerson[] {
  const { people, delegateMode, delegateDirection, exhibitorMode, exhibitorDirection } = params;
  const delegateDir = delegateDirection === "desc" ? -1 : 1;
  const exhibitorDir = exhibitorDirection === "desc" ? -1 : 1;
  const delegates = people.filter((p) => p.personKind.toLowerCase() !== "exhibitor");
  const exhibitors = people.filter((p) => p.personKind.toLowerCase() === "exhibitor");

  const sortBy = (
    rows: HydratedBadgePerson[],
    getter: (p: HydratedBadgePerson) => string,
    dir: 1 | -1
  ) =>
    rows
      .slice()
      .sort((a, b) => {
        const cmp = compareMaybe(getter(a), getter(b));
        if (cmp !== 0) return cmp * dir;
        return a.id.localeCompare(b.id);
      });

  const sortedDelegates =
    delegateMode === "delegate_first_name"
      ? sortBy(delegates, (p) => p.firstName || p.displayName || "", delegateDir as 1 | -1)
      : sortBy(delegates, (p) => p.lastName || p.displayName || "", delegateDir as 1 | -1);
  const sortedExhibitors =
    exhibitorMode === "exhibitor_room_number"
      ? sortBy(exhibitors, (p) => p.roomNumber || p.organizationName || "", exhibitorDir as 1 | -1)
      : sortBy(exhibitors, (p) => p.organizationName || p.displayName || "", exhibitorDir as 1 | -1);
  return [...sortedDelegates, ...sortedExhibitors];
}

function parseOrderModeFromJob(job: BadgeJobRow): {
  delegateMode: DelegateOrderMode;
  delegateDirection: GroupDirection;
  exhibitorMode: ExhibitorOrderMode;
  exhibitorDirection: GroupDirection;
} {
  const ordering = (job.metadata?.ordering ?? {}) as Record<string, unknown>;
  const delegateOrdering =
    (ordering.delegate as Record<string, unknown> | undefined) ?? {};
  const exhibitorOrdering =
    (ordering.exhibitor as Record<string, unknown> | undefined) ?? {};

  const delegateModeRaw = String(
    delegateOrdering.mode ?? "delegate_last_name"
  );
  const exhibitorModeRaw = String(
    exhibitorOrdering.mode ?? "exhibitor_org_name"
  );
  const delegateDirectionRaw = String(delegateOrdering.direction ?? "asc");
  const exhibitorDirectionRaw = String(exhibitorOrdering.direction ?? "asc");

  return {
    delegateMode:
      delegateModeRaw === "delegate_first_name" ? "delegate_first_name" : "delegate_last_name",
    delegateDirection: delegateDirectionRaw === "desc" ? "desc" : "asc",
    exhibitorMode:
      exhibitorModeRaw === "exhibitor_room_number"
        ? "exhibitor_room_number"
        : "exhibitor_org_name",
    exhibitorDirection: exhibitorDirectionRaw === "desc" ? "desc" : "asc",
  };
}

type HydratedBadgePerson = BadgePersonRecord & {
  firstName: string | null;
  lastName: string | null;
  roomNumber: string | null;
};

type ContactRow = {
  organization_id: string | null;
  name: string | null;
  email: string | null;
  work_email: string | null;
  role_title: string | null;
};
type UserIdentityRow = {
  id: string;
  person_id: string | null;
};
type CanonicalPersonRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  primary_email: string | null;
  title: string | null;
};

function resolveCanonicalContactByEmail(
  contactsByOrgEmail: Map<string, ContactRow>,
  organizationId: string | null,
  contactEmail: string | null
): ContactRow | null {
  const org = organizationId?.trim();
  const email = contactEmail?.trim().toLowerCase();
  if (!org || !email) return null;
  return contactsByOrgEmail.get(`${org}:${email}`) ?? null;
}

function toBadgePerson(
  row: Record<string, unknown>,
  qrPayloadByPersonId: Map<string, string>,
  orgById: Map<string, Record<string, unknown>>,
  contactsByOrgEmail: Map<string, ContactRow>,
  canonicalPersonById: Map<string, CanonicalPersonRow>
): HydratedBadgePerson | null {
  const id = typeof row.id === "string" ? row.id : null;
  if (!id || !isUuid(id)) return null;
  const qrPayload = qrPayloadByPersonId.get(id) ?? id;
  const canonicalPersonId = typeof row.canonical_person_id === "string" ? row.canonical_person_id : null;
  const canonicalPerson = canonicalPersonId
    ? canonicalPersonById.get(canonicalPersonId) ?? null
    : null;
  const organizationId =
    (typeof row.organization_id === "string" && row.organization_id) ||
    (typeof row.badge_organization_id === "string" && row.badge_organization_id) ||
    null;
  const org = organizationId ? orgById.get(organizationId) : null;
  const names = canonicalPerson
    ? {
        firstName: canonicalPerson.first_name?.trim() || null,
        lastName: canonicalPerson.last_name?.trim() || null,
        displayName:
          `${canonicalPerson.first_name ?? ""} ${canonicalPerson.last_name ?? ""}`.trim() || null,
      }
    : deriveNames(row);
  const displayName = names.displayName;
  const rowContactEmail =
    (canonicalPerson?.primary_email?.trim().toLowerCase() || null) ||
    (typeof row.contact_email === "string" && row.contact_email.trim()) ||
    (typeof row.assigned_email_snapshot === "string" && row.assigned_email_snapshot.trim()) ||
    (typeof row.delegate_email === "string" && row.delegate_email.trim()) ||
    null;
  const canonicalContact = resolveCanonicalContactByEmail(
    contactsByOrgEmail,
    organizationId,
    rowContactEmail
  );
  const orgName =
    (typeof row.organization_name === "string" && row.organization_name.trim()) ||
    (typeof row.badge_org_name === "string" && row.badge_org_name.trim()) ||
    (typeof org?.name === "string" && org.name.trim()) ||
    null;
  const logoUrl =
    (typeof row.organization_logo_url === "string" && row.organization_logo_url.trim()) ||
    (typeof row.logo_url === "string" && row.logo_url.trim()) ||
    (typeof org?.logo_url === "string" && org.logo_url.trim()) ||
    null;
  const latitude = asNumber(row.latitude) ?? asNumber(org?.latitude) ?? null;
  const longitude = asNumber(row.longitude) ?? asNumber(org?.longitude) ?? null;
  const city =
    (typeof row.city === "string" && row.city.trim()) ||
    (typeof org?.city === "string" && org.city.trim()) ||
    null;
  const province =
    (typeof row.province === "string" && row.province.trim()) ||
    (typeof org?.province === "string" && org.province.trim()) ||
    null;
  const organizationType =
    (typeof row.organization_type === "string" && row.organization_type.trim()) ||
    (typeof org?.organization_type === "string" && org.organization_type.trim()) ||
    null;
  const roomNumber =
    (typeof row.room_number === "string" && row.room_number.trim()) ||
    (typeof row.hotel_room_number === "string" && row.hotel_room_number.trim()) ||
    null;

  return {
    id,
    personKind:
      (typeof row.person_kind === "string" && row.person_kind.trim()) || "delegate",
    displayName,
    firstName: names.firstName,
    lastName: names.lastName,
    roleTitle:
      (canonicalPerson?.title?.trim() || null) ||
      (typeof row.role_title === "string" && row.role_title.trim()) ||
      (typeof row.delegate_title === "string" && row.delegate_title.trim()) ||
      (canonicalContact?.role_title?.trim() || null) ||
      null,
    organizationName: orgName,
    logoUrl,
    qrPayload,
    latitude,
    longitude,
    city,
    province,
    organizationType,
    roomNumber,
  };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; jobId: string }> }
) {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 403 });

  const { id: conferenceId, jobId } = await context.params;
  const db = createAdminClient();

  const { data: jobRow, error: jobError } = await db
    .from("badge_print_jobs")
    .select(
      "id, conference_id, person_id, pipeline_type, batch_order_mode, batch_order_direction, template_version, metadata"
    )
    .eq("id", jobId)
    .eq("conference_id", conferenceId)
    .maybeSingle();

  if (jobError || !jobRow) {
    return NextResponse.json({ error: "Badge job not found." }, { status: 404 });
  }

  const job = jobRow as unknown as BadgeJobRow;

  const templateVersion = Number.isFinite(Number(job.template_version))
    ? Number(job.template_version)
    : null;
  let templateConfig = DEFAULT_BADGE_TEMPLATE_CONFIG_V1;
  if (templateVersion && templateVersion > 0) {
    const { data: configRow } = await db
      .from("badge_template_configs")
      .select("field_mapping")
      .eq("conference_id", conferenceId)
      .eq("config_version", templateVersion)
      .maybeSingle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    templateConfig = normalizeBadgeTemplateConfig((configRow as any)?.field_mapping ?? null);
  } else {
    let activeConfigRow: Record<string, unknown> | null = null;
    const { data } = await db
      .from("badge_template_configs")
      .select("field_mapping")
      .eq("conference_id", conferenceId)
      .eq("status", "active")
      .order("config_version", { ascending: false })
      .limit(1)
      .maybeSingle();
    activeConfigRow = (data as Record<string, unknown> | null) ?? null;
    if (!activeConfigRow) {
      const { data: latestConfigRow } = await db
        .from("badge_template_configs")
        .select("field_mapping")
        .eq("conference_id", conferenceId)
        .order("config_version", { ascending: false })
        .limit(1)
        .maybeSingle();
      activeConfigRow = (latestConfigRow as Record<string, unknown> | null) ?? null;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    templateConfig = normalizeBadgeTemplateConfig((activeConfigRow as any)?.field_mapping ?? null);
  }

  const { data: tokenRows } = await db
    .from("conference_badge_tokens")
    .select("person_id")
    .eq("conference_id", conferenceId)
    .is("revoked_at", null);

  const tokenMap = new Map<string, string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const tokenRow of (tokenRows ?? []) as Record<string, any>[]) {
    const personId = tokenRow.person_id as string | null;
    if (personId && isUuid(personId)) tokenMap.set(personId, personId);
  }

  let peopleRows: Record<string, unknown>[] = [];
  if (job.pipeline_type === "onsite_reprint" && job.person_id) {
    const { data } = await db
      .from("conference_people")
      .select("*")
      .eq("conference_id", conferenceId)
      .eq("id", job.person_id)
      .limit(1);
    peopleRows = (data as Record<string, unknown>[] | null) ?? [];
  } else {
    const { data } = await db
      .from("conference_people")
      .select("*")
      .eq("conference_id", conferenceId)
      .neq("assignment_status", "canceled");
    peopleRows = (data as Record<string, unknown>[] | null) ?? [];
  }

  const orgIds = Array.from(
    new Set(
      peopleRows
        .map(
          (row) =>
            (typeof row.organization_id === "string" && row.organization_id) ||
            (typeof row.badge_organization_id === "string" && row.badge_organization_id) ||
            null
        )
        .filter((value): value is string => Boolean(value))
    )
  );
  const orgById = new Map<string, Record<string, unknown>>();
  const contactsByOrgEmail = new Map<string, ContactRow>();
  if (orgIds.length > 0) {
    const [{ data: orgRows }, { data: contactRows }] = await Promise.all([
      db
        .from("organizations")
        .select("id, name, logo_url, latitude, longitude, city, province, organization_type")
        .in("id", orgIds),
      db
        .from("contacts")
        .select("organization_id, name, email, work_email, role_title")
        .in("organization_id", orgIds),
    ]);
    for (const row of (orgRows as Record<string, unknown>[] | null) ?? []) {
      if (typeof row.id === "string") {
        orgById.set(row.id, row);
      }
    }
    for (const row of (contactRows as ContactRow[] | null) ?? []) {
      if (!row.organization_id) continue;
      const workEmail = row.work_email?.trim().toLowerCase();
      const email = row.email?.trim().toLowerCase();
      if (workEmail) {
        contactsByOrgEmail.set(`${row.organization_id}:${workEmail}`, row);
      }
      if (email) {
        contactsByOrgEmail.set(`${row.organization_id}:${email}`, row);
      }
    }
  }

  const userIds = Array.from(
    new Set(
      peopleRows
        .map((row) => (typeof row.user_id === "string" ? row.user_id : null))
        .filter((value): value is string => Boolean(value))
    )
  );
  const canonicalPersonById = new Map<string, CanonicalPersonRow>();
  const canonicalPersonIdsFromRows = Array.from(
    new Set(
      peopleRows
        .map((row) =>
          typeof row.canonical_person_id === "string" && isUuid(row.canonical_person_id)
            ? row.canonical_person_id
            : null
        )
        .filter((value): value is string => Boolean(value))
    )
  );
  const personIds = [...canonicalPersonIdsFromRows];
  if (userIds.length > 0) {
    const { data: userRows } = await db
      .from("users")
      .select("id, person_id")
      .in("id", userIds);
    const validUsers = ((userRows as UserIdentityRow[] | null) ?? []).filter(
      (row): row is UserIdentityRow =>
        typeof row.id === "string" &&
        (!row.person_id || (typeof row.person_id === "string" && isUuid(row.person_id)))
    );
    const personIdsFromUsers = Array.from(
      new Set(validUsers.map((row) => row.person_id).filter((value): value is string => Boolean(value)))
    );
    for (const personId of personIdsFromUsers) {
      if (!personIds.includes(personId)) personIds.push(personId);
    }
  }
  if (personIds.length > 0) {
    const { data: peopleIdentityRows } = await db
      .from("people")
      .select("id, first_name, last_name, primary_email, title")
      .in("id", personIds);
    for (const row of (peopleIdentityRows as CanonicalPersonRow[] | null) ?? []) {
      canonicalPersonById.set(row.id, row);
    }
  }

  const hydrated = peopleRows
    .map((row) =>
      toBadgePerson(row, tokenMap, orgById, contactsByOrgEmail, canonicalPersonById)
    )
    .filter((row): row is HydratedBadgePerson => Boolean(row));

  const ordering = parseOrderModeFromJob(job);
  const ordered = applyOrdering({
    people: hydrated,
    delegateMode: ordering.delegateMode,
    delegateDirection: ordering.delegateDirection,
    exhibitorMode: ordering.exhibitorMode,
    exhibitorDirection: ordering.exhibitorDirection,
  });
  const html = renderJobDocumentHtml({
    title: `Badge Job ${job.id}`,
    template: templateConfig,
    people: ordered,
    includeBack: true,
  });

  return new NextResponse(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-disposition": `inline; filename=\"badge-job-${job.id}.html\"`,
    },
  });
}
