"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createConference, updateConference } from "@/lib/actions/conference";
import type { Database } from "@/lib/database.types";

type ConferenceRow = Database["public"]["Tables"]["conference_instances"]["Row"];

interface ConferenceFormProps {
  conference?: ConferenceRow;
  canSuperAdminOverride?: boolean;
  googleMapsApiKey?: string | null;
}

declare global {
  interface Window {
    google?: {
      maps?: {
        places?: {
          Autocomplete: new (
            input: HTMLInputElement,
            options?: {
              types?: string[];
              fields?: string[];
              componentRestrictions?: { country: string | string[] };
            }
          ) => {
            addListener: (eventName: string, handler: () => void) => { remove?: () => void };
            getPlace: () => {
              address_components?: Array<{
                long_name: string;
                short_name: string;
                types: string[];
              }>;
              formatted_address?: string;
              name?: string;
            };
          };
        };
      };
    };
  }
}

const GOOGLE_PLACES_SCRIPT_ID = "google-maps-places-script";
const GOOGLE_PLACES_READY_TIMEOUT_MS = 15000;

function loadGooglePlacesScript(apiKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.maps?.places?.Autocomplete) {
      resolve();
      return;
    }

    const encodedKey = encodeURIComponent(apiKey);
    const existing = document.getElementById(GOOGLE_PLACES_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      const existingSrc = existing.getAttribute("src") ?? "";
      if (existingSrc && !existingSrc.includes(`key=${encodedKey}`)) {
        reject(
          new Error(
            "Google Places script already exists with a different API key. Refresh and retry with one key."
          )
        );
        return;
      }
      existing.addEventListener("load", () => {
        if (window.google?.maps?.places?.Autocomplete) resolve();
        else reject(new Error("Google Maps loaded, but Places Autocomplete is unavailable."));
      });
      existing.addEventListener("error", () => reject(new Error("Failed to load Google Places script.")));
      return;
    }

    const script = document.createElement("script");
    script.id = GOOGLE_PLACES_SCRIPT_ID;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodedKey}&libraries=places&v=weekly&loading=async`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.maps?.places?.Autocomplete) resolve();
      else reject(new Error("Google Maps loaded, but Places Autocomplete is unavailable."));
    };
    script.onerror = () => reject(new Error("Failed to load Google Places script."));
    document.head.appendChild(script);

    window.setTimeout(() => {
      if (!window.google?.maps?.places?.Autocomplete) {
        reject(new Error("Google Places initialization timed out."));
      }
    }, GOOGLE_PLACES_READY_TIMEOUT_MS);
  });
}

export default function ConferenceForm({
  conference,
  canSuperAdminOverride = false,
  googleMapsApiKey = null,
}: ConferenceFormProps) {
  const router = useRouter();
  const isEdit = !!conference;
  const venueInputRef = useRef<HTMLInputElement | null>(null);

  const [name, setName] = useState(conference?.name ?? "");
  const [year, setYear] = useState(conference?.year ?? new Date().getFullYear() + 1);
  const [editionCode, setEditionCode] = useState(conference?.edition_code ?? "00");
  const [locationCity, setLocationCity] = useState(conference?.location_city ?? "");
  const [locationProvince, setLocationProvince] = useState(conference?.location_province ?? "");
  const [locationVenue, setLocationVenue] = useState(conference?.location_venue ?? "");
  const [timezone, setTimezone] = useState(conference?.timezone ?? "America/Toronto");
  const [taxJurisdiction, setTaxJurisdiction] = useState(conference?.tax_jurisdiction ?? "");
  const [taxRatePct, setTaxRatePct] = useState(conference?.tax_rate_pct?.toString() ?? "");
  const [stripeTaxRateId, setStripeTaxRateId] = useState(conference?.stripe_tax_rate_id ?? "");
  const [startDate, setStartDate] = useState(conference?.start_date ?? "");
  const [endDate, setEndDate] = useState(conference?.end_date ?? "");
  const [registrationOpenAt, setRegistrationOpenAt] = useState(conference?.registration_open_at ?? "");
  const [registrationCloseAt, setRegistrationCloseAt] = useState(conference?.registration_close_at ?? "");
  const [enableOverride, setEnableOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [placesReady, setPlacesReady] = useState(false);
  const [placesRuntimeError, setPlacesRuntimeError] = useState<string | null>(null);

  const placesError =
    !googleMapsApiKey
      ? "Google Places is disabled. Add GOOGLE_MAPS_API_KEY (or NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) to env.local."
      : placesRuntimeError;

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!googleMapsApiKey) {
      return;
    }

    let listener: { remove?: () => void } | null = null;
    let isCancelled = false;

    const initAutocomplete = async () => {
      try {
        await loadGooglePlacesScript(googleMapsApiKey);
        if (isCancelled || !venueInputRef.current || !window.google?.maps?.places?.Autocomplete) return;

        const autocomplete = new window.google.maps.places.Autocomplete(venueInputRef.current, {
          types: ["establishment"],
          fields: ["address_components", "formatted_address", "name"],
          componentRestrictions: { country: "ca" },
        });

        listener = autocomplete.addListener("place_changed", () => {
          const place = autocomplete.getPlace();
          const components = place.address_components ?? [];

          if (place.name || place.formatted_address) {
            setLocationVenue(place.name ?? place.formatted_address ?? "");
          }

          const cityComponent =
            components.find((component) => component.types.includes("locality")) ??
            components.find((component) => component.types.includes("postal_town")) ??
            components.find((component) => component.types.includes("administrative_area_level_2"));
          const provinceComponent = components.find((component) =>
            component.types.includes("administrative_area_level_1")
          );

          if (cityComponent?.long_name) setLocationCity(cityComponent.long_name);
          if (provinceComponent?.short_name) setLocationProvince(provinceComponent.short_name);
        });

        setPlacesReady(true);
        setPlacesRuntimeError(null);
      } catch (initError) {
        setPlacesReady(false);
        setPlacesRuntimeError(
          initError instanceof Error ? initError.message : "Google Places unavailable."
        );
      }
    };

    void initAutocomplete();

    return () => {
      isCancelled = true;
      if (listener?.remove) listener.remove();
    };
  }, [googleMapsApiKey]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const data = {
      name,
      year,
      edition_code: editionCode,
      location_city: locationCity || null,
      location_province: locationProvince || null,
      location_venue: locationVenue || null,
      timezone,
      tax_jurisdiction: taxJurisdiction || null,
      tax_rate_pct: taxRatePct ? parseFloat(taxRatePct) : null,
      stripe_tax_rate_id: stripeTaxRateId || null,
      start_date: startDate || null,
      end_date: endDate || null,
      registration_open_at: registrationOpenAt || null,
      registration_close_at: registrationCloseAt || null,
    };

    const result = isEdit
      ? await updateConference(conference.id, data, {
          superAdminOverride: canSuperAdminOverride && enableOverride,
          overrideReason: canSuperAdminOverride && enableOverride ? overrideReason : null,
        })
      : await createConference(data);

    setIsLoading(false);

    if (!result.success) {
      setError(result.error ?? "Something went wrong");
      return;
    }

    if (isEdit) {
      router.refresh();
    } else if (result.data) {
      router.push(`/admin/conference/${result.data.id}`);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Conference Name *
          </label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="CSC 2027 Annual Conference"
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D60001]"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Year *</label>
          <input
            type="number"
            required
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D60001]"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Edition Code</label>
          <input
            type="text"
            value={editionCode}
            onChange={(e) => setEditionCode(e.target.value)}
            placeholder="00"
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D60001]"
          />
        </div>
      </div>

      <fieldset className="border border-gray-200 rounded-lg p-4">
        <legend className="text-sm font-medium text-gray-700 px-1">Location</legend>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">City</label>
            <input type="text" value={locationCity} onChange={(e) => setLocationCity(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D60001]" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Province</label>
            <input type="text" value={locationProvince} onChange={(e) => setLocationProvince(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D60001]" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Venue (Google Places)</label>
            <input
              ref={venueInputRef}
              type="text"
              value={locationVenue}
              onChange={(e) => setLocationVenue(e.target.value)}
              placeholder="Start typing venue or address..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D60001]"
            />
            {placesReady && (
              <p className="mt-1 text-xs text-gray-500">
                Autocomplete is active. Select a result to auto-fill city/province.
              </p>
            )}
            {placesError && (
              <p className="mt-1 text-xs text-amber-700">
                {placesError}
              </p>
            )}
          </div>
        </div>
      </fieldset>

      <fieldset className="border border-gray-200 rounded-lg p-4">
        <legend className="text-sm font-medium text-gray-700 px-1">Dates</legend>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Start Date</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D60001]" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">End Date</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D60001]" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Registration Opens</label>
            <input type="datetime-local" value={registrationOpenAt ? registrationOpenAt.slice(0, 16) : ""} onChange={(e) => setRegistrationOpenAt(e.target.value ? new Date(e.target.value).toISOString() : "")} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D60001]" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Registration Closes</label>
            <input type="datetime-local" value={registrationCloseAt ? registrationCloseAt.slice(0, 16) : ""} onChange={(e) => setRegistrationCloseAt(e.target.value ? new Date(e.target.value).toISOString() : "")} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D60001]" />
          </div>
        </div>
      </fieldset>

      <fieldset className="border border-gray-200 rounded-lg p-4">
        <legend className="text-sm font-medium text-gray-700 px-1">Tax</legend>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Timezone</label>
            <input type="text" value={timezone} onChange={(e) => setTimezone(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D60001]" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Tax Jurisdiction</label>
            <input type="text" value={taxJurisdiction} onChange={(e) => setTaxJurisdiction(e.target.value)} placeholder="ON" className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D60001]" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Tax Rate %</label>
            <input type="number" step="0.01" value={taxRatePct} onChange={(e) => setTaxRatePct(e.target.value)} placeholder="13.0" className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D60001]" />
          </div>
          <div className="col-span-3">
            <label className="block text-xs text-gray-500 mb-1">Stripe Tax Rate ID</label>
            <input type="text" value={stripeTaxRateId} onChange={(e) => setStripeTaxRateId(e.target.value)} placeholder="txr_..." className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:ring-1 focus:ring-[#D60001]" />
            <p className="mt-1 text-xs text-gray-400">
              From Stripe Dashboard &rarr; Tax Rates. Must match the jurisdiction rate above.
            </p>
          </div>
        </div>
      </fieldset>

      {isEdit && canSuperAdminOverride && (
        <fieldset className="border border-amber-300 bg-amber-50 rounded-lg p-4">
          <legend className="text-sm font-medium text-amber-900 px-1">Super Admin Override</legend>
          <label className="flex items-center gap-2 text-sm text-amber-900">
            <input
              type="checkbox"
              checked={enableOverride}
              onChange={(e) => setEnableOverride(e.target.checked)}
            />
            Force update locked conference details
          </label>
          <label className="mt-3 block text-xs text-amber-900">
            Override reason (required when enabled)
            <input
              type="text"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="Why this locked detail change is needed"
              className="mt-1 w-full rounded-md border border-amber-300 bg-white px-3 py-2 text-sm"
              disabled={!enableOverride}
              required={enableOverride}
            />
          </label>
        </fieldset>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isLoading}
          className="px-6 py-2 text-sm font-medium text-white bg-[#D60001] rounded-md hover:bg-[#b50001] disabled:opacity-50"
        >
          {isLoading ? "Saving..." : isEdit ? "Save Changes" : "Create Conference"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
