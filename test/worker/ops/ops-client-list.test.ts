// The console's list of clients (GET /api/clients): everyone in the caller's cities, the soonest next visit first,
// narrowed to where they stand and to a city, a page at a time. NOW is Monday 21 September 2026, 12 noon in India.
// Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { CLIENTS_PER_PAGE } from "../../../src/domain/clients/client-list.ts";
import type { App } from "../../../src/http/context.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, NOW, request, savedAddress } from "../helpers.ts";
import { person } from "./ops-clients-fixtures.ts";

const ROHIT = "11111111-1111-4111-8111-111111111111";
const VIKRAM = "11111111-1111-4111-8111-111111111112";
const KABIR = "11111111-1111-4111-8111-111111111113";
const ANIL = "11111111-1111-4111-8111-111111111114";

let ops: App;

interface Listed {
  clients: { id: string; name: string; state: string; city: string | null; next_visit: string | null }[];
  more: boolean;
  cities: string[];
}

const list = async (query = ""): Promise<Listed> => (await request(ops, `/api/clients${query}`)).json<Listed>();
const names = async (query = "") => (await list(query)).clients.map((client) => client.name);

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

beforeEach(async () => {
  captureLogs();
  ops = appFor("local", fakeDependencies(), {}, "ops");
  await markDatabase();
  // Rohit: fitted, his next service on the 30th. Vikram: a consultation on the 24th. Kabir: nothing booked, in
  // Gurgaon. Anil: nothing booked, and nowhere known.
  for (const [id, name, mobile] of [
    [ROHIT, "Rohit Malhotra", "+919810000001"],
    [VIKRAM, "Vikram Sethi", "+919810000002"],
    [KABIR, "Kabir Suri", "+919810000003"],
    [ANIL, "Anil Kapoor", "+919810000004"],
  ] as const) {
    await person(id, name, mobile);
  }
  for (const id of [ROHIT, VIKRAM, KABIR]) await savedAddress(id);
  await visit(ROHIT, "first_fit", "completed", "2026-08-20T04:30:00.000Z");
  await visit(ROHIT, "service", "scheduled", "2026-09-30T04:30:00.000Z");
  await visit(VIKRAM, "consultation", "scheduled", "2026-09-24T04:30:00.000Z");
  await env.DB.prepare("INSERT OR IGNORE INTO cities (name, served, active, sort) VALUES ('Gurgaon', 1, 1, 1)").run();
});

describe("GET /api/clients", () => {
  it("lists the soonest next visit first, then those with none, each with where they stand and their city", async () => {
    const page = await list();
    expect(page.clients.map(({ name, state, city }) => ({ name, state, city }))).toEqual([
      { name: "Vikram Sethi", state: "lead", city: "Gurgaon" },
      { name: "Rohit Malhotra", state: "fitted", city: "Gurgaon" },
      { name: "Kabir Suri", state: "nothing_booked", city: "Gurgaon" },
      { name: "Anil Kapoor", state: "nothing_booked", city: null },
    ]);
    expect(page.clients[0]?.next_visit).toBe("2026-09-24T04:30:00.000Z");
    expect(page.more).toBe(false);
    expect(page.cities).toContain("Gurgaon");
  });

  it("narrows to where they stand, and to a city", async () => {
    expect(await names("?state=fitted")).toEqual(["Rohit Malhotra"]);
    expect(await names("?state=lead")).toEqual(["Vikram Sethi"]);
    expect(await names("?state=nothing_booked&city=Gurgaon")).toEqual(["Kabir Suri"]);
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
    expect(first.more).toBe(true);
    const second = await list("?page=1");
    expect(second.clients).toHaveLength(4);
    expect(second.more).toBe(false);
  });
});
