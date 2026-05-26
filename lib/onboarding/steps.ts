// Shared constants for the org-admin onboarding journey.
// No "use server" directive — safe to import from both server actions and client components.

export const ORG_ADMIN_STEPS = [
  "session_1_welcome",
  "public_contact_email",
  "toolkit_tour",
  "profile_description",
  "profile_logo",
  "profile_hero",
  "contacts_sorted",
  "contact_photos",
  "conference_delegates",
  "visibility_intro",
  "network_members",
  "network_partners",
  "network_member_space",
  "events_discovery",
  "benchmarking_survey",
] as const;

export type OrgAdminStepKey = (typeof ORG_ADMIN_STEPS)[number];
