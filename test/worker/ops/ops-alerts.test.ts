// Tasks' "Needs a hand" (src/routes/ops/alerts.ts): the alerts ops were told of, each until it is put right, marked
// done, or its work sent again. NOW is Monday 21 September 2026, 12 noon in India. Nothing here is a real person.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { AlertOnce } from "../../../src/domain/ops/alerts.ts";
import type { App } from "../../../src/http/context.ts";
import { createLogger } from "../../../src/log.ts";
import { MAX_SEND_ATTEMPTS } from "../../../src/config/pipeline.ts";
import { syncLead } from "../../../src/queues/crm-sync.ts";
import { sendMessage } from "../../../src/queues/messaging.ts";
import {
  appFor,
  captureLogs,
  fakeDependencies,
  fakeQueue,
  LOCAL_CONFIG,
  markDatabase,
  NOW,
  phaseOneLead,
  request,
  stubCrmThatFails,
} from "../helpers.ts";
import { enforce, listStaff, opsAs, person as staffPerson } from "./staff-fixtures.ts";
import { insertJob, insertPerson } from "../tryon-fixtures.ts";
import { MAX_SYNC_ATTEMPTS } from "../../../src/config/pipeline.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const MESSAGE = "22222222-2222-4222-8222-222222222221";
const VISIT = "22222222-2222-4222-8222-222222222222";

interface Listed {
  count: number;
  alerts: { id: string; kind: string; message: string; link: string | null; count: number; send_again: boolean }[];
}

let ops: App;
let alertOnce: AlertOnce;

const list = async (app: App = ops): Promise<Listed> => (await request(app, "/api/alerts")).json<Listed>();
const post = (path: string, bindings: Partial<Env> = {}, app: App = ops) =>
  request(app, path, { method: "POST", headers: { Origin: "https://maneman.test" } }, bindings);
const idOf = async (kind: string) => (await list()).alerts.find((alert) => alert.kind === kind)?.id ?? "";

/** A try-on's result that failed for good on its way to the client, as the messaging consumer leaves one. */
async function failedMessage(): Promise<void> {
  await insertPerson(PERSON, "+919810000001", "Rohit Malhotra");
  await insertJob({ id: "job", state: "ready", result_key: "results/job.png" });
  await env.DB.prepare(
    `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_id, state, queued_at, attempts, last_error)
     VALUES (?1, ?2, ?3, 'tryon_result', 'job', 'failed', ?2, ?4, 'HTTP 503')`,
  )
    .bind(MESSAGE, NOW.toISOString(), PERSON, MAX_SEND_ATTEMPTS)
    .run();
  await alertOnce({
    key: `message_failed:${MESSAGE}`,
    message: `Message ${MESSAGE} (tryon_result) failed after 4 attempts: HTTP 503`,
    link: `/clients/${PERSON}`,
  });
}

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  const deps = fakeDependencies();
  alertOnce = deps.alertOnce;
  ops = appFor("local", deps, {}, "ops");
});

describe("the open alerts on Tasks", () => {
  it("lists those ops were told of, the longest open first, and says which can be sent again", async () => {
    await failedMessage();
    await alertOnce({ key: `invoice_refused:${VISIT}`, message: "Books refused the invoice.", link: "/tasks" });

    const listed = await list();

    expect(listed.count).toBe(2);
    expect(listed.alerts).toMatchObject([
      { kind: "message_failed", link: `/clients/${PERSON}`, count: 1, send_again: true },
      { kind: "invoice_refused", message: "Books refused the invoice.", send_again: false },
    ]);
  });

  it("leaves out one not yet told, waiting for its third sighting, and one already put right", async () => {
    await alertOnce({ key: "books_payment_failed:pay-1", message: "Books failed.", after: 3 });
    await alertOnce({ key: "whatsapp_bridge", message: "The bridge is closed." });
    await fakeDependencies().resolveAlert("whatsapp_bridge");

    expect(await list()).toEqual({ count: 0, alerts: [] });
  });

  it("shows each department its own kinds once the Staff list is enforced", async () => {
    await failedMessage();
    await alertOnce({ key: `invoice_refused:${VISIT}`, message: "Books refused the invoice." });
    await listStaff("asha@maneman.in", ["finance:act:national"]);
    await enforce();

    const asFinance = await list(opsAs(staffPerson("asha@maneman.in")));

    expect(asFinance.alerts.map((alert) => alert.kind)).toEqual(["invoice_refused"]);
  });
});

describe("marking an alert done", () => {
  it("closes it under whoever did, and it leaves the list", async () => {
    await failedMessage();
    const id = await idOf("message_failed");

    expect((await post(`/api/alerts/${id}/resolve`)).status).toBe(204);

    expect((await list()).alerts).toEqual([]);
    expect(
      await env.DB.prepare(
        "SELECT action, actor, subject_kind, subject_id FROM audit_log WHERE action = 'alert.resolve'",
      )
        .all()
        .then((answer) => answer.results),
    ).toEqual([{ action: "alert.resolve", actor: "ops@localhost", subject_kind: "alert", subject_id: id }]);
    expect((await post(`/api/alerts/${id}/resolve`)).status).toBe(404);
  });

  it("records an erasure the CRM gave up on as done there, since ops blanked the record by hand", async () => {
    await env.DB.prepare(
      `INSERT INTO people (id, created_at, mobile_e164, name, erased_at, crm_erasure_attempts)
       VALUES (?1, ?2, '', '', ?2, ?3)`,
    )
      .bind(PERSON, NOW.toISOString(), MAX_SYNC_ATTEMPTS)
      .run();
    await alertOnce({ key: `crm_erasure:${PERSON}`, message: "Erasing failed." });

    expect((await post(`/api/alerts/${await idOf("crm_erasure")}/resolve`)).status).toBe(204);

    expect(
      await env.DB.prepare("SELECT crm_erased_at FROM people WHERE id = ?1").bind(PERSON).first("crm_erased_at"),
    ).toBe(NOW.toISOString());
  });

  it("asks Manage to record an erasure as done in the CRM, as any erasure does", async () => {
    await env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name, erased_at) VALUES (?1, ?2, '', '', ?2)",
    )
      .bind(PERSON, NOW.toISOString())
      .run();
    await alertOnce({ key: `crm_erasure:${PERSON}`, message: "Erasing failed." });
    const id = await idOf("crm_erasure");
    await listStaff("asha@maneman.in", ["customer_care:act:national"]);
    await listStaff("ravi@maneman.in", ["customer_care:manage:national"]);
    await enforce();

    expect((await post(`/api/alerts/${id}/resolve`, {}, opsAs(staffPerson("asha@maneman.in")))).status).toBe(403);
    expect(await env.DB.prepare("SELECT crm_erased_at FROM people").first("crm_erased_at")).toBeNull();
    expect((await post(`/api/alerts/${id}/resolve`, {}, opsAs(staffPerson("ravi@maneman.in")))).status).toBe(204);
  });

  it("is refused to someone outside the alert's department", async () => {
    await failedMessage();
    const id = await idOf("message_failed");
    await listStaff("asha@maneman.in", ["finance:act:national"]);
    await enforce();

    expect((await post(`/api/alerts/${id}/resolve`, {}, opsAs(staffPerson("asha@maneman.in")))).status).toBe(403);
  });
});

describe("sending again what an alert gave up on", () => {
  it("puts a failed message back on the queue and closes the alert; failing again, it is back on Tasks", async () => {
    await failedMessage();
    const queue = fakeQueue();

    expect(
      (await post(`/api/alerts/${await idOf("message_failed")}/send-again`, { MESSAGE_QUEUE: queue })).status,
    ).toBe(204);

    expect(queue.sent).toMatchObject([{ message_id: MESSAGE }]);
    expect(
      await env.DB.prepare("SELECT state, attempts, queued_at FROM outbound_messages WHERE id = ?1")
        .bind(MESSAGE)
        .first(),
    ).toEqual({ state: "queued", attempts: 0, queued_at: NOW.toISOString() });
    expect((await list()).alerts).toEqual([]);

    const failing = fakeDependencies({
      messaging: {
        send: () => Promise.resolve({ ok: false, transient: false, detail: "HTTP 400" }),
        connection: () => Promise.resolve({ open: true }),
      },
    });
    await sendMessage(env.DB, LOCAL_CONFIG, failing, createLogger(), MESSAGE);

    expect(failing.alerts).toEqual([expect.stringContaining(`Message ${MESSAGE}`) as string]);
    expect((await list()).alerts).toMatchObject([{ kind: "message_failed", count: 1 }]);
  });

  it("sends a lead the CRM gave up on again, and a later sync that reaches the CRM leaves nothing open", async () => {
    const leadId = await phaseOneLead();
    await env.DB.prepare("UPDATE leads SET sync_attempts = ?2 WHERE id = ?1")
      .bind(leadId, MAX_SYNC_ATTEMPTS - 1)
      .run();
    await syncLead(env.DB, fakeDependencies({ crm: stubCrmThatFails("Zoho 503") }), createLogger(), leadId);
    const queue = fakeQueue();

    expect((await post(`/api/alerts/${await idOf("crm_lead")}/send-again`, { CRM_QUEUE: queue })).status).toBe(204);

    expect(queue.sent).toMatchObject([{ lead_id: leadId }]);
    expect(
      await env.DB.prepare("SELECT sync_attempts FROM leads WHERE id = ?1").bind(leadId).first("sync_attempts"),
    ).toBe(0);
    await syncLead(env.DB, fakeDependencies(), createLogger(), leadId);
    expect((await list()).alerts).toEqual([]);
  });

  it("refuses an alert with nothing to send again", async () => {
    await alertOnce({ key: `invoice_refused:${VISIT}`, message: "Books refused the invoice." });

    expect((await post(`/api/alerts/${await idOf("invoice_refused")}/send-again`)).status).toBe(400);
    expect((await list()).count).toBe(1);
  });
});
