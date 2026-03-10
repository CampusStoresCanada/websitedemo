import { NextResponse } from "next/server";
import {
  canManageOrganization,
  isGlobalAdmin,
  requireAuthenticated,
} from "@/lib/auth/guards";

/**
 * GET /api/applications
 * List pending signup applications.
 * - Org admins see applications for their orgs only.
 * - Admins/super_admins see all applications.
 */
export async function GET(request: Request) {
  const auth = await requireAuthenticated();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase, globalRole, orgAdminOrgIds } = auth.ctx;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "pending";

  if (isGlobalAdmin(globalRole)) {
    // Admins see all applications
    const { data, error } = await supabase
      .from("signup_applications")
      .select(
        `
        *,
        organization:organizations(id, name, type, slug),
        applicant:profiles!signup_applications_user_id_fkey(display_name)
      `
      )
      .eq("status", status)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ applications: data });
  }

  if (orgAdminOrgIds.length === 0) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const orgIds = orgAdminOrgIds;

  const { data, error } = await supabase
    .from("signup_applications")
    .select(
      `
      *,
      organization:organizations(id, name, type, slug),
      applicant:profiles!signup_applications_user_id_fkey(display_name)
    `
    )
    .in("organization_id", orgIds)
    .eq("status", status)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ applications: data });
}

/**
 * PATCH /api/applications
 * Approve or reject an application.
 * Body: { applicationId, action: "approve" | "reject", notes?: string }
 */
export async function PATCH(request: Request) {
  const auth = await requireAuthenticated();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase, userId } = auth.ctx;

  const body = await request.json();
  const { applicationId, action, notes } = body;

  if (!applicationId || !["approve", "reject"].includes(action)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Fetch the application
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: application, error: fetchError } = await supabase
    .from("signup_applications")
    .select("*")
    .eq("id", applicationId)
    .single() as { data: any; error: any };

  if (fetchError || !application) {
    return NextResponse.json(
      { error: "Application not found" },
      { status: 404 }
    );
  }

  // Check permissions: must be org admin for this org, or global admin
  let authorized = isGlobalAdmin(auth.ctx.globalRole);

  if (!authorized && application.organization_id) {
    authorized = canManageOrganization(auth.ctx, application.organization_id);
  }

  if (!authorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Update application status
  const newStatus = action === "approve" ? "approved" : "rejected";
  const { error: updateError } = await supabase
    .from("signup_applications")
    .update({
      status: newStatus,
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      review_notes: notes || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", applicationId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // On approval, create the user_organizations link
  if (action === "approve" && application.organization_id && application.user_id) {
    const { error: linkError } = await supabase
      .from("user_organizations")
      .insert({
        user_id: application.user_id,
        organization_id: application.organization_id,
        role: "member",
        status: "active",
      });

    if (linkError) {
      console.error("Failed to create org membership:", linkError);
      // Application is still marked approved — admin can manually link
    }
  }

  return NextResponse.json({
    success: true,
    status: newStatus,
    applicationId,
  });
}
