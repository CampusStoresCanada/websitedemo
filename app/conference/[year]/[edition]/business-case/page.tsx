import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { VISIBLE_CONFERENCE_STATUSES } from "@/lib/constants/conference";
import { getViewerContext } from "@/lib/visibility/viewer";
import { hasDraftPreviewAccess } from "@/lib/conference/draft-preview";
import { formatCents, formatDateRange } from "@/lib/utils";
import DraftPreviewBanner from "@/components/conference/DraftPreviewBanner";

export const metadata = { title: "Business Case for Attendance" };

/**
 * Deliberately public, no login required — a delegate forwards this to a
 * director who has no CSC account. Same conference-visibility gating as the
 * main hub page (still tied to a specific edition), but never behind auth.
 */
export default async function BusinessCasePage({
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
    .select("id, name, status, start_date, end_date, location_venue, location_city, location_province")
    .eq("year", parseInt(year, 10))
    .eq("edition_code", edition)
    .maybeSingle();

  const isPublicStatus =
    !!conference && VISIBLE_CONFERENCE_STATUSES.includes(conference.status as (typeof VISIBLE_CONFERENCE_STATUSES)[number]);
  if (!conference || (!isPublicStatus && !canPreviewUnpublished)) {
    notFound();
  }
  const isDraftPreview = canPreviewUnpublished && !isPublicStatus;

  const [{ data: fullConf }, { count: exhibitorCount }] = await Promise.all([
    db
      .from("conference_entities")
      .select("price_cents")
      .eq("conference_id", conference.id)
      .eq("name", "Full Conference Registration")
      .maybeSingle(),
    db
      .from("conference_entities")
      .select("id", { count: "exact", head: true })
      .eq("conference_id", conference.id)
      .eq("kind", "booth")
      .eq("is_for_sale", true),
  ]);

  const venue = [conference.location_venue?.trim(), conference.location_city?.trim(), conference.location_province?.trim()]
    .filter(Boolean)
    .join(", ");
  const dateRange =
    conference.start_date && conference.end_date ? formatDateRange(conference.start_date, conference.end_date) : "Dates coming soon";
  const memberPrice = fullConf?.price_cents != null ? formatCents(fullConf.price_cents) : "$299.00";

  return (
    <div className="mx-auto max-w-3xl px-6 py-12 print:py-0">
      {isDraftPreview && (
        <div className="mb-6 print:hidden">
          <DraftPreviewBanner status={conference.status} />
        </div>
      )}

      <p className="mb-8 text-xs text-[#6B6B6B] print:hidden">
        {viewer.userId
          ? "Tip: use the Share tool (bottom-right) to copy a link, send this to a colleague, or print it for an approval request."
          : "Tip: use the Print button (bottom-right) to save this as a PDF for your approval request."}
      </p>

      <h1 className="text-3xl font-bold tracking-tight text-[#1A1A1A]">Business Case: Attendance at {conference.name}</h1>

      <section className="mt-8">
        <h2 className="text-lg font-bold uppercase tracking-wide text-[#6B6B6B]">Event Details</h2>
        <p className="mt-2 text-[#1A1A1A]">
          {venue}
          <br />
          {dateRange}
          <br />
          {memberPrice}/member (full conference)
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold uppercase tracking-wide text-[#6B6B6B]">Purpose of Attendance</h2>
        <p className="mt-2 text-[#1A1A1A]/90">
          To enhance our store's operational effectiveness, vendor relationships, and strategic alignment with
          institutional goals through participation in Canada's premier campus store conference and trade show.
          Attendance provides direct access to key suppliers, streamlines product sourcing and purchasing, and
          supports professional development through engagement with industry peers.
        </p>
      </section>

      <BulletSection
        title="Benefits for Store Buyers"
        items={[
          <>
            <strong>Access to {exhibitorCount ?? 60}+ Vendors:</strong> Meet directly with suppliers across apparel,
            promotional gifts, supplies, and technology to review extensive product lines in one place for faster,
            more efficient buying.
          </>,
          <>
            <strong>Exclusive Show Specials:</strong> Secure trade-show-only pricing and promotions that can help
            offset the cost of attending.
          </>,
          <>
            <strong>New Vendor & Product Discovery:</strong> Connect with new exhibitors and explore emerging
            products and trends tailored to the campus market.
          </>,
          <>
            <strong>Efficient, Informed Purchasing:</strong> Make multiple buying decisions in a short timeframe,
            reducing research time and improving order accuracy.
          </>,
          <>
            <strong>Professional Development:</strong> Sessions focused on trending products and driving traffic to
            strengthen buying and operational skills.
          </>,
        ]}
      />

      <BulletSection
        title="Benefits for Store Leadership"
        items={[
          <>
            <strong>Leadership Collaboration:</strong> Engage with campus store leaders from across Canada to
            exchange ideas and collaborate on strategies that elevate campus retail.
          </>,
          <>
            <strong>Strategic Planning Insights:</strong> Gain practical strategies to operate smarter and align with
            institutional goals.
          </>,
          <>
            <strong>Professional Development:</strong> Explore new approaches in retail innovation and operational
            excellence.
          </>,
        ]}
      />

      <BulletSection
        title="Overall Store Benefits"
        items={[
          <>
            <strong>Improved Vendor Terms & Relationships:</strong> Strengthen partnerships that lead to better
            pricing, service, and product availability.
          </>,
          <>
            <strong>Operational Efficiency & Innovation:</strong> Apply best practices and new technologies to
            streamline operations.
          </>,
          <>
            <strong>Revenue Growth Potential:</strong> Leverage new product lines and promotions to increase student
            engagement and sales.
          </>,
        ]}
      />

      <BulletSection
        title="Institutional Benefits"
        items={[
          <>
            <strong>Enhanced Student Experience:</strong> A well-stocked, efficiently run campus store supports
            student success and satisfaction.
          </>,
          <>
            <strong>Alignment with Strategic Goals:</strong> Participation supports innovation, service excellence,
            and community engagement.
          </>,
          <>
            <strong>Driving Store Evolution:</strong> Exposure to new retail models and peer innovations keeps the
            store responsive to changing student needs.
          </>,
          <>
            <strong>Staff Development & Retention:</strong> Investing in professional development strengthens
            morale and long-term retention of skilled staff.
          </>,
        ]}
      />

      <BulletSection
        title="Why This Investment Makes Sense"
        items={[
          <>
            <strong>High Return on Investment:</strong> Attendance consolidates vendor negotiations, product
            sourcing, staff development, and strategic planning into a single, efficient event.
          </>,
          <>
            <strong>Cost Offset Potential:</strong> Exclusive vendor deals, show specials, and more informed
            purchasing can directly offset or exceed the cost of attending.
          </>,
          <>
            <strong>Bursary Support:</strong> CSC's goal is to help send a delegate from every member institution —
            registering your institution's general merchandise buyer for the Full Conference qualifies you for a
            share of the delegate travel bursary.
          </>,
          <>
            <strong>Risk of Non-Attendance:</strong> Lost opportunities for vendor relationships and reduced
            competitiveness relative to peer institutions that do attend.
          </>,
        ]}
      />

      <section className="mt-8">
        <h2 className="text-lg font-bold uppercase tracking-wide text-[#6B6B6B]">Recommendation</h2>
        <p className="mt-2 text-[#1A1A1A]/90">
          Approving attendance at {conference.name} represents a strategic investment in the store's continued
          growth and relevance. This event directly supports our ability to serve students effectively, operate with
          efficiency and innovation, and align with institutional priorities.
        </p>
      </section>
    </div>
  );
}

function BulletSection({ title, items }: { title: string; items: React.ReactNode[] }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold uppercase tracking-wide text-[#6B6B6B]">{title}</h2>
      <ul className="mt-2 space-y-2">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 text-[#1A1A1A]/90">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#EE2A2E]" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
