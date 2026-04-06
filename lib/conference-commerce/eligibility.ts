import type { Database } from "@/lib/database.types";
import type { ProductRuleConfig } from "@/lib/types/conference";

export type CartItemRow = Database["public"]["Tables"]["cart_items"]["Row"];
export type ProductRow = Database["public"]["Tables"]["conference_products"]["Row"];
export type ProductRuleRow =
  Database["public"]["Tables"]["conference_product_rules"]["Row"];

export interface EligibilityContext {
  orgTypeNormalized: "member" | "vendor_partner" | "unknown";
  membershipStatus: string | null;
  conferenceId: string;
  organizationId: string;
  userId: string;
  registrationTypes: Set<string>;
  registrationCount: number;
  cartItemsBySlug: Map<string, number>;
  paidOrderItemsBySlug: Map<string, number>;
}

export interface EligibilityResult {
  eligible: boolean;
  errors: string[];
}

export function normalizeOrgType(orgType: string | null): "member" | "vendor_partner" | "unknown" {
  if (!orgType) return "unknown";
  if (orgType === "Member") return "member";
  if (orgType === "Vendor Partner") return "vendor_partner";
  return "unknown";
}

function quantityAcrossSources(context: EligibilityContext, slug: string): number {
  return (context.cartItemsBySlug.get(slug) ?? 0) + (context.paidOrderItemsBySlug.get(slug) ?? 0);
}

export function buildEligibilityContext(params: {
  conferenceId: string;
  organizationId: string;
  userId: string;
  organizationType: string | null;
  membershipStatus: string | null;
  registrationTypes: string[];
  cartItems: Array<{ slug: string; quantity: number }>;
  paidOrderItems: Array<{ slug: string; quantity: number }>;
}): EligibilityContext {
  const cartItemsBySlug = new Map<string, number>();
  for (const item of params.cartItems) {
    cartItemsBySlug.set(item.slug, (cartItemsBySlug.get(item.slug) ?? 0) + item.quantity);
  }

  const paidOrderItemsBySlug = new Map<string, number>();
  for (const item of params.paidOrderItems) {
    paidOrderItemsBySlug.set(
      item.slug,
      (paidOrderItemsBySlug.get(item.slug) ?? 0) + item.quantity
    );
  }

  return {
    orgTypeNormalized: normalizeOrgType(params.organizationType),
    membershipStatus: params.membershipStatus,
    conferenceId: params.conferenceId,
    organizationId: params.organizationId,
    userId: params.userId,
    registrationTypes: new Set(params.registrationTypes),
    registrationCount: params.registrationTypes.length,
    cartItemsBySlug,
    paidOrderItemsBySlug,
  };
}

export function checkProductEligibility(params: {
  product: ProductRow;
  quantity: number;
  rules: ProductRuleRow[];
  context: EligibilityContext;
}): EligibilityResult {
  const errors: string[] = [];

  for (const rule of params.rules) {
    const config = (rule.rule_config ?? {}) as ProductRuleConfig;

    if (rule.rule_type === "requires_org_type") {
      const required = (config as { org_type?: string }).org_type;
      if (required && required !== params.context.orgTypeNormalized) {
        errors.push(rule.error_message || `Requires org type: ${required}`);
      }
      continue;
    }

    if (rule.rule_type === "requires_registration") {
      const registrationType = (config as { registration_type?: string }).registration_type;
      if (registrationType && !params.context.registrationTypes.has(registrationType)) {
        errors.push(
          rule.error_message || `Requires registration type: ${registrationType}`
        );
      }
      continue;
    }

    if (rule.rule_type === "requires_product") {
      const requiredSlug = (config as { product_slug?: string }).product_slug;
      const minQuantity = (config as { min_quantity?: number }).min_quantity ?? 1;
      if (!requiredSlug) {
        errors.push("Invalid product dependency rule: product_slug missing.");
      } else if (quantityAcrossSources(params.context, requiredSlug) < minQuantity) {
        errors.push(rule.error_message || `Requires product: ${requiredSlug}`);
      }
      continue;
    }

    if (rule.rule_type === "max_quantity") {
      const max = (config as { max?: number }).max;
      if (typeof max === "number") {
        const existing = quantityAcrossSources(params.context, params.product.slug);
        if (existing + params.quantity > max) {
          errors.push(rule.error_message || `Max quantity is ${max}`);
        }
      }
      continue;
    }

    if (rule.rule_type === "custom") {
      const expression = (config as { expression?: string }).expression;
      if (expression === "dsl_v1") {
        const configRecord = config as Record<string, unknown>;
        const dsl =
          configRecord.dsl_v1 && typeof configRecord.dsl_v1 === "object" && !Array.isArray(configRecord.dsl_v1)
            ? (configRecord.dsl_v1 as Record<string, unknown>)
            : null;
        if (!dsl) continue;

        const dataField = String(dsl.data_field ?? "");
        const logic = String(dsl.logic ?? "equals");
        const rawExpected = dsl.value;
        const outcome = String(dsl.outcome ?? "block_purchase");

        let actualValue: string | number | boolean | null = null;
        if (dataField === "org.membership_status") {
          actualValue = params.context.membershipStatus;
        } else if (dataField === "org.type") {
          actualValue = params.context.orgTypeNormalized;
        } else if (dataField === "org.registration_count") {
          actualValue = params.context.registrationCount;
        } else if (dataField === "org.has_any_registration") {
          actualValue = params.context.registrationCount > 0;
        }

        const expectedString = String(rawExpected ?? "");
        const expectedNumber = Number(rawExpected);
        const expectedBoolean =
          expectedString.toLowerCase() === "true"
            ? true
            : expectedString.toLowerCase() === "false"
              ? false
              : null;

        let matched = false;
        if (logic === "is_true") matched = actualValue === true;
        else if (logic === "is_false") matched = actualValue === false;
        else if (logic === "equals") matched = String(actualValue ?? "") === expectedString;
        else if (logic === "not_equals") matched = String(actualValue ?? "") !== expectedString;
        else if (logic === "gte")
          matched = Number.isFinite(expectedNumber) && Number(actualValue ?? NaN) >= expectedNumber;
        else if (logic === "lte")
          matched = Number.isFinite(expectedNumber) && Number(actualValue ?? NaN) <= expectedNumber;
        else if (expectedBoolean != null) matched = actualValue === expectedBoolean;

        if (matched && outcome === "block_purchase") {
          errors.push(rule.error_message || "Eligibility rule blocked this purchase.");
        }
        continue;
      }
      if (expression === "attendance_commit_required=true") {
        const hasDelegateRegistration =
          params.context.registrationTypes.has("delegate") ||
          params.context.registrationTypes.has("observer");
        if (!hasDelegateRegistration) {
          errors.push(
            rule.error_message ||
              "This product requires an attendance commitment registration."
          );
        }
      } else if (expression === "any_registration_required=true") {
        if (params.context.registrationCount <= 0) {
          errors.push(
            rule.error_message ||
              "At least one conference registration is required for this product."
          );
        }
      } else if (expression === "membership_active_required=true") {
        if (params.context.membershipStatus !== "active") {
          errors.push(rule.error_message || "Active membership is required for this product.");
        }
      } else if (expression === "membership_or_partner_required=true") {
        const hasMembership = params.context.membershipStatus === "active";
        const isPartnerOrg = params.context.orgTypeNormalized === "vendor_partner";
        if (!hasMembership && !isPartnerOrg) {
          errors.push(
            rule.error_message ||
              "Active membership or partner organization status is required for this product."
          );
        }
      }
    }
  }

  return {
    eligible: errors.length === 0,
    errors,
  };
}

export interface PartnerMeetingMetadata {
  brand_name: string;
  is_primary_brand: boolean;
  badge_organization_id?: string;
}

export function validatePartnerMeetingMetadata(params: {
  slug: string;
  quantity: number;
  metadata: Record<string, unknown> | null;
}): EligibilityResult {
  if (params.slug !== "partner_meeting_time") {
    return { eligible: true, errors: [] };
  }

  const metadata = params.metadata ?? {};
  const errors: string[] = [];

  const singleBrand =
    typeof metadata.brand_name === "string" &&
    typeof metadata.is_primary_brand === "boolean";

  const brands = Array.isArray(metadata.brands)
    ? (metadata.brands as Array<Record<string, unknown>>)
    : [];

  if (params.quantity <= 1) {
    if (!singleBrand && brands.length === 0) {
      errors.push(
        "partner_meeting_time requires metadata.brand_name and metadata.is_primary_brand."
      );
    }
  } else {
    if (brands.length !== params.quantity) {
      errors.push(
        "partner_meeting_time quantity > 1 requires metadata.brands[] matching quantity."
      );
    }

    const primaryCount = brands.filter(
      (brand) => brand.is_primary_brand === true
    ).length;

    if (primaryCount !== 1) {
      errors.push("Exactly one brand must be marked as primary for multi-brand checkout.");
    }

    for (const brand of brands) {
      if (typeof brand.brand_name !== "string" || brand.brand_name.trim().length === 0) {
        errors.push("Each brand entry must include a non-empty brand_name.");
        break;
      }
      if (typeof brand.is_primary_brand !== "boolean") {
        errors.push("Each brand entry must include is_primary_brand boolean.");
        break;
      }
    }
  }

  return {
    eligible: errors.length === 0,
    errors,
  };
}

export function mapSchedulerEligibleRoleForProductSlug(slug: string): "delegate" | "exhibitor" | null {
  if (slug === "partner_meeting_time") return "exhibitor";

  if (
    slug === "delegate_registration" ||
    slug === "additional_delegate_accommodation" ||
    slug === "additional_delegate_tradeshow"
  ) {
    return "delegate";
  }

  return null;
}
