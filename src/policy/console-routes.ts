// What each ops route asks of its caller: a department, and the lowest level that may call it. VIEW reads, ACT is
// everyday work, MANAGE is money given back or waived, prices, codes, settings, erasures and access.
//
// A route needs a national grant unless it keeps to the caller's own places itself (`ownPlaces`): until a list or a
// record is narrowed to the caller's cities, a grant of one city or zone must not open it everywhere.

import type { Department, Level } from "./access.ts";

export interface RouteNeed {
  readonly department: Department;
  readonly level: Level;
  /** The route narrows what it reads or changes to the caller's places, so a grant over any place lets them in. */
  readonly ownPlaces?: true;
}

/** Anyone Access lets in: the health check, and who is signed in, which says what they may do. */
export const SIGNED_IN = "signed_in";

const need = (department: Department, level: Level): RouteNeed => ({ department, level });
const inOwnPlaces = (department: Department, level: Level): RouteNeed => ({ department, level, ownPlaces: true });

/** Every ops route, as "METHOD /path" with the OpenAPI document's placeholders. A route not here is refused. */
export const ROUTE_NEEDS: Readonly<Record<string, RouteNeed | typeof SIGNED_IN>> = {
  "GET /api/health": SIGNED_IN,
  "GET /api/whoami": SIGNED_IN,

  // Operations: dispatch, today's tasks, visits, technicians, leave and stock.
  "GET /api/dispatch": need("operations", "view"),
  "GET /api/dispatch/room": need("operations", "view"),
  "POST /api/dispatch/assign": need("operations", "act"),
  "POST /api/dispatch/move": need("operations", "act"),
  "POST /api/dispatch/moves/{id}/told": need("operations", "act"),
  "GET /api/tasks": need("operations", "view"),
  "PUT /api/tasks/{group}/{id}/owner": need("operations", "act"),
  "POST /api/tasks/{group}/{id}/close": need("operations", "act"),
  "POST /api/held-bookings/{id}/retry": need("operations", "act"),
  "POST /api/held-bookings/{id}/stop": need("operations", "act"),
  "POST /api/held-bookings/{id}/link": need("operations", "act"),
  "GET /api/technicians": need("operations", "view"),
  "GET /api/technicians/work": need("operations", "view"),
  "POST /api/technicians/{id}/leave": need("operations", "act"),
  "POST /api/technicians/{id}/leave/{leave}/cancel": need("operations", "act"),
  "POST /api/technicians/{id}/devices/{device}/revoke": need("operations", "act"),
  "GET /api/stock": need("operations", "view"),
  "POST /api/stock/deliveries": need("operations", "act"),
  "POST /api/stock/transfers": need("operations", "act"),
  "POST /api/stock/counts": need("operations", "act"),
  "POST /api/stock/write-offs": need("operations", "act"),

  // Customer Care: clients, their requests, grievances, number changes and deletions.
  "POST /api/clients/search": need("customer_care", "view"),
  "POST /api/clients/find": need("customer_care", "view"),
  "GET /api/clients/{id}": need("customer_care", "view"),
  "GET /api/clients/{id}/photos": need("customer_care", "view"),
  "POST /api/clients/{id}/photos/view": need("customer_care", "view"),
  "GET /api/clients/{id}/photos/{photo_id}": need("customer_care", "view"),
  "GET /api/clients/{id}/consents": need("customer_care", "view"),
  "GET /api/clients/{id}/pieces": need("customer_care", "view"),
  "GET /api/clients/{id}/hair-profile": need("customer_care", "view"),
  "POST /api/clients/{id}/hair-profile": need("customer_care", "act"),
  "POST /api/clients/{id}/address/suggestions": need("customer_care", "act"),
  "POST /api/clients/{id}/address": need("customer_care", "act"),
  "GET /api/grievances": need("customer_care", "view"),
  "POST /api/grievances/{id}/resolve": need("customer_care", "act"),
  "GET /api/number-changes": need("customer_care", "view"),
  "POST /api/number-changes/{id}/decision": need("customer_care", "act"),
  "GET /api/deletion-requests": need("customer_care", "view"),
  "POST /api/deletion-requests/{id}/decision": need("customer_care", "manage"),

  // Finance: payments, refunds, no-show charges and their disputes, discount codes and prices. Waiving a charge and
  // refunding a disputed one ask MANAGE inside their routes (WAIVING_A_NO_SHOW, REFUNDING_A_DISPUTE).
  "GET /api/payments": need("finance", "view"),
  "GET /api/no-shows": need("finance", "view"),
  "POST /api/no-shows/{id}/decision": need("finance", "act"),
  "GET /api/no-shows/disputes": need("finance", "view"),
  "POST /api/no-shows/disputes/{id}/ruling": need("finance", "act"),
  "POST /api/held-bookings/{id}/refund": need("finance", "manage"),
  "POST /api/clients/{id}/credits": need("finance", "manage"),
  "GET /api/discount-codes": need("finance", "view"),
  "POST /api/discount-codes": need("finance", "manage"),
  "POST /api/discount-codes/{id}/off": need("finance", "manage"),
  "POST /api/visits/{id}/discount-code": need("finance", "act"),
  "POST /api/visits/{id}/discount-code/remove": need("finance", "act"),
  "GET /api/prices": need("finance", "view"),
  "POST /api/prices": need("finance", "manage"),
  "POST /api/prices/correct": need("finance", "manage"),
  "POST /api/prices/withdraw": need("finance", "manage"),

  // Growth: referrals, the waitlist, and launching areas.
  "GET /api/referrals/held": need("growth", "view"),
  "POST /api/referrals/{id}/decision": need("growth", "act"),
  "GET /api/referrers": need("growth", "view"),
  "POST /api/clients/{id}/referral": need("growth", "act"),
  "GET /api/waitlist": need("growth", "view"),
  "POST /api/pincodes/{pin}/launch": need("growth", "manage"),
  "GET /api/service-area": need("growth", "view"),
  "POST /api/service-area": need("growth", "manage"),

  // Admin: the settings, and staff and access.
  "GET /api/settings": need("admin", "view"),
  "POST /api/settings/{name}": need("admin", "manage"),
  "GET /api/slot-times": need("admin", "view"),
  "POST /api/slot-times": need("admin", "manage"),
  "GET /api/blackouts": need("admin", "view"),
  "POST /api/blackouts": need("admin", "manage"),
  "POST /api/blackouts/remove": need("admin", "manage"),
  "GET /api/services": need("admin", "view"),
  "POST /api/services": need("admin", "manage"),
  "POST /api/services/{kind}/{tier}/name": need("admin", "manage"),
  "POST /api/services/{kind}/{tier}/length": need("admin", "manage"),
  "POST /api/services/{kind}/order": need("admin", "manage"),
  "POST /api/services/{kind}/{tier}/retire": need("admin", "manage"),
  "POST /api/services/{kind}/{tier}/restore": need("admin", "manage"),
  "GET /api/consumables": need("admin", "view"),
  "POST /api/consumables": need("admin", "manage"),
  "POST /api/consumables/{code}": need("admin", "manage"),
  "POST /api/consumables/{code}/retire": need("admin", "manage"),
  "POST /api/consumables/{code}/restore": need("admin", "manage"),
  "POST /api/service-usage": need("admin", "manage"),
  "GET /api/job-sheet": need("admin", "view"),
  "POST /api/job-sheet/checklists/{visit_type}": need("admin", "manage"),
  "POST /api/job-sheet/partial-reasons": need("admin", "manage"),
  "GET /api/storage": need("admin", "view"),
  "GET /api/staff": inOwnPlaces("admin", "view"),
  "POST /api/staff": inOwnPlaces("admin", "manage"),
  "POST /api/staff/enforcement": need("admin", "manage"),
  "POST /api/staff/service-tokens": need("admin", "manage"),
  "POST /api/staff/service-tokens/remove": need("admin", "manage"),
};

/** Waiving a no-show's charge gives money back, so it asks more than charging it does. */
export const WAIVING_A_NO_SHOW: RouteNeed = need("finance", "manage");
/** Refunding a disputed charge, where upholding it keeps the money. */
export const REFUNDING_A_DISPUTE: RouteNeed = need("finance", "manage");

/** Hono answers HEAD with the GET route, so HEAD asks what GET asks. */
function listedMethod(method: string): string {
  const upper = method.toUpperCase();
  return upper === "HEAD" ? "GET" : upper;
}

/** What a route asks, from its method and Hono's path, "/api/clients/:id"; undefined for a route not listed. */
export function needOf(method: string, honoPath: string): RouteNeed | typeof SIGNED_IN | undefined {
  const key = `${listedMethod(method)} ${honoPath.replace(/:(\w+)/g, "{$1}")}`;
  return Object.hasOwn(ROUTE_NEEDS, key) ? ROUTE_NEEDS[key] : undefined;
}
