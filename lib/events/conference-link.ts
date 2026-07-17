import { createAdminClient } from "@/lib/supabase/admin";
import type { EventAudienceMode } from "./types";

/**
 * Whether a user can RSVP to an event bound to a conference catalog entity.
 * Reuses `resolve_person_access` — the same graph walk that already gates
 * booths/sessions/meetings — rather than inventing a parallel access model.
 * Requires the user to have a `conference_people` row (an actual registered
 * attendee) for the entity's conference; a global Partner/Member role alone
 * isn't enough, same as it isn't for anything else conference-side.
 */
export async function checkConferenceEventEligibility(
  userId: string,
  conferenceEntityId: string
): Promise<{ eligible: boolean; reason?: string }> {
  const db = createAdminClient();

  const { data: entity } = await db
    .from("conference_entities")
    .select("conference_id")
    .eq("id", conferenceEntityId)
    .maybeSingle();

  if (!entity) return { eligible: false, reason: "This event's conference item could not be found." };

  const { data: person } = await db
    .from("conference_people")
    .select("id")
    .eq("user_id", userId)
    .eq("conference_id", entity.conference_id)
    .maybeSingle();

  if (!person) {
    return { eligible: false, reason: "You need a registration for this conference to RSVP for this." };
  }

  const { data: rows, error } = await db.rpc("resolve_person_access", {
    p_conference_id: entity.conference_id,
    p_person_id: person.id,
  });

  if (error) return { eligible: false, reason: "Couldn't verify eligibility right now — please try again." };

  const reachableIds = new Set((rows ?? []).map((r) => r.entity_id));
  if (!reachableIds.has(conferenceEntityId)) {
    return { eligible: false, reason: "Your current registration doesn't include this." };
  }

  return { eligible: true };
}

/** Maps a catalog entity's `who` audience names to the closest general-events audience_mode, for auto-fill. */
export function deriveDefaultAudienceMode(whoNames: string[]): EventAudienceMode {
  const hasPartner = whoNames.includes("Partner");
  const hasMember = whoNames.includes("Member");
  if (hasPartner && hasMember) return "members_and_partners";
  if (hasPartner) return "partners";
  if (hasMember) return "members";
  return "public";
}
