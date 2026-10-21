import { requireConferenceDeskAccess } from "@/lib/auth/guards";
import { loadCheckInCards } from "@/lib/conference/check-in-cards";
import { qrSvg } from "@/lib/publication/qr";
import PrintButton from "@/components/benchmarking/PrintButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Check-in cards | Check-in" };

/**
 * Every check-in card, ready to print on cardstock (toolkit → Print check-in
 * cards): one per meeting booth, one per event marked "Check-in card: yes" in
 * the Build tab. Two to a letter page. Printed from the browser, like the door
 * list (lib/conference/check-in-cards.ts).
 */
export default async function CheckInCardsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireConferenceDeskAccess(id);
  if (!auth.ok) return <main className="p-6 text-sm text-red-700">Conference desk access required.</main>;

  let cards;
  try {
    cards = await loadCheckInCards(id);
  } catch (error) {
    return (
      <main className="p-6 text-sm text-red-700">
        {error instanceof Error ? error.message : "The check-in cards could not be loaded."}
      </main>
    );
  }
  const withQr = await Promise.all(cards.map(async (card) => ({ ...card, svg: await qrSvg(card.url) })));
  const booths = withQr.filter((c) => c.kind === "booth").length;
  const events = withQr.length - booths;

  return (
    <main className="mx-auto max-w-3xl bg-white px-6 py-8 text-gray-900 print:max-w-none print:p-0">
      <style>{`
        @media print {
          header, footer { display: none !important; }
          @page { size: letter; margin: 0.4in; }
          .card { break-inside: avoid; height: 4.9in; }
          .card:nth-of-type(2n) { break-after: page; }
        }
      `}</style>
      <div className="mb-6 flex items-start justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-bold">Check-in cards</h1>
          <p className="text-sm text-gray-600">
            {booths} booth card{booths === 1 ? "" : "s"} for meetings · {events} event card{events === 1 ? "" : "s"}.
            Two to a page, for cardstock.
          </p>
          <p className="mt-1 text-sm text-gray-600">
            An event gets a card when it is marked &quot;Check-in card: yes&quot; in the Build tab.
          </p>
        </div>
        <PrintButton label="Print cards" />
      </div>
      <div className="space-y-6 print:space-y-0">
        {withQr.map((card) => (
          <section
            key={`${card.kind}:${card.id}`}
            className="card flex flex-col items-center justify-center rounded-xl border-2 border-gray-300 p-6 text-center print:rounded-none print:border-dashed"
          >
            <h2 className="text-4xl font-bold">{card.title}</h2>
            <p className="mt-2 text-lg text-gray-700">{card.subtitle}</p>
            <div
              className="mt-4 w-56 [&_svg]:h-auto [&_svg]:w-full"
              // qrSvg returns a bare <svg> built from our own URL.
              dangerouslySetInnerHTML={{ __html: card.svg }}
            />
            <p className="mt-3 text-sm text-gray-500">Scan with your phone camera and sign in.</p>
          </section>
        ))}
      </div>
    </main>
  );
}
