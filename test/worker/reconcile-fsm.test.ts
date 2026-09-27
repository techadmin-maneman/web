import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createCallBudget, type CallBudget } from "../../src/lib/call-budget.ts";
import { createLogger } from "../../src/log.ts";
import { createStubFsm, EMPTY_FSM, type FsmAppointment } from "../../src/providers/fsm.ts";
import { PAGE_SIZE, reconcileFsm, UPCOMING_PER_RUN } from "../../src/scheduled/reconcile-fsm.ts";
import { captureLogs, fakeDependencies, fakeQueue } from "./helpers.ts";

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

function run(appointments: FsmAppointment[], now: Date, budget: CallBudget = createCallBudget(Infinity)) {
  const queue = fakeQueue();
  const deps = fakeDependencies({ fsm: createStubFsm({ ...EMPTY_FSM, appointments }), now: () => now });
  return { summary: reconcileFsm({ DB: env.DB, FSM_QUEUE: queue }, deps, createLogger(), budget), queue, deps };
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

  it("reads a few upcoming visits again each run, the longest unread first, so a deletion FSM sent no hint for is found", async () => {
    const upcoming = async (fsmId: string, day: string) => {
      await env.DB.prepare(
        `INSERT INTO appointments (id, fsm_id, status, fsm_status, window_start, window_end, fsm_modified_at, synced_at)
         VALUES (?1, ?2, 'scheduled', 'Scheduled', ?3, ?3, ?4, ?4)`,
      )
        .bind(crypto.randomUUID(), fsmId, `${day}T04:30:00.000Z`, DAY.toISOString())
        .run();
    };
    await upcoming("ap-soon", "2026-09-23");
    await upcoming("ap-later", "2026-09-25");
    await upcoming("ap-last", "2026-09-28");
    await copy("ap-past", "2026-09-20T10:00:00+05:30");

    const first = run([], DAY);
    await first.summary;
    expect(queuedIds(first.queue)).toEqual(["ap-soon", "ap-later"].slice(0, UPCOMING_PER_RUN));

    const second = run([], new Date(DAY.getTime() + 5 * 60_000));
    await second.summary;
    expect(queuedIds(second.queue)[0]).toBe("ap-last");
    expect(queuedIds(second.queue)).not.toContain("ap-past");
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

  // With the night's first page comes FSM's technician list (ADR 0052). One it no longer names is stopped, and
  // the log says who; one written by hand for a test on staging was never FSM's to name (migration 0046).
  it("reads the technician list once a night, stops one FSM no longer lists, and logs whom it stopped", async () => {
    await env.DB.prepare(
      `INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at, hand_written)
       VALUES ('t-left', 'resource-1', 'Vikram Sethi', 'VS', 1, ?1, 0),
              ('t-tester', 'tech-tester-1a2b3c4d', 'Test Technician', 'TT', 1, ?1, 1)`,
    )
      .bind(NIGHT.toISOString())
      .run();
    const logs = captureLogs();
    const naveen = { id: "resource-9", userId: "user-9", name: "Naveen Rao", active: true, mobile: null, zone: null };
    const deps = fakeDependencies({ fsm: createStubFsm({ ...EMPTY_FSM, technicians: [naveen] }), now: () => NIGHT });

    const summary = await reconcileFsm(
      { DB: env.DB, FSM_QUEUE: fakeQueue() },
      deps,
      createLogger(),
      createCallBudget(Infinity),
    );

    expect(summary.nightPage).toBe(1);
    const rows = await env.DB.prepare("SELECT fsm_id, active FROM technicians ORDER BY fsm_id").all();
    expect(rows.results).toEqual([
      { fsm_id: "resource-1", active: 0 },
      { fsm_id: "resource-9", active: 1 },
      { fsm_id: "tech-tester-1a2b3c4d", active: 1 },
    ]);
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({ event: "technicians_deactivated", count: 1, fsm_ids: ["resource-1"] }),
    );
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

describe("the reconciliation's outside calls", () => {
  it("reads nothing from FSM when the cron run has no call left", async () => {
    const { summary, queue } = run([fsmAppointment("ap-new", "2026-09-22T09:45:00+05:30")], DAY, createCallBudget(0));
    expect(await summary).toEqual({ queued: 0 });
    expect(queue.sent).toEqual([]);
  });

  it("leaves the night's next page for the next run when the run can pay for the first page only", async () => {
    const listed = Array.from({ length: PAGE_SIZE + 1 }, (_, index) =>
      fsmAppointment(`ap-${String(index).padStart(3, "0")}`, "2026-09-22T09:00:00+05:30"),
    );
    for (const appointment of listed) await copy(appointment.id, appointment.modifiedAt);
    await run(listed, NIGHT).summary;

    const held = run(listed, new Date(NIGHT.getTime() + 5 * 60_000), createCallBudget(1));
    expect(await held.summary).toEqual({ queued: 0 });
    expect(await env.DB.prepare("SELECT next_page FROM sync_cursors").first()).toEqual({ next_page: 2 });
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
