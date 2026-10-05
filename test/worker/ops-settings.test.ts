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
import type { App } from "../../src/http/context.ts";
import { renderMessage } from "../../src/config/message-templates.ts";
import { COMMITTED, createCachedOpsInputs, readOpsInputs, SETTINGS_TTL_MS } from "../../src/domain/ops-settings.ts";
import { NEXT_VISIT_DAY_BOUNDS, NEXT_VISIT_DAYS } from "../../src/policy/next-visit.ts";
import { REFERRAL_REWARD } from "../../src/policy/referral-reward.ts";
import { lateFeeOn } from "../../src/domain/price-book.ts";
import { composeLaunchAlert } from "../../src/domain/waitlist.ts";
import { pincodeUpsert } from "../../scripts/lib/pincodes.ts";
import {
  appFor,
  captureLogs,
  countRowsRead,
  fakeDependencies,
  fakeQueue,
  markDatabase,
  NOW,
  request,
} from "./helpers.ts";

let ops: App;

const POST = { "Content-Type": "application/json", Origin: "https://maneman.test" };

const post = (path: string, body: unknown, bindings: Partial<Env> = {}) =>
  request(ops, path, { method: "POST", headers: POST, body: JSON.stringify(body) }, bindings);

interface Setting {
  name: string;
  kind: "number" | "choice";
  unit: string;
  min: number;
  max: number;
  keys: string[] | "open" | null;
  value: number | Record<string, number>;
  default: number | Record<string, number>;
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

/** A row as an earlier release, or a runbook's SQL, left it in the store. */
const storeByHand = (name: string, value: unknown) =>
  env.DB.prepare("INSERT INTO ops_settings (name, value, set_by, set_at) VALUES (?1, ?2, 'ops', ?3)")
    .bind(name, JSON.stringify(value), NOW.toISOString())
    .run();

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
    });
  });

  it("sends the browser no repository paths", async () => {
    for (const setting of await settings()) {
      expect(Object.keys(setting), setting.name).not.toContain("source");
      expect(JSON.stringify(setting), setting.name).not.toMatch(/src\/(config|policy)\//);
    }
  });

  it("says the unit and the bounds of every number, so a form can show them", async () => {
    const numbers = (await settings()).filter((setting) => setting.kind === "number");
    expect(numbers.length).toBeGreaterThan(0);
    for (const setting of numbers) {
      expect(setting.unit, setting.name).not.toBe("");
      expect(setting.min, setting.name).toBeLessThan(setting.max);
    }
  });

  // What a late change or a no-show costs, and what a waiver gives back, are choices (docs/decisions/0088-every-policy-in-the-console.md).
  it("says what each key of a rule of choices may be, and offers a late fee only where the kind has one", async () => {
    const charges = (await settings()).find((setting) => setting.name === "late_change_charge") as unknown as {
      kind: string;
      choices: Record<string, string[]>;
      value: Record<string, string>;
    };
    expect(charges.kind).toBe("choice");
    expect(charges.choices).toEqual({
      consultation: ["nothing", "visit"],
      first_fit: ["nothing", "late_fee", "visit"],
      service: ["nothing", "visit"],
      replacement: ["nothing", "late_fee", "visit"],
    });
    expect(charges.value).toEqual({
      consultation: "nothing",
      first_fit: "late_fee",
      service: "visit",
      replacement: "late_fee",
    });
  });

  it("refuses a late fee for a kind of visit that has none, and a choice no key offers", async () => {
    const charges = { consultation: "nothing", first_fit: "late_fee", service: "visit", replacement: "late_fee" };
    const feeless = await post("/api/settings/late_change_charge", { value: { ...charges, service: "late_fee" } });
    expect(feeless.status).toBe(400);
    expect(await feeless.json()).toMatchObject({ error: { fields: ["late_change_charge.service"] } });
    const madeUp = await post("/api/settings/no_show_waiver", { value: { payment: "halved", credit: "returned" } });
    expect(await madeUp.json()).toMatchObject({ error: { fields: ["no_show_waiver.payment"] } });
    expect((await post("/api/settings/late_change_charge", { value: { ...charges, service: "nothing" } })).status).toBe(
      200,
    );
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

// The seven figures the next visit turns on, as one input with each figure's own bounds, which is how ADR 0086 kept
// them inside the ten inputs the register then held (docs/decisions/0086-the-next-visit-is-offered.md).
describe("the next visit's days", () => {
  it("answers the committed figures, each key with its own bounds, before anybody sets them", async () => {
    const days = await named("booking_days");
    expect(days).toMatchObject({
      unit: "days",
      value: NEXT_VISIT_DAYS,
      default: NEXT_VISIT_DAYS,
      set_by: null,
    });
    // Each key's bounds, and the unit its figure counts in, which for these is every figure's.
    const inDays = Object.fromEntries(
      Object.entries(NEXT_VISIT_DAY_BOUNDS).map(([key, bounds]) => [key, { ...bounds, unit: "days" }]),
    );
    expect((days as Setting & { bounds: unknown }).bounds).toEqual(inDays);
    expect(COMMITTED.nextVisitDays).toEqual(NEXT_VISIT_DAYS);
  });

  it("takes a figure inside its own key's bounds, a lead time of nought among them", async () => {
    const value = { ...NEXT_VISIT_DAYS, first_fit_lead: 0, service_cadence: 28, horizon: 60 };
    const answer = await post("/api/settings/booking_days", { value });
    expect(answer.status).toBe(200);
    expect(await answer.json<Setting>()).toMatchObject({ value, set_by: "ops@localhost" });
    expect((await createCachedOpsInputs()(env.DB, NOW)).nextVisitDays).toEqual(value);
  });

  it("refuses a figure outside its own key's bounds, though inside another's, naming the box", async () => {
    // Nought is a lead time ops may set; a horizon of nought, or of ten days, is shorter than the date strip.
    const answer = await post("/api/settings/booking_days", { value: { ...NEXT_VISIT_DAYS, horizon: 10 } });
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: { fields: ["booking_days.horizon"] } });
    const cadence = await post("/api/settings/booking_days", { value: { ...NEXT_VISIT_DAYS, service_cadence: 0 } });
    expect(await cadence.json()).toMatchObject({ error: { fields: ["booking_days.service_cadence"] } });
    expect((await named("booking_days")).value).toEqual(NEXT_VISIT_DAYS);
    expect((await auditFor("setting.change")).results).toHaveLength(0);
  });

  // With services every 60 days and a horizon of 45, Home offered a day the sheet could not show.
  it("refuses figures that fit their own bounds but not each other, naming the box and the one it must reach", async () => {
    const value = { ...NEXT_VISIT_DAYS, service_cadence: 60, horizon: 45 };
    const answer = await post("/api/settings/booking_days", { value });
    expect(answer.status).toBe(422);
    expect(await answer.json()).toMatchObject({
      error: { code: "figures_conflict", fields: ["booking_days.horizon", "booking_days.service_cadence"] },
    });
    const lead = { ...NEXT_VISIT_DAYS, first_fit_lead: 30, service_cadence: 14, horizon: 20 };
    expect(await (await post("/api/settings/booking_days", { value: lead })).json()).toMatchObject({
      error: { fields: ["booking_days.horizon", "booking_days.first_fit_lead"] },
    });
    expect((await named("booking_days")).value).toEqual(NEXT_VISIT_DAYS);
  });

  it("wants every figure, and refuses a set that leaves one out", async () => {
    const { invoice_prompt: _left_out, ...short } = NEXT_VISIT_DAYS;
    expect((await post("/api/settings/booking_days", { value: short })).status).toBe(400);
  });

  it("records who changed them, the old figures beside the new, and puts the committed ones back", async () => {
    await post("/api/settings/booking_days", { value: { ...NEXT_VISIT_DAYS, service_cadence: 28 } });
    await post("/api/settings/booking_days", { value: null });
    const { results } = await auditFor("setting.change");
    expect(results.map((entry) => entry.subject_id)).toEqual(["booking_days", "booking_days"]);
    expect(JSON.parse(results[0]?.detail ?? "{}")).toEqual({
      from: JSON.stringify(NEXT_VISIT_DAYS),
      to: JSON.stringify({ ...NEXT_VISIT_DAYS, service_cadence: 28 }),
      reset: false,
    });
    expect(JSON.parse(results[1]?.detail ?? "{}")).toMatchObject({ to: JSON.stringify(NEXT_VISIT_DAYS), reset: true });
    expect(await named("booking_days")).toMatchObject({ value: NEXT_VISIT_DAYS, set_by: null });
  });
});

// The owner's ruling of 1 October 2026 (docs/decisions/0107-referral-rewards-in-the-console.md).
describe("what a referral earns", () => {
  const reward = (referrer: number, friend: number, days: number) => ({
    referrer_visits: referrer,
    friend_visits: friend,
    valid_days: days,
  });

  it("answers each side's visits and the credits' life, each with its own bounds, before anybody sets them", async () => {
    const rule = await named("referral_reward");
    expect(rule).toMatchObject({
      unit: "service visits",
      keys: ["referrer_visits", "friend_visits", "valid_days"],
      value: REFERRAL_REWARD,
      default: REFERRAL_REWARD,
      set_by: null,
    });
    expect((rule as Setting & { bounds: unknown }).bounds).toEqual({
      referrer_visits: { min: 0, max: 12, unit: "service visits" },
      friend_visits: { min: 0, max: 12, unit: "service visits" },
      valid_days: { min: 30, max: 1095, unit: "days" },
    });
  });

  it("takes each side apart, nothing for one of them, and a change after the first", async () => {
    expect((await post("/api/settings/referral_reward", { value: reward(3, 2, 180) })).status).toBe(200);
    const again = await post("/api/settings/referral_reward", { value: reward(0, 2, 180) });
    expect(again.status).toBe(200);
    expect(await again.json<Setting>()).toMatchObject({ value: reward(0, 2, 180), set_by: "ops@localhost" });
    expect((await readOpsInputs(env.DB, NOW)).referralReward).toEqual(reward(0, 2, 180));
    const { results } = await auditFor("setting.change");
    expect(results.map((entry) => JSON.parse(entry.detail) as unknown)).toEqual([
      { from: JSON.stringify(REFERRAL_REWARD), to: JSON.stringify(reward(3, 2, 180)), reset: false },
      { from: JSON.stringify(reward(3, 2, 180)), to: JSON.stringify(reward(0, 2, 180)), reset: false },
    ]);
  });

  it("refuses more than a year of visits, or credits that last less than a month, naming the box", async () => {
    const visits = await post("/api/settings/referral_reward", { value: reward(13, 3, 365) });
    expect(visits.status).toBe(400);
    expect(await visits.json()).toMatchObject({ error: { fields: ["referral_reward.referrer_visits"] } });
    const days = await post("/api/settings/referral_reward", { value: reward(3, 3, 7) });
    expect(await days.json()).toMatchObject({ error: { fields: ["referral_reward.valid_days"] } });
    expect((await named("referral_reward")).value).toEqual(REFERRAL_REWARD);
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

  // A row nothing reads is a price nobody is charged.
  it("refuses an item the book does not price", async () => {
    const answer = await post("/api/prices", {
      item: "consultaton",
      tier: "standard",
      amount_ex_gst: 50_000,
      gst_percent: 0,
      valid_from: "2026-09-22",
    });
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: { fields: ["item"] } });
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

  // A price from today changed what a client had been quoted that day.
  it("takes a new price from tomorrow at the earliest, and leaves today's as it was", async () => {
    const change = { item: "late_fee_first_fit", tier: "standard", amount_ex_gst: 600_000, gst_percent: 0 };
    const today = await post("/api/prices", { ...change, valid_from: "2026-09-21" });
    expect(today.status).toBe(400);
    expect(await today.json()).toMatchObject({ error: { code: "invalid_request", fields: ["valid_from"] } });
    expect((await auditFor("price.set")).results).toHaveLength(0);

    expect((await post("/api/prices", { ...change, valid_from: "2026-09-22" })).status).toBe(200);
    expect(await lateFeeOn(env.DB, "late_fee_first_fit", "2026-09-21")).toMatchObject({ amount_ex_gst: 400_000 });
    expect(await lateFeeOn(env.DB, "late_fee_first_fit", "2026-09-22")).toMatchObject({ amount_ex_gst: 600_000 });
  });

  it("refuses part of a rupee, and a rate no GST slab reaches", async () => {
    const base = { item: "service", tier: "standard", gst_percent: 0, valid_from: "2026-09-22" };
    const partRupee = await post("/api/prices", { ...base, amount_ex_gst: 250_050 });
    expect(await partRupee.json()).toMatchObject({ error: { fields: ["amount_ex_gst"] } });
    const noSlab = await post("/api/prices", { ...base, amount_ex_gst: 250_000, gst_percent: 40 });
    expect(await noSlab.json()).toMatchObject({ error: { fields: ["gst_percent"] } });
  });

  // A tier is a service now, added in the console before it is priced (docs/decisions/0085-services-ops-can-edit.md).
  it("prices a service ops added to a kind, which is how a new kind of base is priced", async () => {
    expect((await post("/api/services", { kind: "first_fit", name: "Lace" })).status).toBe(201);
    const answer = await post("/api/prices", {
      item: "first_fit",
      tier: "lace",
      amount_ex_gst: 4_000_000,
      gst_percent: 0,
      valid_from: "2026-09-22",
    });
    expect(answer.status).toBe(200);
    const body = await answer.json<{ prices: { item: string; tier: string; amount_ex_gst: number }[] }>();
    expect(body.prices).toContainEqual(
      expect.objectContaining({ item: "first_fit", tier: "lace", amount_ex_gst: 4_000_000 }),
    );
  });

  // A price for a tier no service carries is a price nobody could ever be sold.
  it("refuses a tier no service of the kind carries, and names the box", async () => {
    const answer = await post("/api/prices", {
      item: "first_fit",
      tier: "lace",
      amount_ex_gst: 4_000_000,
      gst_percent: 0,
      valid_from: "2026-09-22",
    });
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: { code: "invalid_request", fields: ["tier"] } });
    expect((await auditFor("price.set")).results).toHaveLength(0);
  });

  it("keeps a late fee to one figure a kind, its standard tier's", async () => {
    const fee = { item: "late_fee_first_fit", amount_ex_gst: 500_000, gst_percent: 0, valid_from: "2026-09-22" };
    expect((await post("/api/prices", { ...fee, tier: "standard" })).status).toBe(200);
    const answer = await post("/api/prices", { ...fee, tier: "premium" });
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: { fields: ["tier"] } });
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

  // The first price of a service once was recorded as from -1.
  it("records from as null where the book had no price for it", async () => {
    await post("/api/services", { kind: "first_fit", name: "Lace" });
    await post("/api/prices", {
      item: "first_fit",
      tier: "lace",
      amount_ex_gst: 4_000_000,
      gst_percent: 0,
      valid_from: "2026-09-22",
    });
    const { results } = await auditFor("price.set");
    expect(JSON.parse(results[0]?.detail ?? "{}")).toMatchObject({ from: null, to: 4_000_000 });
  });
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

// A price set for a day still to come is a decision somebody has to be able to take back before it lands.
describe("withdrawing a price still to come", () => {
  const OCTOBER = {
    item: "service",
    tier: "standard",
    amount_ex_gst: 250_000,
    gst_percent: 18,
    valid_from: "2026-10-01",
  };
  const withdraw = (row: { item: string; tier: string; valid_from: string }) => post("/api/prices/withdraw", row);
  const serviceRows = async () =>
    (await (await request(ops, "/api/prices")).json<{ prices: { item: string; valid_from: string }[] }>()).prices
      .filter((price) => price.item === "service")
      .map((price) => price.valid_from);

  it("takes the row out of the book, so the price before it goes on applying", async () => {
    await post("/api/prices", OCTOBER);
    const answer = await withdraw({ item: "service", tier: "standard", valid_from: "2026-10-01" });
    expect(answer.status).toBe(200);
    expect(await serviceRows()).toEqual(["2026-09-22", "2026-01-01"]);
  });

  it("records who withdrew it, and what it would have been", async () => {
    await post("/api/prices", OCTOBER);
    await withdraw({ item: "service", tier: "standard", valid_from: "2026-10-01" });
    const { results } = await auditFor("price.withdraw");
    expect(results[0]).toMatchObject({ actor: "ops@localhost", subject_id: "service/standard" });
    expect(JSON.parse(results[0]?.detail ?? "{}")).toEqual({
      amount_ex_gst: 250_000,
      gst_percent: 18,
      valid_from: "2026-10-01",
    });
  });

  it("refuses the price in force and a spent one, since a visit may have been invoiced under either", async () => {
    await env.DB.prepare(
      "INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from) VALUES ('service', 'standard', 250000, 18, '2026-09-21')",
    ).run();
    for (const validFrom of ["2026-01-01", "2026-09-21"]) {
      const answer = await withdraw({ item: "service", tier: "standard", valid_from: validFrom });
      expect(answer.status, validFrom).toBe(400);
      expect(await answer.json()).toMatchObject({ error: { code: "invalid_request", fields: ["valid_from"] } });
    }
    expect((await auditFor("price.withdraw")).results).toHaveLength(0);
  });

  it("answers not_found for a row the book does not hold", async () => {
    expect((await withdraw({ item: "service", tier: "standard", valid_from: "2026-12-01" })).status).toBe(404);
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
