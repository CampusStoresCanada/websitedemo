"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type LoginMode = "password" | "magic-link";

export default function LoginForm() {
  const [mode, setMode] = useState<LoginMode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const router = useRouter();
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

    router.push(nextPath);
    router.refresh();
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
      },
    });

    if (error) {
      setError(error.message);
      setIsLoading(false);
      return;
    }

    setMagicLinkSent(true);
    setIsLoading(false);
  };

  if (magicLinkSent) {
    return (
      <div className="text-center py-8">
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
              d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75"
            />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          Check your email
        </h2>
        <p className="text-gray-600 mb-6">
          We&apos;ve sent a login link to{" "}
          <span className="font-medium text-gray-900">{email}</span>
        </p>
        <button
          onClick={() => {
            setMagicLinkSent(false);
            setEmail("");
          }}
          className="text-sm text-[#D60001] hover:text-[#B00001] font-medium"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Mode tabs */}
      <div className="flex border-b border-gray-200 mb-6">
        <button
          onClick={() => {
            setMode("password");
            setError(null);
          }}
          className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
            mode === "password"
              ? "border-[#D60001] text-[#D60001]"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Email &amp; Password
        </button>
        <button
          onClick={() => {
            setMode("magic-link");
            setError(null);
          }}
          className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
            mode === "magic-link"
              ? "border-[#D60001] text-[#D60001]"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Magic Link
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      {mode === "password" ? (
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
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#D60001]/20 focus:border-[#D60001] transition-colors"
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
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#D60001]/20 focus:border-[#D60001] transition-colors"
              placeholder="Enter your password"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2.5 bg-[#D60001] text-white text-sm font-medium rounded-lg hover:bg-[#B00001] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? "Signing in..." : "Sign In"}
          </button>
          <div className="text-center">
            <Link
              href="/forgot-password"
              className="text-sm text-gray-500 hover:text-[#D60001] transition-colors"
            >
              Forgot your password?
            </Link>
          </div>
        </form>
      ) : (
        <form onSubmit={handleMagicLink} className="space-y-4">
          <div>
            <label
              htmlFor="magic-email"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Email
            </label>
            <input
              id="magic-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#D60001]/20 focus:border-[#D60001] transition-colors"
              placeholder="you@yourschool.ca"
            />
          </div>
          <p className="text-xs text-gray-500">
            We&apos;ll send you a link to sign in instantly — no password needed.
          </p>
          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2.5 bg-[#D60001] text-white text-sm font-medium rounded-lg hover:bg-[#B00001] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? "Sending link..." : "Send Magic Link"}
          </button>
        </form>
      )}

      <div className="mt-6 pt-6 border-t border-gray-200 text-center">
        <p className="text-sm text-gray-600">
          Not a member yet?{" "}
          <Link
            href="/signup"
            className="text-[#D60001] hover:text-[#B00001] font-medium"
          >
            Join CSC
          </Link>
        </p>
      </div>
    </div>
  );
}
