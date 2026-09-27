// What the client asked for, as against what the board is offering (ADR 0063).
// Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { CALLS_PER_VISIT, RECHECK_AFTER_MS, resolveAskedWindows } from "../../src/domain/asked-windows.ts";
import { createCallBudget, type CallBudget } from "../../src/lib/call-budget.ts";
import { createLogger } from "../../src/log.ts";
import { createStubFsm, EMPTY_FSM, type StubFsm, type StubFsmWorld } from "../../src/providers/fsm.ts";
import { captureLogs, NOW } from "./helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const VISIT = "22222222-2222-4222-8222-222222222222";
const LEAD = "33333333-3333-4333-8333-333333333333";

const world = (overrides: Partial<StubFsmWorld>): StubFsmWorld => ({ ...EMPTY_FSM, ...overrides });

const pass = (fsm: StubFsm, budget: CallBudget = createCallBudget(Infinity)) =>
  resolveAskedWindows(env.DB, fsm, NOW, createLogger(), budget);

const later = (ms: number) => new Date(NOW.getTime() + ms);

/** An unassigned visit as the mirror writes one: ops have not put it on anybody yet. */
async function visit(id = VISIT, workOrderId: string | null = "fsm-wo-1") {
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, fsm_work_order_id, person_id, type, status, fsm_status,
       window_start, window_end, fsm_modified_at, synced_at)
     VALUES (?1, ?2, ?3, ?4, 'consultation', 'scheduled', 'Scheduled', '2026-09-25T09:30:00.000Z',
       '2026-09-25T10:30:00.000Z', ?5, ?5)`,
  )
    .bind(id, `fsm-${id}`, workOrderId, PERSON, NOW.toISOString())
    .run();
}

/** The booking we sent to FSM as a Request, with the window the client picked on it. */
async function lead(window: string, requestId: string | null = "fsm-req-1") {
  await env.DB.prepare(
    `INSERT INTO leads (id, person_id, created_at, source, city, first_choice_window, loss_extent, sync_state,
       request_id, fsm_request_id)
     VALUES (?1, ?2, ?3, 'form', 'Gurgaon', ?4, 'crown', 'synced', 'test-request', ?5)`,
  )
    .bind(LEAD, PERSON, NOW.toISOString(), window, requestId)
    .run();
}

const asked = (id = VISIT) =>
  env.DB.prepare("SELECT asked_window, asked_checked_at FROM appointments WHERE id = ?1")
    .bind(id)
    .first<{ asked_window: string | null; asked_checked_at: string | null }>();

let logs: ReturnType<typeof captureLogs>;
beforeEach(async () => {
  logs = captureLogs();
  await env.DB.prepare(
    "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra')",
  )
    .bind(PERSON, NOW.toISOString())
    .run();
});

describe("the pass's outside calls", () => {
  it("looks up only the visits the cron run can pay for, and leaves the rest unstamped", async () => {
    const second = "44444444-4444-4444-8444-444444444444";
    await visit();
    await visit(second, "fsm-wo-2");

    await pass(createStubFsm(EMPTY_FSM), createCallBudget(CALLS_PER_VISIT));

    const stamped = [await asked(), await asked(second)].filter((row) => row?.asked_checked_at !== null);
    expect(stamped).toHaveLength(1);
  });
});

describe("the window the client asked for", () => {
  it("reads it from the lead behind the Request the visit's work order names", async () => {
    await visit();
    await lead("weekday_am");
    const fsm = createStubFsm(
      world({
        preferences: {
          "fsm-wo-1": { requestId: "fsm-req-1", preferredDate: "2026-09-25", preferenceNote: "Morning, 9 am to 12 pm" },
        },
      }),
    );

    expect(await pass(fsm)).toEqual({ resolved: 1 });
    expect(await asked()).toEqual({ asked_window: "morning", asked_checked_at: NOW.toISOString() });
  });

  it("reads an evening booking as evening: the booking form offers those two", async () => {
    await visit();
    await lead("weekend_pm");
    const fsm = createStubFsm(
      world({
        preferences: { "fsm-wo-1": { requestId: "fsm-req-1", preferredDate: null, preferenceNote: null } },
      }),
    );

    expect(await pass(fsm)).toEqual({ resolved: 1 });
    expect((await asked())?.asked_window).toBe("evening");
  });

  /*
   * The rule this whole point turns on: never show a window the system cannot
   * know. A visit our own booking made has no Request behind it, so there is
   * nothing the client "asked" for beyond the time they were given, and the
   * column stays null for the tray to say so in words.
   */
  it("leaves the window null where no Request is behind the visit, and never looks again", async () => {
    await visit();
    const fsm = createStubFsm(EMPTY_FSM);

    expect(await pass(fsm)).toEqual({ resolved: 0 });
    expect(await asked()).toEqual({ asked_window: null, asked_checked_at: NOW.toISOString() });

    // Marked looked-at, so the next pass has nothing to ask FSM about.
    expect(await pass(fsm)).toEqual({ resolved: 0 });
  });

  it("leaves it null where the Request is FSM's own, with no lead of ours behind it", async () => {
    await visit();
    await lead("weekday_am", "fsm-req-someone-elses");
    const fsm = createStubFsm(
      world({
        preferences: { "fsm-wo-1": { requestId: "fsm-req-1", preferredDate: null, preferenceNote: null } },
      }),
    );

    expect(await pass(fsm)).toEqual({ resolved: 0 });
    expect((await asked())?.asked_window).toBeNull();
  });

  /*
   * With self-serve booking off, which is production's setting, the site's form
   * leaves a request with the day and window asked for, and no Request in FSM:
   * ops put the consultation in FSM themselves. Every such visit once read
   * "Asked · not recorded" though we held what was asked (BIZ-23).
   */
  describe("for a consultation the site's form asked for while self-serve booking was off", () => {
    async function requested(window: string, createdAt = NOW.toISOString(), date = "2026-09-24") {
      await env.DB.prepare(
        `INSERT INTO consultation_requests (id, person_id, pincode, requested_date, requested_window, created_at)
         VALUES (?1, ?2, '122018', ?3, ?4, ?5)`,
      )
        .bind(crypto.randomUUID(), PERSON, date, window, createdAt)
        .run();
    }

    it("reads the window from the request, where no lead of ours is behind the visit", async () => {
      await visit();
      await requested("afternoon");

      expect(await pass(createStubFsm(EMPTY_FSM))).toEqual({ resolved: 1 });
      expect(await asked()).toEqual({ asked_window: "afternoon", asked_checked_at: NOW.toISOString() });
    });

    it("reads the latest request, where the client asked more than once", async () => {
      await visit();
      await requested("morning", "2026-09-19T06:30:00.000Z", "2026-09-22");
      await requested("evening", "2026-09-20T06:30:00.000Z", "2026-09-25");

      await pass(createStubFsm(EMPTY_FSM));
      expect((await asked())?.asked_window).toBe("evening");
    });

    it("reads it too where FSM refused to say, since the request is ours", async () => {
      await visit();
      await requested("afternoon");
      const fsm = createStubFsm(EMPTY_FSM);
      fsm.refuseNext("requestPreference", "NO_WORK_ORDER");

      await pass(fsm);
      expect((await asked())?.asked_window).toBe("afternoon");
    });

    it("prefers the lead's own window, where one is behind the visit's Request", async () => {
      await visit();
      await lead("weekday_am");
      await requested("evening");
      const fsm = createStubFsm(
        world({
          preferences: { "fsm-wo-1": { requestId: "fsm-req-1", preferredDate: null, preferenceNote: null } },
        }),
      );

      await pass(fsm);
      expect((await asked())?.asked_window).toBe("morning");
    });

    it("takes no request's window for a visit that is not a consultation", async () => {
      await visit();
      await env.DB.prepare("UPDATE appointments SET type = 'service'").run();
      await requested("afternoon");

      await pass(createStubFsm(EMPTY_FSM));
      expect((await asked())?.asked_window).toBeNull();
    });
  });

  it("asks FSM once: a visit already looked at is left alone by the next pass", async () => {
    await visit();
    await lead("weekday_am");
    let reads = 0;
    const fsm = createStubFsm(
      world({
        preferences: { "fsm-wo-1": { requestId: "fsm-req-1", preferredDate: null, preferenceNote: null } },
      }),
    );
    const counted: StubFsm = {
      ...fsm,
      requestPreference: (workOrderId) => {
        reads += 1;
        return fsm.requestPreference(workOrderId);
      },
    };

    await pass(counted);
    await pass(counted);
    expect(reads).toBe(1);
  });

  it("does not ask about a visit FSM has no work order for", async () => {
    await visit(VISIT, null);
    const fsm = createStubFsm(EMPTY_FSM);

    expect(await pass(fsm)).toEqual({ resolved: 0 });
    expect(await asked()).toEqual({ asked_window: null, asked_checked_at: null });
  });

  /*
   * These two replace tests that held the pass to leaving a refused visit
   * unstamped and to failing whole when FSM failed once. Five refused visits
   * then blocked the pass for good, since each came back first on every run.
   */
  it("marks a visit FSM refuses as looked at, with no window, and goes on to the next", async () => {
    const next = "44444444-4444-4444-8444-444444444444";
    await visit();
    await visit(next, "fsm-wo-2");
    await lead("weekday_am");
    const fsm = createStubFsm(
      world({
        preferences: { "fsm-wo-2": { requestId: "fsm-req-1", preferredDate: null, preferenceNote: null } },
      }),
    );
    fsm.refuseNext("requestPreference", "NO_WORK_ORDER");

    expect(await pass(fsm)).toEqual({ resolved: 1 });
    // A refusal will not change on asking again: the tray says the window was not recorded.
    expect(await asked()).toEqual({ asked_window: null, asked_checked_at: NOW.toISOString() });
    expect((await asked(next))?.asked_window).toBe("morning");
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({ event: "asked_window_refused", code: "NO_WORK_ORDER" }),
    );
  });

  it("leaves a visit FSM failed on for an hour, and goes on to the next", async () => {
    const next = "44444444-4444-4444-8444-444444444444";
    await visit();
    await visit(next, "fsm-wo-2");
    const fsm = createStubFsm(EMPTY_FSM);
    fsm.failNext("requestPreference", "FSM answered 500");

    await pass(fsm);
    expect(await asked()).toEqual({ asked_window: null, asked_checked_at: null });
    expect((await asked(next))?.asked_checked_at).toBe(NOW.toISOString());
    expect(logs.lines()).toContainEqual(expect.objectContaining({ event: "asked_window_failed" }));

    let reads = 0;
    const counted: StubFsm = {
      ...fsm,
      requestPreference: (workOrderId) => {
        reads += 1;
        return fsm.requestPreference(workOrderId);
      },
    };
    await resolveAskedWindows(env.DB, counted, later(RECHECK_AFTER_MS / 2), createLogger(), createCallBudget(Infinity));
    expect(reads).toBe(0);
    await resolveAskedWindows(env.DB, counted, later(RECHECK_AFTER_MS + 1), createLogger(), createCallBudget(Infinity));
    expect(reads).toBe(1);
    expect((await asked())?.asked_checked_at).not.toBeNull();
  });
});
