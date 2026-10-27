import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOptionalAuthContext } from "@/lib/auth/guards";
import { resolveBoothScan, resolveEventScan } from "@/lib/conference/check-in-cards";
import { CheckInCardButton } from "@/components/scan/CheckInCardButton";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Check in | Campus Stores Canada",
  robots: { index: false },
};

const at = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", timeZone: "America/Toronto" })
    : "";

/**
 * What a phone opens when it scans a check-in card (lib/conference/check-in-cards.ts).
 *
 * ⛔ Same rules as /scan/[token]: sign-in FIRST, before anything is looked up,
 * and this GET RECORDS NOTHING. It says what will happen; the button does it.
 */
export default async function CheckInCardPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const ctx = await getOptionalAuthContext();
  if (!ctx) redirect(`/login?next=${encodeURIComponent(`/scan/place/${kind}/${id}`)}`);
  if (!/^[0-9a-f-]{36}$/i.test(id) || (kind !== "booth" && kind !== "event")) return <Unknown />;

  const now = new Date();

  if (kind === "booth") {
    const scan = await resolveBoothScan(id, ctx.userId, now);
    if (scan.mode === "unknown") return <Unknown />;
    if (scan.mode === "attendee") {
      return (
        <Shell title={`Your meeting with ${scan.exhibitorName}`}>
          <p className="text-slate-600">{scan.startsAt ? `At ${at(scan.startsAt)}.` : null}</p>
          <div className="mt-6">
            {scan.counted ? (
              <Counted text="You're checked in to this meeting." />
            ) : (
              <CheckInCardButton action="booth" id={id} label="Check me in" doneText="You're checked in to this meeting." />
            )}
          </div>
          <p className="mt-4 text-sm text-slate-500">It shows on your schedule at /me.</p>
        </Shell>
      );
    }
    if (scan.mode === "exhibitor") {
      const toConfirm = scan.delegates.filter((d) => !d.confirmedByYou);
      return (
        <Shell title="Confirm your meeting">
          <p className="text-slate-600">{scan.startsAt ? `Your ${at(scan.startsAt)} meeting:` : "Your meeting now:"}</p>
          <ul className="mt-3 space-y-1">
            {scan.delegates.map((d) => (
              <li key={d.personId} className="text-base text-slate-900">
                {d.name}
                {d.countedByThem ? <span className="ml-2 text-sm text-emerald-700">checked in themselves</span> : null}
                {d.confirmedByYou ? <span className="ml-2 text-sm text-emerald-700">confirmed by you</span> : null}
              </li>
            ))}
          </ul>
          <div className="mt-6">
            {toConfirm.length === 0 ? (
              <Counted text="You've confirmed this meeting." />
            ) : (
              <CheckInCardButton
                action="exhibitor"
                id={id}
                personIds={toConfirm.map((d) => d.personId)}
                label={toConfirm.length === 1 ? `Confirm I met ${toConfirm[0].name}` : "Confirm this meeting"}
                doneText="Meeting confirmed."
              />
            )}
          </div>
        </Shell>
      );
    }
    // No meeting here for them right now: the company at the booth.
    if (scan.orgSlug) redirect(`/org/${scan.orgSlug}?s=b`);
    return (
      <Shell title={`Booth ${scan.boothLabel}`}>
        <p className="text-slate-600">You have no meeting at this booth right now.</p>
      </Shell>
    );
  }

  const scan = await resolveEventScan(id, ctx.userId, now);
  if (scan.mode === "unknown") return <Unknown />;
  if (scan.mode === "outside_window") {
    return (
      <Shell title={scan.eventName}>
        <p className="text-slate-600">
          Check-in is open from {at(scan.opensAt)} to {at(scan.closesAt)} on the day.
        </p>
      </Shell>
    );
  }
  if (scan.mode === "not_registered") {
    return (
      <Shell title={scan.eventName}>
        <p className="text-slate-600">
          You aren&apos;t registered for {scan.conferenceName}. The registration desk can help.
        </p>
      </Shell>
    );
  }
  return (
    <Shell title={scan.eventName}>
      {scan.onTicket ? null : (
        <p className="text-slate-600">This isn&apos;t on your registration. Check in anyway and see the desk after.</p>
      )}
      <div className="mt-6">
        {scan.counted ? (
          <Counted text="You're checked in." />
        ) : (
          <CheckInCardButton action="event" id={id} label="Check me in" doneText="You're checked in." />
        )}
      </div>
      <p className="mt-4 text-sm text-slate-500">It shows on your schedule at /me.</p>
    </Shell>
  );
}

function Counted({ text }: { text: string }) {
  return <p className="rounded-lg bg-emerald-50 px-4 py-3 text-base font-semibold text-emerald-800">✓ {text}</p>;
}

function Unknown() {
  return (
    <Shell title="That check-in card isn't valid">
      <p className="text-slate-600">It may be from another year. The registration desk can help.</p>
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
      <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
      <div className="mt-2">{children}</div>
    </main>
  );
}
