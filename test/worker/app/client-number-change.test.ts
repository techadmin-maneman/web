// The client's profile and ops' side of it (docs/decisions/0042-client-profile.md),
// against the rules in src/policy/consents.ts and src/domain/clients/number-change.ts. Every
// number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { openSession } from "../../../src/domain/sign-in/sessions.ts";
import {
  appFor,
  fakeDependencies,
  fakeQueue,
  LOCAL_SETTINGS,
  markDatabase,
  NOW,
  request,
  type TestDependencies,
} from "../helpers.ts";
import { ORIGIN, OLD, NEW, servedPincode, auditActions } from "./client-profile-fixtures.ts";

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

/** What went out to the CRM about the person's contact details. */
const contactSyncs = () => queues.CRM_QUEUE.sent.filter((body) => "update_person_id" in (body as object));

const profile = async () => (await send(client, "GET", "/api/profile")).json<Record<string, unknown>>();

describe("a number change", () => {
  async function start() {
    const res = await send(client, "POST", "/api/number-change", { new_mobile: "98100 00003" });
    return { res, body: await res.json<{ request_id: string }>() };
  }
  const codeTo = (mobile: string) => deps.sentCodes.findLast((sent) => sent.to === mobile)?.code ?? "";
  const verify = (requestId: string, number: "old" | "new", code: string) =>
    send(client, "POST", "/api/number-change/verify", { request_id: requestId, number, code });

  it("sends a code to both the old number and the new", async () => {
    const { res } = await start();
    expect(res.status).toBe(202);
    expect(deps.sentCodes.map((sent) => sent.to)).toEqual([OLD, NEW]);
  });

  // Logins open, reminders fenced (ADR 0097): each side of a
  // number change is asked for by the phone holding it, so neither is held to staging's allowlist.
  it("sends both number-change codes off staging's allowlist", async () => {
    client = appFor(
      "local",
      deps,
      { messaging: { ...LOCAL_SETTINGS.messaging, allowlist: ["+919810000099"] } },
      "client",
    );
    const { res } = await start();
    expect(res.status).toBe(202);
    expect(deps.sentCodes.map((sent) => sent.to)).toEqual([OLD, NEW]);
  });

  // A record one of our own scripts made stays fenced, whatever the ruling above frees (isStagingTestRecord,
  // src/policy/staging-test-records.ts).
  it("holds back both number-change codes for a 'Staging test' record off the allowlist", async () => {
    const SCRIPT_OLD = "+919810000060";
    await env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name, contactable, test_record) VALUES ('p-script', ?1, ?2, 'Staging test', 1, 1)",
    )
      .bind(NOW.toISOString(), SCRIPT_OLD)
      .run();
    const scriptCookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: "p-script", deviceLabel: null, now: NOW })}`;
    client = appFor(
      "local",
      deps,
      { messaging: { ...LOCAL_SETTINGS.messaging, allowlist: ["+919810000099"] } },
      "client",
    );

    const res = await request(
      client,
      "/api/number-change",
      {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "application/json", Cookie: scriptCookie },
        body: JSON.stringify({ new_mobile: "98100 00003" }),
      },
      queues,
    );

    expect(res.status).toBe(202);
    expect(deps.sentCodes).toEqual([]);
  });

  it("waits for ops to confirm a change, and changes the number only then", async () => {
    const { body } = await start();
    expect(await (await verify(body.request_id, "old", codeTo(OLD))).json()).toMatchObject({
      state: "verifying",
      old_verified: true,
      new_verified: false,
      attempts_left: null,
    });
    expect(await (await verify(body.request_id, "new", codeTo(NEW))).json()).toMatchObject({ state: "awaiting_ops" });
    expect((await profile()).number_change).toEqual({
      request_id: body.request_id,
      state: "awaiting_ops",
      new_mobile: "+91 98xxx x0003",
      old_verified: true,
      new_verified: true,
    });
    const mobile = () => env.DB.prepare("SELECT mobile_e164 FROM people WHERE id = 'p1'").first<string>("mobile_e164");
    expect(await mobile()).toBe(OLD);

    const waiting = await (await send(ops, "GET", "/api/number-changes")).json<{ changes: unknown[] }>();
    expect(waiting.changes).toEqual([
      expect.objectContaining({
        person_id: "p1",
        name: "Rohit Malhotra",
        old_mobile: OLD,
        new_mobile: NEW,
        new_number_held_by: null,
      }),
    ]);
    const decided = await send(ops, "POST", `/api/number-changes/${body.request_id}/decision`, {
      decision: "confirm",
      reason: null,
    });
    expect(await decided.json()).toEqual({ state: "confirmed" });
    expect(await mobile()).toBe(NEW);
    // The new number reaches the CRM lead, and the old one is kept for the fraud rules.
    expect(contactSyncs()).toEqual([{ update_person_id: "p1", request_id: expect.any(String) as string }]);
    const replaced = await env.DB.prepare("SELECT replaced_mobile_e164 FROM number_change_requests").first();
    expect(replaced).toEqual({ replaced_mobile_e164: OLD });
    expect(await auditActions()).toEqual(["number_change.request", "number_change.decide"]);
    const staff = await env.DB.prepare("SELECT actor FROM audit_log WHERE action = 'number_change.decide'").first(
      "actor",
    );
    expect(staff).toBe("ops@localhost");
  });

  // A phone that went with the old number stayed signed in for 90 days.
  it("signs out every other session of the client once confirmed, and keeps the one that asked", async () => {
    const oldPhone = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: "p1", deviceLabel: null, now: NOW })}`;
    const meWith = (session: string) =>
      request(client, "/api/me", { headers: { Origin: ORIGIN, Cookie: session } }, queues);
    const { body } = await start();
    await verify(body.request_id, "old", codeTo(OLD));
    await verify(body.request_id, "new", codeTo(NEW));
    expect((await meWith(oldPhone)).status).toBe(200);

    await send(ops, "POST", `/api/number-changes/${body.request_id}/decision`, { decision: "confirm", reason: null });

    expect((await meWith(oldPhone)).status).toBe(401);
    expect((await meWith(cookie)).status).toBe(200);
  });

  it("answers a number taken between the check and the change as in use, and changes nothing", async () => {
    const { body } = await start();
    await verify(body.request_id, "old", codeTo(OLD));
    await verify(body.request_id, "new", codeTo(NEW));
    // Taken as the decision is made: the check before the batch saw no holder.
    await env.DB.prepare(
      `CREATE TRIGGER take_the_number AFTER UPDATE OF state ON number_change_requests WHEN NEW.state = 'confirmed'
       BEGIN INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('p2', NEW.decided_at, '${NEW}', 'Someone'); END`,
    ).run();

    const decided = await send(ops, "POST", `/api/number-changes/${body.request_id}/decision`, {
      decision: "confirm",
      reason: null,
    });
    await env.DB.prepare("DROP TRIGGER take_the_number").run();

    expect(decided.status).toBe(409);
    expect(await decided.json()).toMatchObject({ error: { code: "number_in_use" } });
    const person = await env.DB.prepare("SELECT mobile_e164 FROM people WHERE id = 'p1'").first<string>("mobile_e164");
    expect(person).toBe(OLD);
    const change = await env.DB.prepare("SELECT state FROM number_change_requests").first<string>("state");
    expect(change).toBe("awaiting_ops");
  });

  it("counts wrong codes as a login does, and a number change's code opens no login", async () => {
    const { body } = await start();
    const wrong = codeTo(OLD) === "000000" ? "111111" : "000000";
    expect(await (await verify(body.request_id, "old", wrong)).json()).toMatchObject({ attempts_left: 4 });

    const challenge = await env.DB.prepare(
      "SELECT id FROM otp_challenges WHERE purpose = 'number_change_old'",
    ).first<string>("id");
    const login = await send(client, "POST", "/api/auth/verify", { challenge_id: challenge, code: codeTo(OLD) });
    expect(login.status).toBe(410);
  });

  it("can be withdrawn by the client while it waits for ops, who then no longer see it", async () => {
    const { body } = await start();
    await verify(body.request_id, "old", codeTo(OLD));
    await verify(body.request_id, "new", codeTo(NEW));

    expect((await send(client, "DELETE", "/api/number-change")).status).toBe(204);
    expect((await profile()).number_change).toBeNull();
    expect(await (await send(ops, "GET", "/api/number-changes")).json()).toEqual({ changes: [] });
    expect(await auditActions()).toEqual(["number_change.request", "number_change.withdraw"]);
    // Withdrawing again finds nothing to withdraw, and records nothing.
    expect((await send(client, "DELETE", "/api/number-change")).status).toBe(204);
    expect(await auditActions()).toEqual(["number_change.request", "number_change.withdraw"]);
  });

  it("withdraws a change started earlier, whose codes then no longer count", async () => {
    const first = await start();
    const firstCode = codeTo(NEW);
    await start();
    expect((await verify(first.body.request_id, "new", firstCode)).status).toBe(410);
  });

  it("refuses the client's own number, and more than three changes a day", async () => {
    expect((await send(client, "POST", "/api/number-change", { new_mobile: "98100 00001" })).status).toBe(400);
    for (let i = 0; i < 3; i += 1) expect((await start()).res.status).toBe(202);
    expect((await start()).res.status).toBe(429);
  });

  it("cannot be confirmed onto a number another client holds", async () => {
    const { body } = await start();
    await verify(body.request_id, "old", codeTo(OLD));
    await verify(body.request_id, "new", codeTo(NEW));
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO people (id, created_at, mobile_e164, name, contactable) VALUES ('p2', ?1, ?2, 'Someone', 1)",
      ).bind(NOW.toISOString(), NEW),
      // A visit makes them a client.
      env.DB.prepare(
        `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, synced_at)
         VALUES ('v2', 'v2', 'p2', 'consultation', 'completed', ?1, ?1)`,
      ).bind(NOW.toISOString()),
    ]);
    const waiting = await (await send(ops, "GET", "/api/number-changes")).json<{ changes: unknown[] }>();
    expect(waiting.changes).toEqual([
      expect.objectContaining({ new_number_held_by: { name: "Someone", client: true } }),
    ]);
    const res = await send(ops, "POST", `/api/number-changes/${body.request_id}/decision`, {
      decision: "confirm",
      reason: null,
    });
    expect(res.status).toBe(409);
  });

  it("takes the number from a record that never became a client, which keeps its entry and is signed out", async () => {
    const { body } = await start();
    await verify(body.request_id, "old", codeTo(OLD));
    await verify(body.request_id, "new", codeTo(NEW));
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO people (id, created_at, mobile_e164, name, contactable) VALUES ('p2', ?1, ?2, 'Someone', 1)",
      ).bind(NOW.toISOString(), NEW),
      env.DB.prepare(
        `INSERT INTO waitlist_entries (id, pincode, person_id, contact_consent_at, created_at)
         VALUES ('wl-1', '400050', 'p2', ?1, ?1)`,
      ).bind(NOW.toISOString()),
    ]);
    const theirPhone = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: "p2", deviceLabel: null, now: NOW })}`;
    const waiting = await (await send(ops, "GET", "/api/number-changes")).json<{ changes: unknown[] }>();
    expect(waiting.changes).toEqual([
      expect.objectContaining({ new_number_held_by: { name: "Someone", client: false } }),
    ]);

    const res = await send(ops, "POST", `/api/number-changes/${body.request_id}/decision`, {
      decision: "confirm",
      reason: null,
    });

    expect(res.status).toBe(200);
    const numbers = await env.DB.prepare(
      "SELECT id, mobile_e164 FROM people WHERE id IN ('p1', 'p2') ORDER BY id",
    ).all();
    expect(numbers.results).toEqual([
      { id: "p1", mobile_e164: NEW },
      { id: "p2", mobile_e164: "released:p2" },
    ]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM waitlist_entries WHERE person_id = 'p2'").first("n")).toBe(
      1,
    );
    const theirs = await request(client, "/api/me", { headers: { Origin: ORIGIN, Cookie: theirPhone } }, queues);
    expect(theirs.status).toBe(401);
    const detail = await env.DB.prepare(
      "SELECT detail FROM audit_log WHERE subject_id = ?1 AND detail LIKE '%released_from%'",
    )
      .bind(body.request_id)
      .first<string>("detail");
    expect(JSON.parse(detail ?? "{}")).toMatchObject({ decision: "confirm", released_from: "p2" });
  });

  it("needs a reason to be rejected", async () => {
    const { body } = await start();
    await verify(body.request_id, "old", codeTo(OLD));
    await verify(body.request_id, "new", codeTo(NEW));
    const path = `/api/number-changes/${body.request_id}/decision`;
    expect((await send(ops, "POST", path, { decision: "reject", reason: null })).status).toBe(400);
    expect(
      await (await send(ops, "POST", path, { decision: "reject", reason: "Not the client's voice" })).json(),
    ).toEqual({
      state: "rejected",
    });
    // A change rejected, like one withdrawn, never happened: nothing goes out and no number is kept.
    expect(contactSyncs()).toEqual([]);
    const replaced = await env.DB.prepare("SELECT replaced_mobile_e164 FROM number_change_requests").first();
    expect(replaced).toEqual({ replaced_mobile_e164: null });
  });

  // A rejected change vanished from the app, and its reason stayed in ops.
  describe("once ops have decided it", () => {
    async function decided(decision: "confirm" | "reject", reason: string | null) {
      const { body } = await start();
      await verify(body.request_id, "old", codeTo(OLD));
      await verify(body.request_id, "new", codeTo(NEW));
      await send(ops, "POST", `/api/number-changes/${body.request_id}/decision`, { decision, reason });
    }
    const profileAt = async (at: Date) => {
      const later = appFor("local", fakeDependencies({ now: () => at }), {}, "client");
      return (await request(later, "/api/profile", { headers: { Cookie: cookie } })).json<Record<string, unknown>>();
    };

    it("shows the client a rejection, and the reason ops gave them", async () => {
      await decided("reject", "The new number did not answer our call");

      const shown = await profile();
      expect(shown.number_change).toBeNull();
      expect(shown.number_change_decided).toEqual({
        state: "rejected",
        new_mobile: "+91 98xxx x0003",
        decided_at: NOW.toISOString(),
        reason: "The new number did not answer our call",
      });
    });

    it("shows a confirmation too, with no reason, for thirty days", async () => {
      await decided("confirm", null);

      expect((await profile()).number_change_decided).toEqual({
        state: "confirmed",
        new_mobile: "+91 98xxx x0003",
        decided_at: NOW.toISOString(),
        reason: null,
      });
      const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
      expect((await profileAt(days(29))).number_change_decided).not.toBeNull();
      expect((await profileAt(days(31))).number_change_decided).toBeNull();
    });

    it("gives way to a new change under way", async () => {
      await decided("reject", "The new number did not answer our call");
      await start();

      const shown = await profile();
      expect(shown.number_change).not.toBeNull();
      expect(shown.number_change_decided).toBeNull();
    });
  });
});
