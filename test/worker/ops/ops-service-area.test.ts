// The business inputs ops set for themselves, on the ops surface
// (src/routes/ops/settings.ts, docs/decisions/0061-ops-editable-inputs.md). NOW
// is Monday 21 September 2026, 12 noon in India. Every pincode here is real
// only as a number; nothing is a person, a mobile or an address.
//
// What these hold: an empty store behaves as the committed code does, a change
// reaches the routes that read it without a deploy, a figure outside the bounds
// never lands, every change is recorded under the Access identity behind it,
// and neither ops nor a file can leave the business with nowhere to go.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { renderMessage } from "../../../src/config/message-templates.ts";
import { composeLaunchAlert } from "../../../src/domain/booking/waitlist.ts";
import { pincodeUpsert } from "../../../scripts/lib/pincodes.ts";
import { appFor, fakeDependencies, fakeQueue, markDatabase, NOW, request } from "../helpers.ts";
import { POST, auditFor } from "./ops-settings-fixtures.ts";

let ops: App;

const post = (path: string, body: unknown, bindings: Partial<Env> = {}) =>
  request(ops, path, { method: "POST", headers: POST, body: JSON.stringify(body) }, bindings);

async function pincode(pin: string, city: string, area: string, served: number, launchedAt: string | null) {
  await env.DB.prepare(
    "INSERT INTO serviceable_pincodes (pincode, area, city, served, launched_at) VALUES (?1, ?2, ?3, ?4, ?5)",
  )
    .bind(pin, area, city, served, launchedAt)
    .run();
}

beforeEach(async () => {
  await markDatabase();
  ops = appFor("local", fakeDependencies(), {}, "ops");
});

describe("the service area", () => {
  beforeEach(async () => {
    // Midnight in India on 1 September, as the import and the console store a launch date.
    await pincode("110001", "Delhi", "Connaught Place", 1, "2026-08-31T18:30:00.000Z");
    await pincode("110017", "Delhi", "Saket", 0, null);
    await pincode("122018", "Gurgaon", "Sector 65", 0, null);
  });

  it("lists every pincode with its city and whether we go there, and our cities", async () => {
    const body = await (
      await request(ops, "/api/service-area")
    ).json<{ pincodes: { pincode: string; launch_on: string | null }[]; cities: string[] }>();
    expect(body.pincodes).toHaveLength(3);
    expect(body.pincodes[0]).toMatchObject({ pincode: "110001", city: "Delhi", served: true, launch_on: "2026-09-01" });
    expect(body.cities).toEqual(expect.arrayContaining(["Delhi", "Gurgaon", "Mumbai"]));
  });

  it("serves a pincode from a date, and counts only what changed", async () => {
    const answer = await post("/api/service-area", {
      changes: [
        { pincode: "122018", served: true, launch_on: "2026-09-15" },
        // Unchanged: it is sent and it is not counted, so the log records no change that was not one.
        { pincode: "110001", served: true, launch_on: "2026-09-01" },
      ],
    });
    expect(await answer.json()).toEqual({ changed: 1, served: 2, alerted: 0 });
    expect((await auditFor("pincode.set")).results).toHaveLength(1);
  });

  it("keeps a pincode's launch date however often it is switched off and on", async () => {
    // Another served pincode, since switching off the only one is refused.
    await post("/api/service-area", { changes: [{ pincode: "122018", served: true, launch_on: null }] });
    for (const served of [false, true, false, true]) {
      await post("/api/service-area", { changes: [{ pincode: "110001", served, launch_on: "2026-09-01" }] });
    }
    const body = await (
      await request(ops, "/api/service-area")
    ).json<{ pincodes: { pincode: string; launch_on: string | null }[] }>();
    expect(body.pincodes.find((each) => each.pincode === "110001")?.launch_on).toBe("2026-09-01");
    const { results } = await auditFor("pincode.set");
    const toggles = results.filter((row) => row.subject_id === "110001");
    expect(toggles.map((row) => JSON.parse(row.detail) as Record<string, unknown>)).toEqual([
      { served_from: true, served_to: false, launch_from: "2026-09-01", launch_to: "2026-09-01" },
      { served_from: false, served_to: true, launch_from: "2026-09-01", launch_to: "2026-09-01" },
      { served_from: true, served_to: false, launch_from: "2026-09-01", launch_to: "2026-09-01" },
      { served_from: false, served_to: true, launch_from: "2026-09-01", launch_to: "2026-09-01" },
    ]);
  });

  it("records what a pincode was and what it is", async () => {
    await post("/api/service-area", { changes: [{ pincode: "122018", served: true, launch_on: "2026-09-15" }] });
    const { results } = await auditFor("pincode.set");
    expect(results[0]).toMatchObject({ actor: "ops@localhost", subject_id: "122018" });
    expect(JSON.parse(results[0]?.detail ?? "{}")).toEqual({
      served_from: false,
      served_to: true,
      launch_from: "",
      launch_to: "2026-09-15",
    });
  });

  // A pincode served from a later day was served at once, so /book took bookings
  // there before its launch day.
  it("refuses to serve a pincode from a day still to come, and changes nothing", async () => {
    const answer = await post("/api/service-area", {
      changes: [
        { pincode: "122018", served: true, launch_on: "2026-10-01" },
        { pincode: "110017", served: true, launch_on: "2026-09-21" },
      ],
    });
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: { code: "launch_in_future", fields: ["122018"] } });
    const body = await (await request(ops, "/api/service-area")).json<{ pincodes: { served: boolean }[] }>();
    expect(body.pincodes.filter((each) => each.served)).toHaveLength(1);
    expect((await auditFor("pincode.set")).results).toHaveLength(0);
  });

  it("lets a pincode not served yet hold a day still to come, and renames one served whatever its date", async () => {
    const planned = await post("/api/service-area", {
      changes: [{ pincode: "122018", served: false, launch_on: "2026-10-01" }],
    });
    expect(planned.status).toBe(200);
    await env.DB.prepare(
      "UPDATE serviceable_pincodes SET launched_at = '2026-10-04T18:30:00.000Z' WHERE pincode = '110001'",
    ).run();
    const renamed = await post("/api/service-area", {
      changes: [{ pincode: "110001", served: true, launch_on: "2026-10-05", area: "Janpath" }],
    });
    expect(renamed.status).toBe(200);
  });

  // The two ways to launch disagreed on the launch date; both now launch through one function, from the day
  // given or today.
  it("dates a pincode it begins serving from today, where no day is given", async () => {
    await post("/api/service-area", { changes: [{ pincode: "122018", served: true, launch_on: null }] });
    const body = await (
      await request(ops, "/api/service-area")
    ).json<{ pincodes: { pincode: string; launch_on: string | null }[] }>();
    expect(body.pincodes.find((each) => each.pincode === "122018")?.launch_on).toBe("2026-09-21");
    const { results } = await auditFor("pincode.launch");
    expect(results.map((row) => row.subject_id)).toEqual(["122018"]);
  });

  it("refuses a change that would leave nowhere served, and changes nothing", async () => {
    const answer = await post("/api/service-area", {
      changes: [{ pincode: "110001", served: false, launch_on: null }],
    });
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: { code: "no_service_area" } });
    const body = await (await request(ops, "/api/service-area")).json<{ pincodes: { served: boolean }[] }>();
    expect(body.pincodes.filter((each) => each.served)).toHaveLength(1);
  });

  it("refuses a pincode we do not hold: the file is reference data, not a way to add one", async () => {
    const answer = await post("/api/service-area", { changes: [{ pincode: "560001", served: true, launch_on: null }] });
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: { code: "invalid_request", fields: ["560001"] } });
    expect((await auditFor("pincode.set")).results).toHaveLength(0);
  });
});

// No screen could add a pincode, so the waitlist could not open the
// areas people asked for.
describe("adding a pincode", () => {
  beforeEach(async () => {
    await pincode("110001", "Delhi", "Connaught Place", 1, "2026-08-31T18:30:00.000Z");
  });

  const add = (body: object) => post("/api/pincodes", body);

  it("adds it unserved in one of our cities, named as ops typed, and records who added it", async () => {
    const answer = await add({ pincode: "400050", area: "Bandra West ", city: "Mumbai" });
    expect(answer.status).toBe(201);
    expect(await answer.json()).toEqual({
      pincode: "400050",
      area: "Bandra West",
      city: "Mumbai",
      served: false,
      launch_on: null,
      waiting: 0,
      to_alert: 0,
    });
    const row = await env.DB.prepare(
      "SELECT area, city, served, launched_at, area_named_by FROM serviceable_pincodes WHERE pincode = '400050'",
    ).first();
    expect(row).toEqual({
      area: "Bandra West",
      city: "Mumbai",
      served: 0,
      launched_at: null,
      area_named_by: "ops@localhost",
    });
    const { results } = await auditFor("pincode.add");
    expect(results).toEqual([
      { actor: "ops@localhost", actor_kind: "staff", subject_id: "400050", detail: JSON.stringify({ city: "Mumbai" }) },
    ]);
  });

  it("refuses a pincode it holds already, and a city that is not ours, adding nothing", async () => {
    const held = await add({ pincode: "110001", area: "Janpath", city: "Delhi" });
    expect(held.status).toBe(409);
    expect(await held.json()).toMatchObject({ error: { code: "pincode_held" } });

    const nowhere = await add({ pincode: "600001", area: "Parrys", city: "Chennai" });
    expect(nowhere.status).toBe(400);
    expect(await nowhere.json()).toMatchObject({ error: { code: "invalid_request", fields: ["city"] } });

    const named = await env.DB.prepare("SELECT area FROM serviceable_pincodes WHERE pincode = '110001'").first();
    expect(named).toEqual({ area: "Connaught Place" });
    expect((await auditFor("pincode.add")).results).toHaveLength(0);
  });

  it("refuses a pincode or a name the service area could not hold", async () => {
    for (const body of [
      { pincode: "012345", area: "Somewhere", city: "Delhi" },
      { pincode: "110099", area: "=HYPERLINK(1)", city: "Delhi" },
    ]) {
      const answer = await add(body);
      expect(answer.status, JSON.stringify(body)).toBe(400);
    }
    expect((await auditFor("pincode.add")).results).toHaveLength(0);
  });
});

/**
 * Serving a pincode from Settings is a launch, whichever screen does it
 *: the people waiting there who asked to be told are told, once, as
 * the waitlist's own launch tells them (docs/decisions/0048-referrals.md).
 */
describe("serving a pincode people are waiting for", () => {
  const ASKED = "33333333-3333-4333-8333-333333333331";
  const QUIET = "33333333-3333-4333-8333-333333333332";

  async function waiting(personId: string, mobile: string, name: string, alert: boolean) {
    await env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, ?4)")
      .bind(personId, NOW.toISOString(), mobile, name)
      .run();
    await env.DB.prepare(
      `INSERT INTO waitlist_entries (id, pincode, person_id, contact_consent_at, launch_alert, created_at)
       VALUES (?1, '122018', ?2, ?3, ?4, ?3)`,
    )
      .bind(crypto.randomUUID(), personId, NOW.toISOString(), alert ? 1 : 0)
      .run();
    if (!alert) return;
    await env.DB.prepare(
      `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
       VALUES (?1, ?2, 'whatsapp_launches', 'waitlist-v1', 1, ?3)`,
    )
      .bind(crypto.randomUUID(), personId, NOW.toISOString())
      .run();
  }

  const area = async (pin: string) =>
    (
      await (
        await request(ops, "/api/service-area")
      ).json<{ pincodes: { pincode: string; waiting: number; to_alert: number }[] }>()
    ).pincodes.find((each) => each.pincode === pin);

  beforeEach(async () => {
    await pincode("110001", "Delhi", "Connaught Place", 1, "2026-08-31T18:30:00.000Z");
    await pincode("122018", "Gurgaon", "Sector 65", 0, null);
    await waiting(ASKED, "+919810000011", "Karan Bhatia", true);
    await waiting(QUIET, "+919810000012", "Dev Malik", false);
  });

  it("says, before anything is saved, how many are waiting and how many serving it would tell", async () => {
    expect(await area("122018")).toMatchObject({ waiting: 2, to_alert: 1 });
    expect(await area("110001")).toMatchObject({ waiting: 0, to_alert: 0 });
  });

  it("tells those who asked, as a launch does, and says how many in its answer", async () => {
    const queue = fakeQueue();
    const answer = await post(
      "/api/service-area",
      { changes: [{ pincode: "122018", served: true, launch_on: "2026-09-15" }] },
      { MESSAGE_QUEUE: queue },
    );
    expect(await answer.json()).toEqual({ changed: 1, served: 2, alerted: 1 });
    expect(queue.sent).toHaveLength(1);
    const message = await env.DB.prepare("SELECT person_id, kind, subject_id FROM outbound_messages").first();
    expect(message).toEqual({ person_id: ASKED, kind: "launch_alert", subject_id: "122018" });
    const { results } = await auditFor("pincode.launch");
    expect(results.map((row) => [row.subject_id, JSON.parse(row.detail) as unknown])).toEqual([
      ["122018", { alerts: 1 }],
    ]);
    expect(await area("122018")).toMatchObject({ waiting: 2, to_alert: 0 });
  });

  it("tells nobody twice, however often the pincode is switched off and on", async () => {
    const queue = fakeQueue();
    for (const served of [true, false, true]) {
      await post(
        "/api/service-area",
        { changes: [{ pincode: "122018", served, launch_on: null }] },
        { MESSAGE_QUEUE: queue },
      );
    }
    expect(queue.sent).toHaveLength(1);
  });

  it("tells nobody when a pincode already served is only given a date", async () => {
    const queue = fakeQueue();
    const answer = await post(
      "/api/service-area",
      { changes: [{ pincode: "110001", served: true, launch_on: "2026-09-02" }] },
      { MESSAGE_QUEUE: queue },
    );
    expect(await answer.json()).toEqual({ changed: 1, served: 1, alerted: 0 });
    expect(queue.sent).toEqual([]);
  });
});

/**
 * An area's name, which a launch message, the waitlist and the dispatch board
 * all read. It starts as the shortest of the pincode's post offices, "until ops
 * give better ones" (docs/decisions/0048-referrals.md).
 */
describe("the name ops give an area", () => {
  const PERSON = "44444444-4444-4444-8444-444444444441";

  beforeEach(async () => {
    await pincode("110001", "Delhi", "Connaught Place", 1, null);
    await pincode("122018", "Gurgaon", "Sec91", 0, null);
  });

  const rename = (name: string) =>
    post("/api/service-area", { changes: [{ pincode: "122018", served: false, launch_on: null, area: name }] });

  it("names the area everywhere it is read, the launch message included", async () => {
    expect((await rename("Sector 91")).status).toBe(200);
    await env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000021', 'Karan Bhatia')",
    )
      .bind(PERSON, NOW.toISOString())
      .run();
    await env.DB.prepare(
      `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
       VALUES (?1, ?2, 'whatsapp_launches', 'waitlist-v1', 1, ?3)`,
    )
      .bind(crypto.randomUUID(), PERSON, NOW.toISOString())
      .run();
    await env.DB.prepare("UPDATE serviceable_pincodes SET served = 1 WHERE pincode = '122018'").run();
    const composed = await composeLaunchAlert(env.DB, "122018", PERSON, "local");
    expect("skip" in composed ? composed : renderMessage(composed.template, composed.params)).toContain(
      "Hi Karan, Mane Man now comes to Sector 91. Book your free consultation: http://localhost:4321/book",
    );
  });

  it("records who renamed it, from what and to what, and counts it as a change", async () => {
    expect(await (await rename("Sector 91")).json()).toMatchObject({ changed: 1 });
    const { results } = await auditFor("pincode.rename");
    expect(results[0]).toMatchObject({ actor: "ops@localhost", subject_id: "122018" });
    expect(JSON.parse(results[0]?.detail ?? "{}")).toEqual({ from: "Sec91", to: "Sector 91" });
    expect((await auditFor("pincode.set")).results).toHaveLength(0);
  });

  it("refuses a name that is empty, runs long, or opens as a spreadsheet formula would", async () => {
    for (const name of ["", " ", "=HYPERLINK(1)", "+91", "@home", "A".repeat(41)]) {
      const answer = await rename(name);
      expect(answer.status, name).toBe(400);
      expect(await answer.json()).toMatchObject({ error: { code: "invalid_request", fields: ["changes.0.area"] } });
    }
    expect((await auditFor("pincode.rename")).results).toHaveLength(0);
  });

  it("keeps the name when the reference file is imported again, and refreshes the ones nobody named", async () => {
    await rename("Sector 91");
    await env.DB.prepare(
      pincodeUpsert([
        { pincode: "110001", area: "Janpath", city: "Delhi", served: true, launchedAt: null },
        { pincode: "122018", area: "Sec91", city: "Gurgaon", served: false, launchedAt: null },
      ]),
    ).run();
    const { results } = await env.DB.prepare("SELECT pincode, area FROM serviceable_pincodes ORDER BY pincode").all();
    expect(results).toEqual([
      { pincode: "110001", area: "Janpath" },
      { pincode: "122018", area: "Sector 91" },
    ]);
  });
});
