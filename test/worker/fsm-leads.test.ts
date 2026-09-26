// A booked lead, sent to FSM as a contact and a Request for ops to schedule
// (src/domain/fsm-leads.ts). Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendLeadToFsm } from "../../src/domain/fsm-leads.ts";
import { createLogger } from "../../src/log.ts";
import { createStubFsm, EMPTY_FSM, type FsmProvider } from "../../src/providers/fsm.ts";
import { handleFsmSyncBatch } from "../../src/queues/fsm-sync.ts";
import { fakeDependencies, markDatabase, NOW } from "./helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const LEAD = "22222222-2222-4222-8222-222222222222";

const world = () => ({
  ...EMPTY_FSM,
  items: [{ id: "item-consult", name: "Consultation", type: "Service" as const, price: null }],
});

async function lead(source = "form", window = "weekday_pm", fsmContactId: string | null = null) {
  await env.DB.prepare(
    `INSERT INTO people (id, created_at, mobile_e164, name, fsm_contact_id) VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra', ?3)`,
  )
    .bind(PERSON, NOW.toISOString(), fsmContactId)
    .run();
  await env.DB.prepare(
    `INSERT INTO leads (id, person_id, created_at, source, city, first_choice_window, loss_extent, proposed_visit_date,
       sync_state, request_id)
     VALUES (?1, ?2, ?3, ?4, 'Gurgaon', ?5, 'crown', '2026-09-24', 'pending', 'r1')`,
  )
    .bind(LEAD, PERSON, NOW.toISOString(), source, window)
    .run();
}

beforeEach(async () => {
  await markDatabase();
});

describe("sendLeadToFsm", () => {
  it("adds the person as a contact and asks for their consultation, on the day and in the window they picked", async () => {
    await lead();
    const fsm = createStubFsm(world());
    expect(await sendLeadToFsm(env.DB, fsm, LEAD, { labelAsTest: true })).toBe("sent");

    expect(fsm.made.contacts).toEqual([
      {
        firstName: "Rohit",
        lastName: "Malhotra",
        mobile: "+919810000001",
        email: null,
        city: "Gurgaon",
        pincode: null,
        street: null,
        state: "Haryana",
        stateCode: "HR",
      },
    ]);
    const saved = await env.DB.prepare(
      "SELECT p.fsm_contact_id, l.fsm_request_id FROM leads l JOIN people p ON p.id = l.person_id WHERE l.id = ?1",
    )
      .bind(LEAD)
      .first<{ fsm_contact_id: string; fsm_request_id: string }>();
    expect(saved?.fsm_contact_id).toMatch(/^stub-contact-/);
    expect(saved?.fsm_request_id).toMatch(/^stub-request-/);
    expect(fsm.made.requests).toEqual([
      {
        contactId: saved?.fsm_contact_id,
        summary: "Staging test: Consultation for Rohit Malhotra",
        serviceId: "item-consult",
        preferredDate: "2026-09-24",
        preferenceNote: "Evening, 4 to 8 pm",
        reference: LEAD,
      },
    ]);
    expect(await sendLeadToFsm(env.DB, fsm, LEAD, { labelAsTest: true })).toBe("already_sent");
    expect(fsm.made.requests).toHaveLength(1);
  });

  // REQ-S5-03: a contact FSM added took "To be confirmed with the client" whatever the client had saved.
  it("gives a new contact the street and pincode of the address the client saved", async () => {
    await lead();
    await env.DB.prepare(
      `INSERT INTO addresses (id, person_id, created_at, line1, line2, locality, city, pincode)
       VALUES ('address-1', ?1, ?2, 'House 12', 'Tower C', 'Sector 65', 'Gurgaon', '122018')`,
    )
      .bind(PERSON, NOW.toISOString())
      .run();
    const fsm = createStubFsm(world());
    await sendLeadToFsm(env.DB, fsm, LEAD, { labelAsTest: true });
    expect(fsm.made.contacts).toMatchObject([
      { city: "Gurgaon", pincode: "122018", street: { street1: "House 12", street2: "Tower C, Sector 65" } },
    ]);
  });

  it("uses the contact FSM already has, and does not say test in production", async () => {
    await lead("form", "weekday_am", "fsm-contact-9");
    const fsm = createStubFsm(world());
    await sendLeadToFsm(env.DB, fsm, LEAD, { labelAsTest: false });
    expect(fsm.made.contacts).toEqual([]);
    expect(fsm.made.requests[0]).toMatchObject({
      contactId: "fsm-contact-9",
      summary: "Consultation for Rohit Malhotra",
      preferenceNote: "Morning, 9 am to 12 pm",
    });
  });

  // INT-11 of the audit, 24 September 2026.
  it("finds the Request and the contact FSM made on a try whose answers never came, and makes neither twice", async () => {
    await lead();
    const fsm = createStubFsm(world());
    fsm.loseAnswer("createContact");
    await expect(sendLeadToFsm(env.DB, fsm, LEAD, { labelAsTest: true })).rejects.toThrow();
    fsm.loseAnswer("createRequest");
    await expect(sendLeadToFsm(env.DB, fsm, LEAD, { labelAsTest: true })).rejects.toThrow();
    expect(await sendLeadToFsm(env.DB, fsm, LEAD, { labelAsTest: true })).toBe("sent");
    expect(fsm.made.contacts).toHaveLength(1);
    expect(fsm.made.requests).toHaveLength(1);
  });

  it("uses the contact FSM already holds for the number, as one ops added by hand", async () => {
    await lead();
    const held = { id: "fsm-contact-by-hand", name: "Rohit Malhotra", mobile: "+919810000001", email: null };
    const fsm = createStubFsm({ ...world(), contacts: [held] });
    await sendLeadToFsm(env.DB, fsm, LEAD, { labelAsTest: true });
    expect(fsm.made.contacts).toEqual([]);
    expect(fsm.made.requests[0]).toMatchObject({ contactId: "fsm-contact-by-hand" });
  });

  it("sends only a booking: not a waitlist entry", async () => {
    await lead("waitlist");
    const fsm = createStubFsm(world());
    expect(await sendLeadToFsm(env.DB, fsm, LEAD, { labelAsTest: true })).toBe("not_a_booking");
    expect(fsm.made.requests).toEqual([]);
  });

  it("fails plainly while FSM has no Consultation item", async () => {
    await lead();
    await expect(sendLeadToFsm(env.DB, createStubFsm(), LEAD, { labelAsTest: true })).rejects.toThrow(/setup-fsm/);
  });
});

describe("the fsm-sync queue, for a lead", () => {
  const batchOf = (attempts = 1) => ({
    queue: "mm-fsm-sync-local",
    messages: [{ id: "m1", body: { lead_id: LEAD, request_id: "r1" }, attempts, ack: vi.fn(), retry: vi.fn() }],
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  });

  it("sends it and acknowledges the message", async () => {
    await lead();
    const fsm = createStubFsm(world());
    const batch = batchOf();
    await handleFsmSyncBatch(batch as unknown as MessageBatch, env, fakeDependencies({ fsm }), createLogger(), {
      labelAsTest: true,
      cataloguePush: false,
    });
    expect(batch.messages[0]?.ack).toHaveBeenCalled();
    expect(fsm.made.requests).toHaveLength(1);
  });

  it("retries a failure, and gives up with an alert on the fifth", async () => {
    await lead();
    const failing: FsmProvider = {
      ...createStubFsm(world()),
      createContact: () => Promise.reject(new Error("Zoho 503 UNAVAILABLE: busy")),
    };
    const deps = fakeDependencies({ fsm: failing });
    const first = batchOf(1);
    await handleFsmSyncBatch(first as unknown as MessageBatch, env, deps, createLogger());
    expect(first.messages[0]?.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    const fifth = batchOf(5);
    await handleFsmSyncBatch(fifth as unknown as MessageBatch, env, deps, createLogger());
    expect(fifth.messages[0]?.ack).toHaveBeenCalled();
    expect(deps.alerts).toEqual([expect.stringMatching(/did not reach FSM after 5 attempts/)]);
  });
});
