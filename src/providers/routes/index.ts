// Drive times and the day map on the dispatch board, behind an interface (ADR 0120). Only this file knows which
// implementation runs, and only google.ts knows Google. Every call goes through our API: the console never holds the
// key, and its policy is img-src 'self'.

import { createGoogleRoutes } from "./google.ts";
import { createStubRoutes } from "./stub.ts";
import type { VendorFetchDependencies } from "../vendor-fetch.ts";

export interface Point {
  readonly lat: number;
  readonly lng: number;
}

/** The drive from one stop to the next. */
export interface Leg {
  readonly seconds: number;
  readonly meters: number;
}

export type RouteResult =
  | { readonly ok: true; readonly legs: readonly Leg[]; readonly polyline: string | null }
  | { readonly ok: false; readonly detail: string };

/** One technician's day on the map: their colour, their stops in order, and the road between them where known. */
export interface MapRoute {
  /** Six hex digits, no #. */
  readonly colour: string;
  readonly stops: readonly Point[];
  readonly polyline: string | null;
}

export type MapResult =
  | { readonly ok: true; readonly image: ArrayBuffer; readonly contentType: string }
  | { readonly ok: false; readonly detail: string };

/**
 * A city's pincodes and its technicians' reach on one picture (docs/decisions/0223-reach-from-home.md): each group of
 * pincodes a small marker in its colour, each home a labelled one, and each reach a circle filled in its colour.
 */
export interface AreaMap {
  readonly pincodes: readonly { readonly colour: string; readonly points: readonly Point[] }[];
  readonly homes: readonly { readonly colour: string; readonly label: string; readonly point: Point }[];
  readonly reaches: readonly { readonly colour: string; readonly centre: Point; readonly km: number }[];
}

export interface RoutesProvider {
  /** The drive through the stops in their order: one leg between each two. */
  route(stops: readonly Point[]): Promise<RouteResult>;
  /** One picture of every route, each in its colour, its stops numbered in order. */
  map(routes: readonly MapRoute[]): Promise<MapResult>;
  /** One picture of a city's pincodes and its technicians' reach. */
  areaMap(area: AreaMap): Promise<MapResult>;
}

/** Whoever ROUTES_PROVIDER names; null for "none", where the board shows no drive times and no map. */
export function createRoutesProvider(
  provider: string,
  apiKey: string | null,
  deps: VendorFetchDependencies,
): RoutesProvider | null {
  if (provider === "google" && apiKey !== null) return createGoogleRoutes(apiKey, deps);
  if (provider === "stub") return createStubRoutes();
  return null;
}
