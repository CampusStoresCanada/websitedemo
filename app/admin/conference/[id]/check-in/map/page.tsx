import { requireConferenceDeskAccess } from "@/lib/auth/guards";
import { getFloorPlanForVisitor, type FloorPlanBooth } from "@/lib/actions/conference-entities";
import PrintButton from "@/components/benchmarking/PrintButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Map | Check-in" };

/** Booth numbers sort as numbers where they are numbers: "10" after "9", and "12B" still behaves. */
function boothKey(booth: FloorPlanBooth): string {
  return (booth.number ?? booth.name).trim().toLowerCase().replace(/\d+/g, (d) => d.padStart(8, "0"));
}

function company(booth: FloorPlanBooth): string {
  return booth.soldOrg?.name ?? "";
}

/**
 * The printed map (War Room → What's next): each floor's plan with its booth
 * numbers, then every booth twice — by number, and by company A to Z — so
 * "where is X?" and "who is in 412?" are both one glance.
 *
 * The same floor plan the booth sale and the public map read (_loadFloorPlan);
 * drawn statically here because the interactive viewer zooms, pans and sells,
 * none of which belongs on paper. Booth geometry is stored as fractions of the
 * plan image, so percentages place it exactly at any print size.
 */
export default async function MapPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireConferenceDeskAccess(id);
  if (!auth.ok) return <main className="p-6 text-sm text-red-700">Conference desk access required.</main>;

  const result = await getFloorPlanForVisitor(id);
  if (!result.success || !result.data) {
    return <main className="p-6 text-sm text-red-700">{result.success ? "No floor plan." : result.error}</main>;
  }
  const { surfaces } = result.data;
  // A draft booth is still being laid out: not on the show floor.
  const booths = result.data.booths.filter((b) => b.status !== "draft");
  const firstSurfaceId = surfaces[0]?.id ?? null;
  const placed = booths.filter((b) => b.x !== null && b.y !== null && b.w !== null && b.h !== null);
  const byNumber = [...booths].sort((a, b) => boothKey(a).localeCompare(boothKey(b)));
  const byCompany = booths
    .filter((b) => company(b))
    .sort((a, b) => company(a).localeCompare(company(b)) || boothKey(a).localeCompare(boothKey(b)));

  return (
    <main className="mx-auto max-w-4xl bg-white px-6 py-8 text-gray-900 print:max-w-none print:p-0">
      <style>{`
        @media print {
          header, footer { display: none !important; }
          @page { size: letter; margin: 0.4in; }
          .sheet { break-before: page; }
          .plan { break-inside: avoid; }
        }
      `}</style>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Map</h1>
          <p className="text-sm text-gray-600">
            {booths.length} booths · {byCompany.length} with a company
          </p>
        </div>
        <span className="print:hidden">
          <PrintButton label="Print map" />
        </span>
      </div>

      {surfaces
        .filter((s) => s.imageUrl)
        .map((surface) => {
          const here = placed.filter((b) => (b.surfaceId ?? firstSurfaceId) === surface.id);
          return (
            <section key={surface.id} className="plan mb-8">
              {surfaces.length > 1 ? <h2 className="mb-2 text-lg font-semibold">{surface.name}</h2> : null}
              <div className="relative w-full">
                {/* eslint-disable-next-line @next/next/no-img-element -- a print page: the plain image prints reliably */}
                <img src={surface.imageUrl as string} alt={surface.name} className="block w-full" />
                {here.map((booth) => (
                  <div
                    key={booth.id}
                    className="absolute flex items-center justify-center border border-gray-900 bg-white/80 text-[9px] font-bold leading-none"
                    style={{
                      left: `${(booth.x ?? 0) * 100}%`,
                      top: `${(booth.y ?? 0) * 100}%`,
                      width: `${(booth.w ?? 0) * 100}%`,
                      height: `${(booth.h ?? 0) * 100}%`,
                      transform: booth.rotation ? `rotate(${booth.rotation}deg)` : undefined,
                      transformOrigin: "center",
                    }}
                  >
                    {booth.number ?? ""}
                  </div>
                ))}
              </div>
            </section>
          );
        })}

      <section className="sheet mb-8">
        <h2 className="mb-2 text-lg font-semibold">By booth number</h2>
        <BoothTable rows={byNumber} />
      </section>
      <section className="sheet">
        <h2 className="mb-2 text-lg font-semibold">By company, A to Z</h2>
        <BoothTable rows={byCompany} companyFirst />
      </section>
    </main>
  );
}

function BoothTable({ rows, companyFirst = false }: { rows: FloorPlanBooth[]; companyFirst?: boolean }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b-2 border-gray-900 text-left">
          {companyFirst ? <th className="py-1.5">Company</th> : <th className="w-24 py-1.5">Booth</th>}
          {companyFirst ? <th className="w-24 py-1.5">Booth</th> : <th className="py-1.5">Company</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((booth) => (
          <tr key={booth.id} className="border-b border-gray-300">
            {companyFirst ? (
              <>
                <td className="py-1.5">{company(booth)}</td>
                <td className="py-1.5 font-medium">{booth.number ?? booth.name}</td>
              </>
            ) : (
              <>
                <td className="py-1.5 font-medium">{booth.number ?? booth.name}</td>
                <td className="py-1.5 text-gray-700">{company(booth) || "—"}</td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
