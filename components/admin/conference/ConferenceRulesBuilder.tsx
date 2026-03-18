"use client";

import { useEffect, useMemo, useState } from "react";
import type { Database } from "@/lib/database.types";
import {
  getAllowedActionTypesForScope,
  isActionAllowedForScope,
  type RulesEngineAction,
  type RulesEngineConditionClause,
  type RulesEngineOperator,
  type RulesEngineScope,
  type RulesEngineTrigger,
} from "@/lib/conference/rules-engine";
import {
  canonicalAstToRulesEngine,
  rulesEngineToCanonicalAst,
  type RulesAstConditionToken,
  type RulesAstV1,
  type RulesAstWorkflow,
} from "@/lib/conference/rules-ast";
import {
  getConferenceRulesBuilderContext,
  getConferenceRulesEngine,
  saveConferenceRulesEngine,
} from "@/lib/actions/conference-rules-engine";

type ProductRow = Database["public"]["Tables"]["conference_products"]["Row"];

type SelectedNode =
  | { kind: "workflow" }
  | { kind: "trigger" }
  | { kind: "condition"; id: string }
  | { kind: "operator"; id: string }
  | { kind: "branch"; id: string }
  | { kind: "action"; id: string };

type BranchToken = {
  id: string;
  kind: "group_start" | "group_end";
};

type ConditionTokenLinear = RulesEngineConditionClause | OperatorToken | BranchToken;

type OperatorToken = {
  id: string;
  kind: "logic_operator";
  operator: "and" | "or";
};

type FlowStep =
  | {
      id: string;
      kind: "trigger";
    }
  | {
      id: string;
      kind: "condition";
      token: RulesEngineConditionClause;
      index: number;
    }
  | {
      id: string;
      kind: "operator";
      token: OperatorToken;
      index: number;
    }
  | {
      id: string;
      kind: "branch";
      token: BranchToken;
      index: number;
    }
  | {
      id: string;
      kind: "action";
      actionId: string;
      action: RulesEngineAction;
      index: number;
    };

type AddMenuState = {
  position: number;
} | null;

type CardMenuState =
  | { kind: "condition"; id: string }
  | { kind: "operator"; id: string }
  | { kind: "branch"; id: string }
  | { kind: "action"; id: string }
  | null;

type DeleteIntentState =
  | { kind: "workflow"; id: string }
  | { kind: "condition"; id: string }
  | { kind: "operator"; id: string }
  | { kind: "branch"; id: string }
  | { kind: "action"; id: string }
  | null;

type WorkflowValidation = {
  workflow: string[];
  conditions: Record<string, string>;
  operators: Record<string, string>;
  branches: Record<string, string>;
  actions: Record<string, string>;
};

type WorkflowTemplate = {
  id: string;
  label: string;
  description: string;
  build: (order: number) => RulesAstWorkflow;
};

type RulesBuilderContext = {
  organizationTypes: string[];
  membershipStatuses: string[];
};

type ConditionValueKind = "enum" | "number" | "boolean";

const SCOPE_OPTIONS: Array<{
  value: RulesEngineScope;
  label: string;
  help: string;
}> = [
  {
    value: "commerce",
    label: "Commerce",
    help: "Applies across products, cart, and checkout. Held until checkout complete or server logout.",
  },
  {
    value: "travel",
    label: "Travel",
    help: "Applies to travel intake and travel support workflow behavior.",
  },
  {
    value: "access",
    label: "Access",
    help: "Applies to role/permission style checks around registration submission.",
  },
];

const FIELD_OPTIONS: Array<{ value: RulesEngineConditionClause["field"]; label: string }> = [
  { value: "org.membership_status", label: "Organization membership status" },
  { value: "org.type", label: "Organization type" },
  { value: "org.registration_count", label: "Organization registration count" },
  { value: "org.has_any_registration", label: "Organization has existing registration" },
  { value: "user.is_authenticated", label: "User is logged in" },
  { value: "product.id", label: "Registration product" },
  { value: "product.slug", label: "Registration product slug" },
];

const OPERATOR_OPTIONS: Array<{ value: RulesEngineOperator; label: string }> = [
  { value: "equals", label: "is" },
  { value: "not_equals", label: "is not" },
  { value: "gte", label: "is at least" },
  { value: "lte", label: "is at most" },
  { value: "includes", label: "contains" },
  { value: "is_true", label: "is true" },
  { value: "is_false", label: "is false" },
];

const ACTION_OPTIONS: Array<{ value: RulesEngineAction["type"]; label: string }> = [
  { value: "set_product_visibility", label: "Set product visibility" },
  { value: "block_purchase", label: "Block purchase" },
  { value: "apply_price_override_cents", label: "Set exact price" },
  { value: "apply_discount_percent", label: "Apply discount percent" },
  { value: "set_travel_support_mode", label: "Set travel support mode" },
  { value: "set_travel_requirement", label: "Set travel requirement" },
];

function getActionOptionsForScope(scope: RulesEngineScope): Array<{ value: RulesEngineAction["type"]; label: string }> {
  const allowed = new Set(getAllowedActionTypesForScope(scope));
  return ACTION_OPTIONS.filter((option) => allowed.has(option.value));
}

function getDefaultActionTypeForScope(scope: RulesEngineScope): RulesEngineAction["type"] {
  return getActionOptionsForScope(scope)[0]?.value ?? "block_purchase";
}

function makeId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function defaultWorkflow(order: number): RulesAstWorkflow {
  return {
    id: makeId("wf"),
    name: `Workflow ${order + 1}`,
    enabled: true,
    order,
    scope: "commerce",
    hold_until_checkout_complete_or_logout: true,
    conflict_message_template:
      "[Rule] has changed. This has affected [scope of changes]. [Old value] is now [new value]. Contact CSC if you think this is incorrect: support@campusstorescanada.com",
    modifier: "none",
    notes: "",
    trigger: {
      id: makeId("trigger"),
      kind: "trigger",
      trigger: "checkout_attempt",
    },
    conditions: {
      id: makeId("conditions"),
      kind: "condition_expression",
      tokens: [],
    },
    actions: [],
  };
}

function defaultCondition(): RulesEngineConditionClause {
  return {
    id: makeId("clause"),
    kind: "clause",
    field: "org.has_any_registration",
    op: "is_true",
    value: true,
  };
}

function defaultOperator(value: "and" | "or" = "and"): OperatorToken {
  return {
    id: makeId("op"),
    kind: "logic_operator",
    operator: value,
  };
}

function defaultAction(type: RulesEngineAction["type"] = "block_purchase", id = makeId("action")): RulesEngineAction {
  if (type === "set_product_visibility") {
    return {
      id,
      type,
      visible: true,
      reason: "",
    };
  }
  if (type === "block_purchase") {
    return {
      id,
      type,
      message: "This registration path is not available.",
    };
  }
  if (type === "apply_price_override_cents") {
    return {
      id,
      type,
      amount_cents: 0,
      reason: "",
    };
  }
  if (type === "apply_discount_percent") {
    return {
      id,
      type,
      percent: 0,
      reason: "",
    };
  }
  if (type === "set_travel_support_mode") {
    return {
      id,
      type,
      mode: "managed",
      reason: "",
    };
  }
  return {
    id,
    type,
    requirement: "air_travel_allowed",
    value: true,
    reason: "",
  };
}

function buildTemplateBlockUnregistered(order: number): RulesAstWorkflow {
  const workflow = defaultWorkflow(order);
  const condition = defaultCondition();
  condition.field = "org.has_any_registration";
  condition.op = "is_false";
  condition.value = false;

  const action = defaultAction("block_purchase");
  if (action.type === "block_purchase") {
    action.message = "Your organization must have a registration before this item can be added.";
  }

  return {
    ...workflow,
    name: "Block first-time add",
    trigger: { ...workflow.trigger, trigger: "cart_item_add" },
    conditions: { ...workflow.conditions, tokens: [condition] },
    actions: [{ id: action.id, kind: "action", action }],
  };
}

function buildTemplateTravelIntake(order: number): RulesAstWorkflow {
  const workflow = defaultWorkflow(order);
  const condition = defaultCondition();
  condition.field = "org.type";
  condition.op = "equals";
  condition.value = "Member";

  const action = defaultAction("set_travel_requirement");
  if (action.type === "set_travel_requirement") {
    action.requirement = "requires_travel_intake";
    action.value = true;
  }

  return {
    ...workflow,
    name: "Require travel intake for members",
    scope: "travel",
    hold_until_checkout_complete_or_logout: false,
    trigger: { ...workflow.trigger, trigger: "travel_intake_save" },
    conditions: { ...workflow.conditions, tokens: [condition] },
    actions: [{ id: action.id, kind: "action", action }],
  };
}

const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "block-unregistered",
    label: "Block unregistered add",
    description: "Blocks add-to-cart when org has no registration.",
    build: buildTemplateBlockUnregistered,
  },
  {
    id: "travel-intake-member",
    label: "Require travel intake",
    description: "Sets travel intake required for Member orgs.",
    build: buildTemplateTravelIntake,
  },
];

const DEFAULT_MEMBERSHIP_STATUSES = [
  "applied",
  "approved",
  "active",
  "grace",
  "locked",
  "reactivated",
  "canceled",
];

function getConditionValueKind(field: RulesEngineConditionClause["field"]): ConditionValueKind {
  if (field === "org.registration_count") return "number";
  if (field === "org.has_any_registration" || field === "user.is_authenticated") return "boolean";
  return "enum";
}

function getConditionOperatorOptions(
  field: RulesEngineConditionClause["field"]
): Array<{ value: RulesEngineOperator; label: string }> {
  const kind = getConditionValueKind(field);
  if (kind === "boolean") {
    return OPERATOR_OPTIONS.filter(
      (option) => option.value === "is_true" || option.value === "is_false"
    );
  }
  if (kind === "number") {
    return OPERATOR_OPTIONS.filter(
      (option) =>
        option.value === "equals" ||
        option.value === "not_equals" ||
        option.value === "gte" ||
        option.value === "lte"
    );
  }
  return OPERATOR_OPTIONS.filter(
    (option) =>
      option.value === "equals" ||
      option.value === "not_equals" ||
      option.value === "includes"
  );
}

function operatorNeedsValue(op: RulesEngineOperator): boolean {
  return op !== "is_true" && op !== "is_false";
}

function getConditionValueOptions(params: {
  field: RulesEngineConditionClause["field"];
  products: ProductRow[];
  context: RulesBuilderContext;
}): Array<{ value: string; label: string }> {
  const { field, products, context } = params;
  if (field === "org.type") {
    return context.organizationTypes.map((value) => ({ value, label: value }));
  }
  if (field === "org.membership_status") {
    return context.membershipStatuses.map((value) => ({ value, label: value }));
  }
  if (field === "product.id") {
    return products.map((product) => ({ value: product.id, label: product.name }));
  }
  if (field === "product.slug") {
    return Array.from(new Set(products.map((product) => product.slug)))
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => ({ value, label: value }));
  }
  return [];
}

function toLinearConditionTokens(tokens: RulesAstConditionToken[]): ConditionTokenLinear[] {
  return tokens.filter(
    (token): token is ConditionTokenLinear =>
      token.kind === "clause" ||
      token.kind === "logic_operator" ||
      token.kind === "group_start" ||
      token.kind === "group_end"
  );
}

function sanitizeLinearConditionTokens(tokens: ConditionTokenLinear[]): ConditionTokenLinear[] {
  // Keep user-authored token order exactly as entered on canvas.
  // Validation handles invalid sequences instead of silently rewriting.
  return [...tokens];
}

function scopeLabel(value: RulesEngineScope): string {
  return SCOPE_OPTIONS.find((entry) => entry.value === value)?.label ?? value;
}

function defaultTriggerForScope(scope: RulesEngineScope): RulesEngineTrigger {
  if (scope === "travel") return "travel_intake_save";
  if (scope === "access") return "registration_submit";
  return "checkout_attempt";
}

function fieldLabel(field: RulesEngineConditionClause["field"]): string {
  return FIELD_OPTIONS.find((entry) => entry.value === field)?.label ?? field;
}

function logicLabel(value: RulesEngineConditionClause["op"]): string {
  return OPERATOR_OPTIONS.find((entry) => entry.value === value)?.label ?? value;
}

function actionLabel(action: RulesEngineAction): string {
  if (action.type === "set_product_visibility") return "Set product visibility";
  if (action.type === "block_purchase") return "Block purchase";
  if (action.type === "apply_price_override_cents") return "Set exact price";
  if (action.type === "apply_discount_percent") return "Apply discount";
  if (action.type === "set_travel_support_mode") return "Set travel support mode";
  return "Set travel requirement";
}

function clauseSummary(clause: RulesEngineConditionClause): string {
  if (clause.op === "is_true") return `${fieldLabel(clause.field)} is true`;
  if (clause.op === "is_false") return `${fieldLabel(clause.field)} is false`;
  return `${fieldLabel(clause.field)} ${logicLabel(clause.op)} ${String(clause.value ?? "")}`;
}

function actionSummary(action: RulesEngineAction, products: ProductRow[]): string {
  const productName =
    "target_product_id" in action && action.target_product_id
      ? products.find((p) => p.id === action.target_product_id)?.name ?? "Selected product"
      : "Any product";

  if (action.type === "set_product_visibility") {
    return `${productName}: ${action.visible ? "Show product" : "Hide product"}`;
  }
  if (action.type === "block_purchase") {
    return `${productName}: ${action.message || "Block purchase"}`;
  }
  if (action.type === "apply_price_override_cents") {
    return `${productName}: ${(action.amount_cents / 100).toFixed(2)} CAD`;
  }
  if (action.type === "apply_discount_percent") {
    return `${productName}: ${action.percent}% discount`;
  }
  if (action.type === "set_travel_support_mode") {
    return `${productName}: ${action.mode.replace("_", " ")}`;
  }
  return `${productName}: ${action.requirement.replaceAll("_", " ")} = ${action.value ? "Yes" : "No"}`;
}

function hasConditionValue(value: RulesEngineConditionClause["value"]): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function validateCondition(clause: RulesEngineConditionClause): string | null {
  if (clause.op === "is_true" || clause.op === "is_false") return null;
  if (!hasConditionValue(clause.value)) return "Value is required for this condition.";
  if (clause.op === "gte" || clause.op === "lte") {
    if (!Number.isFinite(Number(clause.value))) {
      return "Enter a valid number for this condition.";
    }
  }
  return null;
}

function validateAction(action: RulesEngineAction, scope?: RulesEngineScope): string | null {
  if (scope && !isActionAllowedForScope(scope, action.type)) {
    return `${actionLabel(action)} is not allowed for ${scopeLabel(scope)} scope.`;
  }
  if (action.type === "block_purchase") {
    return action.message.trim().length === 0 ? "Block message is required." : null;
  }
  if (action.type === "apply_price_override_cents") {
    if (!Number.isFinite(action.amount_cents) || action.amount_cents < 0) {
      return "Price override must be a non-negative number.";
    }
    return null;
  }
  if (action.type === "apply_discount_percent") {
    if (!Number.isFinite(action.percent) || action.percent < 0 || action.percent > 100) {
      return "Discount must be between 0 and 100.";
    }
    return null;
  }
  return null;
}

function buildFlowSteps(workflow: RulesAstWorkflow): FlowStep[] {
  const linear = toLinearConditionTokens(workflow.conditions.tokens);
  const conditionSteps: FlowStep[] = linear.map((token, index) => {
    if (token.kind === "logic_operator") {
      return {
        id: `operator:${token.id}`,
        kind: "operator",
        token,
        index,
      };
    }
    if (token.kind === "group_start" || token.kind === "group_end") {
      return {
        id: `branch:${token.id}`,
        kind: "branch",
        token,
        index,
      };
    }
    if (token.kind !== "clause") {
      throw new Error(`Unsupported condition token kind: ${(token as { kind: string }).kind}`);
    }
    return {
      id: `condition:${token.id}`,
      kind: "condition",
      token,
      index,
    };
  });

  const actionSteps: FlowStep[] = workflow.actions.map((entry, index) => ({
    id: `action:${entry.id}`,
    kind: "action",
    actionId: entry.id,
    action: entry.action,
    index,
  }));

  return [{ id: "trigger", kind: "trigger" }, ...conditionSteps, ...actionSteps];
}

function getTokenIndexForFlowPosition(workflow: RulesAstWorkflow, flowPosition: number): number {
  return Math.max(0, flowPosition - 1);
}

function isConditionToken(step: FlowStep | undefined): boolean {
  return step?.kind === "condition";
}

function isOperatorToken(step: FlowStep | undefined): boolean {
  return step?.kind === "operator";
}

export default function ConferenceRulesBuilder({
  conferenceId,
  products,
}: {
  conferenceId: string;
  products: ProductRow[];
}) {
  const [ast, setAst] = useState<RulesAstV1>({ version: 1, workflows: [] });
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>("");
  const [selectedNode, setSelectedNode] = useState<SelectedNode>({ kind: "workflow" });
  const [addMenu, setAddMenu] = useState<AddMenuState>(null);
  const [cardMenu, setCardMenu] = useState<CardMenuState>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [deleteIntent, setDeleteIntent] = useState<DeleteIntentState>(null);
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const [rulesContext, setRulesContext] = useState<RulesBuilderContext>({
    organizationTypes: [],
    membershipStatuses: DEFAULT_MEMBERSHIP_STATUSES,
  });

  useEffect(() => {
    if (!addMenu) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-add-menu-root='true']")) return;
      if (target.closest("[data-add-menu-toggle='true']")) return;
      setAddMenu(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [addMenu]);

  useEffect(() => {
    if (!deleteIntent) return;
    const timeout = window.setTimeout(() => setDeleteIntent(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [deleteIntent]);

  const workflows = useMemo(
    () => [...ast.workflows].sort((a, b) => a.order - b.order),
    [ast.workflows]
  );

  const selectedWorkflow = useMemo(
    () => workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? workflows[0] ?? null,
    [selectedWorkflowId, workflows]
  );

  const steps = useMemo(() => (selectedWorkflow ? buildFlowSteps(selectedWorkflow) : []), [selectedWorkflow]);

  useEffect(() => {
    if (!selectedWorkflow && workflows.length > 0) {
      setSelectedWorkflowId(workflows[0].id);
      setSelectedNode({ kind: "workflow" });
      return;
    }
    if (!selectedWorkflow) {
      setSelectedWorkflowId("");
      setSelectedNode({ kind: "workflow" });
    }
  }, [selectedWorkflow, workflows]);

  const load = async () => {
    setIsLoading(true);
    setError(null);
    setSuccess(null);
    const [engineResult, contextResult] = await Promise.all([
      getConferenceRulesEngine(conferenceId),
      getConferenceRulesBuilderContext(conferenceId),
    ]);
    setIsLoading(false);
    if (!engineResult.success) {
      setError(engineResult.error ?? "Failed to load rules.");
      return;
    }
    if (contextResult.success) {
      setRulesContext(contextResult.data);
    }
    const nextAst = rulesEngineToCanonicalAst(engineResult.data);
    setAst(nextAst);
    setSelectedWorkflowId(nextAst.workflows[0]?.id ?? "");
    setSelectedNode({ kind: "workflow" });
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conferenceId]);

  const updateSelectedWorkflow = (updater: (workflow: RulesAstWorkflow) => RulesAstWorkflow) => {
    if (!selectedWorkflow) return;
    setAst((prev) => ({
      ...prev,
      workflows: prev.workflows.map((workflow) =>
        workflow.id === selectedWorkflow.id ? updater(workflow) : workflow
      ),
    }));
  };

  const setConditionTokens = (tokens: ConditionTokenLinear[]) => {
    updateSelectedWorkflow((workflow) => ({
      ...workflow,
      conditions: {
        ...workflow.conditions,
        tokens: sanitizeLinearConditionTokens(tokens),
      },
    }));
  };

  const addWorkflow = () => {
    const next = defaultWorkflow(workflows.length);
    setAst((prev) => ({
      ...prev,
      workflows: [...prev.workflows, next],
    }));
    setSelectedWorkflowId(next.id);
    setSelectedNode({ kind: "workflow" });
  };

  const addWorkflowFromTemplate = (templateId: string) => {
    const template = WORKFLOW_TEMPLATES.find((entry) => entry.id === templateId);
    if (!template) return;
    const next = template.build(workflows.length);
    setAst((prev) => ({
      ...prev,
      workflows: [...prev.workflows, next],
    }));
    setSelectedWorkflowId(next.id);
    setSelectedNode({ kind: "workflow" });
    setTemplateMenuOpen(false);
  };

  const deleteWorkflow = () => {
    if (!selectedWorkflow) return;
    const target = { kind: "workflow" as const, id: selectedWorkflow.id };
    if (!(deleteIntent?.kind === target.kind && deleteIntent.id === target.id)) {
      setDeleteIntent(target);
      return;
    }
    setAst((prev) => ({
      ...prev,
      workflows: prev.workflows
        .filter((workflow) => workflow.id !== selectedWorkflow.id)
        .map((workflow, index) => ({ ...workflow, order: index })),
    }));
    setDeleteIntent(null);
    setSelectedNode({ kind: "workflow" });
  };

  const addConditionTokenAt = (flowPosition: number) => {
    if (!selectedWorkflow) return;
    const tokens = toLinearConditionTokens(selectedWorkflow.conditions.tokens);
    const tokenIndex = getTokenIndexForFlowPosition(selectedWorkflow, flowPosition);
    const next = [...tokens];
    const clause = defaultCondition();
    next.splice(tokenIndex, 0, clause);
    setConditionTokens(next);
    setSelectedNode({ kind: "condition", id: clause.id });
    setAddMenu(null);
  };

  const addOperatorTokenAt = (flowPosition: number, operator: "and" | "or") => {
    if (!selectedWorkflow) return;
    const tokens = toLinearConditionTokens(selectedWorkflow.conditions.tokens);
    const tokenIndex = getTokenIndexForFlowPosition(selectedWorkflow, flowPosition);
    const op = defaultOperator(operator);
    const next = [...tokens];
    next.splice(tokenIndex, 0, op);
    setConditionTokens(next);
    setSelectedNode({ kind: "operator", id: op.id });
    setAddMenu(null);
  };

  const addBranchTokenAt = (flowPosition: number, kind: "group_start" | "group_end") => {
    if (!selectedWorkflow) return;
    const tokens = toLinearConditionTokens(selectedWorkflow.conditions.tokens);
    const tokenIndex = getTokenIndexForFlowPosition(selectedWorkflow, flowPosition);
    const next = [...tokens];
    const token: BranchToken = { id: makeId("branch"), kind };
    next.splice(tokenIndex, 0, token);
    setConditionTokens(next);
    setSelectedNode({ kind: "branch", id: token.id });
    setAddMenu(null);
  };

  const addActionAt = (flowPosition: number, actionType?: RulesEngineAction["type"]) => {
    if (!selectedWorkflow) return;
    const conditionTokenCount = toLinearConditionTokens(selectedWorkflow.conditions.tokens).length;
    const actionInsertIndex = Math.max(0, flowPosition - 1 - conditionTokenCount);
    const requestedType = actionType ?? getDefaultActionTypeForScope(selectedWorkflow.scope);
    const nextType = isActionAllowedForScope(selectedWorkflow.scope, requestedType)
      ? requestedType
      : getDefaultActionTypeForScope(selectedWorkflow.scope);
    const action = defaultAction(nextType);

    updateSelectedWorkflow((workflow) => {
      const nextActions = [...workflow.actions];
      nextActions.splice(actionInsertIndex, 0, {
        id: action.id,
        kind: "action",
        action,
      });
      return {
        ...workflow,
        actions: nextActions,
      };
    });

    setSelectedNode({ kind: "action", id: action.id });
    setAddMenu(null);
  };

  const updateCondition = (conditionId: string, patch: Partial<RulesEngineConditionClause>) => {
    if (!selectedWorkflow) return;
    const next = toLinearConditionTokens(selectedWorkflow.conditions.tokens).map((token) =>
      token.kind === "clause" && token.id === conditionId ? { ...token, ...patch } : token
    );
    setConditionTokens(next);
  };

  const getDefaultConditionValue = (
    field: RulesEngineConditionClause["field"],
    op: RulesEngineOperator
  ): RulesEngineConditionClause["value"] => {
    if (!operatorNeedsValue(op)) return undefined;
    const kind = getConditionValueKind(field);
    if (kind === "number") return 0;
    if (kind === "boolean") return true;
    const options = getConditionValueOptions({
      field,
      products,
      context: rulesContext,
    });
    return options[0]?.value ?? "";
  };

  const updateConditionField = (
    condition: RulesEngineConditionClause,
    field: RulesEngineConditionClause["field"]
  ) => {
    const ops = getConditionOperatorOptions(field);
    const nextOp = ops.some((entry) => entry.value === condition.op)
      ? condition.op
      : (ops[0]?.value ?? "equals");
    updateCondition(condition.id, {
      field,
      op: nextOp,
      value: getDefaultConditionValue(field, nextOp),
    });
  };

  const updateConditionOperator = (
    condition: RulesEngineConditionClause,
    op: RulesEngineOperator
  ) => {
    updateCondition(condition.id, {
      op,
      value: getDefaultConditionValue(condition.field, op),
    });
  };

  const updateOperator = (operatorId: string, value: "and" | "or") => {
    if (!selectedWorkflow) return;
    const next = toLinearConditionTokens(selectedWorkflow.conditions.tokens).map((token) =>
      token.kind === "logic_operator" && token.id === operatorId
        ? { ...token, operator: value }
        : token
    );
    setConditionTokens(next);
  };

  const deleteCondition = (conditionId: string) => {
    if (!selectedWorkflow) return;
    const target = { kind: "condition" as const, id: conditionId };
    if (!(deleteIntent?.kind === target.kind && deleteIntent.id === target.id)) {
      setDeleteIntent(target);
      return;
    }
    const tokens = toLinearConditionTokens(selectedWorkflow.conditions.tokens);
    const index = tokens.findIndex((token) => token.kind === "clause" && token.id === conditionId);
    if (index < 0) return;
    const next = [...tokens];
    next.splice(index, 1);
    if (next[index]?.kind === "logic_operator") {
      next.splice(index, 1);
    } else if (next[index - 1]?.kind === "logic_operator") {
      next.splice(index - 1, 1);
    }
    setConditionTokens(next);
    setDeleteIntent(null);
    setSelectedNode({ kind: "workflow" });
    setCardMenu(null);
  };

  const deleteOperator = (operatorId: string) => {
    if (!selectedWorkflow) return;
    const target = { kind: "operator" as const, id: operatorId };
    if (!(deleteIntent?.kind === target.kind && deleteIntent.id === target.id)) {
      setDeleteIntent(target);
      return;
    }
    const next = toLinearConditionTokens(selectedWorkflow.conditions.tokens).filter(
      (token) => !(token.kind === "logic_operator" && token.id === operatorId)
    );
    setConditionTokens(next);
    setDeleteIntent(null);
    setSelectedNode({ kind: "workflow" });
    setCardMenu(null);
  };

  const deleteBranchToken = (branchId: string) => {
    if (!selectedWorkflow) return;
    const target = { kind: "branch" as const, id: branchId };
    if (!(deleteIntent?.kind === target.kind && deleteIntent.id === target.id)) {
      setDeleteIntent(target);
      return;
    }
    const next = toLinearConditionTokens(selectedWorkflow.conditions.tokens).filter(
      (token) => token.id !== branchId
    );
    setConditionTokens(next);
    setDeleteIntent(null);
    setSelectedNode({ kind: "workflow" });
    setCardMenu(null);
  };

  const deleteAction = (actionId: string) => {
    const target = { kind: "action" as const, id: actionId };
    if (!(deleteIntent?.kind === target.kind && deleteIntent.id === target.id)) {
      setDeleteIntent(target);
      return;
    }
    updateSelectedWorkflow((workflow) => ({
      ...workflow,
      actions: workflow.actions.filter((entry) => entry.id !== actionId),
    }));
    setDeleteIntent(null);
    setSelectedNode({ kind: "workflow" });
    setCardMenu(null);
  };

  const updateAction = (actionId: string, patch: Partial<RulesEngineAction>) => {
    updateSelectedWorkflow((workflow) => ({
      ...workflow,
      actions: workflow.actions.map((entry) =>
        entry.id === actionId
          ? { ...entry, action: { ...entry.action, ...patch } as RulesEngineAction }
          : entry
      ),
    }));
  };

  const replaceActionType = (actionId: string, type: RulesEngineAction["type"]) => {
    if (!selectedWorkflow) return;
    if (!isActionAllowedForScope(selectedWorkflow.scope, type)) return;
    const nextAction = defaultAction(type, actionId);
    updateSelectedWorkflow((workflow) => ({
      ...workflow,
      actions: workflow.actions.map((entry) =>
        entry.id === actionId ? { ...entry, action: nextAction } : entry
      ),
    }));
  };

  const save = async () => {
    setIsSaving(true);
    setError(null);
    setSuccess(null);
    const engine = canonicalAstToRulesEngine({
      ...ast,
      workflows: workflows.map((workflow, index) => ({ ...workflow, order: index })),
      updated_at: new Date().toISOString(),
    });
    const result = await saveConferenceRulesEngine({ conferenceId, engine });
    setIsSaving(false);
    if (!result.success) {
      setError(result.error ?? "Failed to save rules.");
      return;
    }
    setSuccess("Rules saved.");
    setAst((prev) => ({ ...prev, updated_at: new Date().toISOString() }));
  };

  const selectedCondition =
    selectedNode.kind === "condition" && selectedWorkflow
      ? toLinearConditionTokens(selectedWorkflow.conditions.tokens).find(
          (token): token is RulesEngineConditionClause =>
            token.kind === "clause" && token.id === selectedNode.id
        ) ?? null
      : null;

  const selectedOperator =
    selectedNode.kind === "operator" && selectedWorkflow
      ? toLinearConditionTokens(selectedWorkflow.conditions.tokens).find(
          (token): token is OperatorToken =>
            token.kind === "logic_operator" && token.id === selectedNode.id
        ) ?? null
      : null;

  const selectedAction =
    selectedNode.kind === "action" && selectedWorkflow
      ? selectedWorkflow.actions.find((entry) => entry.id === selectedNode.id)?.action ?? null
      : null;

  const selectedBranchToken =
    selectedNode.kind === "branch" && selectedWorkflow
      ? toLinearConditionTokens(selectedWorkflow.conditions.tokens).find(
          (token): token is BranchToken =>
            (token.kind === "group_start" || token.kind === "group_end") && token.id === selectedNode.id
        ) ?? null
      : null;

  const selectedConditionOperatorOptions = useMemo(
    () =>
      selectedCondition ? getConditionOperatorOptions(selectedCondition.field) : [],
    [selectedCondition]
  );

  const selectedConditionValueOptions = useMemo(
    () =>
      selectedCondition
        ? getConditionValueOptions({
            field: selectedCondition.field,
            products,
            context: rulesContext,
          })
        : [],
    [products, rulesContext, selectedCondition]
  );

  const selectedWorkflowActionOptions = useMemo(
    () => (selectedWorkflow ? getActionOptionsForScope(selectedWorkflow.scope) : []),
    [selectedWorkflow]
  );

  const addMenuCapabilities = useMemo(() => {
    if (!selectedWorkflow || !addMenu) {
      return {
        canAddCondition: false,
        canAddAnd: false,
        canAddOr: false,
        canAddBranchStart: false,
        canAddBranchEnd: false,
        canAddAction: false,
      };
    }

    const position = addMenu.position;
    const left = steps[position - 1];
    const right = steps[position];

    const canAddCondition =
      left?.kind === "trigger" ||
      isOperatorToken(left) ||
      isOperatorToken(right) ||
      right?.kind === "action";

    const canAddOperator = true;
    const canAddBranchStart = true;
    const canAddBranchEnd = true;

    const canAddAction =
      left?.kind === "trigger" ||
      isConditionToken(left) ||
      right?.kind === "action" ||
      (!right && left?.kind !== "operator");

    return {
      canAddCondition,
      canAddAnd: canAddOperator,
      canAddOr: canAddOperator,
      canAddBranchStart,
      canAddBranchEnd,
      canAddAction,
    };
  }, [addMenu, selectedWorkflow, steps]);

  const validationByWorkflowId = useMemo(() => {
    const map: Record<string, WorkflowValidation> = {};

    for (const workflow of workflows) {
      const workflowIssues: string[] = [];
      const conditionIssues: Record<string, string> = {};
      const operatorIssues: Record<string, string> = {};
      const branchIssues: Record<string, string> = {};
      const actionIssues: Record<string, string> = {};

      if (workflow.name.trim().length === 0) {
        workflowIssues.push("Workflow name is required.");
      }
      if (workflow.actions.length === 0) {
        workflowIssues.push("Add at least one action.");
      }

      const conditionTokens = toLinearConditionTokens(workflow.conditions.tokens);
      for (const token of conditionTokens) {
        if (token.kind !== "clause") continue;
        const issue = validateCondition(token);
        if (issue) conditionIssues[token.id] = issue;
      }

      // Expression validator for mixed tokens (conditions/operators/branches).
      let expectOperand = true;
      const openBranchStack: string[] = [];
      for (const token of conditionTokens) {
        if (token.kind === "group_start") {
          if (!expectOperand) {
            branchIssues[token.id] = "Branch start must follow an operator.";
          }
          openBranchStack.push(token.id);
          continue;
        }
        if (token.kind === "group_end") {
          if (expectOperand) {
            branchIssues[token.id] = "Branch end must follow a condition.";
          }
          const openId = openBranchStack.pop();
          if (!openId) {
            branchIssues[token.id] = "No matching branch start.";
          }
          expectOperand = false;
          continue;
        }
        if (token.kind === "logic_operator") {
          if (expectOperand) {
            operatorIssues[token.id] = "Operator needs a condition on the left.";
          }
          expectOperand = true;
          continue;
        }
        if (!expectOperand) {
          conditionIssues[token.id] = "Add an operator before this condition.";
        }
        expectOperand = false;
      }
      if (conditionTokens.length > 0 && expectOperand) {
        const last = conditionTokens[conditionTokens.length - 1];
        if (last.kind === "logic_operator") {
          operatorIssues[last.id] = "Add a condition after this operator.";
        }
        if (last.kind === "group_start") {
          branchIssues[last.id] = "Branch start must contain at least one condition.";
        }
      }
      if (openBranchStack.length > 0) {
        for (const openId of openBranchStack) {
          branchIssues[openId] = "Branch is not closed.";
        }
      }

      for (const entry of workflow.actions) {
        const issue = validateAction(entry.action, workflow.scope);
        if (issue) actionIssues[entry.id] = issue;
      }

      map[workflow.id] = {
        workflow: workflowIssues,
        conditions: conditionIssues,
        operators: operatorIssues,
        branches: branchIssues,
        actions: actionIssues,
      };
    }

    return map;
  }, [workflows]);

  const hasValidationErrors = useMemo(() => {
    return workflows.some((workflow) => {
      const validation = validationByWorkflowId[workflow.id];
      if (!validation) return false;
      return (
        validation.workflow.length > 0 ||
        Object.keys(validation.conditions).length > 0 ||
        Object.keys(validation.operators).length > 0 ||
        Object.keys(validation.branches).length > 0 ||
        Object.keys(validation.actions).length > 0
      );
    });
  }, [validationByWorkflowId, workflows]);

  const currentWorkflowValidation = selectedWorkflow ? validationByWorkflowId[selectedWorkflow.id] : null;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[240px] text-xs text-gray-700">
            Workflow
            <select
              value={selectedWorkflow?.id ?? ""}
              onChange={(event) => {
                setSelectedWorkflowId(event.target.value);
                setSelectedNode({ kind: "workflow" });
                setCardMenu(null);
                setAddMenu(null);
                setTemplateMenuOpen(false);
              }}
              className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
            >
              {workflows.length === 0 ? <option value="">No workflow yet</option> : null}
              {workflows.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.name}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => {
              addWorkflow();
              setTemplateMenuOpen(false);
            }}
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            New workflow
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setTemplateMenuOpen((prev) => !prev)}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Use template
            </button>
            {templateMenuOpen ? (
              <div className="absolute left-0 z-20 mt-1 w-64 rounded border border-gray-200 bg-white p-2 shadow-lg">
                <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  Starter templates
                </p>
                <div className="mt-1 space-y-1">
                  {WORKFLOW_TEMPLATES.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => addWorkflowFromTemplate(template.id)}
                      className="block w-full rounded border border-gray-200 px-2 py-2 text-left hover:bg-gray-50"
                    >
                      <p className="text-xs font-medium text-gray-800">{template.label}</p>
                      <p className="text-[11px] text-gray-500">{template.description}</p>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <button
            type="button"
            onClick={deleteWorkflow}
            disabled={!selectedWorkflow}
            className="rounded border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
          >
            {selectedWorkflow &&
            deleteIntent?.kind === "workflow" &&
            deleteIntent.id === selectedWorkflow.id
              ? "Confirm delete workflow"
              : "Delete workflow"}
          </button>

          <button
            type="button"
            onClick={() => void save()}
            disabled={isSaving || hasValidationErrors}
            className="rounded bg-[#EE2A2E] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#b50001] disabled:opacity-60"
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>

        <p className="mt-2 text-xs text-gray-500">
          Build rule logic entirely on the canvas. Operators are separate cards, not hidden settings.
        </p>
        <p className="mt-1 text-xs text-indigo-700">
          Conference rules override tenant rules when they conflict (specific beats general).
        </p>
        {hasValidationErrors ? (
          <p className="mt-1 text-xs text-rose-700">Resolve validation issues before saving.</p>
        ) : null}
      </div>

      {error ? (
        <div className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</div>
      ) : null}
      {success ? (
        <div className="rounded border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-700">{success}</div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-h-[680px] rounded-xl border border-gray-200 bg-[radial-gradient(circle,#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] p-6">
          {isLoading ? (
            <p className="text-sm text-gray-500">Loading workflows...</p>
          ) : !selectedWorkflow ? (
            <div className="mx-auto mt-20 max-w-sm rounded-xl border border-dashed border-gray-300 bg-white/90 p-6 text-center">
              <p className="text-sm font-medium text-gray-800">No workflow yet</p>
              <p className="mt-1 text-xs text-gray-500">Create one to start building rules visually.</p>
              <button
                type="button"
                onClick={addWorkflow}
                className="mt-4 rounded bg-[#EE2A2E] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#b50001]"
              >
                Create first workflow
              </button>
            </div>
          ) : (
            <div className="mx-auto max-w-[430px]">
              {steps.map((step, index) => {
                const selected =
                  (step.kind === "trigger" && selectedNode.kind === "trigger") ||
                  (step.kind === "condition" && selectedNode.kind === "condition" && selectedNode.id === step.token.id) ||
                  (step.kind === "operator" && selectedNode.kind === "operator" && selectedNode.id === step.token.id) ||
                  (step.kind === "branch" && selectedNode.kind === "branch" && selectedNode.id === step.token.id) ||
                  (step.kind === "action" && selectedNode.kind === "action" && selectedNode.id === step.actionId);

                return (
                  <div key={step.id} className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setAddMenu(null);
                        setCardMenu(null);
                        if (step.kind === "trigger") setSelectedNode({ kind: "trigger" });
                        if (step.kind === "condition") setSelectedNode({ kind: "condition", id: step.token.id });
                        if (step.kind === "operator") setSelectedNode({ kind: "operator", id: step.token.id });
                        if (step.kind === "branch") setSelectedNode({ kind: "branch", id: step.token.id });
                        if (step.kind === "action") setSelectedNode({ kind: "action", id: step.actionId });
                      }}
                      className={`w-full rounded-xl border bg-white p-3 text-left shadow-sm transition ${
                        selected ? "border-indigo-500 ring-2 ring-indigo-200" : "border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                            {step.kind === "trigger"
                              ? "Scope"
                              : step.kind === "condition"
                                ? "Condition"
                                : step.kind === "operator"
                                  ? "Flow control"
                                  : step.kind === "branch"
                                    ? "Branching"
                                  : "Then"}
                          </p>
                          <p className="mt-1">
                            {step.kind === "condition" && currentWorkflowValidation?.conditions[step.token.id] ? (
                              <span className="rounded bg-rose-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700">
                                Needs attention
                              </span>
                            ) : null}
                            {step.kind === "action" && currentWorkflowValidation?.actions[step.actionId] ? (
                              <span className="rounded bg-rose-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700">
                                Needs attention
                              </span>
                            ) : null}
                            {step.kind === "operator" && currentWorkflowValidation?.operators[step.token.id] ? (
                              <span className="rounded bg-rose-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700">
                                Needs attention
                              </span>
                            ) : null}
                            {step.kind === "branch" && currentWorkflowValidation?.branches[step.token.id] ? (
                              <span className="rounded bg-rose-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700">
                                Needs attention
                              </span>
                            ) : null}
                            {step.kind !== "trigger" &&
                            !(step.kind === "condition" && currentWorkflowValidation?.conditions[step.token.id]) &&
                            !(step.kind === "action" && currentWorkflowValidation?.actions[step.actionId]) &&
                            !(step.kind === "operator" && currentWorkflowValidation?.operators[step.token.id]) &&
                            !(step.kind === "branch" && currentWorkflowValidation?.branches[step.token.id]) ? (
                              <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                                Valid
                              </span>
                            ) : null}
                          </p>

                          <p className="mt-1 text-sm font-medium text-gray-900">
                            {step.kind === "trigger"
                              ? `${scopeLabel(selectedWorkflow.scope)} policy`
                              : step.kind === "condition"
                                ? clauseSummary(step.token)
                                : step.kind === "operator"
                                  ? step.token.operator.toUpperCase()
                                  : step.kind === "branch"
                                    ? step.token.kind === "group_start"
                                      ? "Start branch ("
                                      : "End branch )"
                                  : actionLabel(step.action)}
                          </p>
                          {step.kind === "condition" && currentWorkflowValidation?.conditions[step.token.id] ? (
                            <p className="mt-1 text-xs font-medium text-rose-700">
                              {currentWorkflowValidation.conditions[step.token.id]}
                            </p>
                          ) : null}
                          {step.kind === "action" && currentWorkflowValidation?.actions[step.actionId] ? (
                            <p className="mt-1 text-xs font-medium text-rose-700">
                              {currentWorkflowValidation.actions[step.actionId]}
                            </p>
                          ) : null}
                          {step.kind === "operator" && currentWorkflowValidation?.operators[step.token.id] ? (
                            <p className="mt-1 text-xs font-medium text-rose-700">
                              {currentWorkflowValidation.operators[step.token.id]}
                            </p>
                          ) : null}
                          {step.kind === "branch" && currentWorkflowValidation?.branches[step.token.id] ? (
                            <p className="mt-1 text-xs font-medium text-rose-700">
                              {currentWorkflowValidation.branches[step.token.id]}
                            </p>
                          ) : null}

                          <p className="mt-1 text-xs text-gray-500">
                            {step.kind === "trigger"
                              ? SCOPE_OPTIONS.find((entry) => entry.value === selectedWorkflow.scope)?.help
                              : step.kind === "condition"
                                ? "Checks one specific data rule."
                                : step.kind === "operator"
                                  ? "Combines adjacent conditions."
                                  : step.kind === "branch"
                                    ? "Groups conditions so you can branch logic anywhere."
                                  : actionSummary(step.action, products)}
                          </p>
                        </div>

                        {step.kind !== "trigger" ? (
                          <div className="relative">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                if (step.kind === "condition") {
                                  setCardMenu(
                                    cardMenu?.kind === "condition" && cardMenu.id === step.token.id
                                      ? null
                                      : { kind: "condition", id: step.token.id }
                                  );
                                }
                                if (step.kind === "operator") {
                                  setCardMenu(
                                    cardMenu?.kind === "operator" && cardMenu.id === step.token.id
                                      ? null
                                      : { kind: "operator", id: step.token.id }
                                  );
                                }
                                if (step.kind === "branch") {
                                  setCardMenu(
                                    cardMenu?.kind === "branch" && cardMenu.id === step.token.id
                                      ? null
                                      : { kind: "branch", id: step.token.id }
                                  );
                                }
                                if (step.kind === "action") {
                                  setCardMenu(
                                    cardMenu?.kind === "action" && cardMenu.id === step.actionId
                                      ? null
                                      : { kind: "action", id: step.actionId }
                                  );
                                }
                              }}
                              className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                            >
                              •••
                            </button>

                            {step.kind === "condition" &&
                            cardMenu?.kind === "condition" &&
                            cardMenu.id === step.token.id ? (
                              <div className="absolute right-0 z-20 mt-1 w-36 rounded border border-gray-200 bg-white py-1 shadow-lg">
                                <button
                                  type="button"
                                  onClick={() => deleteCondition(step.token.id)}
                                  className="block w-full px-3 py-1.5 text-left text-xs text-rose-700 hover:bg-rose-50"
                                >
                                  {deleteIntent?.kind === "condition" && deleteIntent.id === step.token.id
                                    ? "Confirm delete"
                                    : "Delete"}
                                </button>
                              </div>
                            ) : null}

                            {step.kind === "operator" &&
                            cardMenu?.kind === "operator" &&
                            cardMenu.id === step.token.id ? (
                              <div className="absolute right-0 z-20 mt-1 w-36 rounded border border-gray-200 bg-white py-1 shadow-lg">
                                <button
                                  type="button"
                                  onClick={() => deleteOperator(step.token.id)}
                                  className="block w-full px-3 py-1.5 text-left text-xs text-rose-700 hover:bg-rose-50"
                                >
                                  {deleteIntent?.kind === "operator" && deleteIntent.id === step.token.id
                                    ? "Confirm delete"
                                    : "Delete"}
                                </button>
                              </div>
                            ) : null}

                            {step.kind === "action" &&
                            cardMenu?.kind === "action" &&
                            cardMenu.id === step.actionId ? (
                              <div className="absolute right-0 z-20 mt-1 w-36 rounded border border-gray-200 bg-white py-1 shadow-lg">
                                <button
                                  type="button"
                                  onClick={() => deleteAction(step.actionId)}
                                  className="block w-full px-3 py-1.5 text-left text-xs text-rose-700 hover:bg-rose-50"
                                >
                                  {deleteIntent?.kind === "action" && deleteIntent.id === step.actionId
                                    ? "Confirm delete"
                                    : "Delete"}
                                </button>
                              </div>
                            ) : null}

                            {step.kind === "branch" &&
                            cardMenu?.kind === "branch" &&
                            cardMenu.id === step.token.id ? (
                              <div className="absolute right-0 z-20 mt-1 w-36 rounded border border-gray-200 bg-white py-1 shadow-lg">
                                <button
                                  type="button"
                                  onClick={() => deleteBranchToken(step.token.id)}
                                  className="block w-full px-3 py-1.5 text-left text-xs text-rose-700 hover:bg-rose-50"
                                >
                                  {deleteIntent?.kind === "branch" && deleteIntent.id === step.token.id
                                    ? "Confirm delete"
                                    : "Delete"}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </button>

                    <div className="flex flex-col items-center py-2">
                      <span className="h-4 w-px bg-indigo-300" />
                      <button
                        type="button"
                        onClick={() => setAddMenu({ position: index + 1 })}
                        data-add-menu-toggle="true"
                        className="h-7 w-7 rounded-full border border-indigo-400 bg-white text-sm font-semibold text-indigo-700 hover:bg-indigo-50"
                      >
                        +
                      </button>
                      <span className="h-4 w-px bg-indigo-300" />
                    </div>

                    {addMenu?.position === index + 1 ? (
                      <div
                        data-add-menu-root="true"
                        className="mx-auto mb-3 w-[300px] rounded-xl border border-gray-200 bg-white p-3 shadow-lg"
                      >
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Add step</p>

                        <div className="mt-2 space-y-2">
                          <div>
                            <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                              Top suggested
                            </p>
                            <div className="mt-1 grid grid-cols-2 gap-1">
                              <button
                                type="button"
                                disabled={!addMenuCapabilities.canAddCondition}
                                onClick={() => addConditionTokenAt(addMenu.position)}
                                className="rounded border border-gray-200 px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                              >
                                Condition
                              </button>
                              <button
                                type="button"
                                disabled={!addMenuCapabilities.canAddAction}
                                onClick={() => addActionAt(addMenu.position)}
                                className="rounded border border-gray-200 px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                              >
                                Action
                              </button>
                            </div>
                          </div>

                          <div>
                            <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                              Flow controls
                            </p>
                            <div className="mt-1 grid grid-cols-2 gap-1">
                              <button
                                type="button"
                                disabled={!addMenuCapabilities.canAddAnd}
                                onClick={() => addOperatorTokenAt(addMenu.position, "and")}
                                className="rounded border border-gray-200 px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                              >
                                AND
                              </button>
                              <button
                                type="button"
                                disabled={!addMenuCapabilities.canAddOr}
                                onClick={() => addOperatorTokenAt(addMenu.position, "or")}
                                className="rounded border border-gray-200 px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                              >
                                OR
                              </button>
                              <button
                                type="button"
                                disabled={!addMenuCapabilities.canAddBranchStart}
                                onClick={() => addBranchTokenAt(addMenu.position, "group_start")}
                                className="rounded border border-gray-200 px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                              >
                                Start branch (
                              </button>
                              <button
                                type="button"
                                disabled={!addMenuCapabilities.canAddBranchEnd}
                                onClick={() => addBranchTokenAt(addMenu.position, "group_end")}
                                className="rounded border border-gray-200 px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                              >
                                End branch )
                              </button>
                            </div>
                          </div>

                          <div>
                            <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                              Conditions
                            </p>
                            <button
                              type="button"
                              disabled={!addMenuCapabilities.canAddCondition}
                              onClick={() => addConditionTokenAt(addMenu.position)}
                              className="mt-1 block w-full rounded border border-gray-200 px-2 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                            >
                              Compare organization or product data
                            </button>
                          </div>

                          <div>
                            <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                              Actions
                            </p>
                            <div className="mt-1 grid grid-cols-1 gap-1">
                              {selectedWorkflowActionOptions.map((option) => (
                                <button
                                  key={option.value}
                                  type="button"
                                  disabled={!addMenuCapabilities.canAddAction}
                                  onClick={() => addActionAt(addMenu.position, option.value)}
                                  className="rounded border border-gray-200 px-2 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                                >
                                  {option.label}
                                </button>
                              ))}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => setAddMenu(null)}
                            className="mt-2 block w-full rounded border border-gray-200 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-700">Inspector</p>

          {!selectedWorkflow ? (
            <p className="mt-3 text-sm text-gray-500">Select a workflow to configure.</p>
          ) : (
            <div className="mt-3 space-y-3">
              {selectedNode.kind === "workflow" ? (
                <>
                  {currentWorkflowValidation?.workflow.length ? (
                    <div className="rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
                      {currentWorkflowValidation.workflow[0]}
                    </div>
                  ) : null}
                  <label className="block text-xs text-gray-700">
                    Workflow name
                    <input
                      type="text"
                      value={selectedWorkflow.name}
                      onChange={(event) =>
                        updateSelectedWorkflow((workflow) => ({ ...workflow, name: event.target.value }))
                      }
                      className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                    />
                  </label>

                  <label className="block text-xs text-gray-700">
                    Workflow active
                    <span className="mt-1 flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedWorkflow.enabled}
                        onChange={(event) =>
                          updateSelectedWorkflow((workflow) => ({ ...workflow, enabled: event.target.checked }))
                        }
                      />
                      <span className="text-xs text-gray-700">Enabled</span>
                    </span>
                  </label>

                  <label className="block text-xs text-gray-700">
                    Matching behavior
                    <select
                      value={selectedWorkflow.modifier}
                      onChange={(event) =>
                        updateSelectedWorkflow((workflow) => ({
                          ...workflow,
                          modifier: event.target.value as "none" | "first_match_only",
                        }))
                      }
                      className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                    >
                      <option value="none">Run all matching workflows</option>
                      <option value="first_match_only">Stop after first match</option>
                    </select>
                  </label>
                </>
              ) : null}

              {selectedNode.kind === "trigger" ? (
                <label className="block text-xs text-gray-700">
                  Policy scope
                  <select
                    value={selectedWorkflow.scope}
                    onChange={(event) =>
                      updateSelectedWorkflow((workflow) => ({
                        ...workflow,
                        scope: event.target.value as RulesEngineScope,
                        hold_until_checkout_complete_or_logout:
                          event.target.value === "commerce"
                            ? true
                            : workflow.hold_until_checkout_complete_or_logout,
                        trigger: {
                          ...workflow.trigger,
                          trigger: defaultTriggerForScope(event.target.value as RulesEngineScope),
                        },
                      }))
                    }
                    className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                  >
                    {SCOPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-gray-500">
                    {SCOPE_OPTIONS.find((option) => option.value === selectedWorkflow.scope)?.help}
                  </p>
                  {selectedWorkflow.scope === "commerce" ? (
                    <>
                      <p className="mt-2 text-[11px] text-gray-500">
                        Commerce rules are held until checkout is complete or the user logs out.
                      </p>
                      <label className="mt-2 block text-xs text-gray-700">
                        Conflict message template
                        <input
                          type="text"
                          value={selectedWorkflow.conflict_message_template ?? ""}
                          onChange={(event) =>
                            updateSelectedWorkflow((workflow) => ({
                              ...workflow,
                              conflict_message_template: event.target.value,
                            }))
                          }
                          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                        />
                      </label>
                    </>
                  ) : null}
                </label>
              ) : null}

              {selectedNode.kind === "condition" && selectedCondition ? (
                <>
                  <p className="text-xs text-gray-600">Configure this condition step.</p>

                  <label className="block text-xs text-gray-700">
                    Data to check
                    <select
                      value={selectedCondition.field}
                      onChange={(event) =>
                        updateConditionField(
                          selectedCondition,
                          event.target.value as RulesEngineConditionClause["field"]
                        )
                      }
                      className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                    >
                      {FIELD_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block text-xs text-gray-700">
                    Logic
                    <select
                      value={selectedCondition.op}
                      onChange={(event) =>
                        updateConditionOperator(
                          selectedCondition,
                          event.target.value as RulesEngineConditionClause["op"]
                        )
                      }
                      className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                    >
                      {selectedConditionOperatorOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  {operatorNeedsValue(selectedCondition.op) &&
                  getConditionValueKind(selectedCondition.field) === "number" ? (
                    <label className="block text-xs text-gray-700">
                      Value
                      <input
                        type="number"
                        value={Number.isFinite(Number(selectedCondition.value)) ? Number(selectedCondition.value) : 0}
                        onChange={(event) =>
                          updateCondition(selectedCondition.id, {
                            value: Number(event.target.value),
                          })
                        }
                        className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                      />
                    </label>
                  ) : null}

                  {operatorNeedsValue(selectedCondition.op) &&
                  getConditionValueKind(selectedCondition.field) === "enum" ? (
                    <label className="block text-xs text-gray-700">
                      Value
                      <select
                        value={String(selectedCondition.value ?? "")}
                        onChange={(event) =>
                          updateCondition(selectedCondition.id, {
                            value: event.target.value,
                          })
                        }
                        className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                      >
                        {selectedConditionValueOptions.length === 0 ? (
                          <option value="">No tenant values found</option>
                        ) : null}
                        {selectedConditionValueOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </>
              ) : null}

              {selectedNode.kind === "operator" && selectedOperator ? (
                <>
                  <p className="text-xs text-gray-600">Configure this flow-control step.</p>
                  <label className="block text-xs text-gray-700">
                    Operator
                    <select
                      value={selectedOperator.operator}
                      onChange={(event) => updateOperator(selectedOperator.id, event.target.value as "and" | "or")}
                      className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                    >
                      <option value="and">AND</option>
                      <option value="or">OR</option>
                    </select>
                  </label>
                </>
              ) : null}

              {selectedNode.kind === "branch" && selectedBranchToken ? (
                <>
                  <p className="text-xs text-gray-600">Branch step groups conditions into a nested expression.</p>
                  <div className="rounded border border-gray-200 bg-gray-50 p-2 text-xs text-gray-700">
                    {selectedBranchToken.kind === "group_start"
                      ? "This marks the start of a branch group: ("
                      : "This marks the end of a branch group: )"}
                  </div>
                  {currentWorkflowValidation?.branches[selectedBranchToken.id] ? (
                    <p className="text-xs font-medium text-rose-700">
                      {currentWorkflowValidation.branches[selectedBranchToken.id]}
                    </p>
                  ) : null}
                </>
              ) : null}

              {selectedNode.kind === "action" && selectedAction ? (
                <>
                  <p className="text-xs text-gray-600">Configure this action step.</p>

                  <label className="block text-xs text-gray-700">
                    Action type
                    <select
                      value={selectedAction.type}
                      onChange={(event) =>
                        replaceActionType(selectedAction.id, event.target.value as RulesEngineAction["type"])
                      }
                      className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                    >
                      {!isActionAllowedForScope(selectedWorkflow.scope, selectedAction.type) ? (
                        <option value={selectedAction.type}>
                          {actionLabel(selectedAction)} (not allowed for scope)
                        </option>
                      ) : null}
                      {selectedWorkflowActionOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block text-xs text-gray-700">
                    Apply to product
                    <select
                      value={(selectedAction as { target_product_id?: string }).target_product_id ?? ""}
                      onChange={(event) => {
                        const product = products.find((entry) => entry.id === event.target.value);
                        updateAction(selectedAction.id, {
                          target_product_id: event.target.value || undefined,
                          target_product_slug: product?.slug,
                        });
                      }}
                      className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                    >
                      <option value="">Any product</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  {selectedAction.type === "block_purchase" ? (
                    <label className="block text-xs text-gray-700">
                      Message shown to attendee
                      <input
                        type="text"
                        value={selectedAction.message}
                        onChange={(event) =>
                          updateAction(selectedAction.id, { message: event.target.value })
                        }
                        className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                      />
                    </label>
                  ) : null}

                  {selectedAction.type === "set_product_visibility" ? (
                    <>
                      <label className="block text-xs text-gray-700">
                        Visibility
                        <select
                          value={String(selectedAction.visible)}
                          onChange={(event) =>
                            updateAction(selectedAction.id, {
                              visible: event.target.value === "true",
                            })
                          }
                          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                        >
                          <option value="true">Show product</option>
                          <option value="false">Hide product</option>
                        </select>
                      </label>
                      <label className="block text-xs text-gray-700">
                        Reason
                        <input
                          type="text"
                          value={selectedAction.reason ?? ""}
                          onChange={(event) => updateAction(selectedAction.id, { reason: event.target.value })}
                          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                        />
                      </label>
                    </>
                  ) : null}

                  {selectedAction.type === "apply_price_override_cents" ? (
                    <>
                      <label className="block text-xs text-gray-700">
                        Exact price (cents)
                        <input
                          type="number"
                          min={0}
                          value={selectedAction.amount_cents}
                          onChange={(event) =>
                            updateAction(selectedAction.id, {
                              amount_cents: Number(event.target.value),
                            })
                          }
                          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                        />
                      </label>
                      <label className="block text-xs text-gray-700">
                        Reason
                        <input
                          type="text"
                          value={selectedAction.reason ?? ""}
                          onChange={(event) => updateAction(selectedAction.id, { reason: event.target.value })}
                          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                        />
                      </label>
                    </>
                  ) : null}

                  {selectedAction.type === "apply_discount_percent" ? (
                    <>
                      <label className="block text-xs text-gray-700">
                        Discount percent
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={selectedAction.percent}
                          onChange={(event) =>
                            updateAction(selectedAction.id, {
                              percent: Number(event.target.value),
                            })
                          }
                          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                        />
                      </label>
                      <label className="block text-xs text-gray-700">
                        Reason
                        <input
                          type="text"
                          value={selectedAction.reason ?? ""}
                          onChange={(event) => updateAction(selectedAction.id, { reason: event.target.value })}
                          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                        />
                      </label>
                    </>
                  ) : null}

                  {selectedAction.type === "set_travel_support_mode" ? (
                    <>
                      <label className="block text-xs text-gray-700">
                        Travel support mode
                        <select
                          value={selectedAction.mode}
                          onChange={(event) =>
                            updateAction(selectedAction.id, {
                              mode: event.target.value as
                                | "managed"
                                | "reimbursement"
                                | "self_managed"
                                | "none",
                            })
                          }
                          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                        >
                          <option value="managed">Managed by organizer</option>
                          <option value="reimbursement">Self-booked with reimbursement</option>
                          <option value="self_managed">Self-managed</option>
                          <option value="none">No travel support</option>
                        </select>
                      </label>

                      <label className="block text-xs text-gray-700">
                        Reason
                        <input
                          type="text"
                          value={selectedAction.reason ?? ""}
                          onChange={(event) => updateAction(selectedAction.id, { reason: event.target.value })}
                          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                        />
                      </label>
                    </>
                  ) : null}

                  {selectedAction.type === "set_travel_requirement" ? (
                    <>
                      <label className="block text-xs text-gray-700">
                        Requirement
                        <select
                          value={selectedAction.requirement}
                          onChange={(event) =>
                            updateAction(selectedAction.id, {
                              requirement: event.target.value as
                                | "air_travel_allowed"
                                | "requires_travel_intake"
                                | "requires_accommodation_intake",
                            })
                          }
                          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                        >
                          <option value="air_travel_allowed">Allow air travel</option>
                          <option value="requires_travel_intake">Require travel intake form</option>
                          <option value="requires_accommodation_intake">Require accommodation intake form</option>
                        </select>
                      </label>

                      <label className="block text-xs text-gray-700">
                        Value
                        <select
                          value={String(selectedAction.value)}
                          onChange={(event) =>
                            updateAction(selectedAction.id, {
                              value: event.target.value === "true",
                            })
                          }
                          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                        >
                          <option value="true">Yes</option>
                          <option value="false">No</option>
                        </select>
                      </label>

                      <label className="block text-xs text-gray-700">
                        Reason
                        <input
                          type="text"
                          value={selectedAction.reason ?? ""}
                          onChange={(event) => updateAction(selectedAction.id, { reason: event.target.value })}
                          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
                        />
                      </label>
                    </>
                  ) : null}
                </>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
