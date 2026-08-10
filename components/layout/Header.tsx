"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";
import { CONFERENCE_CART_UPDATED_EVENT, type ConferenceCartUpdatedDetail } from "@/lib/conference/cart-events";
import { hadPriorSession, hasKnownAccountPersona } from "@/lib/auth/persona-cookie";

const ROLE_BADGES: Record<string, { label: string; color: string }> = {
  super_admin: { label: "Super Admin", color: "bg-purple-100 text-purple-700" },
  admin: { label: "Admin", color: "bg-blue-100 text-[#D92327]" },
  org_admin: { label: "Org Admin", color: "bg-amber-100 text-amber-700" },
  member: { label: "Member", color: "bg-green-100 text-green-700" },
  partner: { label: "Partner", color: "bg-cyan-100 text-cyan-700" },
};

// Server-side responses for these are cached ~30s (see the respective
// app/api/circle/* and app/api/alerts route handlers) — 90s keeps client
// call volume down without the badges feeling stale.
const BADGE_POLL_INTERVAL_MS = 90_000;

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
  isRead?: boolean;
};

type CircleAlertItem = {
  id: string;
  title: string;
  message: string;
  href: string;
  createdAt: string;
  isRead?: boolean;
};

type CircleDmItem = {
  uuid: string;
  name: string;
  kind: "direct" | "group_chat";
  unreadCount: number;
  lastMessage: string | null;
  lastSender: string | null;
  href: string;
};

function isGlobalAdmin(role: string): boolean {
  return role === "admin" || role === "super_admin";
}

export default function Header() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [hadSession, setHadSession] = useState(false);
  const [isKnownPersona, setIsKnownPersona] = useState(false);
  const [showAlertMenu, setShowAlertMenu] = useState(false);
  const [alertTab, setAlertTab] = useState<"notifications" | "dms">("notifications");
  const [cartCount, setCartCount] = useState(0);
  const [cartJustUpdated, setCartJustUpdated] = useState(false);
  const [lastCartOrgId, setLastCartOrgId] = useState<string | null>(null);
  const [dmUnreadCount, setDmUnreadCount] = useState(0);
  const [websiteAlerts, setWebsiteAlerts] = useState<WebsiteAlert[]>([]);
  const [websiteAlertCount, setWebsiteAlertCount] = useState(0);
  const [circleNotifications, setCircleNotifications] = useState<CircleAlertItem[]>([]);
  const [circleReplies, setCircleReplies] = useState<CircleAlertItem[]>([]);
  const [circleDms, setCircleDms] = useState<CircleDmItem[]>([]);
  const [activeConference, setActiveConference] = useState<ActiveConference>(null);
  const [conferenceNavHref, setConferenceNavHref] = useState<string | null>(null);

  const userMenuRef = useRef<HTMLDivElement>(null);
  const alertMenuRef = useRef<HTMLDivElement>(null);

  const pathname = usePathname();
  const searchParams = useSearchParams();
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
  const partnerOrgAdmin = organizations.find(
    uo => uo.organization?.type === "Vendor Partner" && uo.role === "org_admin"
  );
  const memberOrg = organizations.find(
    uo => uo.organization?.type === "Member"
  );
  const orgAdminOrg = organizations.find(uo => uo.role === "org_admin");

  // True whenever we're actually on a conference's pages — the cart button
  // should reflect THIS conference regardless of whether some other
  // conference elsewhere happens to be in "registration_open" status.
  const onConferencePage = useMemo(() => {
    const parts = pathname.split("/").filter(Boolean);
    return parts[0] === "conference" && parts.length >= 3;
  }, [pathname]);

  const conferenceContext = useMemo(() => {
    const parts = pathname.split("/").filter(Boolean);
    if (parts[0] === "conference" && parts.length >= 3) {
      return { year: parts[1], edition: parts[2] };
    }
    if (activeConference) return activeConference;
    return { year: String(new Date().getFullYear()), edition: "00" };
  }, [pathname, activeConference]);

  const showCart = onConferencePage || Boolean(activeConference);
  // The page itself lets a multi-org user pick which org they're buying for
  // via ?org= — match that instead of always defaulting to their first org,
  // otherwise the header polls the wrong org's (always-empty) cart. Pages
  // that don't carry ?org= at all (e.g. /org/[slug], which has no reason to)
  // still need this to work, so lastCartOrgId — set from the org id carried
  // on the most recent CONFERENCE_CART_UPDATED_EVENT — is the next fallback
  // before the viewer's primary org, which may not be the org they're
  // actually buying for.
  const cartOrgId = searchParams.get("org") ?? lastCartOrgId ?? primaryOrg?.organization_id ?? null;

  const conferenceBaseHref = `/conference/${conferenceContext.year}/${conferenceContext.edition}`;
  const cartHref = `${conferenceBaseHref}/cart${cartOrgId ? `?org=${cartOrgId}` : ""}`;
  const authAwareHref = (href: string) =>
    user ? href : `/login?next=${encodeURIComponent(href)}`;
  const memberSpaceHref = authAwareHref("/api/circle/member-space");

  const badge = ROLE_BADGES[permissionState];
  const notificationsCount = websiteAlertCount + circleNotifications.filter(n => !n.isRead).length;
  const totalAlertCount = dmUnreadCount + notificationsCount;
  const mergedNotificationItems = useMemo(() => {
    const websiteItems = websiteAlerts.map((item) => ({
      id: `website:${item.id}`,
      alertKey: item.id,
      source: "Website" as const,
      title: item.title,
      message: item.message,
      href: item.href,
      createdAt: item.createdAt,
      isRead: item.isRead ?? false,
    }));
    const circleItems = circleNotifications.map((item) => ({
      id: `circle:${item.id}`,
      alertKey: null as string | null,
      source: "Circle" as const,
      title: item.title,
      message: item.message,
      href: item.href,
      createdAt: item.createdAt,
      isRead: item.isRead,
    }));
    return [...websiteItems, ...circleItems].sort((a, b) => {
      // Unread floats above read
      if (!a.isRead && b.isRead) return -1;
      if (a.isRead && !b.isRead) return 1;
      // Within the same read state, newest first
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
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

  const handleLogoClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    window.location.assign("/");
  };

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 0);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setHadSession(hadPriorSession());
    setIsKnownPersona(hasKnownAccountPersona());
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
    let cancelled = false;

    const loadConferenceNavHref = async () => {
      try {
        const response = await fetch("/api/conference/nav-link", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { href?: string | null };
        if (!cancelled) setConferenceNavHref(data.href ?? null);
      } catch {
        if (!cancelled) setConferenceNavHref(null);
      }
    };

    void loadConferenceNavHref();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!user || !showCart || !cartOrgId) return;

    let cancelled = false;

    // Accepts an org id override so the cart-updated event (below) can poll
    // the org it actually just added to immediately, rather than the stale
    // cartOrgId this effect closed over — which matters on pages like
    // /org/[slug] where cartOrgId only catches up once lastCartOrgId state
    // updates and this effect re-runs.
    const loadCartCount = async (orgIdOverride?: string) => {
      const orgId = orgIdOverride ?? cartOrgId;
      if (!orgId) return;
      try {
        const response = await fetch(
          `/api/conference/cart-count?year=${encodeURIComponent(conferenceContext.year)}&edition=${encodeURIComponent(
            conferenceContext.edition
          )}&org=${encodeURIComponent(orgId)}`,
          { cache: "no-store" }
        );
        if (!response.ok) return;
        const data = (await response.json()) as { count?: number };
        if (!cancelled) {
          setCartCount((prev) => {
            const next = typeof data.count === "number" ? data.count : 0;
            if (next > prev) {
              setCartJustUpdated(true);
              window.setTimeout(() => setCartJustUpdated(false), 600);
            }
            return next;
          });
        }
      } catch {
        if (!cancelled) setCartCount(0);
      }
    };

    void loadCartCount();

    // Pages that add to the conference cart (floor plan, offers, org
    // profiles) dispatch this event so the header updates — and animates —
    // immediately, without a full navigation or a separate toast/modal. The
    // event carries the org id the add was for; remember it (lastCartOrgId)
    // so cartOrgId — and the Cart link's href — stay correct even on pages
    // that never set ?org= in the URL.
    const handleCartUpdated = (event: Event) => {
      const orgId = (event as CustomEvent<ConferenceCartUpdatedDetail>).detail?.organizationId;
      if (orgId && orgId !== cartOrgId) setLastCartOrgId(orgId);
      void loadCartCount(orgId);
    };
    window.addEventListener(CONFERENCE_CART_UPDATED_EVENT, handleCartUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener(CONFERENCE_CART_UPDATED_EVENT, handleCartUpdated);
    };
  }, [user, showCart, cartOrgId, conferenceContext.year, conferenceContext.edition]);

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
    }, BADGE_POLL_INTERVAL_MS);

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
          dms?: CircleDmItem[];
          dmUnreadCount?: number;
        };
        if (cancelled) return;
        setCircleNotifications(Array.isArray(data.notifications) ? data.notifications : []);
        setCircleReplies(Array.isArray(data.replies) ? data.replies : []);
        setCircleDms(Array.isArray(data.dms) ? data.dms : []);
        if (typeof data.dmUnreadCount === "number") setDmUnreadCount(data.dmUnreadCount);
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
    }, BADGE_POLL_INTERVAL_MS);

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
        const data = (await response.json()) as { items?: WebsiteAlert[]; total?: number; unreadCount?: number };
        if (cancelled) return;
        const items = Array.isArray(data.items) ? data.items : [];
        setWebsiteAlerts(items);
        setWebsiteAlertCount(typeof data.unreadCount === "number" ? data.unreadCount : items.filter(i => !i.isRead).length);
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
    }, BADGE_POLL_INTERVAL_MS);

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
          <Link href="/" onClick={handleLogoClick} className="flex items-center">
            <Image
              src="/logos/csc-logo.svg"
              alt="Campus Stores Canada"
              width={160}
              height={100}
              priority
              className="h-9 w-auto"
            />
          </Link>

          <nav className="hidden lg:flex items-center gap-6 text-sm font-medium text-[#4b4b4b]">
            <Link href="/about" className="hover:text-[#1A1A1A]">About</Link>
            <Link href="/members" className="hover:text-[#1A1A1A]">Members</Link>
            <Link href="/partners" className="hover:text-[#1A1A1A]">Partners</Link>
            <Link href="/events" className="hover:text-[#1A1A1A]">Events</Link>
            {conferenceNavHref && (
              <Link href={conferenceNavHref} className="hover:text-[#1A1A1A]">Conference</Link>
            )}
            <Link href="/resources" className="hover:text-[#1A1A1A]">Resources</Link>

            <a href={memberSpaceHref} className="hover:text-[#1A1A1A]">Member Space</a>
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            {showCart ? (
              <Link
                href={authAwareHref(cartHref)}
                className={`relative inline-flex items-center justify-center rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  cartJustUpdated
                    ? "border-[var(--brand-red)] text-[var(--brand-red)] animate-cart-attract"
                    : "border-gray-300 text-gray-700 hover:border-gray-400"
                }`}
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
                  onClick={() => {
                    // If the only unread activity is a single DM, go straight to it
                    const unreadDMs = circleDms.filter(d => d.unreadCount > 0);
                    if (notificationsCount === 0 && unreadDMs.length === 1) {
                      window.location.assign(unreadDMs[0].href);
                      return;
                    }
                    setShowAlertMenu((value) => !value);
                  }}
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
                    <div className="mt-1 grid grid-cols-2 gap-1 rounded-md bg-gray-50 p-1 text-xs">
                      <button
                        type="button"
                        onClick={() => setAlertTab("notifications")}
                        className={`rounded px-2 py-1.5 text-left ${alertTab === "notifications" ? "bg-white text-gray-900 shadow-sm" : "text-gray-600"}`}
                      >
                        Notifications ({notificationsCount})
                      </button>
                      <button
                        type="button"
                        onClick={() => setAlertTab("dms")}
                        className={`rounded px-2 py-1.5 text-left ${alertTab === "dms" ? "bg-white text-gray-900 shadow-sm" : "text-gray-600"}`}
                      >
                        DMs ({dmUnreadCount})
                      </button>
                    </div>

                    <div className="overflow-y-auto max-h-72 mt-1">
                    {alertTab === "notifications" ? (
                      mergedNotificationItems.length > 0 ? (
                        mergedNotificationItems.slice(0, 10).map((alert) => (
                          <a
                            key={alert.id}
                            href={alert.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => {
                              if (alert.source === "Circle") {
                                const id = alert.id.slice(7);
                                fetch("/api/circle/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notificationId: id }) }).catch(() => {});
                              } else if (alert.alertKey && !alert.isRead) {
                                fetch("/api/alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ alertKeys: [alert.alertKey] }) }).catch(() => {});
                                setWebsiteAlerts(prev => prev.map(a => a.id === alert.alertKey ? { ...a, isRead: true } : a));
                                setWebsiteAlertCount(prev => Math.max(0, prev - 1));
                              }
                            }}
                            className={`mt-1 flex items-start gap-2 rounded-md px-2 py-2 hover:bg-gray-50 ${alert.isRead ? "opacity-60" : ""}`}
                          >
                            {!alert.isRead && <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#EE2A2E]" />}
                            {alert.isRead && <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0" />}
                            <div className="min-w-0">
                              <p className="text-[11px] uppercase tracking-wide text-gray-400">{alert.source}</p>
                              <p className={`text-sm ${alert.isRead ? "text-gray-500" : "text-gray-800 font-medium"}`}>{alert.title}</p>
                              {alert.message && <p className="text-xs text-gray-500 line-clamp-2">{alert.message}</p>}
                            </div>
                          </a>
                        ))
                      ) : (
                        <p className="px-2 py-2 text-xs text-gray-500">No notifications.</p>
                      )
                    ) : null}


                    {alertTab === "dms" ? (
                      circleDms.length > 0 ? (
                        [...circleDms].sort((a, b) => b.unreadCount - a.unreadCount).map((dm) => (
                          <a
                            key={dm.uuid}
                            href={dm.href}
                            className={`mt-1 flex items-start gap-2 rounded-md px-2 py-2 hover:bg-gray-50 ${dm.unreadCount === 0 ? "opacity-60" : ""}`}
                          >
                            {dm.unreadCount > 0 && <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#EE2A2E]" />}
                            {dm.unreadCount === 0 && <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0" />}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <p className={`text-sm truncate ${dm.unreadCount > 0 ? "text-gray-800 font-medium" : "text-gray-500"}`}>{dm.name}</p>
                                {dm.unreadCount > 0 && <span className="text-[10px] font-medium text-white bg-[#EE2A2E] rounded-full px-1.5 py-0.5 flex-shrink-0">{dm.unreadCount}</span>}
                              </div>
                              {dm.lastMessage && (
                                <p className="text-xs text-gray-500 truncate">
                                  {dm.lastSender ? `${dm.lastSender}: ` : ""}{dm.lastMessage}
                                </p>
                              )}
                            </div>
                          </a>
                        ))
                      ) : (
                        <p className="px-2 py-2 text-xs text-gray-500">No messages yet.</p>
                      )
                    ) : null}
                    </div>

                    <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2">
                      {notificationsCount > 0 ? (
                        <button
                          type="button"
                          onClick={() => {
                            fetch("/api/circle/notifications", { method: "POST" }).catch(() => {});
                            setCircleNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
                            // Mark website alerts as read
                            const unreadWebsiteKeys = websiteAlerts.filter(a => !a.isRead).map(a => a.id);
                            if (unreadWebsiteKeys.length > 0) {
                              fetch("/api/alerts", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ alertKeys: unreadWebsiteKeys }),
                              }).catch(() => {});
                              setWebsiteAlerts(prev => prev.map(a => ({ ...a, isRead: true })));
                              setWebsiteAlertCount(0);
                            }
                          }}
                          className="text-xs text-gray-500 hover:text-gray-800 transition-colors"
                        >
                          Mark all as read
                        </button>
                      ) : (
                        <span />
                      )}
                      <Link
                        href="/me"
                        className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                        onClick={() => setShowAlertMenu(false)}
                      >
                        Notification settings
                      </Link>
                    </div>
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

                    <Link href="/me/events" onClick={() => setShowUserMenu(false)} className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                      My Events
                    </Link>

                    <Link href="/me/bookmarks" onClick={() => setShowUserMenu(false)} className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                      My Bookmarks
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

                    {partnerOrgAdmin?.organization?.slug ? (
                      <Link
                        href={`/org/${partnerOrgAdmin.organization.slug}#your-market`}
                        onClick={() => setShowUserMenu(false)}
                        className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        My Market
                      </Link>
                    ) : null}

                    {memberOrg?.organization?.slug ? (
                      <Link
                        href={`/org/${memberOrg.organization.slug}#my-suppliers`}
                        onClick={() => setShowUserMenu(false)}
                        className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        My Suppliers
                      </Link>
                    ) : null}

                    {orgAdminOrg ? (
                      <Link
                        href="/org/billing"
                        onClick={() => setShowUserMenu(false)}
                        className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        Billing
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
            ) : isKnownPersona ? (
              // Known member/org admin/admin/partner, signed out — decisive nudge, no join upsell
              <Link href="/login" className="h-8 px-4 bg-[var(--brand-red)] hover:bg-[var(--brand-red-hover)] text-white text-sm font-medium rounded-md flex items-center">
                Sign In
              </Link>
            ) : hadSession ? (
              // Returning visitor with an unrecognized/legacy cookie value — don't know enough to be decisive
              <>
                <Link href="/membership" className="hidden sm:inline text-sm font-medium text-[#6B6B6B] hover:text-[#1A1A1A]">
                  Become a Member
                </Link>
                <Link href="/login" className="h-8 px-4 bg-[var(--brand-red)] hover:bg-[var(--brand-red-hover)] text-white text-sm font-medium rounded-md flex items-center">
                  Sign In
                </Link>
              </>
            ) : (
              // New visitor — no prior session. We genuinely don't know if
              // this is a brand-new prospect or an existing member who's
              // never logged in on this browser, so offer both paths.
              <>
                <Link href="/login" className="hidden sm:inline text-sm font-medium text-[#6B6B6B] hover:text-[#1A1A1A]">
                  Sign In
                </Link>
                <Link href="/membership" className="h-8 px-4 bg-[var(--brand-red)] hover:bg-[var(--brand-red-hover)] text-white text-sm font-medium rounded-md flex items-center">
                  Become a Member
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
              <Link href="/about" className="px-2 py-2 rounded-md hover:bg-gray-50">About</Link>
              <Link href="/members" className="px-2 py-2 rounded-md hover:bg-gray-50">Members</Link>
              <Link href="/partners" className="px-2 py-2 rounded-md hover:bg-gray-50">Partners</Link>
              <Link href="/events" className="px-2 py-2 rounded-md hover:bg-gray-50">Events</Link>
              {conferenceNavHref && (
                <Link href={conferenceNavHref} className="px-2 py-2 rounded-md hover:bg-gray-50">Conference</Link>
              )}
              <Link href="/resources" className="px-2 py-2 rounded-md hover:bg-gray-50">Resources</Link>
              <a href={memberSpaceHref} className="px-2 py-2 rounded-md hover:bg-gray-50">Member Space</a>

              {user ? (
                <>
                  <Link href="/me" className="px-2 py-2 rounded-md hover:bg-gray-50">My Account</Link>
                  <Link href="/me/events" className="px-2 py-2 rounded-md hover:bg-gray-50">My Events</Link>
                  <Link href="/me/bookmarks" className="px-2 py-2 rounded-md hover:bg-gray-50">My Bookmarks</Link>
                  {primaryOrg?.organization?.slug ? (
                    <Link href={`/org/${primaryOrg.organization.slug}`} className="px-2 py-2 rounded-md hover:bg-gray-50">
                      My Organization
                    </Link>
                  ) : null}
                  {orgAdminOrg ? (
                    <Link href="/org/billing" className="px-2 py-2 rounded-md hover:bg-gray-50">
                      Billing
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
              ) : (
                // Unauthenticated — show appropriate CTA
                <div className="pt-2 mt-1 border-t border-gray-100 flex flex-col gap-2">
                  {isKnownPersona ? (
                    <Link
                      href="/login"
                      className="px-3 py-2 rounded-md bg-[var(--brand-red)] text-white text-sm font-medium text-center"
                    >
                      Sign In
                    </Link>
                  ) : hadSession ? (
                    <>
                      <Link
                        href="/login"
                        className="px-3 py-2 rounded-md bg-[var(--brand-red)] text-white text-sm font-medium text-center"
                      >
                        Sign In
                      </Link>
                      <Link
                        href="/membership"
                        className="px-3 py-2 rounded-md text-sm font-medium text-[#6B6B6B] hover:bg-gray-50 text-center"
                      >
                        Become a Member
                      </Link>
                    </>
                  ) : (
                    <>
                      <Link
                        href="/membership"
                        className="px-3 py-2 rounded-md bg-[var(--brand-red)] text-white text-sm font-medium text-center"
                      >
                        Become a Member
                      </Link>
                      <Link
                        href="/login"
                        className="px-3 py-2 rounded-md text-sm font-medium text-[#6B6B6B] hover:bg-gray-50 text-center"
                      >
                        Sign In
                      </Link>
                    </>
                  )}
                </div>
              )}
            </nav>
          </div>
        ) : null}
      </header>
    </>
  );
}
