// The business inputs ops set for themselves, on the ops surface
// (src/routes/ops-settings.ts, docs/decisions/0061-ops-editable-inputs.md). NOW
// is Monday 21 September 2026, 12 noon in India. Every pincode here is real
// only as a number; nothing is a person, a mobile or an address.
//
// What these hold: an empty store behaves as the committed code does, a change
// reaches the routes that read it without a deploy, a figure outside the bounds
// never lands, every change is recorded under the Access identity behind it,
// and neither ops nor a file can leave the business with nowhere to go.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.ts";
import { COMMITTED, createCachedOpsInputs, SETTINGS_TTL_MS } from "../../src/domain/ops-settings.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request } from "./helpers.ts";

let ops: App;

const POST = { "Content-Type": "application/json", Origin: "https://maneman.test" };

const post = (path: string, body: unknown) =>
  request(ops, path, { method: "POST", headers: POST, body: JSON.stringify(body) });

interface Setting {
  name: string;
  unit: string;
  min: number;
  max: number;
  keys: string[] | "open" | null;
  value: number | Record<string, number>;
  default: number | Record<string, number>;
  source: string;
  set_by: string | null;
  set_at: string | null;
}

const settings = async (): Promise<Setting[]> =>
  (await (await request(ops, "/api/settings")).json<{ settings: Setting[] }>()).settings;

const named = async (name: string): Promise<Setting> => {
  const found = (await settings()).find((setting) => setting.name === name);
  if (found === undefined) throw new Error(`${name} is not in the answer`);
  return found;
};

const auditFor = (action: string) =>
  env.DB.prepare("SELECT actor, actor_kind, subject_id, detail FROM audit_log WHERE action = ?1 ORDER BY id")
    .bind(action)
    .all<{ actor: string; actor_kind: string; subject_id: string; detail: string }>();

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

describe("the rules, before anybody sets one", () => {
  it("answers the figures the code committed, and says nobody set them", async () => {
    const radius = await named("checkin_radius_m");
    expect(radius).toMatchObject({
      value: COMMITTED.checkinRadiusM,
      default: COMMITTED.checkinRadiusM,
      unit: "metres",
      set_by: null,
      set_at: null,
      source: "src/policy/check-in.ts",
    });
  });

  it("says the unit and the bounds of every one, so a form can show them", async () => {
    for (const setting of await settings()) {
      expect(setting.unit, setting.name).not.toBe("");
      expect(setting.min, setting.name).toBeLessThan(setting.max);
    }
  });
});

describe("setting one", () => {
  it("takes a figure inside the bounds and answers what it now is", async () => {
    const answer = await post("/api/settings/checkin_radius_m", { value: 150 });
    expect(answer.status).toBe(200);
    expect(await answer.json<Setting>()).toMatchObject({ value: 150, default: 200, set_by: "ops@localhost" });
  });

  it("refuses a figure outside them, names the field, and changes nothing", async () => {
    const answer = await post("/api/settings/checkin_radius_m", { value: 10 });
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: { code: "invalid_request", fields: ["checkin_radius_m"] } });
    expect((await named("checkin_radius_m")).value).toBe(COMMITTED.checkinRadiusM);
  });

  it("refuses a nought, which is the figure that would break the fence altogether", async () => {
    expect((await post("/api/settings/checkin_radius_m", { value: 0 })).status).toBe(400);
  });

  it("names the key inside a set, so the form can point at the box", async () => {
    const answer = await post("/api/settings/task_sla_hours", {
      value: { ...COMMITTED.taskSlaHours, referral_review: 0 },
    });
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: { fields: ["task_sla_hours.referral_review"] } });
  });

  /**
   * Every queue on board D2, the consultation request #107 added among them.
   * A queue with no allowance of its own would fall due the moment it opened.
   */
  it("wants an allowance for every task group, and refuses a set that leaves one out", async () => {
    const { consultation_request: _left_out, ...short } = COMMITTED.taskSlaHours;
    expect((await post("/api/settings/task_sla_hours", { value: short })).status).toBe(400);
    expect((await post("/api/settings/task_sla_hours", { value: COMMITTED.taskSlaHours })).status).toBe(200);
  });

  it("lets ops name a base of their own and give it its own cycle", async () => {
    const answer = await post("/api/settings/piece_cycle_days", { value: { default: 180, "Lace base": 120 } });
    expect(answer.status).toBe(200);
    expect((await answer.json<Setting>()).value).toEqual({ default: 180, "Lace base": 120 });
  });

  it("puts the committed figure back, and forgets who set it", async () => {
    await post("/api/settings/checkin_radius_m", { value: 150 });
    const back = await post("/api/settings/checkin_radius_m", { value: null });
    expect(await back.json<Setting>()).toMatchObject({ value: COMMITTED.checkinRadiusM, set_by: null });
  });

  it("records who changed it, from what and to what", async () => {
    await post("/api/settings/checkin_radius_m", { value: 150 });
    const { results } = await auditFor("setting.change");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ actor: "ops@localhost", actor_kind: "staff", subject_id: "checkin_radius_m" });
    expect(JSON.parse(results[0]?.detail ?? "{}")).toEqual({ from: "200", to: "150", reset: false });
  });

  it("writes no audit entry for a figure it refused", async () => {
    await post("/api/settings/checkin_radius_m", { value: 4000 });
    expect((await auditFor("setting.change")).results).toHaveLength(0);
  });

  it("refuses a name the register does not hold", async () => {
    expect((await post("/api/settings/made_up_rule", { value: 1 })).status).toBe(400);
  });
});

describe("what the routes that read them do", () => {
  it("measures a check-in against the radius ops set, not the one in the code", async () => {
    await post("/api/settings/checkin_radius_m", { value: 150 });
    const read = createCachedOpsInputs();
    expect((await read(env.DB, NOW)).checkinRadiusM).toBe(150);
  });

  it("holds it for a minute and no longer, so a change lands without a deploy", async () => {
    const read = createCachedOpsInputs();
    expect((await read(env.DB, NOW)).checkinRadiusM).toBe(COMMITTED.checkinRadiusM);

    await post("/api/settings/checkin_radius_m", { value: 150 });
    // Inside the window the isolate still answers what it read.
    expect((await read(env.DB, new Date(NOW.getTime() + SETTINGS_TTL_MS - 1))).checkinRadiusM).toBe(
      COMMITTED.checkinRadiusM,
    );
    expect((await read(env.DB, new Date(NOW.getTime() + SETTINGS_TTL_MS))).checkinRadiusM).toBe(150);
  });

  it("falls back to the committed figures when the store cannot be read, and never to a nought", async () => {
    const read = createCachedOpsInputs();
    const broken = {
      prepare: () => ({ all: () => Promise.reject(new Error("D1 is down")) }),
    } as unknown as D1Database;

    let reported: unknown = null;
    const inputs = await read(broken, NOW, (error) => {
      reported = error;
    });
    expect(inputs).toEqual(COMMITTED);
    expect(reported).toBeInstanceOf(Error);
  });

  it("keeps what ops set for each task group when a group is added later, which takes its committed figure", async () => {
    const setBeforeTheGroupsWereAdded = {
      consultation_request: 24,
      replacement_order: 24,
      referral_review: 24,
      no_show_decision: 24,
      number_change: 24,
      erasure_request: 24,
    };
    await env.DB.prepare(
      "INSERT INTO ops_settings (name, value, set_by, set_at) VALUES ('task_sla_hours', ?1, 'ops', ?2)",
    )
      .bind(JSON.stringify(setBeforeTheGroupsWereAdded), NOW.toISOString())
      .run();
    expect((await createCachedOpsInputs()(env.DB, NOW)).taskSlaHours).toEqual({
      ...COMMITTED.taskSlaHours,
      ...setBeforeTheGroupsWereAdded,
    });
    expect((await named("task_sla_hours")).set_by).toBe("ops");
  });

  it("ignores a stored row the register would no longer accept", async () => {
    await env.DB.prepare("INSERT INTO ops_settings (name, value, set_by, set_at) VALUES (?1, ?2, 'ops', ?3)")
      .bind("checkin_radius_m", "0", NOW.toISOString())
      .run();
    expect((await createCachedOpsInputs()(env.DB, NOW)).checkinRadiusM).toBe(COMMITTED.checkinRadiusM);
    expect((await named("checkin_radius_m")).set_by).toBeNull();
  });
});

describe("the price book", () => {
  it("marks the one row that applies today, and leaves the rest past or still to come", async () => {
    await post("/api/prices", {
      item: "service",
      tier: "standard",
      amount_ex_gst: 250_000,
      gst_percent: 0,
      valid_from: "2026-10-01",
    });
    const body = await (
      await request(ops, "/api/prices")
    ).json<{ prices: { item: string; valid_from: string; in_force: boolean }[] }>();
    const service = body.prices.filter((price) => price.item === "service");
    // The seeded rows are migrations 0016 (from January) and 0018 (from the 22nd),
    // and today is the 21st, so January's is what is charged and the other two are not.
    expect(service.filter((price) => price.in_force).map((price) => price.valid_from)).toEqual(["2026-01-01"]);
    expect(service.map((price) => price.valid_from)).toEqual(["2026-10-01", "2026-09-22", "2026-01-01"]);
  });

  it("refuses a price dated before today, since a visit was invoiced under the old one", async () => {
    const answer = await post("/api/prices", {
      item: "service",
      tier: "standard",
      amount_ex_gst: 250_000,
      gst_percent: 0,
      valid_from: "2026-09-01",
    });
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: { fields: ["valid_from"] } });
  });

  it("refuses part of a rupee, and a rate no GST slab reaches", async () => {
    const base = { item: "service", tier: "standard", gst_percent: 0, valid_from: "2026-09-21" };
    expect((await post("/api/prices", { ...base, amount_ex_gst: 250_050 })).status).toBe(400);
    expect((await post("/api/prices", { ...base, amount_ex_gst: 250_000, gst_percent: 40 })).status).toBe(400);
  });

  it("prices a tier the book has never held, which is how a new kind of base is priced", async () => {
    const answer = await post("/api/prices", {
      item: "first_fit",
      tier: "lace",
      amount_ex_gst: 4_000_000,
      gst_percent: 0,
      valid_from: "2026-09-21",
    });
    expect(answer.status).toBe(200);
    const body = await answer.json<{ prices: { item: string; tier: string; amount_ex_gst: number }[] }>();
    expect(body.prices).toContainEqual(
      expect.objectContaining({ item: "first_fit", tier: "lace", amount_ex_gst: 4_000_000 }),
    );
  });

  it("records who set it, from what and from when", async () => {
    await post("/api/prices", {
      item: "service",
      tier: "standard",
      amount_ex_gst: 250_000,
      gst_percent: 0,
      valid_from: "2026-10-01",
    });
    const { results } = await auditFor("price.set");
    expect(results[0]).toMatchObject({ actor: "ops@localhost", subject_id: "service/standard" });
    expect(JSON.parse(results[0]?.detail ?? "{}")).toEqual({
      from: 200_000,
      to: 250_000,
      gst_percent: 0,
      valid_from: "2026-10-01",
    });
  });
});

describe("the service area", () => {
  beforeEach(async () => {
    // Midnight in India on 1 September, as the import and the console store a launch date.
    await pincode("110001", "Delhi", "Connaught Place", 1, "2026-08-31T18:30:00.000Z");
    await pincode("110017", "Delhi", "Saket", 0, null);
    await pincode("122018", "Gurgaon", "Sector 65", 0, null);
  });

  it("lists every pincode with its city and whether we go there", async () => {
    const body = await (
      await request(ops, "/api/service-area")
    ).json<{ pincodes: { pincode: string; launch_on: string | null }[] }>();
    expect(body.pincodes).toHaveLength(3);
    expect(body.pincodes[0]).toMatchObject({ pincode: "110001", city: "Delhi", served: true, launch_on: "2026-09-01" });
  });

  it("serves a pincode from a date, and counts only what changed", async () => {
    const answer = await post("/api/service-area", {
      changes: [
        { pincode: "122018", served: true, launch_on: "2026-10-01" },
        // Unchanged: it is sent and it is not counted, so the log records no change that was not one.
        { pincode: "110001", served: true, launch_on: "2026-09-01" },
      ],
    });
    expect(await answer.json()).toEqual({ changed: 1, served: 2 });
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
    await post("/api/service-area", { changes: [{ pincode: "122018", served: true, launch_on: "2026-10-01" }] });
    const { results } = await auditFor("pincode.set");
    expect(results[0]).toMatchObject({ actor: "ops@localhost", subject_id: "122018" });
    expect(JSON.parse(results[0]?.detail ?? "{}")).toEqual({
      served_from: false,
      served_to: true,
      launch_from: "",
      launch_to: "2026-10-01",
    });
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
