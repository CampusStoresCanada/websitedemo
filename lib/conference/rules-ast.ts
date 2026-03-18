import {
  emptyRulesEngine,
  evaluateRulesEngine,
  normalizeRulesEngine,
  type RulesEngineAction,
  type RulesEngineConditionClause,
  type RulesEngineConditionGroup,
  type RulesEngineConditionNode,
  type RulesEngineEvalContext,
  type RulesEngineEvaluation,
  type RulesEngineModifier,
  type RulesEngineScope,
  type RulesEngineTrigger,
  type RulesEngineV1,
  type RulesEngineWorkflow,
} from "./rules-engine";

export type RulesAstConditionToken =
  | RulesEngineConditionClause
  | {
      id: string;
      kind: "logic_operator";
      operator: "and" | "or";
    }
  | {
      id: string;
      kind: "group_start";
    }
  | {
      id: string;
      kind: "group_end";
    };

export type RulesAstWorkflow = {
  id: string;
  name: string;
  enabled: boolean;
  order: number;
  scope: RulesEngineScope;
  hold_until_checkout_complete_or_logout: boolean;
  conflict_message_template?: string;
  precedence?: "tenant" | "conference";
  modifier: RulesEngineModifier;
  notes?: string;
  trigger: {
    id: string;
    kind: "trigger";
    trigger: RulesEngineTrigger;
  };
  conditions: {
    id: string;
    kind: "condition_expression";
    tokens: RulesAstConditionToken[];
  };
  actions: Array<{
    id: string;
    kind: "action";
    action: RulesEngineAction;
  }>;
};

export type RulesAstV1 = {
  version: 1;
  workflows: RulesAstWorkflow[];
  updated_at?: string;
};

export function emptyRulesAst(): RulesAstV1 {
  return {
    version: 1,
    workflows: [],
  };
}

export function rulesEngineToAst(engine: RulesEngineV1): RulesAstV1 {
  const normalized = normalizeRulesEngine(engine);
  return {
    version: 1,
    updated_at: normalized.updated_at,
    workflows: normalized.workflows.map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      enabled: workflow.enabled,
      order: workflow.order,
      scope: workflow.scope,
      hold_until_checkout_complete_or_logout: workflow.hold_until_checkout_complete_or_logout,
      conflict_message_template: workflow.conflict_message_template,
      precedence: workflow.precedence,
      modifier: workflow.modifier,
      notes: workflow.notes,
      trigger: {
        id: `${workflow.id}__trigger`,
        kind: "trigger",
        trigger: workflow.trigger,
      },
      conditions: {
        id: `${workflow.id}__conditions`,
        kind: "condition_expression",
        tokens: conditionGroupToTokens(workflow.conditions),
      },
      actions: workflow.actions.map((action) => ({
        id: action.id,
        kind: "action",
        action,
      })),
    })),
  };
}

export function rulesAstToRulesEngine(ast: RulesAstV1): RulesEngineV1 {
  const workflows: RulesEngineWorkflow[] = ast.workflows.map((workflow, index) => {
    const parsed = parseConditionTokens(workflow.conditions.tokens);
    const conditions = parsed ? toConditionGroup(parsed) : defaultConditionGroup();
    const scope = workflow.scope ?? "commerce";
    return {
      id: workflow.id,
      name: workflow.name || `Workflow ${index + 1}`,
      enabled: workflow.enabled !== false,
      order: Number.isFinite(workflow.order) ? workflow.order : index,
      trigger: workflow.trigger.trigger,
      scope,
      hold_until_checkout_complete_or_logout:
        scope === "commerce"
          ? workflow.hold_until_checkout_complete_or_logout !== false
          : false,
      conflict_message_template: workflow.conflict_message_template ?? "",
      precedence: workflow.precedence,
      modifier: workflow.modifier === "first_match_only" ? "first_match_only" : "none",
      conditions,
      actions: workflow.actions.map((entry) => entry.action),
      notes: workflow.notes ?? "",
    };
  });
  return normalizeRulesEngine({
    version: 1,
    workflows,
    updated_at: ast.updated_at,
  });
}

export function evaluateRulesAst(
  ast: RulesAstV1,
  trigger: RulesEngineTrigger,
  context: RulesEngineEvalContext
): RulesEngineEvaluation {
  return evaluateRulesEngine(rulesAstToRulesEngine(ast), trigger, context);
}

type ParsedExpression = {
  node: RulesEngineConditionNode;
  nextIndex: number;
};

function conditionGroupToTokens(group: RulesEngineConditionGroup): RulesAstConditionToken[] {
  const tokens: RulesAstConditionToken[] = [];
  emitGroup(group, tokens);
  return tokens;
}

function emitGroup(group: RulesEngineConditionGroup, out: RulesAstConditionToken[]): void {
  group.children.forEach((child, childIndex) => {
    if (child.kind === "group") {
      out.push({
        id: `${child.id}__start`,
        kind: "group_start",
      });
      emitGroup(child, out);
      out.push({
        id: `${child.id}__end`,
        kind: "group_end",
      });
    } else {
      out.push(child);
    }

    if (childIndex < group.children.length - 1) {
      out.push({
        id: `${group.id}__op_${childIndex}`,
        kind: "logic_operator",
        operator: group.operator,
      });
    }
  });
}

function parseConditionTokens(tokens: RulesAstConditionToken[]): RulesEngineConditionNode | null {
  const clausesOnly = tokens.filter((token): token is RulesEngineConditionClause => token.kind === "clause");
  if (tokens.length === 0) return null;
  if (clausesOnly.length === 0) return null;

  const parsed = parseExpression(tokens, 0);
  if (!parsed) return null;
  return parsed.node;
}

function parseExpression(tokens: RulesAstConditionToken[], startIndex: number): ParsedExpression | null {
  let current = parsePrimary(tokens, startIndex);
  if (!current) return null;

  while (current.nextIndex < tokens.length) {
    const token: RulesAstConditionToken = tokens[current.nextIndex];
    if (token.kind === "group_end") {
      break;
    }
    if (token.kind !== "logic_operator") {
      break;
    }

    const right = parsePrimary(tokens, current.nextIndex + 1);
    if (!right) break;
    current = {
      node: {
        id: token.id || makeId("group"),
        kind: "group",
        operator: token.operator,
        children: [current.node, right.node],
      },
      nextIndex: right.nextIndex,
    };
  }

  return current;
}

function parsePrimary(tokens: RulesAstConditionToken[], startIndex: number): ParsedExpression | null {
  if (startIndex >= tokens.length) return null;
  const token = tokens[startIndex];

  if (token.kind === "clause") {
    return {
      node: token,
      nextIndex: startIndex + 1,
    };
  }

  if (token.kind !== "group_start") return null;

  const inner = parseExpression(tokens, startIndex + 1);
  if (!inner) return null;
  if (inner.nextIndex >= tokens.length) return null;
  const end = tokens[inner.nextIndex];
  if (end.kind !== "group_end") return null;

  return {
    node: withGroupId(inner.node, token.id.replace(/__start$/, "") || makeId("group")),
    nextIndex: inner.nextIndex + 1,
  };
}

function withGroupId(node: RulesEngineConditionNode, id: string): RulesEngineConditionNode {
  if (node.kind === "group") {
    return {
      ...node,
      id,
    };
  }
  return {
    id,
    kind: "group",
    operator: "and",
    children: [node],
  };
}

function toConditionGroup(node: RulesEngineConditionNode): RulesEngineConditionGroup {
  if (node.kind === "group") return node;
  return {
    id: makeId("group"),
    kind: "group",
    operator: "and",
    children: [node],
  };
}

function defaultConditionGroup(): RulesEngineConditionGroup {
  return {
    id: makeId("group"),
    kind: "group",
    operator: "and",
    children: [],
  };
}

function makeId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeRulesAst(raw: unknown): RulesAstV1 {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return emptyRulesAst();
  }
  const input = raw as Record<string, unknown>;
  const candidate = {
    version: 1,
    workflows: Array.isArray(input.workflows) ? input.workflows : [],
    updated_at: typeof input.updated_at === "string" ? input.updated_at : undefined,
  };
  const asEngine = rulesAstToRulesEngine(candidate as RulesAstV1);
  return rulesEngineToAst(asEngine);
}

export function normalizeRulesEngineFromAst(raw: unknown): RulesEngineV1 {
  return rulesAstToRulesEngine(normalizeRulesAst(raw));
}

export function rulesEngineToCanonicalAst(engine: RulesEngineV1): RulesAstV1 {
  return rulesEngineToAst(engine);
}

export function canonicalAstToRulesEngine(ast: RulesAstV1): RulesEngineV1 {
  return rulesAstToRulesEngine(ast);
}

export function ensureCanonicalRulesAst(engineOrAst: unknown): RulesAstV1 {
  const ast = normalizeRulesAst(engineOrAst);
  if (ast.workflows.length > 0) return ast;
  if (!engineOrAst || typeof engineOrAst !== "object" || Array.isArray(engineOrAst)) {
    return emptyRulesAst();
  }
  return rulesEngineToAst(normalizeRulesEngine(engineOrAst));
}

export function ensureRulesEngineFromUnknown(raw: unknown): RulesEngineV1 {
  const asAst = ensureCanonicalRulesAst(raw);
  const fromAst = rulesAstToRulesEngine(asAst);
  if (fromAst.workflows.length > 0) return fromAst;
  return normalizeRulesEngine(raw ?? emptyRulesEngine());
}
