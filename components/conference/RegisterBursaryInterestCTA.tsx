"use client";

import { useState } from "react";
import { submitBursaryApplication } from "@/lib/actions/conference-bursary";

/**
 * The header CTA for the travel bursary — deliberately just "register
 * interest," not a full application. Qualification criteria aren't decided
 * yet (a board call, not ours to make), so this only collects contact info +
 * optional notes into the existing conference_bursary_applications queue for
 * later human review — nothing here evaluates or promises eligibility.
 */
export default function RegisterBursaryInterestCTA({
  conferenceId,
  organizationId,
  defaultName,
  defaultEmail,
}: {
  conferenceId: string;
  organizationId: string;
  defaultName: string;
  defaultEmail: string;
}) {
  const [state, setState] = useState<"idle" | "open" | "done">("idle");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (state === "done") {
    return (
      <p className="mt-6 inline-flex items-center gap-2 rounded-full bg-white/15 px-5 py-3 text-sm font-medium text-white">
        You&apos;re registered — we&apos;ll be in touch.
      </p>
    );
  }

  if (state === "idle") {
    return (
      <button
        type="button"
        onClick={() => setState("open")}
        className="mt-6 inline-flex h-12 items-center rounded-full bg-white px-6 text-sm font-semibold text-[#163D6D] transition-all hover:shadow-lg hover:shadow-black/10"
      >
        Register your interest →
      </button>
    );
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        setError(null);
        const result = await submitBursaryApplication({
          conferenceId,
          organizationId,
          contactName: name,
          contactEmail: email,
          notes: notes.trim() || undefined,
        });
        setIsSubmitting(false);
        if (result.success) {
          setState("done");
        } else {
          setError(result.error);
        }
      }}
      className="mt-6 max-w-sm rounded-2xl bg-white/10 p-5 backdrop-blur-sm"
    >
      <label
        className="block text-xs font-medium text-white/70"
        htmlFor="bursary-name"
      >
        Your name
      </label>
      <input
        id="bursary-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        className="mt-1 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder-white/40 focus:border-white/50 focus:outline-none"
      />
      <label
        className="mt-3 block text-xs font-medium text-white/70"
        htmlFor="bursary-email"
      >
        Email
      </label>
      <input
        id="bursary-email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        className="mt-1 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder-white/40 focus:border-white/50 focus:outline-none"
      />
      <label
        className="mt-3 block text-xs font-medium text-white/70"
        htmlFor="bursary-notes"
      >
        Anything we should know? (optional)
      </label>
      <textarea
        id="bursary-notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        className="mt-1 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder-white/40 focus:border-white/50 focus:outline-none"
      />
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
      <button
        type="submit"
        disabled={isSubmitting}
        className="mt-3 h-10 w-full rounded-full bg-white text-sm font-semibold text-[#163D6D] transition-opacity disabled:opacity-60"
      >
        {isSubmitting ? "Submitting…" : "Submit"}
      </button>
    </form>
  );
}
