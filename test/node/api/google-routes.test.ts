// Google's Routes and Maps Static APIs for the dispatch board's day (ADR 0120). Two of these are about money: a route
// that asks for traffic, or names more than ten stops between its ends, bills as Compute Routes Pro; and the key must
// never reach the console.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../../../src/log.ts";
import { areaMapQuery, createGoogleRoutes, staticMapQuery } from "../../../src/providers/routes/google.ts";

const log = createLogger();
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

const HOME = { lat: 28.4595, lng: 77.0266 };
const NEXT = { lat: 28.4089, lng: 77.0418 };
const LAST = { lat: 28.4211, lng: 77.0599 };

function answering(response: () => Response) {
  const calls: Request[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    calls.push(new Request(input, init));
    return Promise.resolve(response());
  };
  return { calls, routes: createGoogleRoutes("google-key", { fetch, log }) };
}

describe("a day's route", () => {
  it("asks for the drive through the stops in order, without traffic, and reads each leg", async () => {
    const { calls, routes } = answering(() =>
      Response.json({
        routes: [
          {
            legs: [{ duration: "1500s", distanceMeters: 8100 }, { duration: "0s" }],
            polyline: { encodedPolyline: "abc~" },
          },
        ],
      }),
    );

    const answer = await routes.route([HOME, NEXT, LAST]);

    expect(answer).toEqual({
      ok: true,
      legs: [
        { seconds: 1500, meters: 8100 },
        { seconds: 0, meters: 0 },
      ],
      polyline: "abc~",
    });
    const [call] = calls;
    expect(call?.headers.get("X-Goog-Api-Key")).toBe("google-key");
    expect(call?.headers.get("X-Goog-FieldMask")).toBe(
      "routes.legs.duration,routes.legs.distanceMeters,routes.polyline.encodedPolyline",
    );
    const body = await call?.json<Record<string, unknown>>();
    expect(body).toMatchObject({
      origin: { location: { latLng: { latitude: HOME.lat, longitude: HOME.lng } } },
      destination: { location: { latLng: { latitude: LAST.lat, longitude: LAST.lng } } },
      intermediates: [{ location: { latLng: { latitude: NEXT.lat, longitude: NEXT.lng } } }],
      travelMode: "DRIVE",
      // Traffic would bill as Compute Routes Pro.
      routingPreference: "TRAFFIC_UNAWARE",
    });
  });

  it("fails on a refusal, in Google's own words where it gives them, or an answer with no route", async () => {
    expect(await answering(() => new Response("", { status: 403 })).routes.route([HOME, NEXT])).toEqual({
      ok: false,
      detail: "HTTP 403",
    });
    const blocked = { error: { code: 403, status: "PERMISSION_DENIED", message: "Requests to this API are blocked." } };
    expect(await answering(() => Response.json(blocked, { status: 403 })).routes.route([HOME, NEXT])).toEqual({
      ok: false,
      detail: "HTTP 403: PERMISSION_DENIED, Requests to this API are blocked.",
    });
    expect(await answering(() => Response.json({})).routes.route([HOME, NEXT])).toMatchObject({ ok: false });
  });
});

describe("the day's map", () => {
  it("numbers each route's stops in its colour, draws the road Google gave, and keeps the key out of the query", () => {
    const query = staticMapQuery([
      { colour: "1f6feb", stops: [HOME, NEXT], polyline: "abc~" },
      { colour: "cf222e", stops: [LAST], polyline: null },
    ]);
    expect(query.getAll("markers")).toEqual([
      "color:0x1f6feb|label:1|28.45950,77.02660",
      "color:0x1f6feb|label:2|28.40890,77.04180",
      "color:0xcf222e|label:1|28.42110,77.05990",
    ]);
    // One stop has no road to draw.
    expect(query.getAll("path")).toEqual(["color:0x1f6febcc|weight:4|enc:abc~"]);
    expect(query.has("key")).toBe(false);
  });

  // A city's map (ADR 0223): each group of pincodes as small markers, each home labelled, each reach a filled circle.
  it("draws a city's pincodes by group, each home, and each reach as a closed circle", () => {
    const query = areaMapQuery({
      pincodes: [
        { colour: "2e7d32", points: [NEXT, LAST] },
        { colour: "c62828", points: [] },
      ],
      homes: [{ colour: "1b2a49", label: "I", point: HOME }],
      reaches: [{ colour: "1b2a49", centre: HOME, km: 10 }],
    });
    expect(query.getAll("markers")).toEqual([
      "size:tiny|color:0x2e7d32|28.40890,77.04180|28.42110,77.05990",
      "color:0x1b2a49|label:I|28.45950,77.02660",
    ]);
    const [circle = ""] = query.getAll("path");
    const corners = circle.split("|").slice(3);
    expect(circle.startsWith("color:0x1b2a4966|weight:1|fillcolor:0x1b2a4922|")).toBe(true);
    expect(corners).toHaveLength(25);
    expect(corners[0]).toBe(corners[24]);
    expect(query.has("key")).toBe(false);
  });

  it("hands back Google's picture, and fails on anything that is not one", async () => {
    const drawn = answering(
      () => new Response(new Uint8Array([137, 80]), { headers: { "Content-Type": "image/png" } }),
    );
    expect(await drawn.routes.map([{ colour: "1f6feb", stops: [HOME], polyline: null }])).toMatchObject({
      ok: true,
      contentType: "image/png",
    });
    expect(new URL(drawn.calls[0]?.url ?? "").searchParams.get("key")).toBe("google-key");

    const refused = answering(() => Response.json({ error: "denied" }, { status: 403 }));
    expect(await refused.routes.map([{ colour: "1f6feb", stops: [HOME], polyline: null }])).toEqual({
      ok: false,
      detail: "HTTP 403",
    });
  });
});
