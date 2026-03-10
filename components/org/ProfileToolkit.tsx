"use client";

import { useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { requestProfileUpdate } from "@/lib/actions/request-update";

interface ProfileToolkitProps {
  organizationId: string;
  organizationName: string;
}

/**
 * Floating toolkit for profile actions.
 * Expandable FAB that reveals available tools.
 * Currently includes: Flag for Update
 * Future tools: Edit, Share, Export, etc.
 */
export default function ProfileToolkit({
  organizationId,
  organizationName,
}: ProfileToolkitProps) {
  const { user, profile, permissionState, organizations } = useAuth();
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeTool, setActiveTool] = useState<"flag" | null>(null);

  // Check permissions
  const isOrgAdminForThisOrg = organizations.some(
    (uo) => uo.organization.id === organizationId && uo.role === "org_admin"
  );
  const isGlobalAdmin = permissionState === "super_admin" || permissionState === "admin";

  // Flag tool available to any logged-in user who isn't an admin for THIS org
  // (org_admins can edit directly, so they don't need to flag)
  const canFlag = user && !isOrgAdminForThisOrg && !isGlobalAdmin;

  // If no tools available (not logged in, or is admin for this org), don't render
  if (!canFlag) {
    return null;
  }

  const handleToolClick = (tool: "flag") => {
    setActiveTool(tool);
    setIsExpanded(false);
  };

  const handleClose = () => {
    setActiveTool(null);
  };

  return (
    <>
      {/* Floating Toolkit Button */}
      <div className="fixed bottom-8 right-8 z-40 flex flex-col-reverse items-center gap-3">
        {/* Tool buttons (shown when expanded) */}
        {isExpanded && (
          <div className="flex flex-col gap-2 mb-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
            {canFlag && (
              <button
                onClick={() => handleToolClick("flag")}
                className="w-10 h-10 bg-white hover:bg-gray-50 text-gray-600 rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-105 group relative"
                title="Flag for update"
              >
                <FlagIcon />
                <span className="absolute right-full mr-3 px-2 py-1 bg-gray-900 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  Flag for Update
                </span>
              </button>
            )}
            {/* Future tools can be added here */}
          </div>
        )}

        {/* Main FAB */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={`w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-105 ${
            isExpanded
              ? "bg-gray-600 hover:bg-gray-700 text-white rotate-45"
              : "bg-gray-700 hover:bg-gray-800 text-white"
          }`}
          title={isExpanded ? "Close toolkit" : "Open toolkit"}
        >
          <PlusIcon />
        </button>
      </div>

      {/* Flag Modal */}
      {activeTool === "flag" && (
        <FlagModal
          organizationId={organizationId}
          organizationName={organizationName}
          userEmail={user?.email || ""}
          userName={profile?.display_name || undefined}
          onClose={handleClose}
        />
      )}
    </>
  );
}

/**
 * Flag for Update modal
 */
function FlagModal({
  organizationId,
  organizationName,
  userEmail,
  userName,
  onClose,
}: {
  organizationId: string;
  organizationName: string;
  userEmail: string;
  userName?: string;
  onClose: () => void;
}) {
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;

    setIsSubmitting(true);
    setError(null);

    const result = await requestProfileUpdate({
      organizationId,
      organizationName,
      requesterEmail: userEmail,
      requesterName: userName,
      message: message.trim(),
    });

    setIsSubmitting(false);

    if (result.success) {
      setSubmitted(true);
      setTimeout(onClose, 2000);
    } else {
      setError(result.error || "Failed to submit request");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => !isSubmitting && onClose()}
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
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                  <FlagIcon className="text-amber-600" />
                </div>
                <h3 className="text-lg font-semibold text-[#1A1A1A]">
                  Flag for Update
                </h3>
              </div>
              <button
                onClick={onClose}
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
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#D60001] focus:border-transparent resize-none"
                autoFocus
                required
              />

              {error && (
                <p className="text-sm text-red-600 mt-2">{error}</p>
              )}

              <div className="flex justify-end gap-3 mt-4">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isSubmitting}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !message.trim()}
                  className="px-4 py-2 bg-[#D60001] text-white text-sm font-medium rounded-md hover:bg-[#B00001] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isSubmitting ? "Sending..." : "Send Flag"}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

// Icons
function PlusIcon() {
  return (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function FlagIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={`w-5 h-5 ${className}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v1.5M3 21v-6m0 0 2.77-.693a9 9 0 0 1 6.208.682l.108.054a9 9 0 0 0 6.086.71l3.114-.732a48.524 48.524 0 0 1-.005-10.499l-3.11.732a9 9 0 0 1-6.085-.711l-.108-.054a9 9 0 0 0-6.208-.682L3 4.5M3 15V4.5" />
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
