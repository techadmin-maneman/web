// The client's profile and ops' side of it (docs/decisions/0042-client-profile.md),
// against the rules in src/policy/consents.ts and number-change.ts. Every
// number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.ts";
import { openSession } from "../../src/domain/sessions.ts";
import { RULES as CONSENT_RULES } from "../../src/policy/consents.ts";
import { RULES as NUMBER_CHANGE_RULES } from "../../src/policy/number-change.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request, type TestDependencies } from "./helpers.ts";

const ORIGIN = "https://maneman.test";
const OLD = "+919810000001";
const NEW = "+919810000003";

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
  cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: "p1", deviceLabel: null, now: NOW })}`;
});

function send(app: App, method: string, path: string, body?: unknown) {
  return request(app, path, {
    method,
    headers: { Origin: ORIGIN, "Content-Type": "application/json", Cookie: cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const profile = async () => (await send(client, "GET", "/api/profile")).json<Record<string, unknown>>();

async function auditActions(): Promise<string[]> {
  const rows = await env.DB.prepare("SELECT action FROM audit_log WHERE action != 'ops.call' ORDER BY id").all();
  return rows.results.map((row) => String(row.action));
}

describe("GET /api/profile", () => {
  it("shows the name, the number masked, and the five consents off until switched", async () => {
    expect(await profile()).toEqual({
      name: "Rohit Malhotra",
      mobile: "+91 98xxx x0001",
      address: null,
      consents: [
        { purpose: "photos_own_record", granted: false, since: null },
        { purpose: "photos_referral_cards", granted: false, since: null },
        { purpose: "photos_marketing", granted: false, since: null },
        { purpose: "whatsapp_visits", granted: false, since: null },
        { purpose: "whatsapp_launches", granted: false, since: null },
      ],
      number_change: null,
      deletion: null,
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

describe("PATCH /api/profile/address", () => {
  const address = {
    line1: "House 4417, Tower C",
    line2: null,
    locality: "Sector 65",
    city: "Gurgaon",
    pincode: "122018",
    access_notes: "Gate code 4417 · park in visitor bay B",
  };

  it("saves the address and its access notes, keeping the old one as replaced", async () => {
    expect((await send(client, "PATCH", "/api/profile/address", address)).status).toBe(200);
    expect((await send(client, "PATCH", "/api/profile/address", { ...address, line1: "House 12" })).status).toBe(200);

    expect((await profile()).address).toEqual({ ...address, line1: "House 12" });
    const rows = await env.DB.prepare(
      "SELECT line1, replaced_at IS NULL AS current FROM addresses ORDER BY created_at, rowid",
    ).all();
    expect(rows.results).toEqual([
      { line1: "House 4417, Tower C", current: 0 },
      { line1: "House 12", current: 1 },
    ]);
  });

  it("refuses a pincode that is not six digits", async () => {
    expect((await send(client, "PATCH", "/api/profile/address", { ...address, pincode: "12201" })).status).toBe(400);
  });
});

describe("PATCH /api/consents/:purpose", () => {
  it(CONSENT_RULES[0], async () => {
    const res = await send(client, "PATCH", "/api/consents/photos_referral_cards", { granted: true });
    expect(await res.json()).toEqual({ purpose: "photos_referral_cards", granted: true, since: NOW.toISOString() });
    await send(client, "PATCH", "/api/consents/photos_referral_cards", { granted: false });

    const consents = (await profile()).consents as { purpose: string; granted: boolean }[];
    expect(consents.find((consent) => consent.purpose === "photos_referral_cards")?.granted).toBe(false);
    // Each switch is its own row, with the notice version the client saw.
    const rows = await env.DB.prepare("SELECT granted, notice_version FROM consents ORDER BY created_at, rowid").all();
    expect(rows.results).toEqual([
      { granted: 1, notice_version: "photos-referral-cards-v1" },
      { granted: 0, notice_version: "photos-referral-cards-v1" },
    ]);
    expect(await auditActions()).toEqual(["consent.switch", "consent.switch"]);
  });

  it("switches only the five purposes, never a Phase 1 agreement", async () => {
    expect((await send(client, "PATCH", "/api/consents/contact", { granted: false })).status).toBe(400);
  });

  it("offers ops no way to grant one: there is no ops route that writes consents", async () => {
    expect((await send(ops, "PATCH", "/api/consents/photos_marketing", { granted: true })).status).toBe(404);
  });
});

describe("a number change", () => {
  async function start() {
    const res = await send(client, "POST", "/api/number-change", { new_mobile: "98100 00003" });
    return { res, body: await res.json<{ request_id: string }>() };
  }
  const codeTo = (mobile: string) => deps.sentCodes.findLast((sent) => sent.to === mobile)?.code ?? "";
  const verify = (requestId: string, number: "old" | "new", code: string) =>
    send(client, "POST", "/api/number-change/verify", { request_id: requestId, number, code });

  it(NUMBER_CHANGE_RULES[0], async () => {
    const { res } = await start();
    expect(res.status).toBe(202);
    expect(deps.sentCodes.map((sent) => sent.to)).toEqual([OLD, NEW]);
  });

  it(NUMBER_CHANGE_RULES[1], async () => {
    const { body } = await start();
    expect(await (await verify(body.request_id, "old", codeTo(OLD))).json()).toMatchObject({
      state: "verifying",
      old_verified: true,
      new_verified: false,
      attempts_left: null,
    });
    expect(await (await verify(body.request_id, "new", codeTo(NEW))).json()).toMatchObject({ state: "awaiting_ops" });
    expect((await profile()).number_change).toEqual({
      state: "awaiting_ops",
      new_mobile: "+91 98xxx x0003",
      old_verified: true,
      new_verified: true,
    });
    const mobile = () => env.DB.prepare("SELECT mobile_e164 FROM people WHERE id = 'p1'").first<string>("mobile_e164");
    expect(await mobile()).toBe(OLD);

    const waiting = await (await send(ops, "GET", "/api/number-changes")).json<{ changes: unknown[] }>();
    expect(waiting.changes).toEqual([
      expect.objectContaining({ person_id: "p1", name: "Rohit Malhotra", old_mobile: OLD, new_mobile: NEW }),
    ]);
    const decided = await send(ops, "POST", `/api/number-changes/${body.request_id}/decision`, {
      decision: "confirm",
      reason: null,
    });
    expect(await decided.json()).toEqual({ state: "confirmed" });
    expect(await mobile()).toBe(NEW);
    expect(await auditActions()).toEqual(["number_change.request", "number_change.decide"]);
    const staff = await env.DB.prepare("SELECT actor FROM audit_log WHERE action = 'number_change.decide'").first(
      "actor",
    );
    expect(staff).toBe("ops@localhost");
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

  it("cannot be confirmed onto a number another person holds", async () => {
    const { body } = await start();
    await verify(body.request_id, "old", codeTo(OLD));
    await verify(body.request_id, "new", codeTo(NEW));
    await env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name, contactable) VALUES ('p2', ?1, ?2, 'Someone', 1)",
    )
      .bind(NOW.toISOString(), NEW)
      .run();
    const res = await send(ops, "POST", `/api/number-changes/${body.request_id}/decision`, {
      decision: "confirm",
      reason: null,
    });
    expect(res.status).toBe(409);
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

  it("erases the person when ops delete, audited before the erasure", async () => {
    await send(client, "POST", "/api/deletion-request");
    const { requests } = await (
      await send(ops, "GET", "/api/deletion-requests")
    ).json<{ requests: { id: string }[] }>();
    const res = await send(ops, "POST", `/api/deletion-requests/${requests[0]?.id ?? ""}/decision`, {
      decision: "delete",
      reason: null,
    });

    expect(await res.json()).toEqual({ state: "done" });
    const person = await env.DB.prepare("SELECT erased_at, name FROM people WHERE id = 'p1'").first();
    expect(person).toMatchObject({ name: "Erased" });
    expect((await send(client, "GET", "/api/profile")).status).toBe(401);
    expect(await auditActions()).toEqual(["deletion.request", "deletion.decide"]);
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
