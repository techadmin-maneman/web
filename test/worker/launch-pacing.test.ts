// A pincode launch's alerts leave ten a minute however they go: held back on the queue, or sent again by the sweeper
// once a lost message or an outage has kept them (BK-39, PS-37). NOW is Monday 21 September 2026, 12 noon in India.
// Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createCallBudget } from "../../src/lib/call-budget.ts";
import { createLogger } from "../../src/log.ts";
import { PACED_GAP_SECONDS, PACED_PER_MINUTE } from "../../src/policy/message-pacing.ts";
import type { Connection } from "../../src/providers/messaging.ts";
import type { MessagingMessage } from "../../src/queues/messaging.ts";
import { requeueUnsentMessages } from "../../src/scheduled/unsent-messages.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, NOW, request } from "./helpers.ts";

const MINUTE_MS = 60_000;
const LAUNCHED = "122018";
const SERVED_LATER = "122001";

/** The queue messages handed over: each one's outbound message, and the instant the queue lets it go. */
interface Handed {
  readonly id: string;
  readonly leavesAt: number;
}

/** A queue that, as Cloudflare's does, refuses a batch over a hundred, and keeps when each message it took leaves. */
function recordingQueue(now: Date) {
  const handed: Handed[] = [];
  const batches: number[] = [];
  const queue = {
    sendBatch: (messages: Iterable<MessageSendRequest>) => {
      const batch = [...messages];
      if (batch.length > 100) return Promise.reject(new Error("a batch holds at most 100 messages"));
      batches.push(batch.length);
      for (const message of batch) {
        const id = (message.body as MessagingMessage).message_id;
        handed.push({ id, leavesAt: now.getTime() + (message.delaySeconds ?? 0) * 1000 });
      }
      return Promise.resolve();
    },
  } as unknown as Queue;
  return { queue, handed, batches };
}

/** The most messages leaving in any one minute. */
function busiestMinute(handed: readonly Handed[]): number {
  const times = handed.map((message) => message.leavesAt).sort((a, b) => a - b);
  let busiest = 0;
  for (const [index, start] of times.entries()) {
    const inTheMinute = times.slice(index).filter((time) => time < start + MINUTE_MS).length;
    busiest = Math.max(busiest, inTheMinute);
  }
  return busiest;
}

/** `count` people waiting for the pincode, each asking to be told of its launch. */
async function waitingFor(pincode: string, count: number, firstNumber: number): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO serviceable_pincodes (pincode, area, city, served) VALUES (?1, 'Sector 65', 'Gurgaon', 0)",
  )
    .bind(pincode)
    .run();
  for (let start = 0; start < count; start += 50) {
    const statements: D1PreparedStatement[] = [];
    for (let index = start; index < Math.min(start + 50, count); index += 1) {
      const personId = `${pincode}-${String(index)}`;
      statements.push(
        env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, 'Karan Bhatia')").bind(
          personId,
          NOW.toISOString(),
          `+91981${String(firstNumber + index).padStart(7, "0")}`,
        ),
        env.DB.prepare(
          `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
           VALUES (?1, ?2, 'whatsapp_launches', 'whatsapp-launches-v1', 1, ?3)`,
        ).bind(`consent-${personId}`, personId, NOW.toISOString()),
        env.DB.prepare(
          `INSERT INTO waitlist_entries (id, pincode, person_id, contact_consent_at, launch_alert, created_at)
           VALUES (?1, ?2, ?3, ?4, 1, ?4)`,
        ).bind(`entry-${personId}`, pincode, personId, NOW.toISOString()),
      );
    }
    await env.DB.batch(statements);
  }
}

const ops = () => appFor("local", fakeDependencies(), {}, "ops");
const POST = { "Content-Type": "application/json", Origin: "https://maneman.test" };

const launch = (queue: Queue) =>
  request(
    ops(),
    `/api/pincodes/${LAUNCHED}/launch`,
    { method: "POST", headers: POST, body: JSON.stringify({ confirm: true }) },
    { MESSAGE_QUEUE: queue },
  );

const serve = (queue: Queue) =>
  request(
    ops(),
    "/api/service-area",
    {
      method: "POST",
      headers: POST,
      body: JSON.stringify({ changes: [{ pincode: SERVED_LATER, served: true, launch_on: null }] }),
    },
    { MESSAGE_QUEUE: queue },
  );

async function dueTimes(): Promise<Map<string, string | null>> {
  const { results } = await env.DB.prepare("SELECT id, due_at FROM outbound_messages").all<{
    id: string;
    due_at: string | null;
  }>();
  return new Map(results.map((row) => [row.id, row.due_at]));
}

/** What the consumer does with each message the queue lets go by `at`: sends it. */
async function sendWhatLeftBy(at: number, handed: readonly Handed[]): Promise<void> {
  const left = handed.filter((message) => message.leavesAt <= at).map((message) => message.id);
  await env.DB.prepare(
    "UPDATE outbound_messages SET state = 'sent' WHERE state = 'queued' AND id IN (SELECT value FROM json_each(?1))",
  )
    .bind(JSON.stringify(left))
    .run();
}

const closed: Connection = { open: false, fault: "no_instance", detail: "no instance" };

/** One sweep of unsent messages at `at`, with the bridge open or not. What it handed to the queue. */
async function sweepAt(at: Date, bridgeOpen = true): Promise<Handed[]> {
  const { queue, handed } = recordingQueue(at);
  const open = fakeDependencies({ now: () => at });
  const deps = bridgeOpen
    ? open
    : { ...open, messaging: { ...open.messaging, connection: () => Promise.resolve(closed) } };
  await requeueUnsentMessages({
    db: env.DB,
    queue,
    deps,
    log: createLogger(),
    now: at,
    budget: createCallBudget(Infinity),
  });
  return handed;
}

const minutesAfterLaunch = (minutes: number) => new Date(NOW.getTime() + minutes * MINUTE_MS);

beforeEach(async () => {
  await markDatabase();
  captureLogs();
});

describe("a launch to 250 people waiting", () => {
  beforeEach(async () => {
    await waitingFor(LAUNCHED, 250, 1000);
  });

  it("queues every alert in batches the queue takes, each held back so ten leave a minute", async () => {
    const { queue, handed, batches } = recordingQueue(NOW);

    const answer = await launch(queue);

    expect(await answer.json()).toMatchObject({ alerts: 250, launched: true });
    expect(batches).toEqual([100, 100, 50]);
    expect(new Set(handed.map((message) => message.id)).size).toBe(250);
    expect(busiestMinute(handed)).toBe(PACED_PER_MINUTE);
    expect(Math.max(...handed.map((message) => message.leavesAt))).toBe(NOW.getTime() + 249 * PACED_GAP_SECONDS * 1000);
    const due = await dueTimes();
    for (const message of handed) expect(due.get(message.id)).toBe(new Date(message.leavesAt).toISOString());
  });

  it("leaves the sweeper nothing to send while the queue lets each alert go on time", async () => {
    const { queue, handed } = recordingQueue(NOW);
    await launch(queue);

    for (let minutes = 6; minutes <= 36; minutes += 5) {
      const at = minutesAfterLaunch(minutes);
      await sendWhatLeftBy(at.getTime(), handed);
      expect(await sweepAt(at)).toEqual([]);
    }
  });

  it("sends again what an outage kept, still ten a minute, each alert once", async () => {
    const { queue } = recordingQueue(NOW);
    await launch(queue);
    // The queue let every alert go on time, but the bridge was down, so each stayed queued.
    expect(await sweepAt(minutesAfterLaunch(30), false)).toEqual([]);

    const resent: Handed[] = [];
    for (let minutes = 60; minutes <= 120; minutes += 5) {
      const at = minutesAfterLaunch(minutes);
      await sendWhatLeftBy(at.getTime(), resent);
      resent.push(...(await sweepAt(at)));
    }

    expect(resent).toHaveLength(250);
    expect(new Set(resent.map((message) => message.id)).size).toBe(250);
    expect(busiestMinute(resent)).toBe(PACED_PER_MINUTE);
  });

  it("sends again what the queue refused, still ten a minute, each alert once", async () => {
    const refusing = { sendBatch: () => Promise.reject(new Error("queue unavailable")) } as unknown as Queue;
    expect((await launch(refusing)).status).toBe(200);

    const resent: Handed[] = [];
    for (let minutes = 6; minutes <= 120; minutes += 5) {
      const at = minutesAfterLaunch(minutes);
      await sendWhatLeftBy(at.getTime(), resent);
      resent.push(...(await sweepAt(at)));
    }

    expect(new Set(resent.map((message) => message.id)).size).toBe(250);
    expect(resent).toHaveLength(250);
    expect(busiestMinute(resent)).toBe(PACED_PER_MINUTE);
  });

  it("puts a pincode served from the service area behind the alerts still waiting, so together they keep the pace", async () => {
    await waitingFor(SERVED_LATER, 30, 5000);
    const first = recordingQueue(NOW);
    await launch(first.queue);

    const second = recordingQueue(NOW);
    expect(await (await serve(second.queue)).json()).toMatchObject({ alerted: 30 });

    const lastOfFirst = Math.max(...first.handed.map((message) => message.leavesAt));
    expect(Math.min(...second.handed.map((message) => message.leavesAt))).toBe(lastOfFirst + PACED_GAP_SECONDS * 1000);
    expect(busiestMinute([...first.handed, ...second.handed])).toBe(PACED_PER_MINUTE);
  });
});
