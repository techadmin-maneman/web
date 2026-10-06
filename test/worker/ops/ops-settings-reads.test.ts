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
import {
  COMMITTED,
  createCachedOpsInputs,
  readOpsInputs,
  SETTINGS_TTL_MS,
} from "../../../src/domain/ops/ops-settings.ts";
import { NEXT_VISIT_DAYS } from "../../../src/policy/next-visit.ts";
import { appFor, captureLogs, countRowsRead, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import { POST, type Setting } from "./ops-settings-fixtures.ts";

let ops: App;

const post = (path: string, body: unknown, bindings: Partial<Env> = {}) =>
  request(ops, path, { method: "POST", headers: POST, body: JSON.stringify(body) }, bindings);

const settings = async (): Promise<Setting[]> =>
  (await (await request(ops, "/api/settings")).json<{ settings: Setting[] }>()).settings;

const named = async (name: string): Promise<Setting> => {
  const found = (await settings()).find((setting) => setting.name === name);
  if (found === undefined) throw new Error(`${name} is not in the answer`);
  return found;
};

/** A row as an earlier release, or a runbook's SQL, left it in the store. */
const storeByHand = (name: string, value: unknown) =>
  env.DB.prepare("INSERT INTO ops_settings (name, value, set_by, set_at) VALUES (?1, ?2, 'ops', ?3)")
    .bind(name, JSON.stringify(value), NOW.toISOString())
    .run();

beforeEach(async () => {
  await markDatabase();
  ops = appFor("local", fakeDependencies(), {}, "ops");
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
    const down = () => Promise.reject(new Error("D1 is down"));
    const broken = { prepare: () => ({ all: down, first: down }) } as unknown as D1Database;

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

  it("keeps every other figure ops set when a release removes a task group", async () => {
    const logs = captureLogs();
    const setByOps = Object.fromEntries(Object.keys(COMMITTED.taskSlaHours).map((group) => [group, 48]));
    await storeByHand("task_sla_hours", { ...setByOps, group_since_removed: 24 });

    expect((await readOpsInputs(env.DB, NOW)).taskSlaHours).toEqual(setByOps);
    expect(await named("task_sla_hours")).toMatchObject({ value: setByOps, set_by: "ops" });
    expect(logs.lines().map((line) => line.event)).not.toContain("ops_setting_ignored");
  });

  it("keeps the choices ops made when a release removes a kind of visit", async () => {
    const chosen = { consultation: "nothing", first_fit: "visit", service: "nothing", replacement: "visit" };
    await storeByHand("late_change_charge", { ...chosen, kind_since_removed: "late_fee" });

    expect((await readOpsInputs(env.DB, NOW)).lateChangeCharges).toEqual(chosen);
    expect((await named("late_change_charge")).set_by).toBe("ops");
  });

  it("ignores a stored row the register would no longer accept, and logs which rule it ignored", async () => {
    const logs = captureLogs();
    await storeByHand("checkin_radius_m", 0);
    expect((await createCachedOpsInputs()(env.DB, NOW)).checkinRadiusM).toBe(COMMITTED.checkinRadiusM);
    expect((await named("checkin_radius_m")).set_by).toBeNull();
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({
        event: "ops_setting_ignored",
        setting: "checkin_radius_m",
        fields: ["checkin_radius_m"],
      }),
    );
  });
});

/**
 * A request reads one row, the snapshot of every input ops set, however long the register grows
 * (docs/decisions/0088-every-policy-in-the-console.md). ops_settings keeps a row per input as the record of who set
 * what; migration 0054's triggers rewrite the snapshot from it in the same transaction as any change to it.
 */
describe("the store a request reads", () => {
  const snapshot = async () =>
    JSON.parse(
      (await env.DB.prepare("SELECT inputs FROM ops_settings_snapshot WHERE id = 1").first<{ inputs: string }>())
        ?.inputs ?? "null",
    ) as unknown;

  it("reads one row, however many inputs are set", async () => {
    await post("/api/settings/checkin_radius_m", { value: 150 });
    await post("/api/settings/address_unlock_hour", { value: 17 });
    await post("/api/settings/booking_days", { value: { ...NEXT_VISIT_DAYS, horizon: 60 } });

    const rowsRead = countRowsRead();
    const inputs = await readOpsInputs(env.DB, NOW);
    expect(rowsRead()).toBe(1);
    expect(inputs).toMatchObject({ checkinRadiusM: 150, addressUnlockHour: 17 });
    expect(inputs.nextVisitDays.horizon).toBe(60);
  });

  it("holds what each change leaves, a figure put back included", async () => {
    await post("/api/settings/checkin_radius_m", { value: 150 });
    await post("/api/settings/address_unlock_hour", { value: 17 });
    await post("/api/settings/checkin_radius_m", { value: null });
    expect(await snapshot()).toEqual({ address_unlock_hour: 17 });
  });

  // Found 1 October 2026: the snapshot's trigger refused a rule's second change, so the console answered 500.
  it("takes a second change of the same rule, and holds the second", async () => {
    expect((await post("/api/settings/checkin_radius_m", { value: 150 })).status).toBe(200);
    expect((await post("/api/settings/checkin_radius_m", { value: 250 })).status).toBe(200);
    expect(await snapshot()).toEqual({ checkin_radius_m: 250 });
    expect(await named("checkin_radius_m")).toMatchObject({ value: 250, set_by: "ops@localhost" });
  });

  it("follows a row written by hand, as a runbook's SQL would write one", async () => {
    await env.DB.prepare(
      "INSERT INTO ops_settings (name, value, set_by, set_at) VALUES ('checkin_radius_m', '300', 'ops', ?1)",
    )
      .bind(NOW.toISOString())
      .run();
    expect((await readOpsInputs(env.DB, NOW)).checkinRadiusM).toBe(300);
  });

  it("builds itself again from the rows when it has gone missing", async () => {
    await post("/api/settings/checkin_radius_m", { value: 150 });
    await env.DB.prepare("DELETE FROM ops_settings_snapshot").run();

    expect((await readOpsInputs(env.DB, NOW)).checkinRadiusM).toBe(150);
    expect(await snapshot()).toEqual({ checkin_radius_m: 150 });
  });

  it("ignores in the snapshot what the register would refuse in a row", async () => {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO ops_settings_snapshot (id, inputs)
       VALUES (1, '{"checkin_radius_m": 0, "made_up_rule": 4, "address_unlock_hour": 17}')`,
    ).run();
    const inputs = await readOpsInputs(env.DB, NOW);
    expect(inputs.checkinRadiusM).toBe(COMMITTED.checkinRadiusM);
    expect(inputs.addressUnlockHour).toBe(17);
  });
});
