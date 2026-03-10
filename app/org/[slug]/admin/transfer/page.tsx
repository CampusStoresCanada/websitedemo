import { resolveOrgSlug } from "@/lib/org/resolve";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated } from "@/lib/auth/guards";
import { AdminTransferFlow } from "@/components/org/admin/AdminTransferFlow";

interface OrgTransferPageProps {
  params: Promise<{ slug: string }>;
}

export interface TransferCandidate {
  userId: string;
  displayName: string | null;
  email: string | null;
}

export default async function OrgTransferPage({
  params,
}: OrgTransferPageProps) {
  const { slug } = await params;
  const org = await resolveOrgSlug(slug);
  if (!org) notFound();

  const auth = await requireAuthenticated();
  if (!auth.ok) notFound();

  const adminClient = createAdminClient();

  // Fetch any pending transfer
  const { data: pendingTransfer } = await adminClient
    .from("admin_transfer_requests")
    .select(
      "id, from_user_id, to_user_id, status, requested_at, timeout_at, reason"
    )
    .eq("organization_id", org.id)
    .eq("status", "pending")
    .maybeSingle();

  // Fetch eligible successors: active org members (excluding current user)
  const { data: members } = await adminClient
    .from("user_organizations")
    .select(
      `
      user_id,
      role,
      profiles!inner(
        id,
        display_name
      )
    `
    )
    .eq("organization_id", org.id)
    .eq("status", "active")
    .neq("user_id", auth.ctx.userId);

  // Get emails for candidates
  const candidateUserIds = (members ?? []).map((m) => m.user_id);
  let emailMap: Record<string, string> = {};

  if (candidateUserIds.length > 0) {
    const { data: authUsers } = await adminClient.auth.admin.listUsers();
    if (authUsers?.users) {
      emailMap = Object.fromEntries(
        authUsers.users
          .filter((u) => candidateUserIds.includes(u.id))
          .map((u) => [u.id, u.email ?? ""])
      );
    }
  }

  const candidates: TransferCandidate[] = (members ?? []).map((m) => {
    const profile = m.profiles as unknown as {
      id: string;
      display_name: string | null;
    };

    return {
      userId: m.user_id,
      displayName: profile?.display_name ?? null,
      email: emailMap[m.user_id] ?? null,
    };
  });

  // Get display names for transfer participants
  let fromUserName: string | null = null;
  let toUserName: string | null = null;

  if (pendingTransfer) {
    const { data: fromProfile } = await adminClient
      .from("profiles")
      .select("display_name")
      .eq("id", pendingTransfer.from_user_id)
      .single();
    fromUserName = fromProfile?.display_name ?? null;

    if (pendingTransfer.to_user_id) {
      const { data: toProfile } = await adminClient
        .from("profiles")
        .select("display_name")
        .eq("id", pendingTransfer.to_user_id)
        .single();
      toUserName = toProfile?.display_name ?? null;
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">
        Admin Transfer — {org.name}
      </h1>

      <AdminTransferFlow
        orgId={org.id}
        orgSlug={slug}
        currentUserId={auth.ctx.userId}
        candidates={candidates}
        pendingTransfer={
          pendingTransfer
            ? {
                id: pendingTransfer.id,
                fromUserId: pendingTransfer.from_user_id,
                fromUserName,
                toUserId: pendingTransfer.to_user_id,
                toUserName,
                timeoutAt: pendingTransfer.timeout_at,
                reason: pendingTransfer.reason,
              }
            : null
        }
      />
    </div>
  );
}
