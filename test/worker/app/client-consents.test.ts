// The client's profile and ops' side of it (docs/decisions/0042-client-profile.md),
// against the rules in src/policy/consents.ts and src/domain/clients/number-change.ts. Every
// number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { openSession } from "../../../src/domain/sign-in/sessions.ts";
import { appFor, fakeDependencies, fakeQueue, markDatabase, NOW, request, type TestDependencies } from "../helpers.ts";
import { ORIGIN, OLD, servedPincode, auditActions } from "./client-profile-fixtures.ts";

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

describe("PATCH /api/consents/:purpose", () => {
  it("switches a purpose either way, each switch its own dated row with the notice seen", async () => {
    const res = await send(client, "PATCH", "/api/consents/photos_referral_cards", { granted: true });
    expect(await res.json()).toEqual({ purpose: "photos_referral_cards", granted: true, since: NOW.toISOString() });
    await send(client, "PATCH", "/api/consents/photos_referral_cards", { granted: false });

    const consents = (await profile()).consents as { purpose: string; granted: boolean }[];
    expect(consents.find((consent) => consent.purpose === "photos_referral_cards")?.granted).toBe(false);
    // Each switch is its own row, with the notice version the client saw.
    const rows = await env.DB.prepare("SELECT granted, notice_version FROM consents ORDER BY created_at, rowid").all();
    expect(rows.results).toEqual([
      { granted: 1, notice_version: "photos-referral-cards-v2" },
      { granted: 0, notice_version: "photos-referral-cards-v2" },
    ]);
    expect(await auditActions()).toEqual(["consent.switch", "consent.switch"]);
  });

  it("keeps one row when the same switch arrives twice at the same moment", async () => {
    // Both taps are in flight together, as they are when a client taps Allow twice on the card sheet.
    const both = await Promise.all([
      send(client, "PATCH", "/api/consents/whatsapp_visits", { granted: true }),
      send(client, "PATCH", "/api/consents/whatsapp_visits", { granted: true }),
    ]);
    expect(both.map((answer) => answer.status)).toEqual([200, 200]);
    // A switch to the state the purpose already holds is not a switch. The ledger is append-only
    // by trigger, so a second row could never be taken back afterwards (ADR 0058).
    expect(await env.DB.prepare("SELECT COUNT(*) AS rows FROM consents").first()).toEqual({ rows: 1 });
    // The tap that wrote nothing is answered with the date the ledger holds, not with its own moment.
    const given = { purpose: "whatsapp_visits", granted: true, since: NOW.toISOString() };
    expect(await Promise.all(both.map((answer) => answer.json()))).toEqual([given, given]);
  });

  // The log said a client switched a consent they had not.
  it("writes no audit entry for a switch to the state the purpose already holds", async () => {
    await send(client, "PATCH", "/api/consents/whatsapp_visits", { granted: true });
    const again = await send(client, "PATCH", "/api/consents/whatsapp_visits", { granted: true });
    expect(again.status).toBe(200);
    expect(await auditActions()).toEqual(["consent.switch"]);
  });

  it("records the same answer again when the notice behind it has changed", async () => {
    // The referral-card notice gained a line and became v2 (src/config/notices.ts), so a client
    // who agreed under v1 is agreeing to something new, and the ledger says so.
    await env.DB.prepare(
      `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
       VALUES ('c-old', 'p1', 'photos_referral_cards', 'photos-referral-cards-v1', 1, ?1)`,
    )
      .bind(NOW.toISOString())
      .run();
    await send(client, "PATCH", "/api/consents/photos_referral_cards", { granted: true });
    const rows = await env.DB.prepare("SELECT notice_version FROM consents ORDER BY created_at, rowid").all();
    expect(rows.results).toEqual([
      { notice_version: "photos-referral-cards-v1" },
      { notice_version: "photos-referral-cards-v2" },
    ]);
  });

  // docs/decisions/0094-where-a-consent-was-given.md
  it("records which of the app's screens the switch was made on", async () => {
    await send(client, "PATCH", "/api/consents/photos_marketing", { granted: true, source: "app_profile" });
    await send(client, "PATCH", "/api/consents/whatsapp_visits", { granted: true, source: "app_booking" });
    await send(client, "PATCH", "/api/consents/photos_referral_cards", { granted: true, source: "app_share_sheet" });
    const rows = await env.DB.prepare("SELECT purpose, source FROM consents ORDER BY rowid").all();
    expect(rows.results).toEqual([
      { purpose: "photos_marketing", source: "app_profile" },
      { purpose: "whatsapp_visits", source: "app_booking" },
      { purpose: "photos_referral_cards", source: "app_share_sheet" },
    ]);
  });

  it("records the booking sheet's reminder under the box's own line, and the profile's switch under its own", async () => {
    await send(client, "PATCH", "/api/consents/whatsapp_visits", { granted: true, source: "app_booking" });
    await send(client, "PATCH", "/api/consents/whatsapp_visits", { granted: false, source: "app_profile" });
    const rows = await env.DB.prepare("SELECT notice_version, granted FROM consents ORDER BY rowid").all();
    expect(rows.results).toEqual([
      { notice_version: "whatsapp-visits-booking-v2", granted: 1 },
      { notice_version: "whatsapp-visits-v1", granted: 0 },
    ]);
  });

  it("records no place for a switch from an app that named none, and takes none but the app's own", async () => {
    await send(client, "PATCH", "/api/consents/photos_marketing", { granted: true });
    expect(await env.DB.prepare("SELECT source FROM consents").first()).toEqual({ source: null });
    const claimed = await send(client, "PATCH", "/api/consents/photos_marketing", {
      granted: false,
      source: "technician",
    });
    expect(claimed.status).toBe(400);
  });

  it("refuses a screen named against a purpose it never asks for, and records nothing", async () => {
    const answer = await send(client, "PATCH", "/api/consents/photos_marketing", {
      granted: true,
      source: "app_share_sheet",
    });
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: { code: "invalid_request", fields: ["source"] } });
    const booking = await send(client, "PATCH", "/api/consents/photos_referral_cards", {
      granted: true,
      source: "app_booking",
    });
    expect(booking.status).toBe(400);
    expect(await env.DB.prepare("SELECT COUNT(*) AS rows FROM consents").first()).toEqual({ rows: 0 });
    expect(await auditActions()).toEqual([]);
  });

  it("switches only the five purposes, never an agreement given on the site", async () => {
    expect((await send(client, "PATCH", "/api/consents/contact", { granted: false })).status).toBe(400);
  });

  it("offers ops no way to grant one: there is no ops route that writes consents", async () => {
    expect((await send(ops, "PATCH", "/api/consents/photos_marketing", { granted: true })).status).toBe(404);
  });
});
