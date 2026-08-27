import { createAdminClient } from "@/lib/supabase/admin";

export const CONTACT_CHANNELS = ["call", "email", "in_person", "text", "other"] as const;
export const CONTACT_OUTCOMES = [
  "renewing",
  "undecided",
  "not_renewing",
  "no_response",
  "other",
] as const;

export type ContactChannel = (typeof CONTACT_CHANNELS)[number];
export type ContactOutcome = (typeof CONTACT_OUTCOMES)[number];

export const CHANNEL_LABEL: Record<ContactChannel, string> = {
  call: "Phone call",
  email: "Personal email",
  in_person: "In person",
  text: "Text message",
  other: "Other",
};

export const OUTCOME_LABEL: Record<ContactOutcome, string> = {
  renewing: "Says they'll renew",
  undecided: "Undecided",
  not_renewing: "Not renewing",
  no_response: "No response",
  other: "Other",
};

export interface ContactLogEntry {
  id: string;
  contactedAt: string;
  contactedBy: string | null;
  channel: ContactChannel;
  outcome: ContactOutcome;
  note: string | null;
}

/** Outreach state for one organization in one cycle. */
export interface OrgOutreach {
  assignedTo: string | null;
  lastContact: ContactLogEntry | null;
  contactCount: number;
}

/**
 * Assignment and contact state for a set of organizations in one cycle, keyed
 * by organization id. Orgs with no outreach yet are simply absent — callers
 * should treat a miss as unassigned and uncontacted.
 */
export async function getOutreachByOrg(
  db: ReturnType<typeof createAdminClient>,
  orgIds: string[],
  renewalYear: number
): Promise<Map<string, OrgOutreach>> {
  const out = new Map<string, OrgOutreach>();
  if (orgIds.length === 0) return out;

  const [assignRes, logRes] = await Promise.all([
    db
      .from("renewal_assignments")
      .select("organization_id, assigned_to")
      .eq("renewal_year", renewalYear)
      .in("organization_id", orgIds),
    db
      .from("renewal_contact_log")
      .select("id, organization_id, contacted_at, contacted_by, channel, outcome, note")
      .eq("renewal_year", renewalYear)
      .in("organization_id", orgIds)
      .order("contacted_at", { ascending: false }),
  ]);

  const ensure = (orgId: string): OrgOutreach => {
    let row = out.get(orgId);
    if (!row) {
      row = { assignedTo: null, lastContact: null, contactCount: 0 };
      out.set(orgId, row);
    }
    return row;
  };

  for (const a of assignRes.data ?? []) {
    ensure(a.organization_id).assignedTo = a.assigned_to;
  }

  // Rows arrive newest-first, so the first one seen per org is the latest.
  for (const l of logRes.data ?? []) {
    const row = ensure(l.organization_id);
    row.contactCount++;
    if (!row.lastContact) {
      row.lastContact = {
        id: l.id,
        contactedAt: l.contacted_at,
        contactedBy: l.contacted_by,
        channel: l.channel as ContactChannel,
        outcome: l.outcome as ContactOutcome,
        note: l.note,
      };
    }
  }

  return out;
}

/**
 * Assign an organization's renewal conversation to somebody for this cycle.
 * Re-assigning replaces the owner rather than adding a second — one owner per
 * org per cycle is the point. Passing null clears the assignment.
 */
export async function setRenewalAssignment(params: {
  organizationId: string;
  renewalYear: number;
  assignedTo: string | null;
  assignedBy: string | null;
}): Promise<{ success: true } | { success: false; error: string }> {
  const db = createAdminClient();
  const { error } = await db
    .from("renewal_assignments")
    .upsert(
      {
        organization_id: params.organizationId,
        renewal_year: params.renewalYear,
        assigned_to: params.assignedTo,
        assigned_by: params.assignedBy,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,renewal_year" }
    );
  if (error) return { success: false, error: error.message };
  return { success: true };
}

/**
 * Record that a human actually spoke to this organization. Append-only — a
 * second conversation is a second row, so the arc stays readable instead of
 * being flattened to its latest state.
 */
export async function logRenewalContact(params: {
  organizationId: string;
  renewalYear: number;
  contactedBy: string | null;
  channel: ContactChannel;
  outcome: ContactOutcome;
  note: string | null;
}): Promise<{ success: true; id: string } | { success: false; error: string }> {
  if (!CONTACT_CHANNELS.includes(params.channel)) {
    return { success: false, error: `Unknown channel "${params.channel}".` };
  }
  if (!CONTACT_OUTCOMES.includes(params.outcome)) {
    return { success: false, error: `Unknown outcome "${params.outcome}".` };
  }

  const db = createAdminClient();
  const { data, error } = await db
    .from("renewal_contact_log")
    .insert({
      organization_id: params.organizationId,
      renewal_year: params.renewalYear,
      contacted_by: params.contactedBy,
      channel: params.channel,
      outcome: params.outcome,
      note: params.note?.trim() || null,
    })
    .select("id")
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, id: data.id };
}
