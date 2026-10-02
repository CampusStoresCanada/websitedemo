import { describe, it, expect } from "vitest";
import { loginHrefForPath } from "../SignInLink";

/**
 * The regression this pins down: a "Sign In" button on a public page used to be
 * a bare href="/login", so anyone who opened an emailed link, found the content
 * blurred, and signed in from there landed on the homepage. The loginWithNext
 * sweep only covered gates that redirect; these pages render and offer a
 * button, so none of them were in it.
 */
describe("loginHrefForPath", () => {
  it("comes back to the page the button was on", () => {
    expect(loginHrefForPath("/members")).toBe("/login?next=%2Fmembers");
    expect(loginHrefForPath("/org/algonquin-college")).toBe(
      "/login?next=%2Forg%2Falgonquin-college",
    );
  });

  it("does not point an auth screen back at itself", () => {
    // ⛔ The Header renders on /login, so next=/login is reachable — and
    // LoginForm reports exactly that to telemetry as a redirect loop.
    for (const path of [
      "/login",
      "/signup",
      "/forgot-password",
      "/reset-password",
      "/auth/callback",
    ]) {
      expect(loginHrefForPath(path)).toBe("/login");
    }
  });

  it("falls back when there is no pathname", () => {
    expect(loginHrefForPath(null)).toBe("/login");
    expect(loginHrefForPath("")).toBe("/login");
  });

  it("does not treat a lookalike route as an auth screen", () => {
    expect(loginHrefForPath("/logins")).toBe("/login?next=%2Flogins");
    expect(loginHrefForPath("/authors")).toBe("/login?next=%2Fauthors");
  });
});
