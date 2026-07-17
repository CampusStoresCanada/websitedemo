import { describe, expect, it } from "vitest";
import {
  isPolicyRequired,
  requiredPolicyEntityIds,
  type PolicyTargeting,
} from "../legal-policies";

// Mirrors the Trial Conference wiring:
//  - T&C / Privacy        → universal (applies_to_all)
//  - Member CoC           → who member
//  - Vendor CoC           → who partner
//  - Exhibitor Agreement  → required by the "Connected Exhibitor Staff Registration" entity
//  - Speaker Agreement    → parked (no targeting)
const CONNECTED_REG = "entity-connected-reg";
const policies: PolicyTargeting[] = [
  { policyEntityId: "tc", appliesToAll: true, whoSourceRoles: [], requiredByEntityIds: [], acceptBy: "both" },
  { policyEntityId: "privacy", appliesToAll: true, whoSourceRoles: [], requiredByEntityIds: [], acceptBy: "assignee" },
  { policyEntityId: "member-coc", appliesToAll: false, whoSourceRoles: ["member"], requiredByEntityIds: [], acceptBy: "assignee" },
  { policyEntityId: "vendor-coc", appliesToAll: false, whoSourceRoles: ["partner"], requiredByEntityIds: [], acceptBy: "assignee" },
  { policyEntityId: "exhibitor", appliesToAll: false, whoSourceRoles: [], requiredByEntityIds: [CONNECTED_REG], acceptBy: "buyer" },
  { policyEntityId: "speaker", appliesToAll: false, whoSourceRoles: [], requiredByEntityIds: [], acceptBy: "assignee" },
];

describe("legal policy resolution", () => {
  it("a delegate (member, holds nothing) gets universal + member docs only", () => {
    const required = requiredPolicyEntityIds(policies, {
      audienceSourceRoles: ["member"],
      heldEntityIds: [],
    });
    expect([...required].sort()).toEqual(["member-coc", "privacy", "tc"]);
  });

  it("an exhibitor (partner, holds nothing) gets universal + vendor docs, NOT the booth agreement", () => {
    const required = requiredPolicyEntityIds(policies, {
      audienceSourceRoles: ["partner"],
      heldEntityIds: [],
    });
    expect([...required].sort()).toEqual(["privacy", "tc", "vendor-coc"]);
    expect(required.has("exhibitor")).toBe(false);
  });

  it("holding the Connected Exhibitor registration pulls in the booth agreement", () => {
    const required = requiredPolicyEntityIds(policies, {
      audienceSourceRoles: ["partner"],
      heldEntityIds: [CONNECTED_REG],
    });
    expect(required.has("exhibitor")).toBe(true);
    expect([...required].sort()).toEqual(["exhibitor", "privacy", "tc", "vendor-coc"]);
  });

  it("at checkout (buyer) only buyer/both docs are required", () => {
    const required = requiredPolicyEntityIds(policies, {
      audienceSourceRoles: ["partner"],
      heldEntityIds: [CONNECTED_REG],
      role: "buyer",
    });
    // Booth agreement (buyer) + T&C (both); conduct/release (assignee) are excluded.
    expect([...required].sort()).toEqual(["exhibitor", "tc"]);
  });

  it("at seat activation (assignee) only assignee/both docs are required", () => {
    const required = requiredPolicyEntityIds(policies, {
      audienceSourceRoles: ["partner"],
      heldEntityIds: [CONNECTED_REG],
      role: "assignee",
    });
    // Conduct/release/privacy + T&C (both); the buyer-only booth agreement is excluded.
    expect([...required].sort()).toEqual(["privacy", "tc", "vendor-coc"]);
    expect(required.has("exhibitor")).toBe(false);
  });

  it("a parked policy (no targeting) is never required", () => {
    const speaker = policies.find((p) => p.policyEntityId === "speaker")!;
    expect(isPolicyRequired(speaker, { audienceSourceRoles: ["member", "partner"], heldEntityIds: [CONNECTED_REG] })).toBe(false);
  });

  it("universal policies apply regardless of audience or holdings", () => {
    const tc = policies.find((p) => p.policyEntityId === "tc")!;
    expect(isPolicyRequired(tc, { audienceSourceRoles: [], heldEntityIds: [] })).toBe(true);
  });
});
