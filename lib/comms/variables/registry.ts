// ─────────────────────────────────────────────────────────────────
// Chunk 22: Communications — System Variable Registry
// The single source of truth for which {{variables}} are auto-filled
// with real per-recipient data (see lib/comms/audience.ts,
// lib/comms/format.ts) — as opposed to custom, per-template variables an
// admin defines by hand. Every UI surface that lists "auto-filled"
// variables (New Campaign form, Insert Variable picker) reads this, so
// there's one place to update, not several that can quietly drift apart.
//
// This file is plain data — safe to import from client components.
// ─────────────────────────────────────────────────────────────────

export interface SystemVariableDef {
  label: string;
  /** Which audiences actually populate this — shown in the picker so admins don't add it somewhere it'll render empty. */
  appliesTo: string;
}

export const SYSTEM_VARIABLES = {
  recipient_name: { label: "Recipient Name", appliesTo: "Every recipient" },
  first_name: { label: "First Name", appliesTo: "Every recipient" },
  email: { label: "Email", appliesTo: "Every recipient" },
  app_url: { label: "Site URL", appliesTo: "Every send — the site's base URL, for building CTA links (e.g. {{app_url}}/org/{{organization_slug}})" },
  org_name: { label: "Organization Name", appliesTo: "Org-scoped audiences (Org Admins, conference orgs by seat status)" },
  conference_year: { label: "Conference Year", appliesTo: "Conference-scoped audiences" },
  conference_dates: { label: "Conference Dates", appliesTo: "Conference-scoped audiences" },
  conference_location: { label: "Conference Location", appliesTo: "Conference-scoped audiences" },
  event_name: { label: "Event Name", appliesTo: "Event Registrants" },
  event_date: { label: "Event Date", appliesTo: "Event Registrants" },
} as const satisfies Record<string, SystemVariableDef>;

export type SystemVariableKey = keyof typeof SYSTEM_VARIABLES;

export const SYSTEM_VARIABLE_KEYS = Object.keys(SYSTEM_VARIABLES) as SystemVariableKey[];
