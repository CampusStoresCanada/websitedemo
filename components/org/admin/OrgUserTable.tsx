"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deactivateOrgUser,
  reactivateOrgUser,
  changeOrgUserRole,
  setOrgMemberHidden,
} from "@/lib/actions/user-management";
import type { OrgUserRow } from "@/app/org/[slug]/admin/users/page";

interface OrgUserTableProps {
  users: OrgUserRow[];
  orgId: string;
}

export function OrgUserTable({ users, orgId }: OrgUserTableProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const [actingOnUser, setActingOnUser] = useState<string | null>(null);

  async function handleDeactivate(userId: string) {
    setActionError(null);
    setActingOnUser(userId);
    const result = await deactivateOrgUser(orgId, userId);
    if (!result.success) {
      setActionError(result.error ?? "Failed to deactivate user");
      setActingOnUser(null);
      return;
    }
    setActingOnUser(null);
    startTransition(() => router.refresh());
  }

  async function handleReactivate(userId: string) {
    setActionError(null);
    setActingOnUser(userId);
    const result = await reactivateOrgUser(orgId, userId);
    if (!result.success) {
      setActionError(result.error ?? "Failed to reactivate user");
      setActingOnUser(null);
      return;
    }
    setActingOnUser(null);
    startTransition(() => router.refresh());
  }

  async function handleRoleChange(
    userId: string,
    newRole: "member" | "org_admin"
  ) {
    setActionError(null);
    setActingOnUser(userId);
    const result = await changeOrgUserRole(orgId, userId, newRole);
    if (!result.success) {
      setActionError(result.error ?? "Failed to change role");
      setActingOnUser(null);
      return;
    }
    setActingOnUser(null);
    startTransition(() => router.refresh());
  }

  async function handleToggleHidden(userId: string, currentlyHidden: boolean) {
    setActionError(null);
    setActingOnUser(userId);
    const result = await setOrgMemberHidden(orgId, userId, !currentlyHidden);
    if (!result.success) {
      setActionError(result.error ?? "Failed to update visibility");
      setActingOnUser(null);
      return;
    }
    setActingOnUser(null);
    startTransition(() => router.refresh());
  }

  if (users.length === 0) {
    return (
      <div className="bg-white rounded-lg p-8 text-center text-gray-500 border border-gray-200">
        No users found for this organization.
      </div>
    );
  }

  return (
    <div>
      {actionError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {actionError}
          <button
            onClick={() => setActionError(null)}
            className="ml-2 text-red-500 hover:text-red-700"
          >
            ✕
          </button>
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                User
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                Email
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                Role
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                Visibility
              </th>
              <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((user) => {
              const isActing =
                actingOnUser === user.userId || isPending;

              return (
                <tr
                  key={user.membershipId}
                  className={`transition-colors ${
                    user.hidden ? "bg-gray-50 opacity-60" : "hover:bg-gray-50"
                  }`}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {user.avatarUrl ? (
                        <img
                          src={user.avatarUrl}
                          alt=""
                          className="w-8 h-8 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-600">
                          {(
                            user.displayName ??
                            user.email ??
                            "?"
                          )
                            .charAt(0)
                            .toUpperCase()}
                        </div>
                      )}
                      <span className="text-sm font-medium text-gray-900">
                        {user.displayName ?? "—"}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {user.email ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        user.role === "org_admin"
                          ? "bg-blue-100 text-[#D92327]"
                          : "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {user.role === "org_admin" ? "Admin" : "Member"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        user.status === "active"
                          ? "bg-green-100 text-green-700"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      {user.status}
                    </span>
                  </td>
                  {/* Visibility cell */}
                  <td className="px-4 py-3">
                    {user.hidden ? (
                      <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-500">
                        Hidden
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-green-50 text-green-700">
                        Visible
                      </span>
                    )}
                  </td>

                  {/* Actions cell */}
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {/* Role toggle */}
                      {user.status === "active" && (
                        <button
                          onClick={() =>
                            handleRoleChange(
                              user.userId,
                              user.role === "org_admin"
                                ? "member"
                                : "org_admin"
                            )
                          }
                          disabled={isActing}
                          className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {user.role === "org_admin" ? "Demote" : "Promote"}
                        </button>
                      )}

                      {/* Visibility toggle */}
                      <button
                        onClick={() =>
                          handleToggleHidden(user.userId, user.hidden)
                        }
                        disabled={isActing}
                        className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        title={
                          user.hidden
                            ? "Make visible to all members"
                            : "Hide from public and member views"
                        }
                      >
                        {user.hidden ? "Show" : "Hide"}
                      </button>

                      {/* Deactivate / Reactivate */}
                      {user.status === "active" ? (
                        <button
                          onClick={() => handleDeactivate(user.userId)}
                          disabled={isActing}
                          className="text-xs px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Deactivate
                        </button>
                      ) : (
                        <button
                          onClick={() => handleReactivate(user.userId)}
                          disabled={isActing}
                          className="text-xs px-2 py-1 rounded border border-green-200 text-green-600 hover:bg-green-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Reactivate
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
