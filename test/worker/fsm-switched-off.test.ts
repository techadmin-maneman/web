// The fsm-sync queue once staging is switched off FSM (FSM_PROVIDER "none"): a message queued for FSM before the
// switch is acknowledged without reaching FSM, and a technician's step still waiting for FSM is marked as never
// written, with ops told once to check its visit. On FSM's path the same messages still reach FSM.
// NOW is Monday 21 September 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FieldRecord } from "../../src/config/field-record.ts";
import { createCallBudget } from "../../src/lib/call-budget.ts";
import { createLogger } from "../../src/log.ts";
import { createStubFsm, EMPTY_FSM } from "../../src/providers/fsm.ts";
import { handleFsmSyncBatch } from "../../src/queues/fsm-sync.ts";
import { sweep } from "../../src/scheduled/sweeper.ts";
import { captureLogs, fakeDependencies, fakeQueue, fsmSwitchedOff, markDatabase, NOW } from "./helpers.ts";
import { JOB, PERSON as WORKING_CLIENT, working } from "./job-fixtures.ts";

const PERSON = "44444444-4444-4444-8444-444444444444";
const VISIT = "22222222-2222-4222-8222-222222222222";
const AT_THE_DOOR = { lat: 28.3988, lng: 77.07 };
const MINUTE = 60_000;

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

describe("a message queued for FSM, where our own database holds the record", () => {
  const forFsm: readonly [string, Record<string, unknown>][] = [
    ["appointment_read", { fsm_id: "fsm-1" }],
    ["contact_erasure", { erase_person_id: PERSON }],
    ["contact_update", { update_contact_person_id: PERSON }],
    ["client_note", { note_appointment_id: VISIT }],
    ["catalogue_push", { catalogue_sync: true }],
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
  async function stepsWaitingForFsm() {
    const job = await working();
    expect((await job.post(`/api/tech/jobs/${JOB}/checkin`, AT_THE_DOOR, "event-checkin-01")).status).toBe(200);
    expect((await job.post(`/api/tech/jobs/${JOB}/start`, undefined, "event-start-01")).status).toBe(202);
    return job;
  }

  const writeStates = async () =>
    (
      await env.DB.prepare(
        "SELECT kind, fsm_write_state, fsm_error FROM job_events WHERE appointment_id = ?1 ORDER BY received_at, rowid",
      )
        .bind(JOB)
        .all<{ kind: string; fsm_write_state: string; fsm_error: string | null }>()
    ).results;

  it("is marked never written, with every step of its visit behind it, and ops are told once", async () => {
    const job = await stepsWaitingForFsm();
    const [first] = job.fsmQueue.sent as { job_event_id: string }[];
    const deps = fakeDependencies({ fsm: fsmSwitchedOff() });

    const message = delivered({ job_event_id: first?.job_event_id });
    await consume(message, "ours", deps);
    await consume(delivered({ job_event_id: first?.job_event_id }), "ours", deps);

    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
    expect(await writeStates()).toEqual([
      { kind: "check_in", fsm_write_state: "rejected", fsm_error: "FSM was switched off before it was written" },
      { kind: "start", fsm_write_state: "rejected", fsm_error: "FSM was switched off before it was written" },
    ]);
    expect(deps.alerts).toEqual([
      `A technician's steps on visit ${JOB} landed before FSM was switched off and never reached it. ` +
        `Check the visit, and close it from the console if the work was done. http://ops.localhost:4323/clients/${WORKING_CLIENT}`,
    ]);
    expect(logs.lines()).toContainEqual(expect.objectContaining({ event: "fsm_message_dropped", kind: "job_event" }));
  });

  it("is not sent to FSM again by the sweeper", async () => {
    const job = await stepsWaitingForFsm();
    const [first] = job.fsmQueue.sent as { job_event_id: string }[];
    await consume(delivered({ job_event_id: first?.job_event_id }), "ours");

    const fsmQueue = fakeQueue();
    const later = new Date(NOW.getTime() + 90 * MINUTE);
    await sweep(
      { ...env, CRM_QUEUE: fakeQueue(), RENDER_QUEUE: fakeQueue(), MESSAGE_QUEUE: fakeQueue(), FSM_QUEUE: fsmQueue },
      fakeDependencies({ now: () => later }),
      createLogger(),
      { creditFloor: 0, budget: createCallBudget(Infinity) },
    );

    expect(fsmQueue.sent).toEqual([]);
  });
});
