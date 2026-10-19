"use server";

/**
 * Selling at the check-in desk: what the Sell panel reads.
 *
 * ⛔ NO NEW COMMERCE. The panel adds to the SAME cart through the SAME
 * addOfferToCart the storefront uses, and pays through the same checkout; this
 * file only answers "which company" and "what to show them first". Prices, tax,
 * eligibility and capacity all stay where they are.
 */

import { requireConferenceDeskAccess, requireOrgCommerceAccess } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { listConferenceOffers } from "@/lib/actions/conference-entities";
import { personAdmittedDates } from "@/lib/conference/badges/checkin";
import { conferenceToday } from "@/lib/conference/desk-staff";
import { rankDeskOffers, type DeskOfferGroup } from "@/lib/conference/desk-offers";
import {
  cleanEmailForFilter,
  createPersonOnAddress,
  peopleOnAddress,
  type AddressMatch,
} from "@/lib/identity/lifecycle";

type Result<T> = { success: true; data: T } | { success: false; error: string };

/**
 * Every organisation the desk can sell to.
 *
 * ⛔ Not getOrganizations(): that is the PUBLIC list, and it leaves out a
 * company mid-renewal — which can still buy a badge at the door. Entitlement is
 * not public listing. What each company may actually buy is still decided per
 * company by listConferenceOffers.
 */
export async function listDeskSaleOrganizations(
  conferenceId: string
): Promise<Result<Array<{ id: string; name: string; type: string | null }>>> {
  const auth = await requireConferenceDeskAccess(conferenceId);
  if (!auth.ok) return { success: false, error: auth.error };
  const { data, error } = await createAdminClient()
    .from("organizations")
    .select("id, name, type")
    .is("archived_at", null)
    .order("name");
  if (error) return { success: false, error: error.message };
  return {
    success: true,
    data: (data ?? []).map((o) => ({ id: o.id as string, name: o.name as string, type: (o.type as string | null) ?? null })),
  };
}

/**
 * The offers for this company, ordered for the person at the desk (or a walk-up).
 * See lib/conference/desk-offers.ts for the rules.
 */
export async function loadDeskSaleOffers(params: {
  conferenceId: string;
  organizationId: string;
  /** The person standing there, when the desk knows them (scan or Find). */
  personId?: string | null;
}): Promise<
  Result<{
    groups: DeskOfferGroup[];
    knownPerson: boolean;
    /** Who a registration is for, when the desk knows them — the exact person. */
    attendee: { name: string; email: string | null; contactId: string | null } | null;
  }>
> {
  const auth = await requireOrgCommerceAccess(params.organizationId, params.conferenceId);
  if (!auth.ok) return { success: false, error: auth.error };

  const [offersRes, today] = await Promise.all([
    listConferenceOffers(params.conferenceId, params.organizationId),
    conferenceToday(params.conferenceId),
  ]);
  if (!offersRes.success) return { success: false, error: offersRes.error };

  // ⚠️ If what they hold cannot be read, order as for a walk-up rather than
  // fail: the offers are still right, only the order is less helpful.
  const [personDates, personRow] = params.personId
    ? await Promise.all([
        personAdmittedDates(params.conferenceId, params.personId).catch(() => null),
        createAdminClient()
          .from("conference_people")
          .select("display_name, contact_email, canonical_person_id")
          .eq("id", params.personId)
          .eq("conference_id", params.conferenceId)
          .maybeSingle()
          .then((r) => r.data),
      ])
    : [null, null];

  return {
    success: true,
    data: {
      groups: rankDeskOffers({ offers: offersRes.data, personDates, today }),
      knownPerson: personDates !== null,
      attendee: personRow
        ? {
            name: (personRow.display_name as string | null) ?? "",
            email: (personRow.contact_email as string | null) ?? null,
            contactId: (personRow.canonical_person_id as string | null) ?? null,
          }
        : null,
    },
  };
}

export type WalkUpMatch = AddressMatch;

/**
 * Who already uses this email at this company — so the desk can apply
 * Stephen's rules (project_shared_email_walkup_rules):
 *   same name  → the same person (B);
 *   other name → the OPERATOR chooses: them, or someone new sharing it (A).
 * ⛔ Reads only. The desk never edits an existing person (C).
 */
export async function lookupWalkUpEmail(params: {
  conferenceId: string;
  organizationId: string;
  email: string;
  name: string;
}): Promise<Result<{ sameName: WalkUpMatch | null; others: WalkUpMatch[] }>> {
  const auth = await requireOrgCommerceAccess(params.organizationId, params.conferenceId);
  if (!auth.ok) return { success: false, error: auth.error };
  const found = await peopleOnAddress(createAdminClient(), params.organizationId, params.email, params.name);
  if ("error" in found) return { success: false, error: found.error };
  return { success: true, data: found };
}

/**
 * A NEW person at this company, for a walk-up nobody has on file — or someone
 * the operator said is NOT the person already on a shared address.
 *
 * ⛔ Never matches by email (createKnownPerson), so it cannot merge two people.
 * ⛔ Circle is set up only for an address nobody is on yet. If anyone already
 * holds a login there, or anyone at all is on file with it, nothing is set up:
 * an existing account is theirs and is not touched.
 */
export async function createWalkUpPerson(params: {
  conferenceId: string;
  organizationId: string;
  name: string;
  email: string;
  title: string;
  phone?: string | null;
}): Promise<Result<{ contactId: string }>> {
  const auth = await requireOrgCommerceAccess(params.organizationId, params.conferenceId);
  if (!auth.ok) return { success: false, error: auth.error };
  const name = params.name.trim();
  const email = cleanEmailForFilter(params.email);
  const title = params.title.trim();
  if (!name || !email || !title) {
    return { success: false, error: "Name, email and job title are all needed." };
  }

  const created = await createPersonOnAddress({
    organizationId: params.organizationId,
    name,
    email,
    title,
    phone: params.phone,
  });
  if (!created.personId) return { success: false, error: created.error ?? "Could not add them." };
  return { success: true, data: { contactId: created.personId } };
}
