import Link from "next/link";

/**
 * Independence Defense Network section.
 * Provides resources and information for campus stores facing
 * institutional governance or outsourcing challenges.
 */
export default function IndependenceDefense() {
  return (
    <section className="py-16 md:py-20">
      <div className="max-w-7xl mx-auto px-6">
        <div className="bg-[#1A1A1A] rounded-2xl p-8 md:p-12">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
            <div>
              <h2 className="text-2xl md:text-3xl font-bold text-white tracking-tight mb-4">
                Independence Defense Network
              </h2>
              <p className="text-[#9B9B9B] mb-6 leading-relaxed">
                When campus stores face challenges to their institutional
                independence — from outsourcing proposals to governance changes —
                the CSC Independence Defense Network provides peer support,
                advocacy tools, and expert resources.
              </p>
              <ul className="space-y-3 text-[#9B9B9B] mb-8">
                <li className="flex items-start gap-2">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#D60001] flex-shrink-0" />
                  Peer consultation with stores that have navigated similar
                  challenges
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#D60001] flex-shrink-0" />
                  Template business cases and advocacy materials
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#D60001] flex-shrink-0" />
                  Data-backed arguments for campus-operated stores
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#D60001] flex-shrink-0" />
                  Confidential support network of experienced leaders
                </li>
              </ul>
              <Link
                href="/login"
                className="inline-flex h-12 px-6 items-center bg-[#D60001] hover:bg-[#B00001] text-white font-medium rounded-full transition-all hover:shadow-lg hover:shadow-red-500/25"
              >
                Access IDN Resources
              </Link>
            </div>

            <div className="hidden lg:flex items-center justify-center">
              <div className="w-48 h-48 rounded-full bg-white/5 flex items-center justify-center">
                <svg
                  className="w-24 h-24 text-[#D60001]/60"
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
