# Auth Resilience Changes (2026-02-27)

## Goal
Stabilize auth + permission resolution so valid users are not randomly downgraded to `public` during transient query/network failures.

## Files Changed
1. `/Users/Work/Documents/csc-website/websitedemo/components/providers/AuthProvider.tsx`
2. `/Users/Work/Documents/csc-website/websitedemo/lib/auth/server.ts`
3. `/Users/Work/Documents/csc-website/websitedemo/app/layout.tsx`
4. `/Users/Work/Documents/csc-website/websitedemo/components/layout/Header.tsx`
5. `/Users/Work/Documents/csc-website/websitedemo/components/auth/LoginForm.tsx`

## What Changed

### 1) Client auth bootstrap + retry model (`AuthProvider.tsx`)
- Added explicit initial session bootstrap using `supabase.auth.getSession()` on mount.
- Removed the old forced 5-second loading cutoff that could falsely render users as logged out/degraded.
- Added bounded retry/backoff for permission/profile fetches:
  - `MAX_PERMISSION_RETRIES = 5`
  - exponential delay starting at 500ms + jitter
- Added `lastKnownGoodRef` to preserve previously validated role/permission/org state.
- On repeated data fetch failure:
  - if last-known-good state exists: keep it (no privilege collapse)
  - if no trusted state exists: sign out and reset auth state
- Centralized reset logic in `clearAuthState()` for consistent sign-out handling.
- `refreshPermissions()` now uses the same retry/backoff path.

### 2) Server auth helper hardening (`lib/auth/server.ts`)
- Replaced server auth identity check with `supabase.auth.getUser()`.
- Removed the timeout race that returned synthetic null profile/org data after 3s.
- Profile/org query errors no longer rely on timeout fallback data.
- If profile/org query fails for a request, auth remains identified but authorization data is conservative for that render.

### 3) Dev auth panel production guard (`app/layout.tsx`)
- `DevPanel` now only renders when `NODE_ENV === "development"`.
- Prevents dev auth tools/quick login UI from mounting outside development.

### 4) Threshold re-auth UX (`AuthProvider.tsx` + `Header.tsx`)
- Added explicit infrastructure re-auth state after repeated failures with no trusted permission snapshot.
- User-facing copy:
  - `We couldn’t verify your session after multiple retries. Please sign in again to continue.`
- Added top-of-screen banner with:
  - message
  - `Sign in again` CTA
  - countdown to automatic redirect
- Automatic redirect to login after inactivity timeout:
  - `REAUTH_REDIRECT_DELAY_MS = 25000` (25s)

### 5) Return-to path support for re-auth (`LoginForm.tsx`)
- Login now reads `next` query param and returns user to that route after password login.
- Magic-link flow now includes `next` in `emailRedirectTo` so callback preserves destination.

### 6) Bootstrap race hardening (`AuthProvider.tsx`)
- Added a single `finishBootstrap()` gate so initial loading only resolves once.
- On bootstrap `getSession()` error/timeout, provider now attempts `getUser()` recovery before declaring logged out.
- Added short recovery grace (`BOOTSTRAP_RECOVERY_GRACE_MS = 1500`) to avoid visible logged-out header flashes during transient bootstrap timing failures.
- On empty session from bootstrap, provider performs the same `getUser()` recovery path before falling back to public state.

### 7) Long-loading mitigation (`AuthProvider.tsx`)
- Reduced permission hydration timeout/retry budget:
  - `AUTH_FETCH_TIMEOUT_MS`: `6000` -> `2500`
  - `MAX_PERMISSION_RETRIES`: `5` -> `3`
- Session bootstrap now resolves as soon as identity is known (`session.user` present), while profile/permission hydration continues asynchronously.
- Result: users should no longer wait ~30s for the shell/header to reflect signed-in state.

### 8) Server guard downgrade fix (`lib/auth/guards.ts`)
- Removed silent fallback to `globalRole="user"` when authz queries fail.
- Added bounded retry for server-side profile/org lookups in guards.
- If authz data is unavailable after retries, guard failure is treated as `401` re-auth required (binary behavior), not a degraded permission state.

### 9) Binary bootstrap failure behavior (`AuthProvider.tsx`)
- On bootstrap resolution failures that cannot be recovered via `getUser()`, provider now enters explicit re-auth required state instead of clearing to public silently.
- This removes half-state behavior where header/nav appeared logged out while server pages still recognized the session.

### 10) Role-based idle session policy (`AuthProvider.tsx` + `Header.tsx`)
- Added idle timeout enforcement in the client session layer:
  - `super_admin`: no idle timeout
  - `admin`: 8-hour idle timeout
  - other authenticated users: 25-minute idle timeout
- Added a 5-minute inactivity warning banner for non-admin/non-super-admin users with a `Stay signed in` action.
- On timeout, the app performs sign-out and redirects to `/login?reason=idle_timeout`.

## New Failure Semantics
- Invalid/no session: clear auth state immediately.
- Transient profile/org failure: retry, then retain last-known-good permissions when available.
- Repeated failures with no trusted state: force sign-out (controlled recovery path).
- Repeated failures beyond threshold + no trusted state:
  - show re-auth banner + CTA
  - auto-redirect to `/login?next=<current path>` after timeout if no action.

## Why This Fixes the Reported Degradation
The old flow could end in `isLoading=false` without a resolved session and could also downgrade permissions on transient query failures. The new flow removes the blind timeout downgrade, initializes session deterministically, and preserves trusted permissions across temporary failures.

## Follow-up Validation (recommended)
1. Sign in as `super_admin`, hard refresh, verify role remains stable.
2. Simulate temporary network failure during profile/org fetch and verify no immediate privilege drop.
3. Simulate repeated failures with no prior trusted state and verify controlled sign-out.
4. Confirm `DevPanel` does not render in non-development environments.
5. Force repeated auth data failures and verify:
   - re-auth banner appears
   - CTA navigates to login with `next`
   - auto-redirect occurs after countdown.
