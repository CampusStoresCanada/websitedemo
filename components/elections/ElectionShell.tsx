import Link from "next/link";

/**
 * Shared frame for the member-facing election pages, matching the board vote
 * page it descends from: one card, no chrome, nothing to get lost in. These
 * pages are reached from an email by people who use the site twice a year.
 */
export function ElectionShell({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-12">
      <div className="mx-auto max-w-2xl rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{eyebrow}</p>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-gray-600">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}

export function Notice({
  tone,
  children,
}: {
  tone: "info" | "warning" | "success" | "error";
  children: React.ReactNode;
}) {
  const tones = {
    info: "border-gray-200 bg-gray-50 text-gray-800",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    success: "border-green-200 bg-green-50 text-green-900",
    error: "border-red-200 bg-red-50 text-red-900",
  } as const;
  return <div className={`rounded-lg border p-4 text-sm ${tones[tone]}`}>{children}</div>;
}

/**
 * What still has to happen before this nomination reaches the ballot.
 *
 * Shown to the nominee in full, deliberately: a candidate who does not know
 * their store's permission is outstanding cannot chase it, and the close date is
 * fixed. Nothing here is a criticism — it is a checklist with an owner.
 */
export function OutstandingList({ items }: { items: string[] }) {
  if (items.length === 0)
    return (
      <Notice tone="success">
        <strong>This nomination is complete.</strong> Nothing further is needed from you.
      </Notice>
    );
  return (
    <Notice tone="warning">
      <strong>Still outstanding:</strong>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </Notice>
  );
}

export function SignInPrompt({ returnTo, action }: { returnTo: string; action: string }) {
  return (
    <ElectionShell eyebrow="Campus Stores Canada · Elections" title="Please sign in">
      <p className="text-sm text-gray-600">
        You need to be signed in to {action}. We identify you by your account, not by the link —
        so an email that gets forwarded can never act on your behalf.
      </p>
      <Link
        href={`/login?next=${encodeURIComponent(returnTo)}`}
        className="mt-6 inline-block rounded-lg bg-[#B92026] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#9c1b20]"
      >
        Sign in
      </Link>
    </ElectionShell>
  );
}
