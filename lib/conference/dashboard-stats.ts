import { createAdminClient } from "@/lib/supabase/admin";
import { parseUTC } from "@/lib/utils";
import { ORG_TYPE } from "@/lib/constants/org-types";

/**
 * Glanceable conference sales stats for the admin console widget.
 *
 * Four series, each carrying a running total plus per-day volume. The widget
 * shows the total by default and swaps to a single day's volume while the user
 * scrubs the chart, so both numbers have to come back from one fetch.
 */

export type ConferenceStatKey = "revenue" | "delegates" | "booths" | "members";

export const CONFERENCE_STAT_KEYS: ConferenceStatKey[] = [
  "revenue",
  "delegates",
  "booths",
  "members",
];

export interface ConferenceStatSeries {
  key: ConferenceStatKey;
  label: string;
  /** Cents for `revenue`, a plain count for the rest. */
  total: number;
  /** One entry per day, firstDay..today inclusive, zero-filled. */
  daily: { date: string; value: number }[];
}

export interface ConferenceDashboardStats {
  conferenceId: string;
  conferenceName: string;
  conferenceYear: number;
  status: string;
  firstDay: string;
  series: Record<ConferenceStatKey, ConferenceStatSeries>;
}

const STAT_LABELS: Record<ConferenceStatKey, string> = {
  revenue: "Revenue",
  delegates: "Delegates",
  booths: "Booths",
  members: "Members",
};

/** Orders whose money is actually in hand. */
const COLLECTED_ORDER_STATUSES = ["paid", "partially_refunded"];

/** A registration only counts once the delegate has committed to attending. */
const COUNTED_REGISTRATION_STATUSES = new Set(["submitted", "confirmed"]);

/**
 * Dues sold inside a conference checkout are membership revenue, not
 * conference revenue — they carry their own (origin-based) tax treatment and
 * are exported to QuickBooks as exempt membership lines. The widget's headline
 * is what the conference sold, so these line items are stripped out.
 */
const NON_CONFERENCE_ENTITY_KINDS = new Set(["membership_renewal"]);

function toDayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dayOf(timestamp: string): string {
  return toDayString(parseUTC(timestamp));
}

/** Zero-filled daily series from `firstDay` through `today`, inclusive. */
function buildSeries(
  key: ConferenceStatKey,
  byDay: Map<string, number>,
  firstDay: string,
  today: Date
): ConferenceStatSeries {
  const daily: { date: string; value: number }[] = [];

  const cursor = parseUTC(firstDay + " 00:00:00");
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  let total = 0;
  while (cursor.getTime() <= end.getTime()) {
    const date = toDayString(cursor);
    const value = byDay.get(date) ?? 0;
    total += value;
    daily.push({ date, value });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return { key, label: STAT_LABELS[key], total, daily };
}

function addTo(map: Map<string, number>, day: string, amount: number): void {
  if (amount === 0) return;
  map.set(day, (map.get(day) ?? 0) + amount);
}

/**
 * Sales stats for the newest live conference, or null when there isn't one —
 * the caller renders nothing in that case.
 */
export async function getConferenceDashboardStats(): Promise<ConferenceDashboardStats | null> {
  const db = createAdminClient();

  const { data: conference } = await db
    .from("conference_instances")
    .select("id, name, year, status")
    .not("status", "in", "(archived,completed)")
    .order("year", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!conference) return null;

  const conferenceId = conference.id;

  const [ordersRes, boothPaymentsRes, regPaymentsRes, registrationsRes] = await Promise.all([
    db
      .from("conference_orders")
      .select("id, organization_id, status, created_at, paid_at, refund_amount_cents, refunded_at")
      .eq("conference_id", conferenceId)
      .in("status", COLLECTED_ORDER_STATUSES),

    // Booths bought by orgs that weren't members yet — these never become
    // conference_orders, so they'd be invisible to an orders-only query.
    // Only the booth half is conference revenue; membership_amount_cents is
    // dues, excluded for the same reason as membership_renewal line items.
    db
      .from("prospective_booth_payments")
      .select("booth_amount_cents, paid_at")
      .eq("conference_id", conferenceId)
      .not("paid_at", "is", null),

    db
      .from("prospective_registration_payments")
      .select("amount_cents, paid_at, organization_id")
      .eq("conference_id", conferenceId)
      .not("paid_at", "is", null),

    db
      .from("conference_registrations")
      .select("organization_id, registration_type, status, created_at")
      .eq("conference_id", conferenceId),
  ]);

  const orders = ordersRes.data ?? [];
  const boothPayments = boothPaymentsRes.data ?? [];
  const regPayments = regPaymentsRes.data ?? [];
  const registrations = registrationsRes.data ?? [];

  // Line items and entity kinds are fetched separately rather than as a nested
  // embed — PostgREST can't resolve conference_order_items -> conference_entities
  // in one hop here, and two flat queries keep the generated types honest.
  const orderIds = orders.map((o) => o.id);

  const [itemsRes, entitiesRes] = await Promise.all([
    orderIds.length > 0
      ? db
          .from("conference_order_items")
          .select("order_id, quantity, total_cents, offer_entity_id")
          .in("order_id", orderIds)
      : Promise.resolve({ data: [] as { order_id: string; quantity: number; total_cents: number; offer_entity_id: string | null }[] }),
    db.from("conference_entities").select("id, kind").eq("conference_id", conferenceId),
  ]);

  const kindByEntityId = new Map<string, string>();
  for (const entity of entitiesRes.data ?? []) kindByEntityId.set(entity.id, entity.kind);

  const itemsByOrderId = new Map<string, { quantity: number; total_cents: number; kind: string | null }[]>();
  for (const item of itemsRes.data ?? []) {
    const kind = item.offer_entity_id ? kindByEntityId.get(item.offer_entity_id) ?? null : null;
    const bucket = itemsByOrderId.get(item.order_id);
    const entry = { quantity: item.quantity, total_cents: item.total_cents, kind };
    if (bucket) bucket.push(entry);
    else itemsByOrderId.set(item.order_id, [entry]);
  }

  // ── Which orgs are Members? ────────────────────────────────────────
  const participantOrgIds = new Set<string>();
  for (const o of orders) participantOrgIds.add(o.organization_id);
  for (const r of registrations) participantOrgIds.add(r.organization_id);
  for (const p of regPayments) if (p.organization_id) participantOrgIds.add(p.organization_id);

  const memberOrgIds = new Set<string>();
  if (participantOrgIds.size > 0) {
    const { data: orgs } = await db
      .from("organizations")
      .select("id")
      .eq("type", ORG_TYPE.member)
      .eq("is_test", false)
      .in("id", Array.from(participantOrgIds));
    for (const org of orgs ?? []) memberOrgIds.add(org.id);
  }

  // ── Accumulate per-day volume ──────────────────────────────────────
  const revenueByDay = new Map<string, number>();
  const boothsByDay = new Map<string, number>();
  const delegatesByDay = new Map<string, number>();
  const membersByDay = new Map<string, number>();

  /** Earliest day an org showed up, so each Member is counted exactly once. */
  const memberFirstSeen = new Map<string, string>();

  function noteOrg(orgId: string | null, day: string): void {
    if (!orgId || !memberOrgIds.has(orgId)) return;
    const existing = memberFirstSeen.get(orgId);
    if (!existing || day < existing) memberFirstSeen.set(orgId, day);
  }

  const activityDays: string[] = [];

  for (const order of orders) {
    // A collected order can still have a null paid_at — production has at
    // least one `paid` order that never got the timestamp back. The money is
    // real; only the day it landed on is uncertain, so fall back to created_at
    // rather than dropping the order (and its booths) from the totals.
    const day = dayOf(order.paid_at ?? order.created_at);
    activityDays.push(day);
    noteOrg(order.organization_id, day);

    // conference_order_items.total_cents is tax-INCLUSIVE — it is the line's
    // full charge, so it must never have tax re-applied on top.
    let conferenceCents = 0;
    for (const item of itemsByOrderId.get(order.id) ?? []) {
      const kind = item.kind;
      if (kind && NON_CONFERENCE_ENTITY_KINDS.has(kind)) continue;
      conferenceCents += item.total_cents;
      if (kind === "booth") addTo(boothsByDay, day, item.quantity);
    }

    addTo(revenueByDay, day, conferenceCents);

    // Refunds are recorded per order, not per line. Capping at the
    // conference portion keeps a refund of bundled dues from eating into the
    // conference figure it was never part of.
    const refund = order.refund_amount_cents ?? 0;
    if (refund > 0) {
      const refundDay = order.refunded_at ? dayOf(order.refunded_at) : day;
      activityDays.push(refundDay);
      addTo(revenueByDay, refundDay, -Math.min(refund, conferenceCents));
    }
  }

  for (const payment of boothPayments) {
    if (!payment.paid_at) continue;
    const day = dayOf(payment.paid_at);
    activityDays.push(day);
    addTo(revenueByDay, day, payment.booth_amount_cents);
    addTo(boothsByDay, day, 1);
  }

  for (const payment of regPayments) {
    if (!payment.paid_at) continue;
    const day = dayOf(payment.paid_at);
    activityDays.push(day);
    addTo(revenueByDay, day, payment.amount_cents);
    noteOrg(payment.organization_id, day);
  }

  // ── Sponsorships: not yet wired ────────────────────────────────────
  // Sponsorship money is real conference revenue, but `sponsor_agreements`
  // currently cannot supply it: there is no amount on the agreement (price
  // lives on `sponsor_tiers`, and at least one active tier has a null
  // `price_cents`), no `paid_at` to place it on a day, and no `conference_id`
  // to scope it — the link is an untyped `reference_id` buried in the tier's
  // `benefits` JSON. Once agreements carry `amount_cents` + `paid_at` +
  // `conference_id`, add a fourth accumulator here:
  //
  //   for (const s of sponsorships) {
  //     const day = dayOf(s.paid_at);
  //     activityDays.push(day);
  //     addTo(revenueByDay, day, s.amount_cents);
  //   }
  //
  // Nothing else in this file or the widget needs to change.

  for (const registration of registrations) {
    if (!COUNTED_REGISTRATION_STATUSES.has(registration.status)) continue;
    const day = dayOf(registration.created_at);
    activityDays.push(day);
    if (registration.registration_type === "delegate") addTo(delegatesByDay, day, 1);
    noteOrg(registration.organization_id, day);
  }

  for (const day of memberFirstSeen.values()) addTo(membersByDay, day, 1);

  // ── Assemble ───────────────────────────────────────────────────────
  const today = new Date();
  const firstDay = activityDays.length > 0 ? activityDays.reduce((a, b) => (a < b ? a : b)) : toDayString(today);

  return {
    conferenceId,
    conferenceName: conference.name,
    conferenceYear: conference.year,
    status: conference.status,
    firstDay,
    series: {
      revenue: buildSeries("revenue", revenueByDay, firstDay, today),
      delegates: buildSeries("delegates", delegatesByDay, firstDay, today),
      booths: buildSeries("booths", boothsByDay, firstDay, today),
      members: buildSeries("members", membersByDay, firstDay, today),
    },
  };
}
