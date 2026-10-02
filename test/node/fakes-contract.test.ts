// The ops console's and the technician app's browser tests answer the API
// themselves (e2e/ops/fixtures.ts, e2e/tech/fixtures.ts). Nothing kept those
// answers honest but care (TCD-01): here every one of them is validated against
// the committed OpenAPI document, as e2e/contract.ts also does for each reply
// the browser tests send. A change to a route that leaves a fake behind fails
// here, before any browser runs.

import { describe, expect, it } from "vitest";
import { contractErrors } from "../../e2e/contract.ts";
import * as ops from "../../e2e/ops/fixtures.ts";
import * as tech from "../../e2e/tech/fixtures.ts";

const ID = "22000000-0000-4000-8000-000000000001";

describe("the contract the fakes are held to", () => {
  it("takes a body the document describes", () => {
    expect(contractErrors("ops", "GET", "/api/grievances", 200, ops.GRIEVANCES)).toEqual([]);
  });

  it("refuses a field the API never sends, and one it always does that is missing", () => {
    const [first] = ops.GRIEVANCES.grievances;
    const extra = { grievances: [{ ...first, answered: false }] };
    expect(contractErrors("ops", "GET", "/api/grievances", 200, extra).join()).toContain(
      '"additionalProperty":"answered"',
    );
    expect(contractErrors("ops", "GET", "/api/referrers", 200, { referrers: [] }).join()).toContain("more");
  });

  it("refuses a status the route never answers, and a method it does not take", () => {
    expect(contractErrors("ops", "GET", "/api/grievances", 409, { error: { code: "clash", request_id: "t" } })).toEqual(
      ["GET /api/grievances 409: /api/grievances never answers 409"],
    );
    expect(contractErrors("ops", "DELETE", "/api/grievances", 204)).toEqual([
      "DELETE /api/grievances 204: no such route in docs/openapi-ops.json",
    ]);
  });

  it("reads a path by its most literal route, so /api/technicians/work is not a technician's id", () => {
    expect(contractErrors("ops", "GET", "/api/technicians/work", 200, ops.TECHNICIAN_WORK)).toEqual([]);
    expect(contractErrors("ops", "GET", `/api/clients/${ID}/pieces`, 200, ops.PIECES)).toEqual([]);
  });

  it("allows what any route can answer: the database check's 503 and the error handler's 500", () => {
    const unavailable = { error: { code: "unavailable", request_id: "t" } };
    expect(contractErrors("ops", "GET", "/api/grievances", 503, unavailable)).toEqual([]);
    expect(
      contractErrors("tech", "GET", "/api/tech/me", 500, { error: { code: "internal_error", request_id: "t" } }),
    ).toEqual([]);
    expect(
      contractErrors("ops", "GET", "/api/grievances", 503, { error: { code: "clash", request_id: "t" } }),
    ).not.toEqual([]);
  });

  it("allows mm-api's own not-found for a path it has no route for, and nothing else there", () => {
    const notFound = { error: { code: "not_found", request_id: "t" } };
    expect(contractErrors("tech", "POST", "/api/tech/jobs/x/nothing", 404, notFound)).toEqual([]);
    expect(contractErrors("tech", "POST", "/api/tech/jobs/x/nothing", 202, {})).not.toEqual([]);
  });
});

const OPS_FIXTURES: readonly [method: string, path: string, name: string, body: unknown][] = [
  ["GET", "/api/referrals/held", "HELD", ops.HELD],
  ["GET", "/api/referrers", "REFERRERS", ops.REFERRERS],
  ["GET", "/api/waitlist", "AREAS", ops.AREAS],
  ["POST", "/api/pincodes/400050/launch", "PREVIEW", ops.PREVIEW],
  ["POST", "/api/pincodes/400050/launch", "LAUNCHED", ops.LAUNCHED],
  ["GET", "/api/dispatch", "BOARD", ops.BOARD],
  ["GET", "/api/dispatch/room", "ROOM", ops.ROOM],
  ["POST", "/api/dispatch/move", "MOVED", ops.MOVED],
  ["POST", "/api/dispatch/assign", "MOVED", ops.MOVED],
  ["GET", `/api/clients/${ID}`, "RECORD", ops.RECORD],
  ["GET", `/api/clients/${ID}`, "NEW_RECORD", ops.NEW_RECORD],
  ["GET", `/api/clients/${ID}/photos`, "PHOTOS", ops.PHOTOS],
  ["GET", `/api/clients/${ID}/consents`, "CONSENTS", ops.CONSENTS],
  ["GET", `/api/clients/${ID}/consents`, "ERASURE_REQUESTED", ops.ERASURE_REQUESTED],
  ["GET", `/api/clients/${ID}/pieces`, "PIECES", ops.PIECES],
  ["GET", "/api/no-shows", "NO_SHOWS", ops.NO_SHOWS],
  ["GET", "/api/no-shows", "NO_SHOW_UNMEASURED", ops.NO_SHOW_UNMEASURED],
  ["GET", "/api/payments", "DAY_MONEY", ops.DAY_MONEY],
  ["GET", "/api/tasks", "TASKS", ops.TASKS],
  ["GET", "/api/technicians", "TECHNICIANS", ops.TECHNICIANS],
  ["POST", `/api/technicians/${ID}/leave`, "LEAVE_RECORDED", ops.LEAVE_RECORDED],
  ["POST", `/api/technicians/${ID}/leave/${ID}/cancel`, "LEAVE_CANCELLED", ops.LEAVE_CANCELLED],
  ["GET", "/api/technicians/work", "TECHNICIAN_WORK", ops.TECHNICIAN_WORK],
  ["GET", "/api/grievances", "GRIEVANCES", ops.GRIEVANCES],
  ["GET", "/api/deletion-requests", "DELETION_REQUESTS", ops.DELETION_REQUESTS],
  ["GET", "/api/number-changes", "NUMBER_CHANGES", ops.NUMBER_CHANGES],
  ["GET", "/api/settings", "SETTINGS", ops.SETTINGS],
  ["GET", "/api/services", "SERVICES", ops.SERVICES],
  ["POST", "/api/prices/withdraw", "PRICE_ROWS", { prices: ops.PRICE_ROWS }],
  ["GET", "/api/service-area", "SERVICE_AREA", ops.SERVICE_AREA],
  ["GET", "/api/discount-codes", "DISCOUNT_CODES", ops.DISCOUNT_CODES],
  ["GET", "/api/consumables", "CONSUMABLES", ops.CONSUMABLES],
  ["POST", "/api/service-usage", "CONSUMABLES", ops.CONSUMABLES],
  ["GET", "/api/job-sheet", "JOB_SHEET", ops.JOB_SHEET],
  ["POST", "/api/job-sheet/partial-reasons", "JOB_SHEET", ops.JOB_SHEET],
  ["GET", "/api/stock", "STOCK", ops.STOCK],
  ["POST", "/api/stock/transfers", "STOCK", ops.STOCK],
];

describe("the ops console's fakes", () => {
  it.each(OPS_FIXTURES)("%s %s answers as the document says: %s", (method, path, _name, body) => {
    expect(contractErrors("ops", method, path, 200, body)).toEqual([]);
  });
});

describe("the technician app's fakes", () => {
  const today = tech.todayInIndia();
  const card = (path: string, body: unknown) => contractErrors("tech", "GET", `/api/tech/jobs/${path}`, 200, body);

  it("answers who is signed in and the day's jobs as the document says", () => {
    expect(contractErrors("tech", "GET", "/api/tech/me", 200, tech.ME)).toEqual([]);
    expect(contractErrors("tech", "GET", "/api/tech/jobs", 200, { date: today, jobs: tech.jobsToday(today) })).toEqual(
      [],
    );
    const tomorrow = tech.dayAfter(today);
    expect(
      contractErrors("tech", "GET", "/api/tech/jobs", 200, { date: tomorrow, jobs: tech.jobsTomorrow(today) }),
    ).toEqual([]);
  });

  it("answers each card as the document says, locked or open, with a pin or without", () => {
    const worked = { ...tech.NOTHING_DONE, steps_done: ["before_photos" as const], outcome: "done" };
    expect(card(tech.JOB_ID, tech.card(today, tech.NOTHING_DONE))).toEqual([]);
    expect(
      card(tech.JOB_ID, tech.card(today, worked, { pin: false, lastVisit: true, reminderDelivered: null })),
    ).toEqual([]);
    const replacement = tech.card(today, tech.NOTHING_DONE, { type: "replacement", pieces: [tech.ROHITS_PIECE] });
    expect(card(tech.JOB_ID, replacement)).toEqual([]);
    expect(card(tech.LOCKED_JOB_ID, tech.lockedCard(today))).toEqual([]);
  });
});
