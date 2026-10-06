import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { alertAgedDeletions, DELETION_ALERT_AFTER_MS, deletionsWaiting } from "../../../src/domain/privacy/deletion.ts";
import { erasePerson } from "../../../src/domain/privacy/erasure.ts";
import { secretsMatch } from "../../../src/lib/hash.ts";
import { createLogger } from "../../../src/log.ts";
import type { PlacesReached } from "../../../src/policy/access.ts";
import { STUB_IDENTITY } from "../../../src/providers/cloudflare-access.ts";
import { appFor, captureLogs, fakeDependencies, fakeQueue, markDatabase, NOW, request } from "../helpers.ts";
import { insertJob, syntheticJpeg } from "../tryon-fixtures.ts";
import {
  book,
  bookedVisit,
  clientWithEverything,
  databaseRefusesErasure,
  erase,
  filesLeft,
  fittedVisitUnpaid,
  personWithHistory,
  statusOf,
} from "./erasure-fixtures.ts";

const STAFF = STUB_IDENTITY.kind === "staff" ? STUB_IDENTITY.email : "";

const EVERYWHERE: PlacesReached = { kind: "everywhere" };

let logs: ReturnType<typeof captureLogs>;

beforeEach(async () => {
  await markDatabase();
  logs = captureLogs();
});

describe("POST /api/clients/:id/erasure", () => {
  it("deletes the photos and results, blanks the person, cancels unsent messages and queues the CRM", async () => {
    const personId = await personWithHistory();
    const queues = { CRM_QUEUE: fakeQueue() };

    const response = await erase(personId, { queues });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      erased_at: NOW.toISOString(),
      photos_deleted: 2,
      results_deleted: 1,
      visit_photos_deleted: 0,
      messages_cancelled: 2,
      sessions_ended: 0,
      addresses_removed: 0,
    });
    const queued = [{ erase_person_id: personId, request_id: expect.any(String) as string }];
    expect(queues.CRM_QUEUE.sent).toEqual(queued);

    expect(await env.UPLOADS.head("uploads/ready")).toBeNull();
    expect(await env.UPLOADS.head("uploads/running")).toBeNull();
    expect(await env.RESULTS.head("results/ready.png")).toBeNull();

    expect(await env.DB.prepare("SELECT * FROM people WHERE id = ?").bind(personId).first()).toMatchObject({
      name: "Erased",
      email: null,
      mobile_e164: `erased:${personId}`,
      contactable: 0,
      erased_at: NOW.toISOString(),
    });
    const jobs = await env.DB.prepare(
      "SELECT id, state, result_key, upload_deleted_at FROM tryon_jobs WHERE person_id = ? ORDER BY id",
    )
      .bind(personId)
      .all();
    expect(jobs.results).toEqual([
      { id: "failed", state: "failed", result_key: null, upload_deleted_at: NOW.toISOString() },
      { id: "ready", state: "expired", result_key: null, upload_deleted_at: NOW.toISOString() },
      { id: "running", state: "expired", result_key: null, upload_deleted_at: NOW.toISOString() },
    ]);

    const messages = await env.DB.prepare("SELECT id, state FROM outbound_messages ORDER BY id").all();
    expect(messages.results).toEqual([
      { id: "message-queued", state: "skipped" },
      { id: "message-sent", state: "sent" },
      { id: "message-waiting", state: "skipped" },
    ]);
    const sessions = await env.DB.prepare("SELECT COUNT(*) AS n FROM tryon_sessions WHERE person_id = ?")
      .bind(personId)
      .first<{ n: number }>();
    expect(sessions?.n).toBe(0);

    const withdrawals = await env.DB.prepare(
      "SELECT purpose, source FROM consents WHERE person_id = ? AND notice_version = 'withdrawal' AND granted = 0 ORDER BY purpose",
    )
      .bind(personId)
      .all();
    expect(withdrawals.results).toEqual([
      { purpose: "contact", source: "erasure" },
      { purpose: "result_delivery", source: "erasure" },
    ]);
    const event = await env.DB.prepare(
      "SELECT payload_json FROM events WHERE name = 'person_erased' AND subject_id = ?",
    )
      .bind(personId)
      .first<{ payload_json: string }>();
    expect(JSON.parse(event?.payload_json ?? "{}")).toEqual({ photos: 2, results: 1 });
  });

  it("never writes the person's name, number or e-mail to the logs", async () => {
    const personId = await personWithHistory();
    await erase(personId);
    const written = JSON.stringify(logs.lines());
    expect(written).toContain("person_erased");
    for (const secret of ["Arjun", "9810000001", "arjun@example.com"]) expect(written).not.toContain(secret);
  });

  // The operators' door took one shared secret and left nothing in the audit log.
  it("audits the erasure under the member of staff who did it", async () => {
    const personId = await book();

    expect(await statusOf(personId)).toBe(200);

    const entries = await env.DB.prepare(
      "SELECT actor_kind, actor, subject_kind, subject_id, detail FROM audit_log WHERE action = 'person.erase'",
    ).all();
    expect(entries.results).toEqual([
      {
        actor_kind: "staff",
        actor: STAFF,
        subject_kind: "person",
        subject_id: personId,
        detail: JSON.stringify({ settled_by_hand: false, visits: 0, bookings: 0, payments: 0, links: 0 }),
      },
    ]);
  });

  it("refuses a service token, which names no member of staff, and erases nothing", async () => {
    const personId = await book();
    const deps = fakeDependencies({
      access: { verify: () => Promise.resolve({ ok: true, identity: { kind: "service", clientId: "ci.access" } }) },
    });

    expect(await statusOf(personId, { deps })).toBe(403);

    const person = await env.DB.prepare("SELECT erased_at FROM people WHERE id = ?1").bind(personId).first();
    expect(person).toEqual({ erased_at: null });
  });

  it("is not on the public host, where a shared secret once opened it", async () => {
    const personId = await book();
    const byNumber = await request(appFor(), "/api/erasure", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer a-secret-of-at-least-thirty-two-chars" },
      body: JSON.stringify({ mobile: "98100 00001" }),
    });

    expect(byNumber.status).toBe(404);
    expect(await statusOf(personId, { surface: "public" })).toBe(404);
    const person = await env.DB.prepare("SELECT erased_at FROM people WHERE id = ?1").bind(personId).first();
    expect(person).toEqual({ erased_at: null });
  });

  it("answers 404 for someone it does not know, and for someone already erased", async () => {
    expect(await statusOf(crypto.randomUUID())).toBe(404);
    const personId = await book();
    expect(await statusOf(personId)).toBe(200);
    expect(await statusOf(personId)).toBe(404);
  });

  it("lets the number book again afterwards, as a new person needing a new consent", async () => {
    const erased = await book();
    await erase(erased);
    const again = await book();
    expect(again).not.toBe(erased);
    const consents = await env.DB.prepare("SELECT COUNT(*) AS n FROM consents WHERE person_id = ?")
      .bind(again)
      .first<{ n: number }>();
    expect(consents?.n).toBe(1);
  });

  it("refuses a body with anything but whether to erase despite what is owed", async () => {
    const personId = await book();
    expect(await statusOf(personId, { body: { mobile: "98100 00001" } })).toBe(400);
  });

  it("still erases when the queue is down, leaving the CRM to the sweeper", async () => {
    const personId = await book();
    const down = { send: () => Promise.reject(new Error("queue unavailable")) } as unknown as Queue;

    expect(await statusOf(personId, { queues: { CRM_QUEUE: down } })).toBe(200);

    expect(logs.lines().some((line) => line.event === "erasure_enqueue_failed")).toBe(true);
  });
});

/** A deletion request the client made in their app, six days ago, still waiting for ops. */
/** A request a day past the point ops are alerted to it. */
async function openRequest(personId: string): Promise<void> {
  const aged = new Date(NOW.getTime() - DELETION_ALERT_AFTER_MS - 86_400_000).toISOString();
  await env.DB.prepare(
    "INSERT INTO deletion_requests (id, person_id, created_at, state) VALUES ('request-1', ?1, ?2, 'requested')",
  )
    .bind(personId, aged)
    .run();
}

const alertsNow = () => alertAgedDeletions(env.DB, NOW, fakeDependencies().alertOnce);

// The operators' door left the client's own request listed as waiting, and alerting.
describe("a client erased with a deletion request open", () => {
  it("has the request closed by the erasure, under whoever erased them", async () => {
    const personId = await book();
    await openRequest(personId);

    expect(await statusOf(personId)).toBe(200);

    const closed = await env.DB.prepare("SELECT state, decided_at, decided_by FROM deletion_requests").first();
    expect(closed).toEqual({ state: "done", decided_at: NOW.toISOString(), decided_by: STAFF });
    expect(await deletionsWaiting(env.DB, EVERYWHERE)).toEqual([]);
    expect(await alertsNow()).toBe(0);
  });

  it("closes the request's alert on Tasks with it", async () => {
    const personId = await book();
    await openRequest(personId);
    expect(await alertsNow()).toBe(1);

    expect(await statusOf(personId)).toBe(200);

    const open = await env.DB.prepare(
      "SELECT key FROM alerts WHERE resolved_at IS NULL AND key LIKE 'deletion_waiting:%'",
    ).all();
    expect(open.results).toEqual([]);
  });

  it("is left out of the queue and its alert when an earlier erasure left the request open", async () => {
    const personId = await book();
    await openRequest(personId);
    await erasePerson({ env, personId, now: NOW, log: createLogger() });

    expect(await deletionsWaiting(env.DB, EVERYWHERE)).toEqual([]);
    expect(await alertsNow()).toBe(0);
  });
});

// An erased client's open grievance stayed in Grievances for good, with
// an answer box for nobody, and the alerts about them kept linking to their page.
describe("what an erasure leaves open for ops", () => {
  const EARLIER = "2026-09-01T06:00:00.000Z";

  it("closes their open grievance under whoever erased them, and blanks the answer to one closed before", async () => {
    const personId = await book();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO grievances (id, person_id, text, state, created_at) VALUES ('g-open', ?1, 'Please call first.', 'open', ?2)",
      ).bind(personId, EARLIER),
      env.DB.prepare(
        `INSERT INTO grievances (id, person_id, text, state, response, resolved_by, resolved_at, created_at)
         VALUES ('g-answered', ?1, 'Stop the calls.', 'resolved', 'We have stopped them.', 'priya@maneman.in', ?2, ?2)`,
      ).bind(personId, EARLIER),
    ]);

    expect(await statusOf(personId)).toBe(200);

    const { results } = await env.DB.prepare(
      "SELECT id, text, state, response, resolved_by, resolved_at FROM grievances ORDER BY id",
    ).all();
    expect(results).toEqual([
      {
        id: "g-answered",
        text: "Erased",
        state: "resolved",
        response: null,
        resolved_by: "priya@maneman.in",
        resolved_at: EARLIER,
      },
      {
        id: "g-open",
        text: "Erased",
        state: "resolved",
        response: "Client erased",
        resolved_by: STAFF,
        resolved_at: NOW.toISOString(),
      },
    ]);
  });

  it("resolves the Customer Care alerts that link to their page, and keeps those about a visit, a booking or money", async () => {
    const personId = await book();
    const other = crypto.randomUUID();
    const alerts: [key: string, link: string | null][] = [
      ["message_failed:m-1", `/clients/${personId}`],
      [`crm_contact_update:${personId}`, `/clients/${personId}`],
      // A client who paid and has no visit or refund: the erasure lets the booking go, and the money stays owed.
      ["booking_held:hold-1", `/clients/${personId}/visits`],
      ["unbooked_hold:hold-2", `/clients/${personId}`],
      ["hair_profile_from_older:v1", `/clients/${personId}/pieces`],
      ["books_refund_refused:refund-1", `/clients/${personId}/payments`],
      ["message_failed:someone-else", `/clients/${other}`],
      ["message_failed:someone-like-them", `/clients/${personId}0`],
      ["message_failed:no-link", null],
    ];
    await env.DB.batch(
      alerts.map(([key, link]) =>
        env.DB.prepare(
          `INSERT INTO alerts (id, key, message, link, count, first_seen_at, last_seen_at)
           VALUES (?1, ?2, 'An alert.', ?3, 1, ?4, ?4)`,
        ).bind(crypto.randomUUID(), key, link, EARLIER),
      ),
    );

    expect(await statusOf(personId)).toBe(200);

    const { results } = await env.DB.prepare("SELECT key FROM alerts WHERE resolved_at IS NULL ORDER BY key").all();
    expect(results.map((row) => row.key)).toEqual([
      "booking_held:hold-1",
      "books_refund_refused:refund-1",
      "hair_profile_from_older:v1",
      "message_failed:no-link",
      "message_failed:someone-else",
      "message_failed:someone-like-them",
      "unbooked_hold:hold-2",
    ]);
  });
});

describe("erasePerson", () => {
  it("deletes a result a running render stored after the jobs were read", async () => {
    const personId = await book();
    await insertJob({ id: "late", person_id: personId, state: "downloading" });
    await env.RESULTS.put("results/late.jpg", syntheticJpeg(512, 512));

    const summary = await erasePerson({ env, personId, now: NOW, log: createLogger() });

    expect(summary?.resultsDeleted).toBe(0); // it had no result_key when read
    expect(await env.RESULTS.head("results/late.jpg")).toBeNull();
  });
});

describe("ops deciding a deletion", () => {
  const ops = () => appFor("local", fakeDependencies(), {}, "ops");

  async function requested(personId: string): Promise<string> {
    await env.DB.prepare(
      "INSERT INTO deletion_requests (id, person_id, created_at, state) VALUES ('7c9e6679-7425-40de-944b-e07fc1f90ae7', ?1, ?2, 'requested')",
    )
      .bind(personId, NOW.toISOString())
      .run();
    return "7c9e6679-7425-40de-944b-e07fc1f90ae7";
  }

  function decide(id: string, decision: "delete" | "reject", reason: string | null = null) {
    return request(
      ops(),
      `/api/deletion-requests/${id}/decision`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
        body: JSON.stringify({ decision, reason }),
      },
      { CRM_QUEUE: fakeQueue() },
    );
  }

  const decisions = async () =>
    (await env.DB.prepare("SELECT action, detail FROM audit_log WHERE action = 'deletion.decide'").all()).results;

  it("audits the decision with the erasure, so a refused erasure leaves no entry and the request waiting", async () => {
    const id = await requested(await clientWithEverything());
    await databaseRefusesErasure();

    expect((await decide(id, "delete")).status).toBe(500);

    expect(await decisions()).toEqual([]);
    expect(await env.DB.prepare("SELECT state FROM deletion_requests").first("state")).toBe("requested");
    expect(await filesLeft()).toEqual({ upload: true, result: true, visitPhoto: true, card: true });
  });

  it("records one decision when the erasure is done", async () => {
    const id = await requested(await clientWithEverything());

    expect(await (await decide(id, "delete")).json()).toEqual({ state: "done" });

    expect(await decisions()).toEqual([{ action: "deletion.decide", detail: JSON.stringify({ decision: "delete" }) }]);
    expect(await env.DB.prepare("SELECT state FROM deletion_requests").first("state")).toBe("done");
  });

  it("refuses to delete while a visit is booked, names it, and leaves the request waiting", async () => {
    const personId = await book();
    await bookedVisit(personId);
    const id = await requested(personId);

    const response = await decide(id, "delete");

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "visit_booked" },
      visits: [{ id: "visit-live", type: "service" }],
    });
    expect(await decisions()).toEqual([]);
    expect(await env.DB.prepare("SELECT state FROM deletion_requests").first("state")).toBe("requested");
  });

  it("refuses to delete while a payment link is unpaid, names it, and leaves the request waiting", async () => {
    const personId = await book();
    await fittedVisitUnpaid(personId);
    const id = await requested(personId);

    const response = await decide(id, "delete");

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "payment_owed" }, links: [{ id: "link-1" }] });
    expect(await env.DB.prepare("SELECT state FROM deletion_requests").first("state")).toBe("requested");
  });

  it("still lets ops reject a request while a visit is booked", async () => {
    const personId = await book();
    await bookedVisit(personId);
    const id = await requested(personId);

    expect(await (await decide(id, "reject", "Not the number's owner")).json()).toEqual({ state: "rejected" });
    expect(await decisions()).toEqual([{ action: "deletion.decide", detail: JSON.stringify({ decision: "reject" }) }]);
  });
});

describe("secretsMatch", () => {
  it("matches only the same secret, and never an unset one", async () => {
    expect(await secretsMatch("a-secret", "a-secret")).toBe(true);
    expect(await secretsMatch("a-secret", "a-secreT")).toBe(false);
    expect(await secretsMatch("a-secret-but-longer", "a-secret")).toBe(false);
    expect(await secretsMatch("", "")).toBe(false);
  });
});
