import type { Database } from "@/lib/database.types";
import type { ProductRuleConfig } from "@/lib/types/conference";

export type CartItemRow = Database["public"]["Tables"]["cart_items"]["Row"];
export type ProductRow = Database["public"]["Tables"]["conference_products"]["Row"];
export type ProductRuleRow =
  Database["public"]["Tables"]["conference_product_rules"]["Row"];

export interface EligibilityContext {
  orgTypeNormalized: "member" | "vendor_partner" | "unknown";
  conferenceId: string;
  organizationId: string;
  userId: string;
  registrationTypes: Set<string>;
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
    conferenceId: params.conferenceId,
    organizationId: params.organizationId,
    userId: params.userId,
    registrationTypes: new Set(params.registrationTypes),
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
