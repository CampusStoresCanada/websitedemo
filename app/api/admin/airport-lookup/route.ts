import { NextRequest, NextResponse } from "next/server";

type AirportLookupResult = {
  code: string;
  codeType: "airport" | "metro";
  name: string;
  city: string;
  country: string;
};

const KNOWN_AIRPORTS_BY_IATA: Record<string, { name: string; city: string; country: string }> = {
  YYZ: { name: "Toronto Pearson International Airport", city: "Toronto", country: "CA" },
  YTZ: { name: "Billy Bishop Toronto City Airport", city: "Toronto", country: "CA" },
  YVR: { name: "Vancouver International Airport", city: "Vancouver", country: "CA" },
  YYC: { name: "Calgary International Airport", city: "Calgary", country: "CA" },
  YEG: { name: "Edmonton International Airport", city: "Edmonton", country: "CA" },
  YUL: { name: "Montreal-Trudeau International Airport", city: "Montreal", country: "CA" },
  YOW: { name: "Ottawa International Airport", city: "Ottawa", country: "CA" },
  YWG: { name: "Winnipeg Richardson International Airport", city: "Winnipeg", country: "CA" },
  YHZ: { name: "Halifax Stanfield International Airport", city: "Halifax", country: "CA" },
  YXE: { name: "Saskatoon John G. Diefenbaker International Airport", city: "Saskatoon", country: "CA" },
  YQR: { name: "Regina International Airport", city: "Regina", country: "CA" },
};

const KNOWN_METRO_CODES: Record<string, { name: string; city: string; country: string }> = {
  LON: { name: "London Metropolitan Area (city code)", city: "London", country: "GB" },
  NYC: { name: "New York Metropolitan Area (city code)", city: "New York", country: "US" },
  TYO: { name: "Tokyo Metropolitan Area (city code)", city: "Tokyo", country: "JP" },
};

function normalizeCountryCode(input: string): string {
  const trimmed = input.trim().toUpperCase();
  if (!trimmed) return "";
  if (trimmed === "UNITED STATES") return "US";
  if (trimmed === "UNITED KINGDOM") return "GB";
  if (trimmed === "CANADA") return "CA";
  return trimmed.slice(0, 2);
}

function extractIataCode(value: string): string | null {
  const upper = value.toUpperCase();
  const match = upper.match(/\b([A-Z]{3})\b/);
  return match?.[1] ?? null;
}

export async function GET(request: NextRequest) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) {
    return NextResponse.json({ success: false, error: "Mapbox token not configured." }, { status: 500 });
  }

  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!query) {
    return NextResponse.json({ success: false, error: "Query is required." }, { status: 400 });
  }

  const upper = query.toUpperCase();
  const isLikelyCode = /^[A-Z]{3}$/.test(upper);
  if (isLikelyCode && KNOWN_AIRPORTS_BY_IATA[upper]) {
    const entry = KNOWN_AIRPORTS_BY_IATA[upper];
    return NextResponse.json({
      success: true,
      data: {
        code: upper,
        codeType: "airport",
        name: entry.name,
        city: entry.city,
        country: entry.country,
      } satisfies AirportLookupResult,
    });
  }
  if (isLikelyCode && KNOWN_METRO_CODES[upper]) {
    const entry = KNOWN_METRO_CODES[upper];
    return NextResponse.json({
      success: true,
      data: {
        code: upper,
        codeType: "metro",
        name: entry.name,
        city: entry.city,
        country: entry.country,
      } satisfies AirportLookupResult,
    });
  }

  const composedQuery = isLikelyCode ? `${upper} airport` : query;
  const encoded = encodeURIComponent(composedQuery);
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${encodeURIComponent(
    token
  )}&types=poi,place&limit=8`;

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: `Airport lookup failed (${response.status}).` },
        { status: 502 }
      );
    }

    const payload = (await response.json()) as {
      features?: Array<{
        text?: string;
        place_name?: string;
        place_type?: string[];
        properties?: Record<string, unknown>;
        context?: Array<{ id?: string; text?: string; short_code?: string }>;
      }>;
    };
    const features = Array.isArray(payload.features) ? payload.features : [];
    if (features.length === 0) {
      return NextResponse.json({ success: false, error: "No airport match found." }, { status: 404 });
    }

    const airportCandidates = features.filter((feature) => {
      const text = (feature.text ?? "").toLowerCase();
      const placeName = (feature.place_name ?? "").toLowerCase();
      const category = String(feature.properties?.category ?? "").toLowerCase();
      return (
        text.includes("airport") ||
        placeName.includes("airport") ||
        category.includes("airport") ||
        category.includes("aerodrome")
      );
    });

    const strictCodeMatch = isLikelyCode
      ? airportCandidates.find((feature) => {
          const textCode = extractIataCode(feature.text ?? "");
          const placeCode = extractIataCode(feature.place_name ?? "");
          return textCode === upper || placeCode === upper;
        })
      : null;

    if (isLikelyCode && !strictCodeMatch) {
      return NextResponse.json(
        {
          success: false,
          error: `No airport found for IATA code ${upper}.`,
        },
        { status: 404 }
      );
    }

    const match =
      strictCodeMatch ??
      airportCandidates.find((feature) => {
        const text = (feature.text ?? "").toLowerCase();
        const placeName = (feature.place_name ?? "").toLowerCase();
        const category = String(feature.properties?.category ?? "").toLowerCase();
        return (
          text.includes("airport") ||
          placeName.includes("airport") ||
          category.includes("airport") ||
          category.includes("aerodrome")
        );
      }) ?? features[0];

    const context = Array.isArray(match.context) ? match.context : [];
    const city = context.find((entry) => entry.id?.startsWith("place."))?.text ?? "";
    const countryCodeRaw =
      context.find((entry) => entry.id?.startsWith("country."))?.short_code ??
      context.find((entry) => entry.id?.startsWith("country."))?.text ??
      "";
    const country = normalizeCountryCode(countryCodeRaw);
    const looksLikeAirport =
      (match.place_type ?? []).includes("poi") ||
      /airport|aerodrome/i.test(match.text ?? "") ||
      /airport|aerodrome/i.test(match.place_name ?? "");

    const extractedCode =
      extractIataCode(match.text ?? "") ?? extractIataCode(match.place_name ?? "") ?? null;
    const result: AirportLookupResult = {
      code: isLikelyCode ? upper : extractedCode ?? "",
      codeType: looksLikeAirport ? "airport" : "metro",
      name: match.text ?? upper,
      city,
      country: country || "CA",
    };

    return NextResponse.json({ success: true, data: result });
  } catch {
    return NextResponse.json({ success: false, error: "Airport lookup request failed." }, { status: 500 });
  }
}
