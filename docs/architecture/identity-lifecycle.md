# Identity Lifecycle Contract

## Intent
Identity is unified across the platform. We do not treat conference/activity participants as a separate population.

Lifecycle:
1. Public visitor: no identity row required.
2. Known person: create/maintain a canonical `people` record when we know who they are.
3. Program participant/contact: write activity context to `contacts` (role/history signals).
4. Authenticated user: link `users.person_id` to the canonical person.

## Canonical Model
- `people`: canonical person entity (source-of-truth identity record).
- `contacts`: activity/context projection used by org workflows, directory, communications.
- `users`/`profiles`: account/auth layer; must map to person through `users.person_id`.

## Rules
1. New identity-bearing flows must create or resolve a `people` record first.
2. Business activity flows must upsert `contacts` from that person context.
3. Never place `people.id` into auth-only IDs (`profiles.id`, `conference_staff.user_id`, etc.).
4. If user auth exists, link to person (`users.person_id`) as soon as possible.
5. Unclaimed contacts are valid, but should remain linkable and claim-ready.

## Shared Helpers
Use `lib/identity/lifecycle.ts`:
- `ensureKnownPerson(...)`
- `ensurePersonForUser(...)`
- `linkUserToPerson(...)`
- `upsertPersonContact(...)`

## Current Coverage (2026-03-02)
- Conference registration + staff flows
- Application approval flow
- Organization user invite flow
- Add-contact flow
- Toolkit contact edit flow (`updateField` contact path)
- Toolkit contact delete flow (archive-only)

## Repo Audit Result (2026-03-02)
Remaining direct `contacts` writes are intentionally limited to:
- `lib/identity/lifecycle.ts`: canonical contact projection upsert logic.
- `lib/circle/operations.ts`: Circle metadata sync (`circle_id`, `synced_to_circle_at`).
- `lib/circle/sync.ts`: Circle metadata sync (`circle_id`, `synced_to_circle_at`).

All other app-facing contact creation/update paths should route through
`ensureKnownPerson(...)` + `upsertPersonContact(...)` or call a flow that does.

## Implementation Guidance
- Prefer helper usage over bespoke inserts/updates for `people`/`contacts`.
- Keep data normalization at write boundaries (trim/lowercase email, name split).
- Fail closed on identity mismatches instead of silently writing divergent IDs.
