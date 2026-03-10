"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";

const ROLE_BADGES: Record<string, { label: string; color: string }> = {
  super_admin: { label: "Super Admin", color: "bg-purple-100 text-purple-700" },
  admin: { label: "Admin", color: "bg-blue-100 text-blue-700" },
  org_admin: { label: "Org Admin", color: "bg-amber-100 text-amber-700" },
  member: { label: "Member", color: "bg-green-100 text-green-700" },
  partner: { label: "Partner", color: "bg-cyan-100 text-cyan-700" },
};

type ActiveConference = { year: string; edition: string } | null;
type WebsiteAlert = {
  id: string;
  kind:
    | "content_flag"
    | "legacy_flag"
    | "update_request"
    | "application"
    | "application_status"
    | "invoice"
    | "renewal";
  title: string;
  message: string;
  href: string;
  createdAt: string;
};

type CircleAlertItem = {
  id: string;
  title: string;
  message: string;
  href: string;
  createdAt: string;
};

function isGlobalAdmin(role: string): boolean {
  return role === "admin" || role === "super_admin";
}

export default function Header() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showAlertMenu, setShowAlertMenu] = useState(false);
  const [alertTab, setAlertTab] = useState<"notifications" | "replies" | "dms">("notifications");
  const [cartCount, setCartCount] = useState(0);
  const [dmUnreadCount, setDmUnreadCount] = useState(0);
  const [websiteAlerts, setWebsiteAlerts] = useState<WebsiteAlert[]>([]);
  const [websiteAlertCount, setWebsiteAlertCount] = useState(0);
  const [circleNotifications, setCircleNotifications] = useState<CircleAlertItem[]>([]);
  const [circleReplies, setCircleReplies] = useState<CircleAlertItem[]>([]);
  const [activeConference, setActiveConference] = useState<ActiveConference>(null);

  const userMenuRef = useRef<HTMLDivElement>(null);
  const alertMenuRef = useRef<HTMLDivElement>(null);

  const pathname = usePathname();
  const {
    user,
    profile,
    globalRole,
    permissionState,
    organizations,
    isLoading,
    signOut,
    requiresReauth,
    reauthMessage,
    reauthUrl,
    reauthCountdownSeconds,
    idleWarningVisible,
    idleSecondsRemaining,
    keepSessionAlive,
  } = useAuth();

  const primaryOrg = organizations[0];
  const isAdmin = isGlobalAdmin(globalRole);

  const conferenceContext = useMemo(() => {
    const parts = pathname.split("/").filter(Boolean);
    if (parts[0] === "conference" && parts.length >= 3) {
      return { year: parts[1], edition: parts[2] };
    }
    if (activeConference) return activeConference;
    return { year: String(new Date().getFullYear()), edition: "00" };
  }, [pathname, activeConference]);

  const conferenceBaseHref = `/conference/${conferenceContext.year}/${conferenceContext.edition}`;
  const cartHref = `${conferenceBaseHref}/cart${primaryOrg?.organization_id ? `?org=${primaryOrg.organization_id}` : ""}`;
  const authAwareHref = (href: string) =>
    user ? href : `/login?next=${encodeURIComponent(href)}`;
  const memberSpaceHref = authAwareHref("/api/circle/member-space");

  const badge = ROLE_BADGES[permissionState];
  const notificationsCount = websiteAlertCount + circleNotifications.length;
  const repliesCount = circleReplies.length;
  const totalAlertCount = dmUnreadCount + notificationsCount + repliesCount;
  const mergedNotificationItems = useMemo(() => {
    const websiteItems = websiteAlerts.map((item) => ({
      id: `website:${item.id}`,
      source: "Website" as const,
      title: item.title,
      message: item.message,
      href: item.href,
      createdAt: item.createdAt,
    }));
    const circleItems = circleNotifications.map((item) => ({
      id: `circle:${item.id}`,
      source: "Circle" as const,
      title: item.title,
      message: item.message,
      href: item.href,
      createdAt: item.createdAt,
    }));
    return [...websiteItems, ...circleItems].sort((a, b) => {
      const aTs = new Date(a.createdAt).getTime();
      const bTs = new Date(b.createdAt).getTime();
      return bTs - aTs;
    });
  }, [websiteAlerts, circleNotifications]);
  const bannerCount =
    (requiresReauth ? 1 : 0) + (idleWarningVisible && !requiresReauth ? 1 : 0);
  const topClass =
    bannerCount >= 2 ? "top-20" : bannerCount === 1 ? "top-10" : "top-0";

  const initials = profile?.display_name
    ? profile.display_name
        .split(" ")
        .map((part) => part[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : user?.email?.charAt(0).toUpperCase() || "?";

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 0);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadActiveConference = async () => {
      try {
        const response = await fetch("/api/conference/active", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { year?: string; edition?: string; found?: boolean };
        if (cancelled) return;
        if (data.found && data.year && data.edition) {
          setActiveConference({ year: data.year, edition: data.edition });
        } else {
          setActiveConference(null);
        }
      } catch {
        if (!cancelled) setActiveConference(null);
      }
    };

    void loadActiveConference();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!user || !activeConference || !primaryOrg?.organization_id) return;

    let cancelled = false;

    const loadCartCount = async () => {
      try {
        const response = await fetch(
          `/api/conference/cart-count?year=${encodeURIComponent(activeConference.year)}&edition=${encodeURIComponent(
            activeConference.edition
          )}&org=${encodeURIComponent(primaryOrg.organization_id)}`,
          { cache: "no-store" }
        );
        if (!response.ok) return;
        const data = (await response.json()) as { count?: number };
        if (!cancelled) {
          setCartCount(typeof data.count === "number" ? data.count : 0);
        }
      } catch {
        if (!cancelled) setCartCount(0);
      }
    };

    void loadCartCount();
    return () => {
      cancelled = true;
    };
  }, [user, activeConference, primaryOrg?.organization_id]);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    const loadCircleSummary = async () => {
      try {
        const response = await fetch("/api/circle/dm?summary=true", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { chatRooms?: Array<Record<string, unknown>> };
        const rooms = Array.isArray(data.chatRooms) ? data.chatRooms : [];

        const count = rooms.reduce((sum, room) => {
          const candidate =
            (room.unread_count as number | undefined) ??
            (room.unread_messages_count as number | undefined) ??
            (room.unseen_messages_count as number | undefined) ??
            0;
          return sum + (typeof candidate === "number" ? candidate : 0);
        }, 0);

        if (!cancelled) {
          setDmUnreadCount(count);
        }
      } catch {
        if (!cancelled) setDmUnreadCount(0);
      }
    };

    void loadCircleSummary();

    const intervalId = window.setInterval(() => {
      void loadCircleSummary();
    }, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    let unsupported = false;

    const loadCircleAlertSummary = async () => {
      if (unsupported) return;
      try {
        const response = await fetch("/api/circle/notifications?summary=true", {
          cache: "no-store",
        });
        if (response.status === 404) {
          unsupported = true;
          if (!cancelled) {
            setCircleNotifications([]);
            setCircleReplies([]);
          }
          return;
        }
        if (!response.ok) return;

        const data = (await response.json()) as {
          notifications?: CircleAlertItem[];
          replies?: CircleAlertItem[];
        };
        if (cancelled) return;
        setCircleNotifications(
          Array.isArray(data.notifications) ? data.notifications : []
        );
        setCircleReplies(Array.isArray(data.replies) ? data.replies : []);
      } catch {
        if (!cancelled) {
          setCircleNotifications([]);
          setCircleReplies([]);
        }
      }
    };

    void loadCircleAlertSummary();
    const intervalId = window.setInterval(() => {
      void loadCircleAlertSummary();
    }, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    const loadWebsiteAlerts = async () => {
      try {
        const response = await fetch("/api/alerts", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { items?: WebsiteAlert[]; total?: number };
        if (cancelled) return;
        const items = Array.isArray(data.items) ? data.items : [];
        setWebsiteAlerts(items);
        setWebsiteAlertCount(typeof data.total === "number" ? data.total : items.length);
      } catch {
        if (!cancelled) {
          setWebsiteAlerts([]);
          setWebsiteAlertCount(0);
        }
      }
    };

    void loadWebsiteAlerts();
    const intervalId = window.setInterval(() => {
      void loadWebsiteAlerts();
    }, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [user]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
      if (alertMenuRef.current && !alertMenuRef.current.contains(event.target as Node)) {
        setShowAlertMenu(false);
      }
    };

    if (showUserMenu || showAlertMenu) {
      document.addEventListener("mousedown", handleOutsideClick);
    }

    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [showUserMenu, showAlertMenu]);

  return (
    <>
      {requiresReauth ? (
        <div className="fixed top-0 inset-x-0 z-[60] bg-amber-50 border-b border-amber-200">
          <div className="max-w-7xl mx-auto px-4 py-2 text-sm text-amber-900 flex items-center justify-between gap-3">
            <span className="truncate">
              {reauthMessage}
              {reauthCountdownSeconds > 0 ? ` Redirecting in ${reauthCountdownSeconds}s.` : ""}
            </span>
            <Link
              href={reauthUrl}
              className="shrink-0 inline-flex items-center px-3 py-1.5 rounded-md bg-amber-700 text-white text-xs font-medium hover:bg-amber-800 transition-colors"
            >
              Sign in again
            </Link>
          </div>
        </div>
      ) : null}

      {!requiresReauth && idleWarningVisible ? (
        <div className="fixed top-0 inset-x-0 z-[60] bg-rose-50 border-b border-rose-200">
          <div className="max-w-7xl mx-auto px-4 py-2 text-sm text-rose-900 flex items-center justify-between gap-3">
            <span className="truncate">
              You will be signed out for inactivity in {idleSecondsRemaining}s.
            </span>
            <button
              onClick={keepSessionAlive}
              className="shrink-0 inline-flex items-center px-3 py-1.5 rounded-md bg-rose-700 text-white text-xs font-medium hover:bg-rose-800 transition-colors"
            >
              Stay signed in
            </button>
          </div>
        </div>
      ) : null}

      <header
        className={`sticky z-50 h-16 bg-white border-b transition-shadow duration-200 ${topClass} ${
          isScrolled ? "shadow-sm border-[#E5E5E5]" : "border-transparent"
        }`}
      >
        <div className="h-full max-w-7xl mx-auto px-4 md:px-6 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center">
            <Image
              src="/logos/csc-logo.svg"
              alt="Campus Stores Canada"
              width={36}
              height={36}
              priority
              className="h-9 w-9 sm:hidden"
            />
            <Image
              src="/logos/csc-logo-horizontal-wordmark.svg"
              alt="Campus Stores Canada"
              width={252}
              height={76}
              priority
              className="hidden h-8 w-auto sm:block"
            />
          </Link>

          <nav className="hidden lg:flex items-center gap-6 text-sm font-medium text-[#4b4b4b]">
            <Link href="/" className="hover:text-[#1A1A1A]">Home</Link>
            <Link href="/about" className="hover:text-[#1A1A1A]">About</Link>
            <Link href="/members" className="hover:text-[#1A1A1A]">Members</Link>
            <Link href="/partners" className="hover:text-[#1A1A1A]">Partners</Link>
            <Link href="/resources" className="hover:text-[#1A1A1A]">Resources</Link>

            <div className="relative group">
              <button type="button" className="inline-flex items-center gap-1 hover:text-[#1A1A1A]">
                Conference
                <span className="text-[10px]">▾</span>
              </button>
              <div className="invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-opacity absolute top-full left-0 mt-2 w-48 rounded-lg border border-gray-200 bg-white shadow-lg p-1 z-50">
                <Link href={authAwareHref(`${conferenceBaseHref}/register${primaryOrg?.organization_id ? `?org=${primaryOrg.organization_id}` : ""}`)} className="block px-3 py-2 rounded-md hover:bg-gray-50">
                  Registration
                </Link>
                <Link href={authAwareHref(`${conferenceBaseHref}/products${primaryOrg?.organization_id ? `?org=${primaryOrg.organization_id}` : ""}`)} className="block px-3 py-2 rounded-md hover:bg-gray-50">
                  Products
                </Link>
                <Link href={authAwareHref(`${conferenceBaseHref}/schedule${primaryOrg?.organization_id ? `?org=${primaryOrg.organization_id}` : ""}`)} className="block px-3 py-2 rounded-md hover:bg-gray-50">
                  Schedule
                </Link>
              </div>
            </div>

            <a href={memberSpaceHref} className="hover:text-[#1A1A1A]">Member Space</a>
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            {activeConference ? (
              <Link
                href={authAwareHref(cartHref)}
                className="relative inline-flex items-center justify-center rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-gray-400"
                aria-label="Conference cart"
              >
                Cart
                {user && cartCount > 0 ? (
                    <span className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--brand-red)] px-1.5 text-[10px] font-semibold text-white">
                    {cartCount}
                  </span>
                ) : null}
              </Link>
            ) : null}

            {user ? (
              <div className="relative" ref={alertMenuRef}>
                <button
                  type="button"
                  onClick={() => setShowAlertMenu((value) => !value)}
                  className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-300 text-gray-700 hover:border-gray-400"
                  aria-label="Alerts"
                >
                  <span className="text-sm">🔔</span>
                  {totalAlertCount > 0 ? (
                    <span className="absolute -top-1 -right-1 inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--brand-red)] px-1.5 text-[10px] font-semibold text-white">
                      {totalAlertCount > 99 ? "99+" : totalAlertCount}
                    </span>
                  ) : null}
                </button>

                {showAlertMenu ? (
                  <div className="absolute right-0 top-full mt-2 w-72 rounded-lg border border-gray-200 bg-white shadow-lg p-2 z-50">
                    <p className="px-2 py-1 text-xs uppercase tracking-wide text-gray-400">Alert Center</p>
                    <div className="mt-1 grid grid-cols-3 gap-1 rounded-md bg-gray-50 p-1 text-xs">
                      <button
                        type="button"
                        onClick={() => setAlertTab("notifications")}
                        className={`rounded px-2 py-1.5 text-left ${alertTab === "notifications" ? "bg-white text-gray-900 shadow-sm" : "text-gray-600"}`}
                      >
                        Notifications ({notificationsCount})
                      </button>
                      <button
                        type="button"
                        onClick={() => setAlertTab("replies")}
                        className={`rounded px-2 py-1.5 text-left ${alertTab === "replies" ? "bg-white text-gray-900 shadow-sm" : "text-gray-600"}`}
                      >
                        Replies ({repliesCount})
                      </button>
                      <button
                        type="button"
                        onClick={() => setAlertTab("dms")}
                        className={`rounded px-2 py-1.5 text-left ${alertTab === "dms" ? "bg-white text-gray-900 shadow-sm" : "text-gray-600"}`}
                      >
                        DMs ({dmUnreadCount})
                      </button>
                    </div>

                    {alertTab === "notifications" ? (
                      mergedNotificationItems.length > 0 ? (
                        mergedNotificationItems.slice(0, 5).map((alert) => (
                          <Link
                            key={alert.id}
                            href={alert.href}
                            className="mt-1 block rounded-md px-2 py-2 hover:bg-gray-50"
                          >
                            <p className="text-[11px] uppercase tracking-wide text-gray-400">{alert.source}</p>
                            <p className="text-sm text-gray-800">{alert.title}</p>
                            <p className="text-xs text-gray-500 line-clamp-2">{alert.message}</p>
                          </Link>
                        ))
                      ) : (
                        <p className="px-2 py-2 text-xs text-gray-500">No notifications.</p>
                      )
                    ) : null}

                    {alertTab === "replies" ? (
                      circleReplies.length > 0 ? (
                        circleReplies.slice(0, 5).map((reply) => (
                          <Link
                            key={reply.id}
                            href={reply.href}
                            className="mt-1 block rounded-md px-2 py-2 hover:bg-gray-50"
                          >
                            <p className="text-sm text-gray-800">{reply.title}</p>
                            <p className="text-xs text-gray-500 line-clamp-2">{reply.message}</p>
                          </Link>
                        ))
                      ) : (
                        <p className="px-2 py-2 text-xs text-gray-500">No replies right now.</p>
                      )
                    ) : null}

                    {alertTab === "dms" ? (
                      <a
                        href={memberSpaceHref}
                        className="mt-1 flex items-start justify-between rounded-md px-2 py-2 hover:bg-gray-50"
                      >
                        <span className="text-sm text-gray-800">Open Circle DMs</span>
                        <span className="text-xs text-gray-500">{dmUnreadCount}</span>
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {isLoading ? (
              <div className="w-8 h-8 bg-gray-100 rounded-full animate-pulse" />
            ) : user ? (
              <div className="relative" ref={userMenuRef}>
                <button
                  onClick={() => setShowUserMenu((value) => !value)}
                  className="flex items-center gap-2 hover:opacity-80 transition-opacity"
                >
                  {badge ? (
                    <span className={`hidden md:inline-flex text-[10px] font-medium px-2 py-0.5 rounded-full ${badge.color}`}>
                      {badge.label}
                    </span>
                  ) : null}
                  <div className="w-8 h-8 rounded-full bg-[var(--brand-red)] flex items-center justify-center">
                    <span className="text-white text-xs font-medium">{initials}</span>
                  </div>
                </button>

                {showUserMenu ? (
                  <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-lg border border-gray-200 shadow-lg py-1 z-50">
                    <div className="px-4 py-3 border-b border-gray-100">
                      <p className="text-sm font-medium text-gray-900 truncate">{profile?.display_name || user.email}</p>
                      <p className="text-xs text-gray-500 truncate">{user.email}</p>
                    </div>

                    <Link href="/me" onClick={() => setShowUserMenu(false)} className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                      My Account
                    </Link>

                    {primaryOrg?.organization?.slug ? (
                      <Link
                        href={`/org/${primaryOrg.organization.slug}`}
                        onClick={() => setShowUserMenu(false)}
                        className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        My Organization
                      </Link>
                    ) : null}

                    <a
                      href={memberSpaceHref}
                      onClick={() => setShowUserMenu(false)}
                      className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Member Space
                    </a>

                    {isAdmin ? (
                      <>
                        <div className="my-1 border-t border-gray-100" />
                        <Link href="/admin" onClick={() => setShowUserMenu(false)} className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                          Admin Console
                        </Link>
                        <Link href="/admin/ops" onClick={() => setShowUserMenu(false)} className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                          Ops Health
                        </Link>
                        <Link href="/admin/policy" onClick={() => setShowUserMenu(false)} className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                          Policy Settings
                        </Link>
                        <Link href="/admin/pages" onClick={() => setShowUserMenu(false)} className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                          Pages & Permissions
                        </Link>
                      </>
                    ) : null}

                    <div className="my-1 border-t border-gray-100" />

                    <button
                      onClick={() => {
                        setShowUserMenu(false);
                        void signOut();
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Sign out
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <Link href="/login" className="hidden sm:inline text-sm font-medium text-[#6B6B6B] hover:text-[#1A1A1A]">
                  Login
                </Link>
                <Link href="/signup" className="h-8 px-4 bg-[var(--brand-red)] hover:bg-[var(--brand-red-hover)] text-white text-sm font-medium rounded-md flex items-center">
                  Join CSC
                </Link>
              </>
            )}

            <button
              type="button"
              onClick={() => setShowMobileMenu((value) => !value)}
              className="lg:hidden inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-300 text-gray-700"
              aria-label="Toggle navigation menu"
            >
              {showMobileMenu ? "✕" : "☰"}
            </button>
          </div>
        </div>

        {showMobileMenu ? (
          <div className="lg:hidden border-t border-gray-200 bg-white">
            <nav className="max-w-7xl mx-auto px-4 py-3 grid gap-1 text-sm">
              <Link href="/" className="px-2 py-2 rounded-md hover:bg-gray-50">Home</Link>
              <Link href="/about" className="px-2 py-2 rounded-md hover:bg-gray-50">About</Link>
              <Link href="/members" className="px-2 py-2 rounded-md hover:bg-gray-50">Members</Link>
              <Link href="/partners" className="px-2 py-2 rounded-md hover:bg-gray-50">Partners</Link>
              <Link href="/resources" className="px-2 py-2 rounded-md hover:bg-gray-50">Resources</Link>
              <Link href={authAwareHref(`${conferenceBaseHref}/register${primaryOrg?.organization_id ? `?org=${primaryOrg.organization_id}` : ""}`)} className="px-2 py-2 rounded-md hover:bg-gray-50">
                Conference Registration
              </Link>
              <Link href={authAwareHref(`${conferenceBaseHref}/products${primaryOrg?.organization_id ? `?org=${primaryOrg.organization_id}` : ""}`)} className="px-2 py-2 rounded-md hover:bg-gray-50">
                Conference Products
              </Link>
              <Link href={authAwareHref(`${conferenceBaseHref}/schedule${primaryOrg?.organization_id ? `?org=${primaryOrg.organization_id}` : ""}`)} className="px-2 py-2 rounded-md hover:bg-gray-50">
                Conference Schedule
              </Link>
              <a href={memberSpaceHref} className="px-2 py-2 rounded-md hover:bg-gray-50">Member Space</a>

              {user ? (
                <>
                  <Link href="/me" className="px-2 py-2 rounded-md hover:bg-gray-50">My Account</Link>
                  {primaryOrg?.organization?.slug ? (
                    <Link href={`/org/${primaryOrg.organization.slug}`} className="px-2 py-2 rounded-md hover:bg-gray-50">
                      My Organization
                    </Link>
                  ) : null}
                  {isAdmin ? (
                    <>
                      <Link href="/admin" className="px-2 py-2 rounded-md hover:bg-gray-50">Admin Console</Link>
                      <Link href="/admin/ops" className="px-2 py-2 rounded-md hover:bg-gray-50">Ops Health</Link>
                      <Link href="/admin/policy" className="px-2 py-2 rounded-md hover:bg-gray-50">Policy Settings</Link>
                      <Link href="/admin/pages" className="px-2 py-2 rounded-md hover:bg-gray-50">Pages & Permissions</Link>
                    </>
                  ) : null}
                </>
              ) : null}
            </nav>
          </div>
        ) : null}
      </header>
    </>
  );
}
