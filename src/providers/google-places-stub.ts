// A fake Google Maps Platform for local runs and tests. The real adapter
// (google-places.ts) talks to it through `fetch`, so the stub exercises the
// real request building and parsing — including the session token, which is
// what keeps autocomplete on Google's free SKU.
//
// The suggestions are synthetic Gurugram societies. No real address appears
// here or in any fixture.
//
// A query picks a scenario by containing "mm-stub:<scenario>":
//   none      no suggestions come back, as for a misspelt building
//   refused   the key is refused (403), as when the quota is spent
//   down      Google answers 503

export const STUB_API_KEY = "stub-google-key";

/** Synthetic buildings, each with a coordinate a little apart in Sector 65, Gurugram. */
const PLACES = [
  {
    placeId: "stub-place-sunrise",
    primary: "Sunrise Greens",
    secondary: "Sector 65, Gurugram",
    lat: 28.3951,
    lng: 77.0619,
  },
  {
    placeId: "stub-place-mayfield",
    primary: "Mayfield Towers",
    secondary: "Sector 65, Gurugram",
    lat: 28.3968,
    lng: 77.0644,
  },
  {
    placeId: "stub-place-orchid",
    primary: "Orchid Residency",
    secondary: "Sector 66, Gurugram",
    lat: 28.3904,
    lng: 77.0702,
  },
] as const;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function scenario(query: string): "none" | "refused" | "down" | "ok" {
  const found = /mm-stub:(none|refused|down)/.exec(query);
  return (found?.[1] as "none" | "refused" | "down" | undefined) ?? "ok";
}

export function createStubGeocodeFetch(): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);

    if (url.hostname === "places.googleapis.com") {
      if (request.headers.get("X-Goog-Api-Key") !== STUB_API_KEY) {
        return json({ error: { message: "stub: the key was refused" } }, 403);
      }

      if (url.pathname === "/v1/places:autocomplete") {
        const body = (await request.json().catch(() => null)) as {
          input?: unknown;
          sessionToken?: unknown;
        } | null;
        const query = typeof body?.input === "string" ? body.input : "";
        // Google bills per request, not per session, when the token is missing.
        // The stub refuses outright so a lost token fails a test rather than a bill.
        if (typeof body?.sessionToken !== "string" || body.sessionToken === "") {
          return json(
            { error: { message: "stub: autocomplete without a session token would be billed per request" } },
            400,
          );
        }
        const picked = scenario(query);
        if (picked === "refused") return json({ error: { message: "stub: quota" } }, 403);
        if (picked === "down") return json({ error: { message: "stub: down" } }, 503);
        if (picked === "none" || query.trim() === "") return json({});
        const wanted = query.trim().toLowerCase();
        const matches = PLACES.filter((place) => place.primary.toLowerCase().includes(wanted));
        return json({
          suggestions: (matches.length > 0 ? matches : PLACES).map((place) => ({
            placePrediction: {
              placeId: place.placeId,
              structuredFormat: { mainText: { text: place.primary }, secondaryText: { text: place.secondary } },
            },
          })),
        });
      }

      // Place Details, IDs only: what closes the billed session.
      const placeId = decodeURIComponent(url.pathname.replace("/v1/places/", ""));
      if (url.searchParams.get("sessionToken") === null) {
        return json({ error: { message: "stub: the session was never closed" } }, 400);
      }
      const known = PLACES.find((place) => place.placeId === placeId);
      return known === undefined ? json({ error: { message: "stub: no such place" } }, 404) : json({ id: placeId });
    }

    if (url.hostname === "maps.googleapis.com") {
      if (url.searchParams.get("key") !== STUB_API_KEY) return json({ status: "REQUEST_DENIED" }, 403);
      const placeId = url.searchParams.get("place_id") ?? "";
      const known = PLACES.find((place) => place.placeId === placeId);
      if (known === undefined) return json({ status: "ZERO_RESULTS", results: [] });
      return json({
        status: "OK",
        results: [
          {
            place_id: known.placeId,
            formatted_address: `${known.primary}, ${known.secondary}, Haryana 122018, India`,
            geometry: { location: { lat: known.lat, lng: known.lng } },
          },
        ],
      });
    }

    return json({ error: "stub: unknown host" }, 404);
  };
}
