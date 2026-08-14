"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  canManageOrganization,
  isGlobalAdmin,
  requireAdmin,
  requireAuthenticated,
  requireSuperAdmin,
} from "@/lib/auth/guards";
import { findUserByEmail } from "@/lib/supabase/user-lookup";
import { transitionMembershipState } from "@/lib/membership/state-machine";
import {
  activateMembershipRenewal,
  computeNewExpiresAt,
  nextCycleStartOnOrAfter,
  isWithinPreRenewalSkipWindow,
} from "@/lib/membership/renewal-activation";
import { getRenewalConfig } from "@/lib/policy/engine";
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
import { enqueueCircleSync } from "@/lib/circle/sync";

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

export interface DuplicateOrgMatch {
  id: string;
  name: string;
  email: string | null;
  website: string | null;
  membershipStatus: string | null;
  type: string | null;
  matchReasons: string[];
  hasOutstandingInvoice: boolean;
  hasPaidInvoice: boolean;
}

// ─────────────────────────────────────────────────────────────────
// Duplicate organization / duplicate charge detection
// ─────────────────────────────────────────────────────────────────

function extractDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  const atIdx = trimmed.indexOf("@");
  if (atIdx !== -1) return trimmed.slice(atIdx + 1) || null;
  const withoutProtocol = trimmed.replace(/^https?:\/\//, "").replace(/^www\./, "");
  const domain = withoutProtocol.split(/[/?#]/)[0];
  return domain || null;
}

/**
 * Looks for existing organizations that plausibly match a would-be-approved
 * application, by exact name, exact contact email, shared email domain, or
 * shared website domain. Also flags whether any match already has an
 * outstanding or paid invoice, so approval can't silently create a second
 * org or a second charge for the same real-world organization.
 */
async function findDuplicateOrganizations(
  db: ReturnType<typeof createAdminClient>,
  params: { name: string; email: string | null; website: string | null }
): Promise<DuplicateOrgMatch[]> {
  const SELECT = "id, name, email, website, membership_status, type";
  const emailDomain = extractDomain(params.email);
  const websiteDomain = extractDomain(params.website);

  async function lookupByColumn(column: "name" | "email" | "website", pattern: string, reason: string) {
    const { data } = await db
      .from("organizations")
      .select(SELECT)
      .eq("is_test", false)
      .ilike(column, pattern);
    return { data: data as Record<string, unknown>[] | null, reason };
  }

  const lookups: Promise<{ data: Record<string, unknown>[] | null; reason: string }>[] = [
    lookupByColumn("name", params.name.trim(), "organization name"),
  ];

  if (params.email) {
    lookups.push(lookupByColumn("email", params.email.trim(), "contact email"));
  }
  if (emailDomain) {
    lookups.push(lookupByColumn("email", `%@${emailDomain}`, `email domain (${emailDomain})`));
  }
  if (websiteDomain) {
    lookups.push(lookupByColumn("website", `%${websiteDomain}%`, `website (${websiteDomain})`));
  }

  const results = await Promise.all(lookups);

  const byId = new Map<string, DuplicateOrgMatch>();
  for (const { data, reason } of results) {
    for (const org of data ?? []) {
      const id = org.id as string;
      const existing = byId.get(id);
      if (existing) {
        if (!existing.matchReasons.includes(reason)) existing.matchReasons.push(reason);
      } else {
        byId.set(id, {
          id,
          name: org.name as string,
          email: (org.email as string) ?? null,
          website: (org.website as string) ?? null,
          membershipStatus: (org.membership_status as string) ?? null,
          type: (org.type as string) ?? null,
          matchReasons: [reason],
          hasOutstandingInvoice: false,
          hasPaidInvoice: false,
        });
      }
    }
  }

  if (byId.size === 0) return [];

  const ids = Array.from(byId.keys());
  const { data: invoices } = await db
    .from("invoices")
    .select("organization_id, status")
    .in("organization_id", ids);

  const outstandingStatuses = new Set(["pending", "sent", "overdue", "pending_settlement"]);
  for (const inv of invoices ?? []) {
    const match = byId.get(inv.organization_id);
    if (!match) continue;
    if (outstandingStatuses.has(inv.status)) match.hasOutstandingInvoice = true;
    if (inv.status === "paid") match.hasPaidInvoice = true;
  }

  return Array.from(byId.values());
}

// ─────────────────────────────────────────────────────────────────
// Submit Application (public, no auth)
// ─────────────────────────────────────────────────────────────────

export async function submitApplication(
  type: "member" | "partner",
  formData: MemberApplicationData | PartnerApplicationData,
  /** Set when this application follows a pay-first booth purchase (see lib/actions/prospective-booth-checkout.ts). */
  paymentId?: string
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

  // If this follows a pay-first booth purchase, carry the payment fields
  // onto the application so admin review sees "already paid $X for booth Y"
  // — accepting 'pending' as well as 'paid' since the webhook can lag a few
  // seconds behind the Stripe redirect the applicant just followed.
  let paymentFields: Record<string, unknown> = {};
  let payment: { id: string; amount_cents: number; stripe_checkout_session_id: string; booth_entity_id: string; conference_id: string } | null = null;
  if (paymentId) {
    const { data: paymentRow } = await db
      .from("prospective_booth_payments")
      .select("id, amount_cents, stripe_checkout_session_id, booth_entity_id, conference_id, status")
      .eq("id", paymentId)
      .in("status", ["pending", "paid"])
      .maybeSingle();
    if (paymentRow) {
      payment = paymentRow;
      paymentFields = {
        paid_at: new Date().toISOString(),
        stripe_checkout_session_id: paymentRow.stripe_checkout_session_id,
        paid_amount_cents: paymentRow.amount_cents,
        paid_for: "booth",
        paid_booth_entity_id: paymentRow.booth_entity_id,
        paid_conference_id: paymentRow.conference_id,
      };
    }
  }

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
      ...paymentFields,
    })
    .select("id")
    .single();

  if (insertError || !app) {
    console.error("Failed to create application:", insertError);
    return { success: false, error: "Failed to submit application. Please try again." };
  }

  if (payment) {
    await db
      .from("prospective_booth_payments")
      .update({ status: "linked", linked_application_id: app.id })
      .eq("id", payment.id);
  }

  // Send verification email
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://websitedemo-khaki.vercel.app";
  const verificationUrl = `${baseUrl}/apply/verify?token=${token}`;

  const emailContent = await verificationEmail(contactName, verificationUrl);
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
  const receivedContent = await applicationReceivedEmail(
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

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://websitedemo-khaki.vercel.app";
  const adminContent = await adminNewApplicationEmail(
    app.applicant_name ?? "Applicant",
    orgName,
    app.application_type as "member" | "partner",
    `${baseUrl}/admin/applications`
  );

  // Send to admin notification email (configured or fallback)
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || "admin@campusstores.ca";
  await sendEmail({
    to: adminEmail,
    subject: adminContent.subject,
    html: adminContent.html,
  });

  return { success: true };
}

// ─────────────────────────────────────────────────────────────────
// Fast-track Verification (admin only)
// ─────────────────────────────────────────────────────────────────
//
// Skips waiting for the applicant to click the emailed confirmation
// link — for cases like a phone call-in, a bounced/delayed email, or
// staff having otherwise confirmed the applicant out of band. Moves
// the application straight to pending_review, same destination state
// as verifyApplicationEmail, so it becomes eligible for Approve/Reject.

export async function fastTrackApplicationVerification(
  applicationId: string
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
  if (app.status !== "pending_verification") {
    return { success: false, error: `Cannot fast-track application in ${app.status} status` };
  }

  await db
    .from("signup_applications")
    .update({
      status: "pending_review",
      verified_at: new Date().toISOString(),
      review_notes: `Verification fast-tracked by admin ${userId} — applicant did not click the emailed verification link.`,
      updated_at: new Date().toISOString(),
    })
    .eq("id", applicationId);

  // Let the applicant know their application is moving forward, same
  // email they'd have gotten had they clicked the verification link.
  if (app.applicant_email) {
    const receivedContent = await applicationReceivedEmail(
      app.applicant_name ?? "Applicant",
      app.application_type as "member" | "partner"
    );
    await sendEmail({
      to: app.applicant_email,
      subject: receivedContent.subject,
      html: receivedContent.html,
    });
  }

  return { success: true };
}

// ─────────────────────────────────────────────────────────────────
// Approve Application (admin only)
// ─────────────────────────────────────────────────────────────────

export async function approveApplication(
  applicationId: string,
  options?: { confirmDuplicates?: boolean }
): Promise<{ success: boolean; error?: string; duplicates?: DuplicateOrgMatch[] }> {
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

  const orgName =
    (appData.organization_name as string) ||
    (appData.company_name as string);

  // Duplicate-org / duplicate-charge preflight — runs before any org,
  // Stripe customer, or invoice is created. If matches are found and the
  // admin hasn't explicitly confirmed past the warning, stop here.
  const duplicates = await findDuplicateOrganizations(db, {
    name: orgName,
    email: app.applicant_email,
    website: (appData.website as string) || null,
  });
  if (duplicates.length > 0 && !options?.confirmDuplicates) {
    return {
      success: false,
      error: `Found ${duplicates.length} possible duplicate organization${duplicates.length > 1 ? "s" : ""}. Review before approving.`,
      duplicates,
    };
  }

  // 1. Create the organization
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
      tenant_id: "29300837-1d49-45b4-bd09-1c4525c409d1", // the org default tenant
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
    tenantId: "29300837-1d49-45b4-bd09-1c4525c409d1",
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

  // 5. Generate invoice — skipped entirely for a pay-first booth application:
  // dues were already collected up front (see lib/actions/prospective-booth-checkout.ts),
  // invoicing again here would double-charge them. Instead, mint the booth
  // they already paid for (their org didn't exist yet at payment time) and
  // advance membership_expires_at through the same shared helper the normal
  // invoice-paid webhook uses.
  let stripeInvoiceUrl = "";
  if (app.paid_at && app.paid_booth_entity_id && app.paid_conference_id) {
    try {
      const [{ data: booth }, { data: conference }] = await Promise.all([
        db.from("conference_entities").select("price_cents").eq("id", app.paid_booth_entity_id).maybeSingle(),
        db.from("conference_instances").select("end_date").eq("id", app.paid_conference_id).maybeSingle(),
      ]);
      await db.rpc("mint_prospective_booth_purchase", {
        p_conference_id: app.paid_conference_id,
        p_organization_id: org.id,
        p_booth_entity_id: app.paid_booth_entity_id,
        p_price_cents: booth?.price_cents ?? 0,
        p_buyer: `application:${applicationId}`,
      });

      const { billingPeriodStart, billingPeriodEnd } = await computeNewExpiresAt(
        null,
        conference?.end_date ?? null
      );
      const activation = await activateMembershipRenewal({
        organizationId: org.id,
        newExpiresAt: billingPeriodEnd,
        billingPeriodStart,
        triggeredBy: "conference_checkout",
        idempotencyKey: `prospective_booth_application:${applicationId}`,
        invoiceId: null,
        metadata: { application_id: applicationId, paid_amount_cents: app.paid_amount_cents },
      });
      if (!activation.success) {
        console.error(`approveApplication: membership activation failed for prospect org ${org.id}: ${activation.error}`);
      }
    } catch (err) {
      console.error("Booth minting / membership activation failed for pay-first application:", err);
      // Non-fatal — admin can reconcile manually; the org and payment record still exist.
    }
  } else {
    try {
      // A brand-new org joining within the pre-renewal skip-stub window
      // isn't worth billing a small prorated stub for the dying cycle's
      // last few days — sign them up starting with the upcoming full cycle
      // at full price instead (mirrors the same case in
      // priceMembershipRenewalForOrg / priceProspectiveMembershipCents).
      const { cycle_start_month_day: cycleStartMonthDay, pre_renewal_skip_stub_days: skipStubDays } =
        await getRenewalConfig();
      const now = new Date();
      const withinSkipWindow = isWithinPreRenewalSkipWindow(now, cycleStartMonthDay, skipStubDays);

      const { billingPeriodStart, billingPeriodEnd } = withinSkipWindow
        ? await computeNewExpiresAt(nextCycleStartOnOrAfter(now, cycleStartMonthDay))
        : await computeNewExpiresAt(null);

      const invoiceOptions = withinSkipWindow
        ? { billingPeriodStart, billingPeriodEnd }
        : { billingPeriodStart, billingPeriodEnd, applyProrationFromDate: now };

      const invoice =
        applicationType === "member"
          ? await createMembershipInvoice(org.id, invoiceOptions)
          : await createPartnershipInvoice(org.id, invoiceOptions);

      // Finalize and send via Stripe
      await finalizeAndSendInvoice(invoice.id);
      stripeInvoiceUrl = `https://invoice.stripe.com/i/${invoice.stripe_invoice_id}`;
    } catch (err) {
      console.error("Invoice creation failed:", err);
      // Non-fatal — admin can manually create invoice
    }
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
        const inviteContent = await accountInviteEmail(
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
    const paymentUrl = stripeInvoiceUrl || `${process.env.NEXT_PUBLIC_APP_URL || "https://websitedemo-khaki.vercel.app"}/account/billing`;
    const approvedContent = await applicationApprovedEmail(
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
// Merge Application Into Existing Organization (super admin only)
// ─────────────────────────────────────────────────────────────────
//
// Alternative to approveApplication for the case where the applicant is
// a duplicate of an org that already exists (same real org re-applying,
// a new contact at an existing member, etc). Instead of creating a new
// organization, links the application to the matched org, refreshes its
// profile with the freshly-submitted details, and grants the applicant
// login access — but never generates a new invoice, since the matched
// org is presumably already billed. A pre-paid booth purchase attached
// to the application is still fulfilled, since that's honoring money
// already collected, not issuing a new charge.

export async function mergeApplicationIntoOrganization(
  applicationId: string,
  targetOrgId: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { success: false, error: auth.error };
  const userId = auth.ctx.userId;

  const db = createAdminClient();

  const { data: app } = await db
    .from("signup_applications")
    .select("*")
    .eq("id", applicationId)
    .single();

  if (!app) return { success: false, error: "Application not found" };
  if (app.status !== "pending_review") {
    return { success: false, error: `Cannot merge application in ${app.status} status` };
  }

  const appData = app.application_data as Record<string, unknown>;
  const orgName =
    (appData.organization_name as string) ||
    (appData.company_name as string);

  // Re-verify the target is actually a flagged duplicate for this
  // application server-side — never trust a client-supplied org id blindly.
  const duplicates = await findDuplicateOrganizations(db, {
    name: orgName,
    email: app.applicant_email,
    website: (appData.website as string) || null,
  });
  const target = duplicates.find((d) => d.id === targetOrgId);
  if (!target) {
    return {
      success: false,
      error: "That organization is no longer a recognized duplicate match for this application. Refresh and try again.",
    };
  }

  // 1. Refresh the existing org's profile with the application's
  // submitted details. Only fields the application actually provided are
  // touched — billing/system fields (Stripe id, membership status, slug,
  // tenant, etc) are never written by a merge.
  const profileUpdate: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const setIfPresent = (key: string, value: unknown) => {
    if (typeof value === "string" && value.trim()) profileUpdate[key] = value;
  };
  setIfPresent("name", orgName);
  setIfPresent("website", appData.website as string);
  setIfPresent("city", appData.city as string);
  setIfPresent("province", appData.province as string);
  setIfPresent("phone", (appData.phone as string) || (appData.contact_phone as string));
  setIfPresent("street_address", appData.street_address as string);
  setIfPresent("postal_code", appData.postal_code as string);
  setIfPresent("primary_category", appData.primary_category as string);
  setIfPresent("company_description", appData.company_description as string);
  setIfPresent("email", app.applicant_email as string);

  const { error: updateOrgError } = await db
    .from("organizations")
    .update(profileUpdate)
    .eq("id", targetOrgId);

  if (updateOrgError) {
    console.error("Failed to update organization during merge:", updateOrgError);
    return { success: false, error: `Failed to update organization: ${updateOrgError.message}` };
  }

  // 2. Link the application to the existing org instead of a new one.
  await db
    .from("signup_applications")
    .update({
      organization_id: targetOrgId,
      status: "approved",
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      review_notes: `Merged into existing organization "${target.name}" (${targetOrgId}) by admin ${userId} — duplicate match on: ${target.matchReasons.join(", ")}. No new invoice generated.`,
      updated_at: new Date().toISOString(),
    })
    .eq("id", applicationId);

  // 3. Record/refresh the applicant as a known contact on the org.
  const knownPerson = await ensureKnownPerson({
    organizationId: targetOrgId,
    tenantId: "29300837-1d49-45b4-bd09-1c4525c409d1",
    name: app.applicant_name ?? orgName,
    email: app.applicant_email ?? null,
    title: (appData.contact_title as string) || null,
    workPhone: (appData.contact_phone as string) || (appData.phone as string) || null,
  });
  if (knownPerson.personId) {
    await upsertPersonContact({
      organizationId: targetOrgId,
      personId: knownPerson.personId,
      name: app.applicant_name ?? orgName,
      email: app.applicant_email ?? null,
      roleTitle: (appData.contact_title as string) || null,
      phone: (appData.contact_phone as string) || (appData.phone as string) || null,
      contactType: ["primary"],
    });
  }

  // 4. Ensure a Stripe customer exists — createStripeCustomer reuses the
  // org's existing stripe_customer_id when it already has one, so this is
  // a no-op in the common merge case.
  await createStripeCustomer(
    targetOrgId,
    (profileUpdate.name as string) || target.name,
    app.applicant_email ?? ""
  );

  // 5. Honor a pre-paid booth purchase carried on the application, if any.
  // This fulfills money already collected — not a new charge — so unlike
  // step 6 below, it still runs on a merge.
  if (app.paid_at && app.paid_booth_entity_id && app.paid_conference_id) {
    try {
      const [{ data: booth }, { data: conference }] = await Promise.all([
        db.from("conference_entities").select("price_cents").eq("id", app.paid_booth_entity_id).maybeSingle(),
        db.from("conference_instances").select("end_date").eq("id", app.paid_conference_id).maybeSingle(),
      ]);
      await db.rpc("mint_prospective_booth_purchase", {
        p_conference_id: app.paid_conference_id,
        p_organization_id: targetOrgId,
        p_booth_entity_id: app.paid_booth_entity_id,
        p_price_cents: booth?.price_cents ?? 0,
        p_buyer: `application:${applicationId}`,
      });

      const { billingPeriodStart, billingPeriodEnd } = await computeNewExpiresAt(
        null,
        conference?.end_date ?? null
      );
      const activation = await activateMembershipRenewal({
        organizationId: targetOrgId,
        newExpiresAt: billingPeriodEnd,
        billingPeriodStart,
        triggeredBy: "conference_checkout",
        idempotencyKey: `prospective_booth_application:${applicationId}`,
        invoiceId: null,
        metadata: {
          application_id: applicationId,
          paid_amount_cents: app.paid_amount_cents,
          merged_into_organization_id: targetOrgId,
        },
      });
      if (!activation.success) {
        console.error(`mergeApplicationIntoOrganization: membership activation failed for org ${targetOrgId}: ${activation.error}`);
      }
    } catch (err) {
      console.error("Booth minting / membership activation failed for pre-paid merge application:", err);
      // Non-fatal — admin can reconcile manually; the org and payment record still exist.
    }
  }
  // No invoice is created for the non-pre-paid case — merging never
  // triggers a fresh charge against an org that's presumably already billed.

  // 6. Grant login access. Reuse an existing auth account for this email
  // if one already exists (common — the merged org's real admin likely
  // already has a login); otherwise create one, same as a normal approval.
  try {
    const existingUser = app.applicant_email ? await findUserByEmail(db, app.applicant_email) : null;
    let grantedUserId: string | null = existingUser?.id ?? null;

    if (!grantedUserId && app.applicant_email) {
      const { data: authData, error: authError } = await db.auth.admin.createUser({
        email: app.applicant_email,
        email_confirm: true,
        user_metadata: {
          display_name: app.applicant_name,
          organization_id: targetOrgId,
        },
      });
      if (authError) {
        console.error("User creation failed during merge:", authError);
      } else {
        grantedUserId = authData.user?.id ?? null;
      }
    }

    if (grantedUserId) {
      const { data: existingLink } = await db
        .from("user_organizations")
        .select("user_id")
        .eq("user_id", grantedUserId)
        .eq("organization_id", targetOrgId)
        .maybeSingle();

      if (!existingLink) {
        await db.from("user_organizations").insert({
          user_id: grantedUserId,
          organization_id: targetOrgId,
          role: "org_admin",
          status: "active",
        });
      }

      const ensuredPerson = await ensurePersonForUser({
        userId: grantedUserId,
        organizationId: targetOrgId,
        fallbackEmail: app.applicant_email ?? null,
      });
      if (!ensuredPerson.personId && knownPerson.personId) {
        await linkUserToPerson({ userId: grantedUserId, personId: knownPerson.personId });
      }

      // Only send an invite (set-password) link for a brand-new account —
      // an email that already had a login shouldn't get a surprise reset link.
      if (!existingUser) {
        const { data: resetData } = await db.auth.admin.generateLink({
          type: "recovery",
          email: app.applicant_email!,
        });
        if (resetData?.properties?.action_link) {
          const inviteContent = await accountInviteEmail(
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
    }
  } catch (err) {
    console.error("Grant access failed during merge:", err);
    // Non-fatal — admin can manually invite via People.
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
    const rejectedContent = await applicationRejectedEmail(
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

  // Enqueue Circle account link + tag sync (non-blocking — must not fail onboarding)
  // Reads circle_cutover_enabled flag internally; no-ops if Circle is not configured.
  void (async () => {
    try {
      // Look up the primary contact for this org (match by org_id since contacts
      // don't have user_id — find the primary contact of the org)
      const { data: contact } = await db
        .from("contacts")
        .select("id, email, name, organization_id")
        .eq("organization_id", orgId)
        .contains("contact_type", ["primary"])
        .limit(1)
        .maybeSingle();

      if (!contact?.email) return;

      // Fetch org's Circle tag ID
      const { data: orgRow } = await db
        .from("organizations")
        .select("circle_tag_id")
        .eq("id", orgId)
        .single();

      await enqueueCircleSync({
        operation: "link_member",
        entityType: "contact",
        entityId: contact.id,
        payload: { email: contact.email, name: contact.name ?? contact.email },
        orgId,
        idempotencyKey: `onboarding-link-${contact.id}`,
      });

      if (orgRow?.circle_tag_id) {
        await enqueueCircleSync({
          operation: "add_tag",
          entityType: "contact",
          entityId: contact.id,
          payload: { tagId: Number(orgRow.circle_tag_id), email: contact.email },
          orgId,
          idempotencyKey: `onboarding-tag-${contact.id}-${orgRow.circle_tag_id}`,
        });
      }
    } catch (err) {
      console.error("[completeOnboarding] Circle enqueue failed (non-fatal):", err instanceof Error ? err.message : err);
    }
  })();

  return { success: true };
}

// ─────────────────────────────────────────────────────────────────
// Resend Invite / Payment Link (admin only)
// ─────────────────────────────────────────────────────────────────

export async function resendApplicationInvite(
  applicationId: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();

  const { data: app } = await db
    .from("signup_applications")
    .select("id, applicant_name, applicant_email, application_type, organization_id, status")
    .eq("id", applicationId)
    .single();

  if (!app) return { success: false, error: "Application not found" };
  if (app.status !== "approved") {
    return { success: false, error: "Can only resend for approved applications" };
  }
  if (!app.applicant_email) {
    return { success: false, error: "No email on file for this applicant" };
  }

  let sentInvite = false;
  let sentPayment = false;

  // Resend account invite (password reset link)
  try {
    const { data: resetData } = await db.auth.admin.generateLink({
      type: "recovery",
      email: app.applicant_email,
    });
    if (resetData?.properties?.action_link) {
      const inviteContent = await accountInviteEmail(
        app.applicant_name ?? "there",
        resetData.properties.action_link
      );
      await sendEmail({
        to: app.applicant_email,
        subject: inviteContent.subject,
        html: inviteContent.html,
      });
      sentInvite = true;
    }
  } catch (err) {
    console.error("Resend invite failed:", err);
  }

  // Resend payment link
  if (app.organization_id) {
    try {
      const { data: invoice } = await db
        .from("invoices")
        .select("id, stripe_invoice_id, status")
        .eq("organization_id", app.organization_id)
        .in("status", ["pending", "sent", "overdue", "pending_settlement"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const paymentUrl = invoice?.stripe_invoice_id
        ? `https://invoice.stripe.com/i/${invoice.stripe_invoice_id}`
        : `${process.env.NEXT_PUBLIC_APP_URL || "https://websitedemo-khaki.vercel.app"}/account/billing`;

      const approvedContent = await applicationApprovedEmail(
        app.applicant_name ?? "there",
        app.application_type as "member" | "partner",
        paymentUrl
      );
      await sendEmail({
        to: app.applicant_email,
        subject: `[Reminder] ${approvedContent.subject}`,
        html: approvedContent.html,
      });
      sentPayment = true;
    } catch (err) {
      console.error("Resend payment link failed:", err);
    }
  }

  if (!sentInvite && !sentPayment) {
    return { success: false, error: "Failed to send both invite and payment link" };
  }

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
