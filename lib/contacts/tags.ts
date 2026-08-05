// Contact tags: how we segment people we need to reach who aren't a
// logged-in member/partner contact — lapsed orgs, prospects, conference-only
// attendees, board/committee, and vendors outside the partner program.
// Reuses the existing contacts.contact_type text[] column (already used for
// "directory"/"conference" origin tags) rather than adding a new column.

export const CONTACT_TAGS = [
  { value: "lapsed", label: "Lapsed member/partner" },
  { value: "prospect", label: "Prospect (never joined)" },
  { value: "conference_only", label: "Conference-only attendee" },
  { value: "board", label: "Board / committee" },
  { value: "external_vendor", label: "External vendor (non-partner)" },
] as const;

export type ContactTag = (typeof CONTACT_TAGS)[number]["value"];

export const NON_MEMBER_CONTACT_TAGS: ContactTag[] = CONTACT_TAGS.map((t) => t.value);

export function contactTagLabel(tag: string): string {
  return CONTACT_TAGS.find((t) => t.value === tag)?.label ?? tag;
}

/**
 * True if this contact is tagged as one of the non-member categories —
 * they're tracked like any other contact but must never be silently
 * provisioned a login or a Circle account.
 */
export function hasNonMemberTag(contactType: string[] | null | undefined): boolean {
  if (!contactType || contactType.length === 0) return false;
  return contactType.some((t) => (NON_MEMBER_CONTACT_TAGS as string[]).includes(t));
}
