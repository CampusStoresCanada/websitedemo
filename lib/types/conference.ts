/**
 * Conference-specific type definitions for JSONB columns and wizard steps.
 */

// ---------------------------------------------------------------------------
// JSONB shapes (stored in conference_registrations.sales_readiness)
// ---------------------------------------------------------------------------

export interface SalesReadiness {
  can_quote: boolean;
  can_negotiate: boolean;
  can_write_orders: boolean;
  can_sign: boolean;
  legal_required: boolean;
}

export const DEFAULT_SALES_READINESS: SalesReadiness = {
  can_quote: false,
  can_negotiate: false,
  can_write_orders: false,
  can_sign: false,
  legal_required: false,
};

// ---------------------------------------------------------------------------
// Wizard step definitions
// ---------------------------------------------------------------------------

export interface WizardStep {
  key: string;
  label: string;
}

export const PARTNER_WIZARD_STEPS: WizardStep[] = [
  { key: "profile", label: "Profile Review" },
  { key: "meeting-intent", label: "Meeting Intent" },
  { key: "sales-readiness", label: "Sales Readiness" },
  { key: "buying-cycles", label: "Buying Cycle Targets" },
  { key: "one-thing", label: "One Thing to Remember" },
  { key: "staff", label: "Staff Selection" },
  { key: "staff-accommodations", label: "Staff Accommodations" },
  { key: "extracurricular", label: "Extracurricular Registration" },
  { key: "categorization", label: "Categorization" },
  { key: "legal", label: "Legal Acceptance" },
  { key: "review", label: "Review & Submit" },
];

export const DELEGATE_WIZARD_STEPS: WizardStep[] = [
  { key: "identification", label: "Delegate Identification" },
  { key: "functional-role", label: "Functional Role" },
  { key: "purchasing-authority", label: "Purchasing Authority" },
  { key: "category-responsibilities", label: "Category Responsibilities" },
  { key: "buying-timeline", label: "Buying Timeline" },
  { key: "top-priorities", label: "Top 3 Priorities" },
  { key: "meeting-intent", label: "Meeting Intent" },
  { key: "success-definition", label: "Success Definition" },
  { key: "travel", label: "Travel & Logistics" },
  { key: "preferences", label: "Partner Preferences" },
  { key: "legal", label: "Legal Acceptance" },
  { key: "review", label: "Review & Submit" },
];

// ---------------------------------------------------------------------------
// Product rule config shapes (conference_product_rules.rule_config JSONB)
// ---------------------------------------------------------------------------

export interface RequiresProductRule {
  product_slug: string;
}

export interface RequiresOrgTypeRule {
  org_type: "member" | "vendor_partner";
}

export interface RequiresRegistrationRule {
  registration_type: string;
}

export interface MaxQuantityRule {
  max: number;
}

export type ProductRuleConfig =
  | RequiresProductRule
  | RequiresOrgTypeRule
  | RequiresRegistrationRule
  | MaxQuantityRule
  | Record<string, unknown>;
