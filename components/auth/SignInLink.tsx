"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { loginWithNext } from "@/lib/auth/login-redirect";

/**
 * Where a "Sign In" control on a public page should point.
 *
 * ⛔ A bare href="/login" throws the destination away. LoginForm defaults
 * `next` to "/", so someone who opens an emailed link, lands on a member page
 * with the content blurred, and clicks Sign In ends up on the homepage with no
 * idea what happened to their link.
 *
 * The loginWithNext sweep covered gates that REDIRECT. These pages never
 * redirect — they render publicly and offer a button — so not one of them was
 * in scope, and they are the shape people actually complain about.
 *
 * Pathname only, deliberately no useSearchParams(): that hook forces a Suspense
 * boundary onto every statically rendered page embedding one of these, and a
 * lost filter is not what anyone is reporting when they ask why they are
 * looking at the homepage.
 */

// Signing in and then being sent back to an auth screen is a loop, and
// LoginForm reports next=/login to telemetry as exactly that. The Header
// renders on /login itself, so this is reachable, not hypothetical.
const AUTH_ROUTES = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/auth",
];

/** The decision, without React, so it can be tested. */
export function loginHrefForPath(pathname: string | null | undefined): string {
  if (!pathname) return "/login";
  const isAuthScreen = AUTH_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
  return isAuthScreen ? "/login" : loginWithNext(pathname);
}

export function useLoginHref(): string {
  return loginHrefForPath(usePathname());
}

/**
 * For server components, which cannot call the hook. Same link, same rules.
 */
export default function SignInLink({
  children,
  className,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const href = useLoginHref();
  return (
    <Link href={href} className={className} style={style}>
      {children}
    </Link>
  );
}
