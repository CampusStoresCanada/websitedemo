import type { Metadata } from "next";
import BenchmarkingPreview from "@/components/resources/BenchmarkingPreview";
import CircleAnnouncementFeed from "@/components/circle/CircleAnnouncementFeed";
import IndependenceDefense from "@/components/resources/IndependenceDefense";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Resources | Campus Stores Canada",
  description:
    "Benchmarking data, community announcements, and advocacy resources for CSC member institutions.",
};

export default function ResourcesPage() {
  return (
    <div>
      {/* Hero */}
      <section className="bg-[#1A1A1A] py-20 md:py-28">
        <div className="max-w-7xl mx-auto px-6">
          <h1 className="text-4xl md:text-5xl font-bold text-white tracking-tight mb-4">
            Resources
          </h1>
          <p className="text-xl text-[#9B9B9B] max-w-2xl">
            Benchmarking data, community discussions, and advocacy tools for
            campus store professionals.
          </p>
        </div>
      </section>

      <BenchmarkingPreview />
      <CircleAnnouncementFeed />
      <IndependenceDefense />
    </div>
  );
}
