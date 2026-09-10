import { ORG_TYPE } from "@/lib/constants/org-types";
import {
  DEFAULT_BADGE_TEMPLATE_CONFIG_V1,
  normalizeBadgeTemplateConfig,
  type BadgePersonRecord,
} from "@/lib/conference/badges/template";
import { randomUUID } from "crypto";
import QRCode from "qrcode";
import { renderJobDocumentHtml } from "@/lib/conference/badges/render-html";
import {
  BADGE_TOKEN_FORMAT,
  badgeScanUrl,
  deriveBadgeToken,
  hashBadgeToken,
} from "@/lib/conference/badges/tokens";
import {
  resolveBadgeRun,
  badgeTypeForPerson,
  unnamedSeats,
  type BadgeRun,
  type BadgeRunSeat,
  type BadgeRunType,
} from "@/lib/conference/badges/run";
import { arrangeBadges, normalizeArrangement } from "@/lib/conference/badges/arrangement";
import {
  normalizeBadgePrintStock,
  spareCountsByType,
  spareCountsForJob,
} from "@/lib/conference/badges/print-stock";

/**
 * Build the printable document for one badge job.
 *
 * Extracted from the route handler so something other than an HTTP request can
 * produce it — specifically a real PDF renderer. The route was the only way to
 * get this HTML and it requires a browser session, so there was no way to drive
 * Chrome over it headlessly and see what the PRINTER actually does. Reading the
 * HTML tells you nothing about dropped background graphics, clipped crop marks,
 * or where burnt-in map attribution lands.
 *
 * The handler keeps auth and the HTTP response; this is the document.
 */

export class BadgeDocumentError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "BadgeDocumentError";
  }
}

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
  // Both directions are honoured: the primary key (organisation/room) takes
  // the exhibitor direction, the secondary (person name) takes the delegate
  // one. Previously exhibitorDirection was parsed, threaded through, and
  // silently discarded — a job set to "desc" sorted ascending.
  const primaryDir = exhibitorDirection === "desc" ? -1 : 1;
  const secondaryDir = delegateDirection === "desc" ? -1 : 1;
  // Badges group by REGISTRATION TYPE, in the order the run gives them. There
  // is no delegate/exhibitor split: the two old sort modes were never about
  // roles, they were "order by person" and "order by organisation", and both
  // now apply within every type.
  const byType = new Map<string, HydratedBadgePerson[]>();
  for (const person of people) {
    const key = person.variantKey ?? "";
    const list = byType.get(key) ?? [];
    list.push(person);
    byType.set(key, list);
  }

  // Primary key groups a type's badges (organisation, or hotel room for the
  // on-site desk); secondary orders people within that group.
  const primaryOf = (p: HydratedBadgePerson) =>
    exhibitorMode === "exhibitor_room_number"
      ? p.roomNumber || p.organizationName || ""
      : p.organizationName || p.displayName || "";
  const secondaryOf = (p: HydratedBadgePerson) =>
    delegateMode === "delegate_first_name"
      ? p.firstName || p.displayName || ""
      : p.lastName || p.displayName || "";

  return [...byType.values()].flatMap((rows) =>
    [...rows].sort((a, b) => {
      const primary = compareMaybe(primaryOf(a), primaryOf(b)) * primaryDir;
      if (primary !== 0) return primary;
      const secondary = compareMaybe(secondaryOf(a), secondaryOf(b)) * secondaryDir;
      if (secondary !== 0) return secondary;
      return a.id.localeCompare(b.id);
    })
  );
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

/**
 * An organisation's badge logo.
 *
 * ⛔ CSC has no `logo_url` and never will, because CSC does not have an
 * organisation page — the website IS its page. Staff are not a company that
 * happens to be at the conference; they are the people running it, and this is
 * the same exception the legal gate already makes for them rather than a new
 * special case. Without it the Executive Director, the Conference Coordinator
 * and the Community Manager all print with an empty circle where a logo goes.
 *
 * ⚠️ Keyed on the org TYPE, not on a hardcoded organisation id, so a conference
 * run by a different host resolves its own staff the same way. The path is
 * site-relative; the renderer absolutises it like any other asset.
 */
const SITE_LOGO_URL = "/logos/csc-logo.svg";

function orgLogoUrl(org: Record<string, unknown> | undefined): string | null {
  const declared = typeof org?.logo_url === "string" && org.logo_url.trim() ? org.logo_url : null;
  if (declared) return declared;
  return org?.organization_type === ORG_TYPE.staff ? SITE_LOGO_URL : null;
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
    variantKey: null,
    variantName: null,
    access: null,
    agenda: [],
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
    qrImageDataUri: null,
    organizationSlug: (typeof org?.slug === "string" && org.slug.trim()) || null,
    orgQrImageDataUri: null,
    latitude,
    longitude,
    city,
    province,
    organizationType,
    roomNumber,
  };
}


/**
 * A badge for a seat nobody has been named to.
 *
 * ⛔ NOT a person. The id is prefixed `blank:` and is a SEAT id, so nothing
 * downstream can mistake one for a roster row — in particular nothing mints it
 * a scan token, which is the whole reason a blank is safe to print: there is no
 * identity on it to scan.
 *
 * Everything that belongs to the ORGANISATION still prints — logo, map, city,
 * and the front directory QR — because those are facts about the company, which
 * is known. Everything that belongs to the PERSON is left empty, and that empty
 * name block is the point: it is the space someone writes in at the desk.
 *
 * The schedule on the back comes from the registration TYPE rather than from
 * `run.entitlements`, which is keyed by person and therefore has no entry here.
 * A type-level agenda is exactly right for a blank: whoever ends up holding
 * this seat is admitted to what the seat was sold as, and any separately-bought
 * add-on cannot exist yet because there is nobody to have bought it.
 */
/**
 * A reprint spare: stock for the desk, belonging to nobody.
 *
 * ⛔ No organisation. A seat blank names the company because the company is
 * known; a spare is written on at the desk for whoever needs it, so printing
 * somebody's employer on it would be a guess. It maps the conference hotel for
 * the same reason — there is no home city to show.
 *
 * ⚠️ It DOES carry the registration type's schedule, which is why spares are
 * generated per type rather than as one anonymous pile: a Thursday Day Pass
 * spare and a Full Conference spare admit different people to different days,
 * and a desk handing out the wrong one has given somebody the wrong conference.
 */
function spareBadgeRecord(params: {
  type: BadgeRunType;
  index: number;
  venue: { latitude: number | null; longitude: number | null };
}): HydratedBadgePerson {
  const { type, index, venue } = params;
  return {
    id: `spare:${type.entityId}:${index}`,
    variantKey: type.entityId,
    variantName: type.name,
    displayName: null,
    firstName: null,
    lastName: null,
    roleTitle: null,
    organizationName: null,
    logoUrl: null,
    qrPayload: "",
    qrImageDataUri: null,
    organizationSlug: null,
    orgQrImageDataUri: null,
    latitude: venue.latitude,
    longitude: venue.longitude,
    city: null,
    province: null,
    organizationType: null,
    roomNumber: null,
    access: type.accessSummary,
    agenda: type.agenda,
  };
}

function blankBadgeRecord(params: {
  type: BadgeRunType;
  seat: BadgeRunSeat;
  org: Record<string, unknown> | undefined;
  orgQrByCode: Map<string, string>;
  venue: { latitude: number | null; longitude: number | null };
}): HydratedBadgePerson {
  const { type, seat, org, orgQrByCode, venue } = params;
  const slug = typeof org?.slug === "string" && org.slug.trim() ? org.slug.trim() : null;
  // ⛔ TWO KINDS OF BLANK, and they map different places.
  //
  // A blank for an outstanding SEAT belongs to a known company — you know who
  // they are, just not who is coming — so it keeps that company's map, exactly
  // like a named badge would. A reprint SPARE belongs to nobody: it is stock
  // held back for the desk, so it maps the conference hotel instead. `venue` is
  // set only for spares; seat blanks pass nulls and fall through to the org.
  const latitude =
    venue.latitude ?? (typeof org?.latitude === "number" ? org.latitude : null);
  const longitude =
    venue.longitude ?? (typeof org?.longitude === "number" ? org.longitude : null);
  return {
    id: `blank:${seat.seatId}`,
    variantKey: type.entityId,
    variantName: type.name,
    displayName: null,
    firstName: null,
    lastName: null,
    roleTitle: null,
    organizationName: seat.organizationName || null,
    logoUrl: orgLogoUrl(org),
    // ⛔ Empty, not a placeholder. `qrPayload` feeds a QR generator; a blank
    // must produce NO code rather than a valid code pointing at nothing.
    qrPayload: "",
    qrImageDataUri: null,
    organizationSlug: slug,
    orgQrImageDataUri: slug ? orgQrByCode.get(slug) ?? null : null,
    latitude,
    longitude,
    city:
      (typeof org?.city === "string" && org.city) || seat.organizationCity || null,
    province:
      (typeof org?.province === "string" && org.province) ||
      seat.organizationProvince ||
      null,
    organizationType:
      typeof org?.organization_type === "string" ? org.organization_type : null,
    roomNumber: null,
    access: type.accessSummary,
    agenda: type.agenda,
  };
}

/**
 * The blanks for a run, as a stack.
 *
 * ⛔ Deliberately NOT run through `arrangeBadges` with the named badges. Every
 * sort key an arrangement offers is a fact about the person — surname, first
 * name — and a blank has none of them, so mixing them in would scatter 151
 * identical-looking cards through an alphabetical file that a desk then has to
 * hunt through. They come out as one block at the end, grouped by registration
 * type and then by organisation, which is the order somebody hands them out in.
 */
function blankBadgeStack(
  run: BadgeRun,
  orgById: Map<string, Record<string, unknown>>,
  orgQrByCode: Map<string, string>,
  venue: { latitude: number | null; longitude: number | null }
): HydratedBadgePerson[] {
  return unnamedSeats(run)
    .slice()
    .sort(
      (a, b) =>
        a.type.name.localeCompare(b.type.name) ||
        a.seat.organizationName.localeCompare(b.seat.organizationName) ||
        a.seat.seatId.localeCompare(b.seat.seatId)
    )
    .map(({ type, seat }) =>
      blankBadgeRecord({
        type,
        seat,
        org: orgById.get(seat.organizationId),
        orgQrByCode,
        venue,
      })
    );
}

export async function buildBadgeJobDocument(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- admin or service-role client
  db: any;
  conferenceId: string;
  jobId: string;
}): Promise<{ html: string; title: string; badgeCount: number }> {
  const { db, conferenceId, jobId } = params;


  const { data: jobRow, error: jobError } = await db
    .from("badge_print_jobs")
    .select(
      "id, conference_id, person_id, pipeline_type, batch_order_mode, batch_order_direction, template_version, metadata"
    )
    .eq("id", jobId)
    .eq("conference_id", conferenceId)
    .maybeSingle();

  if (jobError || !jobRow) {
    throw new BadgeDocumentError("Badge job not found.", 404);
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

  // Which registration type each person's badge is for — from the run, the same
  // catalogue → seats → holder walk the admin page and preflight use.
  //
  // Resolved HERE rather than further down because the unnamed seats it carries
  // decide which organisations this document needs: a blank badge is printed for
  // a company nobody from that company has been named at, so its organisation
  // would not appear in the roster query at all.
  const run = await resolveBadgeRun(conferenceId);

  // ⛔ Snapshotted onto the job alongside the arrangement, and read from the job
  // rather than from the operator's current setting. Re-rendering an old job has
  // to reproduce the file that was printed — including whether it had blanks in
  // it — and a run's unnamed seats shrink every time somebody is named, so
  // "regenerate that job" would otherwise quietly produce a different stack.
  const includeBlanks =
    job.pipeline_type !== "onsite_reprint" &&
    (job.metadata as Record<string, unknown> | null)?.includeBlanks === true;
  const blankSeats = includeBlanks ? unnamedSeats(run) : [];

  const { data: tokenRows } = await db
    .from("conference_badge_tokens")
    .select("id, person_id, token_format")
    .eq("conference_id", conferenceId)
    .is("revoked_at", null);

  // Row id -> person, for the tokens that already exist in the derivable format.
  const tokenRowIdByPerson = new Map<string, string>();
  // Person -> the row id of a token in an OLD format. There is a UNIQUE index on
  // (conference_id, person_id), so these cannot simply be skipped and re-minted:
  // see the upgrade below.
  const legacyTokenRowIdByPerson = new Map<string, string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const tokenRow of (tokenRows ?? []) as Record<string, any>[]) {
    const personId = tokenRow.person_id as string | null;
    const rowId = tokenRow.id as string | null;
    if (!personId || !isUuid(personId) || !rowId) continue;
    // Legacy `person_uuid` rows encoded the person's primary key on the badge.
    // Never printed as-is — a badge rendered today gets a real token — but they
    // are UPGRADED rather than ignored, because the person already occupies the
    // one row they are allowed.
    if (tokenRow.token_format !== BADGE_TOKEN_FORMAT) {
      legacyTokenRowIdByPerson.set(personId, rowId);
      continue;
    }
    tokenRowIdByPerson.set(personId, rowId);
  }

  // Never let a failed roster read fall through as an empty roster — that
  // renders a valid, empty PDF and reports success for a job that printed
  // nobody.
  const peopleResult =
    job.pipeline_type === "onsite_reprint" && job.person_id
      ? await db
          .from("conference_people")
          .select("*")
          .eq("conference_id", conferenceId)
          .eq("id", job.person_id)
          .limit(1)
      : await db
          .from("conference_people")
          .select("*")
          .eq("conference_id", conferenceId)
          .neq("assignment_status", "canceled");
  if (peopleResult.error) {
    throw new BadgeDocumentError(
      `Could not load the conference roster: ${peopleResult.error.message}`,
      500
    );
  }
  const peopleRows = (peopleResult.data as Record<string, unknown>[] | null) ?? [];

  const orgIds = Array.from(
    new Set(
      [
        ...peopleRows.map(
          (row) =>
            (typeof row.organization_id === "string" && row.organization_id) ||
            (typeof row.badge_organization_id === "string" && row.badge_organization_id) ||
            null
        ),
        // A company with a seat and nobody named to it has no roster row, so
        // without this its logo, map and directory QR would all come back empty
        // on its own blank badge.
        ...blankSeats.map(({ seat }) => seat.organizationId),
      ].filter((value): value is string => Boolean(value))
    )
  );
  const orgById = new Map<string, Record<string, unknown>>();
  const contactsByOrgEmail = new Map<string, ContactRow>();
  if (orgIds.length > 0) {
    const [{ data: orgRows }, { data: contactRows }] = await Promise.all([
      db
        .from("organizations")
        .select(
          "id, name, slug, logo_url, latitude, longitude, city, province, organization_type"
        )
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
      .from("contacts")
      .select("id, first_name, last_name, primary_email:work_email, title:role_title")
      .in("id", personIds);
    for (const row of (peopleIdentityRows as CanonicalPersonRow[] | null) ?? []) {
      canonicalPersonById.set(row.id, row);
    }
  }

  // ⛔ This used to `.set()` per seat, so a person on two registration types
  // silently took whichever type happened to be iterated LAST — a different
  // answer than the admin count or the /me preview gave. badgeTypeForPerson is
  // the one rule, and preflight blocks the run before it can matter.
  const seatedAtByPersonId = new Map<string, string | null>();
  for (const type of run.types) {
    for (const seat of type.seats) {
      if (seat.person) seatedAtByPersonId.set(seat.person.personId, seat.seatedAt);
    }
  }

  // Hold the whole run type, not a narrowed {entityId, name} literal: the back
  // of the badge prints what this type admits you to, and narrowing here is
  // what stopped that data reaching the renderer in the first place.
  const entitlementByPersonId = new Map(run.entitlements.map((e) => [e.personId, e]));
  const variantByPersonId = new Map<string, BadgeRunType>();
  for (const type of run.types) {
    for (const seat of type.seats) {
      if (!seat.person || variantByPersonId.has(seat.person.personId)) continue;
      variantByPersonId.set(
        seat.person.personId,
        badgeTypeForPerson(run, seat.person.personId) ?? type
      );
    }
  }

  // ⛔ Upgrade a legacy token IN PLACE. There is a UNIQUE index on
  // (conference_id, person_id) — one token row per person, permanently — so a
  // person holding a `person_uuid` row cannot be given a second, modern one.
  // Treating them as "needs minting" therefore did not skip them, it threw:
  //
  //     Could not mint badge scan tokens: duplicate key value violates unique
  //     constraint "idx_conference_badge_tokens_one_per_person"
  //
  // and that error aborts the WHOLE document build. One person on a legacy
  // token — which is what an on-site reprint hands out — made every badge job
  // for the entire conference unrenderable. Verified: the 13-person run failed
  // outright until this ran.
  //
  // The row id is what the token is derived from, so upgrading is a re-hash of
  // the SAME id: the row keeps its identity, and anything already pointing at
  // it keeps working.
  for (const [personId, rowId] of legacyTokenRowIdByPerson) {
    const { error: upgradeError } = await db
      .from("conference_badge_tokens")
      .update({
        token_format: BADGE_TOKEN_FORMAT,
        token_hash: hashBadgeToken(deriveBadgeToken(conferenceId, rowId)),
      })
      .eq("id", rowId);
    if (upgradeError) {
      throw new Error(
        `Could not upgrade a legacy badge token: ${upgradeError.message}`
      );
    }
    tokenRowIdByPerson.set(personId, rowId);
  }

  // Mint a token for anyone in this job who lacks one entirely. Idempotent: a
  // person who already has an active row keeps it, so a reprint reproduces the
  // same QR.
  const needTokens = peopleRows
    .map((row) => (typeof row.id === "string" ? row.id : null))
    .filter((id): id is string => id !== null && isUuid(id) && !tokenRowIdByPerson.has(id));
  if (needTokens.length > 0) {
    // The id is generated HERE, not by the database: the token is derived from
    // it, and `UNIQUE (conference_id, token_hash)` rules out inserting rows with
    // a placeholder hash and filling it in afterwards — the second row of any
    // batch would collide with the first.
    const pending = needTokens.map((personId) => {
      const rowId = randomUUID();
      return {
        id: rowId,
        conference_id: conferenceId,
        person_id: personId,
        token_format: BADGE_TOKEN_FORMAT,
        token_hash: hashBadgeToken(deriveBadgeToken(conferenceId, rowId)),
      };
    });
    const { error: mintError } = await db.from("conference_badge_tokens").insert(pending);
    if (mintError) {
      throw new Error(`Could not mint badge scan tokens: ${mintError.message}`);
    }
    for (const row of pending) tokenRowIdByPerson.set(row.person_id, row.id);
  }

  // The QR is generated here, not fetched from api.qrserver.com: that sent every
  // attendee's identifier to a third party and made badge printing depend on
  // their uptime. SVG so it stays sharp at any print size.
  const tokenMap = new Map<string, string>();
  const qrImageByPersonId = new Map<string, string>();
  for (const [personId, rowId] of tokenRowIdByPerson) {
    const url = badgeScanUrl(deriveBadgeToken(conferenceId, rowId));
    tokenMap.set(personId, url);
    const svg = await QRCode.toString(url, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 0,
    });
    qrImageByPersonId.set(personId, `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
  }

  // The exhibitor front's public code, as its own QR. Cached per organisation
  // rather than per person: one exhibitor's staff all share one listing, so
  // generating it per badge would be the same image N times.
  const orgQrByCode = new Map<string, string>();
  const orgSlugs = new Set(
    [...orgById.values()]
      .map((o) => (typeof o.slug === "string" ? o.slug.trim() : ""))
      .filter(Boolean)
  );
  for (const code of orgSlugs) {
    const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://campusstores.ca").replace(/\/+$/, "");
    // ?s=b marks the provenance: a badge scan is neither the printed book nor a
    // shared link, and the directory's own tracking already distinguishes them.
    // /org/<slug>, not the printed directory's /e/<code>: that page is the
    // book's landing pad and is deliberately public-only. /org/<slug> is
    // viewer-aware, which is the whole point of scanning while signed in.
    const svg = await QRCode.toString(`${base}/org/${code}?s=b`, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 0,
    });
    orgQrByCode.set(code, `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
  }

  const hydrated = peopleRows
    .map((row) =>
      toBadgePerson(row, tokenMap, orgById, contactsByOrgEmail, canonicalPersonById)
    )
    .filter((row): row is HydratedBadgePerson => Boolean(row))
    .map((person) => {
      const variant = variantByPersonId.get(person.id);
      // Entitlement is per PERSON (registration + any separately-sold seats);
      // only the LAYOUT comes from the registration type.
      const entitlement = entitlementByPersonId.get(person.id);
      return {
        ...person,
        ...(variant ? { variantKey: variant.entityId, variantName: variant.name } : {}),
        qrImageDataUri: qrImageByPersonId.get(person.id) ?? null,
        orgQrImageDataUri: person.organizationSlug
          ? (orgQrByCode.get(person.organizationSlug) ?? null)
          : null,
        access: entitlement?.access ?? variant?.accessSummary ?? null,
        agenda: entitlement?.agenda ?? variant?.agenda ?? [],
      };
    });

  // How the file is stacked. The job SNAPSHOT wins — re-rendering an old job
  // must reproduce the file that was printed, not the operator's current
  // arrangement. Jobs queued before arrangements existed carry none, and fall
  // back to the legacy two-role ordering below.
  const snapshot = (job.metadata as Record<string, unknown> | null)?.arrangement ?? null;
  let ordered: HydratedBadgePerson[];
  if (snapshot) {
    const arrangement = normalizeArrangement(
      snapshot,
      run.types.map((t) => ({ entityId: t.entityId, name: t.name }))
    );
    const sections = arrangeBadges(
      hydrated.map((p) => ({
        ...p,
        entityId: p.variantKey ?? "",
        entityName: p.variantName ?? "",
        roomNumber: p.roomNumber ?? null,
        seatedAt: seatedAtByPersonId.get(p.id) ?? null,
      })),
      arrangement
    );
    ordered = sections.flatMap((s) => s.badges) as unknown as HydratedBadgePerson[];
  } else {
    const ordering = parseOrderModeFromJob(job);
    ordered = applyOrdering({
      people: hydrated,
      delegateMode: ordering.delegateMode,
      delegateDirection: ordering.delegateDirection,
      exhibitorMode: ordering.exhibitorMode,
      exhibitorDirection: ordering.exhibitorDirection,
    });
  }
  // ⛔ Blanks go on the END of the file, after everything the arrangement
  // ordered. They are not part of the arrangement — see blankBadgeStack — and
  // appending them here rather than merging them in keeps the named run byte-
  // for-byte identical to a run generated without blanks.
  if (blankSeats.length > 0) {
    // Seat blanks: the company is known, so they map the company.
    ordered = [
      ...ordered,
      ...blankBadgeStack(run, orgById, orgQrByCode, { latitude: null, longitude: null }),
    ];
  }

  // Reprint spares, last in the file: unbranded stock for the desk.
  //
  // ⛔ Gated on the operator asking for blank stock and the conference enabling
  // spares — NOT on there being unnamed seats. Those are different populations:
  // a seat blank covers somebody who has not been named yet, a spare covers a
  // card that gets damaged or a walk-up. Nesting this inside "there are unnamed
  // seats" meant a conference that got every name in before print day — the
  // best case — would have arrived with no desk stock at all.
  {
    const stock = normalizeBadgePrintStock(
      (job.metadata as Record<string, unknown> | null)?.printStock ?? null
    );
    if (includeBlanks && stock.enabled) {
      const { data: venueRow } = await db
        .from("conference_instances")
        .select("location_latitude, location_longitude")
        .eq("id", conferenceId)
        .maybeSingle();
      const venue = {
        latitude:
          typeof venueRow?.location_latitude === "number" ? venueRow.location_latitude : null,
        longitude:
          typeof venueRow?.location_longitude === "number" ? venueRow.location_longitude : null,
      };
      // ⛔ Split across the types that actually sell seats, because a spare
      // carries its type's schedule. Proportional to seats sold, so the stack
      // the desk reaches for most is the one it has most of.
      const counts = await spareCountsForJob(db, conferenceId, run, stock);
      // ⛔ ONE rule for how spares divide across types — shared with the desk, so
      // it is told to reach for a stack that actually exists.
      const byType = spareCountsByType(run, counts.total);
      const spares: HydratedBadgePerson[] = [];
      for (const entry of byType) {
        const type = run.types.find((t) => t.entityId === entry.entityId);
        if (!type) continue;
        for (let n = 0; n < entry.count; n += 1) {
          spares.push(spareBadgeRecord({ type, index: n, venue }));
        }
      }
      ordered = [...ordered, ...spares];
    }
  }

  // Read the coordinator's CURRENT number rather than a copy baked into the
  // template: badges are laid out months before they print.
  let onsiteContact: { name: string; phone: string } | null = null;
  if (templateConfig.onsiteContactId) {
    const { data: contactRow } = await db
      .from("contacts")
      .select("first_name, last_name, name, phone, work_phone_number, role_title")
      .eq("id", templateConfig.onsiteContactId)
      .maybeSingle();
    const phone =
      (typeof contactRow?.work_phone_number === "string" && contactRow.work_phone_number.trim()) ||
      (typeof contactRow?.phone === "string" && contactRow.phone.trim()) ||
      "";
    const name =
      [contactRow?.first_name, contactRow?.last_name].filter(Boolean).join(" ").trim() ||
      (typeof contactRow?.name === "string" ? contactRow.name.trim() : "");
    if (phone) onsiteContact = { name, phone };
  }

  const html = renderJobDocumentHtml({
    title: `Badge Job ${job.id}`,
    template: templateConfig,
    people: ordered,
    includeBack: true,
    venueAddress: run.venueAddress,
    onsiteContact,
  });

  return { html, title: `Badge Job ${job.id}`, badgeCount: ordered.length };
}
