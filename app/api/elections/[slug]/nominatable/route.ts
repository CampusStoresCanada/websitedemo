import { NextRequest, NextResponse } from "next/server";
import { getServerAuthState } from "@/lib/auth/server";
import {
  getElection,
  listNominatableContacts,
  isOrganizationEligible,
  resolveActor,
} from "@/lib/elections/service";

/**
 * GET /api/elections/[slug]/nominatable?q=
 *
 * Who a member can put forward, for the search box on the nomination page.
 *
 * The search used to be a plain GET form, so every keystroke's worth of
 * results cost a full page render — and that render evaluates the eligibility
 * of all 211 organizations and upserts 80 verdict rows, once per store the
 * viewer administers. Searching for a colleague should not rewrite the
 * membership's eligibility table.
 *
 * ⚠️ This returns names, job titles and institutions of people at member
 * stores, so it is gated the same way the page is: you must be signed in AND
 * administer an eligible member institution. An administrator of a lapsed
 * store gets nothing, exactly as they would on the page. Global admins are
 * allowed through for the preview.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";

  const auth = await getServerAuthState();
  if (!auth.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const election = await getElection(slug);
  if (!election) return NextResponse.json({ error: "No such election." }, { status: 404 });

  const isGlobalAdmin = auth.globalRole === "admin" || auth.globalRole === "super_admin";

  if (!isGlobalAdmin) {
    const actor = await resolveActor(auth.user.id, auth.organizations);
    const verdicts = await Promise.all(
      actor.adminOrganizationIds.map((id) => isOrganizationEligible(election.id, id))
    );
    if (!verdicts.some((v) => v?.isEligible)) {
      return NextResponse.json({ error: "Not eligible to nominate." }, { status: 403 });
    }
  }

  // Two characters is the same floor the service applies; below it the answer
  // is "keep typing", not the whole directory.
  if (q.length < 2) return NextResponse.json({ results: [] });

  return NextResponse.json({ results: await listNominatableContacts(election.id, q) });
}
