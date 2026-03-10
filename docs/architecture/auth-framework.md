# Auth Framework Contract

## Goal
All page, API, and server-action auth must flow through one framework (`lib/auth/guards.ts`).
No inline auth primitives (`supabase.auth.getClaims()`, ad hoc role logic) are allowed in feature code.

## Canonical Path
1. Resolve identity once with `requireAuthenticated()`.
2. Apply standardized authorization guard:
   - `requireAdmin()`
   - `requireSuperAdmin()`
   - `requireReviewerOrAdmin()`
   - `requireOrgAdminOrSuperAdmin(orgId)`
3. Continue with business logic only if guard passes.

## Rules
1. Do not call `supabase.auth.getClaims()` in pages/actions/api routes.
2. Do not duplicate `profiles.global_role` checks inline.
3. Do not duplicate `user_organizations.role` checks inline.
4. UI permission states (`useAuth`) are display hints only; server guards are authoritative.

## Failure Semantics
- `401`: unauthenticated
- `403`: authenticated but not authorized

## Reuse Patterns
- Server action:
  - Guard at top of function.
  - Return standardized error shape.
- API route:
  - Guard at top of handler.
  - Convert guard failure to `NextResponse.json(..., { status })`.
- Server page/layout:
  - Guard and redirect if needed.

## Migration Policy
- Existing files should be migrated to guards incrementally.
- New files must use guards from day one.

## Identity Dependency
Auth guards protect account access; person/contact lifecycle is governed by the identity contract: [Identity Lifecycle](./identity-lifecycle.md).
All new identity-bearing features must follow that model.
