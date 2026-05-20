import Link from "next/link";
import type { SiteContentWithContact } from "@/lib/data";
import { fieldProps } from "@/lib/editable-fields";

interface IndependenceDefenseProps {
  content: SiteContentWithContact | null;
}

const FALLBACK_TITLE = "Independence Defense Network";
const FALLBACK_BODY =
  "When campus stores face challenges to their institutional independence — from outsourcing proposals to governance changes — the CSC Independence Defense Network provides peer support, advocacy tools, and expert resources.";
const FALLBACK_BULLETS = [
  "Peer consultation with stores that have navigated similar challenges",
  "Template business cases and advocacy materials",
  "Data-backed arguments for campus-operated stores",
  "Confidential support network of experienced leaders",
];
const FALLBACK_CTA = { text: "Access IDN Resources", href: "/login" };

export default function IndependenceDefense({ content }: IndependenceDefenseProps) {
  const titleText = content?.title ?? FALLBACK_TITLE;
  const bodyText = content?.body ?? FALLBACK_BODY;

  // Bullets, cta_text, and cta_href stored in metadata JSON
  const meta = content?.metadata as Record<string, unknown> | null | undefined;
  const bullets = (meta?.bullets as string[] | undefined) ?? FALLBACK_BULLETS;
  const ctaText = (meta?.cta_text as string | undefined) ?? FALLBACK_CTA.text;
  const ctaHref = (meta?.cta_href as string | undefined) ?? FALLBACK_CTA.href;

  return (
    <section className="py-16 md:py-20">
      <div className="max-w-7xl mx-auto px-6">
        <div className="bg-[#1A1A1A] rounded-2xl p-8 md:p-12">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
            <div>
              <h2
                className="text-2xl md:text-3xl font-bold text-white tracking-tight mb-4"
                {...(content ? fieldProps("site_content", "title", content.id) : {})}
              >
                {titleText}
              </h2>
              <p
                className="text-[#9B9B9B] mb-6 leading-relaxed"
                {...(content ? fieldProps("site_content", "body", content.id) : {})}
              >
                {bodyText}
              </p>
              <ul className="space-y-3 text-[#9B9B9B] mb-8">
                {bullets.map((bullet, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#EE2A2E] flex-shrink-0" />
                    {bullet}
                  </li>
                ))}
              </ul>
              <Link
                href={ctaHref}
                className="inline-flex h-12 px-6 items-center bg-[#EE2A2E] hover:bg-[#D92327] text-white font-medium rounded-full transition-all hover:shadow-lg hover:shadow-red-500/25"
              >
                {ctaText}
              </Link>
            </div>

            <div className="hidden lg:flex items-center justify-center">
              <div className="w-48 h-48 rounded-full bg-white/5 flex items-center justify-center">
                <svg
                  className="w-24 h-24 text-[#EE2A2E]/60"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1}
                    d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                  />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
