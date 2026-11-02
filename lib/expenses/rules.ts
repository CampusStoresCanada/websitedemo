/**
 * Expense claims: the rules, as pure functions.
 *
 * Read by the claim form, the server actions and the review panel alike, so a
 * claimant never sees a figure on screen that the server then refuses. Nothing
 * here knows about the travel bursary: a program's categories carry the caps,
 * the mileage rate and which slots are alternatives (see expense_programs and
 * expense_program_categories). The bursary is configuration.
 */

export const PAYEE_TYPES = ["organization", "claimant", "other"] as const;
export type PayeeType = (typeof PAYEE_TYPES)[number];

export const PAYEE_TYPE_LABELS: Record<PayeeType, string> = {
  organization: "The institution",
  claimant: "Me, personally",
  other: "Someone else",
};

export const CLAIM_STATUSES = ["draft", "submitted", "returned", "rejected", "approved", "posted"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/** Plain labels: what was recorded, never why. */
export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  draft: "Not submitted",
  submitted: "Awaiting approval",
  returned: "Sent back for changes",
  rejected: "Declined",
  approved: "Approved",
  posted: "Approved, sent for payment",
};

/** The claimant may change it only before it is submitted, or once returned. */
export function claimEditable(status: string): boolean {
  return status === "draft" || status === "returned";
}

export type ExpenseCategory = {
  key: string;
  label: string;
  help: string | null;
  measure: "amount" | "distance";
  capCents: number | null;
  rateCentsPerKm: number | null;
  requiresReceipt: boolean;
  choiceGroup: string | null;
};

export type ExpenseLine = {
  categoryKey: string;
  amountCents: number;
  taxCents: number;
  distanceKm: number | null;
  description: string | null;
  receiptCount: number;
};

export type Payee = {
  type: PayeeType | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  country: string | null;
};

export const PAYEE_FIELDS = [
  "type",
  "name",
  "email",
  "phone",
  "addressLine1",
  "addressLine2",
  "city",
  "province",
  "postalCode",
  "country",
] as const;
export type PayeeField = (typeof PAYEE_FIELDS)[number];

/** Payee field → expense_claims column. */
export const PAYEE_COLUMNS: Record<PayeeField, string> = {
  type: "payee_type",
  name: "payee_name",
  email: "payee_email",
  phone: "payee_phone",
  addressLine1: "payee_address_line1",
  addressLine2: "payee_address_line2",
  city: "payee_city",
  province: "payee_province",
  postalCode: "payee_postal_code",
  country: "payee_country",
};

export function isPayeeField(field: string): field is PayeeField {
  return (PAYEE_FIELDS as readonly string[]).includes(field);
}

/** km × rate, to the cent. */
export function distanceAmountCents(km: number, rateCentsPerKm: number): number {
  return Math.round(km * rateCentsPerKm);
}

/** What a line claims, tax included. */
export function lineTotalCents(line: Pick<ExpenseLine, "amountCents" | "taxCents">): number {
  return line.amountCents + line.taxCents;
}

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
}

/** A line with nothing on it is an empty slot, not a claim for $0. */
export function lineIsFilled(line: ExpenseLine): boolean {
  return lineTotalCents(line) > 0 || (line.distanceKm ?? 0) > 0;
}

/**
 * Check one line against its category. Returns the reason it can't stand, or
 * null. Used on every save, so a cap is refused when it is typed, not at submit.
 */
export function lineProblem(category: ExpenseCategory, line: ExpenseLine): string | null {
  if (line.amountCents < 0 || line.taxCents < 0) return "Amounts can't be negative.";
  if (category.measure === "distance") {
    if (line.distanceKm === null || line.distanceKm < 0) return "Enter the distance in kilometres.";
    if (line.taxCents !== 0) return "Mileage has no tax.";
  }
  if (category.capCents !== null && lineTotalCents(line) > category.capCents) {
    return `${category.label} can't be more than ${formatCents(category.capCents)}, tax included.`;
  }
  return null;
}

/** Validate one payee answer. Null or blank always clears. */
export function validatePayeeAnswer(
  field: PayeeField,
  value: unknown,
  allowed: readonly PayeeType[]
): { valid: true; clean: string | null } | { valid: false; error: string } {
  if (value === null || (typeof value === "string" && value.trim() === "")) return { valid: true, clean: null };
  if (typeof value !== "string") return { valid: false, error: "That answer should be text." };
  const clean = value.trim().slice(0, 300);
  if (field === "type" && !(allowed as readonly string[]).includes(clean)) {
    return { valid: false, error: "Choose who we're paying." };
  }
  if (field === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
    return { valid: false, error: "That doesn't look like an email address." };
  }
  return { valid: true, clean };
}

function blank(value: string | null): boolean {
  return value === null || value.trim() === "";
}

/** What's missing from the payee, in the claimant's terms. */
export function payeeGaps(payee: Payee): string[] {
  if (!payee.type) return ["Choose who we're paying."];
  const gaps: string[] = [];
  if (blank(payee.name)) gaps.push("Enter the name we should pay.");
  if (blank(payee.email)) gaps.push("Enter an email for the payee.");
  if (blank(payee.addressLine1) || blank(payee.city) || blank(payee.province) || blank(payee.postalCode)) {
    gaps.push("Enter the full mailing address for payment.");
  }
  return gaps;
}

/**
 * Everything that stands between this claim and submitting it. Empty means it
 * can be submitted.
 *
 * `allowedKeys` narrows the program's slots for this claim (the bursary offers
 * only what the school asked for: hotel, travel, or both). Null means all.
 */
export function claimGaps(params: {
  categories: ExpenseCategory[];
  lines: ExpenseLine[];
  payee: Payee;
  allowedKeys?: readonly string[] | null;
}): string[] {
  const { categories, lines, payee, allowedKeys } = params;
  const byKey = new Map(categories.map((c) => [c.key, c]));
  const filled = lines.filter(lineIsFilled);
  const gaps: string[] = [];

  if (filled.length === 0) gaps.push("Add at least one expense.");

  const groups = new Map<string, string[]>();
  for (const line of filled) {
    const category = byKey.get(line.categoryKey);
    if (!category) {
      gaps.push("One of these expenses isn't part of this program.");
      continue;
    }
    if (allowedKeys && !allowedKeys.includes(category.key)) {
      gaps.push(`${category.label} isn't part of this claim.`);
    }
    const problem = lineProblem(category, line);
    if (problem) gaps.push(problem);
    if (category.requiresReceipt && line.receiptCount === 0) gaps.push(`Attach a receipt for ${category.label}.`);
    if (category.choiceGroup) {
      groups.set(category.choiceGroup, [...(groups.get(category.choiceGroup) ?? []), category.label]);
    }
  }
  for (const labels of groups.values()) {
    if (labels.length > 1) gaps.push(`Claim ${labels.join(" or ")}, not both.`);
  }

  return [...gaps, ...payeeGaps(payee)];
}

export function claimTotals(lines: ExpenseLine[]): { amountCents: number; taxCents: number; totalCents: number } {
  const amountCents = lines.reduce((s, l) => s + l.amountCents, 0);
  const taxCents = lines.reduce((s, l) => s + l.taxCents, 0);
  return { amountCents, taxCents, totalCents: amountCents + taxCents };
}

/** Is the claim window open? closesAt is an EXCLUSIVE instant. */
export function claimWindowOpen(
  opensAt: string | null | undefined,
  closesAt: string | null | undefined,
  now: Date = new Date()
): boolean {
  const t = now.getTime();
  if (opensAt && !Number.isNaN(Date.parse(opensAt)) && t < Date.parse(opensAt)) return false;
  if (closesAt && !Number.isNaN(Date.parse(closesAt)) && t >= Date.parse(closesAt)) return false;
  return true;
}

/** Turn approve_expense_claim()'s refusals into sentences. */
export const APPROVAL_REFUSALS: Record<string, string> = {
  EXPENSE_CLAIM_NOT_FOUND: "That claim no longer exists.",
  EXPENSE_CLAIM_NOT_SUBMITTED: "That claim isn't waiting for approval.",
  APPROVER_NOT_ADMIN: "Only admins and superadmins can approve claims.",
  APPROVER_IS_CLAIMANT: "You can't approve a claim you filled in.",
  APPROVER_LINKED_TO_PAYEE: "You can't approve a claim for an organization you're linked to.",
  APPROVER_ALREADY_APPROVED: "You've already approved this claim. It needs a second approver.",
};
