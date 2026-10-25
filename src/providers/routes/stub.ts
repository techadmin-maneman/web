// Drive times and a map with no Google behind them, for local work and the tests: each leg a 20-minute, 7 km drive,
// and the map a plain picture that says what it is.

import type { RoutesProvider } from "./index.ts";

const STUB_LEG = { seconds: 20 * 60, meters: 7_000 } as const;

const stubPicture = (says: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><rect width="640" height="400" fill="#e8e4dc"/><text x="320" y="205" font-family="sans-serif" font-size="20" text-anchor="middle" fill="#555">${says}</text></svg>`;

const STUB_MAP = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><rect width="640" height="400" fill="#e8e4dc"/><text x="320" y="205" font-family="sans-serif" font-size="20" text-anchor="middle" fill="#555">Day map (stub)</text></svg>`;

export function createStubRoutes(): RoutesProvider {
  return {
    route: (stops) => Promise.resolve({ ok: true, legs: stops.slice(1).map(() => STUB_LEG), polyline: null }),
    map: () =>
      Promise.resolve({
        ok: true,
        image: new TextEncoder().encode(STUB_MAP).buffer as ArrayBuffer,
        contentType: "image/svg+xml",
      }),
    areaMap: () =>
      Promise.resolve({
        ok: true,
        image: new TextEncoder().encode(stubPicture("Area map (stub)")).buffer as ArrayBuffer,
        contentType: "image/svg+xml",
      }),
  };
}
