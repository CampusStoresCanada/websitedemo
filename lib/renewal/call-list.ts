import { createAdminClient } from "@/lib/supabase/admin";
import { getExpectedAmountsByOrg } from "./expected-amounts";
import { CONTACT_CHANNELS, type ContactChannel, type ContactOutcome } from "./outreach";

export interface CallListContact {
  name: string;
  roleTitle: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
}

export interface CallListEntry {
  organizationId: string;
  organizationName: string;
  orgType: string;
  province: string | null;
  amountCents: number;
  /** True once a payment lands — the row stays on the list, marked done. */
  renewed: boolean;
  contact: CallListContact | null;
  history: {
    id: string;
    contactedAt: string;
    contactedBy: string | null;
    channel: ContactChannel;
    outcome: ContactOutcome;
    note: string | null;
  }[];
}

export interface RenewalCallList {
  renewalYear: number;
  entries: CallListEntry[];
  outstandingCount: number;
  contactedCount: number;
}

/**
 * One person's renewal call list for a cycle.
 *
 * Deliberately includes organizations that have since renewed, marked as such,
 * rather than dropping them. A director who called someone last week should
 * see that it worked; silently removing the row reads as the assignment having
 * vanished, and loses the reason to stop calling.
 */
export async function getRenewalCallList(
  profileId: string,
  renewalYear: number
): Promise<RenewalCallList> {
  const db = createAdminClient();

  const { data: assignments } = await db
    .from("renewal_assignments")
    .select("organization_id")
    .eq("renewal_year", renewalYear)
    .eq("assigned_to", profileId);

  const orgIds = (assignments ?? []).map((a) => a.organization_id);
  const empty: RenewalCallList = { renewalYear, entries: [], outstandingCount: 0, contactedCount: 0 };
  if (orgIds.length === 0) return empty;

  const [orgsRes, contactsRes, logRes, chargesRes, expectedByOrg] = await Promise.all([
    db.from("organizations").select("id, name, type, province").in("id", orgIds),
    // Contact details are working details for the call. Ordering mirrors the
    // board report: the flagged primary first, then whoever has an email.
    db
      .from("contacts")
      .select("organization_id, name, first_name, last_name, role_title, email, work_email, phone, work_phone_number, is_primary")
      .in("organization_id", orgIds)
      .is("archived_at", null)
      .order("is_primary", { ascending: false, nullsFirst: false })
      .order("created_at"),
    db
      .from("renewal_contact_log")
      .select("id, organization_id, contacted_at, contacted_by, channel, outcome, note")
      .eq("renewal_year", renewalYear)
      .in("organization_id", orgIds)
      .order("contacted_at", { ascending: false }),
    db
      .from("renewal_events")
      .select("organization_id")
      .eq("event_type", "charge_succeeded")
      .eq("renewal_year", renewalYear)
      .in("organization_id", orgIds),
    getExpectedAmountsByOrg(db, orgIds, renewalYear),
  ]);

  const renewedIds = new Set((chargesRes.data ?? []).map((r) => r.organization_id));

  const contactByOrg = new Map<string, CallListContact>();
  for (const c of contactsRes.data ?? []) {
    // contacts.organization_id is nullable in the schema; a contact belonging
    // to no org cannot be the person to ring about that org's renewal.
    if (!c.organization_id) continue;
    if (contactByOrg.has(c.organization_id)) continue; // first wins, per the ordering above
    const name =
      [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || c.name || "Unknown";
    contactByOrg.set(c.organization_id, {
      name,
      roleTitle: c.role_title,
      email: c.email ?? c.work_email ?? null,
      phone: c.work_phone_number ?? c.phone ?? null,
      isPrimary: c.is_primary === true,
    });
  }

  const historyByOrg = new Map<string, CallListEntry["history"]>();
  for (const l of logRes.data ?? []) {
    if (!l.organization_id) continue;
    const list = historyByOrg.get(l.organization_id) ?? [];
    list.push({
      id: l.id,
      contactedAt: l.contacted_at,
      contactedBy: l.contacted_by,
      channel: l.channel as ContactChannel,
      outcome: l.outcome as ContactOutcome,
      note: l.note,
    });
    historyByOrg.set(l.organization_id, list);
  }

  const entries: CallListEntry[] = (orgsRes.data ?? []).map((o) => ({
    organizationId: o.id,
    organizationName: o.name,
    orgType: o.type ?? "",
    province: o.province,
    amountCents: expectedByOrg.get(o.id) ?? 0,
    renewed: renewedIds.has(o.id),
    contact: contactByOrg.get(o.id) ?? null,
    history: historyByOrg.get(o.id) ?? [],
  }));

  // Never-contacted first — the list is a queue, and the top of it should be
  // the work, not the part already done.
  entries.sort((a, b) => {
    if (a.renewed !== b.renewed) return a.renewed ? 1 : -1;
    const aTouched = a.history.length > 0;
    const bTouched = b.history.length > 0;
    if (aTouched !== bTouched) return aTouched ? 1 : -1;
    return a.organizationName.localeCompare(b.organizationName);
  });

  return {
    renewalYear,
    entries,
    outstandingCount: entries.filter((e) => !e.renewed).length,
    contactedCount: entries.filter((e) => !e.renewed && e.history.length > 0).length,
  };
}

/** Guard for form input coming back from the call list. */
export function isContactChannel(v: string): v is ContactChannel {
  return (CONTACT_CHANNELS as readonly string[]).includes(v);
}
