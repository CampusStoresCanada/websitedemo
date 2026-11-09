import type { Metadata } from "next";
import { resolveSelfCheckIn } from "@/lib/conference/self-check-in-server";
import SelfCheckInPhone from "@/components/conference/SelfCheckInPhone";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Check in | Campus Stores Canada",
  robots: { index: false },
};

/**
 * The link in an attendee's check-in email: checking in from their own phone.
 *
 * ⛔ This is a GET and it RECORDS NOTHING. Outlook's Safe Links opens every
 * emailed link before the attendee does; a page that checked people in on load
 * would check them in from their inbox. The check-in is "Check me in", a
 * server action (lib/actions/self-check-in.ts).
 */
export default async function SelfCheckInPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ctx = await resolveSelfCheckIn(token);

  if (!ctx || ctx.phoneClosedReason === "off") {
    return (
      <Shell title={!ctx ? "This check-in link does not work" : ctx.settings.kiosk ? "Check in when you arrive" : "Check in at the registration desk"}>
        <p className="text-slate-600">
          {!ctx
            ? "It may have been replaced by a newer one. Please see the registration desk."
            : ctx.settings.kiosk
              ? "Hold the QR code in this email up to a self check-in kiosk, or bring it to the registration desk."
              : "Bring this email to the registration desk and staff will check you in."}
        </p>
      </Shell>
    );
  }

  return (
    <Shell title={ctx.firstName ? `Welcome, ${ctx.firstName}` : "Welcome"}>
      <SelfCheckInPhone
        token={token}
        conferenceName={ctx.conferenceName}
        alreadyCheckedIn={Boolean(ctx.checkedInAt)}
        open={ctx.phoneOpen}
      />
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col justify-center px-6 py-12">
      <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
      <div className="mt-3">{children}</div>
    </main>
  );
}
