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

                      {/* Visibility toggle — eye icon */}
                      <button
                        onClick={() => handleToggleHidden(user.userId, user.hidden)}
                        disabled={isActing}
                        title={user.hidden ? "Make visible to all members" : "Hide from public and member views"}
                        className={`p-1.5 rounded border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${user.hidden ? "border-amber-300 text-amber-600 bg-amber-50 hover:bg-amber-100" : "border-gray-300 text-gray-500 hover:bg-gray-50"}`}
                      >
                        {user.hidden ? (
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
                        ) : (
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                        )}
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
