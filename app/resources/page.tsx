import type { Metadata } from "next";
import BenchmarkingPreview from "@/components/resources/BenchmarkingPreview";
import CircleAnnouncementFeed from "@/components/circle/CircleAnnouncementFeed";
import IndependenceDefense from "@/components/resources/IndependenceDefense";
import { getSiteContent } from "@/lib/data";
import { fieldProps } from "@/lib/editable-fields";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Resources | Campus Stores Canada",
  description:
    "Benchmarking data, community announcements, and advocacy resources for CSC member institutions.",
};

export default async function ResourcesPage() {
  const [heroContent, independenceContent] = await Promise.all([
    getSiteContent("resources_hero"),
    getSiteContent("resources_independence_defense"),
  ]);

  const hero = heroContent[0] ?? null;
  const independence = independenceContent[0] ?? null;

  return (
    <div>
      {/* Hero */}
      <section className="bg-[#1A1A1A] py-20 md:py-28">
        <div className="max-w-7xl mx-auto px-6">
          <h1
            className="text-4xl md:text-5xl font-bold text-white tracking-tight mb-4"
            {...(hero ? fieldProps("site_content", "title", hero.id) : {})}
          >
            {hero?.title ?? "Resources"}
          </h1>
          <p
            className="text-xl text-[#9B9B9B] max-w-2xl"
            {...(hero ? fieldProps("site_content", "body", hero.id) : {})}
          >
            {hero?.body ?? "Benchmarking data, community discussions, and advocacy tools for campus store professionals."}
          </p>
        </div>
      </section>

      <BenchmarkingPreview />
      <CircleAnnouncementFeed />
      <IndependenceDefense content={independence} />
    </div>
  );
}
