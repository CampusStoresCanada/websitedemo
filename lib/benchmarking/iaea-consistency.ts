import type { SurveyCategory } from "@/lib/actions/benchmarking-categories";

/**
 * Two answers about Inclusive and Equitable Access that cannot both be true.
 *
 * Adding the Inclusive or Equitable Access format in §3 means the store sells
 * course materials through such a program. Answering "Neither" in §10 says it
 * runs none. One of the two is wrong, and only the store knows which, so the
 * check names both places rather than picking a winner or silently correcting
 * either one.
 *
 * ⛔ Lives here rather than inside the form so it can be tested, and so the
 * printed worksheet and any future importer apply the same rule. A consistency
 * rule that exists in one component is a rule that holds on one screen.
 */

/** The §3 format whose presence contradicts a "Neither" in §10. */
export const IA_EA_FORMAT = "Inclusive or Equitable Access";

/** The §10 answer meaning the store runs no such program. */
export const NO_PROGRAM = "Neither";

export function iaEaContradiction(input: {
  courseMaterialCategories: Pick<SurveyCategory, "department">[];
  programType: unknown;
}): string | null {
  const sellsThroughProgram = input.courseMaterialCategories.some(
    (c) => c.department === IA_EA_FORMAT,
  );
  if (!sellsThroughProgram) return null;
  if (input.programType !== NO_PROGRAM) return null;

  return (
    "Section 3 has an Inclusive or Equitable Access line, but Section 10 says you run " +
    "neither. Either name the program in Section 10, or remove that format from " +
    "Section 3 if you do not run one."
  );
}
