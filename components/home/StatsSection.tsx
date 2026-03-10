import type { HomePageStats } from "@/lib/homepage";

export default function StatsSection({ stats }: { stats: HomePageStats }) {

  return (
    <section className="py-24 md:py-32 bg-[#1A1A1A]">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-12 md:gap-8">
          <div className="text-center">
            <div className="text-5xl md:text-6xl font-bold text-white mb-3">
              {stats.activeMembers}
            </div>
            <div className="text-[#9B9B9B]">Member Institutions</div>
          </div>
          <div className="text-center">
            <div className="text-5xl md:text-6xl font-bold text-white mb-3">
              {stats.activePartners}
            </div>
            <div className="text-[#9B9B9B]">Vendor Partners</div>
          </div>
          <div className="text-center">
            <div className="text-5xl md:text-6xl font-bold text-white mb-3">
              {stats.provincesRepresented}
            </div>
            <div className="text-[#9B9B9B]">Provinces & Territories</div>
          </div>
          <div className="text-center">
            <div className="text-5xl md:text-6xl font-bold text-white mb-3">
              {stats.totalFteServed.toLocaleString()}
            </div>
            <div className="text-[#9B9B9B]">Total FTE Served</div>
          </div>
        </div>
      </div>
    </section>
  );
}
