// ─────────────────────────────────────────────────────────────────
// Event ticket types — type definitions + audience filter evaluation
// ─────────────────────────────────────────────────────────────────

// ── Ticket type (mirrors event_ticket_types table) ────────────────

export interface EventTicketType {
  id: string;
  event_id: string;
  name: string;
  description: string | null;
  price_cents: number;
  capacity: number | null;
  sort_order: number;
  audience_filter: AudienceFilter | null;
  available_from: string | null;
  available_until: string | null;
  stripe_price_id: string | null;
  is_hidden: boolean;
  created_at: string;
  updated_at: string;
}

// ── Audience filter spec ──────────────────────────────────────────
//
// null                                      → everyone
// { type: "org_type",       value }         → org.type === value
// { type: "partner_category", value }       → org.primary_category === value
// { type: "membership_status", value }      → org.membership_status === value
// { type: "org_fte", operator, value }      → org.fte comparison
// { type: "global_role",    value }         → profiles.global_role === value

export type AudienceFilter =
  | { type: "org_type";          value: string }
  | { type: "partner_category";  value: string }
  | { type: "membership_status"; value: string }
  | { type: "org_fte";           operator: "gte" | "lte" | "gt" | "lt"; value: number }
  | { type: "global_role";       value: string };

// ── User context (resolved once per request) ─────────────────────

export interface TicketUserContext {
  globalRole: string;
  /** First active org for the user — null if no org membership */
  org: {
    type: string;
    primary_category: string | null;
    membership_status: string | null;
    fte: number | null;
  } | null;
}

// ── Resolved ticket (available or locked) ────────────────────────

export interface AvailableTicket {
  ticket: EventTicketType;
  /** Human-readable price: "Free", "$25.00", etc. */
  priceLabel: string;
}

export interface LockedTicket {
  ticket: EventTicketType;
  priceLabel: string;
  /** Why the user can't select this tier */
  reason: string;
  /** Optional CTA URL — e.g. /apply for membership upsell */
  upsellUrl: string | null;
}

export interface ResolvedTickets {
  available: AvailableTicket[];
  locked: LockedTicket[];
  /** True if the event has no ticket types configured — use legacy free flow */
  noTicketsConfigured: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────

export function formatPrice(cents: number): string {
  if (cents === 0) return "Free";
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function isAvailableNow(ticket: EventTicketType): boolean {
  const now = new Date();
  if (ticket.available_from && new Date(ticket.available_from) > now) return false;
  if (ticket.available_until && new Date(ticket.available_until) < now) return false;
  return true;
}

/** Returns null if the user qualifies, or a human reason string if not. */
function evaluateFilter(
  filter: AudienceFilter | null,
  ctx: TicketUserContext
): string | null {
  if (!filter) return null; // everyone qualifies
  // Admins bypass all audience restrictions — they can register for anything
  if (ctx.globalRole === "super_admin" || ctx.globalRole === "admin") return null;

  switch (filter.type) {
    case "global_role":
      if (ctx.globalRole === filter.value) return null;
      return filter.value === "admin"
        ? "Staff only"
        : `Requires role: ${filter.value}`;

    case "org_type":
      if (!ctx.org) return "Requires an active organization membership";
      if (ctx.org.type === filter.value) return null;
      if (filter.value === "member")
        return "Available to CSC member organizations — join to unlock this rate";
      if (filter.value === "partner")
        return "Available to CSC partner organizations";
      return `Requires organization type: ${filter.value}`;

    case "membership_status":
      if (!ctx.org) return "Requires an active organization membership";
      if (ctx.org.membership_status === filter.value) return null;
      return `Requires membership status: ${filter.value}`;

    case "partner_category":
      if (!ctx.org || ctx.org.type !== "partner")
        return "Available to CSC partner organizations";
      if (ctx.org.primary_category === filter.value) return null;
      return `Available to ${filter.value} partners`;

    case "org_fte": {
      if (!ctx.org || ctx.org.fte == null)
        return "Requires organization size information on file";
      const fte = ctx.org.fte;
      const val = filter.value;
      const passes =
        filter.operator === "gte" ? fte >= val :
        filter.operator === "lte" ? fte <= val :
        filter.operator === "gt"  ? fte >  val :
                                    fte <  val;
      if (passes) return null;
      return `Requires organization with ${filter.operator} ${val} FTEs`;
    }
  }
}

function upsellUrl(filter: AudienceFilter | null): string | null {
  if (!filter) return null;
  if (filter.type === "org_type" && filter.value === "member") return "/apply";
  if (filter.type === "org_type" && filter.value === "partner") return "/partners";
  return null;
}

// ── Main resolver ─────────────────────────────────────────────────

export function resolveTickets(
  tickets: EventTicketType[],
  ctx: TicketUserContext
): ResolvedTickets {
  const visible = tickets.filter((t) => !t.is_hidden);

  if (visible.length === 0) {
    return { available: [], locked: [], noTicketsConfigured: true };
  }

  const available: AvailableTicket[] = [];
  const locked: LockedTicket[] = [];

  for (const ticket of visible) {
    // Skip tickets outside their availability window
    if (!isAvailableNow(ticket)) continue;

    const reason = evaluateFilter(ticket.audience_filter, ctx);
    const priceLabel = formatPrice(ticket.price_cents);

    if (reason === null) {
      available.push({ ticket, priceLabel });
    } else {
      locked.push({ ticket, priceLabel, reason, upsellUrl: upsellUrl(ticket.audience_filter) });
    }
  }

  return { available, locked, noTicketsConfigured: false };
}

// ── Refund policy ─────────────────────────────────────────────────

export interface RefundPolicy {
  auto_refund: boolean;
  /** Hours before event start for a full refund. 0 = no time limit. */
  full_refund_hours: number;
  /** Percentage refunded after full_refund_hours window (0–100). */
  partial_percent: number;
  /** Hours before event start within which no refund is issued. */
  no_refund_hours: number;
}

export const DEFAULT_REFUND_POLICY: RefundPolicy = {
  auto_refund: true,
  full_refund_hours: 48,
  partial_percent: 50,
  no_refund_hours: 24,
};

export function resolveRefundPolicy(
  eventPolicy: RefundPolicy | null | undefined
): RefundPolicy {
  return eventPolicy ?? DEFAULT_REFUND_POLICY;
}

/**
 * Compute the refund amount in cents for a cancellation at `cancelledAt`.
 * Returns { refundCents, reason }.
 */
export function computeRefund(
  amountPaidCents: number,
  eventStartsAt: string,
  cancelledAt: Date,
  policy: RefundPolicy
): { refundCents: number; reason: string } {
  if (!policy.auto_refund || amountPaidCents === 0) {
    return { refundCents: 0, reason: "No refund applicable" };
  }

  const hoursUntilEvent =
    (new Date(eventStartsAt).getTime() - cancelledAt.getTime()) / (1000 * 60 * 60);

  if (hoursUntilEvent <= 0) {
    return { refundCents: 0, reason: "Event has already started" };
  }

  if (policy.no_refund_hours > 0 && hoursUntilEvent <= policy.no_refund_hours) {
    return {
      refundCents: 0,
      reason: `Cancellations within ${policy.no_refund_hours}h of the event are non-refundable`,
    };
  }

  if (policy.full_refund_hours === 0 || hoursUntilEvent > policy.full_refund_hours) {
    return { refundCents: amountPaidCents, reason: "Full refund" };
  }

  const partial = Math.round((amountPaidCents * policy.partial_percent) / 100);
  return {
    refundCents: partial,
    reason: `Partial refund (${policy.partial_percent}%)`,
  };
}
