import Link from "next/link";

interface MemberDirectoryTeaserProps {
  memberCount: number;
}

export default function MemberDirectoryTeaser({
  memberCount,
}: MemberDirectoryTeaserProps) {
  return (
    <section className="py-20 md:py-28 bg-[#1A1A1A]">
      <div className="max-w-7xl mx-auto px-6 text-center">
        <h2 className="text-3xl md:text-4xl font-bold text-white tracking-tight mb-4">
          Explore Our {memberCount} Member Institutions
        </h2>
        <p className="text-[#9B9B9B] text-lg max-w-2xl mx-auto mb-10">
          From coast to coast, campus stores of all sizes are part of the CSC
          network. Browse the directory to find members in your province.
        </p>
        <Link
          href="/members"
          className="inline-flex h-14 px-8 items-center bg-[#D60001] hover:bg-[#B00001] text-white text-lg font-medium rounded-full transition-all hover:shadow-lg hover:shadow-red-500/25"
        >
          View Member Directory
        </Link>
      </div>
    </section>
  );
}
