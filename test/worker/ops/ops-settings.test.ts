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
import { COMMITTED, createCachedOpsInputs, readOpsInputs } from "../../../src/domain/ops/ops-settings.ts";
import { NEXT_VISIT_DAY_BOUNDS, NEXT_VISIT_DAYS } from "../../../src/policy/next-visit.ts";
import { REFERRAL_REWARD } from "../../../src/policy/referral-reward.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import { POST, type Setting, auditFor } from "./ops-settings-fixtures.ts";

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
   * Every queue on the Tasks board, the consultation request among them.
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

// Each side's reward, set in the console (docs/decisions/0107-referral-rewards-in-the-console.md).
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
