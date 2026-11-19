// Google's drives between pins (ADR 0120), kept a day in Cloudflare's cache, each miss counted against the day's
// ceiling: for the dispatch board's day on the road, and for booking's check of the drives either side of a start.

import { sha256Hex } from "../../lib/hash.ts";
import type { Alert } from "../../providers/alerts.ts";
import type { Point, RouteResult, RoutesProvider } from "../../providers/routes/index.ts";
import type { CountedAt } from "../sign-in/rate-limit.ts";
import { withinCeiling } from "./ceilings.ts";

/** How long a drive Google answered is kept: the road between two pins changes rarely, and each answer costs a call. */
const KEPT_SECONDS = 24 * 60 * 60;

/** Where a drive through these pins is kept. */
const keyOf = async (points: readonly Point[]): Promise<Request> =>
  new Request(`https://routes.cache.maneman.in/${await sha256Hex(JSON.stringify(points))}`);

/** Google's drive through these pins where one is kept, asking Google nothing; null where none is. */
export async function keptDriveThrough(points: readonly Point[]): Promise<RouteResult | null> {
  const kept = await caches.default.match(await keyOf(points)).catch(() => undefined);
  return kept === undefined ? null : kept.json<RouteResult>();
}

/** Google's drive through these pins, kept a day; a miss counts against the day's ceiling. */
export async function driveThrough(
  db: D1Database,
  deps: { readonly routes: RoutesProvider; readonly alert: Alert },
  { points, at }: { points: readonly Point[]; at: CountedAt },
): Promise<RouteResult> {
  const key = await keyOf(points);
  const kept = await caches.default.match(key).catch(() => undefined);
  if (kept !== undefined) return kept.json<RouteResult>();
  if (!(await withinCeiling(db, deps.alert, "route", at))) return { ok: false, detail: "the day's ceiling is spent" };
  const answer = await deps.routes.route(points);
  if (answer.ok) {
    const keeping = new Response(JSON.stringify(answer), {
      headers: { "Cache-Control": `max-age=${String(KEPT_SECONDS)}` },
    });
    await caches.default.put(key, keeping).catch(() => undefined);
  }
  return answer;
}
