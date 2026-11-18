// Alerts that come sooner (docs/decisions/0277-alerts-that-come-sooner.md): a provider's webhook refused at our door
// three times in a row, and a Razorpay event that fails to apply a second time, tell ops at once, and each is closed by
// what puts it right. Every value here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Settings } from "../../../src/config/settings.ts";
import { createLogger } from "../../../src/log.ts";
import { handleRazorpayBatch, paidThroughCheckout } from "../../../src/queues/razorpay.ts";
import { openSession } from "../../../src/domain/sign-in/sessions.ts";
import { fakeBatch } from "../batches.ts";
import { JOB, working } from "../job-fixtures.ts";
import { aHold, aPerson, aTechnician } from "../fixtures/index.ts";
import { alertRefusalRates } from "../../../src/domain/messages/refusal-rates.ts";
import { alertVisitsNotBegun } from "../../../src/domain/dispatch/not-begun.ts";
import { outstandingTasks } from "../../../src/domain/ops/tasks.ts";
import { TASK_SLA_HOURS } from "../../../src/policy/tasks.ts";
import {
  appFor,
  captureLogs,
  deliverRazorpay,
  fakeDependencies,
  fakeQueue,
  LOCAL_CONFIG,
  LOCAL_SETTINGS,
  markDatabase,
  NOW,
  request,
} from "../helpers.ts";

const WRONG = "not-the-webhook-secret-razorpay-gave-us";
/** Where the job fixture's client lives: a check-in there passes. */
const AT_THE_DOOR = { lat: 28.3988, lng: 77.07 };

/** A delivery the webhook takes and queues: a payment's captured event, signed. */
const captured = {
  entity: "event",
  event: "payment.captured",
  contains: ["payment"],
  payload: {
    payment: {
      entity: {
        id: "pay_1",
        entity: "payment",
        amount: 50000,
        currency: "INR",
        status: "captured",
        order_id: "order_1",
        method: "upi",
        notes: [],
        created_at: 1790067435,
      },
    },
  },
  created_at: 1790067436,
};

const open = (key: string) =>
  env.DB.prepare("SELECT count FROM alerts WHERE key = ?1 AND resolved_at IS NULL")
    .bind(key)
    .first<{ count: number }>();

beforeEach(async () => {
  captureLogs();
  await markDatabase();
});

describe("a webhook refused at our door", () => {
  it("tells ops once Razorpay's deliveries are refused three in a row, and closes it at the next one taken", async () => {
    const deps = fakeDependencies();
    expect((await deliverRazorpay(captured, { deps, secret: WRONG })).status).toBe(401);
    expect((await deliverRazorpay(captured, { deps, secret: WRONG })).status).toBe(401);
    expect(deps.alerts).toEqual([]);
    expect((await deliverRazorpay(captured, { deps, secret: WRONG })).status).toBe(401);
    expect(deps.alerts).toEqual([expect.stringContaining("Check the Razorpay webhook's secret now") as string]);

    expect((await deliverRazorpay(captured, { deps })).status).toBe(200);
    expect(await open("webhook_refused:razorpay")).toBeNull();
  });

  it("counts again from nothing once a delivery is taken between", async () => {
    const deps = fakeDependencies();
    await deliverRazorpay(captured, { deps, secret: WRONG });
    await deliverRazorpay(captured, { deps, secret: WRONG });
    await deliverRazorpay(captured, { deps });
    await deliverRazorpay(captured, { deps, secret: WRONG });
    expect(deps.alerts).toEqual([]);
    expect(await open("webhook_refused:razorpay")).toEqual({ count: 1 });
  });

  it("raises it once a day at most, so posts anyone can forge cannot raise it again after each real delivery", async () => {
    const deps = fakeDependencies();
    for (let refused = 0; refused < 3; refused += 1) await deliverRazorpay(captured, { deps, secret: WRONG });
    await deliverRazorpay(captured, { deps });
    for (let refused = 0; refused < 3; refused += 1) await deliverRazorpay(captured, { deps, secret: WRONG });
    expect(deps.alerts).toHaveLength(1);
    expect(await open("webhook_refused:razorpay")).toBeNull();
  });

  // An open alert's retells at 30, 300 and 3,000 sightings would page again with no delivery between.
  it("pages once for a long run of refusals with no delivery between", async () => {
    const deps = fakeDependencies();
    for (let refused = 0; refused < 30; refused += 1) await deliverRazorpay(captured, { deps, secret: WRONG });
    expect(deps.alerts).toHaveLength(1);
    expect(await open("webhook_refused:razorpay")).toEqual({ count: 3 });
  });

  // Stray posts between real deliveries never form a run, and must not stop a real mismatch from being told.
  it("tells a real mismatch after stray refusals between real deliveries", async () => {
    const deps = fakeDependencies();
    for (let stray = 0; stray < 3; stray += 1) {
      await deliverRazorpay(captured, { deps, secret: WRONG });
      await deliverRazorpay(captured, { deps });
    }
    for (let refused = 0; refused < 3; refused += 1) await deliverRazorpay(captured, { deps, secret: WRONG });
    expect(deps.alerts).toEqual([expect.stringContaining("Check the Razorpay webhook's secret now") as string]);
  });

  it("does the same for Evolution's webhook", async () => {
    const deps = fakeDependencies();
    const token = "an-evolution-webhook-token-of-thirty-two";
    const app = appFor("local", deps, {
      messaging: {
        ...LOCAL_SETTINGS.messaging,
        evolution: { ...LOCAL_SETTINGS.messaging.evolution, webhookToken: token },
      },
    } as Partial<Settings>);
    const post = (bearer: string) =>
      request(
        app,
        "/api/hooks/evolution",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
          body: JSON.stringify({ event: "messages.update", data: [] }),
        },
        { MESSAGE_QUEUE: fakeQueue() },
      );
    for (let refused = 0; refused < 3; refused += 1) expect((await post("a-token-that-is-not-ours")).status).toBe(401);
    expect(deps.alerts).toEqual([expect.stringContaining("Check the Evolution webhook's secret now") as string]);
    expect((await post(token)).status).toBeLessThan(300);
    expect(await open("webhook_refused:evolution")).toBeNull();
  });

  it("does the same for MSG91's WhatsApp webhook", async () => {
    const deps = fakeDependencies();
    const msg91: NonNullable<Settings["messaging"]["msg91"]> = {
      authKey: "msg91-key",
      integratedNumber: "919800000000",
      webhookToken: "an-msg91-webhook-token-of-thirty-two-chars",
    };
    const app = appFor("local", deps, { messaging: { ...LOCAL_SETTINGS.messaging, msg91 } });
    const post = (token: string) =>
      request(
        app,
        "/api/hooks/msg91",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ direction: "1", eventName: "delivered", requestId: "req-1" }),
        },
        { MESSAGE_QUEUE: fakeQueue() },
      );
    for (let refused = 0; refused < 3; refused += 1) expect((await post("a-token-that-is-not-ours")).status).toBe(401);
    expect(deps.alerts).toEqual([expect.stringContaining("Check the MSG91 WhatsApp webhook's secret now") as string]);
    expect((await post(msg91.webhookToken)).status).toBe(204);
    expect(await open("webhook_refused:msg91")).toBeNull();
  });
});

describe("a Razorpay event that keeps failing to apply", () => {
  /** The queue handing the event to its consumer for the `attempts`th time, over a database that may refuse writes. */
  async function apply(deps: ReturnType<typeof fakeDependencies>, attempts: number, db: D1Database = env.DB) {
    const batch = fakeBatch(
      "mm-razorpay-local",
      [{ event_id: "evt_failing", request_id: "req-1", body: JSON.stringify(captured) }],
      { attempts },
    );
    await handleRazorpayBatch({
      batch,
      env: { ...env, DB: db },
      config: LOCAL_CONFIG,
      deps,
      log: createLogger(),
    });
    return batch.messages[0];
  }

  /** A database whose every statement throws, as D1 overloaded does. */
  const failing = {
    prepare: () => {
      throw new Error("D1_ERROR: overloaded");
    },
    batch: () => Promise.reject(new Error("D1_ERROR: overloaded")),
  } as unknown as D1Database;

  // A refund that came before its payment uses its first try without failing: one failure after it tells nobody.
  it("counts failures, not tries", async () => {
    const deps = fakeDependencies();
    expect((await apply(deps, 2, failing))?.retry).toHaveBeenCalled();
    expect(deps.alerts).toEqual([]);
  });

  it("tells ops at its second failure, and closes it once the event applies", async () => {
    const deps = fakeDependencies();
    expect((await apply(deps, 1, failing))?.retry).toHaveBeenCalled();
    expect(deps.alerts).toEqual([]);
    expect((await apply(deps, 2, failing))?.retry).toHaveBeenCalled();
    expect(deps.alerts).toEqual([
      expect.stringContaining("Look into Razorpay event evt_failing (payment.captured) now") as string,
    ]);
    expect(await open("razorpay_event_failing:evt_failing")).toEqual({ count: 2 });

    expect((await apply(deps, 3))?.ack).toHaveBeenCalled();
    expect(await open("razorpay_event_failing:evt_failing")).toBeNull();
  });
});

describe("Razorpay Checkout failing to load in the client app", () => {
  const CLIENTS = [
    "33333333-3333-4333-8333-000000000001",
    "33333333-3333-4333-8333-000000000002",
    "33333333-3333-4333-8333-000000000003",
  ];

  /** A signed-in client's report that Checkout did not load, at `at`. */
  async function failed(person: string, at = NOW, surface: "client" | "public" = "client") {
    if ((await env.DB.prepare("SELECT 1 FROM people WHERE id = ?1").bind(person).first()) === null) {
      await aPerson({ id: person });
    }
    const cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: person, deviceLabel: null, now: at })}`;
    const deps = fakeDependencies({ now: () => at });
    const answer = await request(appFor("local", deps, {}, surface), "/api/client-errors", {
      method: "POST",
      headers: { Cookie: cookie, Origin: "https://maneman.test", "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "checkout_unavailable",
        message: "Checkout did not load: timed out",
        path: "/visits",
        source: "https://checkout.razorpay.com/v1/checkout.js",
      }),
    });
    expect(answer.status).toBe(204);
    return deps.alerts;
  }

  const told = () =>
    env.DB.prepare("SELECT told_at FROM alerts WHERE key = 'checkout_failing' AND resolved_at IS NULL").first<{
      told_at: string | null;
    }>();

  it("tells ops once three signed-in clients' Checkout failed within a quarter hour", async () => {
    expect(await failed(CLIENTS[0] ?? "")).toEqual([]);
    expect(await failed(CLIENTS[1] ?? "")).toEqual([]);
    expect(await failed(CLIENTS[2] ?? "")).toEqual([
      expect.stringContaining("Check that Razorpay Checkout loads in the client app now") as string,
    ]);
  });

  it("counts a client once an hour, and nothing from a page not signed in or not the app", async () => {
    for (let report = 0; report < 3; report += 1) await failed(CLIENTS[0] ?? "");
    await failed(CLIENTS[1] ?? "", NOW, "public");
    expect(await open("checkout_failing")).toEqual({ count: 1 });
    const unsigned = await request(appFor("local", fakeDependencies(), {}, "client"), "/api/client-errors", {
      method: "POST",
      headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "checkout_unavailable", message: "Checkout did not load: timed out", path: "/" }),
    });
    expect(unsigned.status).toBe(204);
    expect(await open("checkout_failing")).toEqual({ count: 1 });
  });

  it("starts the count again when the failures are spread wider than a quarter hour", async () => {
    await failed(CLIENTS[0] ?? "", NOW);
    await failed(CLIENTS[1] ?? "", new Date(NOW.getTime() + 10 * 60_000));
    await failed(CLIENTS[2] ?? "", new Date(NOW.getTime() + 20 * 60_000));
    expect(await told()).toEqual({ told_at: null });
    expect(await open("checkout_failing")).toEqual({ count: 1 });
  });

  // A link sent for a hold carries the hold in its notes too, so only the order tells a Checkout payment apart.
  it("is closed by a payment made through Checkout, on a hold's own order, and not by a payment link's", async () => {
    const person = await aPerson();
    const technician = await aTechnician();
    await aHold({ person_id: person.id, technician_id: technician.id, razorpay_order_id: "order_hold_1" });
    const paid = (order: string, notes: unknown) => ({
      payload: { payment: { entity: { ...captured.payload.payment.entity, order_id: order, notes } } },
    });
    expect(await paidThroughCheckout(env.DB, paid("order_hold_1", {}))).toBe(true);
    // A hold paid by a link takes the link's order once paid.
    await aHold({
      person_id: person.id,
      technician_id: technician.id,
      pay_by_link: 1,
      razorpay_order_id: "order_link_2",
    });
    expect(await paidThroughCheckout(env.DB, paid("order_link_2", {}))).toBe(false);
    const link = paid("order_link_1", { hold_id: "33333333-3333-4333-8333-0000000000aa", person_id: person.id });
    expect(await paidThroughCheckout(env.DB, link)).toBe(false);
  });
});

describe("a visit its technician has not begun past its arrival window", () => {
  // The job fixture's visit starts at 1 pm in India (07:30 UTC); its arrival window is the half hour after.
  const LATE = new Date("2026-09-21T08:15:00.000Z");
  const TODAY_STARTS = "2026-09-20T18:30:00.000Z";
  const notBegun = async (at: Date) =>
    (await outstandingTasks(env.DB, at, TASK_SLA_HOURS)).tasks.filter((task) => task.group === "visit_not_begun");

  it("is a task and an alert once the window is over with no check-in, and goes at the check-in", async () => {
    const job = await working("service");
    expect(await notBegun(new Date("2026-09-21T07:55:00.000Z"))).toEqual([]);
    expect(await notBegun(LATE)).toEqual([
      expect.objectContaining({
        id: JOB,
        since: "2026-09-21T08:00:00.000Z",
        facts: {
          group: "visit_not_begun",
          kind: "service",
          starts_at: "2026-09-21T07:30:00.000Z",
          technician: "Imran Qureshi",
        },
      }),
    ]);
    expect(
      await alertVisitsNotBegun(env.DB, job.deps.alertOnce, { now: LATE, todayStarts: TODAY_STARTS, arrival: 30 }),
    ).toBe(1);
    expect(job.deps.alerts).toEqual([expect.stringContaining(`Call the technician of visit ${JOB} now`) as string]);

    // The task opens its visit on the board, as its neighbours do.
    const [task] = await notBegun(LATE);
    expect(task?.visit).toMatchObject({ id: JOB });

    await job.post(`/api/tech/jobs/${JOB}/checkin`, AT_THE_DOOR, "event-checkin-01");
    expect(await notBegun(LATE)).toEqual([]);
    expect(
      await alertVisitsNotBegun(env.DB, job.deps.alertOnce, { now: LATE, todayStarts: TODAY_STARTS, arrival: 30 }),
    ).toBe(0);
    expect(await open(`visit_not_begun:${JOB}`)).toBeNull();
  });
});

describe("a staging test record's visit not begun", () => {
  it("is a task, and pages nobody", async () => {
    const job = await working("service");
    await env.DB.prepare("UPDATE technicians SET test_record = 1").run();
    expect(
      await alertVisitsNotBegun(env.DB, job.deps.alertOnce, {
        now: new Date("2026-09-21T08:15:00.000Z"),
        todayStarts: "2026-09-20T18:30:00.000Z",
        arrival: 30,
      }),
    ).toBe(0);
    expect(job.deps.alerts).toEqual([]);
  });
});

describe("a kind of WhatsApp refused too often", () => {
  const LIMIT = { share: 20, least: 5 };
  const AT = new Date("2026-09-21T06:30:00.000Z");

  async function sentToday(kind: string, refused: number, delivered: number) {
    if ((await env.DB.prepare("SELECT 1 FROM people WHERE id = 'p1'").first()) === null) await aPerson({ id: "p1" });
    for (let each = 0; each < refused + delivered; each += 1) {
      await env.DB.prepare(
        `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_id, state, provider_message_id, sent_at,
           last_error)
         VALUES (?1, ?2, 'p1', ?3, ?1, ?4, ?1, ?2, ?5)`,
      )
        .bind(
          crypto.randomUUID(),
          "2026-09-21T03:00:00.000Z",
          kind,
          each < refused ? "failed" : "sent",
          each < refused ? "refused 131049" : null,
        )
        .run();
    }
  }

  it("tells Care once a day's share refused reaches ops' setting, and closes it once under", async () => {
    const deps = fakeDependencies();
    await sentToday("visit_cancelled", 1, 4);
    await sentToday("visit_reminder", 0, 9);
    expect(await alertRefusalRates(env.DB, deps.alertOnce, { now: AT, limit: LIMIT })).toBe(1);
    expect(deps.alerts).toEqual([
      expect.stringContaining(
        'Look into the visit_cancelled WhatsApp (runbook, "WhatsApp refused"): WhatsApp refused 1 of the 5',
      ) as string,
    ]);

    await sentToday("visit_cancelled", 0, 5);
    expect(await alertRefusalRates(env.DB, deps.alertOnce, { now: AT, limit: LIMIT })).toBe(0);
    expect(await open("messages_refused:visit_cancelled")).toBeNull();
  });

  it("counts nothing of what Care do not chase, the marketing texts above all", async () => {
    const deps = fakeDependencies();
    await sentToday("next_service_reminder", 9, 1);
    expect(await alertRefusalRates(env.DB, deps.alertOnce, { now: AT, limit: LIMIT })).toBe(0);
  });

  it("counts nothing until the fewest sent", async () => {
    const deps = fakeDependencies();
    await sentToday("visit_cancelled", 2, 2);
    expect(await alertRefusalRates(env.DB, deps.alertOnce, { now: AT, limit: LIMIT })).toBe(0);
  });
});
