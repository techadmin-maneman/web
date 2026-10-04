// What each ops route asks of its caller: a department, and the lowest level that may call it. VIEW reads, ACT is
// everyday work, MANAGE is money given back or waived, prices, codes, settings, erasures and access.
//
// A route needs a national grant unless it keeps to the caller's own places itself (`ownPlaces`): until a list or a
// record is narrowed to the caller's cities, a grant of one city or zone must not open it everywhere. What is the same
// in every place, as prices are, any place's View may read; changing it needs a national grant.

import { can, DEPARTMENTS, NATIONAL, type Caller, type Department, type Level, type ZoneOfCity } from "./access.ts";
import type { TaskGroup } from "./tasks.ts";

/** A route that keeps to the caller's own departments, as Tasks lists each department its own groups. */
export const OWN_DEPARTMENTS = "own";

export interface RouteNeed {
  /** OWN_DEPARTMENTS: a grant in any department lets them in. */
  readonly department: Department | typeof OWN_DEPARTMENTS;
  readonly level: Level;
  /**
   * The route narrows what it reads or changes to the caller's places, or reads only what is the same in every place,
   * so a grant over any place lets them in.
   */
  readonly ownPlaces?: true;
}

/** Anyone Access lets in: the health check, who is signed in and what they may do, and the console's own errors. */
export const SIGNED_IN = "signed_in";

const need = (department: Department, level: Level): RouteNeed => ({ department, level });
const readFromAnyPlace = (department: Department): RouteNeed => ({ department, level: "view", ownPlaces: true });
const inOwnPlaces = (department: Department, level: Level): RouteNeed => ({ department, level, ownPlaces: true });
const inOwnDepartments = (level: Level): RouteNeed => ({ department: OWN_DEPARTMENTS, level });

/** Every ops route, as "METHOD /path" with the OpenAPI document's placeholders. A route not here is refused. */
export const ROUTE_NEEDS: Readonly<Record<string, RouteNeed | typeof SIGNED_IN>> = {
  "GET /api/health": SIGNED_IN,
  "GET /api/whoami": SIGNED_IN,
  "POST /api/client-errors": SIGNED_IN,

  // Operations: dispatch, today's tasks, visits, technicians, leave and stock.
  "GET /api/dispatch": need("operations", "view"),
  "GET /api/dispatch/room": need("operations", "view"),
  "POST /api/dispatch/assign": need("operations", "act"),
  "POST /api/dispatch/move": need("operations", "act"),
  "POST /api/dispatch/moves/{id}/told": need("operations", "act"),
  // Each department sees its own groups of tasks, and Act takes one of them or gives it to someone (TASK_DEPARTMENTS).
  "GET /api/tasks": inOwnDepartments("view"),
  "PUT /api/tasks/{group}/{id}/owner": inOwnDepartments("act"),
  "POST /api/tasks/{group}/{id}/close": need("operations", "act"),
  "POST /api/held-bookings/{id}/retry": need("operations", "act"),
  "POST /api/held-bookings/{id}/stop": need("operations", "act"),
  "POST /api/held-bookings/{id}/link": need("operations", "act"),
  "GET /api/visits/availability": need("operations", "view"),
  "POST /api/visits": need("operations", "act"),
  // Free to the client unless ops apply the client's own terms, as an ops move is free: everyday work, not a waiver.
  "POST /api/visits/{id}/cancel": need("operations", "act"),
  "POST /api/visits/{id}/close": need("operations", "act"),
  "GET /api/technicians": need("operations", "view"),
  "GET /api/technicians/work": need("operations", "view"),
  // Who signs in to the technician app, and so sees clients' addresses: access, so MANAGE.
  "POST /api/technicians": need("operations", "manage"),
  "PATCH /api/technicians/{id}": need("operations", "manage"),
  "POST /api/technicians/{id}/deactivate": need("operations", "manage"),
  "POST /api/technicians/{id}/reactivate": need("operations", "manage"),
  "POST /api/technicians/{id}/leave": need("operations", "act"),
  "POST /api/technicians/{id}/leave/{leave}/cancel": need("operations", "act"),
  "POST /api/technicians/{id}/devices/{device}/revoke": need("operations", "act"),
  "GET /api/stock": need("operations", "view"),
  "POST /api/stock/deliveries": need("operations", "act"),
  "POST /api/stock/transfers": need("operations", "act"),
  "POST /api/stock/counts": need("operations", "act"),
  "POST /api/stock/write-offs": need("operations", "act"),

  // Customer Care: clients, their requests, grievances, number changes and deletions, each kept to the caller's cities.
  "POST /api/clients/search": inOwnPlaces("customer_care", "view"),
  "POST /api/clients/find": inOwnPlaces("customer_care", "view"),
  "GET /api/clients/{id}": inOwnPlaces("customer_care", "view"),
  "GET /api/clients/{id}/photos": inOwnPlaces("customer_care", "view"),
  "POST /api/clients/{id}/photos/view": inOwnPlaces("customer_care", "view"),
  "GET /api/clients/{id}/photos/{photo_id}": inOwnPlaces("customer_care", "view"),
  "GET /api/clients/{id}/consents": inOwnPlaces("customer_care", "view"),
  "GET /api/clients/{id}/pieces": inOwnPlaces("customer_care", "view"),
  "GET /api/clients/{id}/hair-profile": inOwnPlaces("customer_care", "view"),
  "POST /api/clients/{id}/hair-profile": inOwnPlaces("customer_care", "act"),
  "POST /api/clients/{id}/address/suggestions": inOwnPlaces("customer_care", "act"),
  "POST /api/clients/{id}/address": inOwnPlaces("customer_care", "act"),
  "GET /api/grievances": inOwnPlaces("customer_care", "view"),
  "POST /api/grievances/{id}/resolve": inOwnPlaces("customer_care", "act"),
  "GET /api/number-changes": inOwnPlaces("customer_care", "view"),
  "POST /api/number-changes/{id}/decision": inOwnPlaces("customer_care", "act"),
  "GET /api/deletion-requests": inOwnPlaces("customer_care", "view"),
  "POST /api/deletion-requests/{id}/decision": inOwnPlaces("customer_care", "manage"),
  "POST /api/clients/{id}/erasure": inOwnPlaces("customer_care", "manage"),

  // Finance: payments, refunds, no-show charges and their disputes, credits, discount codes and prices. A day's money,
  // no-shows, disputes, credits and a code on a visit keep to the caller's cities. Codes and prices are the same in
  // every place: any place's View reads them, and changing them needs a national grant. Waiving a charge and refunding
  // a disputed one ask MANAGE inside their routes (WAIVING_A_NO_SHOW, REFUNDING_A_DISPUTE). Held bookings wait on FSM,
  // which is leaving, so refunding one stays national. The price book lists every service with its prices, so reading
  // it is Finance's; changing a service stays Admin's.
  "GET /api/payments": inOwnPlaces("finance", "view"),
  "GET /api/no-shows": inOwnPlaces("finance", "view"),
  "POST /api/no-shows/{id}/decision": inOwnPlaces("finance", "act"),
  "GET /api/no-shows/disputes": inOwnPlaces("finance", "view"),
  "POST /api/no-shows/disputes/{id}/ruling": inOwnPlaces("finance", "act"),
  "POST /api/held-bookings/{id}/refund": need("finance", "manage"),
  "POST /api/clients/{id}/credits": inOwnPlaces("finance", "manage"),
  "GET /api/discount-codes": readFromAnyPlace("finance"),
  "POST /api/discount-codes": need("finance", "manage"),
  "POST /api/discount-codes/{id}/off": need("finance", "manage"),
  "POST /api/visits/{id}/discount-code": inOwnPlaces("finance", "act"),
  "POST /api/visits/{id}/discount-code/remove": inOwnPlaces("finance", "act"),
  "GET /api/prices": readFromAnyPlace("finance"),
  "POST /api/prices": need("finance", "manage"),
  "POST /api/prices/correct": need("finance", "manage"),
  "POST /api/prices/withdraw": need("finance", "manage"),
  "GET /api/services": readFromAnyPlace("finance"),

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

/** Waiving a no-show's charge gives money back, so it asks more than charging it does, in the case's city. */
export const WAIVING_A_NO_SHOW: RouteNeed = inOwnPlaces("finance", "manage");
/** Refunding a disputed charge, where upholding it keeps the money, in the dispute's city. */
export const REFUNDING_A_DISPUTE: RouteNeed = inOwnPlaces("finance", "manage");

/** The department that decides each group of tasks: its people see the group on Tasks, and Act may take a task of it. */
export const TASK_DEPARTMENTS: Readonly<Record<TaskGroup, Department>> = {
  untold_move: "operations",
  held_booking: "operations",
  leave_conflict: "operations",
  address_to_confirm: "customer_care",
  consultation_request: "customer_care",
  first_fit_to_book: "customer_care",
  replacement_order: "operations",
  at_risk_client: "customer_care",
  partial_visit: "operations",
  referral_review: "growth",
  no_show_decision: "finance",
  number_change: "customer_care",
  erasure_request: "customer_care",
  grievance: "customer_care",
  draft_invoice: "finance",
  payment_owed: "finance",
  erasure_unfinished: "customer_care",
};

/** What seeing a group of tasks, or taking a task of it, asks. */
export const taskNeed = (group: TaskGroup, level: Level): RouteNeed => need(TASK_DEPARTMENTS[group], level);

/** Whether the caller's grants reach what a route asks: over any place if it keeps to their own, nationally if not. */
export function meetsNeed(caller: Caller, need: RouteNeed, zoneOf: ZoneOfCity): boolean {
  const where = need.ownPlaces === true ? "anywhere" : NATIONAL;
  const departments = need.department === OWN_DEPARTMENTS ? DEPARTMENTS : [need.department];
  return departments.some((department) => can(caller, department, need.level, where, zoneOf));
}

/** The routes a caller's calls go ahead on, as "GET /api/tasks": every one while the list is not enforced. */
export function routesOpenTo(caller: Caller, enforced: boolean, zoneOf: ZoneOfCity): string[] {
  const goesAhead = (need: RouteNeed | typeof SIGNED_IN): boolean =>
    !enforced || need === SIGNED_IN || meetsNeed(caller, need, zoneOf);
  return Object.entries(ROUTE_NEEDS)
    .filter(([, need]) => goesAhead(need))
    .map(([route]) => route);
}

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
