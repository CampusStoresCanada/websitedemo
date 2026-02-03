// Mapbox Geocoding utility
// Used to convert addresses to lat/lng coordinates

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

interface GeocodeResult {
  latitude: number;
  longitude: number;
}

export async function geocodeAddress(
  address: string,
  city: string,
  province: string,
  postalCode?: string | null,
  country: string = "Canada"
): Promise<GeocodeResult | null> {
  if (!MAPBOX_TOKEN) {
    console.error("Mapbox token not configured");
    return null;
  }

  // Build the search query
  const searchQuery = [address, city, province, postalCode, country]
    .filter(Boolean)
    .join(", ");

  const encodedQuery = encodeURIComponent(searchQuery);
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodedQuery}.json?access_token=${MAPBOX_TOKEN}&country=CA&limit=1`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.features && data.features.length > 0) {
      const [longitude, latitude] = data.features[0].center;
      return { latitude, longitude };
    }

    console.warn(`No geocode results for: ${searchQuery}`);
    return null;
  } catch (error) {
    console.error(`Geocoding error for ${searchQuery}:`, error);
    return null;
  }
}

// Batch geocode multiple organizations
export async function geocodeOrganizations(
  organizations: Array<{
    id: string;
    street_address: string | null;
    city: string | null;
    province: string | null;
    postal_code: string | null;
  }>
): Promise<Map<string, GeocodeResult>> {
  const results = new Map<string, GeocodeResult>();

  // Process in batches to avoid rate limiting
  const BATCH_SIZE = 10;
  const DELAY_MS = 100; // Small delay between requests

  for (let i = 0; i < organizations.length; i += BATCH_SIZE) {
    const batch = organizations.slice(i, i + BATCH_SIZE);

    const batchPromises = batch.map(async (org) => {
      if (!org.city || !org.province) return null;

      const result = await geocodeAddress(
        org.street_address || "",
        org.city,
        org.province,
        org.postal_code
      );

      if (result) {
        results.set(org.id, result);
      }

      return result;
    });

    await Promise.all(batchPromises);

    // Small delay between batches
    if (i + BATCH_SIZE < organizations.length) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
  }

  return results;
}
