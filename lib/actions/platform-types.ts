export interface PlatformConfig {
  id: string;
  client_name: string;
  client_short_name: string;
  client_domain: string;
  support_email: string;
  logo_url: string | null;
  primary_color: string;
  bootstrapped_at: string | null;
  bootstrapped_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlatformFeature {
  id: string;
  feature_key: string;
  enabled: boolean;
  always_on: boolean;
  config_json: Record<string, unknown>;
  enabled_at: string | null;
  enabled_by: string | null;
  created_at: string;
  updated_at: string;
}

export const PLATFORM_FEATURE_KEYS = [
  "membership",
  "billing",
  "visibility",
  "calendar",
  "conference",
  "circle",
  "quickbooks",
  "communications",
  "events",
] as const;

export type PlatformFeatureKey = (typeof PLATFORM_FEATURE_KEYS)[number];

export const PLATFORM_FEATURE_LABELS: Record<PlatformFeatureKey, string> = {
  membership: "Membership & Partnerships",
  billing: "Billing & Invoicing",
  visibility: "Data Visibility",
  calendar: "Calendar & Timeline",
  conference: "Conference Management",
  circle: "Community (Circle)",
  quickbooks: "QuickBooks Integration",
  communications: "Email Communications",
  events: "Events (Non-Conference)",
};

export const PLATFORM_FEATURE_DESCRIPTIONS: Record<PlatformFeatureKey, string> = {
  membership:
    "Core membership state machine, renewals, and partner lifecycle management.",
  billing:
    "Stripe-based invoicing, payment processing, and proration rules.",
  visibility:
    "Field-level access control, masking rules, and public/private allowlists.",
  calendar:
    "Operational timeline engine powering renewal cycles, billing schedules, and deadline tracking.",
  conference:
    "Full conference lifecycle: registration, scheduling, swaps, commerce, badges, and travel ops.",
  circle:
    "Community platform integration with Circle for SSO, member sync, and access groups.",
  quickbooks:
    "Invoice export and payment reconciliation with QuickBooks Online.",
  communications:
    "Email campaign management with audience targeting and delivery tracking via Resend.",
  events:
    "Non-conference event management with ticketing, approvals, and member submissions.",
};

/** Maps feature keys to the policy categories they scope */
export const FEATURE_POLICY_CATEGORIES: Record<PlatformFeatureKey, string[]> = {
  membership: ["renewals", "admin"],
  billing: ["billing"],
  visibility: ["visibility"],
  calendar: [],
  conference: ["scheduling"],
  circle: ["integrations"],
  quickbooks: [],
  communications: [],
  events: [],
};
