import { describe, expect, it } from "vitest";
import {
  canonicalAstToRulesEngine,
  evaluateRulesAst,
  rulesEngineToCanonicalAst,
} from "../rules-ast";
import {
  evaluateRulesEngine,
  type RulesEngineV1,
  type RulesEngineEvalContext,
} from "../rules-engine";

function sampleEngine(): RulesEngineV1 {
  return {
    version: 1,
    workflows: [
      {
        id: "wf_checkout",
        name: "Checkout Guard",
        enabled: true,
        order: 0,
        trigger: "checkout_attempt",
        scope: "commerce",
        hold_until_checkout_complete_or_logout: true,
        modifier: "none",
        notes: "",
        conditions: {
          id: "group_root_1",
          kind: "group",
          operator: "and",
          children: [
            {
              id: "c_membership",
              kind: "clause",
              field: "org.membership_status",
              op: "equals",
              value: "active",
            },
            {
              id: "group_or",
              kind: "group",
              operator: "or",
              children: [
                {
                  id: "c_slug",
                  kind: "clause",
                  field: "product.slug",
                  op: "equals",
                  value: "delegate_pass",
                },
                {
                  id: "c_count",
                  kind: "clause",
                  field: "org.registration_count",
                  op: "gte",
                  value: 2,
                },
              ],
            },
          ],
        },
        actions: [
          {
            id: "a_price",
            type: "apply_price_override_cents",
            amount_cents: 25000,
          },
          {
            id: "a_block",
            type: "block_purchase",
            message: "Blocked for policy test.",
          },
        ],
      },
      {
        id: "wf_travel",
        name: "Travel Intake",
        enabled: true,
        order: 1,
        trigger: "travel_intake_save",
        scope: "travel",
        hold_until_checkout_complete_or_logout: false,
        modifier: "first_match_only",
        notes: "",
        conditions: {
          id: "group_root_2",
          kind: "group",
          operator: "and",
          children: [
            {
              id: "c_type",
              kind: "clause",
              field: "org.type",
              op: "equals",
              value: "vendor_partner",
            },
          ],
        },
        actions: [
          {
            id: "a_travel_mode",
            type: "set_travel_support_mode",
            mode: "reimbursement",
          },
          {
            id: "a_travel_req",
            type: "set_travel_requirement",
            requirement: "requires_travel_intake",
            value: true,
          },
        ],
      },
    ],
  };
}

const CHECKOUT_MATCH_CONTEXT: RulesEngineEvalContext = {
  org_membership_status: "active",
  org_type: "member",
  org_registration_count: 0,
  user_is_authenticated: true,
  product_id: "prod_1",
  product_slug: "delegate_pass",
};

const CHECKOUT_NO_MATCH_CONTEXT: RulesEngineEvalContext = {
  org_membership_status: "inactive",
  org_type: "member",
  org_registration_count: 0,
  user_is_authenticated: true,
  product_id: "prod_1",
  product_slug: "delegate_pass",
};

const TRAVEL_MATCH_CONTEXT: RulesEngineEvalContext = {
  org_membership_status: "active",
  org_type: "vendor_partner",
  org_registration_count: 1,
  user_is_authenticated: true,
  product_id: "prod_2",
  product_slug: "vendor_booth",
};

describe("rules AST canonical adapters", () => {
  it("preserves trigger behavior across engine -> AST -> engine conversion", () => {
    const engine = sampleEngine();
    const ast = rulesEngineToCanonicalAst(engine);
    const convertedEngine = canonicalAstToRulesEngine(ast);

    const checkoutBefore = evaluateRulesEngine(engine, "checkout_attempt", CHECKOUT_MATCH_CONTEXT);
    const checkoutAfter = evaluateRulesEngine(convertedEngine, "checkout_attempt", CHECKOUT_MATCH_CONTEXT);
    expect(checkoutAfter.matchedWorkflows.map((wf) => wf.id)).toEqual(
      checkoutBefore.matchedWorkflows.map((wf) => wf.id)
    );
    expect(checkoutAfter.actions.map((action) => action.id)).toEqual(
      checkoutBefore.actions.map((action) => action.id)
    );

    const noMatchBefore = evaluateRulesEngine(engine, "checkout_attempt", CHECKOUT_NO_MATCH_CONTEXT);
    const noMatchAfter = evaluateRulesEngine(convertedEngine, "checkout_attempt", CHECKOUT_NO_MATCH_CONTEXT);
    expect(noMatchAfter.matchedWorkflows.map((wf) => wf.id)).toEqual(
      noMatchBefore.matchedWorkflows.map((wf) => wf.id)
    );
    expect(noMatchAfter.actions.map((action) => action.id)).toEqual(
      noMatchBefore.actions.map((action) => action.id)
    );

    const travelBefore = evaluateRulesEngine(engine, "travel_intake_save", TRAVEL_MATCH_CONTEXT);
    const travelAfter = evaluateRulesEngine(convertedEngine, "travel_intake_save", TRAVEL_MATCH_CONTEXT);
    expect(travelAfter.matchedWorkflows.map((wf) => wf.id)).toEqual(
      travelBefore.matchedWorkflows.map((wf) => wf.id)
    );
    expect(travelAfter.actions.map((action) => action.id)).toEqual(
      travelBefore.actions.map((action) => action.id)
    );
  });

  it("evaluates AST directly with identical outcomes", () => {
    const engine = sampleEngine();
    const ast = rulesEngineToCanonicalAst(engine);
    const fromEngine = evaluateRulesEngine(engine, "checkout_attempt", CHECKOUT_MATCH_CONTEXT);
    const fromAst = evaluateRulesAst(ast, "checkout_attempt", CHECKOUT_MATCH_CONTEXT);
    expect(fromAst.matchedWorkflows.map((wf) => wf.id)).toEqual(fromEngine.matchedWorkflows.map((wf) => wf.id));
    expect(fromAst.actions.map((action) => action.type)).toEqual(fromEngine.actions.map((action) => action.type));
  });
});
