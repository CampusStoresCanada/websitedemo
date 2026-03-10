"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LABELS: Record<string, string> = {
  ops: "Ops Health",
  policy: "Policy Settings",
  pages: "Pages & Permissions",
  conference: "Conference",
  content: "Content",
};

export default function AdminBreadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "admin") return null;

  const crumbs = [{ label: "Admin", href: "/admin" }];
  for (let idx = 1; idx < segments.length; idx += 1) {
    const segment = segments[idx];
    crumbs.push({
      label: LABELS[segment] ?? segment.replace(/-/g, " "),
      href: `/${segments.slice(0, idx + 1).join("/")}`,
    });
  }

  return (
    <nav className="mb-5 text-sm text-gray-500" aria-label="Admin breadcrumbs">
      <ol className="flex items-center gap-2">
        {crumbs.map((crumb, idx) => (
          <li key={crumb.href} className="flex items-center gap-2">
            {idx > 0 ? <span className="text-gray-400">/</span> : null}
            {idx === crumbs.length - 1 ? (
              <span className="text-gray-700 font-medium">{crumb.label}</span>
            ) : (
              <Link href={crumb.href} className="hover:text-gray-700">
                {crumb.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
