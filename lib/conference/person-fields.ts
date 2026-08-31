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

/**
 * Every column the obligation engine reads about a person.
 *
 * The union of self-editable facts and the identity fields a badge needs. Lives
 * here for the same reason the two sets below do: `lib/actions/conference-access.ts`
 * is `"use server"` and cannot export a const, so anything that needed this
 * list copied it. The personal agenda had its own hardcoded copy within hours
 * of the policy being consolidated — a fourth list of the same six columns.
 */
export const PERSON_OBLIGATION_FIELDS: readonly string[] = [
  "display_name",
  "contact_email",
  "dietary_restrictions",
  "accessibility_needs",
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


/**
 * The values the obligation engine should judge, with identity taken from the
 * canonical record.
 *
 * ⛔ This existed as a contradiction. `contact_email` and `display_name` are
 * IDENTITY_PROJECTION fields — refused on `conference_people` by everybody,
 * because `contacts` is the canonical record and writing here forks a person's
 * name into a second place. But the obligation checked the PROJECTION, found
 * null, and asked. So we asked people for an email we already had, and the only
 * way to satisfy it was a write the policy forbids. It could never be cleared.
 *
 * An identity obligation is met when the canonical record answers it. The
 * projection is used only when it has been explicitly set — a badge name that
 * differs from the contact's legal name is a real case.
 */
export function resolveObligationValues(
  projection: Record<string, unknown> | null,
  contact: { name?: string | null; work_email?: string | null; email?: string | null } | null
): Record<string, unknown> {
  const values: Record<string, unknown> = { ...(projection ?? {}) };
  const present = (v: unknown) => typeof v === "string" && v.trim().length > 0;

  if (!present(values.display_name) && present(contact?.name)) {
    values.display_name = contact!.name;
  }
  if (!present(values.contact_email)) {
    const email = present(contact?.work_email) ? contact!.work_email : contact?.email;
    if (present(email)) values.contact_email = email;
  }
  return values;
}
