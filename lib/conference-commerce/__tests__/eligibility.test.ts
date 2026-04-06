import { describe, expect, it } from "vitest";
import {
  buildEligibilityContext,
  checkProductEligibility,
  validatePartnerMeetingMetadata,
} from "../eligibility";
import type { ProductRow, ProductRuleRow } from "../eligibility";

function buildProduct(overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    id: "product-1",
    conference_id: "conf-1",
    slug: "partner_meeting_time",
    name: "Partner Meeting Time",
    description: null,
    price_cents: 10000,
    currency: "CAD",
    is_taxable: true,
    is_tax_exempt: false,
    capacity: 45,
    current_sold: 0,
    max_per_account: null,
    display_order: 0,
    is_active: true,
    metadata: null,
    qbo_item_id: null,
    created_at: "2026-03-02T00:00:00.000Z",
    ...overrides,
  };
}

function buildRule(overrides: Partial<ProductRuleRow>): ProductRuleRow {
  return {
    id: "rule-1",
    product_id: "product-1",
    rule_type: "custom",
    rule_config: {},
    error_message: "ineligible",
    display_order: 0,
    ...overrides,
  };
}

describe("conference commerce eligibility", () => {
  it("enforces requires_org_type", () => {
    const context = buildEligibilityContext({
      conferenceId: "conf-1",
      organizationId: "org-1",
      userId: "user-1",
      organizationType: "Member",
      membershipStatus: "active",
      registrationTypes: ["delegate"],
      cartItems: [],
      paidOrderItems: [],
    });

    const result = checkProductEligibility({
      product: buildProduct(),
      quantity: 1,
      rules: [
        buildRule({
          rule_type: "requires_org_type",
          rule_config: { org_type: "vendor_partner" },
          error_message: "Requires vendor partner",
        }),
      ],
      context,
    });

    expect(result.eligible).toBe(false);
    expect(result.errors).toContain("Requires vendor partner");
  });

  it("enforces max_quantity across paid and cart state", () => {
    const context = buildEligibilityContext({
      conferenceId: "conf-1",
      organizationId: "org-1",
      userId: "user-1",
      organizationType: "Vendor Partner",
      membershipStatus: "active",
      registrationTypes: ["exhibitor"],
      cartItems: [{ slug: "partner_meeting_time", quantity: 1 }],
      paidOrderItems: [{ slug: "partner_meeting_time", quantity: 1 }],
    });

    const result = checkProductEligibility({
      product: buildProduct(),
      quantity: 1,
      rules: [
        buildRule({
          rule_type: "max_quantity",
          rule_config: { max: 2 },
          error_message: "Max quantity is 2",
        }),
      ],
      context,
    });

    expect(result.eligible).toBe(false);
    expect(result.errors).toContain("Max quantity is 2");
  });

  it("supports custom attendance commitment rule", () => {
    const context = buildEligibilityContext({
      conferenceId: "conf-1",
      organizationId: "org-1",
      userId: "user-1",
      organizationType: "Member",
      membershipStatus: "active",
      registrationTypes: [],
      cartItems: [],
      paidOrderItems: [],
    });

    const result = checkProductEligibility({
      product: buildProduct({ slug: "additional_delegate_accommodation" }),
      quantity: 1,
      rules: [
        buildRule({
          rule_type: "custom",
          rule_config: { expression: "attendance_commit_required=true" },
          error_message: "Attendance commitment required",
        }),
      ],
      context,
    });

    expect(result.eligible).toBe(false);
    expect(result.errors).toContain("Attendance commitment required");
  });

  it("supports membership-or-partner custom rule", () => {
    const context = buildEligibilityContext({
      conferenceId: "conf-1",
      organizationId: "org-1",
      userId: "user-1",
      organizationType: "Member",
      membershipStatus: "expired",
      registrationTypes: ["delegate"],
      cartItems: [],
      paidOrderItems: [],
    });

    const result = checkProductEligibility({
      product: buildProduct({ slug: "extracurricular_ticket" }),
      quantity: 1,
      rules: [
        buildRule({
          rule_type: "custom",
          rule_config: { expression: "membership_or_partner_required=true" },
          error_message: "Requires active membership or partner status",
        }),
      ],
      context,
    });

    expect(result.eligible).toBe(false);
    expect(result.errors).toContain("Requires active membership or partner status");
  });

  it("supports composed dsl_v1 rule for block_purchase", () => {
    const context = buildEligibilityContext({
      conferenceId: "conf-1",
      organizationId: "org-1",
      userId: "user-1",
      organizationType: "Member",
      membershipStatus: "active",
      registrationTypes: [],
      cartItems: [],
      paidOrderItems: [],
    });

    const result = checkProductEligibility({
      product: buildProduct({ slug: "extracurricular_ticket" }),
      quantity: 1,
      rules: [
        buildRule({
          rule_type: "custom",
          rule_config: {
            expression: "dsl_v1",
            dsl_v1: {
              data_field: "org.has_any_registration",
              logic: "is_false",
              value: "false",
              modifier: "none",
              outcome: "block_purchase",
            },
          },
          error_message: "Requires prior conference registration",
        }),
      ],
      context,
    });

    expect(result.eligible).toBe(false);
    expect(result.errors).toContain("Requires prior conference registration");
  });

  it("validates partner meeting metadata for multi-brand quantities", () => {
    const invalid = validatePartnerMeetingMetadata({
      slug: "partner_meeting_time",
      quantity: 2,
      metadata: {
        brands: [
          { brand_name: "A", is_primary_brand: true },
          { brand_name: "B", is_primary_brand: true },
        ],
      },
    });

    expect(invalid.eligible).toBe(false);
    expect(invalid.errors.join(" ")).toContain("Exactly one brand");

    const valid = validatePartnerMeetingMetadata({
      slug: "partner_meeting_time",
      quantity: 2,
      metadata: {
        brands: [
          { brand_name: "A", is_primary_brand: true },
          { brand_name: "B", is_primary_brand: false },
        ],
      },
    });

    expect(valid.eligible).toBe(true);
  });
});
