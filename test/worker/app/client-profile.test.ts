// The client's profile and ops' side of it (docs/decisions/0042-client-profile.md),
// against the rules in src/policy/consents.ts and src/domain/clients/number-change.ts. Every
// number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { openSession } from "../../../src/domain/sign-in/sessions.ts";
import { createLogger } from "../../../src/log.ts";
import type { MessagingProvider, OutboundMessage, SendResult } from "../../../src/providers/messaging/index.ts";
import { sendMessage } from "../../../src/queues/messaging.ts";
import {
  appFor,
  captureLogs,
  fakeDependencies,
  fakeQueue,
  LOCAL_CONFIG,
  LOCAL_SETTINGS,
  markDatabase,
  NOW,
  request,
  type TestDependencies,
} from "../helpers.ts";
import { ORIGIN, OLD, NEW, servedPincode, auditActions } from "./client-profile-fixtures.ts";

const log = createLogger();

let deps: TestDependencies;

let client: App;

let ops: App;

let cookie: string;

beforeEach(async () => {
  deps = fakeDependencies();
  client = appFor("local", deps, {}, "client");
  ops = appFor("local", deps, {}, "ops"); // the stub Access verifier: every call is ops@localhost
  await markDatabase();
  await env.DB.prepare(
    "INSERT INTO people (id, created_at, mobile_e164, name, contactable) VALUES ('p1', ?1, ?2, 'Rohit Malhotra', 1)",
  )
    .bind(NOW.toISOString(), OLD)
    .run();
  await servedPincode("122018", "Gurgaon");
  cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: "p1", deviceLabel: null, now: NOW })}`;
});

/** The queues a change of number or address goes out on, to the CRM lead, and messages go on. */
let queues: {
  CRM_QUEUE: ReturnType<typeof fakeQueue>;
  MESSAGE_QUEUE: ReturnType<typeof fakeQueue>;
};

beforeEach(() => {
  queues = { CRM_QUEUE: fakeQueue(), MESSAGE_QUEUE: fakeQueue() };
});

function send(app: App, method: string, path: string, body?: unknown) {
  return request(
    app,
    path,
    {
      method,
      headers: { Origin: ORIGIN, "Content-Type": "application/json", Cookie: cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    queues,
  );
}

const profile = async () => (await send(client, "GET", "/api/profile")).json<Record<string, unknown>>();

describe("GET /api/profile", () => {
  it("shows the name, the number masked, and the five consents off until switched", async () => {
    expect(await profile()).toEqual({
      name: "Rohit Malhotra",
      mobile: "+91 98xxx x0001",
      address: null,
      address_given_to_ops: null,
      consents: [
        { purpose: "photos_own_record", granted: false, since: null },
        { purpose: "photos_referral_cards", granted: false, since: null },
        { purpose: "photos_marketing", granted: false, since: null },
        { purpose: "whatsapp_visits", granted: false, since: null },
        { purpose: "whatsapp_launches", granted: false, since: null },
      ],
      number_change: null,
      number_change_decided: null,
      deletion: null,
      deletion_rejected: null,
      grievances: [],
    });
  });

  it("needs a session, like every profile route", async () => {
    cookie = "mm_app=made-up";
    for (const [method, path] of [
      ["GET", "/api/profile"],
      ["PATCH", "/api/profile/address"],
      ["PATCH", "/api/consents/photos_marketing"],
      ["POST", "/api/number-change"],
      ["POST", "/api/deletion-request"],
    ] as const) {
      const body = method === "GET" ? undefined : {};
      expect((await send(client, method, path, body)).status, `${method} ${path}`).toBe(401);
    }
  });
});

describe("a deletion request", () => {
  it("is made once however often it is asked, and waits for ops", async () => {
    expect((await send(client, "POST", "/api/deletion-request")).status).toBe(202);
    expect((await send(client, "POST", "/api/deletion-request")).status).toBe(202);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM deletion_requests").first("n")).toBe(1);
    expect((await profile()).deletion).toEqual({ state: "requested", requested_at: NOW.toISOString() });
    expect(await auditActions()).toEqual(["deletion.request"]);
  });

  /** A messaging provider that keeps what it was asked to send, and answers as told. */
  function recordingWhatsApp(answer: SendResult = { ok: true, providerMessageId: "wa-1" }) {
    const sent: OutboundMessage[] = [];
    const provider: MessagingProvider = {
      send: (message) => {
        sent.push(message);
        return Promise.resolve(answer);
      },
      connection: () => Promise.resolve({ open: true }),
    };
    return { provider, sent };
  }

  /** An ops console whose WhatsApp is `provider`, with staging's allowlist set to `allowlist`. */
  const opsWith = (provider: MessagingProvider, allowlist: readonly string[] = []) =>
    appFor(
      "local",
      fakeDependencies({ messaging: provider }),
      { messaging: { ...LOCAL_SETTINGS.messaging, allowlist } },
      "ops",
    );

  /** The client asks to be deleted, and ops decide it. */
  async function decided(decision: "delete" | "reject", reason: string | null, opsApp: App = ops) {
    await send(client, "POST", "/api/deletion-request");
    const { requests } = await (
      await send(opsApp, "GET", "/api/deletion-requests")
    ).json<{ requests: { id: string }[] }>();
    return send(opsApp, "POST", `/api/deletion-requests/${requests[0]?.id ?? ""}/decision`, { decision, reason });
  }

  it("erases the person when ops delete, audited in the same batch as the erasure", async () => {
    const res = await decided("delete", null);

    expect(await res.json()).toEqual({ state: "done" });
    const person = await env.DB.prepare("SELECT erased_at, name FROM people WHERE id = 'p1'").first();
    expect(person).toMatchObject({ name: "Erased" });
    expect((await send(client, "GET", "/api/profile")).status).toBe(401);
    expect(await auditActions()).toEqual(["deletion.request", "deletion.decide"]);
  });

  // The app promised a confirmation on WhatsApp, and nothing sent one.
  it("tells the client on WhatsApp that it is done, at the number the erasure has just blanked", async () => {
    const whatsapp = recordingWhatsApp();

    expect(await (await decided("delete", null, opsWith(whatsapp.provider))).json()).toEqual({ state: "done" });

    expect(whatsapp.sent).toEqual([{ to: OLD, template: "deletion_done_v1", params: ["Rohit"] }]);
    expect(await env.DB.prepare("SELECT mobile_e164 FROM people WHERE id = 'p1'").first("mobile_e164")).toBe(
      "erased:p1",
    );
  });

  it("holds the word that it is done back off staging's allowlist, as any message ops' action sends", async () => {
    const whatsapp = recordingWhatsApp();

    expect(await (await decided("delete", null, opsWith(whatsapp.provider, [NEW]))).json()).toEqual({
      state: "done",
    });

    expect(whatsapp.sent).toEqual([]);
  });

  it("still deletes when WhatsApp refuses the word that it is done, and logs the failure", async () => {
    const logs = captureLogs();
    const whatsapp = recordingWhatsApp({ ok: false, transient: true, detail: "status 503" });

    expect(await (await decided("delete", null, opsWith(whatsapp.provider))).json()).toEqual({ state: "done" });

    expect(logs.lines()).toContainEqual(expect.objectContaining({ event: "deletion_done_failed" }));
    expect(await env.DB.prepare("SELECT name FROM people WHERE id = 'p1'").first("name")).toBe("Erased");
  });

  // A rejected request went back to "Request deletion", with no outcome and no reason.
  it("tells the client why ops kept the account, on WhatsApp whatever they chose about visit messages", async () => {
    expect(await (await decided("reject", "You still have a consultation booked")).json()).toEqual({
      state: "rejected",
    });

    const queued = await env.DB.prepare("SELECT id, kind, subject_kind, state FROM outbound_messages").all();
    expect(queued.results).toEqual([
      { id: expect.any(String) as string, kind: "deletion_rejected", subject_kind: "deletion", state: "queued" },
    ]);
    const messageId = String(queued.results[0]?.id);
    expect(queues.MESSAGE_QUEUE.sent).toMatchObject([{ message_id: messageId }]);

    const whatsapp = recordingWhatsApp();
    await sendMessage({
      db: env.DB,
      config: LOCAL_CONFIG,
      deps: fakeDependencies({ messaging: whatsapp.provider }),
      log,
      messageId,
    });
    expect(whatsapp.sent).toEqual([
      { to: OLD, template: "deletion_rejected_v1", params: ["Rohit", "You still have a consultation booked."] },
    ]);
  });

  it("shows the client a rejection and its reason, until they ask again", async () => {
    await decided("reject", "You still have a consultation booked.");

    expect(await profile()).toMatchObject({
      deletion: null,
      deletion_rejected: { decided_at: NOW.toISOString(), reason: "You still have a consultation booked." },
    });

    await send(client, "POST", "/api/deletion-request");
    expect(await profile()).toMatchObject({ deletion: { state: "requested" }, deletion_rejected: null });
  });

  it("stops showing a rejection 30 days after it", async () => {
    const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare(
      `INSERT INTO deletion_requests (id, person_id, created_at, state, decided_at, decided_by, reason)
       VALUES ('d1', 'p1', ?1, 'rejected', ?1, 'ops@localhost', 'Not the number''s owner')`,
    )
      .bind(daysAgo(31))
      .run();
    expect((await profile()).deletion_rejected).toBeNull();

    await env.DB.prepare("UPDATE deletion_requests SET decided_at = ?1").bind(daysAgo(29)).run();
    expect((await profile()).deletion_rejected).toEqual({ decided_at: daysAgo(29), reason: "Not the number's owner" });
  });

  it("answers 404 for a request that is not waiting, and audits nothing", async () => {
    const res = await send(ops, "POST", "/api/deletion-requests/7c9e6679-7425-40de-944b-e07fc1f90ae7/decision", {
      decision: "delete",
      reason: null,
    });
    expect(res.status).toBe(404);
    expect(await auditActions()).toEqual([]);
  });
});
