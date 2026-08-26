/**
 * Who may hold a proxy, and whether a given appointment is good.
 *
 * By-Law No. 1 Part VII Section 7 (s.171(1) NFP Act) is unusually specific
 * about the proxyholder, and the specificity is the whole point — this is not
 * "any member may carry any other member's vote":
 *
 *   "...appointing in writing a proxyholder, who must be an employee of the
 *    member store or a primary store contact of another member store..."
 *
 * Two disjoint routes, and each needs a different check:
 *
 *   own_store      — an employee of the appointing store. Any contact of that
 *                    organization qualifies; the by-law says "employee", not
 *                    "primary contact", so seniority is irrelevant here.
 *
 *   other_primary  — the PRIMARY store contact of a different member store.
 *                    Not any employee of another store. A store's ordinary
 *                    staff cannot carry another store's vote; only the person
 *                    that store has designated as its primary contact can.
 *
 * Everything else is refused, including the cases that feel harmless: a vendor
 * partner's contact, a lapsed member's primary contact, a CSC staff member.
 * The electorate is member stores, so the people who may act for them are
 * bounded by member stores too.
 *
 * Pure. Callers supply the facts; nothing here reads the database.
 */

import type { ElectionsConfig } from "./config";

export type ProxyFormSource = "online" | "paper" | "facsimile";

/** A contact considered as a potential proxyholder. */
export interface ProxyPersonFacts {
  contactId: string;
  name: string | null;
  organizationId: string | null;
  /** `organizations.type` — CAPITALISED in this database ("Member"). */
  organizationType: string | null;
  /** `organizations.membership_status`. */
  organizationMembershipStatus: string | null;
  /**
   * Whether this person is their store's Primary Store contact in the by-law's
   * sense — which at CSC means holding org_admin, NOT the `contacts.is_primary`
   * flag. Confirmed by the ED 2026-08-26: admins and org admins ARE the primary
   * store contacts, and `is_primary` is stale data that lags reality.
   *
   * Reading the flag instead turned away 9 legitimate admins and left 3 member
   * stores with nobody able to hold another store's proxy at all.
   */
  isPrimaryContact: boolean;
  /** `contacts.archived_at is null`. */
  active: boolean;
}

export interface ProxyGrantorFacts {
  organizationId: string;
  organizationType: string | null;
  organizationMembershipStatus: string | null;
}

export type ProxyEligibilityRoute = "own_store" | "other_primary";

export type ProxyRefusalCode =
  | "proxyholder_inactive"
  | "proxyholder_has_no_organization"
  | "grantor_not_a_member_store"
  | "grantor_not_in_good_standing"
  | "other_store_not_a_member_store"
  | "other_store_not_in_good_standing"
  | "other_store_contact_not_primary"
  | "self_appointment";

export interface ProxyEligibility {
  eligible: boolean;
  route: ProxyEligibilityRoute | null;
  refusal: ProxyRefusalCode | null;
  /** Member-facing sentence. Says the rule, not just the verdict. */
  reason: string;
}

/**
 * `organizations.type` is capitalised in this database — a lowercase comparison
 * silently matches nothing and would refuse every appointment with a confusing
 * message. Compare case-insensitively rather than trusting either casing.
 */
function isMemberStore(orgType: string | null): boolean {
  return (orgType ?? "").trim().toLowerCase() === "member";
}

/**
 * A store whose membership has lapsed is not "a member entitled to vote", so it
 * can neither appoint nor supply a proxyholder. `grace` is deliberately absent:
 * the same rule that keeps a store in grace off the ballot keeps it from
 * carrying votes. See eligibility.ts, which draws the line in the same place.
 */
function inGoodStanding(status: string | null): boolean {
  const s = (status ?? "").trim().toLowerCase();
  return s === "active" || s === "reactivated";
}

/**
 * Can `person` hold the proxy of `grantor` for a member meeting?
 *
 * `config` is accepted so a future by-law amendment that widens or narrows the
 * proxyholder rule is a config change like every other rule in this module,
 * rather than an edit here. Nothing reads it yet — the rule as written has no
 * knobs — and that is deliberate: inventing settings for a rule the by-law
 * states flatly would imply a discretion the association does not have.
 */
export function evaluateProxyholder(
  grantor: ProxyGrantorFacts,
  person: ProxyPersonFacts,
  _config?: ElectionsConfig
): ProxyEligibility {
  if (!person.active) {
    return {
      eligible: false,
      route: null,
      refusal: "proxyholder_inactive",
      reason: "That contact is archived and cannot be appointed.",
    };
  }

  if (!isMemberStore(grantor.organizationType)) {
    return {
      eligible: false,
      route: null,
      refusal: "grantor_not_a_member_store",
      reason:
        "Only member stores vote at a member meeting, so only a member store can appoint a proxy.",
    };
  }

  if (!inGoodStanding(grantor.organizationMembershipStatus)) {
    return {
      eligible: false,
      route: null,
      refusal: "grantor_not_in_good_standing",
      reason:
        "This membership is not current, so the store has no vote to assign. Renewing restores it.",
    };
  }

  if (!person.organizationId) {
    return {
      eligible: false,
      route: null,
      refusal: "proxyholder_has_no_organization",
      reason:
        "A proxyholder must be an employee of your store or the primary contact of another member store. This contact is not attached to either.",
    };
  }

  // Route 1: an employee of the appointing store. The by-law says "employee",
  // so any contact of that organization qualifies — primary or not.
  if (person.organizationId === grantor.organizationId) {
    return {
      eligible: true,
      route: "own_store",
      refusal: null,
      reason: "An employee of your own store may carry your vote.",
    };
  }

  // Route 2: the PRIMARY contact of a different member store.
  if (!isMemberStore(person.organizationType)) {
    return {
      eligible: false,
      route: null,
      refusal: "other_store_not_a_member_store",
      reason:
        "A proxyholder from outside your store must be the primary contact of another member store. This contact is not at a member store.",
    };
  }

  if (!inGoodStanding(person.organizationMembershipStatus)) {
    return {
      eligible: false,
      route: null,
      refusal: "other_store_not_in_good_standing",
      reason:
        "That store's membership is not current, so its contact cannot carry a vote.",
    };
  }

  if (!person.isPrimaryContact) {
    return {
      eligible: false,
      route: null,
      refusal: "other_store_contact_not_primary",
      reason:
        "Only the primary contact of another member store may hold your proxy — not any employee of that store.",
    };
  }

  return {
    eligible: true,
    route: "other_primary",
    refusal: null,
    reason: "The primary contact of another member store may carry your vote.",
  };
}

/**
 * S7(c): "valid only for the meeting for which it was specifically given or for
 * any adjournment thereof."
 *
 * Expressed as a check rather than relying solely on the meeting_id foreign
 * key, so a caller that resolves a proxy while counting a vote has to state
 * which meeting it is counting for. The FK stops a proxy being stored against
 * the wrong meeting; this stops one being *used* for the wrong meeting.
 */
export function isProxyValidForMeeting(
  proxy: { meetingId: string; revokedAt: string | null },
  meetingId: string
): boolean {
  return proxy.revokedAt === null && proxy.meetingId === meetingId;
}

/**
 * S7(a): the form provided by the Corporation "or a facsimile thereof".
 *
 * A paper or faxed appointment is exactly as valid as one made online, so the
 * register must be able to hold it — but it needs the signed document attached,
 * because for those routes the document IS the evidence. An online appointment
 * is evidenced by the authenticated actor and signed_at instead.
 */
export function requiresSignedDocument(source: ProxyFormSource): boolean {
  return source === "paper" || source === "facsimile";
}
