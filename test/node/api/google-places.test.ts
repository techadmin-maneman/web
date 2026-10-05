// The Google address provider (docs/decisions/0054-address-capture.md). The
// stub answers Google's HTTP API, so these exercise the real request building.
//
// Two of these tests are about money rather than behaviour. Google bills
// autocomplete per session where a session token groups the requests, and per
// request where it does not; and a session ends only on a Place Details call,
// not on a geocode. Both are easy to get subtly wrong and neither shows up as a
// bug — only as a bill — so they are pinned here.

import { beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { createLogger } from "../../../src/log.ts";
import { createGeocodeProvider } from "../../../src/providers/geocode/index.ts";
import { createStubGeocodeFetch, STUB_API_KEY } from "../../../src/providers/geocode/stub.ts";
import { createGooglePlaces } from "../../../src/providers/geocode/google-places.ts";

const SESSION = "11111111-2222-3333-4444-555555555555";

const log = createLogger();
let printed: MockInstance[];
beforeEach(() => {
  printed = [vi.spyOn(console, "log"), vi.spyOn(console, "warn")].map((spy) =>
    spy.mockClear().mockImplementation(() => undefined),
  );
});

/** Each line the provider logged, kept off the test's output. */
const loggedLines = (): Record<string, unknown>[] =>
  printed.flatMap((spy) => spy.mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>));

/** The stub, wrapped so each call is recorded. */
function watched() {
  const calls: { method: string; url: string; body: string }[] = [];
  const stub = createStubGeocodeFetch();
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    calls.push({
      method: request.method,
      url: request.url,
      body: request.method === "GET" ? "" : await request.clone().text(),
    });
    return stub(input, init);
  };
  return { calls, provider: createGooglePlaces(STUB_API_KEY, { fetch, log }) };
}

describe("suggestions", () => {
  it("returns the building, where it is, and its Place ID", async () => {
    const { provider } = watched();
    const answer = await provider.suggest("Sunrise", SESSION);
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.suggestions[0]).toEqual({
      placeId: "stub-place-sunrise",
      primary: "Sunrise Greens",
      secondary: "Sector 65, Gurugram",
    });
  });

  it("sends the session token, which is what puts autocomplete on the free SKU", async () => {
    const { calls, provider } = watched();
    await provider.suggest("Sunrise", SESSION);
    const autocomplete = calls.find((call) => call.url.includes("places:autocomplete"));
    expect(autocomplete).toBeDefined();
    expect(JSON.parse(autocomplete?.body ?? "{}")).toMatchObject({ input: "Sunrise", sessionToken: SESSION });
  });

  it("keeps every keystroke of one search in one session", async () => {
    const { calls, provider } = watched();
    for (const typed of ["Sun", "Sunr", "Sunri", "Sunrise"]) await provider.suggest(typed, SESSION);
    const tokens = calls
      .filter((call) => call.url.includes("places:autocomplete"))
      .map((call) => (JSON.parse(call.body) as { sessionToken: string }).sessionToken);
    expect(tokens).toEqual([SESSION, SESSION, SESSION, SESSION]);
  });

  it("answers unavailable rather than throwing when Google is down", async () => {
    const { provider } = watched();
    const answer = await provider.suggest("mm-stub:down", SESSION);
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.reason).toBe("unavailable");
  });

  it("answers refused when the key or the quota is refused, which ops must act on", async () => {
    const { provider } = watched();
    const answer = await provider.suggest("mm-stub:refused", SESSION);
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.reason).toBe("refused");
  });

  it("carries Google's own words, because a bare 403 names none of its causes", async () => {
    // A 403 is a disabled API, an unbilled project, a key restricted elsewhere
    // and a spent quota alike. Staging answered "autocomplete 403" and the
    // owner's console looked correct, so the status alone settled nothing.
    const fetch: typeof globalThis.fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: { code: 403, status: "PERMISSION_DENIED", message: "Places API (New) has not been used before" },
          }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        ),
      );
    const answer = await createGooglePlaces(STUB_API_KEY, { fetch, log }).suggest("Vatika City", SESSION);
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.reason).toBe("refused");
    expect(answer.detail).toBe("autocomplete 403: PERMISSION_DENIED, Places API (New) has not been used before");
    expect(loggedLines()).toContainEqual(
      expect.objectContaining({ event: "vendor_call", step: "autocomplete", status: 403, code: "PERMISSION_DENIED" }),
    );
  });

  it("an empty result is an answer, not a failure", async () => {
    const { provider } = watched();
    const answer = await provider.suggest("mm-stub:none", SESSION);
    expect(answer).toEqual({ ok: true, suggestions: [] });
  });
});

// During the Google key's refusal the logs held no line per call, so its cause had to be found from outside.
describe("the log", () => {
  it("has a line for each call to Google, by step, with its status and time, and never the key", async () => {
    const { provider } = watched();
    await provider.suggest("Sunrise", SESSION);
    await provider.resolve("stub-place-mayfield", SESSION);

    const calls = loggedLines().filter((line) => line.event === "vendor_call");
    expect(calls.map(({ vendor, step, status }) => ({ vendor, step, status }))).toEqual([
      { vendor: "google", step: "autocomplete", status: 200 },
      { vendor: "google", step: "close_session", status: 200 },
      { vendor: "google", step: "geocode", status: 200 },
    ]);
    expect(calls.every((line) => typeof line.duration_ms === "number")).toBe(true);
    expect(JSON.stringify(calls)).not.toContain(STUB_API_KEY);
  });
});

describe("resolving a place", () => {
  it("gives a coordinate and the address Google writes for it", async () => {
    const { provider } = watched();
    const answer = await provider.resolve("stub-place-mayfield", SESSION);
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.place.lat).toBeCloseTo(28.3968, 4);
    expect(answer.place.lng).toBeCloseTo(77.0644, 4);
    expect(answer.place.formattedAddress).toContain("Mayfield Towers");
  });

  it("closes the session with Place Details before it geocodes", async () => {
    const { calls, provider } = watched();
    await provider.resolve("stub-place-mayfield", SESSION);
    const order = calls.map((call) => (call.url.includes("maps.googleapis.com") ? "geocode" : "places"));
    // A session Google never sees closed is billed per request, so the order matters.
    expect(order).toEqual(["places", "geocode"]);
    expect(calls[0]?.url).toContain(`sessionToken=${SESSION}`);
  });

  it("asks Place Details for the id alone, which is the free field mask", async () => {
    const { calls, provider } = watched();
    await provider.resolve("stub-place-mayfield", SESSION);
    expect(calls[0]?.url).toContain("/v1/places/stub-place-mayfield");
  });

  it("takes the coordinate from the Geocoding API, the only one we may keep", async () => {
    const { calls, provider } = watched();
    await provider.resolve("stub-place-mayfield", SESSION);
    expect(calls.at(-1)?.url).toContain("https://maps.googleapis.com/maps/api/geocode/json");
    expect(calls.at(-1)?.url).toContain("place_id=stub-place-mayfield");
  });

  it("says not_found for a Place ID Google no longer knows", async () => {
    const { provider } = watched();
    const answer = await provider.resolve("stub-place-gone", SESSION);
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.reason).toBe("not_found");
  });

  it.each([
    ["REQUEST_DENIED", "This API project is not authorized to use this API."],
    ["OVER_DAILY_LIMIT", "You have exceeded your daily request quota for this API."],
    ["OVER_QUERY_LIMIT", "You have exceeded your rate-limit for this API."],
  ])("answers refused, with Google's words, when geocoding says %s under a 200", async (status, message) => {
    const provider = createGooglePlaces(STUB_API_KEY, {
      fetch: (input, init) =>
        new URL(new Request(input, init).url).hostname === "maps.googleapis.com"
          ? Promise.resolve(Response.json({ status, error_message: message, results: [] }))
          : createStubGeocodeFetch()(input, init),
      log,
    });
    const answer = await provider.resolve("stub-place-mayfield", SESSION);
    expect(answer).toEqual({ ok: false, reason: "refused", detail: `geocoding said ${status}: ${message}` });
  });

  it("answers the stub's refused key as Google does: a 200 that says REQUEST_DENIED", async () => {
    const provider = createGooglePlaces("not-the-stub-key", { fetch: createStubGeocodeFetch(), log });
    const answer = await provider.resolve("stub-place-mayfield", SESSION);
    expect(answer).toMatchObject({ ok: false, reason: "refused" });
    if (answer.ok) return;
    expect(answer.detail).toContain("geocoding said REQUEST_DENIED");
  });

  it("never lets the API key into a detail, because geocoding takes it in the URL", async () => {
    const provider = createGooglePlaces("a-very-secret-key", { fetch: createStubGeocodeFetch(), log });
    const answer = await provider.resolve("stub-place-mayfield", SESSION);
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.detail).not.toContain("a-very-secret-key");
  });
});

describe("choosing the implementation", () => {
  it("answers nothing where no provider is configured, rather than failing", async () => {
    const provider = createGeocodeProvider("none", null, { fetch, log });
    expect(await provider.suggest("Sunrise", SESSION)).toMatchObject({ ok: false, reason: "unavailable" });
  });

  it("falls back to no provider when google is named without a key", async () => {
    const provider = createGeocodeProvider("google", null, { fetch, log });
    expect(await provider.suggest("Sunrise", SESSION)).toMatchObject({ ok: false, reason: "unavailable" });
  });

  it("uses the stub, which needs no network, when the provider is stub", async () => {
    const provider = createGeocodeProvider("stub", null, { fetch, log });
    expect(await provider.suggest("Sunrise", SESSION)).toMatchObject({ ok: true });
  });
});
