// A client's note on their visit, written to its appointment in FSM by the fsm-sync consumer, and blanked there when
// the client is erased (docs/decisions/0099-the-clients-note-in-fsm.md). Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../../src/log.ts";
import { createStubFsm, EMPTY_FSM, type StubFsm } from "../../src/providers/fsm.ts";
import { handleFsmSyncBatch } from "../../src/queues/fsm-sync.ts";
import { fakeDependencies, NOW } from "./helpers.ts";

const PERSON = "44444444-4444-4444-8444-444444444444";
const VISIT = "22222222-2222-4222-8222-222222222222";
const EARLIER = "22222222-2222-4222-8222-222222222223";

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO people (id, created_at, mobile_e164, name, fsm_contact_id)
       VALUES (?1, ?2, '+919810000003', 'Rohit Malhotra', 'contact-1')`,
    ).bind(PERSON, NOW.toISOString()),
    env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end,
         fsm_modified_at, synced_at, client_note, client_note_at)
       VALUES (?1, 'fsm-1', ?2, 'service', 'scheduled', 'Scheduled', '2026-09-22T04:30:00.000Z',
         '2026-09-22T06:00:00.000Z', ?3, ?3, 'Ring twice 🙏 the bell is weak', ?3),
              (?4, 'fsm-0', ?2, 'service', 'completed', 'Completed', '2026-08-22T04:30:00.000Z',
         '2026-08-22T06:00:00.000Z', ?3, ?3, NULL, NULL)`,
    ).bind(VISIT, PERSON, NOW.toISOString(), EARLIER),
  ]);
});

function consume(fsm: StubFsm, body: Record<string, unknown>, attempts = 1) {
  const message = { id: "m1", body: { ...body, request_id: "r" }, attempts, ack: vi.fn(), retry: vi.fn() };
  const batch = { queue: "mm-fsm-sync-local", messages: [message], ackAll: vi.fn(), retryAll: vi.fn() };
  const deps = fakeDependencies({ fsm });
  return { message, deps, done: handleFsmSyncBatch(batch as unknown as MessageBatch, env, deps, createLogger()) };
}

const writtenAt = async (visit = VISIT) =>
  (await env.DB.prepare("SELECT fsm_note_written_at FROM appointments WHERE id = ?1").bind(visit).first())
    ?.fsm_note_written_at;

describe("a client's note in FSM", () => {
  it("is written to the visit's appointment as the visit holds it now, without what FSM would cut it at", async () => {
    const fsm = createStubFsm(EMPTY_FSM);
    const { message, done } = consume(fsm, { note_appointment_id: VISIT });
    await done;
    expect(fsm.made.clientNotes).toEqual([{ appointmentId: "fsm-1", note: "Ring twice the bell is weak" }]);
    expect(await writtenAt()).toBe(NOW.toISOString());
    expect(message.ack).toHaveBeenCalled();
  });

  it("writes nothing for a visit with no note, one gone, or a client erased", async () => {
    const fsm = createStubFsm(EMPTY_FSM);
    await consume(fsm, { note_appointment_id: EARLIER }).done;
    await env.DB.prepare("UPDATE appointments SET deleted_at = ?2 WHERE id = ?1").bind(VISIT, NOW.toISOString()).run();
    await consume(fsm, { note_appointment_id: VISIT }).done;
    await env.DB.prepare("UPDATE appointments SET deleted_at = NULL").run();
    await env.DB.prepare("UPDATE people SET erased_at = ?2 WHERE id = ?1").bind(PERSON, NOW.toISOString()).run();
    await consume(fsm, { note_appointment_id: VISIT }).done;
    expect(fsm.made.clientNotes).toEqual([]);
    expect(await writtenAt()).toBeNull();
  });

  it("writes nothing for a visit FSM never held, whose FSM ID is its own", async () => {
    await env.DB.prepare("UPDATE appointments SET fsm_id = id WHERE id = ?1").bind(VISIT).run();
    const fsm = createStubFsm(EMPTY_FSM);

    const { message, done } = consume(fsm, { note_appointment_id: VISIT });
    await done;

    expect(fsm.made.clientNotes).toEqual([]);
    expect(message.ack).toHaveBeenCalled();
  });

  it("is tried again when FSM fails, and ops are told on the fifth try, until a later note reaches it", async () => {
    const fsm = createStubFsm(EMPTY_FSM);
    fsm.failNext("writeClientNote", "FSM answered 500");
    const first = consume(fsm, { note_appointment_id: VISIT });
    await first.done;
    expect(first.message.retry).toHaveBeenCalled();
    expect(await writtenAt()).toBeNull();

    fsm.failNext("writeClientNote", "FSM answered 500");
    const last = consume(fsm, { note_appointment_id: VISIT }, 5);
    await last.done;
    expect(last.message.ack).toHaveBeenCalled();
    expect(last.deps.alerts).toEqual([
      expect.stringContaining(`The client's note on visit ${VISIT} did not reach FSM appointment fsm-1`) as string,
    ]);
    const open = () =>
      env.DB.prepare("SELECT key FROM alerts WHERE key = ?1 AND resolved_at IS NULL").bind(`client_note_fsm:${VISIT}`);
    expect(await open().first("key")).toBe(`client_note_fsm:${VISIT}`);

    await consume(fsm, { note_appointment_id: VISIT }).done;
    expect(await open().first("key")).toBeNull();
  });

  it("is blanked in FSM when the client is erased, on each appointment it reached, and once", async () => {
    const fsm = createStubFsm(EMPTY_FSM);
    await consume(fsm, { note_appointment_id: VISIT }).done;
    await env.DB.prepare("UPDATE people SET erased_at = ?2 WHERE id = ?1").bind(PERSON, NOW.toISOString()).run();

    await consume(fsm, { erase_person_id: PERSON }).done;
    expect(fsm.made.clientNotes).toEqual([
      { appointmentId: "fsm-1", note: "Ring twice the bell is weak" },
      { appointmentId: "fsm-1", note: "" },
    ]);
    expect(fsm.made.erased).toEqual(["contact-1"]);
    expect(await writtenAt()).toBeNull();
  });

  it("stops the erasure, to be tried again, when FSM will not blank a note", async () => {
    const fsm = createStubFsm(EMPTY_FSM);
    await consume(fsm, { note_appointment_id: VISIT }).done;
    await env.DB.prepare("UPDATE people SET erased_at = ?2 WHERE id = ?1").bind(PERSON, NOW.toISOString()).run();

    fsm.failNext("writeClientNote", "FSM answered 500");
    await consume(fsm, { erase_person_id: PERSON }).done;
    expect(fsm.made.erased).toEqual([]);
    const person = await env.DB.prepare("SELECT fsm_erased_at, fsm_erasure_attempts FROM people").first();
    expect(person).toEqual({ fsm_erased_at: null, fsm_erasure_attempts: 1 });
    expect(await writtenAt()).toBe(NOW.toISOString());
  });
});
