/**
 * What the desk prints, and what it has to WRITE, when somebody needs a badge.
 *
 * ⛔ The output is a function of the CARD IN HAND, not of who the person is.
 * Stephen, 2026-09-08: "It prints according to what the delta is on the QL
 * stock. The sticker is affixed to the blank."
 *
 * The Brother QL-1110NWBc is a roll-fed label printer. It cannot take a rigid
 * pre-printed badge and overprint it — it prints a label that gets applied. So
 * the question at the desk is never "reprint this badge", it is "what is missing
 * from the card I am holding", and the answer depends entirely on which card
 * that is:
 *
 *   COMPANY BLANK — printed for a seat nobody was named to. Already carries the
 *     organisation's name, logo and map in colour. Missing only the person.
 *   SPARE — unbranded desk stock. Carries a registration type's schedule and the
 *     hotel map, and nothing else. Missing the person AND the company.
 *   NONE — no suitable card. Not a QL job at all; this is the full colour badge.
 *
 * ⛔ AND IT IS NOT ONLY A PRINTING DECISION. If the company has a blank and the
 * person in front of you is not seated, the blank becomes theirs — which means
 * naming them to that seat. A seat is the ticket; assigning it to a person is
 * how the ticket gets given (see lib/conference/attendance.ts). Printing the
 * sticker without writing the assignment produces a badge whose access closure
 * is empty: it scans, and it admits them to nothing.
 */

/**
 * ⛔ The reprint platform's stock is DECLARED, not assumed. The desk prints on
 * whatever roll is loaded, and that roll's width is the only real constraint on
 * the label — so it belongs in one named place rather than as 62 typed into a
 * renderer. A conference that buys a different printer changes this entry and
 * nothing else.
 */
export type ReprintStock = {
  id: string;
  /** The machine, in the words on the box. */
  platform: string;
  /** The consumable, in the words on the packet. */
  label: string;
  widthMm: number;
  /** Continuous roll — the printer cuts to length, so height is ours to choose. */
  continuous: boolean;
  /** Thermal: black only. "White" is whatever the film is, or the badge beneath. */
  monochrome: boolean;
};

export const REPRINT_STOCKS: Record<string, ReprintStock> = {
  brother_ql_dk2113: {
    id: "brother_ql_dk2113",
    platform: "Brother QL-1110NWBc",
    label: "DK-2113 frosted clear continuous",
    widthMm: 62,
    continuous: true,
    monochrome: true,
  },
};

export const DEFAULT_REPRINT_STOCK = REPRINT_STOCKS.brother_ql_dk2113;

/**
 * Lay the badge's variable layer out for the roll.
 *
 * ⛔ RE-LAYOUT, NOT A SCALE TRANSFORM. A uniform reduction is a hack that fails
 * on contact with the physical card: the label is stuck onto a blank that was
 * printed at full size, so a photographically shrunk label has a logo and a
 * vertical rhythm that line up with nothing. The label and the blank share one
 * coordinate space or the whole approach is pointless.
 *
 * So NOTHING is scaled. What changes is exactly two things:
 *
 *   SLOT WIDTH   clamped so the slot cannot run past the edge of the roll.
 *   FONT SIZE    falls out of that — `fitTextLayout` already computes the size
 *                that fits a given width, and it is the same engine the badge
 *                itself uses. No second sizing rule.
 *
 * What is deliberately untouched:
 *
 *   x, baselineY   every element stays where the badge puts it
 *   logo diameter  a logo is a fixed mark, not a thing that shrinks 14%
 *   QR size        a QR that shrinks stops scanning; if it will not fit it MOVES
 *   spacing        vertical rhythm is the design, and it is preserved exactly
 */
export function clampSlotToStock<T extends { x: number; width: number }>(
  slot: T,
  params: { bandX: number; stock?: ReprintStock; dpi?: number }
): T {
  const stock = params.stock ?? DEFAULT_REPRINT_STOCK;
  const dpi = params.dpi ?? 300;
  const stockWidthPx = (stock.widthMm / 25.4) * dpi;
  const rollRight = params.bandX + stockWidthPx;
  // ⚠️ Only ever narrows. A slot already inside the roll keeps its width, so a
  // short line is not stretched and a walk-up's text never renders LARGER than
  // the pre-printed badge would have rendered it.
  return { ...slot, width: Math.min(slot.width, Math.max(0, rollRight - slot.x)) };
}

/**
 * Where a fixed-size mark has to sit to stay on the roll.
 *
 * ⛔ Moves it, never shrinks it. A QR below about 15mm stops scanning reliably
 * on thermal film, and a logo that changes size between a pre-printed badge and
 * a reprint reads as a mistake. If a fixed mark cannot fit at its own size the
 * answer is a layout change by a human, not a quiet reduction — so this reports
 * `fits: false` rather than solving it.
 */
export function placeFixedMark(
  mark: { x: number; size: number },
  params: { bandX: number; stock?: ReprintStock; dpi?: number }
): { x: number; size: number; fits: boolean; moved: boolean } {
  const stock = params.stock ?? DEFAULT_REPRINT_STOCK;
  const dpi = params.dpi ?? 300;
  const stockWidthPx = (stock.widthMm / 25.4) * dpi;
  const rollRight = params.bandX + stockWidthPx;
  if (mark.size > stockWidthPx) return { ...mark, fits: false, moved: false };
  if (mark.x + mark.size <= rollRight) return { ...mark, fits: true, moved: false };
  return { x: rollRight - mark.size, size: mark.size, fits: true, moved: true };
}

/** Which physical card the operator is holding. */
export type BadgeStock = "company_blank" | "spare" | "none";

/**
 * What the label has to carry. Ordered as it reads on the card.
 *
 * ⚠️ Not a layout. This says what is MISSING, and the renderer decides where it
 * goes — the clear zone on a company blank is not in the same place as the empty
 * upper third of a spare.
 */
export type DeltaField = "name" | "title" | "qr" | "organization" | "logo";

const DELTA_BY_STOCK: Record<Exclude<BadgeStock, "none">, DeltaField[]> = {
  // The company half is already on the card, in colour, with the map.
  company_blank: ["name", "title", "qr"],
  // ⚠️ A spare carries its registration type's schedule but no organisation, so
  // the label has to supply the company too. Monochrome logo on thermal stock is
  // the weakest part of this path — see `logoIsPrintable` at the call site.
  spare: ["name", "title", "qr", "organization", "logo"],
};

export type ReprintPlan = {
  stock: BadgeStock;
  /** What the QL prints. Empty when this is not a QL job. */
  delta: DeltaField[];
  transport: "ql_label" | "full_badge_pdf";
  /** The declared stock this label prints on. Null when it is not a label job. */
  stockSpec: ReprintStock | null;
  /**
   * ⛔ The data half. Non-null means the desk must name this person to a seat
   * before the badge means anything.
   */
  seatAssignment: { required: true; reason: string } | null;
  reason: string;
};

export function planReprint(params: {
  /** What the operator has in hand. */
  stock: BadgeStock;
  /**
   * Does this person already hold a seat? A damaged-badge reprint does; a
   * walk-up handed a company blank does not, and that is the whole difference
   * between printing and printing-plus-writing.
   */
  personIsSeated: boolean;
  /** Override for a conference on different hardware. */
  stockSpec?: ReprintStock;
}): ReprintPlan {
  const { stock, personIsSeated } = params;

  if (stock === "none") {
    return {
      stock,
      delta: [],
      transport: "full_badge_pdf",
      stockSpec: null,
      // ⚠️ Deliberately NOT auto-assigning here. Without a card there is nothing
      // to hand over anyway, so the desk is already stopping to think; inventing
      // a seat at that moment is how somebody ends up holding a badge nobody
      // sold.
      seatAssignment: null,
      reason: "No blank or spare for this person — the whole badge has to print.",
    };
  }

  const delta = DELTA_BY_STOCK[stock];
  return {
    stock,
    delta,
    transport: "ql_label",
    stockSpec: params.stockSpec ?? DEFAULT_REPRINT_STOCK,
    seatAssignment: personIsSeated
      ? null
      : {
          required: true,
          reason:
            "This person holds no seat. The card is a ticket — name them to one, " +
            "or the badge scans and admits them to nothing.",
        },
    reason:
      stock === "company_blank"
        ? "Company blank: branding and map are already on the card, so the label is just the person."
        : "Spare: unbranded stock, so the label carries the company as well as the person.",
  };
}

/**
 * The default suggestion for which stock to reach for.
 *
 * ⚠️ An INFERENCE, not stock control: it says a blank for that company went to
 * print, not that one is still in the box — nobody counts them as they are used.
 * The operator overrides it by saying what they actually picked up, which is why
 * `planReprint` takes the stock rather than deriving it.
 */
export function suggestStock(params: {
  organizationId: string | null;
  unnamedSeatOrganizationIds: Iterable<string>;
  sparesWerePrinted: boolean;
}): { stock: BadgeStock; reason: string } {
  const { organizationId, sparesWerePrinted } = params;
  if (organizationId && new Set(params.unnamedSeatOrganizationIds).has(organizationId)) {
    return {
      stock: "company_blank",
      reason: "This company has an unnamed seat, so a blank for it was printed.",
    };
  }
  if (sparesWerePrinted) {
    return { stock: "spare", reason: "No blank for this company; use desk stock." };
  }
  return { stock: "none", reason: "No blank for this company and no spares in this run." };
}
