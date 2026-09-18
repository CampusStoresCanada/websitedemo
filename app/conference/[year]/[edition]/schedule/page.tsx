import { redirect } from "next/navigation";

/**
 * Folded into /me, the same way /me/conference/[id] was.
 *
 * This route rendered a delegate's meetings and the swap controls. It could
 * never show either: it looked the viewer up in `conference_registrations` —
 * 0 rows, no writer, the retired v2 person-monolith — so `delegateRegistration`
 * was null for everybody and the meeting list was unconditionally empty. Even
 * with rows it could not have matched, because `schedules.delegate_seat_ids`
 * holds SEAT ids and that table hands back registration ids.
 *
 * Everything it was for now lives on /me, against the canonical seat reader:
 * the meetings, the swap control under each one, swaps remaining, and the
 * request-for-more path. One place a person looks for their own conference.
 *
 * A redirect rather than a deletion, because the URL is already in inboxes —
 * every `conference_schedule_ready` sent before today points at it.
 */
export default async function ConferenceSchedulePage() {
  redirect("/me#my_schedule");
}
