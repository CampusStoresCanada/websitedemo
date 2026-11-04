import { createAdminClient } from "@/lib/supabase/admin";
import { loadSeatHoldings } from "@/lib/conference/seats";
import { isFundedOffer } from "@/lib/conference/entity-pricing";

/**
 * The CANCOLL registration report (CSC/CANCOLL MOU 9.1(a), Schedule C): every
 * Supported Registration, who holds it, when CSC confirmed it, which invoice
 * billed it, and any refund to the school under 5.5.
 *
 * One reader for the CSV, the invoice and the staff panel, so the report sent
 * with an invoice can never list different registrations from the invoice.
 *
 * A Supported Registration is a seat on the CANCOLL-funded offer, read through
 * loadSeatHoldings. "Confirmed" is when the seat was issued, or for a paid seat
 * switched over under 5.5, the date of that switch and refund (5.6). Test
 * organizations never appear.
 */

export type CancollRegistration = {
  seatId: string;
  organizationId: string;
  /** The delegate named to the seat, once there is one. */
  holderPersonId: string | null;
  /** The funded offer the seat is on. */
  entityId: string;
  institution: string;
  delegateName: string | null;
  positionTitle: string | null;
  /** ISO instant CSC confirmed it. */
  confirmedAt: string;
  /** The CANCOLL invoice that billed it, if one has. */
  invoiceId: string | null;
  invoiceNumber: string | null;
  /** The school's refund under 5.5, when it paid first and was switched over. */
  refund: { cents: number | null; at: string } | null;
};

export type CancollBilling = {
  conferenceId: string;
  conferenceName: string;
  timeZone: string;
  offerId: string;
  /** $299.00 (MOU Schedule A), from the funded offer's funder_unit_cents. */
  unitCents: number;
  /** QuickBooks item and the conference's tax, for the invoice. */
  qboItemId: string | null;
  stripeTaxRateId: string | null;
  qboTaxCodeRef: string | null;
  /** Who the invoice goes to, from the funded offer (invoice_to, invoice_cc). */
  invoiceTo: string | null;
  invoiceCc: string[];
  invoiceContactName: string | null;
  rows: CancollRegistration[];
  invoices: Array<{ id: string; number: string | null; status: string; totalCents: number; createdAt: string; count: number }>;
};

type Db = ReturnType<typeof createAdminClient>;

/** Columns of the CSV, in Schedule C's order. */
const CSV_HEADER = [
  "Institution",
  "Delegate name",
  "Position title",
  "Registration confirmed",
  "Amount invoiced",
  "Invoice",
  "Refund issued",
  "Refund date",
];

const dollars = (cents: number) => (cents / 100).toFixed(2);

/** "2026-11-14", the calendar day in the conference's own zone. */
export function dayInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(iso)
  );
}

/** Quote a cell, and defuse a leading = + - @ the way the roster export does. */
function cell(value: string): string {
  return `"${(/^[=+\-@]/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;
}

/**
 * The registration report as CSV, ending with Schedule C's running total:
 * the count and value of Supported Registrations to date.
 */
export function cancollReportCsv(
  rows: CancollRegistration[],
  params: { unitCents: number; timeZone: string }
): string {
  const lines = [...rows]
    .sort((a, b) => a.confirmedAt.localeCompare(b.confirmedAt) || a.institution.localeCompare(b.institution))
    .map((r) =>
      [
        r.institution,
        r.delegateName ?? "",
        r.positionTitle ?? "",
        dayInZone(r.confirmedAt, params.timeZone),
        dollars(params.unitCents),
        r.invoiceNumber ?? "",
        r.refund?.cents != null ? dollars(r.refund.cents) : r.refund ? "Owed, issued by hand" : "",
        r.refund ? dayInZone(r.refund.at, params.timeZone) : "",
      ]
        .map(cell)
        .join(",")
    );
  const total = [
    `Running total: ${rows.length} Supported Registration${rows.length === 1 ? "" : "s"}`,
    "",
    "",
    "",
    dollars(rows.length * params.unitCents),
    "",
    "",
    "",
  ]
    .map(cell)
    .join(",");
  return [CSV_HEADER.map(cell).join(","), ...lines, total].join("\n");
}

/**
 * The registrations a new invoice would bill: not yet on a CANCOLL invoice, and
 * confirmed before `boundary` (exclusive). Schedule A's first invoice covers
 * registrations confirmed on or before November 30; the second covers the rest
 * to January 17, including the 5.5 switches.
 */
export function registrationsToInvoice(rows: CancollRegistration[], boundary: string): CancollRegistration[] {
  const cutoff = Date.parse(boundary);
  return rows.filter((r) => !r.invoiceId && Date.parse(r.confirmedAt) < cutoff);
}

/** Everything about CANCOLL's billing for one conference. Null: it has no funded offer. */
export async function loadCancollBilling(db: Db, conferenceId: string): Promise<CancollBilling | null> {
  const [{ data: offers }, { data: conference }] = await Promise.all([
    db
      .from("conference_entities")
      .select("id, attributes, qbo_item_id")
      .eq("conference_id", conferenceId)
      .eq("kind", "registration")
      .eq("attributes->>funded_by", "cancoll"),
    db
      .from("conference_instances")
      .select("name, timezone, stripe_tax_rate_id, qbo_tax_code_ref")
      .eq("id", conferenceId)
      .maybeSingle(),
  ]);
  const offer = (offers ?? []).find((e) => isFundedOffer(e.attributes as Record<string, unknown> | null));
  if (!offer || !conference) return null;
  const attrs = (offer.attributes as Record<string, unknown> | null) ?? {};

  const { seats } = await loadSeatHoldings(db, { conferenceId });
  const funded = seats.filter((s) => s.entityId === offer.id);
  const orgIds = [...new Set(funded.map((s) => s.organizationId))];
  const contactIds = [...new Set(funded.map((s) => s.holderContactId).filter((id): id is string => !!id))];

  const [{ data: orgs }, { data: contacts }, { data: conversions }, { data: invoiceRows }] = await Promise.all([
    orgIds.length
      ? db.from("organizations").select("id, name, is_test").in("id", orgIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string; is_test: boolean | null }> }),
    contactIds.length
      ? db.from("contacts").select("id, name, role_title").in("id", contactIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string | null; role_title: string | null }> }),
    db.from("conference_funded_conversions").select("seat_id, refund_cents, created_at").eq("conference_id", conferenceId),
    db
      .from("invoices")
      .select("id, status, total_cents, created_at, metadata, stripe_invoice_id")
      .eq("type", "conference")
      .eq("metadata->>cancoll_conference_id", conferenceId)
      .neq("status", "voided"),
  ]);

  const orgById = new Map((orgs ?? []).map((o) => [o.id, o]));
  const contactById = new Map((contacts ?? []).map((c) => [c.id, c]));
  const conversionBySeat = new Map((conversions ?? []).map((c) => [c.seat_id, c]));
  const invoices = (invoiceRows ?? []).map((inv) => {
    const meta = (inv.metadata as Record<string, unknown> | null) ?? {};
    const seatIds = Array.isArray(meta.seat_ids) ? (meta.seat_ids as string[]) : [];
    return {
      id: inv.id,
      number: (meta.number as string | undefined) ?? null,
      status: inv.status,
      totalCents: inv.total_cents,
      createdAt: inv.created_at,
      seatIds,
      count: seatIds.length,
    };
  });
  const invoiceBySeat = new Map<string, { id: string; number: string | null }>();
  for (const inv of invoices) for (const seatId of inv.seatIds) invoiceBySeat.set(seatId, inv);

  const rows: CancollRegistration[] = [];
  for (const seat of funded) {
    const org = orgById.get(seat.organizationId);
    if (!org || org.is_test) continue;
    const contact = seat.holderContactId ? contactById.get(seat.holderContactId) : undefined;
    const conversion = conversionBySeat.get(seat.seatId);
    const invoice = invoiceBySeat.get(seat.seatId);
    rows.push({
      seatId: seat.seatId,
      organizationId: seat.organizationId,
      holderPersonId: seat.holderPersonId,
      entityId: seat.entityId,
      institution: org.name,
      delegateName: seat.holderName ?? contact?.name ?? null,
      positionTitle: contact?.role_title ?? null,
      confirmedAt: conversion?.created_at ?? seat.seatedAt ?? new Date(0).toISOString(),
      invoiceId: invoice?.id ?? null,
      invoiceNumber: invoice?.number ?? null,
      refund: conversion ? { cents: conversion.refund_cents, at: conversion.created_at } : null,
    });
  }

  return {
    conferenceId,
    conferenceName: conference.name,
    timeZone: conference.timezone ?? "America/Toronto",
    offerId: offer.id,
    unitCents: typeof attrs.funder_unit_cents === "number" ? attrs.funder_unit_cents : 29900,
    qboItemId: offer.qbo_item_id ?? null,
    stripeTaxRateId: conference.stripe_tax_rate_id ?? null,
    qboTaxCodeRef: conference.qbo_tax_code_ref ?? null,
    invoiceTo: typeof attrs.invoice_to === "string" ? attrs.invoice_to : null,
    invoiceCc: Array.isArray(attrs.invoice_cc) ? (attrs.invoice_cc as string[]) : [],
    invoiceContactName: typeof attrs.invoice_contact_name === "string" ? attrs.invoice_contact_name : null,
    rows,
    invoices: invoices.map((inv) => ({
      id: inv.id,
      number: inv.number,
      status: inv.status,
      totalCents: inv.totalCents,
      createdAt: inv.createdAt,
      count: inv.count,
    })),
  };
}

const ATTENDANCE_HEADER = [
  "Institution",
  "Delegate name",
  "Position title",
  "Assigned elements",
  "Attended",
  "Excused",
  "Not attended",
  "Upcoming",
  "CANCOLL AGM",
  "Status",
];

type Outcome = "attended" | "excused" | "absent" | "upcoming";

/**
 * The attendance report (MOU Schedule C): for every Supported Registration in
 * the registration report, the delegate's Assigned Schedule and what happened
 * at each part of it. The same rows as the registration report, so the two
 * never list different delegates. Registration proves who CANCOLL paid for;
 * this proves they came to what the funding asked of them.
 *
 * The Assigned Schedule is the delegate's live partner meetings plus what the
 * funded registration adds over the ordinary one (the CANCOLL AGM). Attended:
 * a scan, or a staff ruling of attended. Excused: a staff ruling of excused (a
 * cancelled meeting is not on the schedule at all). Anything past with neither
 * is not attended; anything ahead is upcoming (MOU 8).
 */
export async function cancollAttendanceCsv(db: Db, billing: CancollBilling): Promise<string> {
  const [{ getConferenceScheduleTimeline }, { loadMeetingConfirmations }] = await Promise.all([
    import("@/lib/conference/schedule-service"),
    import("@/lib/conference/schedule-ops"),
  ]);
  const { entitiesById } = await loadSeatHoldings(db, { conferenceId: billing.conferenceId });

  // What the funded offer adds over the registration it stands in for.
  const offer = entitiesById.get(billing.offerId);
  const base = entitiesById.get(String(offer?.attributes.funds_offer_id ?? ""));
  const baseTargets = new Set((base?.refs ?? []).map((r) => r.toEntityId));
  const extraIds = [
    ...new Set(
      (offer?.refs ?? [])
        .filter((r) => (r.role === "involved_in" || r.role === "includes") && !baseTargets.has(r.toEntityId))
        .map((r) => r.toEntityId)
        .filter((id) => {
          const target = entitiesById.get(id);
          return target != null && target.kind !== "day";
        })
    ),
  ];

  const timeline = await getConferenceScheduleTimeline(billing.conferenceId, { viewerRole: "admin" });
  const startsAt = new Map(timeline.programItems.map((item) => [item.id, item.startsAt] as const));
  const meetings = timeline.meetingAssignmentItems.filter((m) => m.meetingAssignment);
  const [confirmations, { data: eventRows }] = await Promise.all([
    loadMeetingConfirmations(db, meetings.map((m) => m.meetingAssignment!.scheduleId)),
    extraIds.length
      ? db
          .from("conference_check_in_events")
          .select("person_id, entity_id, confirmed_by, ruling, result_state")
          .eq("conference_id", billing.conferenceId)
          .eq("is_test", false)
          .in("entity_id", extraIds)
          .order("checked_in_at", { ascending: true })
      : Promise.resolve({ data: [] }),
  ]);

  // Per person and event: scanned in, then the newest staff ruling wins.
  const eventOutcome = new Map<string, Exclude<Outcome, "upcoming">>();
  for (const row of (eventRows ?? []) as Array<{
    person_id: string | null;
    entity_id: string | null;
    confirmed_by: string | null;
    ruling: string | null;
    result_state: string;
  }>) {
    if (!row.person_id || !row.entity_id) continue;
    const key = `${row.person_id}|${row.entity_id}`;
    if (row.confirmed_by === "staff" && row.ruling) eventOutcome.set(key, row.ruling as Exclude<Outcome, "upcoming">);
    else if (["valid", "not_on_ticket"].includes(row.result_state)) eventOutcome.set(key, "attended");
  }

  const now = Date.now();
  const isPast = (iso: string | null | undefined) => Boolean(iso) && Date.parse(iso!) <= now;
  const word = (o: Outcome) =>
    o === "attended" ? "Attended" : o === "excused" ? "Excused" : o === "upcoming" ? "Upcoming" : "Not attended";

  const lines = [...billing.rows]
    .sort((a, b) => a.institution.localeCompare(b.institution) || (a.delegateName ?? "").localeCompare(b.delegateName ?? ""))
    .map((r) => {
      const personId = r.holderPersonId;
      if (!personId) {
        return [r.institution, "", "", "0", "0", "0", "0", "0", "", "No delegate named"];
      }
      const outcomes: Outcome[] = [];
      for (const m of meetings) {
        if (!m.meetingAssignment!.delegateSeatIds.includes(r.seatId)) continue;
        const confirmation = confirmations.get(m.meetingAssignment!.scheduleId);
        const ruling = confirmation?.rulings[personId]?.ruling;
        outcomes.push(
          confirmation?.confirmedPersonIds.includes(personId)
            ? "attended"
            : ruling === "excused"
              ? "excused"
              : isPast(m.startsAt)
                ? "absent"
                : "upcoming"
        );
      }
      const agm: string[] = [];
      for (const id of extraIds) {
        const outcome = eventOutcome.get(`${personId}|${id}`) ?? (isPast(startsAt.get(id)) ? "absent" : "upcoming");
        outcomes.push(outcome);
        agm.push(word(outcome));
      }
      const count = (o: Outcome) => String(outcomes.filter((x) => x === o).length);
      const status = outcomes.includes("absent")
        ? "Non-attendance recorded"
        : outcomes.includes("upcoming")
          ? "Not yet held"
          : "Full compliance";
      return [
        r.institution,
        r.delegateName ?? "",
        r.positionTitle ?? "",
        String(outcomes.length),
        count("attended"),
        count("excused"),
        count("absent"),
        count("upcoming"),
        agm.join("; ") || "Not assigned",
        status,
      ];
    })
    .map((row) => row.map(cell).join(","));
  return [ATTENDANCE_HEADER.map(cell).join(","), ...lines].join("\n");
}
