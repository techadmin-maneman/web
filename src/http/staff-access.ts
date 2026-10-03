// The Staff list on every ops call. Each route asks for a department at a level (src/policy/console-routes.ts); the
// caller's grants answer it (src/policy/access.ts). While the list is not enforced nothing is refused or narrowed, and
// what would have been refused is logged under the call's request ID, which its audit entry shares.

import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { routePath } from "hono/route";
import { cityOf, type PlacedRecord } from "../domain/places.ts";
import { callerAccessOf } from "../domain/staff.ts";
import { placesReached, reachesCity, type CallerAccess, type PlacesReached } from "../policy/access.ts";
import { meetsNeed, needOf, OWN_DEPARTMENTS, SIGNED_IN, type RouteNeed } from "../policy/console-routes.ts";
import type { AppEnv } from "./context.ts";
import { errorBody } from "./errors.ts";

/** The caller as the Staff list sees them, read once per call. */
export async function callerAccess(c: Context<AppEnv>): Promise<CallerAccess> {
  const held = c.var.staffAccess;
  if (held !== undefined) return held;
  const identity = c.var.accessIdentity;
  if (identity === undefined) throw new Error("ops routes run after requireAccess");
  const access = await callerAccessOf(c.env.DB, identity);
  c.set("staffAccess", access);
  return access;
}

const meets = (access: CallerAccess, need: RouteNeed): boolean => meetsNeed(access.caller, need, access.zoneOf);

/**
 * Whether a call goes ahead: when it is allowed, and, while the list is not enforced, when it is not, with a line in
 * the log saying what would have been refused.
 */
export function goesAhead(c: Context<AppEnv>, access: CallerAccess, allowed: boolean, asked: string): boolean {
  if (allowed) return true;
  const fields = { route: routePath(c, -1), method: c.req.method, asked, caller: access.caller.kind };
  if (!access.enforced) {
    c.var.log.warn("staff_access_would_refuse", fields);
    return true;
  }
  c.var.log.warn("staff_access_refused", fields);
  return false;
}

const askedOf = (need: RouteNeed | undefined): string =>
  need === undefined ? "unlisted" : `${need.department}:${need.level}`;

/** Refuses a call the caller's grants do not reach, once the list is enforced. Follows auditCall. */
export const requireStaffAccess = createMiddleware<AppEnv>(async (c, next) => {
  const need = needOf(c.req.method, routePath(c, -1));
  if (need === SIGNED_IN) return next();
  const access = await callerAccess(c);
  const allowed = need !== undefined && meets(access, need);
  if (goesAhead(c, access, allowed, askedOf(need))) return next();
  return c.json(errorBody("not_permitted", c.var.requestId), 403);
});

/** For a choice inside a route that asks more than the route does, as waiving a no-show's charge does. */
export async function permits(c: Context<AppEnv>, need: RouteNeed): Promise<boolean> {
  const access = await callerAccess(c);
  return goesAhead(c, access, meets(access, need), askedOf(need));
}

/**
 * The places this route's work reaches for the caller: everywhere, or the cities their grants name in the route's
 * department at the route's level. For a route that keeps to the caller's own places (`ownPlaces`).
 */
export async function routeReach(c: Context<AppEnv>): Promise<PlacesReached> {
  const need = needOf(c.req.method, routePath(c, -1));
  if (need === undefined || need === SIGNED_IN || need.department === OWN_DEPARTMENTS) {
    throw new Error("only a route of one department keeps to the caller's places");
  }
  return placesReached(await callerAccess(c), need.department, need.level);
}

/** Whether a record is within this route's reach for the caller. One with no city is reached only everywhere. */
export async function withinRouteReach(c: Context<AppEnv>, kind: PlacedRecord, id: string): Promise<boolean> {
  const reached = await routeReach(c);
  if (reached.kind === "everywhere") return true;
  return reachesCity(reached, await cityOf(c.env.DB, kind, id));
}
