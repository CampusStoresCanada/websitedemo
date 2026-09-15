"use client";

import { useAuth } from "@/components/providers/AuthProvider";
import type { PresentationLevel } from "./mode";

/**
 * Financial figures, redacted while presenting.
 *
 * The other presentation-mode gates withhold data server-side — the value never
 * reaches the browser. This one does NOT, and the difference is deliberate:
 *
 *   - The reader here is a member who is entitled to these figures. Reciprocity
 *     is the whole benefit filing buys (lib/benchmarking/disclosure.ts), so the
 *     numbers must still arrive; nothing about the page's correctness changes.
 *   - The problem being solved is that a real P&L for a named store is legible
 *     at a glance to sixty people on a video call. That is a rendering problem,
 *     and a rendering fix is the honest size of it.
 *
 * ⚠️ So this is NOT a confidentiality boundary. The figures remain in the page
 * payload and anyone with the browser open can read them. Do not reach for it
 * to hide something from the person at the keyboard — for that, withhold it in
 * lib/visibility/data.ts where the server decides. It exists to keep a screen
 * share from broadcasting numbers the room was never meant to read.
 */

export const REDACTED_CURRENCY = "$$$";
export const REDACTED_PERCENT = "%%%";
export const REDACTED_COUNT = "###";

/**
 * Each helper takes an already-formatted string and returns it, or the token.
 *
 * Generic in the argument so a caller passing a plain `string` gets a `string`
 * back — the formatters that feed these never return null, and widening their
 * result would make every call site re-narrow it for no reason.
 */
type MaskFn = <T extends string | null | undefined>(formatted: T) => T;

export interface FigureRedaction {
  /** True while a staff account is presenting, at any audience. */
  redacting: boolean;
  currency: MaskFn;
  percent: MaskFn;
  count: MaskFn;
}

/**
 * `disabled` opts a caller out entirely — pass the edit-mode flag.
 *
 * ⛔ Never redact a figure someone can edit. The inline editor seeds from
 * `data-raw-value` rather than the rendered text (see lib/editable-fields.ts),
 * so `$$$` would not itself be saved — but a store correcting a number it
 * cannot see is the kind of thing that ends with a wrong number in the record,
 * and presenting is not the moment to be editing figures anyway.
 */
/**
 * The rule, without React — so it can be tested without a DOM, and so the hook
 * below has nothing in it but the context read.
 */
export function redactFigures(
  presentationMode: PresentationLevel | null,
  disabled = false,
): FigureRedaction {
  const redacting = presentationMode !== null && !disabled;

  const mask =
    (token: string): MaskFn =>
    <T extends string | null | undefined>(formatted: T): T => {
      if (!redacting) return formatted;
      // Leave the empty states alone: "—" and "N/A" say "we do not hold this",
      // which is a different statement from "withheld for the screen share",
      // and replacing them would invent data that is not there.
      if (formatted == null || formatted === "—" || formatted === "N/A") {
        return formatted;
      }
      // Reachable only when `formatted` is a non-empty string, so T is a string
      // type here and the token satisfies it.
      return token as T;
    };

  return {
    redacting,
    currency: mask(REDACTED_CURRENCY),
    percent: mask(REDACTED_PERCENT),
    count: mask(REDACTED_COUNT),
  };
}

/** `disabled` opts a caller out entirely — pass the edit-mode flag. */
export function useFigureRedaction(disabled = false): FigureRedaction {
  const { presentationMode } = useAuth();
  return redactFigures(presentationMode, disabled);
}
