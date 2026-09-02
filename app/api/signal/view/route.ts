/**
 * Record one signed-in page view.
 *
 * ⛔ INERT UNTIL WIRED. Nothing calls this yet — `components/signals/ViewBeacon.tsx`
 * is the client half and is deliberately not mounted in the root layout. Adding
 * that one line is the switch that turns site-wide behavioural capture on, and it
 * is a decision for a human, not a side effect of merging this branch.
 *
 * ── Why a route and not the proxy ───────────────────────────────────────────
 *
 * `proxy.ts` sees every request and already resolves the session, which makes it
 * the obvious place — and the wrong one. It runs before the response, so any
 * database write there is latency on every page load for a signal nobody is
 * waiting for. This runs after the page is already on the screen.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getServerAuthState } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { pathSignal } from "@/lib/signals/page-view";

export async function POST(request: NextRequest) {
  // ⛔ Always 204, whatever happens. This endpoint must never tell a caller
  // whether a path was recorded, rejected as admin, or failed — that is a probe
  // for what the site tracks. It is also fire-and-forget: the browser is not
  // waiting on the answer, so there is nothing useful to report anyway.
  const ok = () => new NextResponse(null, { status: 204 });

  try {
    const { user, organizations } = await getServerAuthState();
    // Anonymous traffic has no person to attach to and is not recorded at all.
    if (!user) return ok();

    const body = (await request.json().catch(() => null)) as
      | { path?: unknown; referrer?: unknown }
      | null;
    if (!body || typeof body.path !== "string") return ok();

    const signal = pathSignal(body.path);
    if (!signal) return ok();

    const referrer =
      typeof body.referrer === "string" ? (pathSignal(body.referrer)?.path ?? null) : null;

    const db = createAdminClient();

    // The acting person, not the login. ⚠️ `contacts.profile_id` is NOT unique —
    // one login can hold several contact rows, one per org. Which of them was
    // "acting" is genuinely ambiguous from a page view alone, so the row is
    // attributed to the contact in the org the session is currently scoped to,
    // and falls back to the earliest row rather than guessing at random.
    const activeOrgId = organizations[0]?.organization_id ?? null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: contacts } = await (db as any)
      .from("contacts")
      .select("id, organization_id")
      .eq("profile_id", user.id)
      .order("created_at", { ascending: true });

    const rows = (contacts ?? []) as { id: string; organization_id: string | null }[];
    if (rows.length === 0) return ok();
    const contact = rows.find((r) => r.organization_id === activeOrgId) ?? rows[0];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).from("page_views").insert({
      contact_id: contact.id,
      organization_id: contact.organization_id,
      path: signal.path,
      facet: signal.facet,
      referrer_path: referrer,
    });
  } catch {
    // A failed write loses one page view. It must never surface to the person
    // browsing, and it must never fail the request they actually made.
  }

  return ok();
}
