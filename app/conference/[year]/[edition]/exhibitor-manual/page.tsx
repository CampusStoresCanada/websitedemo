import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { VISIBLE_CONFERENCE_STATUSES } from "@/lib/constants/conference";
import { getViewerContext } from "@/lib/visibility/viewer";
import { hasDraftPreviewAccess } from "@/lib/conference/draft-preview";
import { ENTITY_SELECT, buildEntityGraph } from "@/lib/conference/entity-rows";
import { indexById } from "@/lib/conference/entity-graph";
import { boothTypes } from "@/lib/conference/entity-commerce";
import { loadServiceDetails } from "@/lib/conference/service-details";
import { loadCurrentLegalVersions } from "@/lib/conference/legal-acceptance";
import { parseHotelRates } from "@/lib/conference/hotel";
import { formatConferenceDates } from "@/lib/comms/format";
import DraftPreviewBanner from "@/components/conference/DraftPreviewBanner";
import ScheduleAtAGlance, { TRACK_COLOR, TRACK_LABEL, boothTrack } from "@/components/conference/ScheduleAtAGlance";
import DeadlinesTimeline from "@/components/conference/DeadlinesTimeline";
import HotelInfo from "@/components/conference/HotelInfo";
import ServiceFacts from "@/components/conference/ServiceFacts";

export const metadata = { title: "Exhibitor Manual" };

/**
 * The Exhibitor Manual the Exhibitor & Booth Agreement refers to.
 *
 * Nothing on this page is written here. Every fact is read from where it
 * already lives, through the reader that already shows it somewhere else:
 * the schedule and key dates from the catalog agenda (the hub page's
 * components), each booth's size and contents from the graph the storefront
 * sells from, the hotel from the conference row, the supplier cards from the
 * same loader as a company's to-do list, and the rules from the agreement
 * itself on the Terms page. Change any of them there and this page follows.
 *
 * Public, like the Terms page: the person shipping a booth or standing in it
 * often has no CSC login. The one exception is a form a supplier marked
 * proprietary, which a signed-out reader is asked to sign in for.
 */
export default async function ExhibitorManualPage({
  params,
}: {
  params: Promise<{ year: string; edition: string }>;
}) {
  const { year, edition } = await params;
  const viewer = await getViewerContext();
  const isGlobalAdminViewer = viewer.viewerLevel === "admin" || viewer.viewerLevel === "super_admin";
  const canPreviewUnpublished = isGlobalAdminViewer || hasDraftPreviewAccess(viewer.viewerOrgIds);

  const db = createAdminClient();
  const { data: conference } = await db
    .from("conference_instances")
    .select("id, name, status, start_date, end_date, location_venue, location_city, location_province, location_latitude, location_longitude, hotel_booking_url, hotel_booking_cutoff, hotel_rates, hotel_note")
    .eq("year", parseInt(year, 10))
    .eq("edition_code", edition)
    .maybeSingle();

  const isPublicStatus =
    !!conference && VISIBLE_CONFERENCE_STATUSES.includes(conference.status as (typeof VISIBLE_CONFERENCE_STATUSES)[number]);
  if (!conference || (!isPublicStatus && !canPreviewUnpublished)) {
    notFound();
  }
  const isDraftPreview = canPreviewUnpublished && !isPublicStatus;

  const [{ data: entityRows }, { data: refRows }, servicesById, { data: legal }] = await Promise.all([
    db.from("conference_entities").select(ENTITY_SELECT).eq("conference_id", conference.id),
    db
      .from("conference_entity_refs")
      .select("from_entity_id, to_entity_id, role, quantity")
      .eq("conference_id", conference.id),
    loadServiceDetails(db, { conferenceId: conference.id }),
    loadCurrentLegalVersions(db, conference.id),
  ]);
  const entities = buildEntityGraph(entityRows ?? [], refRows ?? []);
  const booths = boothTypes(indexById(entities));

  // A move-out is scheduled the way move-in is: a session on the agenda. Until
  // one exists, say so, rather than leave a reader to assume there is none.
  const MOVE_OUT = /move[\s-]?out|tear[\s-]?down|dismantl/i;
  const hasMoveOut = entities.some(
    (e) =>
      (e.kind === "session" || e.kind === "event") &&
      (MOVE_OUT.test(e.name) || MOVE_OUT.test(String(e.attributes.format ?? "")))
  );

  // Soonest deadline first: the supplier whose discount runs out next leads.
  const firstDeadline = (s: { deadlines: { date: string }[] }) => s.deadlines[0]?.date ?? "9999";
  const services = [...servicesById.values()].sort((a, b) => firstDeadline(a).localeCompare(firstDeadline(b)));

  const inForce = new Set((legal ?? []).map((d) => d.document_type));
  const termsHref = `/conference/${year}/${edition}/terms`;
  const signInHref =
    viewer.viewerLevel === "public"
      ? `/login?next=${encodeURIComponent(`/conference/${year}/${edition}/exhibitor-manual#suppliers`)}`
      : undefined;

  const venue = [conference.location_venue?.trim(), conference.location_city?.trim(), conference.location_province?.trim()]
    .filter(Boolean)
    .join(", ");
  const dates = formatConferenceDates(conference.start_date, conference.end_date);

  const contents = [
    booths.length > 0 && { id: "booth", label: "Your booth" },
    { id: "schedule", label: "Schedule at a glance" },
    { id: "key_dates", label: "Deadlines & key dates" },
    venue && { id: "hotel", label: "Where you'll be staying" },
    services.length > 0 && { id: "suppliers", label: "Ordering from the show's suppliers" },
    { id: "rules", label: "Rules and insurance" },
  ].filter((c): c is { id: string; label: string } => !!c);

  return (
    <div className="mx-auto max-w-4xl space-y-12 px-6 py-12 print:space-y-8 print:py-0">
      {isDraftPreview && (
        <div className="print:hidden">
          <DraftPreviewBanner status={conference.status} />
        </div>
      )}

      <header>
        <p className="text-sm font-medium uppercase tracking-wide text-[#6B6B6B]">{conference.name}</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-[#1A1A1A]">Exhibitor Manual</h1>
        <p className="mt-2 text-[#1A1A1A]/80">{[dates, venue].filter(Boolean).join(" · ")}</p>
        <p className="mt-4 max-w-2xl text-[#1A1A1A]/80">
          What your team needs to plan your booth: when you can move in, what your booth comes with, where to
          stay, and how to order from the show&rsquo;s suppliers. Share it with whoever is shipping or staffing
          your booth. It stays up to date as plans firm up.
        </p>
        <nav className="mt-6 print:hidden" aria-label="Contents">
          <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {contents.map((c) => (
              <li key={c.id}>
                <a href={`#${c.id}`} className="font-medium text-[#163D6D] underline">
                  {c.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      {booths.length > 0 && (
        <section id="booth" className="scroll-mt-24">
          <h2 className="text-xl font-bold tracking-tight text-[#1A1A1A]">Your booth</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {booths.map((b) => {
              const track = boothTrack(b.priceCents);
              return (
                <div
                  key={b.id}
                  className="rounded-xl border border-gray-200 border-t-4 bg-white p-5 break-inside-avoid"
                  style={{ borderTopColor: TRACK_COLOR[track] }}
                >
                  <h3 className="text-lg font-bold" style={{ color: TRACK_COLOR[track] }}>
                    {TRACK_LABEL[track]} booth
                  </h3>
                  {b.size && <p className="mt-1 text-sm font-semibold text-[#1A1A1A]">{b.size}</p>}
                  {b.pitch && <p className="mt-2 text-sm text-[#1A1A1A]/80">{b.pitch}</p>}
                  {b.includes.length > 0 && (
                    <>
                      <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Comes with</p>
                      <ul className="mt-1 space-y-0.5 text-sm text-[#1A1A1A]">
                        {b.includes.map((i) => (
                          <li key={i.entityId}>
                            {i.quantity > 1 && <span className="font-semibold tabular-nums">{i.quantity} × </span>}
                            {/* A suite's name is its number, which says nothing out of context. */}
                            {i.kind === "suite" ? "Meeting suite" : i.name}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  <p className="mt-3 text-xs text-gray-500">Booths {b.boothNumbers.join(", ")}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section id="schedule" className="scroll-mt-24">
        <ScheduleAtAGlance
          conferenceId={conference.id}
          conferenceStartDate={conference.start_date ?? ""}
          track={null}
        />
        {!hasMoveOut && (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Move-out times haven&rsquo;t been set yet. They&rsquo;ll appear here once they are. Please plan to stay
            set up until the show closes.
          </p>
        )}
      </section>

      <section id="key_dates" className="scroll-mt-24">
        <DeadlinesTimeline
          conferenceId={conference.id}
          conferenceStartDate={conference.start_date ?? ""}
          conferenceEndDate={conference.end_date ?? ""}
          audiences={["Partner"]}
        />
      </section>

      {venue && (
        <section id="hotel" className="scroll-mt-24">
          <HotelInfo
            venue={venue}
            lat={conference.location_latitude}
            lng={conference.location_longitude}
            bookingUrl={conference.hotel_booking_url}
            bookingCutoff={conference.hotel_booking_cutoff}
            rates={parseHotelRates(conference.hotel_rates)}
            note={conference.hotel_note}
          />
        </section>
      )}

      {services.length > 0 && (
        <section id="suppliers" className="scroll-mt-24">
          <h2 className="text-xl font-bold tracking-tight text-[#1A1A1A]">Ordering from the show&rsquo;s suppliers</h2>
          <p className="mt-1 text-sm text-[#6B6B6B]">
            You order these directly from each supplier, not through CSC. Check each one&rsquo;s deadlines:
            ordering late can cost more.
          </p>
          <div className="mt-4 space-y-6">
            {services.map((s) => (
              <div key={s.name} className="break-inside-avoid">
                <h3 className="text-base font-semibold text-[#1A1A1A]">{s.name}</h3>
                {s.what && <p className="text-sm text-[#1A1A1A]/80">{s.what}</p>}
                <ServiceFacts service={s} boothNumbers={[]} signInHref={signInHref} />
              </div>
            ))}
          </div>
        </section>
      )}

      <section id="rules" className="scroll-mt-24">
        <h2 className="text-xl font-bold tracking-tight text-[#1A1A1A]">Rules and insurance</h2>
        <p className="mt-2 text-[#1A1A1A]/80">
          {inForce.has("exhibitor_agreement") ? (
            <a href={`${termsHref}#exhibitor_agreement`} className="font-medium text-[#163D6D] underline">
              The Exhibitor &amp; Booth Agreement
            </a>
          ) : (
            "The Exhibitor & Booth Agreement"
          )}{" "}
          sets out how your booth works: setup and teardown, staffing during show hours, insurance, and refunds.
          {inForce.has("code_of_conduct") && (
            <>
              {" "}Everyone on your team also agrees to the{" "}
              <a href={`${termsHref}#code_of_conduct`} className="font-medium text-[#163D6D] underline">
                Vendor Code of Conduct
              </a>
              .
            </>
          )}
        </p>
        <p className="mt-3 text-[#1A1A1A]/80">
          <span className="font-semibold text-[#1A1A1A]">Insurance:</span> you don&rsquo;t need to send us a
          certificate. When you accept the agreement, you confirm your company carries the liability coverage it
          asks for.
        </p>
      </section>
    </div>
  );
}
