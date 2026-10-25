// A grant of one city opens no record of another (src/policy/console-routes.ts, `ownPlaces`). Every console read that
// keeps to the caller's places is called by a member of staff with every department's Manage in Delhi alone, for a
// client, their visit and payment, a technician, a stockroom and its count in Gurgaon: each answers not found, or
// names none of them. A new read of that kind is walked as soon as it is listed. The same reads with a Gurgaon grant
// show them, so the walk proves something; and the inventory's writes refuse a Gurgaon record as not found. NOW is
// Monday 21 September 2026, 12 noon in India. Every name, number and ID is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { DEPARTMENTS } from "../../../src/policy/access.ts";
import { ROUTE_NEEDS, SIGNED_IN } from "../../../src/policy/console-routes.ts";
import type { App } from "../../../src/http/context.ts";
import { aPayment, aPerson, anAddress, aTechnician, aVisit } from "../fixtures/index.ts";
import { AT, writeRow } from "../fixtures/rows.ts";
import { captureLogs, markDatabase, request } from "../helpers.ts";
import { enforce, listStaff, opsAs, person, post } from "./staff-fixtures.ts";

const CLIENT = "11111111-1111-4111-8111-111111114411";
const CLIENT_NAME = "Zoya Kapadia";
const CLIENT_MOBILE = "+919660004411";
const VISIT = "22222222-2222-4222-8222-222222224411";
const TECHNICIAN = "33333333-3333-4333-8333-333333334411";
const TECHNICIAN_NAME = "Tariq Faridi";
const STOCKROOM = "gurgaon-stockroom";
const TASK = "55555555-5555-4555-8555-555555554411";
const ELSEWHERE_ID = "99999999-9999-4999-8999-999999999999";

/** What would show a Gurgaon record leaked into an answer. */
const MARKERS = [CLIENT, CLIENT_NAME, CLIENT_MOBILE.slice(3), VISIT, TECHNICIAN, TECHNICIAN_NAME, STOCKROOM, TASK];

/** The query each read needs to answer at all, where it needs one. */
const QUERIES: Readonly<Record<string, string>> = {
  "GET /api/dispatch": "?from=2026-09-21",
  "GET /api/dispatch/day": "?date=2026-09-22",
  "GET /api/dispatch/day/map": "?date=2026-09-22",
  "GET /api/dispatch/room": `?appointment_id=${VISIT}&from=2026-09-21`,
  "GET /api/visits/availability": `?client=${CLIENT}&kind=service&from=2026-09-22`,
  "GET /api/stock/units": `?consumable_code=tape_strips&place_id=${STOCKROOM}`,
  "GET /api/technicians/work": "?from=2026-09-01&to=2026-09-30",
  "GET /api/technician-pay": "?month=2026-09",
  "GET /api/technician-pay/statement": `?technician_id=${TECHNICIAN}&month=2026-09`,
  "GET /api/pincode-directory/districts": "?state=HARYANA",
  "GET /api/pincode-launches/readiness": "?city=Gurgaon",
  "GET /api/pincode-directory/pincodes": "?state=HARYANA&district=GURGAON",
};

/** A route's path with the Gurgaon record its placeholders name. */
function pathOf(route: string): string {
  const [, path = ""] = route.split(" ");
  const filled = path
    .replace(/^\/api\/clients\/\{id\}/, `/api/clients/${CLIENT}`)
    .replace(/^\/api\/technicians\/\{id\}/, `/api/technicians/${TECHNICIAN}`)
    .replace(/^\/api\/count-tasks\/\{id\}/, `/api/count-tasks/${TASK}`)
    .replace("{code}", "tape_strips")
    .replace(/\{[a-z_]+\}/g, ELSEWHERE_ID);
  return filled + (QUERIES[route] ?? "");
}

/** Every console read a grant of one place may call. */
const NARROWED_READS = Object.entries(ROUTE_NEEDS)
  .filter(([route, need]) => route.startsWith("GET ") && need !== SIGNED_IN && need.ownPlaces === true)
  .map(([route]) => route);

/** Every department's Manage, in one city. */
async function staffIn(city: string): Promise<App> {
  await enforce();
  await listStaff(
    "city-lead@maneman.in",
    DEPARTMENTS.map((department) => `${department}:manage:city:${city}` as const),
  );
  return opsAs(person("city-lead@maneman.in"));
}

const read = (app: App, route: string) => request(app, pathOf(route));

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  for (const [pincode, area, city] of [
    ["110017", "Saket", "Delhi"],
    ["122018", "Sector 65", "Gurgaon"],
  ] as const) {
    await writeRow("serviceable_pincodes", { pincode, area, city, served: 1 }, {});
  }
  await aTechnician({ id: TECHNICIAN, name: TECHNICIAN_NAME, initials: "TF", city: "Gurgaon" });
  await aPerson({ id: CLIENT, name: CLIENT_NAME, mobile_e164: CLIENT_MOBILE });
  await anAddress(CLIENT);
  await aVisit({ id: VISIT, person_id: CLIENT, technician_id: TECHNICIAN });
  await aPayment({ person_id: CLIENT, appointment_id: VISIT });
  await writeRow(
    "consumables",
    { code: "tape_strips", name: "Tape strips", unit: "strip", unit_cost: 1200, created_at: AT, updated_at: AT },
    {},
  );
  await writeRow(
    "stock_places",
    {
      id: STOCKROOM,
      kind: "stockroom",
      name: "Gurgaon stockroom",
      city: "Gurgaon",
      parent_id: "central",
      active: 1,
      created_by: "test",
      created_at: AT,
    },
    {},
  );
  await writeRow("stock_balances", { consumable_code: "tape_strips", place: STOCKROOM, quantity: 40 }, {});
  await writeRow(
    "count_tasks",
    { id: TASK, place_id: STOCKROOM, count_class: "weekly", due_on: "2026-09-22", state: "open", raised_at: AT },
    {},
  );
  await writeRow(
    "grievances",
    { id: crypto.randomUUID(), person_id: CLIENT, text: "The fit lifted.", state: "open", created_at: AT },
    {},
  );
  await writeRow(
    "deletion_requests",
    { id: crypto.randomUUID(), person_id: CLIENT, created_at: AT, state: "requested" },
    {},
  );
});

describe("a grant of one city", () => {
  it("walks every read that keeps to the caller's places", () => {
    expect(NARROWED_READS.length).toBeGreaterThan(30);
  });

  it.each(NARROWED_READS)("finds no record of another city at %s", async (route) => {
    const res = await read(await staffIn("Delhi"), route);
    // A read the walk cannot fill in answers 400: give it its query in QUERIES.
    expect([200, 404], `${route} answered ${String(res.status)}`).toContain(res.status);
    const body = await res.text();
    expect(
      MARKERS.filter((marker) => body.includes(marker)),
      route,
    ).toEqual([]);
  });

  it("is shown the same records where they are in its city", async () => {
    const app = await staffIn("Gurgaon");
    const bodies = await Promise.all(
      ["GET /api/clients/{id}", "GET /api/technicians", "GET /api/stock", "GET /api/count-tasks"].map(async (route) =>
        (await read(app, route)).text(),
      ),
    );
    expect(bodies[0]).toContain(CLIENT_NAME);
    expect(bodies[1]).toContain(TECHNICIAN);
    expect(bodies[2]).toContain(STOCKROOM);
    expect(bodies[3]).toContain(TASK);
  });
});

describe("the inventory's writes, from another city", () => {
  const LINES = { lines: [{ consumable_code: "tape_strips", counted: 38 }] };

  it.each([
    ["/api/count-tasks", { place_id: STOCKROOM, consumable_code: "tape_strips" }],
    [`/api/count-tasks/${TASK}/counts`, LINES],
    [`/api/count-tasks/${TASK}/recounts`, LINES],
    [`/api/count-tasks/${TASK}/sign-off`, { note: "Counted twice." }],
    ["/api/stock/counts", { consumable_code: "tape_strips", place_id: STOCKROOM, counted: 38 }],
    ["/api/stock/write-offs", { consumable_code: "tape_strips", place_id: STOCKROOM, quantity: 1, note: "Spilt" }],
    ["/api/stock/transfers", { consumable_code: "tape_strips", quantity: 1, from: STOCKROOM, to: "central" }],
    [
      `/api/clients/${CLIENT}/custom-orders`,
      { supplier_id: ELSEWHERE_ID, supplier_price: 1000, amount: 2_000_000, promised_on: null, wave: null, note: null },
    ],
  ])("refuses %s as not found", async (path, body) => {
    const res = await post(await staffIn("Delhi"), path, body);
    expect(res.status).toBe(404);
    expect(
      await env.DB.prepare("SELECT quantity FROM stock_balances WHERE place = ?1").bind(STOCKROOM).first(),
    ).toEqual({
      quantity: 40,
    });
  });
});
