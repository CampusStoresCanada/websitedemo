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
  // ⚠️ Both edges keep a margin, so a long line cannot run to the cut on either
  // side. See LABEL_EDGE_MARGIN_PX — the left margin is already in bandX.
  const rollRight = params.bandX + stockWidthPx - 24;
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
  // Same cut margin as the text: a QR printed to the edge risks losing part of
  // its quiet zone to the cut, and a QR without its quiet zone stops scanning.
  const rollRight = params.bandX + stockWidthPx - 24;
  if (mark.size > stockWidthPx - 48) return { ...mark, fits: false, moved: false };
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
export type DeltaField = "name" | "title" | "qr" | "organization" | "logo" | "schedule";

const DELTA_BY_STOCK: Record<Exclude<BadgeStock, "none">, DeltaField[]> = {
  // The company half is already on the card, in colour, with the map.
  company_blank: ["name", "title", "qr"],
  // ⚠️ A spare carries its registration type's schedule but no organisation, so
  // the label has to supply the company too. Monochrome logo on thermal stock is
  // the weakest part of this path — see `logoIsPrintable` at the call site.
  spare: ["name", "title", "qr", "organization", "logo", "schedule"],
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
  /**
   * Do they hold something their registration type does not include (an
   * event bought on its own, a presentation slot)? A company blank's back
   * was printed with the TYPE's schedule, so theirs would be missing it: the
   * reprint then adds their own schedule, as a spare's does (Stephen, 2026-10-22).
   */
  holdsExtras?: boolean;
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

  const delta =
    stock === "company_blank" && params.holdsExtras
      ? [...DELTA_BY_STOCK.company_blank, "schedule" as const]
      : DELTA_BY_STOCK[stock];
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
 * Which card the desk should reach for. ⛔ The ONE answer: the desk card shows
 * it and the reprint job is planned from it.
 *
 * ⚠️ An INFERENCE, not stock control: it says a blank for that company went to
 * print, not that one is still in the box — nobody counts them as they are used.
 * The operator overrides it by saying what they actually picked up, which is why
 * `planReprint` takes the stock rather than deriving it.
 *
 * ⛔ A spare must be THEIR type. A spare carries the schedule of the
 * registration type it was printed for, so the nearest stack would put somebody
 * else's four days on the back of their badge.
 */
/**
 * A company blank is keyed by company AND registration type. ⛔ Its back was
 * printed with the schedule of the SEAT it was printed for, so a Thursday-only
 * person handed a Full Conference blank would carry four days they do not have.
 */
export const blankCardKey = (organizationId: string, registrationTypeId: string) =>
  `${organizationId}|${registrationTypeId}`;

/**
 * Which cards exist for this person — the ONE answer the desk's guess and the
 * "Which card are you holding?" choices both read, so they cannot disagree.
 * Built from the print run (blanks per unnamed seat, spares per type), never
 * hand-listed: a new registration type appears here at the next run.
 */
export type CardsOnHand = {
  /** A blank was printed for their company AND their registration type. */
  companyBlank: boolean;
  /** Spares that fit them: the stack for their badge's look (any type). */
  spareCount: number;
  /** That stack, in the operator's words: "Delegate", "Exhibitor". */
  spareLabel: string | null;
  /** Their registration type, in the catalogue's words, for the choices. */
  typeName: string | null;
};

/** The parts of a spare stack the desk needs (print-stock.ts SpareStack). */
type SpareStackLike = { typeIds: string[]; count: number; label: string };

export function cardsOnHand(params: {
  organizationId: string | null;
  registrationTypeId: string | null;
  registrationTypeName?: string | null;
  /** blankCardKey for every unnamed seat in the run. */
  unnamedSeatKeys: Iterable<string>;
  /** The run's spare stacks. Empty when spares are off. */
  spareStacks: ReadonlyArray<SpareStackLike>;
}): CardsOnHand {
  const { organizationId, registrationTypeId } = params;
  const keys = new Set(params.unnamedSeatKeys);
  // ⛔ A spare is generic within its LOOK: the schedule is printed at the desk.
  const stack = registrationTypeId
    ? params.spareStacks.find((s) => s.typeIds.includes(registrationTypeId))
    : undefined;
  return {
    companyBlank: Boolean(organizationId && registrationTypeId && keys.has(blankCardKey(organizationId, registrationTypeId))),
    spareCount: stack?.count ?? 0,
    spareLabel: stack?.label ?? null,
    typeName: params.registrationTypeName ?? null,
  };
}

export function suggestStock(params: {
  organizationId: string | null;
  /** blankCardKey for every unnamed seat in the run. */
  unnamedSeatKeys: Iterable<string>;
  /** The registration type this person's badge is printed as. */
  registrationTypeId: string | null;
  registrationTypeName?: string | null;
  /** The run's spare stacks. Empty when spares are off. */
  spareStacks: ReadonlyArray<SpareStackLike>;
}): { stock: BadgeStock; reason: string; cards: CardsOnHand } {
  const cards = cardsOnHand(params);
  const type = cards.typeName ?? "their registration type";
  if (cards.companyBlank) {
    return {
      stock: "company_blank",
      reason: `This company has an unnamed ${type} seat, so a blank for it was printed.`,
      cards,
    };
  }
  if (cards.spareCount > 0) {
    return {
      stock: "spare",
      reason: `No ${type} blank for this company; use a ${cards.spareLabel?.toLowerCase() ?? ""} spare (${cards.spareCount} printed). The schedule prints on a sticker.`,
      cards,
    };
  }
  return { stock: "none", reason: "No blank for this company and no spares in this run.", cards };
}

/**
 * The stickers a label reprint prints, in the order to apply them: the front,
 * then the back (the QR; on a spare, the schedule above it in the same piece).
 * Empty when the reprint is a full badge, which the QL cannot print.
 */
export type StickerSide = "front" | "back";
export function stickersFor(plan: Pick<ReprintPlan, "transport" | "delta"> | null | undefined): StickerSide[] {
  if (!plan || plan.transport !== "ql_label") return [];
  // ⛔ Two stickers either way: on a spare the back carries the schedule AND
  // the QR in one piece (label-document), so there is never a third.
  return ["front", "back"];
}
