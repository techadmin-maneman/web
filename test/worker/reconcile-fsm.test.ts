import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createLogger } from "../../src/log.ts";
import { createStubFsm, EMPTY_FSM, type FsmAppointment } from "../../src/providers/fsm.ts";
import { PAGE_SIZE, reconcileFsm } from "../../src/scheduled/reconcile-fsm.ts";
import { fakeDependencies, fakeQueue } from "./helpers.ts";

/** 11:30 am in India: no nightly pass. */
const DAY = new Date("2026-09-22T06:00:00Z");
/** 1:30 am in India on 23 September: the nightly pass runs. */
const NIGHT = new Date("2026-09-22T20:00:00Z");

const fsmAppointment = (id: string, modifiedAt: string): FsmAppointment => ({
  id,
  name: id.toUpperCase(),
  status: "Scheduled",
  workOrderId: null,
  contactId: null,
  scheduledStart: null,
  scheduledEnd: null,
  actualStart: null,
  actualEnd: null,
  technicianIds: [],
  serviceIds: [],
  serviceCity: null,
  servicePincode: null,
  invoiceId: null,
  modifiedAt,
});

async function copy(fsmId: string, modifiedAt: string) {
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, status, fsm_status, fsm_modified_at, synced_at)
     VALUES (?1, ?2, 'scheduled', 'Scheduled', ?3, ?3)`,
  )
    .bind(crypto.randomUUID(), fsmId, new Date(modifiedAt).toISOString())
    .run();
}

function run(appointments: FsmAppointment[], now: Date) {
  const queue = fakeQueue();
  const deps = fakeDependencies({ fsm: createStubFsm({ ...EMPTY_FSM, appointments }), now: () => now });
  return { summary: reconcileFsm({ DB: env.DB, FSM_QUEUE: queue }, deps, createLogger()), queue, deps };
}

const queuedIds = (queue: ReturnType<typeof fakeQueue>) =>
  queue.sent.map((body) => (body as { fsm_id: string }).fsm_id);

describe("the reconciliation, by day", () => {
  it("queues the latest appointments whose copy is missing or older, and no others", async () => {
    await copy("ap-current", "2026-09-22T10:00:00+05:30");
    await copy("ap-behind", "2026-09-22T09:00:00+05:30");
    const { summary, queue } = run(
      [
        fsmAppointment("ap-current", "2026-09-22T10:00:00+05:30"),
        fsmAppointment("ap-behind", "2026-09-22T09:30:00+05:30"),
        fsmAppointment("ap-new", "2026-09-22T09:45:00+05:30"),
      ],
      DAY,
    );
    expect(await summary).toEqual({ queued: 2 });
    expect(queuedIds(queue).sort()).toEqual(["ap-behind", "ap-new"]);
    expect(queue.sent[0]).toMatchObject({ request_id: "reconcile" });
  });

  it("reads only the first page, and keeps no place, outside the night", async () => {
    const many = Array.from({ length: PAGE_SIZE + 5 }, (_, index) =>
      fsmAppointment(`ap-${String(index).padStart(3, "0")}`, `2026-09-21T${String(10 + (index % 10))}:00:00+05:30`),
    );
    const { summary, queue } = run(many, DAY);
    expect((await summary).queued).toBe(PAGE_SIZE);
    expect(queue.sent).toHaveLength(PAGE_SIZE);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM sync_cursors").first()).toEqual({ n: 0 });
  });
});

describe("the reconciliation, overnight", () => {
  it("walks the whole list a page a run, then checks the copies FSM did not list, and alerts once", async () => {
    const listed = Array.from({ length: PAGE_SIZE + 1 }, (_, index) =>
      fsmAppointment(`ap-${String(index).padStart(3, "0")}`, "2026-09-22T09:00:00+05:30"),
    );
    for (const appointment of listed) await copy(appointment.id, appointment.modifiedAt);
    // One copy FSM no longer lists: deleted there without a webhook.
    await copy("ap-deleted", "2026-09-20T09:00:00+05:30");
    // And one change the webhook missed, hours old.
    listed[PAGE_SIZE] = fsmAppointment(listed[PAGE_SIZE]?.id ?? "", "2026-09-22T12:00:00+05:30");

    const first = run(listed, NIGHT);
    expect(await first.summary).toEqual({ queued: 1, nightPage: 1 });

    const second = run(listed, new Date(NIGHT.getTime() + 5 * 60_000));
    expect(await second.summary).toEqual({ queued: 2, nightPage: 2 });
    expect(queuedIds(second.queue).sort()).toEqual(["ap-050", "ap-deleted"]);
    expect(second.deps.alerts).toEqual([
      "FSM reconciliation repaired 2 appointment(s) tonight that the webhook missed or FSM deleted.",
    ]);

    // Tonight's pass is done: later runs read the first page only.
    const third = run(listed, new Date(NIGHT.getTime() + 10 * 60_000));
    expect(await third.summary).toEqual({ queued: 1, nightPage: 0 });
    expect(third.deps.alerts).toEqual([]);
  });

  it("does not count a change of the last few minutes as drift: its webhook may be on the way", async () => {
    await copy("ap-1", "2026-09-23T01:20:00+05:30");
    const { summary, deps } = run([fsmAppointment("ap-1", "2026-09-23T01:28:00+05:30")], NIGHT);
    expect((await summary).queued).toBe(1);
    expect(deps.alerts).toEqual([]);
  });

  it("starts a fresh pass the next night", async () => {
    await copy("ap-1", "2026-09-22T09:00:00+05:30");
    const appointments = [fsmAppointment("ap-1", "2026-09-22T09:00:00+05:30")];
    await run(appointments, NIGHT).summary;
    const nextNight = new Date(NIGHT.getTime() + 24 * 60 * 60_000);
    expect(await run(appointments, nextNight).summary).toEqual({ queued: 0, nightPage: 1 });
    const cursor = await env.DB.prepare("SELECT pass_date, next_page FROM sync_cursors").first();
    expect(cursor).toEqual({ pass_date: "2026-09-24", next_page: 0 });
  });
});

describe("the reconciliation, hourly", () => {
  async function closed(fsmId: string, type: string, windowEnd: string) {
    await env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, type, status, fsm_status, window_end, fsm_modified_at, synced_at)
       VALUES (?1, ?2, ?3, 'completed', 'Completed', ?4, ?4, ?4)`,
    )
      .bind(crypto.randomUUID(), fsmId, type, windowEnd)
      .run();
  }

  it("looks again for the photographs of visits closed in the last three days, but not consultations", async () => {
    await closed("ap-yesterday", "service", "2026-09-21T08:00:00.000Z");
    await closed("ap-consultation", "consultation", "2026-09-21T08:00:00.000Z");
    await closed("ap-last-week", "service", "2026-09-14T08:00:00.000Z");
    const { summary, queue } = run([], DAY);
    expect((await summary).queued).toBe(1);
    expect(queuedIds(queue)).toEqual(["ap-yesterday"]);
  });

  it("only on the run at the top of the hour", async () => {
    await closed("ap-yesterday", "service", "2026-09-21T08:00:00.000Z");
    const { summary } = run([], new Date(DAY.getTime() + 10 * 60_000));
    expect((await summary).queued).toBe(0);
  });
});
