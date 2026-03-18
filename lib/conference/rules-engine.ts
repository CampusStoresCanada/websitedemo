export type RulesEngineTrigger =
  | "product_catalog_load"
  | "cart_item_add"
  | "checkout_attempt"
  | "registration_submit"
  | "travel_intake_save";

export type RulesEngineScope = "commerce" | "travel" | "access";

export type RulesEngineField =
  | "org.membership_status"
  | "org.type"
  | "org.registration_count"
  | "org.has_any_registration"
  | "user.is_authenticated"
  | "product.id"
  | "product.slug";

export type RulesEngineOperator =
  | "equals"
  | "not_equals"
  | "gte"
  | "lte"
  | "includes"
  | "is_true"
  | "is_false";

export type RulesEngineModifier = "none" | "first_match_only";

export type RulesEngineValue = string | number | boolean;

export type RulesEngineConditionClause = {
  id: string;
  kind: "clause";
  field: RulesEngineField;
  op: RulesEngineOperator;
  value?: RulesEngineValue;
};

export type RulesEngineConditionGroup = {
  id: string;
  kind: "group";
  operator: "and" | "or";
  children: RulesEngineConditionNode[];
};

export type RulesEngineConditionNode =
  | RulesEngineConditionClause
  | RulesEngineConditionGroup;

export type RulesEngineAction =
  | {
      id: string;
      type: "set_product_visibility";
      target_product_id?: string;
      target_product_slug?: string;
      visible: boolean;
      reason?: string;
    }
  | {
      id: string;
      type: "block_purchase";
      target_product_id?: string;
      target_product_slug?: string;
      message: string;
    }
  | {
      id: string;
      type: "apply_price_override_cents";
      target_product_id?: string;
      target_product_slug?: string;
      amount_cents: number;
      reason?: string;
    }
  | {
      id: string;
      type: "apply_discount_percent";
      target_product_id?: string;
      target_product_slug?: string;
      percent: number;
      reason?: string;
    }
  | {
      id: string;
      type: "set_travel_support_mode";
      target_product_id?: string;
      target_product_slug?: string;
      mode: "managed" | "reimbursement" | "self_managed" | "none";
      reason?: string;
    }
  | {
      id: string;
      type: "set_travel_requirement";
      target_product_id?: string;
      target_product_slug?: string;
      requirement: "air_travel_allowed" | "requires_travel_intake" | "requires_accommodation_intake";
      value: boolean;
      reason?: string;
    };

export type RulesEngineWorkflow = {
  id: string;
  name: string;
  enabled: boolean;
  order: number;
  trigger: RulesEngineTrigger;
  scope: RulesEngineScope;
  hold_until_checkout_complete_or_logout: boolean;
  conflict_message_template?: string;
  precedence?: "tenant" | "conference";
  modifier: RulesEngineModifier;
  conditions: RulesEngineConditionGroup;
  actions: RulesEngineAction[];
  notes?: string;
};

export type RulesEngineV1 = {
  version: 1;
  workflows: RulesEngineWorkflow[];
  updated_at?: string;
};

export function getAllowedActionTypesForScope(
  scope: RulesEngineScope
): ReadonlyArray<RulesEngineAction["type"]> {
  if (scope === "commerce") {
    return [
      "set_product_visibility",
      "block_purchase",
      "apply_price_override_cents",
      "apply_discount_percent",
    ];
  }
  if (scope === "travel") {
    return ["set_travel_support_mode", "set_travel_requirement"];
  }
  return ["block_purchase"];
}

export function isActionAllowedForScope(
  scope: RulesEngineScope,
  actionType: RulesEngineAction["type"]
): boolean {
  return getAllowedActionTypesForScope(scope).includes(actionType);
}

export type RulesEngineEvalContext = {
  org_membership_status: string | null;
  org_type: string | null;
  org_registration_count: number;
  user_is_authenticated: boolean;
  product_id?: string;
  product_slug?: string;
};

export type RulesEngineEvaluation = {
  matchedWorkflows: RulesEngineWorkflow[];
  actions: RulesEngineAction[];
};

const DEFAULT_GROUP = (): RulesEngineConditionGroup => ({
  id: cryptoId(),
  kind: "group",
  operator: "and",
  children: [],
});

export function emptyRulesEngine(): RulesEngineV1 {
  return {
    version: 1,
    workflows: [],
  };
}

export function normalizeRulesEngine(raw: unknown): RulesEngineV1 {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return emptyRulesEngine();
  }
  const input = raw as Record<string, unknown>;
  const workflowsRaw = Array.isArray(input.workflows) ? input.workflows : [];
  const workflows: RulesEngineWorkflow[] = workflowsRaw
    .map((entry, index) => normalizeWorkflow(entry, index))
    .filter((entry): entry is RulesEngineWorkflow => entry != null);
  return {
    version: 1,
    workflows,
    updated_at: typeof input.updated_at === "string" ? input.updated_at : undefined,
  };
}

function normalizeWorkflow(raw: unknown, index: number): RulesEngineWorkflow | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const trigger = normalizeTrigger(input.trigger);
  if (!trigger) return null;
  const conditions = normalizeConditionGroup(input.conditions);
  const scope = normalizeScope(input.scope) ?? inferScopeFromTrigger(trigger);
  const actionsRaw = Array.isArray(input.actions) ? input.actions : [];
  const actions = actionsRaw
    .map((entry) => normalizeAction(entry))
    .filter(
      (entry): entry is RulesEngineAction =>
        entry != null && isActionAllowedForScope(scope, entry.type)
    );
  const holdUntilCheckoutCompleteOrLogout =
    scope === "commerce" ? input.hold_until_checkout_complete_or_logout !== false : false;
  const precedence =
    input.precedence === "conference" || input.precedence === "tenant"
      ? input.precedence
      : undefined;
  return {
    id: typeof input.id === "string" && input.id.trim() ? input.id : cryptoId(),
    name:
      typeof input.name === "string" && input.name.trim()
        ? input.name
        : `Workflow ${index + 1}`,
    enabled: input.enabled !== false,
    order: Number.isFinite(Number(input.order)) ? Number(input.order) : index,
    trigger,
    scope,
    hold_until_checkout_complete_or_logout: holdUntilCheckoutCompleteOrLogout,
    conflict_message_template:
      typeof input.conflict_message_template === "string"
        ? input.conflict_message_template
        : undefined,
    precedence,
    modifier: input.modifier === "first_match_only" ? "first_match_only" : "none",
    conditions,
    actions,
    notes: typeof input.notes === "string" ? input.notes : "",
  };
}

function normalizeTrigger(value: unknown): RulesEngineTrigger | null {
  if (
    value === "product_catalog_load" ||
    value === "cart_item_add" ||
    value === "checkout_attempt" ||
    value === "registration_submit" ||
    value === "travel_intake_save"
  ) {
    return value;
  }
  return null;
}

function normalizeScope(value: unknown): RulesEngineScope | null {
  if (value === "commerce" || value === "travel" || value === "access") {
    return value;
  }
  return null;
}

function inferScopeFromTrigger(trigger: RulesEngineTrigger): RulesEngineScope {
  if (
    trigger === "product_catalog_load" ||
    trigger === "cart_item_add" ||
    trigger === "checkout_attempt"
  ) {
    return "commerce";
  }
  if (trigger === "travel_intake_save") {
    return "travel";
  }
  return "access";
}

function normalizeConditionNode(raw: unknown): RulesEngineConditionNode | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  if (input.kind === "group") {
    return normalizeConditionGroup(input);
  }
  if (input.kind === "clause") {
    const field = normalizeField(input.field);
    const op = normalizeOperator(input.op);
    if (!field || !op) return null;
    return {
      id: typeof input.id === "string" && input.id.trim() ? input.id : cryptoId(),
      kind: "clause",
      field,
      op,
      value: normalizeValue(input.value),
    };
  }
  return null;
}

function normalizeConditionGroup(raw: unknown): RulesEngineConditionGroup {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return DEFAULT_GROUP();
  }
  const input = raw as Record<string, unknown>;
  const childrenRaw = Array.isArray(input.children) ? input.children : [];
  const children = childrenRaw
    .map((entry) => normalizeConditionNode(entry))
    .filter((entry): entry is RulesEngineConditionNode => entry != null);
  return {
    id: typeof input.id === "string" && input.id.trim() ? input.id : cryptoId(),
    kind: "group",
    operator: input.operator === "or" ? "or" : "and",
    children,
  };
}

function normalizeField(value: unknown): RulesEngineField | null {
  if (
    value === "org.membership_status" ||
    value === "org.type" ||
    value === "org.registration_count" ||
    value === "org.has_any_registration" ||
    value === "user.is_authenticated" ||
    value === "product.id" ||
    value === "product.slug"
  ) {
    return value;
  }
  return null;
}

function normalizeOperator(value: unknown): RulesEngineOperator | null {
  if (
    value === "equals" ||
    value === "not_equals" ||
    value === "gte" ||
    value === "lte" ||
    value === "includes" ||
    value === "is_true" ||
    value === "is_false"
  ) {
    return value;
  }
  return null;
}

function normalizeValue(value: unknown): RulesEngineValue | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return undefined;
}

function normalizeAction(raw: unknown): RulesEngineAction | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const id = typeof input.id === "string" && input.id.trim() ? input.id : cryptoId();
  if (input.type === "set_product_visibility") {
    return {
      id,
      type: "set_product_visibility",
      target_product_id:
        typeof input.target_product_id === "string" ? input.target_product_id : undefined,
      target_product_slug:
        typeof input.target_product_slug === "string" ? input.target_product_slug : undefined,
      visible: input.visible === false ? false : true,
      reason: typeof input.reason === "string" ? input.reason : "",
    };
  }
  if (input.type === "block_purchase") {
    return {
      id,
      type: "block_purchase",
      target_product_id:
        typeof input.target_product_id === "string" ? input.target_product_id : undefined,
      target_product_slug:
        typeof input.target_product_slug === "string" ? input.target_product_slug : undefined,
      message:
        typeof input.message === "string" && input.message.trim()
          ? input.message
          : "Purchase blocked by policy rule.",
    };
  }
  if (input.type === "apply_price_override_cents") {
    return {
      id,
      type: "apply_price_override_cents",
      target_product_id:
        typeof input.target_product_id === "string" ? input.target_product_id : undefined,
      target_product_slug:
        typeof input.target_product_slug === "string" ? input.target_product_slug : undefined,
      amount_cents: Number.isFinite(Number(input.amount_cents))
        ? Math.max(0, Number(input.amount_cents))
        : 0,
      reason: typeof input.reason === "string" ? input.reason : "",
    };
  }
  if (input.type === "apply_discount_percent") {
    return {
      id,
      type: "apply_discount_percent",
      target_product_id:
        typeof input.target_product_id === "string" ? input.target_product_id : undefined,
      target_product_slug:
        typeof input.target_product_slug === "string" ? input.target_product_slug : undefined,
      percent: Number.isFinite(Number(input.percent))
        ? Math.max(0, Math.min(100, Number(input.percent)))
        : 0,
      reason: typeof input.reason === "string" ? input.reason : "",
    };
  }
  if (input.type === "set_travel_support_mode") {
    const mode =
      input.mode === "managed" ||
      input.mode === "reimbursement" ||
      input.mode === "self_managed" ||
      input.mode === "none"
        ? input.mode
        : "managed";
    return {
      id,
      type: "set_travel_support_mode",
      target_product_id:
        typeof input.target_product_id === "string" ? input.target_product_id : undefined,
      target_product_slug:
        typeof input.target_product_slug === "string" ? input.target_product_slug : undefined,
      mode,
      reason: typeof input.reason === "string" ? input.reason : "",
    };
  }
  if (input.type === "set_travel_requirement") {
    const requirement =
      input.requirement === "air_travel_allowed" ||
      input.requirement === "requires_travel_intake" ||
      input.requirement === "requires_accommodation_intake"
        ? input.requirement
        : "air_travel_allowed";
    return {
      id,
      type: "set_travel_requirement",
      target_product_id:
        typeof input.target_product_id === "string" ? input.target_product_id : undefined,
      target_product_slug:
        typeof input.target_product_slug === "string" ? input.target_product_slug : undefined,
      requirement,
      value: input.value === false ? false : true,
      reason: typeof input.reason === "string" ? input.reason : "",
    };
  }
  return null;
}

function getFieldValue(context: RulesEngineEvalContext, field: RulesEngineField): RulesEngineValue {
  if (field === "org.membership_status") return context.org_membership_status ?? "";
  if (field === "org.type") return context.org_type ?? "";
  if (field === "org.registration_count") return context.org_registration_count;
  if (field === "org.has_any_registration") return context.org_registration_count > 0;
  if (field === "user.is_authenticated") return context.user_is_authenticated;
  if (field === "product.id") return context.product_id ?? "";
  return context.product_slug ?? "";
}

function compareValue(actual: RulesEngineValue, clause: RulesEngineConditionClause): boolean {
  if (clause.op === "is_true") return actual === true;
  if (clause.op === "is_false") return actual === false;
  if (clause.op === "equals") return String(actual) === String(clause.value ?? "");
  if (clause.op === "not_equals") return String(actual) !== String(clause.value ?? "");
  if (clause.op === "includes") return String(actual).includes(String(clause.value ?? ""));
  if (clause.op === "gte") {
    const a = Number(actual);
    const b = Number(clause.value ?? NaN);
    return Number.isFinite(a) && Number.isFinite(b) && a >= b;
  }
  if (clause.op === "lte") {
    const a = Number(actual);
    const b = Number(clause.value ?? NaN);
    return Number.isFinite(a) && Number.isFinite(b) && a <= b;
  }
  return false;
}

function evaluateNode(node: RulesEngineConditionNode, context: RulesEngineEvalContext): boolean {
  if (node.kind === "clause") {
    return compareValue(getFieldValue(context, node.field), node);
  }
  if (node.children.length === 0) return true;
  if (node.operator === "and") {
    return node.children.every((child) => evaluateNode(child, context));
  }
  return node.children.some((child) => evaluateNode(child, context));
}

function isWorkflowApplicableForTrigger(
  workflow: RulesEngineWorkflow,
  trigger: RulesEngineTrigger
): boolean {
  if (workflow.scope === "commerce") {
    return (
      trigger === "product_catalog_load" ||
      trigger === "cart_item_add" ||
      trigger === "checkout_attempt"
    );
  }
  if (workflow.scope === "travel") {
    return trigger === "travel_intake_save";
  }
  return trigger === "registration_submit";
}

export function evaluateRulesEngine(
  engine: RulesEngineV1,
  trigger: RulesEngineTrigger,
  context: RulesEngineEvalContext
): RulesEngineEvaluation {
  const sorted = [...engine.workflows].sort((a, b) => a.order - b.order);
  const matchedWorkflows: RulesEngineWorkflow[] = [];
  const actions: RulesEngineAction[] = [];

  for (const workflow of sorted) {
    if (!workflow.enabled || !isWorkflowApplicableForTrigger(workflow, trigger)) continue;
    if (!evaluateNode(workflow.conditions, context)) continue;
    matchedWorkflows.push(workflow);
    actions.push(...workflow.actions);
    if (workflow.modifier === "first_match_only") {
      break;
    }
  }

  return { matchedWorkflows, actions };
}

export function mergeRulesEngineLayers(params: {
  tenantEngine?: unknown;
  conferenceEngine?: unknown;
}): RulesEngineV1 {
  const tenant = normalizeRulesEngine(params.tenantEngine ?? null);
  const conference = normalizeRulesEngine(params.conferenceEngine ?? null);

  const conferenceIds = new Set(conference.workflows.map((workflow) => workflow.id));
  const mergedTenant = tenant.workflows
    .filter((workflow) => !conferenceIds.has(workflow.id))
    .map((workflow) => ({ ...workflow, precedence: "tenant" as const }));
  const mergedConference = conference.workflows.map((workflow) => ({
    ...workflow,
    precedence: "conference" as const,
  }));

  const workflows = [...mergedConference, ...mergedTenant].map((workflow, index) => ({
    ...workflow,
    order: index,
  }));

  return normalizeRulesEngine({
    version: 1,
    updated_at: conference.updated_at ?? tenant.updated_at,
    workflows,
  });
}

function cryptoId(): string {
  return `rule_${Math.random().toString(36).slice(2, 10)}`;
}
