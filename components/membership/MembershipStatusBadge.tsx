"use client";

import type { OrgMembershipStatus } from "@/lib/membership/types";
import { STATUS_META } from "@/lib/membership/types";

interface MembershipStatusBadgeProps {
  status: OrgMembershipStatus | null;
  size?: "sm" | "md";
}

export default function MembershipStatusBadge({
  status,
  size = "sm",
}: MembershipStatusBadgeProps) {
  if (!status) return null;

  const meta = STATUS_META[status];
  const sizeClasses =
    size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm";

  return (
    <span
      className={`inline-flex items-center font-medium rounded-full ${meta.bgClass} ${meta.textClass} ${sizeClasses} ${
        status === "canceled" ? "line-through" : ""
      }`}
    >
      {meta.label}
    </span>
  );
}
