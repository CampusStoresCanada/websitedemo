"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  createExpenseReceiptUploadUrl,
  getExpenseReceiptUrl,
  recordExpenseReceipt,
  removeExpenseReceipt,
} from "@/lib/actions/expense-claims";
import type { ExpenseReceipt } from "@/lib/expenses/claims";

/** Some browsers report an iPhone photo's type as blank; the name still says it. */
function receiptType(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ext === "heic" ? "image/heic" : ext === "heif" ? "image/heif" : "";
}

/**
 * The receipts on one expense: open, add, remove. Used by the claimant's form
 * (editable) and the review panel (read-only), so both open a receipt the same
 * way: a short-lived signed link, never a public URL.
 */
export default function ReceiptList({
  claimId,
  categoryKey,
  receipts,
  editable,
  onChanged,
}: {
  claimId: string;
  categoryKey: string;
  receipts: ExpenseReceipt[];
  editable: boolean;
  onChanged?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async (id: string) => {
    setError(null);
    const result = await getExpenseReceiptUrl(id);
    if (result.success) window.open(result.data.url, "_blank", "noopener");
    else setError(result.error);
  };

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const contentType = receiptType(file);
      // The server authorizes and names the destination; the file goes
      // straight from the browser to storage, never through a Server Action.
      const authorized = await createExpenseReceiptUploadUrl({
        claimId,
        categoryKey,
        fileName: file.name,
        contentType,
        fileSize: file.size,
      });
      if (!authorized.success) {
        setError(authorized.error);
        return;
      }
      const { error: uploadError } = await createClient()
        .storage.from("expense-receipts")
        .uploadToSignedUrl(authorized.data.path, authorized.data.token, file, { contentType });
      if (uploadError) {
        setError(uploadError.message || "Upload failed.");
        return;
      }
      const recorded = await recordExpenseReceipt({
        claimId,
        categoryKey,
        path: authorized.data.path,
        fileName: file.name,
        contentType,
        fileSize: file.size,
      });
      if (!recorded.success) setError(recorded.error);
      else onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError(null);
    const result = await removeExpenseReceipt({ claimId, receiptId: id });
    setBusy(false);
    if (!result.success) setError(result.error);
    else onChanged?.();
  };

  return (
    <div className="mt-2 text-sm">
      {receipts.length > 0 && (
        <ul className="space-y-1">
          {receipts.map((r) => (
            <li key={r.id} className="flex items-center gap-3">
              <button type="button" onClick={() => open(r.id)} className="text-[#163D6D] underline">
                {r.fileName}
              </button>
              {editable && (
                <button type="button" onClick={() => remove(r.id)} disabled={busy} className="text-xs text-gray-500 underline">
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <label className="mt-1 inline-block cursor-pointer text-[#163D6D] underline">
          {busy ? "Uploading…" : receipts.length ? "Add another receipt" : "Attach a receipt"}
          <input
            type="file"
            className="sr-only"
            accept="application/pdf,image/jpeg,image/png,image/heic,image/heif,image/webp,.heic,.heif"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void upload(file);
            }}
          />
        </label>
      )}
      {error && <p className="mt-1 text-red-700">{error}</p>}
    </div>
  );
}
