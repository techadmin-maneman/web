// A client's new number or address, written over their FSM contact by the
// fsm-sync consumer (REQ-S5-03, LIFE-12). Every name, number and address here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../../src/log.ts";
import { createStubFsm, EMPTY_FSM, type StubFsm } from "../../src/providers/fsm.ts";
import { handleFsmSyncBatch } from "../../src/queues/fsm-sync.ts";
import { fakeDependencies, NOW } from "./helpers.ts";

const PERSON = "44444444-4444-4444-8444-444444444444";

beforeEach(async () => {
  await env.DB.prepare(
    `INSERT INTO people (id, created_at, mobile_e164, name, fsm_contact_id)
     VALUES (?1, ?2, '+919810000003', 'Rohit Malhotra', 'contact-1')`,
  )
    .bind(PERSON, NOW.toISOString())
    .run();
});

function update(fsm: StubFsm, attempts = 1) {
  const body = { update_contact_person_id: PERSON, request_id: "r" };
  const message = { id: "m1", body, attempts, ack: vi.fn(), retry: vi.fn() };
  const batch = { queue: "mm-fsm-sync-local", messages: [message], ackAll: vi.fn(), retryAll: vi.fn() };
  const deps = fakeDependencies({ fsm });
  return { message, deps, done: handleFsmSyncBatch(batch as unknown as MessageBatch, env, deps, createLogger()) };
}

async function address(line1: string, replacedAt: string | null = null) {
  await env.DB.prepare(
    `INSERT INTO addresses (id, person_id, created_at, line1, line2, locality, city, pincode, replaced_at)
     VALUES (?1, ?2, ?3, ?4, 'Tower C', 'Sector 65', 'Gurgaon', '122018', ?5)`,
  )
    .bind(crypto.randomUUID(), PERSON, NOW.toISOString(), line1, replacedAt)
    .run();
}

describe("a client's contact in FSM", () => {
  it("takes their number and current address, in place of the street to be confirmed", async () => {
    await address("House 4417", NOW.toISOString());
    await address("House 12");
    const fsm = createStubFsm(EMPTY_FSM);
    const { message, done } = update(fsm);
    await done;

    expect(fsm.made.contactUpdates).toEqual([
      {
        contactId: "contact-1",
        mobile: "+919810000003",
        address: { street1: "House 12", street2: "Tower C, Sector 65", city: "Gurgaon", pincode: "122018" },
      },
    ]);
    expect(message.ack).toHaveBeenCalled();
  });

  // docs/decisions/0098-the-door-in-fsms-address.md
  it("takes the flat, floor, tower and landmark, so the work order names the door", async () => {
    await env.DB.prepare(
      `INSERT INTO addresses (id, person_id, created_at, flat, floor, tower, line1, line2, landmark, locality, city,
                              pincode)
       VALUES (?1, ?2, ?3, 'Flat 402', '4', 'C', 'Palm Grove Society', NULL, 'Opposite the park', 'Sector 65',
               'Gurgaon', '122018')`,
    )
      .bind(crypto.randomUUID(), PERSON, NOW.toISOString())
      .run();
    const fsm = createStubFsm(EMPTY_FSM);
    await update(fsm).done;
    expect(fsm.made.contactUpdates).toEqual([
      {
        contactId: "contact-1",
        mobile: "+919810000003",
        address: {
          street1: "Flat 402, Floor 4, Tower C, Palm Grove Society",
          street2: "Sector 65, Landmark: Opposite the park",
          city: "Gurgaon",
          pincode: "122018",
        },
      },
    ]);
  });

  it("takes the number alone from a client who has given no address", async () => {
    const fsm = createStubFsm(EMPTY_FSM);
    await update(fsm).done;
    expect(fsm.made.contactUpdates).toEqual([{ contactId: "contact-1", mobile: "+919810000003", address: null }]);
  });

  it("is left alone for a client FSM has no contact for yet, or who was erased", async () => {
    const fsm = createStubFsm(EMPTY_FSM);
    await env.DB.prepare("UPDATE people SET fsm_contact_id = NULL WHERE id = ?1").bind(PERSON).run();
    await update(fsm).done;
    await env.DB.prepare("UPDATE people SET fsm_contact_id = 'contact-1', erased_at = ?2 WHERE id = ?1")
      .bind(PERSON, NOW.toISOString())
      .run();
    await update(fsm).done;
    expect(fsm.made.contactUpdates).toEqual([]);
  });

  it("is tried again when FSM fails, and ops are told on the fifth try", async () => {
    const fsm = createStubFsm(EMPTY_FSM);
    fsm.failNext("updateContact", "FSM answered 500");
    const first = update(fsm);
    await first.done;
    expect(first.message.retry).toHaveBeenCalled();

    fsm.failNext("updateContact", "FSM answered 500");
    const last = update(fsm, 5);
    await last.done;
    expect(last.message.ack).toHaveBeenCalled();
    expect(last.deps.alerts).toEqual([expect.stringContaining("did not reach FSM contact contact-1") as string]);
  });
});
