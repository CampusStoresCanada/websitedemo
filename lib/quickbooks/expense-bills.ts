// QuickBooks worker for approved expense claims: one Bill (a payable) each.
//
// Same shape as the misc receipt worker in ./conference-export: claim rows
// under a lease, stop starting rows when the run budget is spent, adopt a Bill
// QuickBooks already holds instead of posting a second, and fail through the
// shared ladder in ./queue. A row only ever reaches this queue through
// approve_expense_claim(), in the same transaction as the claim's last
// approval.
//
// The Bill pays whoever the claimant declared (the organization, themselves,
// or someone else). Each line is posted twice over: the amount before tax and
// the tax paid, as separate lines, so the books show the tax on its own.
// Paying the Bill (cheque or otherwise) happens in QuickBooks.

import { createAdminClient } from "@/lib/supabase/admin";
import { raiseAlertIfNotOpen } from "@/lib/ops/alerts";
import { isFeatureEnabled } from "@/lib/data";
import { loadExpenseProgram, loadClaimRow, loadLinesAndReceipts, payeeFromRow, type ClaimRow } from "@/lib/expenses/claims";
import { lineIsFilled } from "@/lib/expenses/rules";
import {
  createQBBill,
  createQBVendor,
  findQBDocumentByDocNumber,
  findQBVendor,
  qboDocNumber,
  type QBBillLine,
  type QBVendorInput,
} from "./client";
import { adoptExistingReceipt, failQueueRow, releaseUnprocessedRows, startRunBudget } from "./queue";
import type { QBConferenceExportJobResult } from "./conference-export";

const LEASE_DURATION_MS = 5 * 60 * 1000;
const STALE_LEASE_THRESHOLD_MS = 10 * 60 * 1000;
const TABLE = "qbo_expense_bill_queue" as const;

type Db = ReturnType<typeof createAdminClient>;

type QueueRow = {
  id: string;
  expense_claim_id: string;
  qbo_bill_id: string | null;
  retry_count: number;
  max_retries: number;
};

/**
 * The vendor name. QuickBooks keeps ONE name list across customers and vendors,
 * and every member school is already a customer, so a vendor can never be
 * named plainly after the school. The suffix keeps the two apart, and names a
 * person paid personally the same way.
 */
export function expenseVendorName(name: string): string {
  return `${name.trim()} (Expense claims)`.slice(0, 100);
}

/** The Bill's lines: per expense, the amount before tax, then the tax. */
export function expenseBillLines(params: {
  categories: Array<{ key: string; label: string; measure: string; rateCentsPerKm: number | null }>;
  lines: Array<{ categoryKey: string; amountCents: number; taxCents: number; distanceKm: number | null; description: string | null }>;
  accountId: string;
  taxCodeId: string | null;
}): QBBillLine[] {
  const detail = {
    AccountRef: { value: params.accountId },
    ...(params.taxCodeId ? { TaxCodeRef: { value: params.taxCodeId } } : {}),
  };
  const out: QBBillLine[] = [];
  for (const category of params.categories) {
    const line = params.lines.find((l) => l.categoryKey === category.key);
    if (!line) continue;
    const what =
      category.measure === "distance"
        ? `${category.label}: ${line.distanceKm} km at $${((category.rateCentsPerKm ?? 0) / 100).toFixed(2)}/km`
        : category.label;
    const note = line.description ? ` (${line.description})` : "";
    if (line.amountCents > 0) {
      out.push({ DetailType: "AccountBasedExpenseLineDetail", Amount: line.amountCents / 100, Description: `${what}${note}`, AccountBasedExpenseLineDetail: detail });
    }
    if (line.taxCents > 0) {
      out.push({ DetailType: "AccountBasedExpenseLineDetail", Amount: line.taxCents / 100, Description: `${category.label}: tax paid`, AccountBasedExpenseLineDetail: detail });
    }
  }
  return out;
}

/** The vendor this claim pays, found or created, and remembered. */
async function resolveVendor(db: Db, claim: ClaimRow): Promise<string> {
  if (claim.qbo_vendor_id) return claim.qbo_vendor_id;
  const payee = payeeFromRow(claim);
  if (!payee.type || !payee.name) throw new Error("The claim has no payee to pay.");

  const { data: org } = await db
    .from("organizations")
    .select("name, quickbooks_vendor_id")
    .eq("id", claim.organization_id)
    .maybeSingle();

  if (payee.type === "organization" && org?.quickbooks_vendor_id) return org.quickbooks_vendor_id;

  const displayName = expenseVendorName(payee.type === "organization" ? org?.name ?? payee.name : payee.name);
  const input: QBVendorInput = {
    DisplayName: displayName,
    PrintOnCheckName: payee.name.slice(0, 100),
    ...(payee.type === "organization" && org?.name ? { CompanyName: org.name } : {}),
    ...(payee.email ? { PrimaryEmailAddr: { Address: payee.email } } : {}),
    ...(payee.phone ? { PrimaryPhone: { FreeFormNumber: payee.phone } } : {}),
    BillAddr: {
      Line1: payee.addressLine1 ?? undefined,
      Line2: payee.addressLine2 ?? undefined,
      City: payee.city ?? undefined,
      CountrySubDivisionCode: payee.province ?? undefined,
      PostalCode: payee.postalCode ?? undefined,
      Country: payee.country ?? undefined,
    },
  };
  const vendor = (await findQBVendor(displayName)) ?? (await createQBVendor(input));

  if (payee.type === "organization") {
    await db.from("organizations").update({ quickbooks_vendor_id: vendor.Id }).eq("id", claim.organization_id);
  }
  await db.from("expense_claims").update({ qbo_vendor_id: vendor.Id }).eq("id", claim.id);
  return vendor.Id;
}

async function markPosted(db: Db, row: QueueRow, billId: string) {
  await adoptExistingReceipt(db, TABLE, row.id, billId);
  await db
    .from("expense_claims")
    .update({ status: "posted", qbo_bill_id: billId, updated_at: new Date().toISOString() })
    .eq("id", row.expense_claim_id);
}

async function postClaim(db: Db, row: QueueRow): Promise<void> {
  const docNumber = qboDocNumber(row.expense_claim_id);
  const already = row.qbo_bill_id ?? (await findQBDocumentByDocNumber("Bill", docNumber))?.Id;
  if (already) return markPosted(db, row, already);

  const claim = await loadClaimRow(db, row.expense_claim_id);
  if (!claim) throw new Error(`Expense claim ${row.expense_claim_id} not found.`);
  if (claim.status !== "approved") throw new Error(`Expense claim is ${claim.status}, not approved.`);
  const program = await loadExpenseProgram(db, claim.program_id);
  if (!program) throw new Error("The claim's program is missing.");
  if (!program.qboExpenseAccountId) {
    throw new Error(`No QuickBooks expense account set for ${program.name}. Set it on /admin/expenses.`);
  }

  const { lines } = await loadLinesAndReceipts(db, claim.id);
  const billLines = expenseBillLines({
    categories: program.categories,
    lines: lines.filter(lineIsFilled),
    accountId: program.qboExpenseAccountId,
    taxCodeId: program.qboTaxCodeId,
  });
  if (billLines.length === 0) throw new Error("The claim has nothing to pay.");

  const vendorId = await resolveVendor(db, claim);
  const bill = await createQBBill({
    VendorRef: { value: vendorId },
    Line: billLines,
    TxnDate: new Date().toISOString().slice(0, 10),
    DocNumber: docNumber,
    PrivateNote: `CSC expense claim ${claim.id} (${program.name})`,
    CurrencyRef: { value: "CAD" },
    ...(program.qboTaxCodeId ? { GlobalTaxCalculation: "TaxExcluded" as const } : {}),
  });
  await markPosted(db, row, bill.Id);
}

export async function quickbooksExpenseBillExportRun(): Promise<QBConferenceExportJobResult> {
  const result: QBConferenceExportJobResult = { processed: 0, succeeded: 0, failed: 0, errors: [] };
  if (!(await isFeatureEnabled("quickbooks"))) return result;

  const db = createAdminClient();
  const now = new Date();

  await db
    .from(TABLE)
    .update({ status: "retrying", lease_expires_at: null, next_retry_at: now.toISOString() })
    .eq("status", "processing")
    .lt("lease_expires_at", new Date(now.getTime() - STALE_LEASE_THRESHOLD_MS).toISOString());

  const { data: candidates, error: findError } = await db
    .from(TABLE)
    .select("id")
    .or(`status.eq.pending,and(status.eq.retrying,next_retry_at.lte.${now.toISOString()})`)
    .limit(10);
  if (findError) {
    console.error("[qbo] Failed to find claimable expense bill rows:", findError);
    return result;
  }
  if (!candidates?.length) return result;

  const { data: rows, error: claimError } = await db
    .from(TABLE)
    .update({ status: "processing", lease_expires_at: new Date(now.getTime() + LEASE_DURATION_MS).toISOString() })
    .in("id", candidates.map((c) => c.id))
    .select("id, expense_claim_id, qbo_bill_id, retry_count, max_retries");
  if (claimError) {
    console.error("[qbo] Failed to claim expense bill rows:", claimError);
    return result;
  }

  const isOutOfBudget = startRunBudget();
  for (const [index, row] of (rows ?? []).entries()) {
    if (isOutOfBudget()) {
      await releaseUnprocessedRows(db, TABLE, (rows ?? []).slice(index).map((r) => r.id));
      break;
    }
    result.processed++;
    try {
      await postClaim(db, row);
      result.succeeded++;
    } catch (err) {
      result.failed++;
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`expense claim ${row.expense_claim_id}: ${message}`);
      const { exhausted, message: recorded } = await failQueueRow(db, TABLE, row, err);
      if (exhausted) {
        await raiseAlertIfNotOpen({
          ruleKey: `qbo_expense_bill_failed:${row.expense_claim_id}`,
          severity: "critical",
          message: `QuickBooks Bill export failed for expense claim ${row.expense_claim_id}: ${recorded}`,
          details: { expenseClaimId: row.expense_claim_id, error: recorded },
        });
      }
    }
  }
  return result;
}
