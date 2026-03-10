# Auth Framework Regime (Highway Policy)

## Canonical Rule
All server-side auth decisions must go through `lib/auth/guards.ts`.

## Guard API
- `requireAuthenticated()`
- `requireAdmin()`
- `requireSuperAdmin()`
- `requireReviewerOrAdmin()`
- `requireOrgAdminOrSuperAdmin(orgId)`
- helper predicates:
  - `isGlobalAdmin(role)`
  - `isSuperAdmin(role)`
  - `canManageOrganization(ctx, orgId)`

## Enforcement
- ESLint rule blocks `supabase.auth.getClaims()` in feature code.
- Allowed exception: session middleware (`lib/supabase/middleware.ts`).

## Templates
- Secure page template: `templates/page.secure.tsx`
- Secure action template: `templates/action.secure.ts`

## Migrated to Guard Regime
### Pages / Routes
- `app/admin/layout.tsx`
- `app/admin/policy/page.tsx`
- `app/benchmarking/admin/layout.tsx`
- `app/benchmarking/page.tsx`
- `app/benchmarking/survey/page.tsx`
- `app/api/applications/route.ts`

### Server Actions
- `lib/actions/policy.ts`
- `lib/actions/applications.ts`
- `lib/actions/benchmarking-admin.ts`
- `lib/actions/benchmarking-survey.ts`
- `lib/actions/add-brand-color.ts`
- `lib/actions/delete-brand-color.ts`
- `lib/actions/add-contact.ts`
- `lib/actions/delete-contact.ts`
- `lib/actions/procurement.ts`
- `lib/actions/resolve-flag.ts`
- `lib/actions/submit-flag.ts`
- `lib/actions/update-field.ts`
- `lib/actions/upload-organization-image.ts`

## Notes
- Existing `getServerAuthState()` remains available for server components that need full profile + org graph + encryption key.
- `useAuth()` remains a UI/view state helper and is not server authority.
