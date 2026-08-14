import type { MembershipProgramDef } from "@/lib/policy/types";
import type { OrgRole } from "@/lib/auth/types";
import { PERSONAS, type Persona } from "./steps";

/**
 * Single source of truth for turning an org membership into an onboarding
 * persona — replaces what used to be 4 independent reimplementations of
 * the same org.type + role → persona mapping (lib/actions/onboarding.ts's
 * derivePersona, OrgOnboardingCallout.tsx's and
 * DirectoryOnboardingCallout.tsx's deriveLocalPersona, and an inline
 * reverse-derivation in OnboardingGate.tsx), the same class of duplication
 * already fixed for permissions via lib/auth/org-level.ts's
 * resolveOrgLevel.
 */

export interface MembershipFact {
  orgType: string | null | undefined;
  role: OrgRole | string;
}

/**
 * The persona-naming formula: `${role}_${programKey}`. Pulled out as its
 * own pure function (no lookups, no I/O) so the N-program story is
 * directly testable — see lib/onboarding/__tests__/persona.test.ts's
 * "generalizes beyond CSC's 2 programs" cases, which pass a wider
 * `validPersonas` set than today's real 4-value PERSONAS to prove this
 * formula — not a per-program hardcoded table — is what produces persona
 * strings.
 */
export function computePersonaCandidate(role: OrgRole | string, programKey: string): string {
  const roleSegment = role === "org_admin" ? "org_admin" : "member";
  return `${roleSegment}_${programKey}`;
}

/**
 * Today's 4 persona strings ("org_admin_member", "member_member", ...)
 * are exactly `computePersonaCandidate(role, program.key)` for CSC's
 * "member"/"partner" programs (OrgRole is only ever "org_admin" | "member"
 * — lib/auth/types.ts:8). This formula reproduces them exactly, and
 * because it's a formula rather than a per-program lookup table, a 3rd
 * configured program's members already get a correctly-computed persona
 * value from this function with no code change here — `validPersonas`
 * defaults to the real, current `PERSONAS`, so an unauthored program's
 * candidate string (not yet a member of PERSONAS) correctly resolves to
 * null (graceful "no onboarding tour for this persona yet") rather than a
 * crash, until lib/onboarding/steps.ts's PERSONAS/STEPS_BY_PERSONA are
 * widened and that program's step *content* is authored (tracked
 * separately — a product/content decision, not a mechanical one).
 */
export function personaForMembership(
  membership: MembershipFact,
  programs: MembershipProgramDef[],
  validPersonas: readonly string[] = PERSONAS
): Persona | null {
  const program = programs.find((p) => p.orgTypeValue === membership.orgType);
  if (!program) return null;

  const candidate = computePersonaCandidate(membership.role, program.key);
  return validPersonas.includes(candidate) ? (candidate as Persona) : null;
}

/**
 * Resolve the persona to use across ALL of a user's active memberships.
 * Precedence matches the original 4 independent implementations exactly:
 * `precedence` is ordered highest-precedence-first (org_admin variants
 * before plain-member variants, defaulting to the real PERSONAS), so the
 * first entry with a matching membership wins — an org_admin_member
 * membership beats a plain member_partner membership even if both exist.
 */
export function deriveGlobalPersona(
  memberships: MembershipFact[],
  programs: MembershipProgramDef[],
  precedence: readonly string[] = PERSONAS
): Persona | null {
  const candidates = new Set<string>(
    memberships
      .map((m) => personaForMembership(m, programs, precedence))
      .filter((p): p is Persona => p !== null)
  );

  for (const persona of precedence) {
    if (candidates.has(persona)) return persona as Persona;
  }
  return null;
}

/**
 * Reverse lookup: which organizations.type value does a persona
 * correspond to? Used where a persona has already been resolved and the
 * caller needs to find the specific org membership to display (name/slug)
 * — see OnboardingGate.tsx.
 */
export function orgTypeForPersona(
  persona: Persona,
  programs: MembershipProgramDef[]
): string | null {
  const roleSegment = persona.startsWith("org_admin_") ? "org_admin" : "member";
  const programKey = persona.slice(roleSegment.length + 1);
  return programs.find((p) => p.key === programKey)?.orgTypeValue ?? null;
}
