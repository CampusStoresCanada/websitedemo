"use client";

import { useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { requestProfileUpdate } from "@/lib/actions/request-update";

interface RequestUpdateButtonProps {
  organizationId: string;
  organizationName: string;
}

/**
 * Floating action button (FAB) for requesting profile updates.
 * Appears in the bottom-right corner for logged-in members/partners
 * who are not admins for this organization.
 */
export default function RequestUpdateButton({
  organizationId,
  organizationName,
}: RequestUpdateButtonProps) {
  const { user, profile, permissionState, organizations } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only show for logged-in members/partners who are NOT admins for this org
  const isOrgAdminForThisOrg = organizations.some(
    (uo) => uo.organization.id === organizationId && uo.role === "org_admin"
  );
  const isGlobalAdmin = permissionState === "super_admin" || permissionState === "admin";
  const canRequestUpdate =
    user &&
    (permissionState === "member" || permissionState === "partner" || permissionState === "org_admin") &&
    !isOrgAdminForThisOrg &&
    !isGlobalAdmin;

  if (!canRequestUpdate) {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || !user?.email) return;

    setIsSubmitting(true);
    setError(null);

    const result = await requestProfileUpdate({
      organizationId,
      organizationName,
      requesterEmail: user.email,
      requesterName: profile?.display_name || undefined,
      message: message.trim(),
    });

    setIsSubmitting(false);

    if (result.success) {
      setSubmitted(true);
      setTimeout(() => {
        setIsOpen(false);
        setSubmitted(false);
        setMessage("");
      }, 2000);
    } else {
      setError(result.error || "Failed to submit request");
    }
  };

  return (
    <>
      {/* Floating Action Button - bottom right */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-8 right-8 z-40 w-12 h-12 bg-gray-700 hover:bg-gray-800 text-white rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-105 group"
        title="Request profile update"
      >
        <PencilIcon />
        {/* Tooltip on hover */}
        <span className="absolute right-full mr-3 px-3 py-1.5 bg-gray-900 text-white text-sm rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          Request Update
        </span>
      </button>

      {/* Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => !isSubmitting && setIsOpen(false)}
          />

          {/* Modal content */}
          <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md p-6">
            {submitted ? (
              <div className="text-center py-8">
                <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckIcon />
                </div>
                <h3 className="text-lg font-semibold text-[#1A1A1A]">Request Sent</h3>
                <p className="text-gray-500 mt-2">
                  The organization admins have been notified.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-[#1A1A1A]">
                    Request Profile Update
                  </h3>
                  <button
                    onClick={() => setIsOpen(false)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <CloseIcon />
                  </button>
                </div>

                <p className="text-sm text-gray-500 mb-4">
                  Let the admins of <strong>{organizationName}</strong> know what information needs to be updated.
                </p>

                <form onSubmit={handleSubmit}>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="e.g., John Smith is no longer with the organization. The new contact is Jane Doe (jane@example.com)."
                    rows={4}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#EE2A2E] focus:border-transparent resize-none"
                    required
                  />

                  {error && (
                    <p className="text-sm text-red-600 mt-2">{error}</p>
                  )}

                  <div className="flex justify-end gap-3 mt-4">
                    <button
                      type="button"
                      onClick={() => setIsOpen(false)}
                      disabled={isSubmitting}
                      className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmitting || !message.trim()}
                      className="px-4 py-2 bg-[#EE2A2E] text-white text-sm font-medium rounded-md hover:bg-[#D92327] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {isSubmitting ? "Sending..." : "Send Request"}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function PencilIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}
