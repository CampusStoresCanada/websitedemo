import { redirect } from "next/navigation";
import { requireAdmin, requireConferenceDeskAccess } from "@/lib/auth/guards";
import { conferenceDeskPathId, isCheckInDeskPath, isEmbedded, isWarRoomPath } from "@/lib/admin/nav";
import AdminBreadcrumbs from "@/components/admin/AdminBreadcrumbs";
import AdminSidebar from "@/components/admin/AdminSidebar";
import { resolveBoardRenewalWindow } from "@/lib/renewal/board-report";
import PresentationBlock from "@/components/presentation/PresentationBlock";
import { headers } from "next/headers";
import { loginPathFromHeaders, REQUEST_PATHNAME_HEADER, REQUEST_SEARCH_HEADER } from "@/lib/auth/request-path";

export const metadata = {
  title: "Admin | Campus Stores Canada",
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = await requireAdmin();
  if (!auth.ok && auth.status === 403) {
    // ⛔ Desk staff who are not global admins reach THEIR conference's desk,
    // and nothing else under /admin (the War Room is CSC staff's). No admin sidebar: its links
    // would all bounce them. The pathname is stamped by proxy.ts and
    // overwritten on every /admin request, and each page checks desk access
    // again itself.
    const requestHeaders = await headers();
    const pathname = requestHeaders.get(REQUEST_PATHNAME_HEADER) ?? "";
    const deskConferenceId = conferenceDeskPathId(pathname);
    if (deskConferenceId) {
      const ops = await requireConferenceDeskAccess(deskConferenceId);
      if (ops.ok) {
        if (ops.ctx.presentationMode) {
          return <PresentationBlock level={ops.ctx.presentationMode} area="The admin area" />;
        }
        if (isCheckInDeskPath(pathname)) return <>{children}</>;
        return <div className="min-h-[calc(100vh-4rem)] px-4 py-8">{children}</div>;
      }
    }
  }
  if (!auth.ok) {
    /*
      401 is "not signed in" and 302s to the login screen; 403 is "signed in,
      not an admin" and goes home, because sending them to login would invite
      them to try different credentials.

      The exact page they asked for comes from proxy.ts, because Next tells a
      layout nothing about the child path. ⛔ This gate fires before each page's
      own guard, so this is the only place under /admin where the destination
      can be made exact — the per-page loginWithNext calls under /admin never
      run for a signed-out visitor. /admin is the fallback for a request that
      somehow arrived without the stamp.
    */
    redirect(
      auth.status === 401
        ? loginPathFromHeaders(await headers(), "/admin")
        : "/",
    );
  }

  // Every page under here reads through createAdminClient(), so the visibility
  // mask never sees them. Shut the whole area rather than let one of them paint
  // live staff data onto a screen share. See components/presentation/.
  if (auth.ctx.presentationMode) {
    return (
      <PresentationBlock level={auth.ctx.presentationMode} area="The admin area" />
    );
  }

  // ⛔ The check-in desk is a full-screen kiosk: no sidebar, no breadcrumbs.
  const requestHeaderList = await headers();
  const requestPathname = requestHeaderList.get(REQUEST_PATHNAME_HEADER) ?? "";
  if (isCheckInDeskPath(requestPathname)) return <>{children}</>;
  // A print sheet inside a War Room Preview: the sheet alone.
  if (isEmbedded(requestHeaderList.get(REQUEST_SEARCH_HEADER) ?? "")) return <>{children}</>;
  // The War Room has its own slim header; the Manage sidebar is noise there.
  if (isWarRoomPath(requestPathname)) return <div className="min-h-[calc(100vh-4rem)]">{children}</div>;

  // Conditions the sidebar cannot resolve itself — it is a client component,
  // and the window comes from the same policy config the reminder and grace
  // crons run on. getRenewalConfig() is cached, so this is not a query per
  // admin page load.
  const conditions = {
    renewalBoardWindow:
      (await resolveBoardRenewalWindow(new Date().toISOString().slice(0, 10))) !== null,
  };

  return (
    <div className="flex min-h-[calc(100vh-4rem)]">
      <AdminSidebar globalRole={auth.ctx.globalRole} conditions={conditions} />
      <div className="flex-1 min-w-0 px-6 py-6">
        <AdminBreadcrumbs />
        {children}
      </div>
    </div>
  );
}
