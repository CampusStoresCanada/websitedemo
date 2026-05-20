import type { AnySnapshot, OrgProfileSnapshot, EventSnapshot, ConferenceSnapshot } from "./types";

// ---------------------------------------------------------------------------
// Top-level switcher
// ---------------------------------------------------------------------------

export function SnapshotRenderer({ snapshot }: { snapshot: AnySnapshot }) {
  switch (snapshot.type) {
    case "org_profile":
      return <OrgProfileView snapshot={snapshot} />;
    case "event":
      return <EventView snapshot={snapshot} />;
    case "conference":
      return <ConferenceView snapshot={snapshot} />;
    case "resources":
    case "partners":
      return (
        <div className="text-center py-8 text-gray-500">
          <p className="text-sm">This snapshot captures a reference to a live page.</p>
          <p className="text-xs text-gray-400 mt-1">Visit the link below to see the full content.</p>
        </div>
      );
  }
}

// ---------------------------------------------------------------------------
// Org / Member profile
// ---------------------------------------------------------------------------

function OrgProfileView({ snapshot }: { snapshot: OrgProfileSnapshot }) {
  const { organization: org, contacts } = snapshot;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        {org.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={org.logo_url}
            alt={org.name}
            className="w-16 h-16 object-contain rounded-lg border border-gray-100"
          />
        ) : (
          <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center">
            <span className="text-2xl font-bold text-gray-400">
              {org.name.charAt(0)}
            </span>
          </div>
        )}
        <div>
          <h2 className="text-xl font-semibold text-[#1A1A1A]">{org.name}</h2>
          <p className="text-sm text-gray-500">
            {[org.city, org.province].filter(Boolean).join(", ") || "Canada"}
          </p>
          <span className="inline-block mt-1 text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full capitalize">
            {org.type?.replace(/_/g, " ")}
          </span>
        </div>
      </div>

      {/* Description */}
      {org.company_description && (
        <p className="text-sm text-gray-700 leading-relaxed">{org.company_description}</p>
      )}

      {/* Key details */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        {org.website && (
          <>
            <dt className="text-gray-500">Website</dt>
            <dd>
              <a
                href={org.website.startsWith("http") ? org.website : `https://${org.website}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline truncate block"
              >
                {org.website.replace(/^https?:\/\//, "")}
              </a>
            </dd>
          </>
        )}
        {org.fte != null && (
          <>
            <dt className="text-gray-500">FTE</dt>
            <dd className="text-gray-800">{org.fte}</dd>
          </>
        )}
        {org.square_footage != null && (
          <>
            <dt className="text-gray-500">Square footage</dt>
            <dd className="text-gray-800">{org.square_footage.toLocaleString()} sq ft</dd>
          </>
        )}
      </dl>

      {/* Certifications */}
      {org.certifications.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Certifications
          </p>
          <div className="flex flex-wrap gap-2">
            {org.certifications.map((cert) => (
              <span
                key={cert}
                className="text-xs px-2 py-0.5 bg-green-50 text-green-700 border border-green-200 rounded-full"
              >
                {cert}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Contacts */}
      {contacts.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Contacts
          </p>
          <div className="space-y-3">
            {contacts.map((contact, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                  <span className="text-xs font-semibold text-gray-500">
                    {(contact.name || "?").charAt(0).toUpperCase()}
                  </span>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-800">{contact.name}</p>
                  {contact.role_title && (
                    <p className="text-xs text-gray-500">{contact.role_title}</p>
                  )}
                  <div className="flex gap-3 mt-0.5">
                    {contact.email && (
                      <a
                        href={`mailto:${contact.email}`}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        {contact.email}
                      </a>
                    )}
                    {contact.phone && (
                      <a
                        href={`tel:${contact.phone}`}
                        className="text-xs text-gray-600 hover:underline"
                      >
                        {contact.phone}
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event
// ---------------------------------------------------------------------------

function EventView({ snapshot }: { snapshot: EventSnapshot }) {
  const { event } = snapshot;

  const formatDate = (iso: string | null) => {
    if (!iso) return null;
    const s = iso.endsWith("Z") || iso.includes("+") ? iso : iso.replace(" ", "T") + "Z";
    return new Date(s).toLocaleDateString("en-CA", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-[#1A1A1A]">{event.title}</h2>
        {event.is_virtual && (
          <span className="inline-block mt-1 text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full">
            Virtual event
          </span>
        )}
      </div>

      {event.description && (
        <p className="text-sm text-gray-700 leading-relaxed">{event.description}</p>
      )}

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        {event.starts_at && (
          <>
            <dt className="text-gray-500">Date</dt>
            <dd className="text-gray-800">
              {formatDate(event.starts_at)}
              {event.ends_at && (
                <> – {formatDate(event.ends_at)}</>
              )}
            </dd>
          </>
        )}
        {event.location && (
          <>
            <dt className="text-gray-500">Location</dt>
            <dd className="text-gray-800">{event.location}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conference
// ---------------------------------------------------------------------------

function ConferenceView({ snapshot }: { snapshot: ConferenceSnapshot }) {
  const { conference: conf } = snapshot;

  const formatDate = (iso: string | null) => {
    if (!iso) return null;
    const s = iso.endsWith("Z") || iso.includes("+") ? iso : iso.replace(" ", "T") + "Z";
    return new Date(s).toLocaleDateString("en-CA", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const locationParts = [conf.location_venue, conf.location_city, conf.location_province]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-[#1A1A1A]">
          {conf.name} {conf.year}
        </h2>
        <p className="text-xs text-gray-400 mt-0.5 font-mono">{conf.edition_code}</p>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        {conf.start_date && (
          <>
            <dt className="text-gray-500">Dates</dt>
            <dd className="text-gray-800">
              {formatDate(conf.start_date)}
              {conf.end_date && (
                <> – {formatDate(conf.end_date)}</>
              )}
            </dd>
          </>
        )}
        {locationParts && (
          <>
            <dt className="text-gray-500">Location</dt>
            <dd className="text-gray-800">{locationParts}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
