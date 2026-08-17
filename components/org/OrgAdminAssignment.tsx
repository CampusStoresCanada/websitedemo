"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setContactOrgAdmin } from "@/lib/actions/user-management";
import {
  AdminTransferFlow,
  type PendingTransferInfo,
  type TransferCandidate,
} from "@/components/org/admin/AdminTransferFlow";

/**
 * Per-contact Admin toggle for the org profile's people table.
 *
 * Deliberately addressed by contact id, not user id: the table lists
 * contacts, and some of them have no account yet. Ticking one of those
 * provisions the login and invites them as an admin in a single pass rather
 * than sending the org admin off to a separate screen first.
 */
export function ContactAdminToggle({
  organizationId,
  contactId,
  contactName,
  isAdmin,
  hasLogin,
  disabled,
  onError,
}: {
  organizationId: string;
  contactId: string;
  contactName: string | null;
  isAdmin: boolean;
  hasLogin: boolean;
  disabled: boolean;
  onError: (message: string | null) => void;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function handleToggle(checked: boolean) {
    onError(null);

    // Granting admin to someone with no account creates it and emails them —
    // too consequential to happen on a stray click without a word.
    if (checked && !hasLogin) {
      const who = contactName?.trim() || "this contact";
      const confirmed = window.confirm(
        `${who} doesn't have a login yet. Making them an admin will create their account and email them an invite. Continue?`
      );
      if (!confirmed) return;
    }

    setSaving(true);
    try {
      const result = await setContactOrgAdmin(organizationId, contactId, checked);
      if (!result.success) {
        onError(result.error ?? "Failed to update admin access.");
        return;
      }
      if (result.outcome === "invited_as_admin") {
        onError(`Invite sent — ${contactName?.trim() || "they"} will be an admin once they set a password.`);
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <input
      type="checkbox"
      aria-label={`Org admin for ${contactName ?? "contact"}`}
      checked={isAdmin}
      disabled={disabled || saving}
      onChange={(event) => void handleToggle(event.target.checked)}
      className="h-4 w-4"
    />
  );
}

/**
 * Admin handover, inline on the org profile.
 *
 * The standalone /org/[slug]/admin/transfer page was retired in favour of
 * this. The ceremony itself is unchanged — a pending request the successor
 * has to accept, with a timeout fallback — because handing over sole control
 * is a different risk from adding a co-admin, which the toggle above does
 * immediately.
 */
export function AdminHandoverSection({
  organizationId,
  orgSlug,
  viewerUserId,
  candidates,
  pendingTransfer,
}: {
  organizationId: string;
  orgSlug: string;
  viewerUserId: string | null;
  candidates: TransferCandidate[];
  pendingTransfer: PendingTransferInfo | null;
}) {
  const [open, setOpen] = useState(false);

  if (!viewerUserId) return null;

  // Always surface a transfer that's already in flight — the successor needs
  // somewhere to accept it now that the dedicated page is gone.
  const mustShow = pendingTransfer !== null;

  return (
    <div className="mt-6 pt-4 border-t border-gray-200">
      {!mustShow && !open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs font-medium text-gray-500 hover:text-gray-800 transition-colors"
        >
          Hand over admin →
        </button>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs uppercase tracking-wider text-gray-500 font-semibold">
              {pendingTransfer ? "Admin transfer in progress" : "Hand over admin"}
            </h4>
            {!mustShow && (
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Close
              </button>
            )}
          </div>
          <p className="text-[11px] text-gray-500 mb-3">
            Use this to hand your own admin rights to someone else — they have to
            accept. To simply add or remove another admin, use the Admin column above.
          </p>
          <AdminTransferFlow
            orgId={organizationId}
            orgSlug={orgSlug}
            currentUserId={viewerUserId}
            candidates={candidates}
            pendingTransfer={pendingTransfer}
          />
        </div>
      )}
    </div>
  );
}
