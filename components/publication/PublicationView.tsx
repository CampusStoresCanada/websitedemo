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

import type {
  ComposedEntry,
  ComposedPublication,
  ComposedSection,
  PlacedThing,
  SurfaceForPublication,
} from "@/lib/publication/composition";

const VIEW_W = 1000;
const VIEW_H = 620;

export default function PublicationView({ doc }: { doc: ComposedPublication }) {
  return (
    <article className="pub">
      <PublicationStyles />
      <header className="pub-cover">
        <p className="pub-eyebrow">Campus Stores Canada</p>
        <h1 className="pub-title">{doc.title}</h1>
        <p className="pub-sub">
          {doc.entries.length} {doc.entries.length === 1 ? "listing" : "listings"}
        </p>
      </header>

      {doc.sections.map((section, i) => (
        <Section key={`${section.type}-${i}`} section={section} />
      ))}
    </article>
  );
}

function Section({ section }: { section: ComposedSection }) {
  switch (section.type) {
    case "static":
      return (
        <section className="pub-section">
          <h2 className="pub-h2">{section.title}</h2>
          <p className="pub-body">{section.body}</p>
        </section>
      );

    case "map":
      return (
        <section className="pub-section">
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
        <section className="pub-section">
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
        <section className="pub-section">
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

    case "listings":
      return (
        <section className="pub-section">
          <h2 className="pub-h2">{section.title}</h2>
          {section.groups.length === 0 ? (
            <p className="pub-empty">No listings.</p>
          ) : (
            section.groups.map((g, gi) => (
              <div key={g.heading ?? gi} className="pub-group">
                {g.heading ? <h3 className="pub-h3 pub-group-head">{g.heading}</h3> : null}
                <div className="pub-listings">
                  {g.entries.map((e) => (
                    <Listing key={`${g.heading}-${e.orgId}`} entry={e} />
                  ))}
                </div>
              </div>
            ))
          )}
        </section>
      );
  }
}

function Listing({ entry }: { entry: ComposedEntry }) {
  return (
    <div className="pub-listing">
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

      {entry.description ? <p className="pub-desc">{entry.description}</p> : null}

      {entry.featuredProduct ? (
        <p className="pub-featured">
          <span className="pub-featured-label">Featured</span> {entry.featuredProduct}
          {entry.featuredProductDetail ? ` — ${entry.featuredProductDetail}` : ""}
        </p>
      ) : null}

      {entry.classes.length > 0 ? <p className="pub-classes">{entry.classes.join(" · ")}</p> : null}
      {entry.catalogueUrl ? <p className="pub-link">{cleanUrl(entry.catalogueUrl)}</p> : null}
    </div>
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
function PublicationStyles() {
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
        @page { size: Letter portrait; margin: 16mm 14mm; }
        .pub { max-width: none; padding: 0; font-size: 10.5pt; }
        /* Every section starts a page: an index that dribbles onto the previous
           spread is the classic generated-directory tell. */
        .pub-section { break-before: page; margin-bottom: 0; }
        .pub-cover { break-after: page; border-bottom-width: 2pt; }
        .pub-h2 { break-after: avoid; }
        .pub-h3, .pub-group-head { break-after: avoid; }
        .pub-listings { grid-template-columns: repeat(2, 1fr); gap: 8pt; }
        .pub-index { columns: 3; }
        .pub-listing, .pub-index-block, .pub-map { break-inside: avoid; }
        .pub-map-svg { border: .5pt solid #999; }
        /* Links are read on paper, not clicked. */
        .pub-link { color: var(--ink); }
      }
    `}</style>
  );
}
