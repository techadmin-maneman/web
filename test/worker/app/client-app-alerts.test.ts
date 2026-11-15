// The client's alerts in their app (docs/decisions/0255-client-alerts-and-push.md): one beside each message written to
// them, whatever wrote it, once; one each time a technician asks for their sign-off; none for a technician swap; and
// the push that tells their app, to sessions still signed in. NOW is Monday 21 September 2026, 12 noon in India. Every
// name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { askSignOff } from "../../../src/domain/field/sign-offs.ts";
import { pushNewClientAlerts } from "../../../src/domain/clients/app-alerts.ts";
import { visitMessage } from "../../../src/domain/messages/visit-messages.ts";
import { revokeSession } from "../../../src/domain/sign-in/sessions.ts";
import type { App } from "../../../src/http/context.ts";
import { createCallBudget } from "../../../src/lib/call-budget.ts";
import { createLogger } from "../../../src/log.ts";
import { deleteExpiredRecords } from "../../../src/scheduled/sweeper.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import { IMRAN, SANA, SANDEEP, client, technician, visit } from "../booking/client-booking-fixtures.ts";
import { OPTIONS, sweepEnv } from "../jobs/sweeper-fixtures.ts";

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123";

let app: App;

beforeEach(async () => {
  await markDatabase();
  app = appFor("local", fakeDependencies(), {}, "client");
  await technician(IMRAN, "Imran Qureshi", "IQ");
  await technician(SANA, "Sana Mirza", "SM");
  await technician(SANDEEP, "Sandeep Rawat", "SR");
});

type Alert = { kind: string; visit_id: string | null; update: unknown; read: boolean };

const inbox = async (who: { cookie: string }) =>
  (await (await request(app, "/api/me/alerts", { headers: { Cookie: who.cookie } })).json<{ alerts: Alert[] }>())
    .alerts;

const post = (who: { cookie: string }, path: string, body?: object) =>
  request(app, path, {
    method: "POST",
    headers: { Cookie: who.cookie, "Content-Type": "application/json", Origin: "https://maneman.test" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** A message as the Worker writes one, in `state`. */
const message = (personId: string, kind: string, subjectId: string, state = "queued") =>
  env.DB.prepare(
    `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_kind, subject_id, state, queued_at)
     VALUES (?1, ?2, ?3, ?4, 'appointment', ?5, ?6, ?2)`,
  )
    .bind(crypto.randomUUID(), NOW.toISOString(), personId, kind, subjectId, state)
    .run();

const TOMORROW = "2026-09-22T04:30:00.000Z";

describe("an alert in the client's app", () => {
  it("stands beside each message written to them, once each, whether or not WhatsApp sends it", async () => {
    const rohit = await client();
    const booked = await visit(rohit.id, "service", "scheduled", TOMORROW, IMRAN);
    const reminder = visitMessage(env.DB, {
      personId: rohit.id,
      appointmentId: booked,
      kind: "visit_reminder",
      now: NOW,
    });
    await reminder.statement.run();
    await message(rohit.id, "visit_moved", booked);
    expect(await inbox(rohit)).toEqual([
      expect.objectContaining({ kind: "visit_moved", visit_id: booked, read: false }),
      expect.objectContaining({ kind: "visit_reminder", visit_id: booked, read: false }),
    ]);
  });

  it("is not written beside a message that is WhatsApp's alone, nor a technician's word heard too late", async () => {
    const rohit = await client();
    const booked = await visit(rohit.id, "service", "scheduled", TOMORROW, IMRAN);
    await message(rohit.id, "book_in_app", booked);
    await message(rohit.id, "messages_stopped", booked);
    await message(rohit.id, "arrival_notice", booked, "skipped");
    expect(await inbox(rohit)).toEqual([]);
  });

  it("is written each time a technician asks for the client's sign-off, and not again for the same ask", async () => {
    const rohit = await client();
    const fit = await visit(rohit.id, "replacement", "in_progress", "2026-09-21T05:30:00.000Z", IMRAN);
    const ask = (eventId: string) => askSignOff(env.DB, { appointmentId: fit, technicianId: IMRAN, eventId, now: NOW });
    await ask("event-ask-01");
    await ask("event-ask-01");
    expect((await inbox(rohit)).map((alert) => alert.kind)).toEqual(["sign_off_asked"]);

    await env.DB.prepare("UPDATE fit_sign_offs SET state = 'flagged', flag_text = 'The left edge lifts'").run();
    await ask("event-ask-02");
    expect((await inbox(rohit)).map((alert) => [alert.kind, alert.visit_id])).toEqual([
      ["sign_off_asked", fit],
      ["sign_off_asked", fit],
    ]);
  });

  it("is not written when the visit is given to another technician", async () => {
    const rohit = await client();
    const booked = await visit(rohit.id, "service", "scheduled", TOMORROW, IMRAN);
    await env.DB.prepare("UPDATE appointments SET technician_id = ?2 WHERE id = ?1").bind(booked, SANDEEP).run();
    expect(await inbox(rohit)).toEqual([]);
  });

  it("is read once the client opens the inbox, and never shows another client's", async () => {
    const rohit = await client();
    const priya = await client();
    const booked = await visit(rohit.id, "service", "scheduled", TOMORROW, IMRAN);
    await message(rohit.id, "visit_reminder", booked);
    expect(await inbox(priya)).toEqual([]);
    expect((await post(rohit, "/api/me/alerts/read")).status).toBe(204);
    expect(await inbox(rohit)).toEqual([expect.objectContaining({ kind: "visit_reminder", read: true })]);
  });
});

describe("the push that tells the client's app", () => {
  async function subscribed() {
    const rohit = await client();
    expect((await post(rohit, "/api/me/push-subscriptions", { endpoint: ENDPOINT })).status).toBe(201);
    const booked = await visit(rohit.id, "service", "scheduled", TOMORROW, IMRAN);
    return { rohit, booked };
  }

  const pushes = async () => {
    const sent: string[] = [];
    const push = (endpoint: string) => {
      sent.push(endpoint);
      return Promise.resolve("sent" as const);
    };
    await pushNewClientAlerts(env.DB, { push, budget: createCallBudget(50), now: NOW });
    return sent;
  };

  it("goes once for each alert, to the session that takes it", async () => {
    const { rohit, booked } = await subscribed();
    await message(rohit.id, "visit_reminder", booked);
    expect(await pushes()).toEqual([ENDPOINT]);
    expect(await pushes()).toEqual([]);
  });

  it("takes only a browser's push service as where to push", async () => {
    const rohit = await client();
    const answer = await post(rohit, "/api/me/push-subscriptions", { endpoint: "https://example.com/push" });
    expect(answer.status).toBe(400);
  });

  it("stops with the session: one signed out or revoked loses its subscription", async () => {
    const { rohit, booked } = await subscribed();
    const session = await env.DB.prepare("SELECT session_id FROM client_push_subscriptions").first<{
      session_id: string;
    }>();
    await revokeSession(env.DB, session?.session_id ?? "", NOW);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM client_push_subscriptions").first()).toEqual({ n: 0 });
    await message(rohit.id, "visit_reminder", booked);
    expect(await pushes()).toEqual([]);
  });

  it("pushes nothing to a session revoked elsewhere, which the sweeper then lets go of before the session", async () => {
    const { rohit, booked } = await subscribed();
    // Revoked from the devices list, or by ops: no sign-out of its own.
    await env.DB.prepare("UPDATE sessions SET revoked_at = ?1").bind(NOW.toISOString()).run();
    await message(rohit.id, "visit_reminder", booked);
    expect(await pushes()).toEqual([]);
    await deleteExpiredRecords({ env: sweepEnv().bindings, deps: fakeDependencies(), log: createLogger(), ...OPTIONS });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM client_push_subscriptions").first()).toEqual({ n: 0 });
  });
});
