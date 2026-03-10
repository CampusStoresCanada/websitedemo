"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  canManageOrganization,
  isGlobalAdmin,
  requireAdmin,
  requireAuthenticated,
} from "@/lib/auth/guards";
import { transitionMembershipState } from "@/lib/membership/state-machine";
import {
  createStripeCustomer,
  createMembershipInvoice,
  createPartnershipInvoice,
  finalizeAndSendInvoice,
} from "@/lib/stripe/billing";
import {
  sendEmail,
  verificationEmail,
  applicationReceivedEmail,
  adminNewApplicationEmail,
  applicationApprovedEmail,
  applicationRejectedEmail,
  accountInviteEmail,
} from "@/lib/email/send";
import {
  ensureKnownPerson,
  ensurePersonForUser,
  linkUserToPerson,
  upsertPersonContact,
} from "@/lib/identity/lifecycle";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface MemberApplicationData {
  organization_name: string;
  institution_type: string;
  website: string;
  province: string;
  city: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  contact_title: string;
  reason_to_join?: string;
  how_heard?: string;
}

export interface PartnerApplicationData {
  company_name: string;
  street_address: string;
  city: string;
  province: string;
  postal_code: string;
  primary_category: string;
  secondary_categories?: string[];
  website: string;
  phone: string;
  contact_name: string;
  contact_email: string;
  brand_info?: string;
  company_description?: string;
}

// ─────────────────────────────────────────────────────────────────
// Submit Application (public, no auth)
// ─────────────────────────────────────────────────────────────────

export async function submitApplication(
  type: "member" | "partner",
  formData: MemberApplicationData | PartnerApplicationData
): Promise<{ success: boolean; applicationId?: string; error?: string }> {
  const db = createAdminClient();

  const contactEmail =
    type === "member"
      ? (formData as MemberApplicationData).contact_email
      : (formData as PartnerApplicationData).contact_email;

  const contactName =
    type === "member"
      ? (formData as MemberApplicationData).contact_name
      : (formData as PartnerApplicationData).contact_name;

  // Normalize email
  const normalizedEmail = contactEmail.trim().toLowerCase();

  // Anti-abuse: check for recent duplicate submissions
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: recentApps } = await db
    .from("signup_applications")
    .select("id")
    .eq("applicant_email", normalizedEmail)
    .gte("created_at", fiveMinutesAgo);

  if (recentApps && recentApps.length > 0) {
    return {
      success: false,
      error: "An application was recently submitted with this email. Please check your inbox for a verification email.",
    };
  }

  // Generate verification token
  const token = crypto.randomUUID();

  // Create application record
  const { data: app, error: insertError } = await db
    .from("signup_applications")
    .insert({
      application_type: type,
      status: "pending_verification",
      applicant_email: normalizedEmail,
      applicant_name: contactName.trim(),
      application_data: JSON.parse(JSON.stringify(formData)),
      verification_token: token,
      verification_sent_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insertError || !app) {
    console.error("Failed to create application:", insertError);
    return { success: false, error: "Failed to submit application. Please try again." };
  }

  // Send verification email
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const verificationUrl = `${baseUrl}/apply/verify?token=${token}`;

  const emailContent = verificationEmail(contactName, verificationUrl);
  await sendEmail({
    to: normalizedEmail,
    subject: emailContent.subject,
    html: emailContent.html,
  });

  return { success: true, applicationId: app.id };
}

// ─────────────────────────────────────────────────────────────────
// Verify Application Email
// ─────────────────────────────────────────────────────────────────

export async function verifyApplicationEmail(
  token: string
): Promise<{ success: boolean; error?: string }> {
  const db = createAdminClient();

  // Find application by token
  const { data: app, error } = await db
    .from("signup_applications")
    .select("id, status, applicant_email, applicant_name, application_type, application_data")
    .eq("verification_token", token)
    .maybeSingle();

  if (error || !app) {
    return { success: false, error: "Invalid or expired verification link." };
  }

  if (app.status !== "pending_verification") {
    // Already verified or processed
    return { success: true };
  }

  // Mark as verified → pending_review
  await db
    .from("signup_applications")
    .update({
      status: "pending_review",
      verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", app.id);

  // Send "application received" to applicant
  const receivedContent = applicationReceivedEmail(
    app.applicant_name ?? "Applicant",
    app.application_type as "member" | "partner"
  );
  await sendEmail({
    to: app.applicant_email!,
    subject: receivedContent.subject,
    html: receivedContent.html,
  });

  // Notify admins
  const appData = app.application_data as Record<string, unknown> | null;
  const orgName =
    (appData?.organization_name as string) ||
    (appData?.company_name as string) ||
    "Unknown";

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const adminContent = adminNewApplicationEmail(
    app.applicant_name ?? "Applicant",
    orgName,
    app.application_type as "member" | "partner",
    `${baseUrl}/admin/ops`
  );

  // Send to admin notification email (configured or fallback)
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || "admin@campusstorescanada.ca";
  await sendEmail({
    to: adminEmail,
    subject: adminContent.subject,
    html: adminContent.html,
  });

  return { success: true };
}

// ─────────────────────────────────────────────────────────────────
// Approve Application (admin only)
// ─────────────────────────────────────────────────────────────────

export async function approveApplication(
  applicationId: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };
  const userId = auth.ctx.userId;

  const db = createAdminClient();

  // Load application
  const { data: app } = await db
    .from("signup_applications")
    .select("*")
    .eq("id", applicationId)
    .single();

  if (!app) return { success: false, error: "Application not found" };
  if (app.status !== "pending_review") {
    return { success: false, error: `Cannot approve application in ${app.status} status` };
  }

  const appData = app.application_data as Record<string, unknown>;
  const applicationType = app.application_type as "member" | "partner";

  // 1. Create the organization
  const orgName =
    (appData.organization_name as string) ||
    (appData.company_name as string);

  const slug = orgName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  // Ensure unique slug
  const { data: existingSlug } = await db
    .from("organizations")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  const finalSlug = existingSlug ? `${slug}-${Date.now()}` : slug;

  const orgType = applicationType === "member" ? "Member" : "Vendor Partner";

  const orgId = crypto.randomUUID();
  const { data: org, error: orgError } = await db
    .from("organizations")
    .insert({
      id: orgId,
      name: orgName,
      slug: finalSlug,
      type: orgType,
      membership_status: "applied",
      website: (appData.website as string) || null,
      city: (appData.city as string) || null,
      province: (appData.province as string) || null,
      email: app.applicant_email,
      phone: (appData.phone as string) || (appData.contact_phone as string) || null,
      street_address: (appData.street_address as string) || null,
      postal_code: (appData.postal_code as string) || null,
      primary_category: (appData.primary_category as string) || null,
      company_description: (appData.company_description as string) || null,
      tenant_id: "00000000-0000-0000-0000-000000000001", // default tenant
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (orgError || !org) {
    console.error("Failed to create organization:", orgError);
    return { success: false, error: `Failed to create organization: ${orgError?.message}` };
  }

  // Link application to org
  await db
    .from("signup_applications")
    .update({
      organization_id: org.id,
      status: "approved",
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", applicationId);

  // 2. Create contact record for primary contact
  const knownPerson = await ensureKnownPerson({
    organizationId: org.id,
    tenantId: "00000000-0000-0000-0000-000000000001",
    name: app.applicant_name ?? orgName,
    email: app.applicant_email ?? null,
    title: (appData.contact_title as string) || null,
    workPhone: (appData.contact_phone as string) || (appData.phone as string) || null,
  });
  if (knownPerson.personId) {
    await upsertPersonContact({
      organizationId: org.id,
      personId: knownPerson.personId,
      name: app.applicant_name ?? orgName,
      email: app.applicant_email ?? null,
      roleTitle: (appData.contact_title as string) || null,
      phone: (appData.contact_phone as string) || (appData.phone as string) || null,
      contactType: ["primary"],
    });
  }

  // 3. Transition state: applied → approved
  await transitionMembershipState(
    org.id,
    "approved",
    "admin",
    userId,
    "Application approved by admin"
  );

  // 4. Create Stripe customer
  await createStripeCustomer(
    org.id,
    orgName,
    app.applicant_email ?? ""
  );

  // 5. Generate invoice
  let stripeInvoiceUrl = "";
  try {
    const invoice =
      applicationType === "member"
        ? await createMembershipInvoice(org.id, {
            applyProrationFromDate: new Date(),
          })
        : await createPartnershipInvoice(org.id, {
            applyProrationFromDate: new Date(),
          });

    // Finalize and send via Stripe
    await finalizeAndSendInvoice(invoice.id);
    stripeInvoiceUrl = `https://invoice.stripe.com/i/${invoice.stripe_invoice_id}`;
  } catch (err) {
    console.error("Invoice creation failed:", err);
    // Non-fatal — admin can manually create invoice
  }

  // 6. Create user account and send invite
  try {
    const { data: authData, error: authError } = await db.auth.admin.createUser({
      email: app.applicant_email!,
      email_confirm: true,
      user_metadata: {
        display_name: app.applicant_name,
        organization_id: org.id,
      },
    });

    if (authError) {
      console.error("User creation failed:", authError);
    } else if (authData.user) {
      // Link user to org as org_admin
      await db.from("user_organizations").insert({
        user_id: authData.user.id,
        organization_id: org.id,
        role: "org_admin",
        status: "active",
      });

      const ensuredPerson = await ensurePersonForUser({
        userId: authData.user.id,
        organizationId: org.id,
        fallbackEmail: app.applicant_email ?? null,
      });
      if (!ensuredPerson.personId && knownPerson.personId) {
        await linkUserToPerson({
          userId: authData.user.id,
          personId: knownPerson.personId,
        });
      }

      // Generate password reset link as invite
      const { data: resetData } = await db.auth.admin.generateLink({
        type: "recovery",
        email: app.applicant_email!,
      });

      if (resetData?.properties?.action_link) {
        const inviteContent = accountInviteEmail(
          app.applicant_name ?? "there",
          resetData.properties.action_link
        );
        await sendEmail({
          to: app.applicant_email!,
          subject: inviteContent.subject,
          html: inviteContent.html,
        });
      }
    }
  } catch (err) {
    console.error("User invite failed:", err);
    // Non-fatal — admin can manually invite
  }

  // 7. Send approval email with payment link
  if (app.applicant_email) {
    const paymentUrl = stripeInvoiceUrl || `${process.env.NEXT_PUBLIC_SITE_URL || ""}/account/billing`;
    const approvedContent = applicationApprovedEmail(
      app.applicant_name ?? "there",
      applicationType,
      paymentUrl
    );
    await sendEmail({
      to: app.applicant_email,
      subject: approvedContent.subject,
      html: approvedContent.html,
    });
  }

  return { success: true };
}

// ─────────────────────────────────────────────────────────────────
// Reject Application (admin only)
// ─────────────────────────────────────────────────────────────────

export async function rejectApplication(
  applicationId: string,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };
  const userId = auth.ctx.userId;

  const db = createAdminClient();

  const { data: app } = await db
    .from("signup_applications")
    .select("id, status, applicant_email, applicant_name, application_type")
    .eq("id", applicationId)
    .single();

  if (!app) return { success: false, error: "Application not found" };
  if (app.status !== "pending_review") {
    return { success: false, error: `Cannot reject application in ${app.status} status` };
  }

  await db
    .from("signup_applications")
    .update({
      status: "rejected",
      rejection_reason: reason,
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", applicationId);

  // Send rejection email
  if (app.applicant_email) {
    const rejectedContent = applicationRejectedEmail(
      app.applicant_name ?? "Applicant",
      app.application_type as "member" | "partner",
      reason
    );
    await sendEmail({
      to: app.applicant_email,
      subject: rejectedContent.subject,
      html: rejectedContent.html,
    });
  }

  return { success: true };
}

// ─────────────────────────────────────────────────────────────────
// Onboarding
// ─────────────────────────────────────────────────────────────────

export async function saveOnboardingStep(
  orgId: string,
  step: number,
  data: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  const { userId } = auth.ctx;
  const isAdmin = isGlobalAdmin(auth.ctx.globalRole);
  const isOrgAdmin = canManageOrganization(auth.ctx, orgId);

  if (!isAdmin && !isOrgAdmin) {
    return { success: false, error: "Only org admins can edit onboarding data" };
  }

  const db = createAdminClient();

  // Save step-specific data to organization
  // Steps map to specific org fields
  switch (step) {
    case 1: // Public profile
      await db
        .from("organizations")
        .update({
          logo_url: (data.logo_url as string) || undefined,
          company_description: (data.company_description as string) || undefined,
          street_address: (data.street_address as string) || undefined,
          city: (data.city as string) || undefined,
          province: (data.province as string) || undefined,
          postal_code: (data.postal_code as string) || undefined,
          email: (data.email as string) || undefined,
          phone: (data.phone as string) || undefined,
          website: (data.website as string) || undefined,
          onboarding_step: Math.max(step, 1),
          updated_at: new Date().toISOString(),
        })
        .eq("id", orgId);
      break;

    case 2: // Private profile
      await db
        .from("organizations")
        .update({
          metadata: JSON.parse(JSON.stringify(data)),
          onboarding_step: Math.max(step, 2),
          updated_at: new Date().toISOString(),
        })
        .eq("id", orgId);
      break;

    case 3: // Admin account setup — profile data
      if (userId) {
        await db
          .from("profiles")
          .update({
            display_name: (data.display_name as string) || undefined,
            updated_at: new Date().toISOString(),
          })
          .eq("id", userId);
      }
      await db
        .from("organizations")
        .update({
          onboarding_step: Math.max(step, 3),
          updated_at: new Date().toISOString(),
        })
        .eq("id", orgId);
      break;

    case 4: // Members: purchasing profile
      await db
        .from("organizations")
        .update({
          procurement_info: JSON.parse(JSON.stringify(data)),
          onboarding_step: Math.max(step, 4),
          updated_at: new Date().toISOString(),
        })
        .eq("id", orgId);
      break;

    case 5: // Partners: sales profile
      await db
        .from("organizations")
        .update({
          metadata: JSON.parse(JSON.stringify(data)),
          onboarding_step: Math.max(step, 5),
          updated_at: new Date().toISOString(),
        })
        .eq("id", orgId);
      break;

    default:
      return { success: false, error: `Invalid onboarding step: ${step}` };
  }

  return { success: true };
}

export async function completeOnboarding(
  orgId: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  const { userId } = auth.ctx;

  const db = createAdminClient();

  // Check org status
  const { data: org } = await db
    .from("organizations")
    .select("id, membership_status, onboarding_completed_at")
    .eq("id", orgId)
    .single();

  if (!org) return { success: false, error: "Organization not found" };

  if (org.onboarding_completed_at) {
    return { success: true }; // Already completed
  }

  // Check that invoice is paid (Stripe or out-of-band)
  const { data: paidInvoice } = await db
    .from("invoices")
    .select("id")
    .eq("organization_id", orgId)
    .eq("status", "paid")
    .limit(1)
    .maybeSingle();

  if (!paidInvoice) {
    // Allow admin override
    const isAdmin = isGlobalAdmin(auth.ctx.globalRole);
    if (!isAdmin) {
      return { success: false, error: "Payment must be completed before finishing onboarding." };
    }
  }

  // Transition: approved → active
  if (org.membership_status === "approved") {
    await transitionMembershipState(
      orgId,
      "active",
      "user",
      userId,
      "Onboarding completed"
    );
  }

  // Mark onboarding complete
  await db
    .from("organizations")
    .update({
      onboarding_completed_at: new Date().toISOString(),
      onboarding_reset_required: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orgId);

  return { success: true };
}

export async function resetOnboardingForNewOrgAdmin(
  orgId: string,
  actorId: string,
  reason: "org_admin_changed" | "manual_admin_reset"
): Promise<{ success: boolean; error?: string }> {
  const db = createAdminClient();

  await db
    .from("organizations")
    .update({
      onboarding_reset_required: true,
      onboarding_reset_reason: reason,
      onboarding_step: 3, // Reset to admin account setup step
      updated_at: new Date().toISOString(),
    })
    .eq("id", orgId);

  return { success: true };
}
