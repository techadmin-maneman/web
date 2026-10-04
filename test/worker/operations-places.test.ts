// Operations keeps to the caller's cities: once the Staff list is enforced, a grant of one city shows only that city's
// visits, tasks, technicians and kits, and a record elsewhere is not found. NOW is Monday 21 September 2026, 12 noon in
// India. Every name, number and ID is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/http/context.ts";
import { appFor, captureLogs, fakeDependencies, fakeQueue, markDatabase, NOW, request } from "./helpers.ts";
import { enforce, listStaff, person, type GrantCode } from "./staff-fixtures.ts";

const DELHI_TECH = "33333333-3333-4333-8333-333333333331";
const GURGAON_TECH = "33333333-3333-4333-8333-333333333332";
const NO_CITY_TECH = "33333333-3333-4333-8333-333333333333";

const ARJUN = "11111111-1111-4111-8111-111111111111";
const ROHIT = "11111111-1111-4111-8111-111111111112";

const DELHI_VISIT = "22222222-2222-4222-8222-222222222221";
const GURGAON_VISIT = "22222222-2222-4222-8222-222222222222";

const DELHI_MOVE = "44444444-4444-4444-8444-444444444441";
const GURGAON_MOVE = "44444444-4444-4444-8444-444444444442";

const AT = NOW.toISOString();
/** Tuesday 22 September, 9 in the morning in India: both visits' start. */
const TUESDAY_MORNING = "2026-09-22T03:30:00.000Z";
const WEDNESDAY = "2026-09-23";

const ORIGIN = { Origin: "https://maneman.test", "Content-Type": "application/json" };

/** The queues a booking or a move writes to, kept rather than delivered. */
const bindings = () => ({ MESSAGE_QUEUE: fakeQueue() }) as unknown as Partial<Env>;

const get = (app: App, path: string) => request(app, path, undefined, bindings());
const send = (app: App, method: string, path: string, body: unknown = {}) =>
  request(app, path, { method, headers: ORIGIN, body: JSON.stringify(body) }, bindings());
const post = (app: App, path: string, body: unknown = {}) => send(app, "POST", path, body);

const errorOf = async (res: Response) => (await res.json<{ error: { code: string; fields?: string[] } }>()).error;

/** The ops console as this member of staff, with our own database holding the record of field work. */
function opsAs(email: string): App {
  const identity = person(email);
  const access = { verify: () => Promise.resolve({ ok: true as const, identity }) };
  return appFor("local", fakeDependencies({ access }), {}, "ops");
}

/** The ops console as a member of staff holding these grants, with the Staff list enforced. */
async function staffWith(...grants: GrantCode[]): Promise<App> {
  await enforce();
  await listStaff("ops-lead@maneman.in", grants);
  return opsAs("ops-lead@maneman.in");
}

async function insertVisit(id: string, client: string, technician: string, pincode: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, window_end, technician_id,
       service_pincode, synced_at)
     VALUES (?1, ?1, ?2, 'service', 'scheduled', ?3, ?4, ?5, ?6, ?7)`,
  )
    .bind(id, client, TUESDAY_MORNING, "2026-09-22T05:00:00.000Z", technician, pincode, AT)
    .run();
}

/** A move ops made of a visit, to its time now, which its client has not heard of. */
async function untoldMove(id: string, visit: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO dispatch_moves (id, appointment_id, was_start, now_start, reason, actor, fsm_write_state, created_at,
       updated_at)
     VALUES (?1, ?2, '2026-09-22T08:30:00.000Z', ?3, 'client_asked', 'ops@localhost', 'written', ?4, ?4)`,
  )
    .bind(id, visit, TUESDAY_MORNING, AT)
    .run();
}

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO serviceable_pincodes (pincode, area, city, served) VALUES
         ('110017', 'Saket', 'Delhi', 1), ('122018', 'Sector 65', 'Gurgaon', 1)`,
    ),
    env.DB.prepare(
      `INSERT INTO technicians (id, fsm_id, name, initials, active, city, mobile_e164, updated_at) VALUES
         (?1, ?1, 'Imran Qureshi', 'IQ', 1, 'Delhi', '+919810000101', ?4),
         (?2, ?2, 'Sameer Bhatt', 'SB', 1, 'Gurgaon', '+919810000102', ?4),
         (?3, ?3, 'Vikram Rana', 'VR', 1, NULL, '+919810000103', ?4)`,
    ).bind(DELHI_TECH, GURGAON_TECH, NO_CITY_TECH, AT),
    env.DB.prepare(
      `INSERT INTO people (id, created_at, mobile_e164, name) VALUES
         (?1, ?3, '+919810000001', 'Arjun Mehta'), (?2, ?3, '+919810000002', 'Rohit Malhotra')`,
    ).bind(ARJUN, ROHIT, AT),
    env.DB.prepare(
      `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode) VALUES
         (?1, ?1, ?3, 'House 7', 'Saket', 'Delhi', '110017'),
         (?2, ?2, ?3, 'House 4417', 'Sector 65', 'Gurgaon', '122018')`,
    ).bind(ARJUN, ROHIT, AT),
    env.DB.prepare(
      `INSERT INTO consumables (code, name, unit, unit_cost, reorder_kit, reorder_central, created_at, updated_at)
       VALUES ('tape_strips', 'Tape strips', 'strip', 1200, NULL, NULL, ?1, ?1)`,
    ).bind(AT),
  ]);
  await insertVisit(DELHI_VISIT, ARJUN, DELHI_TECH, "110017");
  await insertVisit(GURGAON_VISIT, ROHIT, GURGAON_TECH, "122018");
});

interface Board {
  cities: string[];
  technicians: { technician_id: string; days: { blocks: { appointment_id: string }[] }[] }[];
}

const boardOf = async (app: App): Promise<Board> => (await get(app, "/api/dispatch?from=2026-09-21")).json<Board>();
const rowsOf = (board: Board) => board.technicians.map((row) => row.technician_id).sort();
const blocksOf = (board: Board) =>
  board.technicians.flatMap((row) => row.days.flatMap((day) => day.blocks.map((block) => block.appointment_id)));

/** Moving a visit to Wednesday morning, as the board showed it. */
const toWednesday = (visit: string, technician: string, more: object = {}) => ({
  appointment_id: visit,
  date: WEDNESDAY,
  window: "morning",
  reason: "client_asked",
  expected_technician_id: technician,
  expected_starts_at: TUESDAY_MORNING,
  ...more,
});

describe("the dispatch board, for a grant of Operations in one city", () => {
  let delhi: App;

  beforeEach(async () => {
    delhi = await staffWith("operations:act:city:Delhi");
  });

  it("shows its city's visits and technicians, and narrows only to its city", async () => {
    const board = await boardOf(delhi);
    expect(rowsOf(board)).toEqual([DELHI_TECH]);
    expect(blocksOf(board)).toEqual([DELHI_VISIT]);
    expect(board.cities).toEqual(["Delhi"]);
  });

  it("shows a technician from elsewhere who holds one of its visits, with that visit alone", async () => {
    const borrowed = "22222222-2222-4222-8222-222222222223";
    await insertVisit(borrowed, ARJUN, GURGAON_TECH, "110017");

    const board = await boardOf(delhi);
    expect(rowsOf(board)).toEqual([DELHI_TECH, GURGAON_TECH].sort());
    expect(blocksOf(board).sort()).toEqual([DELHI_VISIT, borrowed].sort());
  });

  it("finds room for its own visit among its own technicians, and no visit elsewhere", async () => {
    const room = await get(delhi, `/api/dispatch/room?appointment_id=${DELHI_VISIT}&from=2026-09-21`);
    expect(room.status).toBe(200);
    const { rooms } = await room.json<{ rooms: { technician_id: string }[] }>();
    expect(rooms.length).toBeGreaterThan(0);
    expect(new Set(rooms.map((each) => each.technician_id))).toEqual(new Set([DELHI_TECH]));

    expect((await get(delhi, `/api/dispatch/room?appointment_id=${GURGAON_VISIT}`)).status).toBe(404);
  });

  it("moves its own visit, and finds none elsewhere", async () => {
    const elsewhere = await post(delhi, "/api/dispatch/move", toWednesday(GURGAON_VISIT, GURGAON_TECH));
    expect(elsewhere.status).toBe(404);
    expect((await errorOf(elsewhere)).code).toBe("not_found");

    expect((await post(delhi, "/api/dispatch/move", toWednesday(DELHI_VISIT, DELHI_TECH))).status).toBe(200);
    const starts = await env.DB.prepare("SELECT id, window_start FROM appointments ORDER BY id").all();
    expect(starts.results).toEqual([
      { id: DELHI_VISIT, window_start: "2026-09-23T03:30:00.000Z" },
      { id: GURGAON_VISIT, window_start: TUESDAY_MORNING },
    ]);
  });

  it("gives its visit only to a technician in its city, or keeps it on the one it has", async () => {
    const away = await post(
      delhi,
      "/api/dispatch/move",
      toWednesday(DELHI_VISIT, DELHI_TECH, { technician_id: GURGAON_TECH }),
    );
    expect(away.status).toBe(400);
    expect((await errorOf(away)).fields).toEqual(["technician_id"]);

    const kept = await post(
      delhi,
      "/api/dispatch/move",
      toWednesday(DELHI_VISIT, DELHI_TECH, { technician_id: DELHI_TECH }),
    );
    expect(kept.status).toBe(200);
  });

  it("records a call about a move of its own visit, and finds none elsewhere", async () => {
    await untoldMove(DELHI_MOVE, DELHI_VISIT);
    await untoldMove(GURGAON_MOVE, GURGAON_VISIT);

    expect((await post(delhi, `/api/dispatch/moves/${GURGAON_MOVE}/told`)).status).toBe(404);
    expect((await post(delhi, `/api/dispatch/moves/${DELHI_MOVE}/told`)).status).toBe(200);
    const told = await env.DB.prepare("SELECT id FROM dispatch_moves WHERE told_at IS NOT NULL").all();
    expect(told.results).toEqual([{ id: DELHI_MOVE }]);
  });
});

describe("Tasks, kept to the cities of each department's grant", () => {
  const GRIEVANCE_DELHI = "55555555-5555-4555-8555-555555555551";
  const GRIEVANCE_GURGAON = "55555555-5555-4555-8555-555555555552";

  interface Tasks {
    groups: { group: string; count: number; tasks: { id: string }[] }[];
  }

  const idsIn = (tasks: Tasks, group: string) =>
    (tasks.groups.find((each) => each.group === group)?.tasks ?? []).map((task) => task.id).sort();

  beforeEach(async () => {
    // Both technicians are away on the day of their visit, and both clients have a grievance open.
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO technician_leave (id, technician_id, from_date, to_date, actor, created_at) VALUES
           ('leave-delhi', ?1, '2026-09-22', '2026-09-22', 'ops@localhost', ?3),
           ('leave-gurgaon', ?2, '2026-09-22', '2026-09-22', 'ops@localhost', ?3)`,
      ).bind(DELHI_TECH, GURGAON_TECH, AT),
      env.DB.prepare(
        `INSERT INTO grievances (id, person_id, text, state, created_at) VALUES
           (?1, ?3, 'Late again.', 'open', ?5), (?2, ?4, 'Late again.', 'open', ?5)`,
      ).bind(GRIEVANCE_DELHI, GRIEVANCE_GURGAON, ARJUN, ROHIT, AT),
    ]);
  });

  it("lists each group's tasks where the grants in its department reach", async () => {
    const lead = await staffWith("operations:act:city:Delhi", "customer_care:view:national");
    const tasks = await (await get(lead, "/api/tasks")).json<Tasks>();

    expect(idsIn(tasks, "leave_conflict")).toEqual([DELHI_VISIT]);
    expect(idsIn(tasks, "grievance")).toEqual([GRIEVANCE_DELHI, GRIEVANCE_GURGAON].sort());
    expect(tasks.groups.find((each) => each.group === "leave_conflict")?.count).toBe(1);
  });

  it("opens the board to a grant of one city, with that city's tasks alone", async () => {
    const care = await staffWith("customer_care:view:city:Gurgaon");
    const tasks = await (await get(care, "/api/tasks")).json<Tasks>();

    expect(tasks.groups.map((each) => each.group)).toEqual(["grievance"]);
    expect(idsIn(tasks, "grievance")).toEqual([GRIEVANCE_GURGAON]);
  });

  it("hands back a task only in its city", async () => {
    const lead = await staffWith("operations:act:city:Delhi");
    const handBack = (visit: string) => send(lead, "PUT", `/api/tasks/leave_conflict/${visit}/owner`, { owner: null });

    expect((await handBack(GURGAON_VISIT)).status).toBe(404);
    expect((await handBack(DELHI_VISIT)).status).toBe(200);
  });
});

describe("booking a visit, for a grant of Operations in one city", () => {
  let delhi: App;

  beforeEach(async () => {
    delhi = await staffWith("operations:act:city:Delhi");
  });

  it("offers its own technicians for a client in its city, and finds no client elsewhere", async () => {
    const offered = await get(delhi, `/api/visits/availability?client=${ARJUN}&kind=consultation`);
    expect(offered.status).toBe(200);
    const { days } = await offered.json<{ days: { windows: { technicians: { id: string }[] }[] }[] }>();
    const free = new Set(days.flatMap((day) => day.windows.flatMap((each) => each.technicians.map((one) => one.id))));
    expect(free).toEqual(new Set([DELHI_TECH]));

    expect((await get(delhi, `/api/visits/availability?client=${ROHIT}&kind=consultation`)).status).toBe(404);
  });

  it("books only for a client in its city, and never with a technician elsewhere", async () => {
    const visit = { kind: "consultation", date: WEDNESDAY, window: "afternoon" };
    expect((await post(delhi, "/api/visits", { ...visit, client: ROHIT })).status).toBe(404);

    const elsewhere = await post(delhi, "/api/visits", { ...visit, client: ARJUN, technician: GURGAON_TECH });
    expect(elsewhere.status).toBe(409);
    expect((await errorOf(elsewhere)).code).toBe("taken");

    expect((await post(delhi, "/api/visits", { ...visit, client: ARJUN, technician: DELHI_TECH })).status).toBe(201);
    const holds = await env.DB.prepare("SELECT person_id FROM slot_holds").all();
    expect(holds.results).toEqual([{ person_id: ARJUN }]);
  });

  it("shows what cancelling its own visit gives back, and cancels nothing elsewhere", async () => {
    const terms = await post(delhi, `/api/visits/${DELHI_VISIT}/cancel`, { confirm: false });
    expect(terms.status).toBe(200);

    const cancel = { confirm: true, notice: "free", reason: "The client is travelling." };
    const elsewhere = await post(delhi, `/api/visits/${GURGAON_VISIT}/cancel`, cancel);
    expect(elsewhere.status).toBe(409);
    expect((await errorOf(elsewhere)).code).toBe("not_changeable");
    const statuses = await env.DB.prepare("SELECT status FROM appointments WHERE id = ?1").bind(GURGAON_VISIT).first();
    expect(statuses).toEqual({ status: "scheduled" });
  });

  it("closes by hand no visit elsewhere", async () => {
    const close = {
      outcome: "done",
      started_at: TUESDAY_MORNING,
      ended_at: "2026-09-22T05:00:00.000Z",
      reason: "His phone was lost.",
    };
    expect((await post(delhi, `/api/visits/${GURGAON_VISIT}/close`, close)).status).toBe(404);
    // Its own visit gets past its city to the visit's own answer: its time has not come.
    expect((await post(delhi, `/api/visits/${DELHI_VISIT}/close`, close)).status).toBe(425);
  });
});

describe("technicians, for a grant of Operations in one city", () => {
  let delhi: App;

  beforeEach(async () => {
    delhi = await staffWith("operations:manage:city:Delhi");
  });

  it("lists its city's technicians, and offers only its city to give one", async () => {
    const roster = await (
      await get(delhi, "/api/technicians")
    ).json<{ technicians: { id: string }[]; cities: string[] }>();
    expect(roster.technicians.map((each) => each.id)).toEqual([DELHI_TECH]);
    expect(roster.cities).toEqual(["Delhi"]);

    const work = await (await get(delhi, "/api/technicians/work")).json<{ technicians: { technician_id: string }[] }>();
    expect(work.technicians.map((each) => each.technician_id)).toEqual([DELHI_TECH]);
  });

  it("changes, and switches off, only its city's technicians", async () => {
    expect((await send(delhi, "PATCH", `/api/technicians/${GURGAON_TECH}`, { zone: "South" })).status).toBe(404);
    expect((await send(delhi, "PATCH", `/api/technicians/${NO_CITY_TECH}`, { zone: "South" })).status).toBe(404);
    expect((await send(delhi, "PATCH", `/api/technicians/${DELHI_TECH}`, { zone: "South" })).status).toBe(200);

    expect((await post(delhi, `/api/technicians/${GURGAON_TECH}/deactivate`)).status).toBe(404);
    expect((await post(delhi, `/api/technicians/${GURGAON_TECH}/reactivate`)).status).toBe(404);
    const active = await env.DB.prepare("SELECT id FROM technicians WHERE active = 1 ORDER BY id").all();
    expect(active.results).toHaveLength(3);
  });

  it("gives a technician only a city it reaches, never none", async () => {
    const moved = await send(delhi, "PATCH", `/api/technicians/${DELHI_TECH}`, { city: "Gurgaon" });
    expect(moved.status).toBe(400);
    expect((await errorOf(moved)).fields).toEqual(["city"]);
    expect((await send(delhi, "PATCH", `/api/technicians/${DELHI_TECH}`, { city: null })).status).toBe(400);

    const someone = { name: "Karan Joshi", mobile: "9810000104" };
    expect((await post(delhi, "/api/technicians", someone)).status).toBe(400);
    expect((await post(delhi, "/api/technicians", { ...someone, city: "Gurgaon" })).status).toBe(400);
    expect((await post(delhi, "/api/technicians", { ...someone, city: "Delhi" })).status).toBe(201);
  });

  it("records leave and revokes a phone only for its city's technicians", async () => {
    await env.DB.prepare(
      `INSERT INTO technician_devices (id, technician_id, device_id, session_id, created_at, last_seen_at)
       VALUES ('device-gurgaon', ?1, 'phone-gurgaon', NULL, ?2, ?2)`,
    )
      .bind(GURGAON_TECH, AT)
      .run();
    const leave = { from: "2026-09-24", to: "2026-09-24" };

    expect((await post(delhi, `/api/technicians/${GURGAON_TECH}/leave`, leave)).status).toBe(404);
    expect((await post(delhi, `/api/technicians/${DELHI_TECH}/leave`, leave)).status).toBe(200);
    expect((await post(delhi, `/api/technicians/${GURGAON_TECH}/devices/phone-gurgaon/revoke`)).status).toBe(404);

    const recorded = await env.DB.prepare("SELECT technician_id FROM technician_leave").all();
    expect(recorded.results).toEqual([{ technician_id: DELHI_TECH }]);
    const revoked = await env.DB.prepare("SELECT revoked_at FROM technician_devices").first<{ revoked_at: null }>();
    expect(revoked?.revoked_at).toBeNull();
  });
});

describe("stock, for a grant of Operations in one city", () => {
  let delhi: App;

  beforeEach(async () => {
    delhi = await staffWith("operations:act:city:Delhi");
  });

  const count = (app: App, place: string | null) =>
    post(app, "/api/stock/counts", { consumable_code: "tape_strips", technician_id: place, counted: 10 });

  it("shows its city's kits, without the central store", async () => {
    const stock = await (await get(delhi, "/api/stock")).json<{ places: { technician_id: string | null }[] }>();
    expect(stock.places.map((place) => place.technician_id)).toEqual([DELHI_TECH]);
  });

  it("counts and moves stock only in its city's kits", async () => {
    for (const place of [GURGAON_TECH, null]) {
      const refused = await count(delhi, place);
      expect(refused.status).toBe(400);
      expect((await errorOf(refused)).fields).toEqual(["technician_id"]);
    }
    expect((await count(delhi, DELHI_TECH)).status).toBe(200);

    const transfer = { consumable_code: "tape_strips", quantity: 2, from: DELHI_TECH, to: GURGAON_TECH };
    const across = await post(delhi, "/api/stock/transfers", transfer);
    expect(across.status).toBe(400);
    expect((await errorOf(across)).fields).toEqual(["to"]);

    const rows = await env.DB.prepare("SELECT technician_id FROM stock_movements").all();
    expect(rows.results).toEqual([{ technician_id: DELHI_TECH }]);
  });

  it("leaves a delivery into the central store to a national grant", async () => {
    const delivery = await post(delhi, "/api/stock/deliveries", { consumable_code: "tape_strips", quantity: 5 });
    expect(delivery.status).toBe(403);
    expect((await errorOf(delivery)).code).toBe("not_permitted");
  });
});

describe("Operations' reach", () => {
  it("takes in every city of a zone, and a technician in no city only nationally", async () => {
    const ncr = await staffWith("operations:view:zone:NCR");
    expect(rowsOf(await boardOf(ncr))).toEqual([DELHI_TECH, GURGAON_TECH].sort());
  });

  it("is everywhere for a national grant, the central store with it", async () => {
    const national = await staffWith("operations:view:national");
    expect(rowsOf(await boardOf(national))).toEqual([DELHI_TECH, GURGAON_TECH, NO_CITY_TECH].sort());
    const stock = await (await get(national, "/api/stock")).json<{ places: { technician_id: string | null }[] }>();
    expect(stock.places[0]?.technician_id).toBeNull();
  });

  it("narrows nothing while the Staff list is not enforced", async () => {
    await listStaff("delhi@maneman.in", ["operations:view:city:Delhi"]);
    const delhi = opsAs("delhi@maneman.in");

    const board = await boardOf(delhi);
    expect(rowsOf(board)).toEqual([DELHI_TECH, GURGAON_TECH, NO_CITY_TECH].sort());
    expect(blocksOf(board).sort()).toEqual([DELHI_VISIT, GURGAON_VISIT].sort());
  });
});
