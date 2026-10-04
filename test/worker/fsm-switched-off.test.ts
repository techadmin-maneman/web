// Work queued for FSM once our own database holds the record of field work (FSM_PROVIDER "none"): a message for FSM
// is acknowledged and logged without reaching it, and a technician's step still waiting for FSM is given up on by the
// sweeper, with ops told once to check its visit. On FSM's path both still go to FSM.
// NOW is Monday 21 September 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FieldRecord } from "../../src/config/field-record.ts";
import type { StaticConfig } from "../../src/guard.ts";
import { createCallBudget } from "../../src/lib/call-budget.ts";
import { createLogger } from "../../src/log.ts";
import { createStubFsm, EMPTY_FSM } from "../../src/providers/fsm.ts";
import { handleFsmSyncBatch } from "../../src/queues/fsm-sync.ts";
import { CRON_JOBS, runCronJobs } from "../../src/scheduled/cron.ts";
import { sweep } from "../../src/scheduled/sweeper.ts";
import {
  captureLogs,
  fakeDependencies,
  fakeQueue,
  fsmSwitchedOff,
  LOCAL_CONFIG,
  markDatabase,
  NOW,
} from "./helpers.ts";
import { JOB, PERSON as WORKING_CLIENT, working } from "./job-fixtures.ts";

const PERSON = "44444444-4444-4444-8444-444444444444";
const VISIT = "22222222-2222-4222-8222-222222222222";
const AT_THE_DOOR = { lat: 28.3988, lng: 77.07 };
const LATER = new Date(NOW.getTime() + 90 * 60_000);

let logs: ReturnType<typeof captureLogs>;

beforeEach(async () => {
  await markDatabase();
  logs = captureLogs();
});

async function erasedClientWithANotedVisit(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO people (id, created_at, mobile_e164, name, fsm_contact_id, erased_at)
       VALUES (?1, ?2, '+919810000003', 'Rohit Malhotra', 'contact-1', ?2)`,
    ).bind(PERSON, NOW.toISOString()),
    env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end,
         fsm_modified_at, synced_at, client_note, client_note_at)
       VALUES (?1, 'fsm-1', ?2, 'service', 'scheduled', 'Scheduled', '2026-09-22T04:30:00.000Z',
         '2026-09-22T06:00:00.000Z', ?3, ?3, 'Ring twice', ?3)`,
    ).bind(VISIT, PERSON, NOW.toISOString()),
  ]);
}

function delivered(body: Record<string, unknown>) {
  return { id: "m1", body: { ...body, request_id: "r" }, attempts: 1, ack: vi.fn(), retry: vi.fn() };
}

async function consume(
  message: ReturnType<typeof delivered>,
  record: FieldRecord,
  deps = fakeDependencies({ fsm: fsmSwitchedOff() }),
) {
  const batch = { queue: "mm-fsm-sync-local", messages: [message], ackAll: vi.fn(), retryAll: vi.fn() };
  const bindings = { ...env, FSM_QUEUE: fakeQueue(), MESSAGE_QUEUE: fakeQueue() } as unknown as typeof env;
  await handleFsmSyncBatch(batch as unknown as MessageBatch, bindings, deps, createLogger(), {
    labelAsTest: true,
    cataloguePush: true,
    record,
  });
  return deps;
}

/** Today's job with its check-in and start landed on FSM's path, both still waiting to be written to FSM. */
async function stepsWaitingForFsm() {
  const job = await working();
  expect((await job.post(`/api/tech/jobs/${JOB}/checkin`, AT_THE_DOOR, "event-checkin-01")).status).toBe(200);
  expect((await job.post(`/api/tech/jobs/${JOB}/start`, undefined, "event-start-01")).status).toBe(202);
  return job;
}

async function writeStates() {
  const { results } = await env.DB.prepare(
    "SELECT kind, fsm_write_state, fsm_error FROM job_events WHERE appointment_id = ?1 ORDER BY received_at, rowid",
  )
    .bind(JOB)
    .all<{ kind: string; fsm_write_state: string; fsm_error: string | null }>();
  return results;
}

async function sweepLater(record: FieldRecord, deps = fakeDependencies({ now: () => LATER })) {
  const fsmQueue = fakeQueue();
  await sweep(
    { ...env, CRM_QUEUE: fakeQueue(), RENDER_QUEUE: fakeQueue(), MESSAGE_QUEUE: fakeQueue(), FSM_QUEUE: fsmQueue },
    deps,
    createLogger(),
    { budget: createCallBudget(Infinity), record },
  );
  return fsmQueue;
}

describe("a message queued for FSM, where our own database holds the record", () => {
  const forFsm: readonly [string, Record<string, unknown>][] = [
    ["appointment_read", { fsm_id: "fsm-1" }],
    ["contact_erasure", { erase_person_id: PERSON }],
    ["contact_update", { update_contact_person_id: PERSON }],
    ["client_note", { note_appointment_id: VISIT }],
    ["catalogue_push", { catalogue_sync: true }],
    ["job_event", { job_event_id: "55555555-5555-4555-8555-555555555555" }],
  ];

  it.each(forFsm)("is acknowledged without reaching FSM, never retried, and logged: %s", async (kind, body) => {
    await erasedClientWithANotedVisit();
    const message = delivered(body);

    const deps = await consume(message, "ours");

    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
    expect(deps.alerts).toEqual([]);
    expect(logs.lines()).toContainEqual(expect.objectContaining({ event: "fsm_message_dropped", kind }));
  });

  it("leaves a technician's step for the sweeper", async () => {
    const job = await stepsWaitingForFsm();
    const [first] = job.fsmQueue.sent as { job_event_id: string }[];

    await consume(delivered({ job_event_id: first?.job_event_id }), "ours");

    expect((await writeStates()).map((step) => step.fsm_write_state)).toEqual(["pending", "pending"]);
  });

  it("still reaches FSM on FSM's path", async () => {
    await erasedClientWithANotedVisit();
    const fsm = createStubFsm(EMPTY_FSM);
    const message = delivered({ erase_person_id: PERSON });

    await consume(message, "fsm", fakeDependencies({ fsm }));

    expect(fsm.made.erased).toEqual(["contact-1"]);
    expect(message.ack).toHaveBeenCalledOnce();
  });
});

describe("a technician's step that landed before the switch and never reached FSM", () => {
  it("is marked never written by the sweeper, with every step of its visit behind it, and ops are told once", async () => {
    await stepsWaitingForFsm();
    const deps = fakeDependencies({ fsm: fsmSwitchedOff(), now: () => LATER });

    const first = await sweepLater("ours", deps);
    const second = await sweepLater("ours", deps);

    expect(first.sent).toEqual([]);
    expect(second.sent).toEqual([]);
    expect(await writeStates()).toEqual([
      { kind: "check_in", fsm_write_state: "rejected", fsm_error: "FSM was switched off before it was written" },
      { kind: "start", fsm_write_state: "rejected", fsm_error: "FSM was switched off before it was written" },
    ]);
    expect(deps.alerts).toEqual([
      `A technician's steps on visit ${JOB} were never written to FSM, which is now switched off. ` +
        "Check the visit, and close it from the console if the work was done. " +
        `http://ops.localhost:4323/clients/${WORKING_CLIENT}`,
    ]);
  });

  it("is given up on by the cron's job where FSM_PROVIDER is none", async () => {
    await stepsWaitingForFsm();
    const jobEvents = CRON_JOBS.filter((job) => job.name === "requeue_job_events");
    const withoutFsm: StaticConfig = {
      ...LOCAL_CONFIG,
      providers: { ...LOCAL_CONFIG.providers, FSM_PROVIDER: "none" },
    };
    const fsmQueue = fakeQueue();

    expect(jobEvents).toHaveLength(1);
    await runCronJobs(jobEvents, {
      env: {
        ...env,
        CRM_QUEUE: fakeQueue(),
        RENDER_QUEUE: fakeQueue(),
        MESSAGE_QUEUE: fakeQueue(),
        FSM_QUEUE: fsmQueue,
      },
      deps: fakeDependencies({ fsm: fsmSwitchedOff(), now: () => LATER }),
      config: withoutFsm,
      log: createLogger(),
    });

    expect(fsmQueue.sent).toEqual([]);
    expect((await writeStates()).map((step) => step.fsm_write_state)).toEqual(["rejected", "rejected"]);
  });

  it("is still sent to FSM on FSM's path", async () => {
    const job = await stepsWaitingForFsm();
    const [first] = job.fsmQueue.sent as { job_event_id: string }[];

    const fsmQueue = await sweepLater("fsm");

    expect(fsmQueue.sent).toEqual([{ job_event_id: first?.job_event_id, request_id: "sweeper" }]);
    expect((await writeStates()).map((step) => step.fsm_write_state)).toEqual(["pending", "pending"]);
  });
});
