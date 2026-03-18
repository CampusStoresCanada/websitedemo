"use client";

import { useState } from "react";
import Link from "next/link";
import { submitApplication, type PartnerApplicationData } from "@/lib/actions/applications";
import { PROVINCES } from "@/lib/constants/provinces";
import {
  PARTNER_PRIMARY_CATEGORIES,
  PARTNER_SECONDARY_CATEGORIES,
  SECONDARY_TO_PRIMARY,
  type PartnerSecondaryCategory,
} from "@/lib/constants/partner-categories";

export function PartnerApplicationForm() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // Form state
  const [companyName, setCompanyName] = useState("");
  const [streetAddress, setStreetAddress] = useState("");
  const [city, setCity] = useState("");
  const [province, setProvince] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [primaryCategory, setPrimaryCategory] = useState("");
  const [secondaryCategories, setSecondaryCategories] = useState<string[]>([]);
  const [website, setWebsite] = useState("");
  const [phone, setPhone] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [brandInfo, setBrandInfo] = useState("");
  const [companyDescription, setCompanyDescription] = useState("");

  // Filter secondary categories by selected primary
  const filteredSecondary = primaryCategory
    ? PARTNER_SECONDARY_CATEGORIES.filter(
        (sc) => SECONDARY_TO_PRIMARY[sc] === primaryCategory
      )
    : [];

  function toggleSecondary(cat: string) {
    setSecondaryCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  }

  // When primary changes, clear secondary selections that no longer belong
  function handlePrimaryChange(value: string) {
    setPrimaryCategory(value);
    setSecondaryCategories((prev) =>
      prev.filter(
        (sc) =>
          SECONDARY_TO_PRIMARY[sc as PartnerSecondaryCategory] === value
      )
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    const formData: PartnerApplicationData = {
      company_name: companyName.trim(),
      street_address: streetAddress.trim(),
      city: city.trim(),
      province,
      postal_code: postalCode.trim().toUpperCase(),
      primary_category: primaryCategory,
      secondary_categories: secondaryCategories.length > 0 ? secondaryCategories : undefined,
      website: website.trim(),
      phone: phone.trim(),
      contact_name: contactName.trim(),
      contact_email: contactEmail.trim(),
      brand_info: brandInfo.trim() || undefined,
      company_description: companyDescription.trim() || undefined,
    };

    const result = await submitApplication("partner", formData);

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

      {/* Company Info */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-gray-900 mb-1">
          Company Information
        </legend>

        <div>
          <label htmlFor="company-name" className="block text-sm font-medium text-gray-700 mb-1">
            Company name <span className="text-red-500">*</span>
          </label>
          <input
            id="company-name"
            type="text"
            required
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/20 focus:border-[#EE2A2E] transition-colors"
            placeholder="Acme Textbooks Inc."
          />
        </div>

        <div>
          <label htmlFor="street-address" className="block text-sm font-medium text-gray-700 mb-1">
            Street address <span className="text-red-500">*</span>
          </label>
          <input
            id="street-address"
            type="text"
            required
            value={streetAddress}
            onChange={(e) => setStreetAddress(e.target.value)}
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/20 focus:border-[#EE2A2E] transition-colors"
            placeholder="123 Commerce St"
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
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
          <div>
            <label htmlFor="province" className="block text-sm font-medium text-gray-700 mb-1">
              Province <span className="text-red-500">*</span>
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
            <label htmlFor="postal-code" className="block text-sm font-medium text-gray-700 mb-1">
              Postal code <span className="text-red-500">*</span>
            </label>
            <input
              id="postal-code"
              type="text"
              required
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/20 focus:border-[#EE2A2E] transition-colors"
              placeholder="M5V 2T6"
            />
          </div>
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
            placeholder="https://www.example.com"
          />
        </div>

        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">
            Telephone <span className="text-red-500">*</span>
          </label>
          <input
            id="phone"
            type="tel"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/20 focus:border-[#EE2A2E] transition-colors"
            placeholder="(416) 555-0123"
          />
        </div>
      </fieldset>

      {/* Divider */}
      <div className="border-t border-gray-200" />

      {/* Category */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-gray-900 mb-1">
          Product Categories
        </legend>

        <div>
          <label htmlFor="primary-category" className="block text-sm font-medium text-gray-700 mb-1">
            Primary category <span className="text-red-500">*</span>
          </label>
          <select
            id="primary-category"
            required
            value={primaryCategory}
            onChange={(e) => handlePrimaryChange(e.target.value)}
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/20 focus:border-[#EE2A2E] transition-colors bg-white"
          >
            <option value="">Select category…</option>
            {PARTNER_PRIMARY_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        {filteredSecondary.length > 0 && (
          <div>
            <p className="block text-sm font-medium text-gray-700 mb-2">
              Secondary categories <span className="text-xs text-gray-500 font-normal">(optional)</span>
            </p>
            <div className="grid grid-cols-2 gap-2">
              {filteredSecondary.map((cat) => (
                <label
                  key={cat}
                  className={`flex items-center gap-2 p-2 rounded-lg border text-sm cursor-pointer transition-colors ${
                    secondaryCategories.includes(cat)
                      ? "border-[#EE2A2E] bg-red-50 text-gray-900"
                      : "border-gray-200 hover:border-gray-300 text-gray-700"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={secondaryCategories.includes(cat)}
                    onChange={() => toggleSecondary(cat)}
                    className="sr-only"
                  />
                  <div
                    className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                      secondaryCategories.includes(cat)
                        ? "bg-[#EE2A2E] border-[#EE2A2E]"
                        : "border-gray-300"
                    }`}
                  >
                    {secondaryCategories.includes(cat) && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                    )}
                  </div>
                  <span className="text-xs">{cat}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </fieldset>

      {/* Divider */}
      <div className="border-t border-gray-200" />

      {/* Contact */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-gray-900 mb-1">
          Public Contact
        </legend>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="contact-name" className="block text-sm font-medium text-gray-700 mb-1">
              Name <span className="text-red-500">*</span>
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
              placeholder="sales@example.com"
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
          <label htmlFor="brand-info" className="block text-sm font-medium text-gray-700 mb-1">
            Where is the best place to get a feel for your brand?
          </label>
          <input
            id="brand-info"
            type="text"
            value={brandInfo}
            onChange={(e) => setBrandInfo(e.target.value)}
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/20 focus:border-[#EE2A2E] transition-colors"
            placeholder="URL or short description"
          />
        </div>

        <div>
          <label htmlFor="company-desc" className="block text-sm font-medium text-gray-700 mb-1">
            Company description
          </label>
          <textarea
            id="company-desc"
            rows={3}
            value={companyDescription}
            onChange={(e) => setCompanyDescription(e.target.value)}
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/20 focus:border-[#EE2A2E] transition-colors resize-none"
            placeholder="Brief description of your company and products/services…"
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
        Looking to become a member institution instead?{" "}
        <Link href="/apply/member" className="text-[#EE2A2E] hover:text-[#D92327] font-medium">
          Apply as a member
        </Link>
      </p>
    </form>
  );
}
