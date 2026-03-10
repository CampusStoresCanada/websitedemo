"use client";

import { useState, useMemo } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { createClient } from "@/lib/supabase/client";

interface FlagButtonProps {
  organizationId: string;
  fieldName: string;
}

/**
 * Small flag icon that allows authenticated users to flag content as outdated/incorrect.
 * Stub implementation — creates a record in content_flags but no admin UI for reviewing yet.
 */
export default function FlagButton({
  organizationId,
  fieldName,
}: FlagButtonProps) {
  const { user } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const supabase = useMemo(() => createClient(), []);

  if (!user) return null;

  const handleSubmit = async () => {
    setIsSubmitting(true);
    const { error } = await supabase.from("content_flags").insert({
      flagged_by: user.id,
      organization_id: organizationId,
      field_name: fieldName,
      reason: reason || null,
    });

    if (!error) {
      setSubmitted(true);
      setTimeout(() => {
        setShowModal(false);
        setSubmitted(false);
        setReason("");
      }, 1500);
    }
    setIsSubmitting(false);
  };

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="inline-flex items-center text-gray-300 hover:text-amber-500 transition-colors"
        title="Flag as outdated or incorrect"
      >
        <svg
          className="w-3.5 h-3.5"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 3v1.5M3 21v-6m0 0 2.77-.693a9 9 0 0 1 6.208.682l.108.054a9 9 0 0 0 6.086.71l3.114-.732a48.524 48.524 0 0 1-.005-10.499l-3.11.732a9 9 0 0 1-6.085-.711l-.108-.054a9 9 0 0 0-6.208-.682L3 4.5M3 15V4.5"
          />
        </svg>
      </button>

      {showModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-xl border border-gray-200 shadow-xl p-6 w-full max-w-sm mx-4">
            {submitted ? (
              <div className="text-center py-4">
                <svg
                  className="w-8 h-8 text-green-500 mx-auto mb-2"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                  />
                </svg>
                <p className="text-sm text-gray-700">Flag submitted. Thanks!</p>
              </div>
            ) : (
              <>
                <h3 className="text-sm font-semibold text-gray-900 mb-1">
                  Flag Information
                </h3>
                <p className="text-xs text-gray-500 mb-4">
                  Report this as outdated or incorrect. An admin will review it.
                </p>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="What's wrong? (optional)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none h-20 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 mb-4"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setShowModal(false);
                      setReason("");
                    }}
                    className="flex-1 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={isSubmitting}
                    className="flex-1 py-2 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-600 disabled:opacity-50 transition-colors"
                  >
                    {isSubmitting ? "Sending..." : "Submit Flag"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
