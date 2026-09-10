/**
 * The baseline renderer: displays a ComposedPublication on screen, and
 * paginates for print with CSS Paged Media.
 *
 * This is the MVP renderer and it is not optional — whoever boots this up gets a
 * real, printable directory with no external tooling, no Adobe seat and no PDF
 * service. Pro exporters (InDesign/IDML, Canva) are an upgrade path over the
 * SAME composed data, never a dependency this leans on.
 *
 * Print comes from `@page` + `@media print` rules rather than a second
 * component, so the two outputs cannot drift: one composition, one markup, two
 * stylesheets. "Print to PDF" in any browser produces the directory.
 *
 * The floor plan is inline SVG over the uploaded background at fractional
 * coordinates, so it is resolution-independent — the map costs nothing extra to
 * put on paper.
 */

import { styleShowsQr } from "@/lib/publication/composition";
import type {
  ComposedPerson,
  PublicationAd,
  ComposedEntry,
  ComposedPublication,
  ComposedSection,
  ListingStyle,
  PlacedThing,
  SurfaceForPublication,
} from "@/lib/publication/composition";

const VIEW_W = 1000;
const VIEW_H = 620;

export default function PublicationView({ doc }: { doc: ComposedPublication }) {
  return (
    <article className="pub">
      <PublicationStyles doc={doc} />
      <header className="pub-cover" style={{ page: "cover" } as React.CSSProperties}>
        <p className="pub-eyebrow">Campus Stores Canada</p>
        <h1 className="pub-title">{doc.title}</h1>
        <p className="pub-sub">
          {doc.entries.length} {doc.entries.length === 1 ? "listing" : "listings"}
        </p>
      </header>

      {doc.sections.map((section, i) => (
        <Section key={`${section.type}-${i}`} section={section} pageName={pageNameFor(i)} />
      ))}
    </article>
  );
}

/**
 * Each section gets its own named page so it can carry its own running head.
 *
 * The obvious approach — `string-set` on the heading, `content: string(...)` in
 * the margin box — is unsupported in Chrome: the declaration is dropped at parse
 * time, silently, and you get blank running heads with no error. Named pages
 * are supported, so the rules are generated per section instead, from the real
 * titles rather than hardcoded strings that would drift when a section is
 * renamed.
 */
const pageNameFor = (index: number) => `sec${index}`;

/** CSS string literal — a stray quote in an admin-authored title kills the rule. */
function cssString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

const sectionClass = (section: ComposedSection) =>
  isEmptySection(section) ? "pub-section pub-section--empty" : "pub-section";

/**
 * Does this section have anything in it?
 *
 * On screen an empty section is USEFUL — "Nobody listed" tells an admin the
 * consent answers have not come in yet. On paper it is a defect: a page with a
 * heading and the words "Nobody listed" is worse than no page. Same markup,
 * different treatment, which is the whole reason both outputs share one
 * component.
 */
function isEmptySection(section: ComposedSection): boolean {
  switch (section.type) {
    case "listings":       return section.groups.every((g) => g.entries.length === 0);
    case "people":         return section.people.length === 0;
    case "category_index": return section.departments.length === 0;
    case "booth_index":    return section.booths.length === 0;
    case "map":            return section.surfaces.length === 0;
    // A slot with no artwork is NOT empty — it is reserved space, and seeing it
    // is how a book gets laid out before the space is sold.
    case "ads":            return section.ads.length === 0;
    case "static":         return !section.body.trim();
  }
}

function Section({ section, pageName }: { section: ComposedSection; pageName: string }) {
  switch (section.type) {
    case "static":
      return (
        <section className={sectionClass(section)} style={{ page: pageName } as React.CSSProperties}>
          <h2 className="pub-h2">{section.title}</h2>
          <p className="pub-body">{section.body}</p>
        </section>
      );

    case "map":
      return (
        <section className={sectionClass(section)} style={{ page: pageName } as React.CSSProperties}>
          <h2 className="pub-h2">{section.title}</h2>
          {section.surfaces.length === 0 ? (
            <p className="pub-empty">No floor plan available.</p>
          ) : (
            section.surfaces.map(({ surface, placements }) => (
              <SurfaceMap key={surface.id} surface={surface} placements={placements} />
            ))
          )}
        </section>
      );

    case "category_index":
      return (
        <section className={sectionClass(section)} style={{ page: pageName } as React.CSSProperties}>
          <h2 className="pub-h2">{section.title}</h2>
          {section.departments.length === 0 ? (
            <p className="pub-empty">No categories to index.</p>
          ) : (
            <div className="pub-index">
              {section.departments.map((d) => (
                <div key={d.department} className="pub-index-block">
                  <h3 className="pub-h3">{d.department}</h3>
                  <ul className="pub-index-list">
                    {d.entries.map((e) => (
                      <li key={e.orgId}>
                        {e.orgName}
                        {e.boothNumbers.length > 0 ? (
                          <span className="pub-booth-ref">{e.boothNumbers.join(", ")}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      );

    case "booth_index":
      return (
        <section className={sectionClass(section)} style={{ page: pageName } as React.CSSProperties}>
          <h2 className="pub-h2">{section.title}</h2>
          {section.booths.length === 0 ? (
            <p className="pub-empty">No booths assigned yet.</p>
          ) : (
            <table className="pub-table">
              <tbody>
                {section.booths.map(({ booth, entry }) => (
                  <tr key={`${booth}-${entry.orgId}`}>
                    <td className="pub-td-booth">{booth}</td>
                    <td>{entry.orgName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      );

    case "people":
      return (
        <section className={sectionClass(section)} style={{ page: pageName } as React.CSSProperties}>
          <h2 className="pub-h2">{section.title}</h2>
          {section.people.length === 0 ? (
            <p className="pub-empty">Nobody listed.</p>
          ) : (
            <div className="pub-people">
              {section.people.map((p, i) => (
                <PersonRow key={`${p.name}-${p.orgCode}-${i}`} person={p} />
              ))}
            </div>
          )}
        </section>
      );

    case "ads":
      return (
        <section className={sectionClass(section)} style={{ page: pageName } as React.CSSProperties}>
          <h2 className="pub-h2 pub-ads-heading">{section.title}</h2>
          <div className="pub-ads">
            {section.ads.map((ad, i) => (
              <AdSlot key={`${ad.size}-${ad.advertiser ?? "open"}-${i}`} ad={ad} />
            ))}
          </div>
        </section>
      );

    case "listings":
      return (
        <section className={sectionClass(section)} style={{ page: pageName } as React.CSSProperties}>
          <h2 className="pub-h2">{section.title}</h2>
          {section.groups.length === 0 ? (
            <p className="pub-empty">No listings.</p>
          ) : (
            section.groups.map((g, gi) => (
              <div key={g.heading ?? gi} className="pub-group">
                {g.heading ? <h3 className="pub-h3 pub-group-head">{g.heading}</h3> : null}
                <div className={`pub-listings pub-listings--${section.style}`}>
                  {g.entries.map((e) => (
                    <Listing key={`${g.heading}-${e.orgId}`} entry={e} style={section.style} />
                  ))}
                </div>
              </div>
            ))
          )}
        </section>
      );
  }
}

function PersonRow({ person }: { person: ComposedPerson }) {
  return (
    <div className="pub-person">
      <span className="pub-person-name">{person.name}</span>
      {person.roleTitle ? <span className="pub-person-role">{person.roleTitle}</span> : null}
      <span className="pub-person-org">{person.orgName}</span>
      <span className="pub-person-reach">
        {[person.phone, person.email].filter(Boolean).join(" · ")}
      </span>
    </div>
  );
}

/**
 * One organisation, in one of three shapes.
 *
 * The shapes are not "the same card with bits hidden" — they answer different
 * questions. An exhibitor listing is a pitch: it has the room for a description,
 * a featured product and a booth number because the reader is deciding whether
 * to walk over. A partner who isn't at the show needs to be *findable*, so it
 * keeps identity and categories and drops the show-specific selling. A member
 * store isn't selling anything, so none of that applies: what matters is where
 * it is, how big it is, and who works there.
 */
function Listing({ entry, style = "full" }: { entry: ComposedEntry; style?: ListingStyle }) {
  const qr = entry.qrSvg && styleShowsQr(style) ? (
    <span className="pub-qr" aria-hidden="true" dangerouslySetInnerHTML={{ __html: entry.qrSvg }} />
  ) : null;

  if (style === "member") {
    // Scale, then place, then people. A buyer scanning this page is sizing up
    // the store before deciding who to call.
    const scale = [entry.institutionType, entry.fte ? `${entry.fte.toLocaleString()} FTE` : null]
      .filter(Boolean)
      .join(" · ");
    const place = [entry.city, entry.province].filter(Boolean).join(", ");

    return (
      <div className="pub-listing pub-listing--member">
        <div className="pub-listing-head">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {entry.logoUrl ? <img className="pub-logo pub-logo-sm" src={entry.logoUrl} alt="" /> : null}
          <div className="pub-listing-id">
            <h4 className="pub-org">{entry.orgName}</h4>
            {place ? <p className="pub-place">{place}</p> : null}
          </div>
        </div>

        {scale ? <p className="pub-scale">{scale}</p> : null}

        <p className="pub-reach">
          {[entry.website ? cleanUrl(entry.website) : null, entry.orgPhone].filter(Boolean).join(" · ")}
        </p>

        {/* Names and roles only. Phone and email for every one of these people
            live in the People section, which is the part of the book built for
            looking someone up — repeating them here would cost pages to say
            the same thing twice. */}
        {entry.contacts.length > 0 ? (
          <ul className="pub-staff">
            {entry.contacts.map((c, i) => (
              <li key={`${c.name}-${c.roleTitle ?? ""}-${i}`}>
                <span className="pub-staff-name">{c.name}</span>
                {c.roleTitle ? <span className="pub-staff-role">{c.roleTitle}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}

        {qr ? <div className="pub-listing-foot"><span />{qr}</div> : null}
      </div>
    );
  }

  const compact = style === "compact";

  return (
    <div className={compact ? "pub-listing pub-listing--compact" : "pub-listing"}>
      <div className="pub-listing-head">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {entry.logoUrl ? <img className="pub-logo" src={entry.logoUrl} alt="" /> : <div className="pub-logo pub-logo-empty" />}
        <div className="pub-listing-id">
          <h4 className="pub-org">{entry.orgName}</h4>
          {entry.boothNumbers.length > 0 ? (
            <p className="pub-booths">
              Booth{entry.boothNumbers.length > 1 ? "s" : ""} {entry.boothNumbers.join(", ")}
            </p>
          ) : null}
        </div>
      </div>

      {entry.description ? (
        <p className={compact ? "pub-desc pub-desc--clamp" : "pub-desc"}>{entry.description}</p>
      ) : null}

      {/* "Featured" means a conference special. A partner who isn't exhibiting
          has nothing to feature, so the compact shape drops it entirely rather
          than printing last year's. */}
      {!compact && entry.featuredProduct ? (
        <p className="pub-featured">
          <span className="pub-featured-label">Featured</span> {entry.featuredProduct}
          {entry.featuredProductDetail ? ` — ${entry.featuredProductDetail}` : ""}
        </p>
      ) : null}

      {entry.primaryContact ? (
        <p className="pub-contact">
          <span className="pub-contact-name">{entry.primaryContact.name}</span>
          {entry.primaryContact.roleTitle ? `, ${entry.primaryContact.roleTitle}` : ""}
          {entry.primaryContact.phone ? ` · ${entry.primaryContact.phone}` : ""}
          {entry.primaryContact.email ? ` · ${entry.primaryContact.email}` : ""}
        </p>
      ) : entry.publicEmail || entry.publicPhone ? (
        // Nobody has agreed to be named, but the ORGANISATION has affirmed a
        // public-record contact. That is the company's own decision to publish,
        // and needs nobody's personal permission — unlike the raw email column,
        // which is a named person's address in most rows and is never used here.
        <p className="pub-contact">
          {[entry.publicPhone, entry.publicEmail].filter(Boolean).join(" · ")}
        </p>
      ) : null}

      {entry.classes.length > 0 ? <p className="pub-classes">{entry.classes.join(" · ")}</p> : null}

      <div className="pub-listing-foot">
        {entry.catalogueUrl ? <p className="pub-link">{cleanUrl(entry.catalogueUrl)}</p> : <span />}
        {qr}
      </div>
    </div>
  );
}

/**
 * One advertising slot.
 *
 * Artwork is placed with `object-fit: contain` rather than stretched: an
 * advertiser's supplied file will not match the slot ratio exactly, and
 * distorting somebody's paid artwork is worse than leaving a margin.
 *
 * An unsold slot renders as a labelled outline. That is deliberate — ad space
 * is sold against a page count, so the book must be layoutable before anything
 * is sold.
 */
function AdSlot({ ad }: { ad: PublicationAd }) {
  const label = ad.size === "full" ? "Full page" : ad.size === "half" ? "Half page" : "Quarter page";
  return (
    <figure className={`pub-ad pub-ad--${ad.size}`}>
      {ad.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="pub-ad-art" src={ad.imageUrl} alt={ad.alt ?? (ad.advertiser ? `Advertisement — ${ad.advertiser}` : "Advertisement")} />
      ) : (
        <div className="pub-ad-open">
          <span className="pub-ad-size">{label}</span>
          <span className="pub-ad-note">available</span>
        </div>
      )}
      {ad.imageUrl && ad.advertiser ? (
        <figcaption className="pub-ad-credit">{ad.advertiser}</figcaption>
      ) : null}
    </figure>
  );
}

/** Printed links are read, not clicked — drop the scheme and any trailing slash. */
function cleanUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function SurfaceMap({ surface, placements }: { surface: SurfaceForPublication; placements: PlacedThing[] }) {
  return (
    <figure className="pub-map">
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="pub-map-svg" role="img"
           aria-label={`Floor plan: ${surface.name}`}>
        {surface.imageUrl ? (
          <image href={surface.imageUrl} x={0} y={0} width={VIEW_W} height={VIEW_H} preserveAspectRatio="none" />
        ) : (
          <rect x={0} y={0} width={VIEW_W} height={VIEW_H} fill="#f5f4f1" />
        )}
        {placements.map((p) => {
          const x = p.x * VIEW_W;
          const y = p.y * VIEW_H;
          const w = p.w * VIEW_W;
          const h = p.h * VIEW_H;
          return (
            <g key={p.entityId}
               transform={p.rotation ? `rotate(${p.rotation} ${x + w / 2} ${y + h / 2})` : undefined}>
              <rect x={x} y={y} width={w} height={h} rx={2}
                    fill={p.orgName ? "#163D6D" : "#ffffff"}
                    stroke="#163D6D" strokeWidth={1} />
              <text x={x + w / 2} y={y + h / 2} textAnchor="middle" dominantBaseline="central"
                    fontSize={Math.max(7, Math.min(w, h) * 0.42)}
                    fill={p.orgName ? "#ffffff" : "#163D6D"} fontWeight={600}>
                {p.label}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="pub-map-caption">
        {surface.name}
        <span className="pub-map-legend">
          <span className="pub-swatch pub-swatch-sold" /> exhibiting
          <span className="pub-swatch pub-swatch-open" /> available
        </span>
      </figcaption>
    </figure>
  );
}

/**
 * Scoped styles, inline so the renderer is self-contained and one file governs
 * both outputs. `@page` + `@media print` is the whole print pipeline: no
 * toolchain, no service, no per-render cost.
 */
function PublicationStyles({ doc }: { doc: ComposedPublication }) {
  // Per-section running heads, from the real titles.
  const sectionPages = doc.sections
    .map((section, i) => `
        @page ${pageNameFor(i)} { @top-right { content: ${cssString(section.title)}; font: 8pt sans-serif; color: #999; } }`)
    .join("");
  return (
    <style>{`
      .pub {
        --ink: #1A1A1A; --muted: #6B7280; --line: #E5E7EB; --navy: #163D6D;
        max-width: 60rem; margin: 0 auto; padding: 2rem 1.25rem 4rem;
        color: var(--ink);
        font: 15px/1.6 Calibri, 'Segoe UI', -apple-system, 'Helvetica Neue', Arial, sans-serif;
      }
      .pub-eyebrow { margin: 0; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
      .pub-title { margin: .25rem 0 .25rem; font-size: 2rem; color: var(--navy); }
      .pub-sub { margin: 0; color: var(--muted); font-size: .875rem; }
      .pub-cover { border-bottom: 3px solid var(--navy); padding-bottom: 1.25rem; margin-bottom: 2rem; }
      .pub-section { margin-bottom: 2.5rem; }
      .pub-h2 { font-size: 1.25rem; color: var(--navy); border-bottom: 1px solid var(--line);
                padding-bottom: .35rem; margin: 0 0 1rem; }
      .pub-h3 { font-size: .8rem; text-transform: uppercase; letter-spacing: .06em;
                color: var(--muted); margin: 0 0 .5rem; }
      .pub-empty { color: var(--muted); font-style: italic; }
      .pub-body { margin: 0; }

      .pub-index { columns: 2; column-gap: 2rem; }
      .pub-index-block { break-inside: avoid; margin-bottom: 1rem; }
      .pub-index-list { margin: 0; padding-left: 1rem; font-size: .875rem; }
      .pub-index-list li { margin-bottom: .15rem; }
      .pub-booth-ref { color: var(--muted); font-size: .8125rem; margin-left: .4rem; }

      .pub-table { width: 100%; border-collapse: collapse; font-size: .875rem; }
      .pub-table tr { border-bottom: 1px solid var(--line); break-inside: avoid; }
      .pub-table td { padding: .35rem .5rem; }
      .pub-td-booth { font-weight: 700; color: var(--navy); width: 5rem; }

      .pub-group { margin-bottom: 1.75rem; }
      .pub-group-head { border-top: 1px solid var(--line); padding-top: .6rem; }
      .pub-listings { display: grid; grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr)); gap: 1rem; }
      .pub-listing { border: 1px solid var(--line); border-radius: 6px; padding: .85rem;
                     break-inside: avoid; }
      .pub-listing-head { display: flex; gap: .6rem; align-items: center; margin-bottom: .5rem; }
      .pub-logo { width: 2.75rem; height: 2.75rem; object-fit: contain; flex: none; }
      .pub-logo-empty { background: #F5F4F1; border-radius: 4px; }
      .pub-org { margin: 0; font-size: .95rem; }
      .pub-booths { margin: 0; font-size: .8125rem; color: var(--navy); font-weight: 600; }
      .pub-desc { margin: 0 0 .4rem; font-size: .8125rem; color: #374151; }
      .pub-featured { margin: 0 0 .3rem; font-size: .8125rem; }
      .pub-featured-label { font-size: .6875rem; text-transform: uppercase; letter-spacing: .05em;
                            color: var(--muted); margin-right: .25rem; }
      .pub-classes { margin: 0 0 .3rem; font-size: .75rem; color: var(--muted); }
      .pub-link { margin: 0; font-size: .75rem; color: var(--navy); word-break: break-all; }
      .pub-contact { margin: 0 0 .3rem; font-size: .8125rem; color: #374151; }
      /* People index — dense by design. This section is scanned for a name,
         not read, so it wants many short rows rather than cards. */
      .pub-people { columns: 2; column-gap: 2rem; font-size: .8125rem; }
      .pub-person { break-inside: avoid; margin-bottom: .5rem; display: flex;
                    flex-direction: column; line-height: 1.35; }
      .pub-person-name { font-weight: 600; }
      .pub-person-role { color: var(--muted); }
      .pub-person-org { color: var(--navy); font-weight: 600; }
      .pub-person-reach { color: var(--muted); word-break: break-word; }
      .pub-contact-name { font-weight: 600; color: var(--ink); }

      /* Compact — partners who aren't exhibiting. Narrower columns fit more per
         page, and the description is clamped so one verbose company can't take
         four times the space of its neighbours. */
      .pub-listings--compact { grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr)); }
      .pub-listing--compact { padding: .65rem; }
      .pub-desc--clamp { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical;
                         overflow: hidden; }

      /* Member — a store at a glance. Denser again: these carry no prose, so
         the grid can go narrower still. */
      .pub-listings--member { grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr)); }
      .pub-listing--member { padding: .65rem; }
      .pub-logo-sm { width: 2rem; height: 2rem; }
      .pub-place { margin: 0; font-size: .8125rem; color: var(--muted); }
      .pub-scale { margin: 0 0 .3rem; font-size: .75rem; color: var(--navy); font-weight: 600; }
      .pub-reach { margin: 0 0 .35rem; font-size: .75rem; color: #374151; word-break: break-word; }
      .pub-staff { margin: 0; padding: 0; list-style: none; font-size: .75rem; line-height: 1.4; }
      .pub-staff li { margin-bottom: .1rem; }
      .pub-staff-name { font-weight: 600; }
      /* Role follows the name inline rather than being pushed to the far edge:
         justified columns were breaking short names across two lines. */
      .pub-staff-role { color: var(--muted); }
      .pub-staff-role::before { content: ", "; }
      /* The QR sits with the links, small and out of the way. It is the thing
         that keeps this page useful after the book is frozen, but it should
         never dominate a listing. */
      .pub-listing-foot { display: flex; align-items: flex-end; justify-content: space-between; gap: .5rem; }
      .pub-qr { display: block; width: 3.25rem; height: 3.25rem; flex: none; }
      .pub-qr svg { width: 100%; height: 100%; display: block; }

      /* ── Advertising ─────────────────────────────────────────────────
         Slots are sized by ratio on screen and in real millimetres for print,
         because what is being sold is an area on a page, not a proportion of a
         browser window. */
      /* Grid, not flex. Two "50% minus a gap" flex items total exactly the row
         width, and sub-pixel rounding tips them over into wrapping one per
         line — which silently turns a quarter page into a half page. A two
         column grid states the intent instead of computing it. */
      .pub-ads { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; align-items: start; }
      .pub-ad { margin: 0; border: 1px solid var(--line); border-radius: 4px; overflow: hidden;
                background: #fff; display: flex; flex-direction: column; }
      .pub-ad--full    { grid-column: 1 / -1; aspect-ratio: 8.5 / 11; }
      .pub-ad--half    { grid-column: 1 / -1; aspect-ratio: 17 / 11; }
      .pub-ad--quarter { grid-column: span 1; aspect-ratio: 17 / 22; }
      .pub-ad-art { width: 100%; height: 100%; object-fit: contain; display: block; }
      .pub-ad-open { flex: 1; display: flex; flex-direction: column; align-items: center;
                     justify-content: center; gap: .2rem; background: #FAFAF8;
                     border: 1px dashed var(--line); margin: 3px; border-radius: 3px; }
      .pub-ad-size { font-size: .8125rem; font-weight: 700; color: var(--navy); }
      .pub-ad-note { font-size: .6875rem; text-transform: uppercase; letter-spacing: .08em;
                     color: var(--muted); }
      .pub-ad-credit { font-size: .6875rem; color: var(--muted); padding: .25rem .4rem;
                       border-top: 1px solid var(--line); }

      .pub-map { margin: 0 0 1rem; }
      .pub-map-svg { width: 100%; height: auto; border: 1px solid var(--line); border-radius: 6px; background: #fff; }
      .pub-map-caption { margin-top: .4rem; font-size: .8125rem; color: var(--muted);
                         display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
      .pub-map-legend { display: inline-flex; gap: .4rem; align-items: center; }
      .pub-swatch { width: .6rem; height: .6rem; border-radius: 2px; border: 1px solid var(--navy);
                    display: inline-block; margin-left: .5rem; }
      .pub-swatch-sold { background: var(--navy); }
      .pub-swatch-open { background: #fff; }

      @media print {
        @page {
          size: Letter portrait;
          margin: 18mm 14mm 16mm;
          /* Page numbers. Chrome parses margin boxes; string-set does NOT work,
             which is why running heads come from named pages below rather than
             from the heading text. */
          @bottom-center {
            content: counter(page);
            font: 9pt sans-serif;
            color: #888;
          }
        }
        /* The cover carries no number and no running head — a numbered cover is
           the fastest way for a book to look generated. */
        @page cover {
          margin: 0;
          @bottom-center { content: none; }
          @top-right { content: none; }
        }
        ${sectionPages}

        .pub { max-width: none; padding: 0; font-size: 10.5pt; }

        /* ── Cover ───────────────────────────────────────────────────────── */
        .pub-cover {
          break-after: page;
          display: flex; flex-direction: column; justify-content: center;
          min-height: 232mm; padding: 0 22mm;
          border-bottom: none;
          background: var(--surface);
        }
        .pub-cover .pub-eyebrow { font-size: 10pt; letter-spacing: .18em; }
        .pub-cover .pub-title { font-size: 34pt; line-height: 1.05; margin: 6mm 0 4mm; }
        .pub-cover .pub-sub { font-size: 11pt; }
        .pub-cover::after {
          content: ""; display: block; width: 38mm; height: 3pt;
          background: var(--navy); margin-top: 10mm;
        }

        /* ── Flow ────────────────────────────────────────────────────────── */
        .pub-section { break-before: page; margin-bottom: 0; }
        /* An empty section is feedback on screen and a defect on paper. A page
           reading "People — Nobody listed" is worse than no page at all. */
        .pub-section--empty { display: none; }
        .pub-h2 { break-after: avoid; font-size: 16pt; }
        .pub-h3, .pub-group-head { break-after: avoid; }
        /* A heading alone at the foot of a page is the classic generated-directory
           tell; so is a single line of a description carried over. */
        .pub-body, .pub-desc, .pub-featured { orphans: 3; widows: 3; }

        /* Grid, deliberately — multi-column was measured and is WORSE here.
           Switching .pub-listings to a 2-up column set took it from 51 pages
           to 54: Chrome balances a column set within each page rather than
           flowing it across pages, so a short page ends in a big blank band.
           The grid's atomic rows waste space too, but less. Do not "fix" this
           by reaching for columns again without re-measuring the page count. */
        .pub-listings { grid-template-columns: repeat(2, 1fr); gap: 8pt; }
        .pub-index { columns: 3; }
        .pub-people { columns: 3; font-size: 8.5pt; }
        .pub-listing, .pub-index-block, .pub-map { break-inside: avoid; }

        /* Letter portrait with 18/16mm vertical and 14mm side margins leaves a
           content box of roughly 188 × 245mm. Slots are cut from that, so a
           "half page" really is half a page of this book. */
        /* The gap and the width subtraction must agree, or two "50%" slots
           total more than the row and wrap to one per line — which silently
           turns a quarter page into a half page. 2 × (50% − 4pt) + 8pt = 100%. */
        .pub-ads { gap: 8pt; }
        .pub-ad { break-inside: avoid; border-color: #999; }
        .pub-ad--full    { grid-column: 1 / -1; height: 245mm; break-before: page; break-after: page; }
        .pub-ad--half    { grid-column: 1 / -1; height: 120mm; }
        .pub-ad--quarter { grid-column: span 1; height: 120mm; }
        .pub-ad--full, .pub-ad--half, .pub-ad--quarter { aspect-ratio: auto; }
        /* A full-page ad owns its page, so the running head and section
           heading would be intrusions on paid space. */
        .pub-ads-heading { break-after: avoid; }
        .pub-table tr { break-inside: avoid; }
        .pub-map-svg { border: .5pt solid #999; }
        /* Below ~18mm a phone camera struggles at arm's length. */
        .pub-qr { width: 19mm; height: 19mm; }
        /* Links are read on paper, not clicked. */
        .pub-link { color: var(--ink); }
      }
    `}</style>
  );
}
