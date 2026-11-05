import { canManageOrganization, type AuthContext } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { isFundedOffer } from "@/lib/conference/entity-pricing";
import { loadSeatHoldings, type SeatHolding } from "@/lib/conference/seats";
import { lookupUserEmailsByIds } from "@/lib/supabase/user-lookup";

/**
 * Who may fill in a school's request: anyone registered for this conference
 * from that school, or the school's admin whether or not they are registered.
 * The same people file the school's expense claim afterwards
 * (lib/expenses/sources.ts).
 */
export async function canFillBursaryRequest(
  ctx: AuthContext,
  conferenceId: string,
  organizationId: string
): Promise<boolean> {
  if (canManageOrganization(ctx, organizationId)) return true;
  const { count } = await createAdminClient()
    .from("conference_people")
    .select("id", { count: "exact", head: true })
    .eq("conference_id", conferenceId)
    .eq("organization_id", organizationId)
    .eq("user_id", ctx.userId)
    .neq("assignment_status", "canceled");
  return (count ?? 0) > 0;
}


/**
 * A school's supported registration: the one seat its travel support, its
 * CANCOLL funding and its recipient's obligations all hang from (Steve,
 * 2026-11-05: "those things need to be one thing").
 *
 * The CANCOLL-funded registration when the school holds one, whoever its
 * request names; otherwise the registration the request names. Read here, every
 * time, never written back: a school that buys or is switched to the funded
 * registration after it picked one is moved by the rule, not by a row.
 */
export function supportedSeat(
  orgSeats: ReadonlyArray<SeatHolding>,
  entitiesById: ReadonlyMap<string, { attributes?: Record<string, unknown> | null }>,
  pickedSeatId: string | null
): SeatHolding | null {
  const funded = orgSeats.filter(
    (s) => s.entityKind === "registration" && isFundedOffer(entitiesById.get(s.entityId)?.attributes)
  );
  if (funded.length > 0) return funded.find((s) => s.holderPersonId) ?? funded[0];
  return orgSeats.find((s) => s.seatId === pickedSeatId) ?? null;
}

/**
 * Every school's supported registration for this conference, by organization,
 * for the requests that are submitted and not declined.
 */
export async function loadSupportedSeats(
  db: { from: (table: string) => { select: (columns: string) => any } }, // eslint-disable-line @typescript-eslint/no-explicit-any
  conferenceId: string
): Promise<Map<string, SeatHolding>> {
  const { data, error } = await db
    .from("conference_bursary_applications")
    .select("organization_id, delegate_seat_id, status, requested_at")
    .eq("conference_id", conferenceId)
    .not("requested_at", "is", null)
    .neq("status", "denied");
  if (error) throw new Error(`Could not load travel bursary delegates: ${error.message}`);
  const requests = (data ?? []) as Array<{ organization_id: string; delegate_seat_id: string | null }>;
  if (requests.length === 0) return new Map();
  const { seats, entitiesById } = await loadSeatHoldings(db as never, { conferenceId, entityKinds: ["registration"] });
  const byOrg = new Map<string, SeatHolding[]>();
  for (const seat of seats) {
    const list = byOrg.get(seat.organizationId) ?? [];
    list.push(seat);
    byOrg.set(seat.organizationId, list);
  }
  const supported = new Map<string, SeatHolding>();
  for (const r of requests) {
    const seat = supportedSeat(byOrg.get(r.organization_id) ?? [], entitiesById, r.delegate_seat_id);
    if (seat) supported.set(r.organization_id, seat);
  }
  return supported;
}

/**
 * The supported registrations' seat ids: whoever holds one is a travel bursary
 * recipient. A seat id, never a person: a swap on the org page moves the
 * support with the seat, as it moves the CANCOLL consent with the funded
 * registration.
 */
export async function loadBursaryDesignatedSeatIds(
  db: { from: (table: string) => { select: (columns: string) => any } }, // eslint-disable-line @typescript-eslint/no-explicit-any
  conferenceId: string
): Promise<Set<string>> {
  return new Set([...(await loadSupportedSeats(db, conferenceId)).values()].map((s) => s.seatId));
}

/**
 * Who CSC writes to about a school's travel bursary request: the contact on
 * the request and whoever submitted it, once each by address. The one answer
 * for the request's own emails (tellRequesters) and for a campaign to every
 * requesting school (the comms audience "bursary_requesters").
 *
 * For one request: whatever its status, since its own emails include the
 * decline. For a whole conference: only submitted requests that were not
 * declined.
 */
export async function loadBursaryRequesters(params: {
  conferenceId?: string;
  applicationId?: string;
}): Promise<Array<{ applicationId: string; organizationId: string; email: string; name: string | null }>> {
  const db = createAdminClient() as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  let q = db
    .from("conference_bursary_applications")
    .select("id, organization_id, contact_name, contact_email, requested_by_user_id, status, requested_at");
  if (params.applicationId) {
    q = q.eq("id", params.applicationId);
  } else {
    q = q.not("requested_at", "is", null).neq("status", "denied");
    if (params.conferenceId) q = q.eq("conference_id", params.conferenceId);
  }
  const { data, error } = await q;
  if (error) throw new Error(`Could not load travel bursary requests: ${error.message}`);
  const rows = (data ?? []) as Array<{
    id: string;
    organization_id: string;
    contact_name: string | null;
    contact_email: string | null;
    requested_by_user_id: string | null;
  }>;

  const userIds = [...new Set(rows.map((r) => r.requested_by_user_id).filter((id): id is string => !!id))];
  const admin = createAdminClient();
  const [emails, { data: profiles }] = await Promise.all([
    userIds.length ? lookupUserEmailsByIds(admin, userIds) : Promise.resolve({} as Record<string, string>),
    userIds.length
      ? admin.from("profiles").select("id, display_name").in("id", userIds)
      : Promise.resolve({ data: [] as Array<{ id: string; display_name: string | null }> }),
  ]);
  const nameOf = new Map((profiles ?? []).map((p) => [p.id as string, (p.display_name as string | null) ?? null]));

  const out: Array<{ applicationId: string; organizationId: string; email: string; name: string | null }> = [];
  for (const r of rows) {
    const seen = new Set<string>();
    const add = (email: string | null | undefined, name: string | null | undefined) => {
      const key = email?.trim().toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push({ applicationId: r.id, organizationId: r.organization_id, email: key, name: name?.trim() || null });
    };
    add(r.contact_email, r.contact_name !== r.contact_email ? r.contact_name : null);
    if (r.requested_by_user_id) add(emails[r.requested_by_user_id], nameOf.get(r.requested_by_user_id));
  }
  return out;
}
