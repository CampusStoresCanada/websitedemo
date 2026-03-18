"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { verifyApplicationEmail } from "@/lib/actions/applications";

export function VerifyApplication() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setErrorMsg("No verification token provided.");
      return;
    }

    verifyApplicationEmail(token).then((result) => {
      if (result.success) {
        setStatus("success");
      } else {
        setStatus("error");
        setErrorMsg(result.error || "Verification failed.");
      }
    });
  }, [token]);

  if (status === "loading") {
    return (
      <div className="text-center py-8">
        <div className="w-8 h-8 border-2 border-gray-300 border-t-[#EE2A2E] rounded-full animate-spin mx-auto mb-4" />
        <p className="text-sm text-gray-600">Verifying your application…</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="text-center py-6">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-50 flex items-center justify-center">
          <svg
            className="w-8 h-8 text-red-500"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
            />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          Verification Failed
        </h2>
        <p className="text-gray-600 text-sm mb-6">{errorMsg}</p>
        <Link
          href="/"
          className="inline-flex items-center justify-center px-6 py-2.5 bg-[#EE2A2E] text-white text-sm font-medium rounded-lg hover:bg-[#D92327] transition-colors"
        >
          Go Home
        </Link>
      </div>
    );
  }

  return (
    <div className="text-center py-6">
      <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-green-50 flex items-center justify-center">
        <svg
          className="w-8 h-8 text-green-500"
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
      </div>
      <h2 className="text-xl font-semibold text-gray-900 mb-2">
        Email Verified!
      </h2>
      <p className="text-gray-600 text-sm mb-6">
        Your application has been submitted and is now under review. We&apos;ll
        notify you by email once our team has reviewed your application.
      </p>
      <Link
        href="/"
        className="inline-flex items-center justify-center px-6 py-2.5 bg-[#EE2A2E] text-white text-sm font-medium rounded-lg hover:bg-[#D92327] transition-colors"
      >
        Return Home
      </Link>
    </div>
  );
}
