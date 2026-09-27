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

import { z } from "zod";
import type { GeocodeProvider, LookupFailure } from "./geocode.ts";

/** A string Google may leave out, read as empty. */
const Text = z.string().catch("");
const Named = z.object({ text: Text }).catch({ text: "" });

const Autocomplete = z.object({
  suggestions: z
    .array(
      z.object({
        placePrediction: z
          .object({
            placeId: Text,
            structuredFormat: z
              .object({ mainText: Named, secondaryText: Named })
              .catch({ mainText: { text: "" }, secondaryText: { text: "" } }),
          })
          .optional()
          .catch(undefined),
      }),
    )
    .catch([]),
});

/** The Geocoding API's answer: its status, and the results, of which only the first is read. */
const Geocoded = z.object({ status: Text, results: z.array(z.unknown()).catch([]) });
const GeocodedPlace = z.object({
  formatted_address: Text,
  geometry: z.object({ location: z.object({ lat: z.number(), lng: z.number() }) }),
});

/** Why Google refused, where it says: the Places API in `error`, the Geocoding API in `error_message`. */
const Refusal = z.object({
  error: z.object({ message: Text, status: Text }).catch({ message: "", status: "" }),
  error_message: Text,
});

/**
 * Google says why it refused, in the body; a status on its own does not. A 403
 * is a disabled API, an unbilled project, a key restricted to another API and a
 * spent quota alike, and telling them apart from "autocomplete 403" alone cost
 * an afternoon. The message is scrubbed of the key by the caller, as everything
 * leaving this module is.
 */
function why(body: unknown): string {
  const said = Refusal.safeParse(body).data ?? { error: { message: "", status: "" }, error_message: "" };
  const message = said.error.message === "" ? said.error_message : said.error.message;
  const { status } = said.error;
  if (message === "") return status === "" ? "" : `: ${status}`;
  return status === "" ? `: ${message}` : `: ${status}, ${message}`;
}

/** A refused key or a spent quota needs ops; anything else is worth trying again. */
function classify(status: number): LookupFailure {
  if (status === 400 || status === 401 || status === 403 || status === 429) return "refused";
  if (status === 404) return "not_found";
  return "unavailable";
}

/**
 * The Geocoding API answers a refusal with HTTP 200 and says so in `status`,
 * so its status is read as the HTTP code is elsewhere. Anything not here,
 * UNKNOWN_ERROR included, is worth trying again.
 */
const GEOCODING_STATUS: Readonly<Record<string, LookupFailure>> = {
  ZERO_RESULTS: "not_found",
  REQUEST_DENIED: "refused",
  OVER_DAILY_LIMIT: "refused",
  OVER_QUERY_LIMIT: "refused",
};

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
        return {
          ok: false,
          reason: classify(answer.status),
          detail: scrub(`autocomplete ${String(answer.status)}${why(answer.body)}`),
        };
      }
      const predictions = Autocomplete.safeParse(answer.body).data?.suggestions ?? [];
      const suggestions = predictions.flatMap(({ placePrediction }) => {
        if (placePrediction === undefined || placePrediction.placeId === "") return [];
        const { mainText, secondaryText } = placePrediction.structuredFormat;
        return [{ placeId: placePrediction.placeId, primary: mainText.text, secondary: secondaryText.text }];
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
        return {
          ok: false,
          reason: classify(answer.status),
          detail: scrub(`geocoding ${String(answer.status)}${why(answer.body)}`),
        };
      }
      const geocoded = Geocoded.safeParse(answer.body).data;
      const status = geocoded?.status ?? "";
      const first = GeocodedPlace.safeParse(geocoded?.results[0]).data;
      if (status !== "OK" || first === undefined) {
        // OK with no coordinate, or ZERO_RESULTS: this Place ID resolved to nothing,
        // as one over a year old can (Google's own advice).
        const reason: LookupFailure = status === "OK" ? "not_found" : (GEOCODING_STATUS[status] ?? "unavailable");
        const said = status === "" ? "nothing" : status;
        return { ok: false, reason, detail: scrub(`geocoding said ${said}${why(answer.body)}`) };
      }
      const { lat, lng } = first.geometry.location;
      return { ok: true, place: { placeId, lat, lng, formattedAddress: first.formatted_address } };
    },
  };
}
