// What the client asked for, as against what the board is offering (ADR 0063).
// Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { PER_PASS, resolveAskedWindows } from "../../src/domain/asked-windows.ts";
import { NOW } from "./helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const VISIT = "22222222-2222-4222-8222-222222222222";

const pass = () => resolveAskedWindows(env.DB, NOW);

/** An unassigned visit as the mirror writes one: ops have not put it on anybody yet. */
async function visit(id = VISIT, workOrderId: string | null = "fsm-wo-1", type = "consultation") {
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, fsm_work_order_id, person_id, type, status, fsm_status,
       window_start, window_end, fsm_modified_at, synced_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 'scheduled', 'Scheduled', '2026-09-25T09:30:00.000Z',
       '2026-09-25T10:30:00.000Z', ?6, ?6)`,
  )
    .bind(id, `fsm-${id}`, workOrderId, PERSON, type, NOW.toISOString())
    .run();
}

/** A request the site's form left while self-serve booking was off, with the day and window asked for. */
async function requested(window: string, createdAt = NOW.toISOString(), date = "2026-09-24") {
  await env.DB.prepare(
    `INSERT INTO consultation_requests (id, person_id, pincode, requested_date, requested_window, created_at)
     VALUES (?1, ?2, '122018', ?3, ?4, ?5)`,
  )
    .bind(crypto.randomUUID(), PERSON, date, window, createdAt)
    .run();
}

const asked = (id = VISIT) =>
  env.DB.prepare("SELECT asked_window, asked_checked_at FROM appointments WHERE id = ?1")
    .bind(id)
    .first<{ asked_window: string | null; asked_checked_at: string | null }>();

beforeEach(async () => {
  await env.DB.prepare(
    "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra')",
  )
    .bind(PERSON, NOW.toISOString())
    .run();
});

/*
 * With self-serve booking off, which is production's setting, the site's form
 * leaves a request with the day and window asked for: ops put the consultation
 * in FSM themselves. Every such visit once read "Asked · not recorded" though
 * we held what was asked (BIZ-23).
 */
describe("the window the client asked for", () => {
  it("is the window of the client's request, for a consultation", async () => {
    await visit();
    await requested("afternoon");

    expect(await pass()).toEqual({ resolved: 1 });
    expect(await asked()).toEqual({ asked_window: "afternoon", asked_checked_at: NOW.toISOString() });
  });

  it("is the latest request's, where the client asked more than once", async () => {
    await visit();
    await requested("morning", "2026-09-19T06:30:00.000Z", "2026-09-22");
    await requested("evening", "2026-09-20T06:30:00.000Z", "2026-09-25");

    await pass();
    expect((await asked())?.asked_window).toBe("evening");
  });

  /*
   * The rule this whole point turns on: never show a window the system cannot
   * know. A visit our own booking made was booked into the window the client
   * picked, so the column stays null for the tray to say so in words.
   */
  it("is none where the client left no request, or for a visit that is not a consultation", async () => {
    const service = "44444444-4444-4444-8444-444444444444";
    await visit();
    await visit(service, "fsm-wo-2", "service");

    expect(await pass()).toEqual({ resolved: 0 });
    expect(await asked()).toEqual({ asked_window: null, asked_checked_at: NOW.toISOString() });

    await requested("afternoon");
    await env.DB.prepare("UPDATE appointments SET asked_checked_at = NULL").run();
    await pass();
    expect((await asked(service))?.asked_window).toBeNull();
  });
});

describe("the pass", () => {
  it("looks at a visit once: one already looked at is left alone", async () => {
    await visit();
    await pass();
    await requested("afternoon");

    expect(await pass()).toEqual({ resolved: 0 });
    expect((await asked())?.asked_window).toBeNull();
  });

  it("does not look at a visit FSM has no work order for", async () => {
    await visit(VISIT, null);

    expect(await pass()).toEqual({ resolved: 0 });
    expect(await asked()).toEqual({ asked_window: null, asked_checked_at: null });
  });

  it("looks at a few visits a run, and the next run the rest", async () => {
    const ids = Array.from(
      { length: PER_PASS + 1 },
      (_, n) => `44444444-4444-4444-8444-${String(n).padStart(12, "0")}`,
    );
    for (const id of ids) await visit(id, `fsm-wo-${id}`);

    await pass();
    const looked = async () =>
      (await env.DB.prepare("SELECT COUNT(*) AS n FROM appointments WHERE asked_checked_at IS NOT NULL").first("n")) ??
      0;
    expect(await looked()).toBe(PER_PASS);
    await pass();
    expect(await looked()).toBe(PER_PASS + 1);
  });
});
