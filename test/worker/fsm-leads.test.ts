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

const world = () => ({ ...EMPTY_FSM, items: [{ id: "item-consult", name: "Consultation", type: "Service" as const }] });

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
        state: "Haryana",
        stateCode: "HR",
      },
    ]);
    expect(fsm.made.requests).toEqual([
      {
        contactId: "stub-contact-1",
        summary: "Staging test: Consultation for Rohit Malhotra",
        serviceId: "item-consult",
        preferredDate: "2026-09-24",
        preferenceNote: "Evening, 4 to 8 pm",
      },
    ]);
    const saved = await env.DB.prepare(
      "SELECT p.fsm_contact_id, l.fsm_request_id FROM leads l JOIN people p ON p.id = l.person_id WHERE l.id = ?1",
    )
      .bind(LEAD)
      .first();
    expect(saved).toEqual({ fsm_contact_id: "stub-contact-1", fsm_request_id: "stub-request-1" });

    expect(await sendLeadToFsm(env.DB, fsm, LEAD, { labelAsTest: true })).toBe("already_sent");
    expect(fsm.made.requests).toHaveLength(1);
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
