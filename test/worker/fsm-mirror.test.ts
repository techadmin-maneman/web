import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { statusOf, syncAppointment } from "../../src/domain/fsm-mirror.ts";
import { createLogger } from "../../src/log.ts";
import { createStubFsm, type FsmAppointment, type FsmProvider, type StubFsmWorld } from "../../src/providers/fsm.ts";
import { handleFsmSyncBatch } from "../../src/queues/fsm-sync.ts";
import { LOCAL_SETTINGS, NOW, appFor, fakeDependencies, fakeQueue, markDatabase, request } from "./helpers.ts";

const appointment = (overrides: Partial<FsmAppointment> = {}): FsmAppointment => ({
  id: "ap-1",
  name: "AP-1",
  status: "Scheduled",
  workOrderId: "wo-1",
  contactId: "contact-1",
  scheduledStart: "2026-09-24T10:00:00+05:30",
  scheduledEnd: "2026-09-24T11:30:00+05:30",
  actualStart: null,
  actualEnd: null,
  technicianIds: ["sr-1"],
  serviceIds: ["item-service"],
  serviceCity: "Gurgaon",
  servicePincode: "122018",
  modifiedAt: "2026-09-22T14:27:15+05:30",
  ...overrides,
});

function world(overrides: Partial<StubFsmWorld> = {}): StubFsmWorld {
  return {
    appointments: [appointment()],
    contacts: [{ id: "contact-1", name: "Rohit Malhotra", mobile: "+91 98100 00001", email: "rohit@example.com" }],
    technicians: [{ id: "sr-1", userId: "user-1", name: "Imran Khan", active: true, mobile: null, zone: null }],
    items: [
      { id: "item-service", name: "Service visit", type: "Service" },
      { id: "item-first", name: "First fit", type: "Service" },
      { id: "item-other", name: "Something else", type: "Service" },
    ],
    attachments: {},
    files: {},
    ...overrides,
  };
}

/** A stub FSM whose calls are counted, to see what the mirror asked for. */
function counted(stub: FsmProvider) {
  const calls = { appointment: 0, contact: 0, technicians: 0, items: 0 };
  const fsm: FsmProvider = {
    ...stub,
    appointment: (id) => (calls.appointment++, stub.appointment(id)),
    contact: (id) => (calls.contact++, stub.contact(id)),
    technicians: () => (calls.technicians++, stub.technicians()),
    items: () => (calls.items++, stub.items()),
  };
  return { fsm, calls };
}

const mirrored = (fsmId = "ap-1") =>
  env.DB.prepare(
    `SELECT a.*, t.name AS technician_name, t.initials AS technician_initials, p.name AS person_name
     FROM appointments a LEFT JOIN technicians t ON t.id = a.technician_id LEFT JOIN people p ON p.id = a.person_id
     WHERE a.fsm_id = ?1`,
  )
    .bind(fsmId)
    .first();

async function person(mobile: string, name = "Existing Person") {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, ?4)")
    .bind(id, NOW.toISOString(), mobile, name)
    .run();
  return id;
}

describe("the mirror: one appointment", () => {
  it("writes an appointment with its visit type, technician, window in UTC and place", async () => {
    await syncAppointment(env.DB, createStubFsm(world()), "ap-1", NOW);
    expect(await mirrored()).toMatchObject({
      fsm_work_order_id: "wo-1",
      type: "service",
      window_start: "2026-09-24T04:30:00.000Z",
      window_end: "2026-09-24T06:00:00.000Z",
      status: "scheduled",
      fsm_status: "Scheduled",
      service_city: "Gurgaon",
      service_pincode: "122018",
      technician_name: "Imran Khan",
      technician_initials: "IK",
      fsm_modified_at: "2026-09-22T08:57:15.000Z",
      deleted_at: null,
    });
  });

  it("links the client to the person with the same mobile number, and remembers the contact", async () => {
    const existing = await person("+919810000001");
    await syncAppointment(env.DB, createStubFsm(world()), "ap-1", NOW);
    expect((await mirrored())?.person_id).toBe(existing);
    const row = await env.DB.prepare("SELECT fsm_contact_id FROM people WHERE id = ?1").bind(existing).first();
    expect(row).toEqual({ fsm_contact_id: "contact-1" });
  });

  it("makes a person of a client ops added in FSM, not yet contactable", async () => {
    await syncAppointment(env.DB, createStubFsm(world()), "ap-1", NOW);
    const row = await env.DB.prepare(
      "SELECT name, mobile_e164, email, contactable, fsm_contact_id FROM people WHERE fsm_contact_id = 'contact-1'",
    ).first();
    expect(row).toEqual({
      name: "Rohit Malhotra",
      mobile_e164: "+919810000001",
      email: "rohit@example.com",
      contactable: 0,
      fsm_contact_id: "contact-1",
    });
  });

  it("leaves the client unknown when FSM's contact has no usable mobile number", async () => {
    const noNumber = world({ contacts: [{ id: "contact-1", name: "No Number", mobile: null, email: null }] });
    await syncAppointment(env.DB, createStubFsm(noNumber), "ap-1", NOW);
    expect((await mirrored())?.person_id).toBeNull();
  });

  it("asks FSM for the client, technicians and catalogue only the first time", async () => {
    const { fsm, calls } = counted(createStubFsm(world()));
    await syncAppointment(env.DB, fsm, "ap-1", NOW);
    await syncAppointment(env.DB, fsm, "ap-1", NOW);
    expect(calls).toEqual({ appointment: 2, contact: 1, technicians: 1, items: 1 });
  });

  it("types an appointment by the first of its services that is one of ours, else leaves it untyped", async () => {
    const mixed = world({ appointments: [appointment({ serviceIds: ["item-other", "item-first"] })] });
    await syncAppointment(env.DB, createStubFsm(mixed), "ap-1", NOW);
    expect((await mirrored())?.type).toBe("first_fit");

    const other = world({ appointments: [appointment({ id: "ap-2", serviceIds: ["item-other"] })] });
    await syncAppointment(env.DB, createStubFsm(other), "ap-2", NOW);
    expect((await mirrored("ap-2"))?.type).toBeNull();
  });

  it("records a completed appointment's visit, done, with its duration", async () => {
    const done = world({
      appointments: [
        appointment({
          status: "Completed",
          actualStart: "2026-09-24T10:05:00+05:30",
          actualEnd: "2026-09-24T11:17:00+05:30",
        }),
      ],
    });
    const { appointmentId } = await syncAppointment(env.DB, createStubFsm(done), "ap-1", NOW);
    const visit = await env.DB.prepare("SELECT * FROM visits WHERE appointment_id = ?1").bind(appointmentId).first();
    expect(visit).toMatchObject({
      started_at: "2026-09-24T04:35:00.000Z",
      ended_at: "2026-09-24T05:47:00.000Z",
      duration_minutes: 72,
      outcome: "done",
    });
  });

  it("records a terminated appointment as partial, and updates one visit, not two", async () => {
    const stopped = createStubFsm(world({ appointments: [appointment({ status: "Terminated" })] }));
    await syncAppointment(env.DB, stopped, "ap-1", NOW);
    await syncAppointment(env.DB, stopped, "ap-1", NOW);
    const { results } = await env.DB.prepare("SELECT outcome FROM visits").all();
    expect(results).toEqual([{ outcome: "partial" }]);
  });

  it("overwrites its copy with FSM's latest, and marks it gone when FSM no longer has it", async () => {
    await syncAppointment(env.DB, createStubFsm(world()), "ap-1", NOW);
    await syncAppointment(
      env.DB,
      createStubFsm(world({ appointments: [appointment({ status: "Dispatched" })] })),
      "ap-1",
      NOW,
    );
    expect((await mirrored())?.status).toBe("dispatched");

    const result = await syncAppointment(env.DB, createStubFsm(world({ appointments: [] })), "ap-1", NOW);
    expect(result.outcome).toBe("gone");
    expect((await mirrored())?.deleted_at).toBe(NOW.toISOString());
  });

  it("keeps a status it does not know as other, with FSM's word", () => {
    expect(statusOf("In Progress")).toBe("in_progress");
    expect(statusOf("On Hold")).toBe("other");
  });
});

describe("the fsm-sync queue", () => {
  function batchOf(bodies: unknown[], attempts = 1) {
    const messages = bodies.map((body, index) => ({
      id: `m-${String(index)}`,
      body,
      attempts,
      timestamp: new Date(),
      ack: vi.fn(),
      retry: vi.fn(),
    }));
    return { queue: "mm-fsm-sync-local", messages, ackAll: vi.fn(), retryAll: vi.fn() };
  }

  async function inboxEntry() {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO webhook_inbox (id, source, dedupe_key, module, record_id, received_at)
       VALUES (?1, 'fsm', ?2, 'Service_Appointments', 'ap-1', ?3)`,
    )
      .bind(id, `fsm:${id}`, NOW.toISOString())
      .run();
    return id;
  }

  it("syncs the appointment a message names, marks its webhook processed, and acknowledges it", async () => {
    const inboxId = await inboxEntry();
    const batch = batchOf([{ fsm_id: "ap-1", inbox_id: inboxId, request_id: "r1" }]);
    await handleFsmSyncBatch(
      batch as unknown as MessageBatch,
      env,
      fakeDependencies({ fsm: createStubFsm(world()) }),
      createLogger(),
    );
    expect(batch.messages[0]?.ack).toHaveBeenCalled();
    expect((await mirrored())?.status).toBe("scheduled");
    const entry = await env.DB.prepare("SELECT processed_at, attempts, last_error FROM webhook_inbox WHERE id = ?1")
      .bind(inboxId)
      .first();
    expect(entry).toEqual({ processed_at: NOW.toISOString(), attempts: 1, last_error: null });
  });

  it("retries a failure later, with the reason on the webhook, and gives up with an alert on the fifth", async () => {
    const failing: FsmProvider = {
      ...createStubFsm(),
      appointment: () => Promise.reject(new Error("Zoho 503 UNAVAILABLE: busy")),
    };
    const inboxId = await inboxEntry();
    const deps = fakeDependencies({ fsm: failing });

    const first = batchOf([{ fsm_id: "ap-1", inbox_id: inboxId, request_id: "r1" }], 1);
    await handleFsmSyncBatch(first as unknown as MessageBatch, env, deps, createLogger());
    expect(first.messages[0]?.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    const entry = await env.DB.prepare("SELECT processed_at, attempts, last_error FROM webhook_inbox WHERE id = ?1")
      .bind(inboxId)
      .first();
    expect(entry).toEqual({ processed_at: null, attempts: 1, last_error: "Zoho 503 UNAVAILABLE: busy" });

    const fourth = batchOf([{ fsm_id: "ap-1", request_id: "r1" }], 4);
    await handleFsmSyncBatch(fourth as unknown as MessageBatch, env, deps, createLogger());
    expect(fourth.messages[0]?.retry).toHaveBeenCalledWith({ delaySeconds: 240 });

    const fifth = batchOf([{ fsm_id: "ap-1", request_id: "r1" }], 5);
    await handleFsmSyncBatch(fifth as unknown as MessageBatch, env, deps, createLogger());
    expect(fifth.messages[0]?.ack).toHaveBeenCalled();
    expect(deps.alerts).toEqual([
      "FSM sync gave up on appointment ap-1 after 5 attempts: Zoho 503 UNAVAILABLE: busy. The reconciliation will try it again.",
    ]);
  });

  it("drops a message it cannot read", async () => {
    const batch = batchOf([{ appointment: "ap-1" }]);
    await handleFsmSyncBatch(batch as unknown as MessageBatch, env, fakeDependencies(), createLogger());
    expect(batch.messages[0]?.ack).toHaveBeenCalled();
  });
});

describe("FSM's webhook", () => {
  const TOKEN = "an-fsm-webhook-token-of-at-least-32-chars";
  const connected = {
    zohoFsm: {
      clientId: "c",
      clientSecret: "s",
      refreshToken: "r",
      accountsHost: "accounts.zoho.in",
      apiHost: "www.zohoapis.in",
      booksOrgId: null,
      webhookToken: TOKEN,
      booksRefundAccountId: null,
    },
  };

  beforeEach(async () => {
    await markDatabase();
  });

  function hook(
    body: string,
    contentType: string,
    token = TOKEN,
    settings: object = connected,
    queue = fakeQueue(),
    query = "",
  ) {
    const app = appFor("local", fakeDependencies(), { ...LOCAL_SETTINGS, ...settings });
    const response = request(
      app,
      `/api/hooks/fsm/${token}${query}`,
      { method: "POST", body, headers: { "Content-Type": contentType } },
      { FSM_QUEUE: queue },
    );
    return { response, queue };
  }

  const hint = JSON.stringify({
    module: "Service_Appointments",
    id: "ap-1",
    modified_time: "2026-09-22T14:27:15+05:30",
  });

  it("keeps a hint once and queues the appointment for a fresh read", async () => {
    const { response, queue } = hook(hint, "application/json");
    expect((await response).status).toBe(204);
    expect(queue.sent).toEqual([
      { fsm_id: "ap-1", inbox_id: expect.any(String) as string, request_id: expect.any(String) as string },
    ]);
    const entry = await env.DB.prepare("SELECT module, record_id, processed_at FROM webhook_inbox").first();
    expect(entry).toEqual({ module: "Service_Appointments", record_id: "ap-1", processed_at: null });
  });

  it("takes the same hint as a form, and ignores a repeat of one it has", async () => {
    const form = new URLSearchParams({
      module: "Service_Appointments",
      id: "ap-1",
      modified_time: "2026-09-22T14:27:15+05:30",
    });
    const first = hook(form.toString(), "application/x-www-form-urlencoded");
    expect((await first.response).status).toBe(204);
    const again = hook(hint, "application/json");
    expect((await again.response).status).toBe(204);
    expect([...first.queue.sent, ...again.queue.sent]).toHaveLength(1);
  });

  it("reads the hint from the query string, as FSM sends it, with an empty form body", async () => {
    // As a delivery from FSM arrived on staging on 22 September 2026.
    const query = "?modified_time=2026-09-22+05%3A41%3A09&module=Service_Appointments&id=ap-1";
    const { response, queue } = hook(
      "",
      "application/x-www-form-urlencoded;charset=UTF-8",
      TOKEN,
      connected,
      fakeQueue(),
      query,
    );
    expect((await response).status).toBe(204);
    expect(queue.sent).toEqual([
      { fsm_id: "ap-1", inbox_id: expect.any(String) as string, request_id: expect.any(String) as string },
    ]);
  });

  it("ignores other modules and unreadable bodies, without asking FSM to send them again", async () => {
    const other = hook(JSON.stringify({ module: "Contacts", id: "c-1" }), "application/json");
    expect((await other.response).status).toBe(204);
    const garbage = hook("not json", "application/json");
    expect((await garbage.response).status).toBe(204);
    expect([...other.queue.sent, ...garbage.queue.sent]).toEqual([]);
  });

  it("refuses a wrong token, and does not exist without one", async () => {
    expect((await hook(hint, "application/json", "wrong").response).status).toBe(401);
    const off = hook(hint, "application/json", TOKEN, { zohoFsm: null });
    expect((await off.response).status).toBe(404);
  });
});
