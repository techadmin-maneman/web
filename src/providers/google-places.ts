// Google Maps Platform: Autocomplete (New) for the search, and the Geocoding
// API for the coordinate we keep. Only this file knows Google.
//
// The split is a licensing one, not a technical one
// (docs/decisions/0054-address-capture.md). A coordinate from the Places API
// may be kept 30 days; one from the Geocoding API may be kept indefinitely. So
// the search box returns a Place ID and nothing else, and the coordinate comes
// from a second call to the Geocoding API made with that Place ID.
//
// The three calls and what each costs, from Google's India price list:
//   places:autocomplete   Autocomplete Session Usage (India) 4764-9FA0-0FC0  unlimited, free
//   places/{id}?fields=id Place Details Essentials IDs Only  FAA1-1118-93BE  unlimited, free
//   geocode/json          Geocoding (India)                  AB12-DA89-B523  70,000 a month free
// Only the last is metered, and only once per address saved. The session token
// is what puts the first on the free SKU: without one "each request is billed
// separately", per keystroke.

const AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const PLACES_URL = "https://places.googleapis.com/v1/places";
const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

const TIMEOUT_MS = 5_000;
/** India only: the business serves NCR, and a narrower search is a better one. */
const REGION = "in";

import type { GeocodeProvider, LookupFailure } from "./geocode.ts";

interface AutocompleteAnswer {
  suggestions?: {
    placePrediction?: {
      placeId?: unknown;
      structuredFormat?: { mainText?: { text?: unknown }; secondaryText?: { text?: unknown } };
    };
  }[];
}

interface GeocodeAnswer {
  status?: unknown;
  results?: {
    place_id?: unknown;
    formatted_address?: unknown;
    geometry?: { location?: { lat?: unknown; lng?: unknown } };
  }[];
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** A refused key or a spent quota needs ops; anything else is worth trying again. */
function classify(status: number): LookupFailure {
  if (status === 400 || status === 401 || status === 403 || status === 429) return "refused";
  if (status === 404) return "not_found";
  return "unavailable";
}

export function createGooglePlaces(apiKey: string, deps: { fetch: typeof fetch }): GeocodeProvider {
  // The Geocoding API takes the key in the query string, so it can reach a log
  // through an error message. Nothing leaves this module without this.
  const scrub = (detail: string): string => detail.split(apiKey).join("***REDACTED***").slice(0, 300);

  async function get(url: string, init: RequestInit): Promise<{ status: number; body: unknown } | null> {
    try {
      const response = await deps.fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
      const body: unknown = await response.json().catch(() => null);
      return { status: response.status, body };
    } catch {
      return null;
    }
  }

  return {
    async suggest(query, sessionToken) {
      const answer = await get(AUTOCOMPLETE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey },
        // sessionToken is what makes this call free. Losing it bills per keystroke.
        body: JSON.stringify({ input: query, sessionToken, includedRegionCodes: [REGION], languageCode: "en" }),
      });
      if (answer === null) return { ok: false, reason: "unavailable", detail: "autocomplete did not answer" };
      if (answer.status !== 200) {
        return { ok: false, reason: classify(answer.status), detail: scrub(`autocomplete ${String(answer.status)}`) };
      }
      const suggestions = ((answer.body as AutocompleteAnswer | null)?.suggestions ?? []).flatMap((entry) => {
        const prediction = entry.placePrediction;
        const placeId = text(prediction?.placeId);
        if (placeId === "") return [];
        return [
          {
            placeId,
            primary: text(prediction?.structuredFormat?.mainText?.text),
            secondary: text(prediction?.structuredFormat?.secondaryText?.text),
          },
        ];
      });
      return { ok: true, suggestions };
    },

    async resolve(placeId, sessionToken) {
      // Close the session before geocoding. Google ends a session on Place
      // Details, not on a geocode: an abandoned session is billed per request,
      // so skipping this would silently turn the free SKU into the paid one.
      // Asking for `id` alone is the IDs-only SKU, which is free and unlimited.
      await get(`${PLACES_URL}/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(sessionToken)}`, {
        method: "GET",
        headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "id" },
      });

      const query = new URLSearchParams({ place_id: placeId, key: apiKey, region: REGION });
      const answer = await get(`${GEOCODE_URL}?${query.toString()}`, { method: "GET" });
      if (answer === null) return { ok: false, reason: "unavailable", detail: "geocoding did not answer" };
      if (answer.status !== 200) {
        return { ok: false, reason: classify(answer.status), detail: scrub(`geocoding ${String(answer.status)}`) };
      }
      const body = answer.body as GeocodeAnswer | null;
      const status = text(body?.status);
      const first = body?.results?.[0];
      const lat = first?.geometry?.location?.lat;
      const lng = first?.geometry?.location?.lng;
      if (status !== "OK" || typeof lat !== "number" || typeof lng !== "number") {
        // ZERO_RESULTS and INVALID_REQUEST both mean this Place ID resolved to
        // nothing; a Place ID over a year old can go stale (Google's own advice).
        const reason: LookupFailure = status === "OK" || status === "ZERO_RESULTS" ? "not_found" : "unavailable";
        return { ok: false, reason, detail: scrub(`geocoding said ${status === "" ? "nothing" : status}`) };
      }
      return {
        ok: true,
        place: { placeId, lat, lng, formattedAddress: text(first?.formatted_address) },
      };
    },
  };
}
