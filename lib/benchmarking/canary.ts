/**
 * Per-recipient traceable figures (the attribution-mark rule).
 *
 * Every copy of the report carries a fingerprint in its least significant
 * digits. A store's revenue reads $6,489,350 in one member's copy and
 * $6,489,383 in another's — a difference no one would act on, and one that
 * survives the things metadata watermarking does not: retyping, screenshots,
 * reading a figure aloud into an email.
 *
 * The point is stated openly to members from day one. The deterrent is the
 * announcement; the trace is only the backstop. This exists because stores told
 * us in 2025 that what stopped them sharing was not CSC — it was the fear that
 * ANOTHER member would forward the file.
 *
 * FOUR RULES, and the first one matters more than the rest put together:
 *
 *   1. A store's own figures are NEVER perturbed. They typed those numbers in;
 *      seeing them altered would start a support thread that never ends and
 *      would teach them their data is unreliable. What they see of themselves
 *      is exactly what they filed.
 *
 *   2. Medians and counts are never perturbed. Those are the numbers a director
 *      actually acts on, and a marked aggregate would be a lie with a purpose
 *      rather than a mark. Only named peer rows carry the fingerprint.
 *
 *   3. The shift is bounded by a fraction of the value AND an absolute cap, so
 *      it cannot reorder two stores or move a median. On the 2025 data the
 *      closest pair of stores differs by thousands; the cap here is tens.
 *
 *   4. Small figures and ratios are left alone. A $50 shift is invisible on
 *      $6M and absurd on a $228 revenue-per-student. A mark you can see is not
 *      a mark, it is an error.
 *
 * Deterministic rather than stored: the same recipient sees the same figure
 * every time they open the report, and a leaked figure can be traced years
 * later without depending on a table nobody remembered to keep.
 */

/** Below this, a few dollars is not invisible, so nothing is marked. */
export const MIN_MARKABLE_VALUE = 100_000;

/** Largest shift in dollars. Two orders of magnitude below any real gap. */
export const MAX_SHIFT = 60;

/**
 * Fraction of the value the shift may never exceed. Belt and braces with
 * MAX_SHIFT: on a figure just over the floor, 60 would be 0.06%, which is still
 * invisible, but this keeps the guarantee proportional if the floor ever moves.
 */
export const MAX_SHIFT_FRACTION = 0.0005;

/**
 * FNV-1a, 32-bit. Chosen for being boring: stable across runtimes and versions,
 * no dependency, and identical output in five years when someone is trying to
 * trace a leak from a report nobody has the code for any more.
 */
function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The shift one recipient sees on one store's one figure.
 *
 * Returns 0 when the figure must not be marked — the reader's own row, a value
 * below the floor, or anything non-finite.
 */
export function shiftFor(input: {
  recipientOrgId: string;
  targetOrgId: string;
  fieldKey: string;
  value: number;
}): number {
  const { recipientOrgId, targetOrgId, fieldKey, value } = input;

  // Rule 1. Never your own numbers.
  if (recipientOrgId === targetOrgId) return 0;
  if (!Number.isFinite(value)) return 0;
  if (Math.abs(value) < MIN_MARKABLE_VALUE) return 0;

  const cap = Math.min(MAX_SHIFT, Math.floor(Math.abs(value) * MAX_SHIFT_FRACTION));
  if (cap < 1) return 0;

  const span = cap * 2 + 1; // [-cap, +cap]
  const h = fnv1a(`${recipientOrgId}|${targetOrgId}|${fieldKey}`);
  return (h % span) - cap;
}

/** The figure as this recipient should see it. */
export function markValue(input: {
  recipientOrgId: string;
  targetOrgId: string;
  fieldKey: string;
  value: number | null;
}): number | null {
  if (input.value === null) return null;
  return input.value + shiftFor({ ...input, value: input.value });
}

export interface LeakObservation {
  targetOrgId: string;
  fieldKey: string;
  /** What the leaked document said. */
  observedValue: number;
  /** What we actually hold. */
  trueValue: number;
}

export interface TraceResult {
  recipientOrgId: string;
  /** Observations this recipient's fingerprint explains. */
  matched: number;
  /** Observations that could be marked at all. */
  markable: number;
}

/**
 * Who was this copy prepared for?
 *
 * Give it what a leaked document said, what we hold, and the recipients it
 * could have gone to. One figure narrows the field; three or four usually
 * settle it, because a recipient has to match on every markable observation to
 * survive.
 *
 * Returns every candidate ranked, never a single accusation. A trace is
 * evidence for a human conversation, not a verdict — and a tie is a real
 * outcome that must be visible rather than resolved by picking the first row.
 */
export function traceLeak(
  observations: LeakObservation[],
  candidateOrgIds: string[],
): TraceResult[] {
  const results = candidateOrgIds.map((recipientOrgId) => {
    let matched = 0;
    let markable = 0;

    for (const o of observations) {
      const expected = shiftFor({
        recipientOrgId,
        targetOrgId: o.targetOrgId,
        fieldKey: o.fieldKey,
        value: o.trueValue,
      });

      // A figure that carries no mark tells us nothing about anyone, so it is
      // excluded from the denominator rather than counted as agreement.
      if (expected === 0 && o.observedValue === o.trueValue) continue;

      markable++;
      if (o.trueValue + expected === o.observedValue) matched++;
    }

    return { recipientOrgId, matched, markable };
  });

  return results.sort((a, b) => b.matched - a.matched || a.recipientOrgId.localeCompare(b.recipientOrgId));
}

/**
 * What the report says out loud, above the figures.
 *
 * The visible half of the mechanism, and the half that actually prevents
 * leaks. Announced plainly rather than buried: a member who forwards this
 * should know before they do it, not after.
 */
export function attributionNotice(organizationName: string): string {
  return `Prepared for ${organizationName}. Figures for other stores in this report are marked so a forwarded copy can be traced back to the member it was prepared for. Your own figures are never altered — what you see of your store is exactly what you filed.`;
}
