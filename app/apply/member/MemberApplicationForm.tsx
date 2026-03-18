"use client";

import { useState } from "react";
import Link from "next/link";
import { submitApplication, type MemberApplicationData } from "@/lib/actions/applications";
import { PROVINCES } from "@/lib/constants/provinces";

const INSTITUTION_TYPES = [
  "University Bookstore",
  "College Bookstore",
  "Polytechnic Bookstore",
  "CEGEP Bookstore",
  "Other Campus Retailer",
] as const;

export function MemberApplicationForm() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // Form state
  const [orgName, setOrgName] = useState("");
  const [institutionType, setInstitutionType] = useState("");
  const [website, setWebsite] = useState("");
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactTitle, setContactTitle] = useState("");
  const [reasonToJoin, setReasonToJoin] = useState("");
  const [howHeard, setHowHeard] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    const formData: MemberApplicationData = {
      organization_name: orgName.trim(),
      institution_type: institutionType,
      website: website.trim(),
      province,
      city: city.trim(),
      contact_name: contactName.trim(),
      contact_email: contactEmail.trim(),
      contact_phone: contactPhone.trim(),
      contact_title: contactTitle.trim(),
      reason_to_join: reasonToJoin.trim() || undefined,
      how_heard: howHeard.trim() || undefined,
    };

    const result = await submitApplication("member", formData);

    setIsLoading(false);

    if (!result.success) {
      setError(result.error || "Something went wrong. Please try again.");
      return;
    }

    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="text-center py-6">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-green-50 flex items-center justify-center">
          <svg
            className="w-8 h-8 text-green-500"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75"
            />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          Check your email
        </h2>
        <p className="text-gray-600 text-sm mb-6">
          We&apos;ve sent a verification link to <strong>{contactEmail}</strong>.
          Please click the link to confirm your application.
        </p>
        <p className="text-xs text-gray-500">
          Didn&apos;t receive it? Check your spam folder or{" "}
          <button
            onClick={() => setSubmitted(false)}
            className="text-[#EE2A2E] hover:text-[#D92327] font-medium"
          >
            try again
          </button>
          .
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Organization Info */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-gray-900 mb-1">
          Organization Information
        </legend>

        <div>
          <label htmlFor="org-name" className="block text-sm font-medium text-gray-700 mb-1">
            Organization name <span className="text-red-500">*</span>
          </label>
          <input
            id="org-name"
            type="text"
            required
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/20 focus:border-[#EE2A2E] transition-colors"
            placeholder="e.g. University of Toronto Bookstore"
          />
        </div>

        <div>
          <label htmlFor="institution-type" className="block text-sm font-medium text-gray-700 mb-1">
            Institution type <span className="text-red-500">*</span>
          </label>
          <select
            id="institution-type"
            required
            value={institutionType}
            onChange={(e) => setInstitutionType(e.target.value)}
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/20 focus:border-[#EE2A2E] transition-colors bg-white"
          >
            <option value="">Select type…</option>
            {INSTITUTION_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="website" className="block text-sm font-medium text-gray-700 mb-1">
            Website <span className="text-red-500">*</span>
          </label>
          <input
            id="website"
            type="url"
            required
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/20 focus:border-[#EE2A2E] transition-colors"
            placeholder="https://bookstore.example.ca"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="province" className="block text-sm font-medium text-gray-700 mb-1">
              Province / Territory <span className="text-red-500">*</span>
            </label>
            <select
              id="province"
              required
              value={province}
              onChange={(e) => setProvince(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/20 focus:border-[#EE2A2E] transition-colors bg-white"
            >
              <option value="">Select…</option>
              {PROVINCES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="city" className="block text-sm font-medium text-gray-700 mb-1">
              City <span className="text-red-500">*</span>
            </label>
            <input
              id="city"
              type="text"
              required
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/20 focus:border-[#EE2A2E] transition-colors"
              placeholder="Toronto"
            />
          </div>
        </div>
      </fieldset>

      {/* Divider */}
      <div className="border-t border-gray-200" />

      {/* Contact Info */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-gray-900 mb-1">
          Primary Contact
        </legend>

        <div>
          <label htmlFor="contact-name" className="block text-sm font-medium text-gray-700 mb-1">
            Full name <span className="text-red-500">*</span>
          </label>
          <input
            id="contact-name"
            type="text"
            required
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/20 focus:border-[#EE2A2E] transition-colors"
            placeholder="Jane Smith"
          />
        </div>

        <div>
          <label htmlFor="contact-email" className="block text-sm font-medium text-gray-700 mb-1">
            Email <span className="text-red-500">*</span>
          </label>
          <input
            id="contact-email"
            type="email"
            required
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/20 focus:border-[#EE2A2E] transition-colors"
            placeholder="jane@bookstore.example.ca"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="contact-phone" className="block text-sm font-medium text-gray-700 mb-1">
              Phone <span className="text-red-500">*</span>
            </label>
            <input
              id="contact-phone"
              type="tel"
              required
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/20 focus:border-[#EE2A2E] transition-colors"
              placeholder="(416) 555-0123"
            />
          </div>
          <div>
            <label htmlFor="contact-title" className="block text-sm font-medium text-gray-700 mb-1">
              Job title <span className="text-red-500">*</span>
            </label>
            <input
              id="contact-title"
              type="text"
              required
              value={contactTitle}
              onChange={(e) => setContactTitle(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/20 focus:border-[#EE2A2E] transition-colors"
              placeholder="Store Manager"
            />
          </div>
        </div>
      </fieldset>

      {/* Divider */}
      <div className="border-t border-gray-200" />

      {/* Optional */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-gray-900 mb-1">
          Additional Information
        </legend>

        <div>
          <label htmlFor="reason" className="block text-sm font-medium text-gray-700 mb-1">
            Why do you want to join CSC?
          </label>
          <textarea
            id="reason"
            rows={3}
            value={reasonToJoin}
            onChange={(e) => setReasonToJoin(e.target.value)}
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/20 focus:border-[#EE2A2E] transition-colors resize-none"
            placeholder="Tell us about your goals and what you hope to gain from membership…"
          />
        </div>

        <div>
          <label htmlFor="how-heard" className="block text-sm font-medium text-gray-700 mb-1">
            How did you hear about us?
          </label>
          <input
            id="how-heard"
            type="text"
            value={howHeard}
            onChange={(e) => setHowHeard(e.target.value)}
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/20 focus:border-[#EE2A2E] transition-colors"
            placeholder="Referral, conference, web search…"
          />
        </div>
      </fieldset>

      <button
        type="submit"
        disabled={isLoading}
        className="w-full py-2.5 bg-[#EE2A2E] text-white text-sm font-medium rounded-lg hover:bg-[#D92327] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isLoading ? "Submitting…" : "Submit Application"}
      </button>

      <p className="text-xs text-gray-500 text-center">
        Looking to become a vendor partner instead?{" "}
        <Link href="/apply/partner" className="text-[#EE2A2E] hover:text-[#D92327] font-medium">
          Apply as a partner
        </Link>
      </p>
    </form>
  );
}
