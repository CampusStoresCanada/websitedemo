"use client";

import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const rawNext = searchParams.get("next");
  const nextPath = rawNext && rawNext.startsWith("/") ? rawNext : "/";

  useEffect(() => {
    if (!rawNext) return;
    const normalized = rawNext.toLowerCase();
    const loopDetected =
      normalized.startsWith("/login") || normalized.includes("next=/login");
    if (!loopDetected) return;
    void fetch("/api/telemetry/auth-event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      keepalive: true,
      body: JSON.stringify({
        event: "auth_login_redirect_loop",
        details: { rawNext, normalizedNext: nextPath },
      }),
    }).catch(() => {});
  }, [rawNext, nextPath]);

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setIsLoading(false);
      return;
    }

    window.location.assign(nextPath);
  };

  return (
    <div>
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handlePasswordLogin} className="space-y-4">
        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/20 focus:border-[#EE2A2E] transition-colors"
            placeholder="you@yourschool.ca"
          />
        </div>
        <div>
          <label
            htmlFor="password"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/20 focus:border-[#EE2A2E] transition-colors"
            placeholder="Enter your password"
          />
        </div>
        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-2.5 bg-[#EE2A2E] text-white text-sm font-medium rounded-lg hover:bg-[#D92327] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? "Signing in..." : "Sign In"}
        </button>
        <div className="text-center">
          <Link
            href={rawNext ? `/forgot-password?next=${encodeURIComponent(nextPath)}` : "/forgot-password"}
            className="text-sm text-gray-500 hover:text-[#EE2A2E] transition-colors"
          >
            Forgot your password?
          </Link>
        </div>
      </form>

      <div className="mt-6 pt-6 border-t border-gray-200 text-center">
        <p className="text-sm text-gray-600">
          New to CSC?{" "}
          <Link
            href="/membership"
            className="text-[#EE2A2E] hover:text-[#D92327] font-medium"
          >
            Apply for membership
          </Link>
          {" "}or{" "}
          <Link
            href="/partnership"
            className="text-[#EE2A2E] hover:text-[#D92327] font-medium"
          >
            partner with us
          </Link>
        </p>
      </div>
    </div>
  );
}
