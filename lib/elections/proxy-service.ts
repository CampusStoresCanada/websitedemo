/**
 * Database access for member-meeting proxies.
 *
 * Separate from service.ts because a proxy is not an election object. It hangs
 * off the MEETING (By-Law Part VII), carries the member's vote on every question
 * put to that meeting, and outlives any particular election. The election reads
 * the register; it does not own it.
 *
 * Admin client throughout, for the reason stated at the top of service.ts:
 * `meeting_proxies` is revoked from `authenticated`, so a session client writes
 * zero rows and reports success. Authorization happens in the actions above.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import {
  evaluateProxyholder,
  requiresSignedDocument,
  type ProxyEligibility,
  type ProxyFormSource,
  type ProxyGrantorFacts,
  type ProxyPersonFacts,
} from "./proxy";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
const ok = <T,>(data: T): Result<T> => ({ ok: true, data });
const fail = <T,>(error: string): Result<T> => ({ ok: false, error });

export interface ProxyCandidate extends ProxyPersonFacts {
  organizationName: string | null;
  eligibility: ProxyEligibility;
}

export interface ProxyRecord {
  id: string;
  meetingId: string;
  grantorOrganizationId: string;
  grantorOrganizationName: string | null;
  grantorContactId: string | null;
  grantorContactName: string | null;
  proxyholderContactId: string;
  proxyholderName: string | null;
  proxyholderOrganizationName: string | null;
  formSource: ProxyFormSource;
  documentPath: string | null;
  signedAt: string;
  revokedAt: string | null;
  revocationReason: string | null;
}

/**
 * Contact rows carry the organization inline. Supabase types the embedded
 * relation as an object or a one-element array depending on how the join is
 * inferred, and getting this wrong yields `undefined` rather than an error —
 * so normalise once, here, instead of at each use.
 */
function embedded<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

async function loadGrantorFacts(
  db: ReturnType<typeof createAdminClient>,
  organizationId: string
): Promise<ProxyGrantorFacts | null> {
  const { data } = await db
    .from("organizations")
    .select("id, type, membership_status")
    .eq("id", organizationId)
    .maybeSingle();
  if (!data) return null;
  return {
    organizationId: data.id,
    organizationType: data.type,
    organizationMembershipStatus: data.membership_status,
  };
}

/**
 * Everyone the given store could appoint, each already judged.
 *
 * Returns the ineligible ones too, with their refusal reason. A picker that
 * silently omits people is impossible to debug from the member's side — "why
 * isn't my colleague in this list" has no answer — and the refusal text is the
 * only place the by-law rule gets explained at the moment it bites.
 */
export async function listProxyCandidates(
  grantorOrganizationId: string
): Promise<Result<ProxyCandidate[]>> {
  const db = createAdminClient();

  const grantor = await loadGrantorFacts(db, grantorOrganizationId);
  if (!grantor) return fail("That organization does not exist.");

  // Who counts as a "Primary Store contact" (By-Law Part VII S7) is the
  // org_admin role, NOT `contacts.is_primary`. Confirmed by the ED 2026-08-26:
  // the admins ARE the primary store contacts, and the flag is stale data that
  // lags reality — reading it turned away 9 real admins and left 3 member
  // stores with nobody able to hold another store's proxy.
  const { data: adminRows } = await db
    .from("user_organizations")
    .select("user_id, organization_id")
    .eq("role", "org_admin")
    .eq("status", "active");

  const adminProfilesByOrg = new Map<string, Set<string>>();
  for (const r of adminRows ?? []) {
    const set = adminProfilesByOrg.get(r.organization_id as string) ?? new Set<string>();
    set.add(r.user_id as string);
    adminProfilesByOrg.set(r.organization_id as string, set);
  }

  // Scoped to member stores. Loading every contact would pull vendor partner
  // staff in only to refuse them one by one — ~950 rows to explain 70.
  const { data: memberOrgs } = await db
    .from("organizations")
    .select("id")
    .eq("type", "Member")
    .in("membership_status", ["active", "reactivated"])
    .is("archived_at", null);

  const scope = [
    ...new Set([grantorOrganizationId, ...(memberOrgs ?? []).map((o) => o.id as string)]),
  ];

  // Own-store colleagues, plus every member store's administrators. One query:
  // a store's own staff plus a handful per member store is a small set, and
  // splitting it would cost a round trip per organization.
  const { data, error } = await db
    .from("contacts")
    .select(
      "id, name, first_name, last_name, profile_id, organization_id, archived_at, organizations(name, type, membership_status)"
    )
    .is("archived_at", null)
    .in("organization_id", scope);

  if (error) return fail(`Could not load contacts: ${error.message}`);

  const candidates: ProxyCandidate[] = (data ?? []).map((row) => {
    const org = embedded(row.organizations as never) as
      | { name: string | null; type: string | null; membership_status: string | null }
      | null;

    const displayName =
      row.name ??
      [row.first_name, row.last_name].filter(Boolean).join(" ").trim() ??
      null;

    const facts: ProxyPersonFacts = {
      contactId: row.id,
      name: displayName || null,
      organizationId: row.organization_id,
      organizationType: org?.type ?? null,
      organizationMembershipStatus: org?.membership_status ?? null,
      isPrimaryContact:
        row.profile_id !== null &&
        (adminProfilesByOrg.get(row.organization_id as string)?.has(row.profile_id as string) ??
          false),
      active: row.archived_at === null,
    };

    return {
      ...facts,
      organizationName: org?.name ?? null,
      eligibility: evaluateProxyholder(grantor, facts),
    };
  });

  // Eligible first, then by store, then by name — the member is looking for a
  // person, not scrolling a table.
  candidates.sort((a, b) => {
    if (a.eligibility.eligible !== b.eligibility.eligible) {
      return a.eligibility.eligible ? -1 : 1;
    }
    const org = (a.organizationName ?? "").localeCompare(b.organizationName ?? "");
    if (org !== 0) return org;
    return (a.name ?? "").localeCompare(b.name ?? "");
  });

  return ok(candidates);
}

export interface AppointProxyInput {
  meetingId: string;
  grantorOrganizationId: string;
  /** S7(c) "signed by the member" — who signed. */
  grantorContactId: string | null;
  proxyholderContactId: string;
  formSource?: ProxyFormSource;
  /** Storage path of the signed form. Required for paper/facsimile. */
  documentPath?: string | null;
  actorId?: string | null;
}

/**
 * Appoint a proxyholder for one meeting.
 *
 * Re-checks eligibility here rather than trusting the caller: the picker's
 * verdict was computed against contact and membership state that may have moved
 * since it rendered, and this is the point of record.
 */
export async function appointProxy(
  input: AppointProxyInput
): Promise<Result<{ proxyId: string; replaced: boolean }>> {
  const db = createAdminClient();
  const formSource: ProxyFormSource = input.formSource ?? "online";

  if (requiresSignedDocument(formSource) && !input.documentPath) {
    return fail(
      "A paper or faxed proxy has to have the signed form attached — that document is the appointment."
    );
  }

  const { data: meeting } = await db
    .from("board_meetings")
    .select("id, meeting_type, meeting_date")
    .eq("id", input.meetingId)
    .maybeSingle();
  if (!meeting) return fail("That meeting does not exist.");

  const grantor = await loadGrantorFacts(db, input.grantorOrganizationId);
  if (!grantor) return fail("That organization does not exist.");

  const { data: holder } = await db
    .from("contacts")
    .select(
      "id, name, first_name, last_name, profile_id, organization_id, archived_at, organizations(type, membership_status)"
    )
    .eq("id", input.proxyholderContactId)
    .maybeSingle();
  if (!holder) return fail("That contact does not exist.");

  // Same rule as the picker: org_admin is the Primary Store contact.
  const { data: holderAdmin } = holder.profile_id
    ? await db
        .from("user_organizations")
        .select("user_id")
        .eq("organization_id", holder.organization_id as string)
        .eq("user_id", holder.profile_id as string)
        .eq("role", "org_admin")
        .eq("status", "active")
        .maybeSingle()
    : { data: null };

  const holderOrg = embedded(holder.organizations as never) as
    | { type: string | null; membership_status: string | null }
    | null;

  const verdict = evaluateProxyholder(grantor, {
    contactId: holder.id,
    name: holder.name,
    organizationId: holder.organization_id,
    organizationType: holderOrg?.type ?? null,
    organizationMembershipStatus: holderOrg?.membership_status ?? null,
    isPrimaryContact: holderAdmin !== null,
    active: holder.archived_at === null,
  });

  if (!verdict.eligible) return fail(verdict.reason);

  if (input.grantorContactId && input.grantorContactId === input.proxyholderContactId) {
    return fail("A proxy appoints someone else to carry the vote — you already hold your own.");
  }

  // One live proxy per store per meeting. Revoking the previous one rather than
  // erroring is the behaviour a member expects from changing their mind, and the
  // partial unique index would reject the insert otherwise.
  const { data: existing } = await db
    .from("meeting_proxies")
    .select("id")
    .eq("meeting_id", input.meetingId)
    .eq("grantor_organization_id", input.grantorOrganizationId)
    .is("revoked_at", null)
    .maybeSingle();

  const now = new Date().toISOString();

  if (existing) {
    await db
      .from("meeting_proxies")
      .update({
        revoked_at: now,
        revoked_by: input.actorId ?? null,
        revocation_reason: "Replaced by a later appointment",
        updated_at: now,
      })
      .eq("id", existing.id);
  }

  const { data: inserted, error } = await db
    .from("meeting_proxies")
    .insert({
      meeting_id: input.meetingId,
      grantor_organization_id: input.grantorOrganizationId,
      grantor_contact_id: input.grantorContactId,
      proxyholder_contact_id: input.proxyholderContactId,
      form_source: formSource,
      document_path: input.documentPath ?? null,
      signed_at: now,
      created_by: input.actorId ?? null,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    return fail(`Could not record the proxy: ${error?.message ?? "unknown error"}`);
  }

  return ok({ proxyId: inserted.id, replaced: Boolean(existing) });
}

/**
 * Withdraw a proxy. Soft, because the register has to show that an appointment
 * existed and was withdrawn — a proxy that vanishes is indistinguishable from
 * one that was never made, and at a contested meeting that difference matters.
 */
export async function revokeProxy(
  proxyId: string,
  actorId: string | null,
  reason?: string
): Promise<Result<null>> {
  const db = createAdminClient();

  const { data: existing } = await db
    .from("meeting_proxies")
    .select("id, revoked_at")
    .eq("id", proxyId)
    .maybeSingle();

  if (!existing) return fail("That proxy does not exist.");
  if (existing.revoked_at) return fail("That proxy has already been withdrawn.");

  const now = new Date().toISOString();
  const { error } = await db
    .from("meeting_proxies")
    .update({
      revoked_at: now,
      revoked_by: actorId,
      revocation_reason: reason ?? null,
      updated_at: now,
    })
    .eq("id", proxyId);

  if (error) return fail(`Could not withdraw the proxy: ${error.message}`);
  return ok(null);
}

/**
 * The register for a meeting: who is carrying whose vote.
 *
 * Includes withdrawn rows by default so the chair can see the full history of
 * appointments, which is what a scrutineer would ask for.
 */
export async function getProxyRegister(
  meetingId: string,
  opts: { includeRevoked?: boolean } = {}
): Promise<Result<ProxyRecord[]>> {
  const db = createAdminClient();

  let query = db
    .from("meeting_proxies")
    .select(
      "id, meeting_id, grantor_organization_id, grantor_contact_id, proxyholder_contact_id, form_source, document_path, signed_at, revoked_at, revocation_reason"
    )
    .eq("meeting_id", meetingId)
    .order("signed_at", { ascending: true });

  if (!opts.includeRevoked) query = query.is("revoked_at", null);

  const { data: rows, error } = await query;
  if (error) return fail(`Could not load the proxy register: ${error.message}`);
  if (!rows || rows.length === 0) return ok([]);

  // Resolve names in two batched lookups rather than per-row embeds — the
  // grantor and proxyholder both point at `contacts`, and a single select
  // cannot embed the same relation twice without aliasing.
  const contactIds = [
    ...new Set(
      rows.flatMap((r) => [r.grantor_contact_id, r.proxyholder_contact_id].filter(Boolean) as string[])
    ),
  ];
  const orgIds = [...new Set(rows.map((r) => r.grantor_organization_id))];

  const [contactsRes, orgsRes] = await Promise.all([
    contactIds.length
      ? db
          .from("contacts")
          .select("id, name, first_name, last_name, organizations(name)")
          .in("id", contactIds)
      : Promise.resolve({ data: [] as never[] }),
    db.from("organizations").select("id, name").in("id", orgIds),
  ]);

  const contactById = new Map(
    (contactsRes.data ?? []).map((c: Record<string, unknown>) => {
      const org = embedded(c.organizations as never) as { name: string | null } | null;
      const name =
        (c.name as string | null) ??
        [c.first_name, c.last_name].filter(Boolean).join(" ").trim() ??
        null;
      return [c.id as string, { name: name || null, orgName: org?.name ?? null }];
    })
  );
  const orgNameById = new Map((orgsRes.data ?? []).map((o) => [o.id, o.name]));

  return ok(
    rows.map((r) => ({
      id: r.id,
      meetingId: r.meeting_id,
      grantorOrganizationId: r.grantor_organization_id,
      grantorOrganizationName: orgNameById.get(r.grantor_organization_id) ?? null,
      grantorContactId: r.grantor_contact_id,
      grantorContactName: r.grantor_contact_id
        ? contactById.get(r.grantor_contact_id)?.name ?? null
        : null,
      proxyholderContactId: r.proxyholder_contact_id,
      proxyholderName: contactById.get(r.proxyholder_contact_id)?.name ?? null,
      proxyholderOrganizationName:
        contactById.get(r.proxyholder_contact_id)?.orgName ?? null,
      formSource: r.form_source as ProxyFormSource,
      documentPath: r.document_path,
      signedAt: r.signed_at,
      revokedAt: r.revoked_at,
      revocationReason: r.revocation_reason,
    }))
  );
}

/**
 * The live proxy a store has given for a meeting, if any. What the member's own
 * page shows them about their current appointment.
 */
export async function getProxyForStore(
  meetingId: string,
  organizationId: string
): Promise<ProxyRecord | null> {
  const register = await getProxyRegister(meetingId);
  if (!register.ok) return null;
  return (
    register.data.find((p) => p.grantorOrganizationId === organizationId) ?? null
  );
}

// ─────────────────────────────────────────────────────────────────
// Page state
// ─────────────────────────────────────────────────────────────────

import { getElection, resolveActor } from "./service";

export interface ProxyState {
  election: { slug: string; cycleYear: number; agmDate: string };
  /** The AGM's meeting record. Null when the cycle has not minted one yet. */
  meetingId: string | null;
  /** Stores this person administers that may actually appoint a proxy. */
  eligibleOrganizations: { id: string; name: string }[];
  /** Whichever of those is being shown. */
  organization: { id: string; name: string } | null;
  /** Why an administered store cannot appoint, when none can. */
  blocked: string | null;
  candidates: ProxyCandidate[];
  current: ProxyRecord | null;
  /** The signing contact for the chosen store, if this person has one there. */
  grantorContactId: string | null;
}

/**
 * Everything /elections/[slug]/proxy needs.
 *
 * Mirrors getBallotState: the appointment belongs to the STORE, any of its
 * administrators may make or change it, and a person who administers several
 * stores picks which one they are acting for.
 */
export async function getProxyState(
  slug: string,
  profileId: string,
  organizations: { organization_id: string; role: string; status: string }[],
  preferredOrganizationId?: string
): Promise<ProxyState | null> {
  const db = createAdminClient();
  const election = await getElection(slug);
  if (!election) return null;

  const actor = await resolveActor(profileId, organizations);

  const eligibleOrganizations: { id: string; name: string }[] = [];
  let blocked: string | null = null;

  for (const orgId of actor.adminOrganizationIds) {
    const facts = await loadGrantorFacts(db, orgId);
    if (!facts) continue;
    // Reuse the by-law check rather than re-deriving "can this store appoint":
    // asking whether the store could appoint one of its own contacts answers
    // exactly the grantor half of S7.
    const verdict = evaluateProxyholder(facts, {
      contactId: "probe",
      name: null,
      organizationId: orgId,
      organizationType: facts.organizationType,
      organizationMembershipStatus: facts.organizationMembershipStatus,
      isPrimaryContact: false,
      active: true,
    });
    const { data: org } = await db.from("organizations").select("name").eq("id", orgId).maybeSingle();
    if (verdict.eligible) {
      eligibleOrganizations.push({ id: orgId, name: org?.name ?? "Your institution" });
    } else if (!blocked) {
      blocked = verdict.reason;
    }
  }

  // The AGM's own meeting record, matched on the date the election carries.
  // cycle.ts mints it; if it has not run yet there is nothing to attach a proxy
  // to, and the page says so rather than silently offering a broken form.
  const { data: meeting } = await db
    .from("board_meetings")
    .select("id")
    .eq("meeting_type", "agm")
    .eq("meeting_date", election.schedule.agmDate)
    .maybeSingle();

  const chosen =
    eligibleOrganizations.find((o) => o.id === preferredOrganizationId) ??
    eligibleOrganizations[0] ??
    null;

  let candidates: ProxyCandidate[] = [];
  let current: ProxyRecord | null = null;

  if (chosen) {
    const listed = await listProxyCandidates(chosen.id);
    if (listed.ok) candidates = listed.data.filter((c) => c.eligibility.eligible);
    if (meeting?.id) current = await getProxyForStore(meeting.id, chosen.id);
  }

  return {
    election: {
      slug,
      cycleYear: election.cycleYear,
      agmDate: election.schedule.agmDate,
    },
    meetingId: meeting?.id ?? null,
    eligibleOrganizations,
    organization: chosen,
    blocked: eligibleOrganizations.length === 0 ? blocked : null,
    candidates,
    current,
    grantorContactId: chosen ? actor.contactIdFor(chosen.id) : null,
  };
}
