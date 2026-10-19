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
}): Promise<Result<{ groups: DeskOfferGroup[]; knownPerson: boolean }>> {
  const auth = await requireOrgCommerceAccess(params.organizationId, params.conferenceId);
  if (!auth.ok) return { success: false, error: auth.error };

  const [offersRes, today] = await Promise.all([
    listConferenceOffers(params.conferenceId, params.organizationId),
    conferenceToday(params.conferenceId),
  ]);
  if (!offersRes.success) return { success: false, error: offersRes.error };

  // ⚠️ If what they hold cannot be read, order as for a walk-up rather than
  // fail: the offers are still right, only the order is less helpful.
  const personDates = params.personId
    ? await personAdmittedDates(params.conferenceId, params.personId).catch(() => null)
    : null;

  return {
    success: true,
    data: {
      groups: rankDeskOffers({ offers: offersRes.data, personDates, today }),
      knownPerson: personDates !== null,
    },
  };
}
