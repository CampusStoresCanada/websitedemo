/**
 * Validation for `programs.definitions` — the policy key that defines which
 * membership programs a deployment offers.
 *
 * Split in two deliberately, because the two halves can't run in the same place:
 *
 *  - `PROGRAMS_DEFINITIONS_SCHEMA` is pure JSON Schema (shape, types, enums).
 *    It runs through AJV on every draft edit, so a malformed program is
 *    rejected as it's typed.
 *  - `validateProgramsSemantics` covers what JSON Schema can't express:
 *    cross-item uniqueness, and whether an `orgTypeValue` corresponds to an
 *    org type that actually exists. That needs the full array (and the DB), so
 *    it runs at pre-publish validation instead.
 *
 * Getting either wrong is expensive: `program_key` is what every read path
 * resolves through (pricing, permissions, conference tier, the membership
 * mirror). A duplicate or dangling `orgTypeValue` silently resolves the wrong
 * program — or none — rather than failing loudly.
 */
import type { MembershipProgramDef } from "./types";

export const PROGRAMS_DEFINITIONS_SCHEMA = {
  type: "array",
  minItems: 1,
  items: {
    type: "object",
    additionalProperties: false,
    required: [
      "key",
      "orgTypeValue",
      "label",
      "permissionLevel",
      "orgAdminElevates",
      "conferenceTier",
      "invoiceType",
      "billing",
    ],
    properties: {
      key: { type: "string", minLength: 1, pattern: "^[a-z0-9_]+$" },
      orgTypeValue: { type: "string", minLength: 1 },
      label: { type: "string", minLength: 1 },
      permissionLevel: { enum: ["member", "partner"] },
      orgAdminElevates: { type: "boolean" },
      conferenceTier: { type: "string", minLength: 1 },
      invoiceType: { type: "string", minLength: 1 },
      billing: {
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["mode"],
            properties: { mode: { const: "metric_engine" } },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["mode", "rateCents"],
            properties: {
              mode: { const: "flat_rate" },
              rateCents: { type: "integer", minimum: 0 },
            },
          },
        ],
      },
    },
  },
} as const;

/**
 * Checks that JSON Schema cannot express. `orgTypesInUse` is the set of
 * distinct `organizations.type` values present in the deployment; pass an
 * empty set to skip the dangling-reference check (e.g. a fresh deployment
 * with no orgs yet, where every reference is legitimately unresolved).
 */
export function validateProgramsSemantics(
  programs: MembershipProgramDef[],
  orgTypesInUse: Set<string>
): string[] {
  const errors: string[] = [];

  const seenKeys = new Map<string, number>();
  const seenOrgTypes = new Map<string, number>();

  programs.forEach((p, i) => {
    const priorKey = seenKeys.get(p.key);
    if (priorKey !== undefined) {
      errors.push(
        `duplicate program key "${p.key}" at positions ${priorKey + 1} and ${i + 1} — ` +
          `program_key is the join between memberships rows and this config, so it must be unique`
      );
    } else {
      seenKeys.set(p.key, i);
    }

    const priorType = seenOrgTypes.get(p.orgTypeValue);
    if (priorType !== undefined) {
      errors.push(
        `duplicate orgTypeValue "${p.orgTypeValue}" at positions ${priorType + 1} and ${i + 1} — ` +
          `org type resolves to exactly one program, so two programs cannot claim the same type`
      );
    } else {
      seenOrgTypes.set(p.orgTypeValue, i);
    }
  });

  if (orgTypesInUse.size > 0) {
    for (const p of programs) {
      if (!orgTypesInUse.has(p.orgTypeValue)) {
        errors.push(
          `program "${p.key}" references orgTypeValue "${p.orgTypeValue}", which no organization has — ` +
            `orgs of that type would resolve to no program at all`
        );
      }
    }
  }

  return errors;
}
