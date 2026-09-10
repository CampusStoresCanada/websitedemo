# websitedemo

Next.js 16 (App Router, Turbopack) + Supabase + TypeScript.

## ⚠️ The dev server is shared — attach, don't spawn

**One `next dev` serves everybody.** Several sessions work in this directory at once, and
`next dev` refuses to start a second instance for the same directory — so whoever starts
one blocks or kills the others. That churn is the single biggest source of wasted time here.

**Default to attaching by URL. This starts nothing:**

```
preview_start { url: "http://localhost:3000" }
```

Verified 2026-08-21: it opens a browser tab against the running server and spawns no
process. ⚠️ A *named* attach entry in `.claude/launch.json` (a config with `url` and no
command) does **not** work in this build — it falls back to running the `dev` script and
dies with "Another next dev server is already running." Don't re-add one; use the `url`
form above.

Before assuming nothing is running:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

Only use `preview_start { name: "dev" }` when that returns nothing. **Never `kill` someone
else's dev server** — Turbopack hot-reloads, so your edits are already live on the running
one. If a page looks stale, reload it before concluding anything needs restarting.

Genuinely need your own server? Use a git worktree under `.claude/worktrees/` — a separate
directory gets its own instance, and `autoPort` picks a free port instead of fighting for
3000.

## Verifying UI changes

Attach, then check with the text tools (`read_page`, `read_console_messages`,
`javascript_tool`) before reaching for screenshots. ⚠️ The console buffer persists across
reloads — a fresh tab is the only way to be sure an error is current, not left over from a
previous compile.

## Gotchas that type-check clean and still break

- **`"use server"` files may only export async functions.** Exporting a `const` from one
  passes `tsc` and breaks the whole module at runtime — every page importing it 500s. Only
  loading a page catches it. `export type` is fine (erased at compile).
- **`vitest.config.ts` stubs `NEXT_PUBLIC_SUPABASE_URL`** to `example.supabase.co`. A test
  that deliberately hits the real database must *overwrite* env, not fill blanks —
  otherwise it silently reads an empty database instead of erroring.
- **Never `auth.getUser()` server-side** — it makes a network call that can hang and take
  the dev server with it. Use `auth.getClaims()` (local JWT validation).

## Gates before calling anything done

```bash
npx tsc --noEmit && npx vitest run && npm run build
```

`next build` is the only one of the three that catches `"use server"` export violations.
