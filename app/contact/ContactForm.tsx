"use client";

import { useState, useTransition } from "react";
import { submitContactInquiry } from "@/lib/actions/contact";

const SUBJECT_OPTIONS = [
  { value: "general",              label: "General inquiry" },
  { value: "membership",           label: "Membership" },
  { value: "events",               label: "Events & conference" },
  { value: "benchmarking",         label: "Benchmarking survey" },
  { value: "partnership",          label: "Vendor partnership" },
  { value: "independence-defense", label: "Independence Defense Network" },
  { value: "other",                label: "Something else" },
];

export default function ContactForm({ isIDN }: { isIDN: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    subject:      isIDN ? "independence-defense" : "general",
    name:         "",
    email:        "",
    organization: "",
    message:      "",
  });

  const set = (field: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await submitContactInquiry({
        ...form,
        is_idn: form.subject === "independence-defense",
      });
      if (result.success) {
        setSubmitted(true);
      } else {
        setError(result.error);
      }
    });
  };

  if (submitted) {
    return (
      <div className="rounded-2xl border border-green-200 bg-green-50 px-8 py-10 text-center">
        <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-lg font-bold text-gray-900 mb-2">Message received</h2>
        {isIDN ? (
          <p className="text-sm text-gray-600 max-w-sm mx-auto">
            A CSC staff member will be in touch — confidentially. If the situation is urgent,
            email us directly at{" "}
            <a href="mailto:info@campusstores.ca" className="text-[#EE2A2E] hover:underline">
              info@campusstores.ca
            </a>
            .
          </p>
        ) : (
          <p className="text-sm text-gray-600">
            We&rsquo;ll be in touch shortly.
          </p>
        )}
      </div>
    );
  }

  const inputClass =
    "w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D] transition-colors";
  const labelClass = "block text-xs font-semibold text-gray-700 mb-1.5";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">

      {/* Subject */}
      {!isIDN && (
        <div>
          <label htmlFor="subject" className={labelClass}>Subject</label>
          <select
            id="subject"
            value={form.subject}
            onChange={set("subject")}
            className={inputClass}
          >
            {SUBJECT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* IDN subject is fixed — show it as read-only context, not a selector */}
      {isIDN && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
          <p className="text-sm font-semibold text-red-800">Independence Defense Network inquiry</p>
          <p className="text-xs text-red-600 mt-0.5">
            Your message is treated as confidential. CSC staff only.
          </p>
        </div>
      )}

      {/* Name + Email side by side on wide screens */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="name" className={labelClass}>Your name <span className="text-red-500">*</span></label>
          <input
            id="name"
            type="text"
            required
            autoComplete="name"
            placeholder="Jane Smith"
            value={form.name}
            onChange={set("name")}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="email" className={labelClass}>Email <span className="text-red-500">*</span></label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            placeholder="jane@university.ca"
            value={form.email}
            onChange={set("email")}
            className={inputClass}
          />
        </div>
      </div>

      {/* Organization */}
      <div>
        <label htmlFor="organization" className={labelClass}>
          Institution or organization
          <span className="ml-1 text-gray-400 font-normal">(optional)</span>
        </label>
        <input
          id="organization"
          type="text"
          autoComplete="organization"
          placeholder="University of Example Bookstore"
          value={form.organization}
          onChange={set("organization")}
          className={inputClass}
        />
      </div>

      {/* Message */}
      <div>
        <label htmlFor="message" className={labelClass}>
          Message <span className="text-red-500">*</span>
        </label>
        {isIDN && (
          <p className="text-xs text-gray-500 mb-2">
            Tell us what&rsquo;s happening — as much or as little as you&rsquo;re comfortable with.
            What&rsquo;s the proposal? What&rsquo;s the timeline? What would be most helpful?
          </p>
        )}
        <textarea
          id="message"
          required
          rows={6}
          placeholder={isIDN ? "What's happening at your institution…" : "How can we help?"}
          value={form.message}
          onChange={set("message")}
          className={`${inputClass} resize-y min-h-[120px]`}
        />
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className={`w-full py-3 px-6 rounded-full font-semibold text-sm text-white transition-colors disabled:opacity-50 ${
          isIDN
            ? "bg-[#EE2A2E] hover:bg-[#D92327]"
            : "bg-[#163D6D] hover:bg-[#0f2d52]"
        }`}
      >
        {isPending ? "Sending…" : isIDN ? "Send Confidential Message" : "Send Message"}
      </button>

      {isIDN && (
        <p className="text-xs text-center text-gray-400">
          No membership required. You won&rsquo;t be added to any mailing list.
        </p>
      )}
    </form>
  );
}
