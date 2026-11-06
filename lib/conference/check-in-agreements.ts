/**
 * Agreements accepted at check-in. Its own module (not legal-acceptance.ts) so
 * it reads personOwedAgreements through the module boundary, the same one the
 * desk and self check-in both go through.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { personOwedAgreements } from "@/lib/conference/legal-acceptance";

/**
 * Record the agreements a conference person accepted at check-in, for the desk
 * and for self check-in alike.
 *
 * ⛔ Recorded for the PERSON (their contact) so someone with no login can
 * consent at all, and with their login too when they have one, so every other
 * surface counts it. Only what they still owe RIGHT NOW is recorded: the server
 * recomputes it, the caller's list is not trusted. `via` says whose hands the
 * device was in; `recordedBy` is the staff member whose device it was, or null
 * on the attendee's own phone. Callers authorise first.
 */
export async function recordOwedAgreements(params: {
  conferenceId: string;
  personId: string;
  versionIds: string[];
  via: "desk" | "self";
  recordedBy: string | null;
}): Promise<{ success: true; data: { stillOwed: number } } | { success: false; error: string }> {
  const db = createAdminClient();
  const { data: person } = await db
    .from("conference_people")
    .select("id, user_id, canonical_person_id")
    .eq("conference_id", params.conferenceId)
    .eq("id", params.personId)
    .maybeSingle();
  if (!person) return { success: false, error: "That person is not on this conference." };
  const contactId = (person.canonical_person_id as string | null) ?? null;
  const userId = (person.user_id as string | null) ?? null;
  if (!contactId && !userId) {
    return { success: false, error: "There is no record to attach their acceptance to. Please see a staff lead." };
  }

  const owed = await personOwedAgreements(db, params.conferenceId, params.personId);
  const toAccept = owed.filter((o) => params.versionIds.includes(o.versionId));
  for (const doc of toAccept) {
    const { error } = await db.from("legal_acceptances").insert({
      user_id: userId,
      contact_id: contactId,
      legal_version_id: doc.versionId,
      accepted_via: params.via,
      recorded_by: params.recordedBy,
    });
    // Already accepted (a race, or by their login meanwhile) is not a failure.
    if (error && error.code !== "23505") return { success: false, error: error.message };
  }
  if (toAccept.length > 0) {
    await logAuditEventSafe({
      action: params.via === "desk" ? "conference_agreements_accepted_at_desk" : "conference_agreements_accepted_self",
      entityType: "conference_people",
      entityId: params.personId,
      actorId: params.recordedBy,
      actorType: params.recordedBy ? "user" : "system",
      details: { conferenceId: params.conferenceId, documents: toAccept.map((d) => d.documentType), via: params.via },
    });
  }
  return { success: true, data: { stillOwed: owed.length - toAccept.length } };
}
