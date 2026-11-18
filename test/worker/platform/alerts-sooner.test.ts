// Alerts that come sooner (docs/decisions/0277-alerts-that-come-sooner.md): a provider's webhook refused at our door
// three times in a row, and a Razorpay event that fails to apply a second time, tell ops at once, and each is closed by
// what puts it right. Every value here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Settings } from "../../../src/config/settings.ts";
import { createLogger } from "../../../src/log.ts";
import { handleRazorpayBatch } from "../../../src/queues/razorpay.ts";
import { fakeBatch } from "../batches.ts";
import {
  appFor,
  captureLogs,
  deliverRazorpay,
  fakeDependencies,
  fakeQueue,
  LOCAL_CONFIG,
  LOCAL_SETTINGS,
  markDatabase,
  request,
} from "../helpers.ts";

const WRONG = "not-the-webhook-secret-razorpay-gave-us";

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

  it("tells ops from its second failed try, and closes it once the event applies", async () => {
    const deps = fakeDependencies();
    expect((await apply(deps, 1, failing))?.retry).toHaveBeenCalled();
    expect(deps.alerts).toEqual([]);
    expect((await apply(deps, 2, failing))?.retry).toHaveBeenCalled();
    expect(deps.alerts).toEqual([
      expect.stringContaining("Look into Razorpay event evt_failing (payment.captured) now") as string,
    ]);
    expect(await open("razorpay_event_failing:evt_failing")).toEqual({ count: 1 });

    expect((await apply(deps, 3))?.ack).toHaveBeenCalled();
    expect(await open("razorpay_event_failing:evt_failing")).toBeNull();
  });
});

describe("Razorpay Checkout failing to load in the client app", () => {
  const failed = (deps: ReturnType<typeof fakeDependencies>, address: string) =>
    request(appFor("local", deps, {}, "client"), "/api/client-errors", {
      method: "POST",
      headers: { Origin: "https://maneman.test", "Content-Type": "application/json", "CF-Connecting-IP": address },
      body: JSON.stringify({
        kind: "checkout_unavailable",
        message: "Checkout did not load: timed out",
        path: "/visits",
        source: "https://checkout.razorpay.com/v1/checkout.js",
      }),
    });

  it("tells ops at the third failure with no payment between, and the next payment captured closes it", async () => {
    const deps = fakeDependencies();
    expect((await failed(deps, "203.0.113.1")).status).toBe(204);
    expect((await failed(deps, "203.0.113.2")).status).toBe(204);
    expect(deps.alerts).toEqual([]);
    expect((await failed(deps, "203.0.113.3")).status).toBe(204);
    expect(deps.alerts).toEqual([
      expect.stringContaining("Check that Razorpay Checkout loads in the client app now") as string,
    ]);

    await deliverRazorpay(captured, { deps });
    expect(await open("checkout_failing")).toBeNull();
  });
});
