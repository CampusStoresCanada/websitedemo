import type { Metadata } from "next";
import ContactForm from "./ContactForm";

export const metadata: Metadata = {
  title: "Contact | Campus Stores Canada",
  description: "Get in touch with Campus Stores Canada.",
};

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ subject?: string }>;
}) {
  const { subject } = await searchParams;
  const isIDN = subject === "independence-defense";

  return (
    <div className="min-h-screen bg-[#F9F9F9]">
      {/* Header */}
      <div className={`${isIDN ? "bg-[#EE2A2E]" : "bg-[#1A1A1A]"} py-12 md:py-16`}>
        <div className="max-w-2xl mx-auto px-6">
          <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-2">
            Campus Stores Canada
          </p>
          {isIDN ? (
            <>
              <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight">
                Independence Defense Network
              </h1>
              <p className="text-white/80 text-sm mt-3 leading-relaxed max-w-lg">
                If your campus store is facing an outsourcing proposal, a governance review, or pressure
                to close, you don&rsquo;t have to navigate it alone. Tell us what&rsquo;s happening —
                confidentially — and we&rsquo;ll connect you with the right people and data.
              </p>
              <div className="mt-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-white/60 flex-shrink-0" />
                <p className="text-white/60 text-xs">
                  No membership required. Your situation stays private.
                </p>
              </div>
            </>
          ) : (
            <>
              <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight">
                Get in Touch
              </h1>
              <p className="text-[#9B9B9B] text-sm mt-2">
                Questions about membership, events, partnerships, or anything else.
              </p>
            </>
          )}
        </div>
      </div>

      {/* Form */}
      <div className="max-w-2xl mx-auto px-6 py-12">
        <ContactForm isIDN={isIDN} />
      </div>
    </div>
  );
}
