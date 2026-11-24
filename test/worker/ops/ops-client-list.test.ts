// The console's list of clients (GET /api/clients): everyone in the caller's cities, the soonest next visit first,
// each at their stage, narrowed to a view and to a city, a page at a time (docs/decisions/0307-the-people-rulings.md).
// NOW is Monday 21 September 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { CLIENTS_PER_PAGE } from "../../../src/domain/clients/client-list.ts";
import type { App } from "../../../src/http/context.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, NOW, request, savedAddress } from "../helpers.ts";
import { person } from "./ops-clients-fixtures.ts";
import { aPackage, aPayment, aRefund } from "../fixtures/index.ts";

const ROHIT = "11111111-1111-4111-8111-111111111111";
const VIKRAM = "11111111-1111-4111-8111-111111111112";
const KABIR = "11111111-1111-4111-8111-111111111113";
const ANIL = "11111111-1111-4111-8111-111111111114";
const ARJUN = "11111111-1111-4111-8111-111111111115";

let ops: App;

interface Listed {
  clients: { id: string; name: string; stage: string; city: string | null; next_visit: string | null }[];
  next_cursor: string | null;
  cities: string[];
}

const list = async (query = ""): Promise<Listed> => (await request(ops, `/api/clients${query}`)).json<Listed>();
const names = async (query = "") => (await list(query)).clients.map((client) => client.name);
/** The clients the caller's board names, by name, in the list's order. */
async function onTheBoard(): Promise<string[]> {
  const board = await (
    await request(ops, "/api/tasks")
  ).json<{ groups: { tasks: { person: { id: string } | null }[] }[] }>();
  const ids = new Set(board.groups.flatMap((group) => group.tasks.flatMap((task) => task.person?.id ?? [])));
  return (await list()).clients.filter((client) => ids.has(client.id)).map((client) => client.name);
}

const counted = async (query: string) =>
  (await (await request(ops, `/api/clients${query}`)).json<{ counts: unknown }>()).counts;

async function visit(personId: string, type: string, status: string, start: string): Promise<void> {
  const id = crypto.randomUUID();
  const end = new Date(Date.parse(start) + 60 * 60_000).toISOString();
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, window_end, service_pincode, synced_at)
     VALUES (?1, ?1, ?2, ?3, ?4, ?5, ?6, '122018', ?7)`,
  )
    .bind(id, personId, type, status, start, end, NOW.toISOString())
    .run();
}

/** Rohit's first fit moved to the day given. */
const fittedOn = (start: string) =>
  env.DB.prepare("UPDATE appointments SET window_start = ?2 WHERE person_id = ?1 AND type = 'first_fit'")
    .bind(ROHIT, start)
    .run();

beforeEach(async () => {
  captureLogs();
  ops = appFor("local", fakeDependencies(), {}, "ops");
  await markDatabase();
  // Rohit: fitted on 20 August, within his 30 days and the week's grace, his next service on the 30th. Vikram: a
  // consultation on the 24th. Kabir: consulted on the 10th, nothing booked. Anil: nothing booked, and nowhere known.
  // Arjun: fitted in March, long past his service, nothing booked.
  for (const [id, name, mobile] of [
    [ROHIT, "Rohit Malhotra", "+919810000001"],
    [VIKRAM, "Vikram Sethi", "+919810000002"],
    [KABIR, "Kabir Suri", "+919810000003"],
    [ANIL, "Anil Kapoor", "+919810000004"],
    [ARJUN, "Arjun Shah", "+919810000005"],
  ] as const) {
    await person(id, name, mobile);
  }
  for (const id of [ROHIT, VIKRAM, KABIR, ARJUN]) await savedAddress(id);
  await aPackage({ code: "natural", name: "Natural hair system", firstFit: 3_000_000, everyDays: 30 });
  await env.DB.prepare("UPDATE people SET package = 'natural' WHERE id IN (?1, ?2)").bind(ROHIT, ARJUN).run();
  await visit(ROHIT, "first_fit", "completed", "2026-08-20T04:30:00.000Z");
  await visit(ROHIT, "service", "scheduled", "2026-09-30T04:30:00.000Z");
  await visit(VIKRAM, "consultation", "scheduled", "2026-09-24T04:30:00.000Z");
  await visit(KABIR, "consultation", "completed", "2026-09-10T04:30:00.000Z");
  await visit(ARJUN, "first_fit", "completed", "2026-03-02T04:30:00.000Z");
  await env.DB.prepare("INSERT OR IGNORE INTO cities (name, served, active, sort) VALUES ('Gurgaon', 1, 1, 1)").run();
});

describe("GET /api/clients", () => {
  it("lists the soonest next visit first, then those with none, each with their stage and their city", async () => {
    const page = await list();
    expect(page.clients.map(({ name, stage, city }) => ({ name, stage, city }))).toEqual([
      { name: "Vikram Sethi", stage: "lead", city: "Gurgaon" },
      { name: "Rohit Malhotra", stage: "active", city: "Gurgaon" },
      { name: "Kabir Suri", stage: "consulted", city: "Gurgaon" },
      { name: "Anil Kapoor", stage: "lead", city: null },
      { name: "Arjun Shah", stage: "fitted", city: "Gurgaon" },
    ]);
    expect(page.clients[0]?.next_visit).toBe("2026-09-24T04:30:00.000Z");
    expect(page.next_cursor).toBeNull();
    expect(page.cities).toContain("Gurgaon");
  });

  // Clients could not be narrowed to Mumbai, whose pincodes were served though the city was not marked so.
  it("offers every city with a pincode served, whatever the city is marked", async () => {
    await env.DB.prepare("UPDATE cities SET served = 0 WHERE name = 'Mumbai'").run();
    await env.DB.prepare(
      "INSERT INTO serviceable_pincodes (pincode, area, city, served) VALUES ('400050', 'Bandra West', 'Mumbai', 1)",
    ).run();
    expect((await list()).cities).toContain("Mumbai");
  });

  it("narrows to a view, and to a city", async () => {
    expect(await names("?view=lead")).toEqual(["Vikram Sethi", "Anil Kapoor"]);
    expect(await names("?view=booked")).toEqual(["Vikram Sethi", "Rohit Malhotra"]);
    expect(await names("?view=fitted")).toEqual(["Rohit Malhotra", "Arjun Shah"]);
    expect(await names("?view=nothing_booked&city=Gurgaon")).toEqual(["Kabir Suri", "Arjun Shah"]);
  });

  // 30 days and the week's grace after 14 August end on 20 September, so a fit on the 14th is fitted again today,
  // and one on the 15th still active.
  it("holds a fitted client active until their cadence and its grace run out, and fitted after", async () => {
    const rohit = async () => (await list()).clients.find((client) => client.id === ROHIT)?.stage;
    await fittedOn("2026-08-14T04:30:00.000Z");
    expect(await rohit()).toBe("fitted");
    await fittedOn("2026-08-15T04:30:00.000Z");
    expect(await rohit()).toBe("active");
  });

  it("lists those a task on the caller's board waits on, and counts them", async () => {
    await env.DB.prepare(
      `INSERT INTO staff_tasks (id, department, what, person_id, due_at, created_by, created_at)
       VALUES (?1, 'customer_care', 'Call back', ?2, ?3, 'priya@maneman.in', ?3)`,
    )
      .bind(crypto.randomUUID(), KABIR, NOW.toISOString())
      .run();
    const waited = await onTheBoard();
    expect(waited).toContain("Kabir Suri");
    expect(await names("?view=needs")).toEqual(waited);
    expect(await counted("")).toMatchObject({ all: 5, needs: waited.length });
  });

  it("gives each one's package by name and what they have paid, less refunds, as their page does", async () => {
    const kept = crypto.randomUUID();
    await aPayment({ id: kept, person_id: ROHIT, amount: 236_000 });
    await aPayment({ person_id: ROHIT, amount: 50_000, status: "failed" });
    await aRefund({ payment_id: kept, amount: 6_000 });
    const rows = (
      await (
        await request(ops, "/api/clients")
      ).json<{
        clients: { name: string; package: string | null; paid: number }[];
      }>()
    ).clients;
    expect(rows.find((row) => row.name === "Rohit Malhotra")).toMatchObject({
      package: "Natural hair system",
      paid: 230_000,
    });
    expect(rows.find((row) => row.name === "Kabir Suri")).toMatchObject({ package: null, paid: 0 });
  });

  it("counts each view on the first page, in the city asked for, and not on the pages after", async () => {
    const needs = (await onTheBoard()).length;
    expect(await counted("")).toEqual({ all: 5, lead: 2, booked: 2, fitted: 2, nothing_booked: 3, needs });
    expect(await counted("?city=Gurgaon&view=fitted")).toEqual({
      all: 4,
      lead: 1,
      booked: 2,
      fitted: 2,
      nothing_booked: 2,
      needs,
    });
    expect(await counted("?cursor=MQ")).toBeNull();
  });

  it("gives a page at a time, saying when another follows", async () => {
    await env.DB.batch(
      Array.from({ length: CLIENTS_PER_PAGE }, (_, index) =>
        env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, ?4)").bind(
          crypto.randomUUID(),
          NOW.toISOString(),
          `+9198200${String(index).padStart(5, "0")}`,
          `Client ${String(index)}`,
        ),
      ),
    );
    const first = await list();
    expect(first.clients).toHaveLength(CLIENTS_PER_PAGE);
    expect(first.next_cursor).not.toBeNull();
    const second = await list(`?cursor=${first.next_cursor ?? ""}`);
    expect(second.clients).toHaveLength(5);
    expect(second.next_cursor).toBeNull();
  });
});
