import { canManageOrganization, isGlobalAdmin, type AuthContext } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDeadline } from "@/lib/benchmarking/deadline";
import { resolveClaimSource } from "./sources";
import {
  claimEditable,
  claimGaps,
  claimTotals,
  claimWindowOpen,
  type ClaimStatus,
  type ExpenseCategory,
  type ExpenseLine,
  type Payee,
  type PayeeType,
} from "./rules";

/**
 * Loading a claim and deciding what the viewer may do with it. Server-only;
 * the actions in lib/actions/expense-claims.ts and the review panel both read
 * through here so the claimant and the approvers see the same claim.
 */

type Db = ReturnType<typeof createAdminClient>;

export type ExpenseProgram = {
  id: string;
  name: string;
  opensAt: string | null;
  closesAt: string | null;
  approvalsRequired: number;
  payeeTypes: PayeeType[];
  qboExpenseAccountId: string | null;
  qboTaxCodeId: string | null;
  categories: ExpenseCategory[];
};

export type ExpenseReceipt = {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number | null;
};

export type ExpenseClaimView = {
  id: string;
  status: ClaimStatus;
  organizationId: string;
  organizationName: string;
  program: Omit<ExpenseProgram, "qboExpenseAccountId" | "qboTaxCodeId">;
  /** The program's slots this claim may use, in order. */
  categories: ExpenseCategory[];
  lines: ExpenseLine[];
  receiptsByCategory: Record<string, ExpenseReceipt[]>;
  payee: Payee;
  totals: { amountCents: number; taxCents: number; totalCents: number };
  gaps: string[];
  submittedAt: string | null;
  decisionNote: string | null;
  /** The QuickBooks Bill, once posted. */
  qboBillId: string | null;
  approvals: Array<{ approverName: string; approvedAt: string }>;
  windowOpen: boolean;
  /** "March 6, 2027": the last day, formatted on the server. */
  closesOnLabel: string | null;
  canEdit: boolean;
};

const PROGRAM_COLUMNS =
  "id, name, opens_at, closes_at, approvals_required, payee_types, qbo_expense_account_id, qbo_tax_code_id";

export async function loadExpenseProgram(db: Db, programId: string): Promise<ExpenseProgram | null> {
  const [{ data: program }, { data: categories }] = await Promise.all([
    db.from("expense_programs").select(PROGRAM_COLUMNS).eq("id", programId).maybeSingle(),
    db.from("expense_program_categories").select("*").eq("program_id", programId).order("sort"),
  ]);
  if (!program) return null;
  return {
    id: program.id,
    name: program.name,
    opensAt: program.opens_at,
    closesAt: program.closes_at,
    approvalsRequired: program.approvals_required,
    payeeTypes: program.payee_types as PayeeType[],
    qboExpenseAccountId: program.qbo_expense_account_id,
    qboTaxCodeId: program.qbo_tax_code_id,
    categories: (categories ?? []).map((c) => ({
      key: c.key,
      label: c.label,
      help: c.help,
      measure: c.measure as ExpenseCategory["measure"],
      capCents: c.cap_cents,
      rateCentsPerKm: c.rate_cents_per_km === null ? null : Number(c.rate_cents_per_km),
      requiresReceipt: c.requires_receipt,
      choiceGroup: c.choice_group,
    })),
  };
}

export type ClaimRow = {
  id: string;
  program_id: string;
  organization_id: string;
  source_table: string | null;
  source_id: string | null;
  status: string;
  created_by_user_id: string | null;
  submitted_at: string | null;
  submitted_by_user_id: string | null;
  decision_note: string | null;
  qbo_bill_id: string | null;
  qbo_vendor_id: string | null;
  payee_type: string | null;
  payee_name: string | null;
  payee_email: string | null;
  payee_phone: string | null;
  payee_address_line1: string | null;
  payee_address_line2: string | null;
  payee_city: string | null;
  payee_province: string | null;
  payee_postal_code: string | null;
  payee_country: string | null;
};

export async function loadClaimRow(db: Db, claimId: string): Promise<ClaimRow | null> {
  const { data } = await db.from("expense_claims").select("*").eq("id", claimId).maybeSingle();
  return (data as ClaimRow | null) ?? null;
}

export function payeeFromRow(row: ClaimRow): Payee {
  return {
    type: (row.payee_type as PayeeType | null) ?? null,
    name: row.payee_name,
    email: row.payee_email,
    phone: row.payee_phone,
    addressLine1: row.payee_address_line1,
    addressLine2: row.payee_address_line2,
    city: row.payee_city,
    province: row.payee_province,
    postalCode: row.payee_postal_code,
    country: row.payee_country,
  };
}

/**
 * May this person fill in the claim? The organization's admins, the person
 * who opened it, and whoever the entitling record says. Never because they
 * are a CSC admin: staff approve claims, they don't write them.
 */
export async function canEditClaim(ctx: AuthContext, row: ClaimRow): Promise<boolean> {
  if (ctx.orgAdminOrgIds.includes(row.organization_id)) return true;
  if (row.created_by_user_id === ctx.userId) return true;
  const source = await resolveClaimSource(row.source_table, row.source_id);
  return source ? source.canEdit(ctx, row) : false;
}

/** May this person see the claim and its receipts? Editors, and CSC admins. */
export async function canViewClaim(ctx: AuthContext, row: ClaimRow): Promise<boolean> {
  return isGlobalAdmin(ctx.globalRole) || canManageOrganization(ctx, row.organization_id) || canEditClaim(ctx, row);
}

export async function loadLinesAndReceipts(
  db: Db,
  claimId: string
): Promise<{ lines: ExpenseLine[]; receiptsByCategory: Record<string, ExpenseReceipt[]>; lineIds: Record<string, string> }> {
  const { data: lineRows } = await db
    .from("expense_claim_lines")
    .select("id, category_key, amount_cents, tax_cents, distance_km, description")
    .eq("claim_id", claimId);
  const ids = (lineRows ?? []).map((l) => l.id);
  const { data: receiptRows } = ids.length
    ? await db
        .from("expense_claim_receipts")
        .select("id, line_id, file_name, content_type, size_bytes")
        .in("line_id", ids)
        .order("created_at")
    : { data: [] as Array<{ id: string; line_id: string; file_name: string; content_type: string; size_bytes: number | null }> };

  const keyByLine = new Map((lineRows ?? []).map((l) => [l.id, l.category_key]));
  const receiptsByCategory: Record<string, ExpenseReceipt[]> = {};
  for (const r of receiptRows ?? []) {
    const key = keyByLine.get(r.line_id);
    if (!key) continue;
    (receiptsByCategory[key] ??= []).push({
      id: r.id,
      fileName: r.file_name,
      contentType: r.content_type,
      sizeBytes: r.size_bytes,
    });
  }

  return {
    lines: (lineRows ?? []).map((l) => ({
      categoryKey: l.category_key,
      amountCents: l.amount_cents,
      taxCents: l.tax_cents,
      distanceKm: l.distance_km === null ? null : Number(l.distance_km),
      description: l.description,
      receiptCount: receiptsByCategory[l.category_key]?.length ?? 0,
    })),
    receiptsByCategory,
    lineIds: Object.fromEntries((lineRows ?? []).map((l) => [l.category_key, l.id])),
  };
}

/** Everything the claim form and the review panel show, from one place. */
export async function buildClaimView(db: Db, row: ClaimRow, ctx: AuthContext): Promise<ExpenseClaimView | null> {
  const program = await loadExpenseProgram(db, row.program_id);
  if (!program) return null;
  const source = await resolveClaimSource(row.source_table, row.source_id);
  const allowedKeys = source?.allowedKeys() ?? null;
  const categories = program.categories.filter((c) => !allowedKeys || allowedKeys.includes(c.key));

  const [{ lines, receiptsByCategory }, { data: org }, { data: approvalRows }] = await Promise.all([
    loadLinesAndReceipts(db, row.id),
    db.from("organizations").select("name").eq("id", row.organization_id).maybeSingle(),
    db.from("expense_claim_approvals").select("approver_user_id, approved_at").eq("claim_id", row.id).order("approved_at"),
  ]);

  const approverIds = (approvalRows ?? []).map((a) => a.approver_user_id);
  const { data: approvers } = approverIds.length
    ? await db.from("profiles").select("id, display_name").in("id", approverIds)
    : { data: [] as Array<{ id: string; display_name: string | null }> };
  const approverName = new Map((approvers ?? []).map((p) => [p.id, p.display_name || "An admin"]));

  const payee = payeeFromRow(row);
  const windowOpen = claimWindowOpen(program.opensAt, program.closesAt);
  const status = row.status as ClaimStatus;

  return {
    id: row.id,
    status,
    organizationId: row.organization_id,
    organizationName: org?.name ?? "",
    program: {
      id: program.id,
      name: program.name,
      opensAt: program.opensAt,
      closesAt: program.closesAt,
      approvalsRequired: program.approvalsRequired,
      payeeTypes: program.payeeTypes,
      categories: program.categories,
    },
    categories,
    lines,
    receiptsByCategory,
    payee,
    totals: claimTotals(lines),
    gaps: claimGaps({ categories: program.categories, lines, payee, allowedKeys }),
    submittedAt: row.submitted_at,
    decisionNote: row.decision_note,
    qboBillId: row.qbo_bill_id,
    approvals: (approvalRows ?? []).map((a) => ({
      approverName: approverName.get(a.approver_user_id) ?? "An admin",
      approvedAt: a.approved_at,
    })),
    windowOpen,
    closesOnLabel: program.closesAt ? formatDeadline(program.closesAt) : null,
    canEdit: claimEditable(status) && windowOpen && (await canEditClaim(ctx, row)),
  };
}
