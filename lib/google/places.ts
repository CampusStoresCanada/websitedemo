// ─────────────────────────────────────────────────────────────────
// Google Places — shared script loader + window type augmentation
// ─────────────────────────────────────────────────────────────────

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
            getPlace: () => {
              place_id?: string;
              formatted_address?: string;
              name?: string;
              address_components?: Array<{
                long_name: string;
                short_name: string;
                types: string[];
              }>;
            };
            addListener: (event: string, handler: () => void) => { remove?: () => void };
          };
        };
        event: {
          removeListener: (listener: unknown) => void;
        };
      };
    };
  }
}

const SCRIPT_ID = "google-maps-places-script";
const TIMEOUT_MS = 15000;

export function loadGooglePlacesScript(apiKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.maps?.places?.Autocomplete) {
      resolve();
      return;
    }

    const encodedKey = encodeURIComponent(apiKey);
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      // Script tag already in DOM — if it has already loaded, resolve immediately
      if (window.google?.maps?.places?.Autocomplete) {
        resolve();
        return;
      }
      // Still loading — attach listeners
      existing.addEventListener("load", () => {
        if (window.google?.maps?.places?.Autocomplete) resolve();
        else reject(new Error("Google Maps loaded, but Places Autocomplete is unavailable."));
      });
      existing.addEventListener("error", () =>
        reject(new Error("Failed to load Google Places script."))
      );
      return;
    }

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodedKey}&libraries=places&v=weekly`;
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
    }, TIMEOUT_MS);
  });
}
