"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireAuthenticated, type AuthContext } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEventSafe } from "@/lib/ops/audit";
import {
  APPROVAL_REFUSALS,
  PAYEE_COLUMNS,
  claimEditable,
  claimWindowOpen,
  distanceAmountCents,
  isPayeeField,
  applyClaimCaps,
  lineProblem,
  validatePayeeAnswer,
  type ExpenseLine,
} from "@/lib/expenses/rules";
import {
  buildClaimView,
  canEditClaim,
  canViewClaim,
  loadClaimRow,
  loadExpenseProgram,
  type ClaimRow,
  type ExpenseClaimView,
} from "@/lib/expenses/claims";
import { resolveClaimSource } from "@/lib/expenses/sources";
import { lookupUserEmailsByIds } from "@/lib/supabase/user-lookup";

type Result<T> = { success: true; data: T } | { success: false; error: string };

const RECEIPT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/heic", "image/heif", "image/webp"];
/** The bucket enforces the same ceiling; this is only for the friendly error. */
const MAX_RECEIPT_BYTES = 20 * 1024 * 1024;
const RECEIPT_URL_TTL_SECONDS = 600;

/**
 * The claimant's side of every write: signed in, allowed to edit this claim,
 * the claim still editable and the window open. One gate, so no write can
 * skip a check another one makes.
 */
async function editableClaim(claimId: string): Promise<
  { ok: true; ctx: AuthContext; row: ClaimRow; db: ReturnType<typeof createAdminClient> } | { ok: false; error: string }
> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { ok: false, error: auth.error };
  const db = createAdminClient();
  const row = await loadClaimRow(db, claimId);
  if (!row) return { ok: false, error: "That claim doesn't exist." };
  if (!(await canEditClaim(auth.ctx, row))) return { ok: false, error: "You can't change this claim." };
  if (!claimEditable(row.status)) return { ok: false, error: "This claim has been submitted and can't be changed." };
  const program = await loadExpenseProgram(db, row.program_id);
  if (!program || !claimWindowOpen(program.opensAt, program.closesAt)) {
    return { ok: false, error: "Claims for this program aren't open." };
  }
  return { ok: true, ctx: auth.ctx, row, db };
}

type ClaimTemplate = "expense_claim_received" | "expense_claim_returned" | "expense_claim_rejected" | "expense_claim_approved";

const dollars = (cents: number) =>
  (cents / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" });

/**
 * Tell the people who filled the claim in (whoever opened it and whoever
 * submitted it, once each) where it stands. Never throws: the decision it
 * follows is already recorded, and a failed email must not read as a failed
 * decision. Returns how many were sent.
 */
async function tellClaimant(claimId: string, templateKey: ClaimTemplate, ctx: AuthContext): Promise<number> {
  try {
    const db = createAdminClient();
    const row = await loadClaimRow(db, claimId);
    if (!row) return 0;
    const ids = [...new Set([row.created_by_user_id, row.submitted_by_user_id].filter((id): id is string => !!id))];
    if (ids.length === 0) return 0;

    const [emails, { data: profiles }, source, view] = await Promise.all([
      lookupUserEmailsByIds(db, ids),
      db.from("profiles").select("id, display_name").in("id", ids),
      resolveClaimSource(row.source_table, row.source_id),
      buildClaimView(db, row, ctx),
    ]);
    if (!view) return 0;
    const names = new Map((profiles ?? []).map((p) => [p.id, p.display_name as string | null]));
    const people = new Map<string, string | null>();
    for (const id of ids) {
      const email = emails[id]?.trim().toLowerCase();
      if (email && !people.has(email)) people.set(email, names.get(id) ?? null);
    }
    if (people.size === 0) return 0;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
    const { sendTransactionalBatch } = await import("@/lib/comms/send");
    const results = await sendTransactionalBatch({
      templateKey,
      recipients: [...people].map(([to, name]) => ({
        to,
        variables: {
          first_name: name?.trim().split(/\s+/)[0] || "there",
          organization_name: view.organizationName || "your organization",
          program_name: view.program.name,
          claim_total: dollars(view.totals.totalCents),
          payee_name: row.payee_name || view.organizationName,
          // Staff's own words, typed into a box: escaped, and their line breaks kept.
          decision_note: (row.decision_note ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\n/g, "<br>"),
          claim_url: `${appUrl}${source?.path ?? "/"}`,
        },
      })),
    });
    return results.filter((r) => r.success).length;
  } catch (err) {
    console.warn(`[expense-claims] ${templateKey} email failed`, err);
    return 0;
  }
}

async function touch(db: ReturnType<typeof createAdminClient>, claimId: string) {
  await db.from("expense_claims").update({ updated_at: new Date().toISOString() }).eq("id", claimId);
}

export async function getExpenseClaim(claimId: string): Promise<Result<ExpenseClaimView>> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  const db = createAdminClient();
  const row = await loadClaimRow(db, claimId);
  if (!row || !(await canViewClaim(auth.ctx, row))) return { success: false, error: "That claim isn't available." };
  const view = await buildClaimView(db, row, auth.ctx);
  return view ? { success: true, data: view } : { success: false, error: "That claim's program is missing." };
}

/** Save one payee answer, as the bursary request saves one question. */
export async function saveExpensePayee(params: { claimId: string; field: string; value: unknown }): Promise<Result<null>> {
  const gate = await editableClaim(params.claimId);
  if (!gate.ok) return { success: false, error: gate.error };
  if (!isPayeeField(params.field)) return { success: false, error: "That isn't part of the payee." };
  const program = await loadExpenseProgram(gate.db, gate.row.program_id);
  const check = validatePayeeAnswer(params.field, params.value, program?.payeeTypes ?? []);
  if (!check.valid) return { success: false, error: check.error };

  const { error } = await gate.db
    .from("expense_claims")
    .update({ [PAYEE_COLUMNS[params.field]]: check.clean, updated_at: new Date().toISOString() })
    .eq("id", gate.row.id);
  return error ? { success: false, error: error.message } : { success: true, data: null };
}

/**
 * Save one slot. For a distance category the amount is worked out here from
 * the kilometres, never taken from the browser.
 */
export async function saveExpenseLine(params: {
  claimId: string;
  categoryKey: string;
  amountCents: number;
  taxCents: number;
  distanceKm: number | null;
  description: string | null;
}): Promise<Result<{ amountCents: number }>> {
  const gate = await editableClaim(params.claimId);
  if (!gate.ok) return { success: false, error: gate.error };
  const program = await loadExpenseProgram(gate.db, gate.row.program_id);
  const source = await resolveClaimSource(gate.row.source_table, gate.row.source_id);
  const category = applyClaimCaps(program?.categories ?? [], source?.caps).find((c) => c.key === params.categoryKey);
  if (!category) return { success: false, error: "That expense isn't part of this program." };
  const allowed = source?.allowedKeys();
  if (allowed && !allowed.includes(category.key)) return { success: false, error: `${category.label} isn't part of this claim.` };

  const whole = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n) : NaN);
  const distanceKm =
    category.measure === "distance" && typeof params.distanceKm === "number" && Number.isFinite(params.distanceKm)
      ? Math.round(params.distanceKm * 10) / 10
      : null;
  const line: ExpenseLine = {
    categoryKey: category.key,
    amountCents:
      category.measure === "distance" ? distanceAmountCents(distanceKm ?? 0, category.rateCentsPerKm ?? 0) : whole(params.amountCents),
    taxCents: category.measure === "distance" ? 0 : whole(params.taxCents),
    distanceKm,
    description: params.description?.trim().slice(0, 500) || null,
    receiptCount: 0,
  };
  if (Number.isNaN(line.amountCents) || Number.isNaN(line.taxCents)) return { success: false, error: "Enter amounts as numbers." };
  if (category.measure === "distance" && distanceKm === null) {
    line.distanceKm = null;
  } else {
    const problem = lineProblem(category, line);
    if (problem) return { success: false, error: problem };
  }

  const { error } = await gate.db.from("expense_claim_lines").upsert(
    {
      claim_id: gate.row.id,
      category_key: category.key,
      amount_cents: line.amountCents,
      tax_cents: line.taxCents,
      distance_km: line.distanceKm,
      description: line.description,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "claim_id,category_key" }
  );
  if (error) return { success: false, error: error.message };
  await touch(gate.db, gate.row.id);
  return { success: true, data: { amountCents: line.amountCents } };
}

/** The line a receipt hangs on, created empty if the claimant uploads first. */
async function ensureLineId(db: ReturnType<typeof createAdminClient>, claimId: string, categoryKey: string) {
  const { data: existing } = await db
    .from("expense_claim_lines")
    .select("id")
    .eq("claim_id", claimId)
    .eq("category_key", categoryKey)
    .maybeSingle();
  if (existing) return existing.id;
  const { data, error } = await db
    .from("expense_claim_lines")
    .upsert({ claim_id: claimId, category_key: categoryKey }, { onConflict: "claim_id,category_key" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

/**
 * Authorize a receipt upload and hand back a signed, single-use URL the browser
 * writes to directly. The bytes never pass through a Server Action (its body
 * is capped well under a phone photo of a hotel folio). See
 * createPartnerDocumentUploadUrl for the history.
 */
export async function createExpenseReceiptUploadUrl(params: {
  claimId: string;
  categoryKey: string;
  fileName: string;
  contentType: string;
  fileSize: number;
}): Promise<Result<{ path: string; token: string }>> {
  const gate = await editableClaim(params.claimId);
  if (!gate.ok) return { success: false, error: gate.error };
  const program = await loadExpenseProgram(gate.db, gate.row.program_id);
  if (!program?.categories.some((c) => c.key === params.categoryKey)) {
    return { success: false, error: "That expense isn't part of this program." };
  }
  if (!RECEIPT_TYPES.includes(params.contentType)) {
    return { success: false, error: "Receipts can be PDF, JPG, PNG, HEIC or WebP." };
  }
  if (params.fileSize > MAX_RECEIPT_BYTES) {
    return { success: false, error: `That file is ${(params.fileSize / 1024 / 1024).toFixed(1)}MB. The limit is 20MB.` };
  }

  const name = params.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
  const path = `${gate.row.id}/${params.categoryKey}/${Date.now()}_${name}`;
  const { data, error } = await gate.db.storage.from("expense-receipts").createSignedUploadUrl(path);
  if (error || !data) return { success: false, error: error?.message ?? "Could not start the upload." };
  return { success: true, data: { path: data.path, token: data.token } };
}

/** Record a receipt once the browser's upload has landed. */
export async function recordExpenseReceipt(params: {
  claimId: string;
  categoryKey: string;
  path: string;
  fileName: string;
  contentType: string;
  fileSize: number;
}): Promise<Result<null>> {
  const gate = await editableClaim(params.claimId);
  if (!gate.ok) return { success: false, error: gate.error };
  // Only a path this claim's upload URL could have produced.
  if (!params.path.startsWith(`${gate.row.id}/${params.categoryKey}/`)) {
    return { success: false, error: "That upload doesn't belong to this claim." };
  }
  const lineId = await ensureLineId(gate.db, gate.row.id, params.categoryKey);
  const { error } = await gate.db.from("expense_claim_receipts").insert({
    line_id: lineId,
    storage_path: params.path,
    file_name: params.fileName.slice(0, 200),
    content_type: params.contentType,
    size_bytes: params.fileSize,
    uploaded_by_user_id: gate.ctx.userId,
  });
  if (error) return { success: false, error: error.message };
  await touch(gate.db, gate.row.id);
  return { success: true, data: null };
}

async function receiptWithClaim(db: ReturnType<typeof createAdminClient>, receiptId: string) {
  const { data } = await db
    .from("expense_claim_receipts")
    .select("id, storage_path, line_id, expense_claim_lines!inner(claim_id)")
    .eq("id", receiptId)
    .maybeSingle();
  if (!data) return null;
  const line = data.expense_claim_lines as unknown as { claim_id: string };
  return { id: data.id, storagePath: data.storage_path, claimId: line.claim_id };
}

export async function removeExpenseReceipt(params: { claimId: string; receiptId: string }): Promise<Result<null>> {
  const gate = await editableClaim(params.claimId);
  if (!gate.ok) return { success: false, error: gate.error };
  const receipt = await receiptWithClaim(gate.db, params.receiptId);
  if (!receipt || receipt.claimId !== gate.row.id) return { success: false, error: "That receipt isn't on this claim." };
  const { error } = await gate.db.from("expense_claim_receipts").delete().eq("id", receipt.id);
  if (error) return { success: false, error: error.message };
  await gate.db.storage.from("expense-receipts").remove([receipt.storagePath]);
  await touch(gate.db, gate.row.id);
  return { success: true, data: null };
}

/** A short-lived link to open a receipt: the claim's editors and CSC admins. */
export async function getExpenseReceiptUrl(receiptId: string): Promise<Result<{ url: string }>> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  const db = createAdminClient();
  const receipt = await receiptWithClaim(db, receiptId);
  const row = receipt ? await loadClaimRow(db, receipt.claimId) : null;
  if (!receipt || !row || !(await canViewClaim(auth.ctx, row))) return { success: false, error: "That receipt isn't available." };
  const { data, error } = await db.storage.from("expense-receipts").createSignedUrl(receipt.storagePath, RECEIPT_URL_TTL_SECONDS);
  if (error || !data) return { success: false, error: error?.message ?? "Could not open the receipt." };
  return { success: true, data: { url: data.signedUrl } };
}

/** Submit. Everything the rules ask for, or nothing. */
export async function submitExpenseClaim(claimId: string): Promise<Result<null>> {
  const gate = await editableClaim(claimId);
  if (!gate.ok) return { success: false, error: gate.error };
  const view = await buildClaimView(gate.db, gate.row, gate.ctx);
  if (!view) return { success: false, error: "That claim's program is missing." };
  if (view.gaps.length > 0) return { success: false, error: view.gaps[0] };

  const now = new Date().toISOString();
  // A resubmission starts the approvals over: what was approved was a
  // different claim.
  await gate.db.from("expense_claim_approvals").delete().eq("claim_id", gate.row.id);
  const { error } = await gate.db
    .from("expense_claims")
    .update({ status: "submitted", submitted_at: now, submitted_by_user_id: gate.ctx.userId, updated_at: now })
    .eq("id", gate.row.id)
    .in("status", ["draft", "returned"]);
  if (error) return { success: false, error: error.message };

  await logAuditEventSafe({
    action: "expense_claim_submitted",
    entityType: "expense_claim",
    entityId: gate.row.id,
    actorId: gate.ctx.userId,
    actorType: "user",
    details: { organizationId: gate.row.organization_id, totals: view.totals, payeeType: view.payee.type },
  });
  await tellClaimant(gate.row.id, "expense_claim_received", gate.ctx);
  revalidatePath("/admin/expenses");
  return { success: true, data: null };
}

// ─────────────────────────────────────────────────────────────────
// Staff: review and approval
// ─────────────────────────────────────────────────────────────────

/** Every claim that is waiting, or has been decided, newest first. */
export async function listExpenseClaimsForReview(): Promise<Result<ExpenseClaimView[]>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };
  const db = createAdminClient();
  const { data, error } = await db
    .from("expense_claims")
    .select("*")
    .neq("status", "draft")
    .order("submitted_at", { ascending: false });
  if (error) return { success: false, error: error.message };
  const views = await Promise.all((data as ClaimRow[]).map((row) => buildClaimView(db, row, auth.ctx)));
  return { success: true, data: views.filter((v): v is ExpenseClaimView => v !== null) };
}

/**
 * One approval. The rules (admin, not the claimant, not linked to the payee,
 * not twice) and the hand-off to QuickBooks live in approve_expense_claim(),
 * so they hold however this is called.
 */
export async function approveExpenseClaim(claimId: string): Promise<Result<{ outcome: "pending" | "approved" }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };
  const { data, error } = await createAdminClient().rpc("approve_expense_claim", {
    p_claim_id: claimId,
    p_approver: auth.ctx.userId,
  });
  if (error) {
    const code = Object.keys(APPROVAL_REFUSALS).find((k) => error.message.includes(k));
    return { success: false, error: code ? APPROVAL_REFUSALS[code] : error.message };
  }
  const outcome = data === "approved" ? "approved" : "pending";
  await logAuditEventSafe({
    action: outcome === "approved" ? "expense_claim_approved" : "expense_claim_first_approval",
    entityType: "expense_claim",
    entityId: claimId,
    actorId: auth.ctx.userId,
    actorType: "user",
  });
  // Only the approval that completes it: the first of two tells nobody anything.
  if (outcome === "approved") await tellClaimant(claimId, "expense_claim_approved", auth.ctx);
  revalidatePath("/admin/expenses");
  return { success: true, data: { outcome } };
}

/**
 * Send back for changes (the claimant can edit and resubmit) or decline
 * (final). Either needs a note, which the claimant sees. Any approvals so far
 * are cleared: they were for the claim as it stood.
 */
export async function decideExpenseClaim(params: {
  claimId: string;
  decision: "returned" | "rejected";
  note: string;
}): Promise<Result<null>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };
  const note = params.note.trim().slice(0, 2000);
  if (!note) return { success: false, error: "Say what needs to change, or why it's declined." };
  if (params.decision !== "returned" && params.decision !== "rejected") return { success: false, error: "Unknown decision." };

  const db = createAdminClient();
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("expense_claims")
    .update({
      status: params.decision,
      decision_note: note,
      decided_by_user_id: auth.ctx.userId,
      decided_at: now,
      updated_at: now,
    })
    .eq("id", params.claimId)
    .eq("status", "submitted")
    .select("id");
  if (error) return { success: false, error: error.message };
  if (!data?.length) return { success: false, error: "That claim isn't waiting for approval." };
  await db.from("expense_claim_approvals").delete().eq("claim_id", params.claimId);

  await logAuditEventSafe({
    action: params.decision === "returned" ? "expense_claim_returned" : "expense_claim_rejected",
    entityType: "expense_claim",
    entityId: params.claimId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { note },
  });
  await tellClaimant(params.claimId, params.decision === "returned" ? "expense_claim_returned" : "expense_claim_rejected", auth.ctx);
  revalidatePath("/admin/expenses");
  return { success: true, data: null };
}

/** Where a program's payables are expensed in QuickBooks. */
export async function setExpenseProgramQbo(params: {
  programId: string;
  expenseAccountId: string | null;
  taxCodeId: string | null;
}): Promise<Result<null>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };
  const { error } = await createAdminClient()
    .from("expense_programs")
    .update({
      qbo_expense_account_id: params.expenseAccountId || null,
      qbo_tax_code_id: params.taxCodeId || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.programId);
  if (error) return { success: false, error: error.message };
  await logAuditEventSafe({
    action: "expense_program_qbo_set",
    entityType: "expense_program",
    entityId: params.programId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { expenseAccountId: params.expenseAccountId, taxCodeId: params.taxCodeId },
  });
  revalidatePath("/admin/expenses");
  return { success: true, data: null };
}

/** The programs and their QuickBooks settings, for the review page. */
export async function listExpensePrograms(): Promise<
  Result<Array<{ id: string; name: string; qboExpenseAccountId: string | null; qboTaxCodeId: string | null }>>
> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };
  const { data, error } = await createAdminClient()
    .from("expense_programs")
    .select("id, name, qbo_expense_account_id, qbo_tax_code_id")
    .eq("is_active", true)
    .order("created_at");
  if (error) return { success: false, error: error.message };
  return {
    success: true,
    data: (data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      qboExpenseAccountId: p.qbo_expense_account_id,
      qboTaxCodeId: p.qbo_tax_code_id,
    })),
  };
}
