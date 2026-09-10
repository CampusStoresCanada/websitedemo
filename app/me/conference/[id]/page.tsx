import { redirect } from "next/navigation";

/**
 * Folded into /me, the same way the org conference page folded into /org/[slug].
 *
 * The to-do list moved to #conference_checklist there. The preferences form —
 * dietary, accessibility, emergency contact, travel — moved behind Edit, into
 * the modal already used for changing a name or job title, so "change
 * something about me" is one path rather than two. The readiness list is gone:
 * it restated the same obligations as a list of things the reader could not
 * act on.
 *
 * A redirect rather than a deletion, because reminder emails carrying this URL
 * are already in inboxes.
 */
export default async function MyConferencePage() {
  redirect("/me#conference_checklist");
}
