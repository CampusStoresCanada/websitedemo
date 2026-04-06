"use server";

import crypto from "node:crypto";
import { requireAdmin, requireAuthenticated, isGlobalAdmin } from "@/lib/auth/guards";
import { stripe } from "@/lib/stripe/client";
import { ensureStripeCustomer } from "@/lib/stripe/billing";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/database.types";
import { logAuditEventSafe } from "@/lib/ops/audit";
import {
  buildEligibilityContext,
  checkProductEligibility,
  mapSchedulerEligibleRoleForProductSlug,
  validatePartnerMeetingMetadata,
} from "@/lib/conference-commerce/eligibility";
import {
  evaluateRulesEngine,
  mergeRulesEngineLayers,
  type RulesEngineAction,
  type RulesEngineEvalContext,
  type RulesEngineTrigger,
  type RulesEngineV1,
} from "@/lib/conference/rules-engine";
import { getEffectivePolicies } from "@/lib/policy/engine";

type CartRow = Database["public"]["Tables"]["cart_items"]["Row"];
type ProductRow = Database["public"]["Tables"]["conference_products"]["Row"];
type OrderRow = Database["public"]["Tables"]["conference_orders"]["Row"];
type OrderItemRow = Database["public"]["Tables"]["conference_order_items"]["Row"];
type WishlistRow = Database["public"]["Tables"]["wishlist_intents"]["Row"];

type CommerceFailure = { success: false; error: string; code?: string };
type CommerceSuccess<T> = { success: true; data: T };

interface CartItemWithProduct extends CartRow {
  product: ProductRow;
}

interface CheckoutInput {
  conferenceId: string;
  organizationId: string;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey?: string;
}

interface SchedulerEligibleRecord {
  role: "delegate" | "exhibitor";
  registrationId: string;
  orderId: string;
  orderItemId: string;
  productSlug: string;
}

interface BillingMetadata {
  billing_attempt_count?: number;
  last_billing_attempt_at?: string;
  last_billing_error?: string;
  last_billing_payment_intent_id?: string;
}

type WishlistStatus =
  | "wishlisted"
  | "board_pending"
  | "board_approved"
  | "board_declined"
  | "billing_pending"
  | "billing_paid"
  | "billing_failed_retryable"
  | "billing_failed_final"
  | "reservation_expired"
  | "registered";

const WISHLIST_TRANSITIONS: Record<WishlistStatus, WishlistStatus[]> = {
  wishlisted: ["board_pending", "board_approved", "board_declined"],
  board_pending: ["board_approved", "board_declined"],
  board_approved: ["billing_pending", "billing_failed_retryable", "registered"],
  board_declined: [],
  billing_pending: ["billing_paid", "billing_failed_retryable", "billing_failed_final"],
  billing_paid: ["registered"],
  billing_failed_retryable: ["billing_pending", "billing_failed_final", "reservation_expired"],
  billing_failed_final: ["reservation_expired"],
  reservation_expired: [],
  registered: [],
};

// Defaults — overridden at runtime by policy keys billing.wishlist_max_retry_attempts
// and billing.wishlist_retry_backoff_minutes if present.
const WISHLIST_MAX_RETRY_ATTEMPTS_DEFAULT = 3;
const WISHLIST_RETRY_BACKOFF_MINUTES_DEFAULT = 60;

function isFinalBillingFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("stolen_card") ||
    message.includes("lost_card") ||
    message.includes("fraudulent") ||
    message.includes("invalid_account")
  );
}

function parseBillingMetadata(metadata: unknown): BillingMetadata {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  return metadata as BillingMetadata;
}

function stripeErrorDetails(error: unknown): {
  errorCode: string | null;
  declineCode: string | null;
  message: string;
  paymentIntentId: string | null;
} {
  const fallbackMessage = error instanceof Error ? error.message : String(error);
  const maybeStripe = error as {
    code?: string;
    decline_code?: string;
    message?: string;
    payment_intent?: string | { id?: string } | null;
    raw?: { code?: string; decline_code?: string; message?: string };
  };

  const paymentIntentValue = maybeStripe?.payment_intent;
  const paymentIntentId =
    typeof paymentIntentValue === "string"
      ? paymentIntentValue
      : paymentIntentValue && typeof paymentIntentValue === "object"
        ? paymentIntentValue.id ?? null
        : null;

  return {
    errorCode: maybeStripe.raw?.code ?? maybeStripe.code ?? null,
    declineCode: maybeStripe.raw?.decline_code ?? maybeStripe.decline_code ?? null,
    message: maybeStripe.raw?.message ?? maybeStripe.message ?? fallbackMessage,
    paymentIntentId,
  };
}

function extractRegistrationIdsFromMetadata(
  metadata: Record<string, unknown> | null
): string[] {
  if (!metadata) return [];
  const single = typeof metadata.registration_id === "string" ? [metadata.registration_id] : [];
  const list = Array.isArray(metadata.registration_ids)
    ? metadata.registration_ids.filter((value): value is string => typeof value === "string")
    : [];
  const brands = Array.isArray(metadata.brands)
    ? metadata.brands
        .map((brand) =>
          brand && typeof brand === "object" && "registration_id" in brand
            ? (brand as { registration_id?: unknown }).registration_id
            : null
        )
        .filter((value): value is string => typeof value === "string")
    : [];

  return [...new Set([...single, ...list, ...brands])];
}

async function assertUserCanManageOrg(params: {
  organizationId: string;
}): Promise<
  | { ok: true; userId: string; userEmail: string | null }
  | { ok: false; error: string }
> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { ok: false, error: auth.error };

  const canAccess =
    isGlobalAdmin(auth.ctx.globalRole) || auth.ctx.activeOrgIds.includes(params.organizationId);

  if (!canAccess) {
    return { ok: false, error: "You are not authorized to manage commerce for this organization." };
  }

  return {
    ok: true,
    userId: auth.ctx.userId,
    userEmail: auth.ctx.userEmail,
  };
}

async function getCartItemsWithProducts(params: {
  conferenceId: string;
  organizationId: string;
  userId: string;
}): Promise<CartItemWithProduct[]> {
  const adminClient = createAdminClient();

  const { data: cartItems, error: cartError } = await adminClient
    .from("cart_items")
    .select("*")
    .eq("conference_id", params.conferenceId)
    .eq("organization_id", params.organizationId)
    .eq("user_id", params.userId)
    .order("created_at", { ascending: true });

  if (cartError) throw new Error(cartError.message);

  if (!cartItems || cartItems.length === 0) return [];

  const productIds = cartItems.map((item) => item.product_id);
  const { data: products, error: productsError } = await adminClient
    .from("conference_products")
    .select("*")
    .in("id", productIds);

  if (productsError) throw new Error(productsError.message);

  const productById = new Map((products ?? []).map((product) => [product.id, product]));

  return cartItems
    .map((item) => {
      const product = productById.get(item.product_id);
      if (!product) return null;
      return { ...item, product };
    })
    .filter((value): value is CartItemWithProduct => Boolean(value));
}

async function loadEligibilityArtifacts(params: {
  conferenceId: string;
  organizationId: string;
  userId: string;
  includeCartItems?: Array<{ slug: string; quantity: number }>;
}): Promise<{
  orgTypeRaw: string | null;
  membershipStatus: string | null;
  registrationTypes: string[];
  paidOrderItems: Array<{ slug: string; quantity: number }>;
  pendingOrderItems: Array<{ slug: string; quantity: number }>;
  cartItems: Array<{ slug: string; quantity: number }>;
}> {
  const adminClient = createAdminClient();
  const pendingWindowStartIso = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  const [{ data: org }, { data: registrations }, { data: paidOrderItemsRows }, { data: pendingOrderItemsRows }, cartItems] =
    await Promise.all([
      adminClient
        .from("organizations")
        .select("type, membership_status")
        .eq("id", params.organizationId)
        .single(),
      adminClient
        .from("conference_registrations")
        .select("registration_type")
        .eq("conference_id", params.conferenceId)
        .eq("organization_id", params.organizationId)
        .in("status", ["submitted", "confirmed"]),
      adminClient
        .from("conference_order_items")
        .select("quantity, conference_orders!inner(status, conference_id, organization_id), conference_products!inner(slug)")
        .eq("conference_orders.conference_id", params.conferenceId)
        .eq("conference_orders.organization_id", params.organizationId)
        .eq("conference_orders.status", "paid"),
      adminClient
        .from("conference_order_items")
        .select("quantity, conference_orders!inner(status, conference_id, organization_id, created_at), conference_products!inner(slug)")
        .eq("conference_orders.conference_id", params.conferenceId)
        .eq("conference_orders.organization_id", params.organizationId)
        .eq("conference_orders.status", "pending")
        .gte("conference_orders.created_at", pendingWindowStartIso),
      params.includeCartItems
        ? Promise.resolve(params.includeCartItems)
        : getCartItemsWithProducts({
            conferenceId: params.conferenceId,
            organizationId: params.organizationId,
            userId: params.userId,
          }).then((rows) => rows.map((row) => ({ slug: row.product.slug, quantity: row.quantity }))),
    ]);

  const paidOrderItems = (paidOrderItemsRows ?? []).map((row) => ({
    slug: (row as unknown as { conference_products: { slug: string } }).conference_products.slug,
    quantity: row.quantity,
  }));
  const pendingOrderItems = (pendingOrderItemsRows ?? []).map((row) => ({
    slug: (row as unknown as { conference_products: { slug: string } }).conference_products.slug,
    quantity: row.quantity,
  }));

  return {
    orgTypeRaw: org?.type ?? null,
    membershipStatus: org?.membership_status ?? null,
    registrationTypes: (registrations ?? []).map((row) => row.registration_type),
    paidOrderItems,
    pendingOrderItems,
    cartItems,
  };
}

function countReservedRegistrationItems(items: Array<{ slug: string; quantity: number }>): number {
  return items.reduce((sum, item) => {
    return mapSchedulerEligibleRoleForProductSlug(item.slug) ? sum + Math.max(0, item.quantity) : sum;
  }, 0);
}

function getOrgRegistrationCountForRules(artifacts: {
  registrationTypes: string[];
  pendingOrderItems: Array<{ slug: string; quantity: number }>;
}): number {
  return artifacts.registrationTypes.length + countReservedRegistrationItems(artifacts.pendingOrderItems);
}

function getConcurrentCheckoutWarning(params: {
  engine: RulesEngineV1;
  pendingOrderItems: Array<{ slug: string; quantity: number }>;
}): string | null {
  const pendingRegistrationItems = countReservedRegistrationItems(params.pendingOrderItems);
  if (pendingRegistrationItems <= 0) return null;
  const customTemplate = params.engine.workflows.find(
    (workflow) =>
      workflow.enabled &&
      workflow.scope === "commerce" &&
      typeof workflow.conflict_message_template === "string" &&
      workflow.conflict_message_template.trim().length > 0
  )?.conflict_message_template;
  return (
    customTemplate ??
    "[Rule] has changed. This has affected [scope of changes]. [Old value] is now [new value]. Contact CSC if you think this is incorrect: support@campusstorescanada.com"
  );
}

async function loadProductRules(productId: string) {
  const adminClient = createAdminClient();
  const { data: rules, error } = await adminClient
    .from("conference_product_rules")
    .select("*")
    .eq("product_id", productId)
    .order("display_order", { ascending: true });

  if (error) throw new Error(error.message);
  return rules ?? [];
}

async function loadAllProductRulesForConference(conferenceId: string) {
  const adminClient = createAdminClient();
  const { data: rules, error } = await adminClient
    .from("conference_product_rules")
    .select("*, conference_products!inner(conference_id)")
    .eq("conference_products.conference_id", conferenceId)
    .order("display_order", { ascending: true });

  if (error) throw new Error(error.message);

  const rulesByProductId = new Map<string, typeof rules>();
  for (const rule of rules ?? []) {
    const existing = rulesByProductId.get(rule.product_id) ?? [];
    existing.push(rule);
    rulesByProductId.set(rule.product_id, existing);
  }
  return rulesByProductId;
}

async function loadConferenceRulesEngine(conferenceId: string): Promise<RulesEngineV1> {
  const adminClient = createAdminClient();
  const { data } = await adminClient
    .from("conference_schedule_modules")
    .select("config_json")
    .eq("conference_id", conferenceId)
    .eq("module_key", "registration_ops")
    .maybeSingle();

  const config =
    data?.config_json && typeof data.config_json === "object" && !Array.isArray(data.config_json)
      ? (data.config_json as Record<string, unknown>)
      : {};
  return mergeRulesEngineLayers({
    tenantEngine: config.tenant_rules_engine_v1 ?? null,
    conferenceEngine: config.rules_engine_v1 ?? null,
  });
}

function collectRulesEngineBlockErrors(params: {
  engine: RulesEngineV1;
  trigger: RulesEngineTrigger;
  context: RulesEngineEvalContext;
}): string[] {
  const evaluation = evaluateRulesEngine(params.engine, params.trigger, params.context);
  const errors: string[] = [];
  for (const action of evaluation.actions) {
    if (action.type !== "block_purchase") continue;
    if (isActionTargetMatch(action, params.context)) {
      errors.push(action.message || "Purchase blocked by policy rule.");
    }
  }
  return errors;
}

function isActionTargetMatch(
  action: RulesEngineAction,
  context: RulesEngineEvalContext
): boolean {
  if ("target_product_id" in action) {
    const matchesProductId = !action.target_product_id || action.target_product_id === context.product_id;
    const matchesSlug = !action.target_product_slug || action.target_product_slug === context.product_slug;
    return matchesProductId && matchesSlug;
  }
  return true;
}

function evaluateRulesEngineActionsForContext(params: {
  engine: RulesEngineV1;
  trigger: RulesEngineTrigger;
  context: RulesEngineEvalContext;
}): RulesEngineAction[] {
  const evaluation = evaluateRulesEngine(params.engine, params.trigger, params.context);
  return evaluation.actions.filter((action) => isActionTargetMatch(action, params.context));
}

function applyRulesEnginePricingActions(basePriceCents: number, actions: RulesEngineAction[]): number {
  let current = basePriceCents;
  for (const action of actions) {
    if (action.type === "apply_price_override_cents") {
      const next = Number(action.amount_cents);
      current = Number.isFinite(next) ? Math.max(0, Math.round(next)) : current;
      continue;
    }
    if (action.type === "apply_discount_percent") {
      const pct = Number(action.percent);
      if (!Number.isFinite(pct)) continue;
      const bounded = Math.max(0, Math.min(100, pct));
      current = Math.max(0, Math.round(current * (1 - bounded / 100)));
    }
  }
  return current;
}

function resolveProductVisibilityFromActions(actions: RulesEngineAction[]): boolean {
  let visible = true;
  for (const action of actions) {
    if (action.type === "set_product_visibility") {
      visible = action.visible;
    }
  }
  return visible;
}

function isRegistrationProductSlug(slug: string): boolean {
  return mapSchedulerEligibleRoleForProductSlug(slug) !== null;
}

function groupUnitPrices(unitPrices: number[]): Array<{ unitPriceCents: number; quantity: number }> {
  const grouped: Array<{ unitPriceCents: number; quantity: number }> = [];
  for (const price of unitPrices) {
    const last = grouped[grouped.length - 1];
    if (last && last.unitPriceCents === price) {
      last.quantity += 1;
      continue;
    }
    grouped.push({ unitPriceCents: price, quantity: 1 });
  }
  return grouped;
}

export async function listConferenceProducts(
  conferenceId: string,
  organizationId: string,
  options?: {
    includeIneligible?: boolean;
  }
): Promise<CommerceSuccess<Array<ProductRow & { eligibilityErrors: string[] }>> | CommerceFailure> {
  const authz = await assertUserCanManageOrg({ organizationId });
  if (!authz.ok) return { success: false, error: authz.error };

  try {
    const adminClient = createAdminClient();
    const { data: products, error } = await adminClient
      .from("conference_products")
      .select("*")
      .eq("conference_id", conferenceId)
      .eq("is_active", true)
      .order("display_order", { ascending: true });

    if (error) return { success: false, error: error.message };

    const artifacts = await loadEligibilityArtifacts({
      conferenceId,
      organizationId,
      userId: authz.userId,
    });

    const context = buildEligibilityContext({
      conferenceId,
      organizationId,
      userId: authz.userId,
      organizationType: artifacts.orgTypeRaw,
      membershipStatus: artifacts.membershipStatus,
      registrationTypes: artifacts.registrationTypes,
      cartItems: artifacts.cartItems,
      paidOrderItems: artifacts.paidOrderItems,
    });
    const orgRegistrationCountForRules = getOrgRegistrationCountForRules(artifacts);

    const allRules = await loadAllProductRulesForConference(conferenceId);
    const rulesEngine = await loadConferenceRulesEngine(conferenceId);
    const enriched: Array<
      ProductRow & { eligibilityErrors: string[]; __hiddenByRules?: boolean }
    > = [];
    for (const product of products ?? []) {
      const rules = allRules.get(product.id) ?? [];
      const eligibility = checkProductEligibility({
        product,
        quantity: 1,
        rules,
        context,
      });
      const engineErrors = collectRulesEngineBlockErrors({
        engine: rulesEngine,
        trigger: "checkout_attempt",
        context: {
          org_membership_status: artifacts.membershipStatus,
          org_type: artifacts.orgTypeRaw,
          user_is_authenticated: true,
          org_registration_count: orgRegistrationCountForRules,
          product_id: product.id,
          product_slug: product.slug,
        },
      });
      const pricingActions = evaluateRulesEngineActionsForContext({
        engine: rulesEngine,
        trigger: "checkout_attempt",
        context: {
          org_membership_status: artifacts.membershipStatus,
          org_type: artifacts.orgTypeRaw,
          user_is_authenticated: true,
          org_registration_count: orgRegistrationCountForRules,
          product_id: product.id,
          product_slug: product.slug,
        },
      });
      const effectiveUnitPrice = applyRulesEnginePricingActions(
        product.price_cents,
        pricingActions
      );
      const visibilityActions = evaluateRulesEngineActionsForContext({
        engine: rulesEngine,
        trigger: "product_catalog_load",
        context: {
          org_membership_status: artifacts.membershipStatus,
          org_type: artifacts.orgTypeRaw,
          user_is_authenticated: true,
          org_registration_count: orgRegistrationCountForRules,
          product_id: product.id,
          product_slug: product.slug,
        },
      });
      const isVisibleForCatalog = resolveProductVisibilityFromActions(
        visibilityActions
      );
      enriched.push({
        ...product,
        price_cents: effectiveUnitPrice,
        eligibilityErrors: [...eligibility.errors, ...engineErrors],
        __hiddenByRules: !isVisibleForCatalog,
      });
    }

    const includeIneligible = options?.includeIneligible === true;
    const visibleProducts = includeIneligible
      ? enriched.filter((product) => product.__hiddenByRules !== true)
      : enriched.filter(
          (product) =>
            product.__hiddenByRules !== true && product.eligibilityErrors.length === 0
        );

    return {
      success: true,
      data: visibleProducts.map((product) => {
        const next = { ...product };
        delete (next as { __hiddenByRules?: boolean }).__hiddenByRules;
        return next;
      }),
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function getConferenceCart(
  conferenceId: string,
  organizationId: string
): Promise<CommerceSuccess<{ items: CartItemWithProduct[]; subtotalCents: number; taxCents: number; totalCents: number }> | CommerceFailure> {
  const authz = await assertUserCanManageOrg({ organizationId });
  if (!authz.ok) return { success: false, error: authz.error };

  try {
    const adminClient = createAdminClient();
    const [items, conference, artifacts, rulesEngine] = await Promise.all([
      getCartItemsWithProducts({ conferenceId, organizationId, userId: authz.userId }),
      adminClient
        .from("conference_instances")
        .select("tax_rate_pct")
        .eq("id", conferenceId)
        .single()
        .then((result) => {
          if (result.error) throw new Error(result.error.message);
          return result.data;
        }),
      loadEligibilityArtifacts({
        conferenceId,
        organizationId,
        userId: authz.userId,
      }),
      loadConferenceRulesEngine(conferenceId),
    ]);

    const taxRate = Number(conference.tax_rate_pct ?? 0);

    let subtotalCents = 0;
    let taxCents = 0;
    const orgRegistrationCountForRules = getOrgRegistrationCountForRules(artifacts);
    for (const item of items) {
      const pricingActions = evaluateRulesEngineActionsForContext({
        engine: rulesEngine,
        trigger: "checkout_attempt",
        context: {
          org_membership_status: artifacts.membershipStatus,
          org_type: artifacts.orgTypeRaw,
          user_is_authenticated: true,
          org_registration_count: orgRegistrationCountForRules,
          product_id: item.product.id,
          product_slug: item.product.slug,
        },
      });
      const effectiveUnitPrice = applyRulesEnginePricingActions(
        item.product.price_cents,
        pricingActions
      );
      const lineSubtotal = item.quantity * effectiveUnitPrice;
      const lineTax =
        item.product.is_tax_exempt || !item.product.is_taxable
          ? 0
          : Math.round(lineSubtotal * (taxRate / 100));
      subtotalCents += lineSubtotal;
      taxCents += lineTax;
    }

    return {
      success: true,
      data: {
        items,
        subtotalCents,
        taxCents,
        totalCents: subtotalCents + taxCents,
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function addCartItem(params: {
  conferenceId: string;
  organizationId: string;
  productId: string;
  quantity?: number;
  metadata?: Record<string, unknown> | null;
}): Promise<CommerceSuccess<CartRow> | CommerceFailure> {
  const authz = await assertUserCanManageOrg({ organizationId: params.organizationId });
  if (!authz.ok) return { success: false, error: authz.error };

  const quantity = Math.max(1, params.quantity ?? 1);

  try {
    const adminClient = createAdminClient();

    const { data: product, error: productError } = await adminClient
      .from("conference_products")
      .select("*")
      .eq("id", params.productId)
      .eq("conference_id", params.conferenceId)
      .eq("is_active", true)
      .single();

    if (productError || !product) {
      return { success: false, error: productError?.message ?? "Product not found" };
    }

    const metadataCheck = validatePartnerMeetingMetadata({
      slug: product.slug,
      quantity,
      metadata: params.metadata ?? null,
    });
    if (!metadataCheck.eligible) {
      return { success: false, code: "INVALID_METADATA", error: metadataCheck.errors.join(" ") };
    }

    const { data: existing } = await adminClient
      .from("cart_items")
      .select("*")
      .eq("conference_id", params.conferenceId)
      .eq("organization_id", params.organizationId)
      .eq("user_id", authz.userId)
      .eq("product_id", params.productId)
      .maybeSingle();

    const cartPreview = await getCartItemsWithProducts({
      conferenceId: params.conferenceId,
      organizationId: params.organizationId,
      userId: authz.userId,
    });

    const cartForContext = cartPreview
      .filter((item) => item.product_id !== params.productId)
      .map((item) => ({ slug: item.product.slug, quantity: item.quantity }));

    if (existing) {
      cartForContext.push({ slug: product.slug, quantity: existing.quantity });
    }

    const artifacts = await loadEligibilityArtifacts({
      conferenceId: params.conferenceId,
      organizationId: params.organizationId,
      userId: authz.userId,
      includeCartItems: cartForContext,
    });

    const context = buildEligibilityContext({
      conferenceId: params.conferenceId,
      organizationId: params.organizationId,
      userId: authz.userId,
      organizationType: artifacts.orgTypeRaw,
      membershipStatus: artifacts.membershipStatus,
      registrationTypes: artifacts.registrationTypes,
      cartItems: cartForContext,
      paidOrderItems: artifacts.paidOrderItems,
    });
    const orgRegistrationCountForRules = getOrgRegistrationCountForRules(artifacts);
    const [rules, rulesEngine] = await Promise.all([
      loadProductRules(product.id),
      loadConferenceRulesEngine(params.conferenceId),
    ]);
    const concurrencyWarning = getConcurrentCheckoutWarning({
      engine: rulesEngine,
      pendingOrderItems: artifacts.pendingOrderItems,
    });
    const eligibility = checkProductEligibility({
      product,
      quantity,
      rules,
      context,
    });
    const engineErrors = collectRulesEngineBlockErrors({
      engine: rulesEngine,
      trigger: "cart_item_add",
      context: {
        org_membership_status: artifacts.membershipStatus,
        org_type: artifacts.orgTypeRaw,
        user_is_authenticated: true,
        org_registration_count: orgRegistrationCountForRules,
        product_id: product.id,
        product_slug: product.slug,
      },
    });

    if (!eligibility.eligible || engineErrors.length > 0) {
      return {
        success: false,
        code: "INELIGIBLE",
        error: [...eligibility.errors, ...engineErrors, ...(concurrencyWarning ? [concurrencyWarning] : [])].join(
          " "
        ),
      };
    }

    const upsertPayload: Database["public"]["Tables"]["cart_items"]["Insert"] = {
      conference_id: params.conferenceId,
      organization_id: params.organizationId,
      user_id: authz.userId,
      product_id: params.productId,
      quantity: existing ? existing.quantity + quantity : quantity,
      metadata: (params.metadata ?? existing?.metadata ?? null) as Database["public"]["Tables"]["cart_items"]["Insert"]["metadata"],
      updated_at: new Date().toISOString(),
    };

    const { data: saved, error: saveError } = await adminClient
      .from("cart_items")
      .upsert(upsertPayload, {
        onConflict: "user_id,organization_id,conference_id,product_id",
      })
      .select("*")
      .single();

    if (saveError || !saved) {
      return { success: false, error: saveError?.message ?? "Failed to save cart item" };
    }

    return { success: true, data: saved };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function updateCartItemQuantity(params: {
  cartItemId: string;
  quantity: number;
  metadata?: Record<string, unknown> | null;
}): Promise<CommerceSuccess<CartRow> | CommerceFailure> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  try {
    const adminClient = createAdminClient();
    const { data: item, error: itemError } = await adminClient
      .from("cart_items")
      .select("*")
      .eq("id", params.cartItemId)
      .single();

    if (itemError || !item) return { success: false, error: itemError?.message ?? "Cart item not found" };

    if (
      !isGlobalAdmin(auth.ctx.globalRole) &&
      item.user_id !== auth.ctx.userId &&
      !auth.ctx.activeOrgIds.includes(item.organization_id)
    ) {
      return { success: false, error: "Not authorized" };
    }

    if (params.quantity <= 0) {
      const { error: deleteError } = await adminClient
        .from("cart_items")
        .delete()
        .eq("id", item.id);
      if (deleteError) return { success: false, error: deleteError.message };
      return {
        success: true,
        data: { ...item, quantity: 0, updated_at: new Date().toISOString() },
      };
    }

    const { data: product, error: productError } = await adminClient
      .from("conference_products")
      .select("*")
      .eq("id", item.product_id)
      .single();

    if (productError || !product) {
      return { success: false, error: productError?.message ?? "Product not found" };
    }

    const metadata = params.metadata ?? (item.metadata as Record<string, unknown> | null);
    const metadataCheck = validatePartnerMeetingMetadata({
      slug: product.slug,
      quantity: params.quantity,
      metadata,
    });
    if (!metadataCheck.eligible) {
      return { success: false, code: "INVALID_METADATA", error: metadataCheck.errors.join(" ") };
    }

    const cartPreview = await getCartItemsWithProducts({
      conferenceId: item.conference_id,
      organizationId: item.organization_id,
      userId: item.user_id,
    });

    const cartForContext = cartPreview
      .filter((row) => row.id !== item.id)
      .map((row) => ({ slug: row.product.slug, quantity: row.quantity }));

    const artifacts = await loadEligibilityArtifacts({
      conferenceId: item.conference_id,
      organizationId: item.organization_id,
      userId: item.user_id,
      includeCartItems: cartForContext,
    });

    const context = buildEligibilityContext({
      conferenceId: item.conference_id,
      organizationId: item.organization_id,
      userId: item.user_id,
      organizationType: artifacts.orgTypeRaw,
      membershipStatus: artifacts.membershipStatus,
      registrationTypes: artifacts.registrationTypes,
      cartItems: cartForContext,
      paidOrderItems: artifacts.paidOrderItems,
    });
    const orgRegistrationCountForRules = getOrgRegistrationCountForRules(artifacts);
    const [rules, rulesEngine] = await Promise.all([
      loadProductRules(product.id),
      loadConferenceRulesEngine(item.conference_id),
    ]);
    const concurrencyWarning = getConcurrentCheckoutWarning({
      engine: rulesEngine,
      pendingOrderItems: artifacts.pendingOrderItems,
    });
    const eligibility = checkProductEligibility({
      product,
      quantity: params.quantity,
      rules,
      context,
    });
    const engineErrors = collectRulesEngineBlockErrors({
      engine: rulesEngine,
      trigger: "cart_item_add",
      context: {
        org_membership_status: artifacts.membershipStatus,
        org_type: artifacts.orgTypeRaw,
        user_is_authenticated: true,
        org_registration_count: orgRegistrationCountForRules,
        product_id: product.id,
        product_slug: product.slug,
      },
    });

    if (!eligibility.eligible || engineErrors.length > 0) {
      return {
        success: false,
        code: "INELIGIBLE",
        error: [...eligibility.errors, ...engineErrors, ...(concurrencyWarning ? [concurrencyWarning] : [])].join(
          " "
        ),
      };
    }

    const { data: updated, error: updateError } = await adminClient
      .from("cart_items")
      .update({
        quantity: params.quantity,
        metadata: (metadata ?? null) as Database["public"]["Tables"]["cart_items"]["Update"]["metadata"],
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id)
      .select("*")
      .single();

    if (updateError || !updated) {
      return { success: false, error: updateError?.message ?? "Failed to update cart item" };
    }

    return { success: true, data: updated };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function removeCartItem(cartItemId: string): Promise<CommerceSuccess<null> | CommerceFailure> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data: item, error: itemError } = await adminClient
    .from("cart_items")
    .select("id, user_id, organization_id")
    .eq("id", cartItemId)
    .single();

  if (itemError || !item) return { success: false, error: itemError?.message ?? "Cart item not found" };

  if (
    !isGlobalAdmin(auth.ctx.globalRole) &&
    item.user_id !== auth.ctx.userId &&
    !auth.ctx.activeOrgIds.includes(item.organization_id)
  ) {
    return { success: false, error: "Not authorized" };
  }

  const { error } = await adminClient.from("cart_items").delete().eq("id", cartItemId);
  if (error) return { success: false, error: error.message };

  return { success: true, data: null };
}

export async function clearCart(params: {
  conferenceId: string;
  organizationId: string;
}): Promise<CommerceSuccess<null> | CommerceFailure> {
  const authz = await assertUserCanManageOrg({ organizationId: params.organizationId });
  if (!authz.ok) return { success: false, error: authz.error };

  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from("cart_items")
    .delete()
    .eq("conference_id", params.conferenceId)
    .eq("organization_id", params.organizationId)
    .eq("user_id", authz.userId);

  if (error) return { success: false, error: error.message };
  return { success: true, data: null };
}

export async function createConferenceCheckout(
  input: CheckoutInput
): Promise<CommerceSuccess<{ checkoutUrl: string; orderId: string; checkoutSessionId: string }> | CommerceFailure> {
  const authz = await assertUserCanManageOrg({ organizationId: input.organizationId });
  if (!authz.ok) return { success: false, error: authz.error };

  try {
    const adminClient = createAdminClient();

    const cart = await getCartItemsWithProducts({
      conferenceId: input.conferenceId,
      organizationId: input.organizationId,
      userId: authz.userId,
    });

    if (cart.length === 0) {
      return { success: false, code: "EMPTY_CART", error: "Cart is empty." };
    }

    const artifacts = await loadEligibilityArtifacts({
      conferenceId: input.conferenceId,
      organizationId: input.organizationId,
      userId: authz.userId,
      includeCartItems: cart.map((item) => ({ slug: item.product.slug, quantity: item.quantity })),
    });

    const context = buildEligibilityContext({
      conferenceId: input.conferenceId,
      organizationId: input.organizationId,
      userId: authz.userId,
      organizationType: artifacts.orgTypeRaw,
      membershipStatus: artifacts.membershipStatus,
      registrationTypes: artifacts.registrationTypes,
      cartItems: cart.map((item) => ({ slug: item.product.slug, quantity: item.quantity })),
      paidOrderItems: artifacts.paidOrderItems,
    });

    const productIds = cart.map((item) => item.product.id);
    const rulesEngine = await loadConferenceRulesEngine(input.conferenceId);
    const { data: allCartRules, error: rulesError } = await adminClient
      .from("conference_product_rules")
      .select("*")
      .in("product_id", productIds)
      .order("display_order", { ascending: true });
    if (rulesError) throw new Error(rulesError.message);
    const cartRulesByProduct = new Map<string, typeof allCartRules>();
    for (const rule of allCartRules ?? []) {
      const existing = cartRulesByProduct.get(rule.product_id) ?? [];
      existing.push(rule);
      cartRulesByProduct.set(rule.product_id, existing);
    }

    const priceOverridesByProductId: Record<string, number> = {};
    const mixedUnitPricesByProductId: Record<string, number[]> = {};
    const baseRegistrationCount = getOrgRegistrationCountForRules(artifacts);
    let claimedRegistrationUnitsInCheckout = 0;
    const concurrencyWarning = getConcurrentCheckoutWarning({
      engine: rulesEngine,
      pendingOrderItems: artifacts.pendingOrderItems,
    });
    for (const item of cart) {
      const rules = cartRulesByProduct.get(item.product.id) ?? [];
      const eligibility = checkProductEligibility({
        product: item.product,
        quantity: item.quantity,
        rules,
        context,
      });
      if (!eligibility.eligible) {
        return {
          success: false,
          code: "INELIGIBLE",
          error: `${item.product.name}: ${[
            ...eligibility.errors,
            ...(concurrencyWarning ? [concurrencyWarning] : []),
          ].join(" ")}`,
        };
      }

      const unitPrices: number[] = [];
      for (let unitIndex = 0; unitIndex < item.quantity; unitIndex += 1) {
        const perUnitRegistrationCount = baseRegistrationCount + claimedRegistrationUnitsInCheckout;
        const perUnitActions = evaluateRulesEngineActionsForContext({
          engine: rulesEngine,
          trigger: "checkout_attempt",
          context: {
            org_membership_status: artifacts.membershipStatus,
            org_type: artifacts.orgTypeRaw,
            user_is_authenticated: true,
            org_registration_count: perUnitRegistrationCount,
            product_id: item.product.id,
            product_slug: item.product.slug,
          },
        });
        const perUnitBlocks = perUnitActions.filter((action) => action.type === "block_purchase");
        if (perUnitBlocks.length > 0) {
          const blockMessage = perUnitBlocks[0]?.message || "Purchase blocked by policy rule.";
          return {
            success: false,
            code: "INELIGIBLE",
            error: `${item.product.name}: ${[
              blockMessage,
              ...(concurrencyWarning ? [concurrencyWarning] : []),
            ].join(" ")}`,
          };
        }
        const effectiveUnitPrice = applyRulesEnginePricingActions(
          item.product.price_cents,
          perUnitActions
        );
        unitPrices.push(effectiveUnitPrice);
        if (isRegistrationProductSlug(item.product.slug)) {
          claimedRegistrationUnitsInCheckout += 1;
        }
      }

      const uniqueUnitPrices = Array.from(new Set(unitPrices));
      if (uniqueUnitPrices.length === 1) {
        const onlyPrice = uniqueUnitPrices[0];
        if (onlyPrice !== item.product.price_cents) {
          priceOverridesByProductId[item.product.id] = onlyPrice;
        }
      } else {
        mixedUnitPricesByProductId[item.product.id] = unitPrices;
      }

      const metadataCheck = validatePartnerMeetingMetadata({
        slug: item.product.slug,
        quantity: item.quantity,
        metadata: (item.metadata as Record<string, unknown> | null) ?? null,
      });
      if (!metadataCheck.eligible) {
        return {
          success: false,
          code: "INVALID_METADATA",
          error: `${item.product.name}: ${metadataCheck.errors.join(" ")}`,
        };
      }
    }

    const { data: conference, error: conferenceError } = await adminClient
      .from("conference_instances")
      .select("tax_rate_pct, stripe_tax_rate_id")
      .eq("id", input.conferenceId)
      .single();

    if (conferenceError || !conference) {
      return { success: false, error: conferenceError?.message ?? "Conference not found" };
    }

    const idempotencyKey =
      input.idempotencyKey ??
      `${input.conferenceId}:${input.organizationId}:${authz.userId}:${crypto.randomUUID()}`;

    const { data: order, error: orderError } = await adminClient.rpc(
      "create_conference_order_from_cart",
      {
        p_user_id: authz.userId,
        p_organization_id: input.organizationId,
        p_conference_id: input.conferenceId,
        p_checkout_idempotency_key: idempotencyKey,
        p_tax_rate_pct: Number(conference.tax_rate_pct ?? 0),
        p_currency: "CAD",
        p_price_overrides:
          Object.keys(priceOverridesByProductId).length > 0
            ? priceOverridesByProductId
            : null,
      }
    );

    if (orderError || !order) {
      return {
        success: false,
        code: orderError?.code,
        error: orderError?.message ?? "Failed to create pending conference order.",
      };
    }

    if (Object.keys(mixedUnitPricesByProductId).length > 0) {
      const { data: createdOrderItems, error: createdOrderItemsError } = await adminClient
        .from("conference_order_items")
        .select("id, order_id, product_id, quantity, metadata, conference_products!inner(is_taxable, is_tax_exempt)")
        .eq("order_id", order.id);
      if (createdOrderItemsError || !createdOrderItems) {
        return {
          success: false,
          error:
            createdOrderItemsError?.message ??
            "Failed to load order items for mixed-price checkout processing.",
        };
      }

      for (const row of createdOrderItems) {
        const unitPrices = mixedUnitPricesByProductId[row.product_id];
        if (!unitPrices) continue;
        if (unitPrices.length !== row.quantity) {
          return {
            success: false,
            error: "Unable to reconcile mixed-price checkout quantities. Please try again.",
          };
        }
        const grouped = groupUnitPrices(unitPrices);
        const productTax =
          (row as unknown as { conference_products?: { is_taxable?: boolean; is_tax_exempt?: boolean } })
            .conference_products ?? {};
        const isTaxable = Boolean(productTax.is_taxable) && !Boolean(productTax.is_tax_exempt);
        const replacementRows: Array<Database["public"]["Tables"]["conference_order_items"]["Insert"]> = grouped.map(
          (group) => {
            const lineSubtotal = group.quantity * group.unitPriceCents;
            const lineTax = isTaxable ? Math.round(lineSubtotal * (Number(conference.tax_rate_pct ?? 0) / 100)) : 0;
            return {
              order_id: order.id,
              product_id: row.product_id,
              quantity: group.quantity,
              unit_price_cents: group.unitPriceCents,
              tax_cents: lineTax,
              total_cents: lineSubtotal + lineTax,
              metadata: row.metadata ?? null,
            };
          }
        );

        const { error: deleteItemError } = await adminClient
          .from("conference_order_items")
          .delete()
          .eq("id", row.id);
        if (deleteItemError) {
          return {
            success: false,
            error: deleteItemError.message,
          };
        }
        const { error: insertReplacementError } = await adminClient
          .from("conference_order_items")
          .insert(replacementRows);
        if (insertReplacementError) {
          return {
            success: false,
            error: insertReplacementError.message,
          };
        }
      }

      const { data: refreshedRows, error: refreshedRowsError } = await adminClient
        .from("conference_order_items")
        .select("tax_cents, total_cents")
        .eq("order_id", order.id);
      if (refreshedRowsError || !refreshedRows) {
        return {
          success: false,
          error: refreshedRowsError?.message ?? "Failed to recalculate mixed-price order totals.",
        };
      }
      const recalculatedTaxCents = refreshedRows.reduce((sum, entry) => sum + (entry.tax_cents ?? 0), 0);
      const recalculatedTotalCents = refreshedRows.reduce((sum, entry) => sum + (entry.total_cents ?? 0), 0);
      const recalculatedSubtotalCents = recalculatedTotalCents - recalculatedTaxCents;
      const { error: orderTotalsError } = await adminClient
        .from("conference_orders")
        .update({
          subtotal_cents: recalculatedSubtotalCents,
          tax_cents: recalculatedTaxCents,
          total_cents: recalculatedTotalCents,
        })
        .eq("id", order.id);
      if (orderTotalsError) {
        return {
          success: false,
          error: orderTotalsError.message,
        };
      }
    }

    const { data: orderItems, error: orderItemsError } = await adminClient
      .from("conference_order_items")
      .select("quantity, unit_price_cents, conference_products!inner(name, is_taxable, is_tax_exempt)")
      .eq("order_id", order.id);

    if (orderItemsError || !orderItems || orderItems.length === 0) {
      return {
        success: false,
        error: orderItemsError?.message ?? "Order items not found for checkout session.",
      };
    }

    const lineItems = orderItems.map((item) => {
      const product = (
        item as unknown as {
          conference_products: { name: string; is_taxable: boolean; is_tax_exempt: boolean };
        }
      ).conference_products;
      const isTaxable = product.is_taxable && !product.is_tax_exempt;
      return {
        quantity: item.quantity,
        price_data: {
          currency: order.currency.toLowerCase(),
          unit_amount: item.unit_price_cents,
          product_data: {
            name: product.name,
          },
        },
        ...(conference.stripe_tax_rate_id && isTaxable
          ? { tax_rates: [conference.stripe_tax_rate_id] }
          : {}),
      };
    });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      line_items: lineItems,
      client_reference_id: order.id,
      payment_intent_data: {
        metadata: {
          checkout_kind: "conference",
          conference_id: input.conferenceId,
          conference_order_id: order.id,
          organization_id: input.organizationId,
          user_id: authz.userId,
        },
      },
      metadata: {
        checkout_kind: "conference",
        conference_id: input.conferenceId,
        conference_order_id: order.id,
        organization_id: input.organizationId,
        user_id: authz.userId,
      },
    });

    const { error: updateOrderError } = await adminClient
      .from("conference_orders")
      .update({ stripe_checkout_session_id: session.id })
      .eq("id", order.id);

    if (updateOrderError) {
      return { success: false, error: updateOrderError.message };
    }

    if (!session.url) {
      return { success: false, error: "Stripe checkout URL was not returned." };
    }

    await logAuditEventSafe({
      action: "conference_checkout_create",
      entityType: "conference_order",
      entityId: order.id,
      actorId: authz.userId,
      actorType: "user",
      details: {
        success: true,
        conferenceId: input.conferenceId,
        organizationId: input.organizationId,
        checkoutSessionId: session.id,
      },
    });

    return {
      success: true,
      data: {
        checkoutUrl: session.url,
        orderId: order.id,
        checkoutSessionId: session.id,
      },
    };
  } catch (error) {
    await logAuditEventSafe({
      action: "conference_checkout_create",
      entityType: "conference_order",
      actorId: authz.userId,
      actorType: "user",
      details: {
        success: false,
        conferenceId: input.conferenceId,
        organizationId: input.organizationId,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function listConferenceOrdersForOrganization(params: {
  conferenceId: string;
  organizationId: string;
}): Promise<CommerceSuccess<OrderRow[]> | CommerceFailure> {
  const authz = await assertUserCanManageOrg({ organizationId: params.organizationId });
  if (!authz.ok) return { success: false, error: authz.error };

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("conference_orders")
    .select("*")
    .eq("conference_id", params.conferenceId)
    .eq("organization_id", params.organizationId)
    .order("created_at", { ascending: false });

  if (error) return { success: false, error: error.message };
  return { success: true, data: data ?? [] };
}

export async function getConferenceOrderDetails(orderId: string): Promise<
  | CommerceSuccess<{
      order: OrderRow;
      items: Array<
        OrderItemRow & {
          product_name: string | null;
          product_slug: string | null;
        }
      >;
    }>
  | CommerceFailure
> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data: order, error: orderError } = await adminClient
    .from("conference_orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (orderError || !order) {
    return { success: false, error: orderError?.message ?? "Order not found." };
  }

  const canRead =
    isGlobalAdmin(auth.ctx.globalRole) ||
    order.user_id === auth.ctx.userId ||
    auth.ctx.activeOrgIds.includes(order.organization_id);
  if (!canRead) return { success: false, error: "Not authorized" };

  const { data: items, error: itemsError } = await adminClient
    .from("conference_order_items")
    .select("*, conference_products(name, slug)")
    .eq("order_id", orderId);

  if (itemsError) return { success: false, error: itemsError.message };

  const normalizedItems = (items ?? []).map((item) => ({
    ...(item as unknown as OrderItemRow),
    product_name:
      (item as unknown as { conference_products?: { name?: string } }).conference_products?.name ??
      null,
    product_slug:
      (item as unknown as { conference_products?: { slug?: string } }).conference_products?.slug ??
      null,
  }));

  return { success: true, data: { order, items: normalizedItems } };
}

export async function calculateConferenceRefund(
  orderId: string
): Promise<CommerceSuccess<{ refundPct: number; refundAmountCents: number; eligible: boolean; daysUntilConference: number }> | CommerceFailure> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data: order, error: orderError } = await adminClient
    .from("conference_orders")
    .select("id, conference_id, organization_id, user_id, status, total_cents")
    .eq("id", orderId)
    .single();

  if (orderError || !order) return { success: false, error: orderError?.message ?? "Order not found" };

  const canRead =
    isGlobalAdmin(auth.ctx.globalRole) ||
    order.user_id === auth.ctx.userId ||
    auth.ctx.activeOrgIds.includes(order.organization_id);

  if (!canRead) return { success: false, error: "Not authorized" };

  if (!["paid", "partially_refunded"].includes(order.status)) {
    return {
      success: true,
      data: { refundPct: 0, refundAmountCents: 0, eligible: false, daysUntilConference: -1 },
    };
  }

  const { data: conference, error: conferenceError } = await adminClient
    .from("conference_instances")
    .select("start_date")
    .eq("id", order.conference_id)
    .single();

  if (conferenceError || !conference?.start_date) {
    return { success: false, error: conferenceError?.message ?? "Conference date unavailable" };
  }

  const startDate = new Date(`${conference.start_date}T00:00:00Z`);
  const now = new Date();
  const daysUntilConference = Math.floor((startDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  let refundPct = 0;
  if (daysUntilConference > 90) refundPct = 100;
  else if (daysUntilConference >= 30) refundPct = 50;

  const refundAmountCents = Math.round(order.total_cents * (refundPct / 100));

  return {
    success: true,
    data: {
      refundPct,
      refundAmountCents,
      eligible: refundPct > 0,
      daysUntilConference,
    },
  };
}

export async function requestConferenceRefund(
  orderId: string,
  overrideAmountCents?: number,
  options?: {
    allowManagedOverride?: boolean;
    overrideReason?: string;
  }
): Promise<
  CommerceSuccess<{
    orderId: string;
    refundAmountCents: number;
    refundPct: number;
    totalRefundedCents: number;
    stripeRefundId: string;
  }> | CommerceFailure
> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data: order, error: orderError } = await adminClient
    .from("conference_orders")
    .select("id, organization_id, user_id, stripe_payment_intent_id, total_cents, refund_amount_cents")
    .eq("id", orderId)
    .single();

  if (orderError || !order) {
    return { success: false, error: orderError?.message ?? "Order not found." };
  }

  const canManage =
    isGlobalAdmin(auth.ctx.globalRole) ||
    order.user_id === auth.ctx.userId ||
    auth.ctx.activeOrgIds.includes(order.organization_id);
  if (!canManage) return { success: false, error: "Not authorized" };

  const isAdmin = isGlobalAdmin(auth.ctx.globalRole);
  const alreadyRefunded = order.refund_amount_cents ?? 0;
  const remainingRefundable = Math.max(0, order.total_cents - alreadyRefunded);
  if (remainingRefundable <= 0) {
    return {
      success: false,
      error: "Order has already been fully refunded.",
      code: "REFUND_NOT_ELIGIBLE",
    };
  }

  const refundQuote = await calculateConferenceRefund(orderId);
  if (!refundQuote.success) return refundQuote;
  if (!refundQuote.data.eligible && !isAdmin) {
    return {
      success: false,
      error: "Order is not eligible for a refund under current policy.",
      code: "REFUND_NOT_ELIGIBLE",
    };
  }

  let requestedRefundAmount = refundQuote.data.refundAmountCents;
  if (typeof overrideAmountCents === "number") {
    const managedOverrideAllowed = Boolean(options?.allowManagedOverride);
    if (!isAdmin && !managedOverrideAllowed) {
      return {
        success: false,
        error: "Only admins can override refund amounts.",
        code: "REFUND_OVERRIDE_FORBIDDEN",
      };
    }
    if (!Number.isInteger(overrideAmountCents) || overrideAmountCents <= 0) {
      return {
        success: false,
        error: "Override refund amount must be a positive integer (cents).",
        code: "REFUND_OVERRIDE_INVALID",
      };
    }
    requestedRefundAmount = overrideAmountCents;
  }

  if (requestedRefundAmount <= 0) {
    return {
      success: false,
      error: "Refund amount must be greater than zero.",
      code: "REFUND_NOT_ELIGIBLE",
    };
  }

  if (requestedRefundAmount > remainingRefundable) {
    return {
      success: false,
      error: `Refund exceeds remaining refundable amount (${remainingRefundable} cents).`,
      code: "REFUND_OVERRIDE_INVALID",
    };
  }

  if (!order.stripe_payment_intent_id) {
    return {
      success: false,
      error: "Stripe payment intent is missing for this order.",
      code: "STRIPE_REFERENCE_MISSING",
    };
  }

  try {
    const stripeRefund = await stripe.refunds.create({
      payment_intent: order.stripe_payment_intent_id,
      amount: requestedRefundAmount,
      reason: "requested_by_customer",
      metadata: {
        checkout_kind: "conference",
        conference_order_id: orderId,
      },
    });

    const { error: refundUpdateError } = await adminClient.rpc("process_conference_order_refund", {
      p_order_id: orderId,
      p_refund_amount_cents: alreadyRefunded + requestedRefundAmount,
    });

    if (refundUpdateError) {
      await logAuditEventSafe({
        action: "conference_refund_request",
        entityType: "conference_order",
        entityId: orderId,
        actorId: auth.ctx.userId,
        actorType: "user",
        details: {
          success: false,
          reason: "refund_update_failed",
          error: refundUpdateError.message,
          requestedRefundAmount,
        },
      });
      return { success: false, error: refundUpdateError.message };
    }

    await logAuditEventSafe({
      action: "conference_refund_request",
      entityType: "conference_order",
      entityId: orderId,
      actorId: auth.ctx.userId,
      actorType: "user",
      details: {
        success: true,
        requestedRefundAmount,
        totalRefundedCents: alreadyRefunded + requestedRefundAmount,
        stripeRefundId: stripeRefund.id,
        overrideReason: options?.overrideReason ?? null,
        usedManagedOverride: Boolean(
          typeof overrideAmountCents === "number" &&
            !isAdmin &&
            options?.allowManagedOverride
        ),
      },
    });

    return {
      success: true,
      data: {
        orderId,
        refundAmountCents: requestedRefundAmount,
        refundPct: refundQuote.data.refundPct,
        totalRefundedCents: alreadyRefunded + requestedRefundAmount,
        stripeRefundId: stripeRefund.id,
      },
    };
  } catch (error) {
    await logAuditEventSafe({
      action: "conference_refund_request",
      entityType: "conference_order",
      entityId: orderId,
      actorId: auth.ctx.userId,
      actorType: "user",
      details: {
        success: false,
        reason: "stripe_refund_failed",
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function getConferenceReceiptUrl(
  orderId: string
): Promise<CommerceSuccess<{ url: string | null }> | CommerceFailure> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data: order, error: orderError } = await adminClient
    .from("conference_orders")
    .select("id, organization_id, user_id, stripe_payment_intent_id")
    .eq("id", orderId)
    .single();

  if (orderError || !order) {
    return { success: false, error: orderError?.message ?? "Order not found." };
  }

  const canRead =
    isGlobalAdmin(auth.ctx.globalRole) ||
    order.user_id === auth.ctx.userId ||
    auth.ctx.activeOrgIds.includes(order.organization_id);
  if (!canRead) return { success: false, error: "Not authorized" };

  if (!order.stripe_payment_intent_id) {
    return { success: true, data: { url: null } };
  }

  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(order.stripe_payment_intent_id, {
      expand: ["latest_charge"],
    });

    const latestCharge = paymentIntent.latest_charge;
    if (!latestCharge || typeof latestCharge === "string") {
      return { success: true, data: { url: null } };
    }

    return { success: true, data: { url: latestCharge.receipt_url ?? null } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function createWishlistIntent(params: {
  conferenceId: string;
  organizationId: string;
  productId: string;
  quantity?: number;
  metadata?: Record<string, unknown> | null;
}): Promise<CommerceSuccess<Database["public"]["Tables"]["wishlist_intents"]["Row"]> | CommerceFailure> {
  const authz = await assertUserCanManageOrg({ organizationId: params.organizationId });
  if (!authz.ok) return { success: false, error: authz.error };

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("wishlist_intents")
    .insert({
      conference_id: params.conferenceId,
      organization_id: params.organizationId,
      user_id: authz.userId,
      product_id: params.productId,
      quantity: Math.max(1, params.quantity ?? 1),
      status: "wishlisted",
      metadata: (params.metadata ?? null) as Database["public"]["Tables"]["wishlist_intents"]["Insert"]["metadata"],
    })
    .select("*")
    .single();

  if (error || !data) return { success: false, error: error?.message ?? "Failed to create wishlist intent" };
  await logAuditEventSafe({
    action: "wishlist_intent_create",
    entityType: "wishlist_intent",
    entityId: data.id,
    actorId: authz.userId,
    actorType: "user",
    details: {
      success: true,
      conferenceId: params.conferenceId,
      organizationId: params.organizationId,
      productId: params.productId,
      quantity: Math.max(1, params.quantity ?? 1),
    },
  });
  return { success: true, data };
}

export async function listWishlistIntentsForConference(params: {
  conferenceId: string;
  status?: string;
}): Promise<
  CommerceSuccess<
    Array<
      Database["public"]["Tables"]["wishlist_intents"]["Row"] & {
        organization_name: string | null;
        product_name: string | null;
      }
    >
  > | CommerceFailure
> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  let query = adminClient
    .from("wishlist_intents")
    .select(
      "*, organizations!inner(name), conference_products!inner(name)"
    )
    .eq("conference_id", params.conferenceId)
    .order("wishlisted_at", { ascending: true })
    .order("id", { ascending: true });

  if (params.status) {
    query = query.eq("status", params.status);
  }

  const { data, error } = await query;
  if (error) return { success: false, error: error.message };

  const normalized = (data ?? []).map((row) => ({
    ...(row as unknown as Database["public"]["Tables"]["wishlist_intents"]["Row"]),
    organization_name:
      (row as unknown as { organizations?: { name?: string } }).organizations?.name ?? null,
    product_name:
      (row as unknown as { conference_products?: { name?: string } }).conference_products?.name ??
      null,
  }));

  return { success: true, data: normalized };
}

export async function setWishlistBoardDecision(params: {
  intentId: string;
  decision: "approve" | "decline";
}): Promise<
  CommerceSuccess<Database["public"]["Tables"]["wishlist_intents"]["Row"]> | CommerceFailure
> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const status = params.decision === "approve" ? "board_approved" : "board_declined";

  const { data, error } = await adminClient
    .from("wishlist_intents")
    .update({
      status,
      board_decided_at: new Date().toISOString(),
    })
    .eq("id", params.intentId)
    .select("*")
    .single();

  if (error || !data) {
    await logAuditEventSafe({
      action: "wishlist_board_decision",
      entityType: "wishlist_intent",
      entityId: params.intentId,
      actorId: auth.ctx.userId,
      actorType: "user",
      details: {
        success: false,
        decision: params.decision,
        error: error?.message ?? "Failed to update wishlist decision.",
      },
    });
    return { success: false, error: error?.message ?? "Failed to update wishlist decision." };
  }

  await logAuditEventSafe({
    action: "wishlist_board_decision",
    entityType: "wishlist_intent",
    entityId: data.id,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: {
      success: true,
      conferenceId: data.conference_id,
      decision: params.decision,
    },
  });

  return { success: true, data };
}

export async function updateWishlistIntentStatus(params: {
  intentId: string;
  nextStatus: WishlistStatus;
}): Promise<CommerceSuccess<WishlistRow> | CommerceFailure> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data: current, error: currentError } = await adminClient
    .from("wishlist_intents")
    .select("*")
    .eq("id", params.intentId)
    .single();

  if (currentError || !current) {
    return { success: false, error: currentError?.message ?? "Wishlist intent not found." };
  }

  const fromStatus = current.status as WishlistStatus;
  const allowed = WISHLIST_TRANSITIONS[fromStatus] ?? [];
  if (!allowed.includes(params.nextStatus)) {
    return {
      success: false,
      error: `Invalid wishlist transition: ${fromStatus} -> ${params.nextStatus}`,
    };
  }

  const nowIso = new Date().toISOString();
  const update: Database["public"]["Tables"]["wishlist_intents"]["Update"] = {
    status: params.nextStatus,
  };

  if (params.nextStatus === "board_approved" || params.nextStatus === "board_declined") {
    update.board_decided_at = nowIso;
  }
  if (
    params.nextStatus === "billing_pending" ||
    params.nextStatus === "billing_paid" ||
    params.nextStatus === "billing_failed_retryable" ||
    params.nextStatus === "billing_failed_final"
  ) {
    update.billing_attempted_at = nowIso;
  }
  if (params.nextStatus === "billing_paid") {
    update.billing_paid_at = nowIso;
  }
  if (params.nextStatus === "reservation_expired") {
    update.expires_at = nowIso;
  }

  const { data: updated, error: updateError } = await adminClient
    .from("wishlist_intents")
    .update(update)
    .eq("id", params.intentId)
    .select("*")
    .single();

  if (updateError || !updated) {
    await logAuditEventSafe({
      action: "wishlist_status_update",
      entityType: "wishlist_intent",
      entityId: params.intentId,
      actorId: auth.ctx.userId,
      actorType: "user",
      details: {
        success: false,
        fromStatus,
        nextStatus: params.nextStatus,
        error: updateError?.message ?? "Failed to update wishlist status.",
      },
    });
    return { success: false, error: updateError?.message ?? "Failed to update wishlist status." };
  }

  await logAuditEventSafe({
    action: "wishlist_status_update",
    entityType: "wishlist_intent",
    entityId: updated.id,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: {
      success: true,
      conferenceId: updated.conference_id,
      fromStatus,
      nextStatus: params.nextStatus,
    },
  });

  return { success: true, data: updated };
}

export async function listBillingRunsForConference(params: {
  conferenceId: string;
  limit?: number;
}): Promise<
  CommerceSuccess<
    Array<
      Database["public"]["Tables"]["billing_runs"]["Row"] & {
        triggered_by_email: string | null;
      }
    >
  > | CommerceFailure
> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  let query = adminClient
    .from("billing_runs")
    .select("*, profiles(email)")
    .eq("conference_id", params.conferenceId)
    .order("started_at", { ascending: false });

  if (params.limit) query = query.limit(params.limit);

  const { data, error } = await query;
  if (error) return { success: false, error: error.message };

  const normalized = (data ?? []).map((row) => ({
    ...(row as unknown as Database["public"]["Tables"]["billing_runs"]["Row"]),
    triggered_by_email:
      (row as unknown as { profiles?: { email?: string } }).profiles?.email ?? null,
  }));

  return { success: true, data: normalized };
}

export async function listWishlistBillingAttemptsForConference(params: {
  conferenceId: string;
  billingRunId?: string;
  limit?: number;
}): Promise<
  CommerceSuccess<
    Array<
      Database["public"]["Tables"]["wishlist_billing_attempts"]["Row"] & {
        organization_name: string | null;
        product_name: string | null;
      }
    >
  > | CommerceFailure
> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  let query = adminClient
    .from("wishlist_billing_attempts")
    .select("*, organizations(name), conference_products(name)")
    .eq("conference_id", params.conferenceId)
    .order("attempted_at", { ascending: false });

  if (params.billingRunId) {
    query = query.eq("billing_run_id", params.billingRunId);
  }
  if (params.limit) {
    query = query.limit(params.limit);
  }

  const { data, error } = await query;
  if (error) return { success: false, error: error.message };

  const normalized = (data ?? []).map((row) => ({
    ...(row as unknown as Database["public"]["Tables"]["wishlist_billing_attempts"]["Row"]),
    organization_name:
      (row as unknown as { organizations?: { name?: string } }).organizations?.name ?? null,
    product_name:
      (row as unknown as { conference_products?: { name?: string } }).conference_products?.name ??
      null,
  }));

  return { success: true, data: normalized };
}

export async function runWishlistBilling(conferenceId: string): Promise<CommerceSuccess<{ billingRunId: string; processed: number }> | CommerceFailure> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  const { data: billingRun, error: billingRunError } = await adminClient
    .from("billing_runs")
    .insert({
      conference_id: conferenceId,
      status: "running",
      started_at: new Date().toISOString(),
      triggered_by: auth.ctx.userId,
      metadata: { mode: "wishlist_fifo" },
    })
    .select("*")
    .single();

  if (billingRunError || !billingRun) {
    await logAuditEventSafe({
      action: "wishlist_billing_run",
      entityType: "billing_run",
      actorId: auth.ctx.userId,
      actorType: "user",
      details: {
        success: false,
        conferenceId,
        reason: "start_failed",
        error: billingRunError?.message ?? "Failed to start billing run",
      },
    });
    return { success: false, error: billingRunError?.message ?? "Failed to start billing run" };
  }

  // Fetch conference tax info for computing tax-inclusive amounts
  const { data: conferenceForTax, error: confTaxError } = await adminClient
    .from("conference_instances")
    .select("tax_rate_pct")
    .eq("id", conferenceId)
    .single();

  if (confTaxError || !conferenceForTax) {
    await adminClient
      .from("billing_runs")
      .update({ status: "failed", completed_at: new Date().toISOString() })
      .eq("id", billingRun.id);
    await logAuditEventSafe({
      action: "wishlist_billing_run",
      entityType: "billing_run",
      entityId: billingRun.id,
      actorId: auth.ctx.userId,
      actorType: "user",
      details: {
        success: false,
        conferenceId,
        reason: "conference_not_found",
        error: confTaxError?.message ?? "Conference not found",
      },
    });
    return { success: false, error: confTaxError?.message ?? "Conference not found" };
  }

  const wishlistTaxRate = Number(conferenceForTax.tax_rate_pct ?? 0);

  // Load policy-configurable retry/backoff (fall back to code defaults)
  let maxRetryAttempts = WISHLIST_MAX_RETRY_ATTEMPTS_DEFAULT;
  let retryBackoffMinutes = WISHLIST_RETRY_BACKOFF_MINUTES_DEFAULT;
  try {
    const retryPolicies = await getEffectivePolicies([
      "billing.wishlist_max_retry_attempts",
      "billing.wishlist_retry_backoff_minutes",
    ]);
    if (typeof retryPolicies["billing.wishlist_max_retry_attempts"] === "number") {
      maxRetryAttempts = retryPolicies["billing.wishlist_max_retry_attempts"] as number;
    }
    if (typeof retryPolicies["billing.wishlist_retry_backoff_minutes"] === "number") {
      retryBackoffMinutes = retryPolicies["billing.wishlist_retry_backoff_minutes"] as number;
    }
  } catch {
    // Policy keys may not exist yet; use defaults silently
  }

  const { data: intents, error: intentsError } = await adminClient
    .from("wishlist_intents")
    .select("id, status, metadata, quantity, organization_id, stripe_payment_method_id, product_id, conference_products!inner(price_cents, currency, is_taxable, is_tax_exempt)")
    .eq("conference_id", conferenceId)
    .in("status", ["board_approved", "billing_failed_retryable"])
    .order("wishlisted_at", { ascending: true })
    .order("id", { ascending: true });

  if (intentsError) {
    await adminClient
      .from("billing_runs")
      .update({ status: "failed", completed_at: new Date().toISOString() })
      .eq("id", billingRun.id);
    await logAuditEventSafe({
      action: "wishlist_billing_run",
      entityType: "billing_run",
      entityId: billingRun.id,
      actorId: auth.ctx.userId,
      actorType: "user",
      details: {
        success: false,
        conferenceId,
        reason: "load_intents_failed",
        error: intentsError.message,
      },
    });
    return { success: false, error: intentsError.message };
  }

  const now = new Date();
  let processed = 0;
  let successful = 0;
  let failed = 0;
  let skippedBackoff = 0;
  let skippedMaxAttempts = 0;
  const logAttempt = async (params: {
    wishlistIntentId: string;
    organizationId: string;
    productId: string;
    attemptNumber: number;
    amountCents: number;
    currency: string;
    status: "attempted" | "succeeded" | "failed" | "skipped";
    stripePaymentIntentId?: string | null;
    stripeChargeId?: string | null;
    stripeErrorCode?: string | null;
    stripeDeclineCode?: string | null;
    errorMessage?: string | null;
    metadata?: Record<string, unknown>;
    attemptedAt?: string;
    completedAt?: string;
  }) => {
    await adminClient.from("wishlist_billing_attempts").insert({
      conference_id: conferenceId,
      billing_run_id: billingRun.id,
      wishlist_intent_id: params.wishlistIntentId,
      organization_id: params.organizationId,
      product_id: params.productId,
      attempt_number: params.attemptNumber,
      amount_cents: params.amountCents,
      currency: params.currency || "CAD",
      status: params.status,
      stripe_payment_intent_id: params.stripePaymentIntentId ?? null,
      stripe_charge_id: params.stripeChargeId ?? null,
      stripe_error_code: params.stripeErrorCode ?? null,
      stripe_decline_code: params.stripeDeclineCode ?? null,
      error_message: params.errorMessage ?? null,
      metadata: (params.metadata ?? null) as Database["public"]["Tables"]["wishlist_billing_attempts"]["Insert"]["metadata"],
      attempted_at: params.attemptedAt ?? new Date().toISOString(),
      completed_at: params.completedAt ?? new Date().toISOString(),
    });
  };

  for (const intent of intents ?? []) {
    const billingMeta = parseBillingMetadata(intent.metadata);
    const attemptCount = Math.max(0, billingMeta.billing_attempt_count ?? 0);
    const lastAttemptAt = billingMeta.last_billing_attempt_at
      ? new Date(billingMeta.last_billing_attempt_at)
      : null;
    const minutesSinceLastAttempt = lastAttemptAt
      ? (now.getTime() - lastAttemptAt.getTime()) / (1000 * 60)
      : Number.POSITIVE_INFINITY;

    if (attemptCount >= maxRetryAttempts) {
      skippedMaxAttempts += 1;
      await logAttempt({
        wishlistIntentId: intent.id,
        organizationId: intent.organization_id,
        productId: intent.product_id,
        attemptNumber: attemptCount,
        amountCents: 0,
        currency: "CAD",
        status: "skipped",
        errorMessage: "Max retry attempts reached.",
        metadata: { reason: "max_attempts" },
      });
      await adminClient
        .from("wishlist_intents")
        .update({
          status: "billing_failed_final",
          metadata: {
            ...(intent.metadata && typeof intent.metadata === "object" && !Array.isArray(intent.metadata)
              ? intent.metadata
              : {}),
            billing_attempt_count: attemptCount,
            last_billing_error: "Max retry attempts reached.",
            last_billing_attempt_at: billingMeta.last_billing_attempt_at ?? null,
          },
        })
        .eq("id", intent.id);
      continue;
    }

    if (
      intent.status === "billing_failed_retryable" &&
      Number.isFinite(minutesSinceLastAttempt) &&
      minutesSinceLastAttempt < retryBackoffMinutes
    ) {
      skippedBackoff += 1;
      await logAttempt({
        wishlistIntentId: intent.id,
        organizationId: intent.organization_id,
        productId: intent.product_id,
        attemptNumber: attemptCount,
        amountCents: 0,
        currency: "CAD",
        status: "skipped",
        errorMessage: `Backoff active (${Math.floor(minutesSinceLastAttempt)} min since last attempt).`,
        metadata: { reason: "retry_backoff" },
      });
      continue;
    }

    processed += 1;
    const product = (
      intent as unknown as {
        conference_products: {
          price_cents: number;
          currency: string;
          is_taxable: boolean;
          is_tax_exempt: boolean;
        };
      }
    ).conference_products;
    const priceCents = product.price_cents;
    const currency = product.currency;
    const subtotal = priceCents * intent.quantity;
    const isTaxable = product.is_taxable && !product.is_tax_exempt;
    const lineTax = isTaxable ? Math.round(subtotal * (wishlistTaxRate / 100)) : 0;
    const amount = subtotal + lineTax;
    const attemptedAt = new Date().toISOString();
    const nextAttemptCount = attemptCount + 1;

    if (!intent.stripe_payment_method_id) {
      failed += 1;
      await logAttempt({
        wishlistIntentId: intent.id,
        organizationId: intent.organization_id,
        productId: intent.product_id,
        attemptNumber: nextAttemptCount,
        amountCents: amount,
        currency: currency || "CAD",
        status: "failed",
        errorMessage: "No payment method on file.",
      });
      await adminClient
        .from("wishlist_intents")
        .update({
          status:
            nextAttemptCount >= maxRetryAttempts
              ? "billing_failed_final"
              : "billing_failed_retryable",
          billing_attempted_at: attemptedAt,
          metadata: {
            ...(intent.metadata && typeof intent.metadata === "object" && !Array.isArray(intent.metadata)
              ? intent.metadata
              : {}),
            billing_attempt_count: nextAttemptCount,
            last_billing_attempt_at: attemptedAt,
            last_billing_error: "No payment method on file.",
          },
        })
        .eq("id", intent.id);
      continue;
    }

    try {
      const customerId = await ensureStripeCustomer(intent.organization_id);
      await logAttempt({
        wishlistIntentId: intent.id,
        organizationId: intent.organization_id,
        productId: intent.product_id,
        attemptNumber: nextAttemptCount,
        amountCents: amount,
        currency: currency || "CAD",
        status: "attempted",
        metadata: { customer_id: customerId },
      });
      const paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency: (currency || "CAD").toLowerCase(),
        customer: customerId,
        payment_method: intent.stripe_payment_method_id,
        confirm: true,
        off_session: true,
        metadata: {
          checkout_kind: "conference_wishlist",
          conference_id: conferenceId,
          wishlist_intent_id: intent.id,
          organization_id: intent.organization_id,
          product_id: intent.product_id,
          billing_run_id: billingRun.id,
          attempt_number: String(nextAttemptCount),
        },
      });

      if (paymentIntent.status === "succeeded" || paymentIntent.status === "processing") {
        successful += 1;
        const latestCharge =
          typeof paymentIntent.latest_charge === "string"
            ? paymentIntent.latest_charge
            : paymentIntent.latest_charge?.id ?? null;
        await logAttempt({
          wishlistIntentId: intent.id,
          organizationId: intent.organization_id,
          productId: intent.product_id,
          attemptNumber: nextAttemptCount,
          amountCents: amount,
          currency: currency || "CAD",
          status: "succeeded",
          stripePaymentIntentId: paymentIntent.id,
          stripeChargeId: latestCharge,
          metadata: { payment_status: paymentIntent.status },
        });
        await adminClient
          .from("wishlist_intents")
          .update({
            status: "billing_paid",
            billing_attempted_at: attemptedAt,
            billing_paid_at: new Date().toISOString(),
            metadata: {
              ...(intent.metadata && typeof intent.metadata === "object" && !Array.isArray(intent.metadata)
                ? intent.metadata
                : {}),
              billing_attempt_count: nextAttemptCount,
              last_billing_attempt_at: attemptedAt,
              last_billing_error: null,
              last_billing_payment_intent_id: paymentIntent.id,
            },
          })
          .eq("id", intent.id);
      } else {
        failed += 1;
        await logAttempt({
          wishlistIntentId: intent.id,
          organizationId: intent.organization_id,
          productId: intent.product_id,
          attemptNumber: nextAttemptCount,
          amountCents: amount,
          currency: currency || "CAD",
          status: "failed",
          stripePaymentIntentId: paymentIntent.id,
          errorMessage: `Unexpected payment intent status: ${paymentIntent.status}`,
        });
        await adminClient
          .from("wishlist_intents")
          .update({
            status:
              nextAttemptCount >= maxRetryAttempts
                ? "billing_failed_final"
                : "billing_failed_retryable",
            billing_attempted_at: attemptedAt,
            metadata: {
              ...(intent.metadata && typeof intent.metadata === "object" && !Array.isArray(intent.metadata)
                ? intent.metadata
                : {}),
              billing_attempt_count: nextAttemptCount,
              last_billing_attempt_at: attemptedAt,
              last_billing_error: `Unexpected payment intent status: ${paymentIntent.status}`,
            },
          })
          .eq("id", intent.id);
      }
    } catch (error) {
      failed += 1;
      const finalFailure = isFinalBillingFailure(error) || nextAttemptCount >= maxRetryAttempts;
      const details = stripeErrorDetails(error);
      await logAttempt({
        wishlistIntentId: intent.id,
        organizationId: intent.organization_id,
        productId: intent.product_id,
        attemptNumber: nextAttemptCount,
        amountCents: amount,
        currency: currency || "CAD",
        status: "failed",
        stripePaymentIntentId: details.paymentIntentId,
        stripeErrorCode: details.errorCode,
        stripeDeclineCode: details.declineCode,
        errorMessage: details.message,
        metadata: { final_failure: finalFailure },
      });
      await adminClient
        .from("wishlist_intents")
        .update({
          status: finalFailure ? "billing_failed_final" : "billing_failed_retryable",
          billing_attempted_at: attemptedAt,
          metadata: {
            ...(intent.metadata && typeof intent.metadata === "object" && !Array.isArray(intent.metadata)
              ? intent.metadata
              : {}),
            billing_attempt_count: nextAttemptCount,
            last_billing_attempt_at: attemptedAt,
            last_billing_error: details.message,
          },
        })
        .eq("id", intent.id);
    }
  }

  await adminClient
    .from("billing_runs")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      total_items: processed,
      failed_items: failed,
      successful_items: successful,
      metadata: {
        mode: "wishlist_fifo",
        max_retry_attempts: maxRetryAttempts,
        retry_backoff_minutes: retryBackoffMinutes,
        skipped_backoff: skippedBackoff,
        skipped_max_attempts: skippedMaxAttempts,
      },
    })
    .eq("id", billingRun.id);

  await logAuditEventSafe({
    action: "wishlist_billing_run",
    entityType: "billing_run",
    entityId: billingRun.id,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: {
      success: true,
      conferenceId,
      processed,
      successful,
      failed,
      skippedBackoff,
      skippedMaxAttempts,
    },
  });

  return {
    success: true,
    data: {
      billingRunId: billingRun.id,
      processed,
    },
  };
}

export async function getSchedulerEligibleConferenceRegistrations(
  conferenceId: string
): Promise<CommerceSuccess<SchedulerEligibleRecord[]> | CommerceFailure> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data: orderItems, error: orderItemsError } = await adminClient
    .from("conference_order_items")
    .select("id, order_id, metadata, conference_orders!inner(id, conference_id, status), conference_products!inner(slug)")
    .eq("conference_orders.conference_id", conferenceId)
    .eq("conference_orders.status", "paid");

  if (orderItemsError) {
    return { success: false, error: orderItemsError.message };
  }

  const records: SchedulerEligibleRecord[] = [];
  for (const item of orderItems ?? []) {
    const slug = (item as unknown as { conference_products: { slug: string } }).conference_products.slug;
    const role = mapSchedulerEligibleRoleForProductSlug(slug);
    if (!role) continue;

    const metadata = (item.metadata ?? null) as Record<string, unknown> | null;
    const registrationIds = extractRegistrationIdsFromMetadata(metadata);
    for (const registrationId of registrationIds) {
      records.push({
        role,
        registrationId,
        orderId: item.order_id,
        orderItemId: item.id,
        productSlug: slug,
      });
    }
  }

  return { success: true, data: records };
}
