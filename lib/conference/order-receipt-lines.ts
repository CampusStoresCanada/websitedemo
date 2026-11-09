/**
 * An order's lines as they stand after any registration changes
 * (change_registration_offer), for the updated receipt sent to the buyer.
 *
 * ⛔ The order's own line items never change: they are the record of what was
 * paid for. A change is recorded beside it (conference_registration_changes),
 * so the receipt is built from both: each line, with the units that were
 * changed shown as what they are now. A change of a change (Tuesday to
 * Wednesday, then to Thursday) is followed to where it ended.
 */

import { formatCents } from "../utils";

export type ReceiptOrderItem = {
  /** The purchase the item minted (entity_purchases.order_item_id). */
  purchaseId: string | null;
  name: string;
  quantity: number;
  unitPriceCents: number;
};

export type ReceiptChange = {
  fromPurchaseId: string;
  toPurchaseId: string;
  toName: string;
};

export type ReceiptLine = {
  name: string;
  quantity: number;
  amountCents: number;
  /** What this line was bought as, when it was changed. */
  changedFrom: string | null;
};

/** Escape a catalogue name for the receipt's HTML lines ("Meet & Greet"). */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The receipt's lines, tax and total, one to a line, for the template's {{order_lines}}. */
export function receiptLinesHtml(lines: ReceiptLine[], taxCents: number, totalCents: number): string {
  return [
    ...lines.map((line) => {
      const count = line.quantity > 1 ? ` x ${line.quantity}` : "";
      const was = line.changedFrom ? ` (changed from ${escapeHtml(line.changedFrom)})` : "";
      return `${escapeHtml(line.name)}${count}${was}: ${formatCents(line.amountCents)}`;
    }),
    `Tax: ${formatCents(taxCents)}`,
    `<strong>Total paid: ${formatCents(totalCents)}</strong>`,
  ].join("<br>");
}

export function orderLinesAfterChanges(items: ReceiptOrderItem[], changes: ReceiptChange[]): ReceiptLine[] {
  const byFrom = new Map<string, ReceiptChange[]>();
  for (const change of changes) {
    const list = byFrom.get(change.fromPurchaseId) ?? [];
    list.push(change);
    byFrom.set(change.fromPurchaseId, list);
  }

  /** Where one changed unit ended up, following later changes of it. */
  const finalName = (change: ReceiptChange, seen: Set<string>): string => {
    const next = byFrom.get(change.toPurchaseId)?.[0];
    if (!next || seen.has(next.toPurchaseId)) return change.toName;
    seen.add(next.toPurchaseId);
    return finalName(next, seen);
  };

  const lines: ReceiptLine[] = [];
  for (const item of items) {
    const quantity = Math.max(1, item.quantity);
    const changed = item.purchaseId ? (byFrom.get(item.purchaseId) ?? []).slice(0, quantity) : [];
    const unchanged = quantity - changed.length;
    if (unchanged > 0) {
      lines.push({ name: item.name, quantity: unchanged, amountCents: unchanged * item.unitPriceCents, changedFrom: null });
    }
    const toCounts = new Map<string, number>();
    for (const change of changed) {
      const name = finalName(change, new Set([change.toPurchaseId]));
      toCounts.set(name, (toCounts.get(name) ?? 0) + 1);
    }
    for (const [name, count] of toCounts) {
      // Changed back to what it was bought as: nothing to call out.
      lines.push({
        name,
        quantity: count,
        amountCents: count * item.unitPriceCents,
        changedFrom: name === item.name ? null : item.name,
      });
    }
  }
  return lines;
}
