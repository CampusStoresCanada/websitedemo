import Link from "next/link";

/**
 * Benchmarking preview for anonymous users.
 * Shows sample/fake data to communicate the value of the benchmarking survey
 * without giving away real data.
 */
export default function BenchmarkingPreview() {
  return (
    <section className="py-16 md:py-20">
      <div className="max-w-7xl mx-auto px-6">
        <h2 className="text-2xl md:text-3xl font-bold text-[#1A1A1A] tracking-tight mb-3">
          Benchmarking Survey
        </h2>
        <p className="text-[#6B6B6B] max-w-2xl mb-10">
          CSC members participate in an annual benchmarking survey that provides
          detailed insights into campus store operations, staffing, and
          financials. Here&apos;s a preview of the kind of data available.
        </p>

        {/* Sample data table */}
        <div className="overflow-x-auto rounded-xl border border-[#E5E5E5] mb-8">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left">
                <th className="px-5 py-3 font-semibold text-[#1A1A1A]">
                  Institution
                </th>
                <th className="px-5 py-3 font-semibold text-[#1A1A1A]">
                  FTE
                </th>
                <th className="px-5 py-3 font-semibold text-[#1A1A1A]">
                  Revenue
                </th>
                <th className="px-5 py-3 font-semibold text-[#1A1A1A]">
                  Staff Count
                </th>
                <th className="px-5 py-3 font-semibold text-[#1A1A1A]">
                  Province
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E5E5]">
              {SAMPLE_DATA.map((row, i) => (
                <tr key={i} className="text-[#6B6B6B]">
                  <td className="px-5 py-3 font-medium text-[#1A1A1A]">
                    {row.name}
                  </td>
                  <td className="px-5 py-3">{row.fte.toLocaleString()}</td>
                  <td className="px-5 py-3">${row.revenue}</td>
                  <td className="px-5 py-3">{row.staff}</td>
                  <td className="px-5 py-3">{row.province}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-slate-50 rounded-xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <p className="font-semibold text-[#1A1A1A]">
              This is sample data for illustration only.
            </p>
            <p className="text-sm text-[#6B6B6B]">
              CSC members can access the real benchmarking dataset for
              comparisons and reporting.
            </p>
          </div>
          <Link
            href="/login"
            className="flex-shrink-0 px-6 py-2.5 bg-[#1A1A1A] text-white text-sm font-medium rounded-full hover:bg-gray-800 transition-colors"
          >
            Sign In to Access
          </Link>
        </div>
      </div>
    </section>
  );
}

const SAMPLE_DATA = [
  {
    name: "Acme University",
    fte: 42000,
    revenue: "12.4M",
    staff: 38,
    province: "Ontario",
  },
  {
    name: "Pacific Coast College",
    fte: 18500,
    revenue: "5.2M",
    staff: 14,
    province: "British Columbia",
  },
  {
    name: "Prairie Technical Institute",
    fte: 8200,
    revenue: "2.1M",
    staff: 8,
    province: "Saskatchewan",
  },
  {
    name: "Atlantic Maritime Academy",
    fte: 5600,
    revenue: "1.8M",
    staff: 6,
    province: "Nova Scotia",
  },
];
