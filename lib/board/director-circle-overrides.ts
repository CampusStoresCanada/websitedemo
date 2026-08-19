/**
 * Hand-maintained director → Circle account links.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Board automation (Butler Ghost posting partner applications and collecting
 * votes) needs to reach all nine directors in Circle. It resolves each one via
 * `contacts.circle_id`. When a director's Circle account is registered under a
 * different email than their contact record, that link is NULL and they become
 * unreachable — which matters under the fixed 5-of-9 bylaw threshold, where one
 * silent director is 20% of the votes needed to carry.
 *
 * This file is the manual patch for that case. It is deliberately NOT a fix to
 * the contact row — see "WHY NOT JUST SET contacts.circle_id" below.
 *
 * SCOPE
 * -----
 * Read-only, and only for resolving *which Circle account to talk to*. Nothing
 * here feeds the identity sync, and nothing here should ever be written back to
 * `contacts`. The database remains the source of truth for identity; this is a
 * lookup-side alias, not a second identity record.
 *
 * Entries are valid only while the person is a sitting director. Remove the
 * entry when they leave the board or when the underlying contact record is
 * fixed properly.
 *
 * WHY NOT JUST SET contacts.circle_id
 * -----------------------------------
 * Because the identity sync pushes outward. `contacts` → Circle already covers
 * name and job title (job title as the `jobtitle` custom profile field). Linking
 * a contact row to a Circle account whose profile legitimately differs would
 * make the next outbound sync overwrite the live Circle profile with the
 * contact's values.
 *
 * For Sean Bell that is not hypothetical — the two records disagree today:
 *
 *   contacts.role_title  "Buyer, Instructional Resources, & Finance Coordinator"
 *   Circle jobtitle      "Procurement and Client Relations Specialist"
 *
 * Setting `circle_id` on that contact would silently rewrite a real person's
 * visible Circle profile as a side effect of wiring up board voting. The
 * override keeps the two apart until someone reconciles them on purpose.
 */

export interface DirectorCircleOverride {
  /** `profiles.id` — stable identifier, unlike email. */
  profileId: string;
  /** Display name, for logs and review. Not used for matching. */
  name: string;
  /** Email on the CSC contact record. */
  contactEmail: string;
  /** Email the Circle account is registered under. */
  circleEmail: string;
  /** Circle `community_member_id`. */
  circleMemberId: number;
  /** Why the two differ, and what would retire this entry. */
  reason: string;
}

/**
 * Sean Bell (Secretary) holds his Circle account under a campusstores.ca
 * address while his CSC contact record is his University of Lethbridge work
 * address. Same human, verified 2026-08-19 against the live Circle profile:
 * `institution1` = "University of Lethbridge", member tag "University of
 * Lethbridge", headline "CSC Board member", 22 posts / 286 comments, active
 * the same day. There is exactly one Sean Bell contact row and no Circle
 * account under sean.bell@uleth.ca.
 */
export const DIRECTOR_CIRCLE_OVERRIDES: readonly DirectorCircleOverride[] = [
  {
    profileId: "4add1111-5ddc-42e3-af48-f533ca2fdb9e",
    name: "Sean Bell",
    contactEmail: "sean.bell@uleth.ca",
    circleEmail: "sean.bell@campusstores.ca",
    circleMemberId: 30133357,
    reason:
      "Circle account registered under his CSC address, contact record under his U of L work address. " +
      "Retire this entry when he leaves the board, or when the contact and Circle records are " +
      "reconciled deliberately (note the job-title conflict in the file header).",
  },
];

const BY_PROFILE_ID = new Map(
  DIRECTOR_CIRCLE_OVERRIDES.map((o) => [o.profileId, o])
);

/**
 * Resolves the Circle `community_member_id` to use for a director.
 *
 * The contact record always wins — an override is a fallback for a missing
 * link, never a way to redirect an existing one. If a contact later gains a
 * `circle_id` that disagrees with its override, that is a real conflict worth
 * seeing in the logs, and the override should be deleted.
 *
 * @param profileId       `profiles.id` of the director
 * @param contactCircleId `contacts.circle_id`, if the contact row has one
 * @returns the Circle member id, or null if the director is unreachable
 */
export function resolveDirectorCircleId(
  profileId: string,
  contactCircleId: string | number | null | undefined
): number | null {
  const override = BY_PROFILE_ID.get(profileId);

  if (contactCircleId != null && contactCircleId !== "") {
    const linked = Number(contactCircleId);
    if (override && override.circleMemberId !== linked) {
      console.warn(
        `[board/director-circle-overrides] ${override.name} now has contacts.circle_id=${linked}, ` +
          `which disagrees with the override (${override.circleMemberId}). Using the contact record. ` +
          `Verify which is correct and remove the override.`
      );
    }
    return Number.isFinite(linked) ? linked : null;
  }

  return override?.circleMemberId ?? null;
}

/** True if this director is reachable in Circle only because of an override. */
export function isCircleOverridden(profileId: string): boolean {
  return BY_PROFILE_ID.has(profileId);
}
