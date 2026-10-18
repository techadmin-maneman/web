// Google Maps Platform: the Routes API for a technician's drive through their day, and the Maps Static API for the
// picture of it. Only this file knows Google.
//
// What each costs, from Google's India price list:
//   directions/v2:computeRoutes   Compute Routes Essentials (India)   70,000 a month free
//   maps/api/staticmap            Static Maps (India)                 70,000 a month free
// Essentials holds while the route ignores traffic and has at most ten stops between its ends, so both are kept to.
// The daily ceilings (src/policy/rate-limits.ts) keep a month far inside the free allowance.

import { z } from "zod";
import type { Leg, MapResult, MapRoute, Point, RouteResult, RoutesProvider } from "./index.ts";
import { vendorFetch, VendorUnreachable, type VendorFetchDependencies } from "../vendor-fetch.ts";

const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const STATIC_MAP_URL = "https://maps.googleapis.com/maps/api/staticmap";
const TIMEOUT_MS = 8_000;
/** Ten between the two ends: more is Compute Routes Pro. */
export const MOST_STOPS = 12;

const waypoint = (point: Point) => ({ location: { latLng: { latitude: point.lat, longitude: point.lng } } });

/** Google writes a duration as seconds with an "s"; a leg of no distance leaves its distance out. */
/** Why Google refused, as its error body says: "PERMISSION_DENIED, Requests to this API … are blocked." */
const Refusal = z.object({ error: z.object({ status: z.string().catch(""), message: z.string().catch("") }) });

/**
 * Google's own words for a refusal, after its status: a 403 is a disabled API, a key restricted to others and a spent
 * quota alike, and only the body tells them apart.
 */
function why(body: unknown): string {
  const said = Refusal.safeParse(body).data?.error;
  if (said === undefined) return "";
  const words = [said.status, said.message.slice(0, 200)].filter((part) => part !== "").join(", ");
  return words === "" ? "" : `: ${words}`;
}

const Reply = z.looseObject({
  routes: z
    .array(
      z.looseObject({
        legs: z.array(z.looseObject({ duration: z.string(), distanceMeters: z.number().optional() })),
        polyline: z.looseObject({ encodedPolyline: z.string() }).optional(),
      }),
    )
    .min(1),
});

const legOf = (leg: { duration: string; distanceMeters?: number }): Leg => ({
  seconds: Number.parseInt(leg.duration, 10) || 0,
  meters: leg.distanceMeters ?? 0,
});

const at = (point: Point) => `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`;

/** The picture's address, without the key: each stop a marker in its route's colour, numbered, and the road drawn. */
export function staticMapQuery(routes: readonly MapRoute[]): URLSearchParams {
  const query = new URLSearchParams({ size: "640x400", scale: "2", region: "in", format: "png" });
  for (const route of routes) {
    route.stops.forEach((stop, index) => {
      query.append("markers", `color:0x${route.colour}|label:${String((index + 1) % 10)}|${at(stop)}`);
    });
    const line = route.polyline === null ? route.stops.map(at).join("|") : `enc:${route.polyline}`;
    if (route.stops.length > 1) query.append("path", `color:0x${route.colour}cc|weight:4|${line}`);
  }
  return query;
}

export function createGoogleRoutes(apiKey: string, deps: VendorFetchDependencies): RoutesProvider {
  return {
    async route(stops): Promise<RouteResult> {
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (first === undefined || last === undefined || stops.length < 2) return { ok: true, legs: [], polyline: null };
      const response = await vendorFetch(
        deps,
        { vendor: "google", step: "compute_routes", timeoutMs: TIMEOUT_MS },
        ROUTES_URL,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": "routes.legs.duration,routes.legs.distanceMeters,routes.polyline.encodedPolyline",
          },
          body: JSON.stringify({
            origin: waypoint(first),
            destination: waypoint(last),
            intermediates: stops.slice(1, -1).map(waypoint),
            travelMode: "DRIVE",
            routingPreference: "TRAFFIC_UNAWARE",
            polylineQuality: "OVERVIEW",
          }),
        },
      );
      if (response instanceof VendorUnreachable) return { ok: false, detail: response.message };
      if (!response.ok)
        return { ok: false, detail: `HTTP ${String(response.status)}${why(await response.json().catch(() => null))}` };
      const reply = Reply.safeParse(await response.json().catch(() => null));
      const route = reply.data?.routes[0];
      if (route === undefined) return { ok: false, detail: "no route in the answer" };
      return { ok: true, legs: route.legs.map(legOf), polyline: route.polyline?.encodedPolyline ?? null };
    },

    async map(routes): Promise<MapResult> {
      const query = staticMapQuery(routes);
      query.set("key", apiKey);
      const response = await vendorFetch(
        deps,
        { vendor: "google", step: "static_map", timeoutMs: TIMEOUT_MS },
        `${STATIC_MAP_URL}?${query.toString()}`,
      );
      if (response instanceof VendorUnreachable) return { ok: false, detail: response.message };
      const contentType = response.headers.get("Content-Type") ?? "";
      if (!response.ok || !contentType.startsWith("image/")) {
        return { ok: false, detail: `HTTP ${String(response.status)}` };
      }
      return { ok: true, image: await response.arrayBuffer(), contentType };
    },
  };
}
