"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated } from "@/lib/auth/guards";
import type { RFP, RFPWithContext, RFPVisibility } from "@/lib/types/rfp";
import { isOrgAccessActive } from "@/lib/membership/status";
import type { OrgMembershipStatus } from "@/lib/membership/types";

// ─────────────────────────────────────────────────────────────────────────────
// Post a new RFP
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateRFPInput {
  organizationId: string;
  contactId: string | null;
  title: string;
  description: string | null;
  category: string;
  subcategories: string[];
  opensAt: string;   // ISO string
  closesAt: string;  // ISO string
  visibility: RFPVisibility;
  documentStoragePath?: string | null;
}

export async function createRFP(input: CreateRFPInput): Promise<{
  success: boolean;
  rfp?: RFP;
  error?: string;
}> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  // Verify the user can manage this org
  const db = createAdminClient();
  const isAdmin = auth.ctx.globalRole === 'admin' || auth.ctx.globalRole === 'super_admin';

  if (!isAdmin) {
    const { data: membership } = await db
      .from('user_organizations')
      .select('role, organization:organizations(membership_status)')
      .eq('user_id', auth.ctx.userId)
      .eq('organization_id', input.organizationId)
      .eq('status', 'active')
      .maybeSingle();

    const orgStatus = (membership?.organization as { membership_status: OrgMembershipStatus | null } | null)
      ?.membership_status ?? null;

    if (membership?.role !== 'org_admin' || !isOrgAccessActive(orgStatus)) {
      return { success: false, error: 'Not authorized to post RFPs for this organization' };
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any)
    .from('rfps')
    .insert({
      organization_id: input.organizationId,
      contact_id: input.contactId,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      category: input.category,
      subcategories: input.subcategories,
      opens_at: input.opensAt,
      closes_at: input.closesAt,
      visibility: input.visibility,
      status: 'active',
      document_storage_path: input.documentStoragePath ?? null,
      created_by: auth.ctx.userId,
    })
    .select('*')
    .single();

  if (error) {
    console.error('[rfps] createRFP failed:', error);
    return { success: false, error: 'Failed to post RFP' };
  }

  // Notifications are sent by the cron job when opens_at is reached,
  // not immediately on insert — allows scheduling future-dated RFPs.
  return { success: true, rfp: data as RFP };
}

// ─────────────────────────────────────────────────────────────────────────────
// List RFPs for a specific org (for the member's own profile view)
// ─────────────────────────────────────────────────────────────────────────────

export async function listRFPsForOrg(organizationId: string): Promise<{
  success: boolean;
  rfps?: RFPWithContext[];
  error?: string;
}> {
  const db = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any)
    .from('rfps')
    .select(`
      *,
      organization:organizations(id, name, slug, province),
      contact:contacts(id, name, work_email, email, role_title)
    `)
    .eq('organization_id', organizationId)
    .order('closes_at', { ascending: true });

  if (error) {
    console.error('[rfps] listRFPsForOrg failed:', error);
    return { success: false, error: 'Failed to load RFPs' };
  }

  return { success: true, rfps: (data ?? []) as RFPWithContext[] };
}

// ─────────────────────────────────────────────────────────────────────────────
// List active RFPs matching a partner's categories (for the partner profile feed)
// ─────────────────────────────────────────────────────────────────────────────

export async function listRFPsForPartner(
  categories: string[],
  viewerOrgType: 'Partner' | 'Vendor' | null
): Promise<{
  success: boolean;
  rfps?: RFPWithContext[];
  error?: string;
}> {
  if (!categories.length) return { success: true, rfps: [] };

  const db = createAdminClient();
  const now = new Date().toISOString();

  // Visibility: partners can see 'partners', 'network', and 'public'
  const visibilities = viewerOrgType
    ? ['public', 'network', 'partners']
    : ['public'];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any)
    .from('rfps')
    .select(`
      *,
      organization:organizations(id, name, slug, province),
      contact:contacts(id, name, work_email, email, role_title)
    `)
    .in('category', categories)
    .eq('status', 'active')
    .lte('opens_at', now)
    .gt('closes_at', now)
    .in('visibility', visibilities)
    .order('closes_at', { ascending: true });

  if (error) {
    console.error('[rfps] listRFPsForPartner failed:', error);
    return { success: false, error: 'Failed to load RFPs' };
  }

  return { success: true, rfps: (data ?? []) as RFPWithContext[] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Close an RFP
// ─────────────────────────────────────────────────────────────────────────────

export async function closeRFP(rfpId: string): Promise<{
  success: boolean;
  error?: string;
}> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();

  // Fetch the RFP to verify ownership
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rfp } = await (db as any)
    .from('rfps')
    .select('organization_id')
    .eq('id', rfpId)
    .maybeSingle();

  if (!rfp) return { success: false, error: 'RFP not found' };

  const isAdmin = auth.ctx.globalRole === 'admin' || auth.ctx.globalRole === 'super_admin';
  if (!isAdmin) {
    const { data: membership } = await db
      .from('user_organizations')
      .select('role')
      .eq('user_id', auth.ctx.userId)
      .eq('organization_id', rfp.organization_id)
      .eq('status', 'active')
      .maybeSingle();

    if (membership?.role !== 'org_admin') {
      return { success: false, error: 'Not authorized' };
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (db as any)
    .from('rfps')
    .update({ status: 'closed', updated_at: new Date().toISOString() })
    .eq('id', rfpId);

  if (error) {
    console.error('[rfps] closeRFP failed:', error);
    return { success: false, error: 'Failed to close RFP' };
  }

  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete an RFP
// ─────────────────────────────────────────────────────────────────────────────

export async function deleteRFP(rfpId: string): Promise<{
  success: boolean;
  error?: string;
}> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rfp } = await (db as any)
    .from('rfps')
    .select('organization_id')
    .eq('id', rfpId)
    .maybeSingle();

  if (!rfp) return { success: false, error: 'RFP not found' };

  const isAdmin = auth.ctx.globalRole === 'admin' || auth.ctx.globalRole === 'super_admin';
  if (!isAdmin) {
    const { data: membership } = await db
      .from('user_organizations')
      .select('role')
      .eq('user_id', auth.ctx.userId)
      .eq('organization_id', rfp.organization_id)
      .eq('status', 'active')
      .maybeSingle();

    if (membership?.role !== 'org_admin') {
      return { success: false, error: 'Not authorized' };
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (db as any)
    .from('rfps')
    .delete()
    .eq('id', rfpId);

  if (error) {
    console.error('[rfps] deleteRFP failed:', error);
    return { success: false, error: 'Failed to delete RFP' };
  }

  return { success: true };
}
