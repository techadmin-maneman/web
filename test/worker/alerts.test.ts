// Alerts told once, with the IDs and the console link to act on, and told again while they stay open.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createAlertOnce, createResolveAlert, type AlertOnce } from "../../src/domain/alerts.ts";
import { HOUR_MS } from "../../src/lib/durations.ts";
import { createLogger } from "../../src/log.ts";
import { captureLogs, NOW } from "./helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";

let told: string[];
let alertOnce: AlertOnce;

function alertOnceOn(db: D1Database, now: () => Date = () => NOW): AlertOnce {
  return createAlertOnce({
    db,
    alert: (message) => {
      told.push(message);
      return Promise.resolve();
    },
    now,
    environment: "staging",
    log: createLogger(),
  });
}

const hoursAfter = (instant: Date, hours: number): Date => new Date(instant.getTime() + hours * HOUR_MS);

const resolveAlert = createResolveAlert({ db: env.DB, now: () => NOW });

const stored = () =>
  env.DB.prepare(
    "SELECT key, message, link, count, first_seen_at, last_seen_at, resolved_at FROM alerts ORDER BY rowid",
  )
    .all()
    .then((answer) => answer.results);

async function raiseTimes(times: number, raised: Parameters<AlertOnce>[0]): Promise<void> {
  for (let time = 0; time < times; time += 1) await alertOnce(raised);
}

beforeEach(() => {
  captureLogs();
  told = [];
  alertOnce = alertOnceOn(env.DB);
});

describe("alertOnce", () => {
  it("tells ops the first time, with a link into the console, and keeps the alert", async () => {
    await alertOnce({ key: `refund:${PERSON}`, message: "Refund rfnd_1 failed.", link: `/clients/${PERSON}` });

    expect(told).toEqual([`Refund rfnd_1 failed. https://ops-staging.maneman.in/clients/${PERSON}`]);
    expect(await stored()).toEqual([
      {
        key: `refund:${PERSON}`,
        message: "Refund rfnd_1 failed.",
        link: `/clients/${PERSON}`,
        count: 1,
        first_seen_at: NOW.toISOString(),
        last_seen_at: NOW.toISOString(),
        resolved_at: null,
      },
    ]);
  });

  it("counts it again without telling anyone, until it has happened ten times", async () => {
    await raiseTimes(9, { key: "k", message: "Books refused payment pay-1." });
    expect(told).toEqual(["Books refused payment pay-1."]);
    expect(await stored()).toMatchObject([{ count: 9 }]);

    await raiseTimes(1, { key: "k", message: "Books refused payment pay-1." });
    expect(told).toEqual([
      "Books refused payment pay-1.",
      "Still open since Mon 21 Sep, 12 pm, 10 times: Books refused payment pay-1.",
    ]);

    await raiseTimes(90, { key: "k", message: "Books refused payment pay-1." });
    expect(told).toHaveLength(3);
    expect(told[2]).toBe("Still open since Mon 21 Sep, 12 pm, 100 times: Books refused payment pay-1.");
  });

  it("waits for a failure expected now and then to happen `after` times", async () => {
    await raiseTimes(2, { key: "k", message: "Codes are failing.", after: 3 });
    expect(told).toEqual([]);

    await raiseTimes(1, { key: "k", message: "Codes are failing.", after: 3 });
    expect(told).toEqual(["Codes are failing."]);

    await raiseTimes(27, { key: "k", message: "Codes are failing.", after: 3 });
    expect(told).toEqual(["Codes are failing.", "Still open since Mon 21 Sep, 12 pm, 30 times: Codes are failing."]);
  });

  it("records when ops were told, which is when the alert waits on Tasks: not before its `after`-th sighting", async () => {
    const toldAt = () => env.DB.prepare("SELECT told_at FROM alerts WHERE key = 'k'").first("told_at");
    const later = new Date(NOW.getTime() + 60_000);
    let now = NOW;
    alertOnce = createAlertOnce({
      db: env.DB,
      alert: () => Promise.resolve(),
      now: () => now,
      environment: "staging",
      log: createLogger(),
    });

    await raiseTimes(2, { key: "k", message: "Codes are failing.", after: 3 });
    expect(await toldAt()).toBeNull();

    now = later;
    await raiseTimes(2, { key: "k", message: "Codes are failing.", after: 3 });
    expect(await toldAt()).toBe(later.toISOString());

    await alertOnce({ key: "once", message: "A refund failed." });
    expect(await env.DB.prepare("SELECT told_at FROM alerts WHERE key = 'once'").first("told_at")).toBe(
      later.toISOString(),
    );
  });

  it("tells the chat again at the first sighting a day after it was last told, while it stays open", async () => {
    let now = NOW;
    alertOnce = alertOnceOn(env.DB, () => now);
    const raised = { key: `invoice_draft:${PERSON}`, message: "Invoice inv-1 is a draft." };

    await alertOnce(raised);
    now = hoursAfter(NOW, 23);
    await alertOnce(raised);
    expect(told).toEqual(["Invoice inv-1 is a draft."]);

    now = hoursAfter(NOW, 24);
    await alertOnce(raised);
    expect(told).toEqual([
      "Invoice inv-1 is a draft.",
      "Still open since Mon 21 Sep, 12 pm, 3 times: Invoice inv-1 is a draft.",
    ]);

    now = hoursAfter(NOW, 47);
    await alertOnce(raised);
    expect(told).toHaveLength(2);
    now = hoursAfter(NOW, 48);
    await alertOnce(raised);
    expect(told[2]).toBe("Still open since Mon 21 Sep, 12 pm, 5 times: Invoice inv-1 is a draft.");
  });

  it("tells the chat again every six hours of a closed bridge, from its second reading", async () => {
    let now = NOW;
    alertOnce = alertOnceOn(env.DB, () => now);
    const raised = { key: "whatsapp_bridge", message: "The WhatsApp bridge is not connected.", after: 2 };

    await alertOnce(raised);
    now = hoursAfter(NOW, 1);
    await alertOnce(raised);
    now = hoursAfter(NOW, 6);
    await alertOnce(raised);
    expect(told).toEqual(["The WhatsApp bridge is not connected."]);

    now = hoursAfter(NOW, 7);
    await alertOnce(raised);
    expect(told).toEqual([
      "The WhatsApp bridge is not connected.",
      "Still open since Mon 21 Sep, 12 pm, 4 times: The WhatsApp bridge is not connected.",
    ]);
  });

  it("keeps when ops were first told, and moves when they were last told", async () => {
    let now = NOW;
    alertOnce = alertOnceOn(env.DB, () => now);
    const times = () => env.DB.prepare("SELECT told_at, last_told_at FROM alerts WHERE key = 'k'").first();

    await alertOnce({ key: "k", message: "A refund failed." });
    now = hoursAfter(NOW, 25);
    await alertOnce({ key: "k", message: "A refund failed." });

    expect(await times()).toEqual({ told_at: NOW.toISOString(), last_told_at: now.toISOString() });
  });

  it("tells the chat once when two sightings past the clock come together", async () => {
    let now = NOW;
    alertOnce = alertOnceOn(env.DB, () => now);
    await alertOnce({ key: "k", message: "A refund failed." });

    now = hoursAfter(NOW, 25);
    await Promise.all([
      alertOnce({ key: "k", message: "A refund failed." }),
      alertOnce({ key: "k", message: "A refund failed." }),
    ]);

    expect(told).toHaveLength(2);
    expect(await stored()).toMatchObject([{ count: 3 }]);
  });

  it("keeps apart alerts with different keys", async () => {
    await alertOnce({ key: "a", message: "A." });
    await alertOnce({ key: "b", message: "B." });
    expect(told).toEqual(["A.", "B."]);
  });

  it("treats an alert raised after it was resolved as a new one", async () => {
    await raiseTimes(2, { key: "k", message: "The bridge is closed." });
    await resolveAlert("k");
    await alertOnce({ key: "k", message: "The bridge is closed." });

    expect(told).toEqual(["The bridge is closed.", "The bridge is closed."]);
    expect(await stored()).toMatchObject([
      { key: "k", count: 2, resolved_at: NOW.toISOString() },
      { key: "k", count: 1, resolved_at: null },
    ]);
  });

  it("resolving an alert nobody raised does nothing", async () => {
    await resolveAlert("never");
    expect(await stored()).toEqual([]);
  });

  it("still tells ops when the alert cannot be kept", async () => {
    const broken = {
      prepare: () => {
        throw new Error("D1 is down");
      },
    } as unknown as D1Database;
    const logs = captureLogs();

    await alertOnceOn(broken)({ key: "k", message: "Invoice inv-1 is a draft.", link: "/tasks" });

    expect(told).toEqual(["Invoice inv-1 is a draft. https://ops-staging.maneman.in/tasks"]);
    expect(logs.lines()).toContainEqual(expect.objectContaining({ event: "alert_not_stored", key: "k" }));
  });
});
