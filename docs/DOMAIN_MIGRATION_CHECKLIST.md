# Domain Migration Checklist — `websitedemo-khaki.vercel.app` → `campusstores.ca`

Compiled 2026-08-07 while fixing an email-layout bug that depends on this exact config. No such checklist existed before this — nothing here has been executed, this is purely "check these" for whoever runs the cutover.

## 1. Vercel

- [ ] Add `campusstores.ca` (and `www.campusstores.ca` if used) as a custom domain on the `websitedemo` project; verify DNS.
- [ ] Update the **`NEXT_PUBLIC_APP_URL`** production environment variable to `https://campusstores.ca`, then redeploy (env var changes need a new build to take effect in server code).

This one variable is read at runtime by **23 files** across the app — it's the single most consequential thing to get right. It drives absolute-URL links in:
board action notifications (`lib/board/action-notify.ts`, `action-ics.ts`), RFP notifications (`lib/rfps/notify.ts`), event registration/tickets/actions (`lib/actions/event-registration.ts`, `event-tickets.ts`, `events.ts`, `app/api/events/action/route.ts`, `app/events/[slug]/page.tsx`, `lib/email/eventActionTokens.ts`), admin transfer emails (`lib/actions/admin-transfer.ts`), Circle share/flag/explain DMs (`lib/circle/share-notify.ts`, `flag-notify.ts`, `explain-dm.ts`), partner market Ghost Butler DMs (`lib/actions/partner-market.ts`), renewal jobs (`lib/renewal/jobs.ts`), onboarding nudges (`lib/onboarding/nudge-job.ts`), snapshots (`lib/actions/snapshots.ts`), conference checklist engine + comms triggers (`lib/conference/checklist-engine.ts`, `lib/comms/conference-triggers.ts`), the comms send/preview system (`lib/comms/send.ts`, `app/api/admin/comms/preview/route.ts`), Stripe webhook calendar invites (`lib/stripe/webhook-processing.ts`), the email layout header/footer (`lib/email/layout.ts`), and the client-side `Toolkit.tsx`.

## 2. Hardcoded fallback domains in code

These two files fall back to a **hardcoded** `https://websitedemo-khaki.vercel.app` if the env var above is ever empty — deliberate, so a missing env var degrades gracefully instead of breaking outright. They do **not** need editing for the migration to work (the env var always wins when set) — just noting they exist, since they're easy to forget about and will keep pointing at the old domain forever unless someone eventually updates the literal string:

- `lib/email/layout.ts` — header logo / footer mark image URLs (added 2026-08-07)
- `lib/actions/partner-market.ts` — Ghost Butler DM + email fallback links (pre-existing)

## 3. Supabase Auth (not in this codebase — dashboard config)

- [ ] **Site URL** (Authentication → URL Configuration) — currently `https://websitedemo-khaki.vercel.app` (set there 2026-06-22 to fix password-reset links pointing at localhost). Update to `https://campusstores.ca`.
- [ ] Add `campusstores.ca` to the **Redirect URLs** allowlist. Leaving `websitedemo-khaki.vercel.app` and `localhost:3000` in there too is fine and keeps local dev + old links working.

## 4. External services with a saved callback/webhook URL

- [ ] **Stripe webhook endpoint** — confirm whether it's currently registered against the `websitedemo-khaki.vercel.app` domain; if so, register a new endpoint on the new domain (don't just edit the old one if you might need to roll back).
- [ ] Any OAuth callback URLs for Circle / QuickBooks / Notion / Mapbox or other integrations — check each for a hardcoded domain.

## 5. Known gap found in passing, not blocking

`lib/stripe/webhook-processing.ts` reads `NEXT_PUBLIC_APP_URL ?? ""` in two places (Google Calendar invite + confirmation email links) with **no fallback at all** — unlike the two files in section 2, a misconfigured env var here would leave these specific links silently broken (empty href) rather than degrading to the old domain. Same bug class as the header-logo issue fixed today; just hasn't been given the same treatment yet. Worth a follow-up, not urgent for the cutover itself.
