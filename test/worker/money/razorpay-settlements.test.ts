// Razorpay's settlements to the bank (src/domain/money/razorpay-settlements.ts): each processed one kept once, from its
// webhook or from the hourly catch-up's read of the last week. NOW is Monday 21 September 2026, 12 noon in India,
// 06:30 UTC. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { applyRazorpayEvent, RazorpayEventSchema } from "../../../src/domain/money/razorpay-events.ts";
import { createLogger } from "../../../src/log.ts";
import type { RazorpaySettlement } from "../../../src/providers/payments/razorpay.ts";
import { createStubPayments, type StubPayments } from "../../../src/providers/payments/stub.ts";
import { CRON_JOBS } from "../../../src/scheduled/cron.ts";
import { runCronJobs } from "../../../src/scheduled/cron-runner.ts";
import { captureLogs, fakeDependencies, fakeQueue, LOCAL_CONFIG, markDatabase, NOW } from "../helpers.ts";

const MINUTE_MS = 60 * 1000;
const DAY_S = 24 * 60 * 60;
const nowS = Math.floor(NOW.getTime() / 1000);

/** A settlement Razorpay made `daysAgo` before NOW: ₹19,000 to the bank, after its ₹472 fee, ₹72 of it GST. */
const settlement = (id: string, daysAgo: number, status = "processed"): RazorpaySettlement => ({
  id,
  amount: 1_900_000,
  fees: 47_200,
  tax: 7_200,
  utr: `UTR${id.slice(5)}`,
  status,
  created_at: nowS - daysAgo * DAY_S,
});

const kept = () =>
  env.DB.prepare(
    "SELECT id, amount, fees, tax, utr, settled_at, received_at FROM razorpay_settlements ORDER BY id",
  ).all();

let payments: StubPayments;

beforeEach(async () => {
  await markDatabase();
  payments = createStubPayments();
});

describe("a settlement's webhook", () => {
  const basis = {
    db: env.DB,
    payments: createStubPayments(),
    alertOnce: () => Promise.resolve(),
    log: createLogger(),
    now: NOW,
    hashSalt: "salt",
    requestId: "req-1",
    notify: () => Promise.resolve(),
  };
  /** The webhook's body, read as the queue reads it. */
  const delivered = (entity: RazorpaySettlement) =>
    RazorpayEventSchema.parse({ event: "settlement.processed", payload: { settlement: { entity } } });

  it("keeps a processed settlement once, however often it comes", async () => {
    const event = delivered(settlement("setl_A1", 1));
    expect(await applyRazorpayEvent(basis, event)).toBe("applied");
    expect(await applyRazorpayEvent(basis, event)).toBe("applied");
    expect((await kept()).results).toEqual([
      {
        id: "setl_A1",
        amount: 1_900_000,
        fees: 47_200,
        tax: 7_200,
        utr: "UTRA1",
        settled_at: new Date((nowS - DAY_S) * 1000).toISOString(),
        received_at: NOW.toISOString(),
      },
    ]);
  });

  it("leaves one not yet processed, which is not money in the bank", async () => {
    await applyRazorpayEvent(basis, delivered(settlement("setl_A2", 1, "created")));
    expect((await kept()).results).toEqual([]);
  });
});

describe("the hourly catch-up", () => {
  /** Each read of Razorpay's settlements, its window in Unix seconds. */
  let reads: { from: number; to: number }[];
  const job = CRON_JOBS.filter((each) => each.name === "razorpay_catch_up");

  /** One run of the job, `minutes` after NOW. */
  function runAt(minutes: number, read: StubPayments["settlements"] = (from, to) => payments.settlements(from, to)) {
    const deps = fakeDependencies({
      now: () => new Date(NOW.getTime() + minutes * MINUTE_MS),
      payments: {
        ...payments,
        settlements: (from, to) => {
          reads.push({ from, to });
          return read(from, to);
        },
      },
    });
    const bindings = { ...env, MESSAGE_QUEUE: fakeQueue() };
    return runCronJobs(job, { env: bindings, deps, config: LOCAL_CONFIG, log: createLogger() });
  }

  beforeEach(() => {
    reads = [];
  });

  it("keeps the last week's the webhook missed, in the hour's first run alone", async () => {
    payments.settled.push(settlement("setl_B1", 2), settlement("setl_B2", 8), settlement("setl_B3", 3, "created"));

    // 07:03 UTC, the hour's first quarter, then 07:18.
    await runAt(33);
    await runAt(48);
    expect(reads).toHaveLength(1);
    expect(reads[0]?.to).toBe(nowS + 33 * 60);
    expect(reads[0]?.from).toBe(nowS + 33 * 60 - 7 * DAY_S);
    expect((await kept()).results).toEqual([expect.objectContaining({ id: "setl_B1" })]);
  });

  it("logs a read that failed, and carries on with the run", async () => {
    const logs = captureLogs();
    const outcomes = await runAt(33, () => Promise.reject(new Error("Razorpay is down")));
    expect(outcomes).toEqual([{ job: "razorpay_catch_up", ok: true }]);
    expect(logs.lines()).toContainEqual(expect.objectContaining({ event: "razorpay_settlements_unread" }));
  });
});
