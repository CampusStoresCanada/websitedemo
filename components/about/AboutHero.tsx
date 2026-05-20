import type { SiteContent } from "@/lib/database.types";
import { fieldProps } from "@/lib/editable-fields";

interface AboutHeroProps {
  content: SiteContent | null;
}

const FALLBACK_TITLE = "About Campus Stores Canada";
const FALLBACK_BODY =
  "The national voice for campus retail in Canada — connecting post-secondary bookstores, campus shops, and their vendor partners since 2004.";

export default function AboutHero({ content }: AboutHeroProps) {
  const title = content?.title ?? FALLBACK_TITLE;
  const body = content?.body ?? FALLBACK_BODY;

  return (
    <section className="bg-[#1A1A1A] py-24 md:py-32">
      <div className="max-w-7xl mx-auto px-6">
        <h1
          className="text-4xl md:text-6xl font-bold text-white tracking-tight mb-6"
          {...(content ? fieldProps("site_content", "title", content.id) : {})}
        >
          {title}
        </h1>
        <p
          className="text-xl md:text-2xl text-[#9B9B9B] max-w-3xl leading-relaxed"
          {...(content ? fieldProps("site_content", "body", content.id) : {})}
        >
          {body}
        </p>
      </div>
    </section>
  );
}
