# Page/Auth Blueprints

## Secure Server Page Blueprint
Use template: `/Users/Work/Documents/csc-website/websitedemo/templates/page.secure.tsx`

## Secure Server Action Blueprint
Use template: `/Users/Work/Documents/csc-website/websitedemo/templates/action.secure.ts`

## Build Checklist (required)
1. Guard chosen from `lib/auth/guards.ts`
2. No direct `getClaims()` usage
3. No inline `global_role` policy logic unless inside guards module
4. No inline org-admin policy logic unless inside guards module
5. Auth failures return/redirect consistently
