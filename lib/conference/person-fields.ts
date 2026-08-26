/**
 * Who may write which field on `conference_people`.
 *
 * This policy predates the obligations work and is the one that counts —
 * `updateConferencePersonSelf` has enforced it since the v2 projection landed.
 * It lives here, pure and importable, because a "use server" module can only
 * export async functions, so the sets could not be shared from there and were
 * duplicated instead.
 *
 * Two rules, and they are different in kind:
 *
 *   SELF_EDITABLE — facts about a person that only that person reliably knows.
 *   The guard is identity, not role: `user_id === auth.ctx.userId`. An org
 *   admin cannot write these for a colleague, and should not want to; a
 *   guessed allergy reads as confirmed and is worse than a blank one, which at
 *   least keeps being asked.
 *
 *   IDENTITY_PROJECTION — name, email, title. Refused on this table outright,
 *   by anybody. `conference_people` is a projection; the canonical record is
 *   `contacts`, and writing here would fork a person's name into a second
 *   place that never syncs back. Edit the contact instead — which is what the
 *   Details tab of the contact modal already does.
 */

export const SELF_EDITABLE_PERSON_FIELDS: readonly string[] = [
  "travel_mode",
  "road_origin_address",
  "seat_preference",
  "preferred_departure_airport",
  "dietary_restrictions",
  "accessibility_needs",
  "mobile_phone",
  "emergency_contact_name",
  "emergency_contact_phone",
];

export const IDENTITY_PROJECTION_PERSON_FIELDS: readonly string[] = [
  "display_name",
  "contact_email",
  "role_title",
];

/** True when only the person themselves may answer this. */
export function isSelfEditablePersonField(key: string): boolean {
  return SELF_EDITABLE_PERSON_FIELDS.includes(key);
}

/**
 * True when this belongs to the contact record and must never be written onto
 * the conference projection — not by the person, not by their admin.
 */
export function isIdentityProjectionField(key: string): boolean {
  return IDENTITY_PROJECTION_PERSON_FIELDS.includes(key);
}
