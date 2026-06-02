"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function CallbackHandler() {
  const searchParams = useSearchParams();
  const [error, setError] = useState(false);

  useEffect(() => {
    const code = searchParams.get("code");
    const next = searchParams.get("next") ?? "/";

    if (!code) {
      setError(true);
      return;
    }

    const supabase = createClient();
    supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
      if (error) {
        setError(true);
      } else {
        window.location.assign(next.startsWith("/") ? next : "/");
      }
    });
  }, [searchParams]);

  if (error) {
    return (
      <div className="text-center space-y-4">
        <p className="text-sm font-medium text-gray-900">That link didn't work.</p>
        <p className="text-xs text-gray-500">It may have expired or already been used.</p>
        <a
          href="/login"
          className="inline-block mt-2 text-sm font-medium text-[#EE2A2E] hover:text-[#D92327] transition-colors"
        >
          Back to sign in →
        </a>
      </div>
    );
  }

  return (
    <div className="text-center space-y-4">
      <div className="w-8 h-8 border-[3px] border-[#EE2A2E] border-t-transparent rounded-full animate-spin mx-auto" />
      <p className="text-sm text-gray-500">Signing you in…</p>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8">
          <div className="flex justify-center mb-6">
            {/* CSC logo mark */}
            <div className="w-10 h-10 rounded-full bg-[#EE2A2E] flex items-center justify-center">
              <span className="text-white text-xs font-bold tracking-tight">CSC</span>
            </div>
          </div>
          <Suspense fallback={
            <div className="text-center space-y-4">
              <div className="w-8 h-8 border-[3px] border-[#EE2A2E] border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm text-gray-500">Signing you in…</p>
            </div>
          }>
            <CallbackHandler />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
