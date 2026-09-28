// The client's profile and ops' side of it (docs/decisions/0042-client-profile.md),
// against the rules in src/policy/consents.ts and number-change.ts. Every
// number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/http/context.ts";
import { visitAddress } from "../../src/domain/check-ins.ts";
import { openSession } from "../../src/domain/sessions.ts";
import { checkIn } from "../../src/policy/check-in.ts";
import { RULES as CONSENT_RULES } from "../../src/policy/consents.ts";
import { RULES as NUMBER_CHANGE_RULES } from "../../src/policy/number-change.ts";
import { appFor, fakeDependencies, fakeQueue, markDatabase, NOW, request, type TestDependencies } from "./helpers.ts";

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

/** The queues a change of number or address goes out on, to FSM's contact and the CRM lead. */
let queues: { CRM_QUEUE: ReturnType<typeof fakeQueue>; FSM_QUEUE: ReturnType<typeof fakeQueue> };
beforeEach(() => {
  queues = { CRM_QUEUE: fakeQueue(), FSM_QUEUE: fakeQueue() };
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

/** What went out on each queue about the person's contact details. */
const contactSyncs = () => ({
  crm: queues.CRM_QUEUE.sent.filter((body) => "update_person_id" in (body as object)),
  fsm: queues.FSM_QUEUE.sent.filter((body) => "update_contact_person_id" in (body as object)),
});

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
      number_change_decided: null,
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

    // An address given without the building search saves every new field null.
    expect((await profile()).address).toEqual({
      ...address,
      line1: "House 12",
      building: null,
      flat: null,
      floor: null,
      tower: null,
      landmark: null,
      place_id: null,
    });
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
    expect(contactSyncs()).toEqual({ crm: [], fsm: [] });
  });

  // REQ-S5-03: FSM's screens and Books showed "To be confirmed with the client" whatever the client saved.
  it("sends the new address on to FSM's contact and the CRM lead", async () => {
    await send(client, "PATCH", "/api/profile/address", address);
    const request = { request_id: expect.any(String) as string };
    expect(contactSyncs()).toEqual({
      crm: [{ update_person_id: "p1", ...request }],
      fsm: [{ update_contact_person_id: "p1", ...request }],
    });
  });
});

describe("POST /api/address/suggestions", () => {
  const suggest = (app: App, q: string, session?: string) =>
    send(app, "POST", "/api/address/suggestions", session === undefined ? { q } : { q, session });

  it("answers the buildings, with Google's attribution", async () => {
    const res = await suggest(client, "Sunrise", "s-1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      suggestions: [{ place_id: "stub-place-sunrise", primary: "Sunrise Greens", secondary: "Sector 65, Gurugram" }],
      attribution: "Google Maps",
    });
  });

  it("needs a session token, because Google bills per keystroke without one", async () => {
    expect((await suggest(client, "Sunrise")).status).toBe(400);
  });

  it("answers busy, having spent nothing, once the day's ceiling is reached", async () => {
    const capped = appFor("local", deps, { geocode: { apiKey: null, dailyCeiling: 1 } }, "client");
    expect((await suggest(capped, "Sunrise", "s-1")).status).toBe(200);
    const refused = await suggest(capped, "Mayfield", "s-2");
    expect(refused.status).toBe(503);
    expect((await refused.json<{ error: { code: string } }>()).error.code).toBe("busy");
    expect(deps.alerts).toEqual([
      'The daily geocode ceiling (1) is reached; address suggestions answer "busy" until midnight IST.',
    ]);
  });

  it("answers unavailable, not an error, when Google cannot be reached", async () => {
    const res = await suggest(client, "mm-stub:down", "s-1");
    expect(res.status).toBe(503);
    expect((await res.json<{ error: { code: string } }>()).error.code).toBe("unavailable");
  });

  it("tells ops once a day that Google refuses the search, in Google's words", async () => {
    const res = await suggest(client, "mm-stub:refused", "s-1");
    expect(res.status).toBe(503);
    await suggest(client, "mm-stub:refused", "s-2");
    const told =
      "Google refused the address search (autocomplete 403: stub: quota). Clients can still type an address, " +
      "but none gets a pin. Check the key, its APIs and its quotas (runbook, section 13).";
    expect(deps.alerts).toEqual([told]);

    const tomorrow = fakeDependencies({ now: () => new Date(NOW.getTime() + 24 * 60 * 60 * 1000) });
    await suggest(appFor("local", tomorrow, {}, "client"), "mm-stub:refused", "s-3");
    expect(tomorrow.alerts).toEqual([told]);
  });

  it("needs a signed-in client: suggestions cost money", async () => {
    const res = await request(client, "/api/address/suggestions", {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ q: "Sunrise", session: "s-1" }),
    });
    expect(res.status).toBe(401);
  });

  // A GET carries the cookie from any page that links here, and each one spends from Google's budget.
  it("answers no GET: a link from another site spends nothing", async () => {
    const res = await send(client, "GET", "/api/address/suggestions?q=Sunrise&session=s-1");
    expect(res.status).toBe(404);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM counters").first()).toEqual({ n: 0 });
  });
});

describe("the address pin", () => {
  const chosen = {
    line1: "Sunrise Greens",
    line2: null,
    locality: "Sector 65",
    city: "Gurgaon",
    pincode: "122018",
    access_notes: null,
    building: "Sunrise Greens",
    flat: "Flat 1203",
    floor: "12",
    tower: "Tower C",
    landmark: "Opposite the sector market",
    place_id: "stub-place-sunrise",
    session_token: "s-1",
  };

  const pinOf = () =>
    env.DB.prepare(
      "SELECT lat, lng, geocode_source, place_id, flat, floor, tower, landmark, building FROM addresses WHERE replaced_at IS NULL",
    ).first<{ lat: number | null; lng: number | null; geocode_source: string | null; place_id: string | null }>();

  it("geocodes the chosen building and keeps the coordinate with its source", async () => {
    expect((await send(client, "PATCH", "/api/profile/address", chosen)).status).toBe(200);
    const row = await pinOf();
    expect(row?.lat).toBeCloseTo(28.3951, 4);
    expect(row?.lng).toBeCloseTo(77.0619, 4);
    expect(row?.geocode_source).toBe("google_geocoding");
    expect(row?.place_id).toBe("stub-place-sunrise");
  });

  it("keeps the flat, floor, tower and landmark the technician needs", async () => {
    await send(client, "PATCH", "/api/profile/address", chosen);
    expect(await pinOf()).toMatchObject({
      flat: "Flat 1203",
      floor: "12",
      tower: "Tower C",
      landmark: "Opposite the sector market",
      building: "Sunrise Greens",
    });
  });

  it("saves a typed address with no pin at all, rather than a wrong one", async () => {
    const typed = { ...chosen, building: null, place_id: null };
    expect((await send(client, "PATCH", "/api/profile/address", typed)).status).toBe(200);
    expect(await pinOf()).toMatchObject({ lat: null, lng: null, geocode_source: null, place_id: null });
  });

  it("saves the address even when the geocode fails: the pin is the part that is optional", async () => {
    const res = await send(client, "PATCH", "/api/profile/address", { ...chosen, place_id: "stub-place-gone" });
    expect(res.status).toBe(200);
    expect(await pinOf()).toMatchObject({ lat: null, geocode_source: null, place_id: "stub-place-gone" });
  });

  it("tells ops when Google refuses the geocode, and saves the address without a pin", async () => {
    const refusing = fakeDependencies({
      geocode: {
        ...deps.geocode,
        resolve: () =>
          Promise.resolve({ ok: false, reason: "refused", detail: "geocoding said REQUEST_DENIED: key invalid" }),
      },
    });
    const res = await send(appFor("local", refusing, {}, "client"), "PATCH", "/api/profile/address", chosen);
    expect(res.status).toBe(200);
    expect(refusing.alerts).toEqual([
      expect.stringContaining("(geocoding said REQUEST_DENIED: key invalid)") as string,
    ]);
  });

  it("never takes a coordinate from the client", async () => {
    const res = await send(client, "PATCH", "/api/profile/address", { ...chosen, lat: 0, lng: 0 });
    expect(res.status).toBe(400);
  });

  // The point of the whole feature: addresses.lat has been null in every
  // environment since migration 0008, so the 200 m check has never measured
  // anything (ADR 0054). A building chosen in the app is what finally fills it.
  describe("feeding the check-in's geofence", () => {
    it("gives the geofence a point to measure against, for the first time", async () => {
      await send(client, "PATCH", "/api/profile/address", chosen);

      const found = await visitAddress(env.DB, "p1");
      expect(found?.point).not.toBeNull();
      // A technician at the door of the chosen building passes.
      expect(checkIn({ lat: 28.3952, lng: 77.062 }, found?.point ?? { lat: 0, lng: 0 })).toMatchObject({
        passed: true,
      });
      // One two kilometres away does not, and the distance is real.
      const away = checkIn({ lat: 28.4135, lng: 77.0405 }, found?.point ?? { lat: 0, lng: 0 });
      expect(away.passed).toBe(false);
      expect(away.distanceM).toBeGreaterThan(2000);
    });

    it("leaves a typed address unmeasurable rather than measuring it at zero", async () => {
      await send(client, "PATCH", "/api/profile/address", { ...chosen, building: null, place_id: null });

      const found = await visitAddress(env.DB, "p1");
      // ADR 0036's honest degradation: no point, so no distance — never a pass at 0 m.
      expect(found?.point).toBeNull();
    });
  });

  it("an address saved before these fields existed still reads", async () => {
    await env.DB.prepare(
      `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode)
       VALUES ('old-1', 'p1', ?1, 'House 4417, Tower C', 'Sector 65', 'Gurgaon', '122018')`,
    )
      .bind(NOW.toISOString())
      .run();
    expect((await profile()).address).toMatchObject({
      line1: "House 4417, Tower C",
      building: null,
      flat: null,
      place_id: null,
    });
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
      { granted: 1, notice_version: "photos-referral-cards-v2" },
      { granted: 0, notice_version: "photos-referral-cards-v2" },
    ]);
    expect(await auditActions()).toEqual(["consent.switch", "consent.switch"]);
  });

  it("keeps one row when the same switch arrives twice at the same moment", async () => {
    // Both taps are in flight together, as they are when a client taps Allow twice on board F3.
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

  it("records no place for a switch from an app that named none, and takes none but the app's own", async () => {
    await send(client, "PATCH", "/api/consents/photos_marketing", { granted: true });
    expect(await env.DB.prepare("SELECT source FROM consents").first()).toEqual({ source: null });
    const claimed = await send(client, "PATCH", "/api/consents/photos_marketing", {
      granted: false,
      source: "technician",
    });
    expect(claimed.status).toBe(400);
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
      expect.objectContaining({ person_id: "p1", name: "Rohit Malhotra", old_mobile: OLD, new_mobile: NEW }),
    ]);
    const decided = await send(ops, "POST", `/api/number-changes/${body.request_id}/decision`, {
      decision: "confirm",
      reason: null,
    });
    expect(await decided.json()).toEqual({ state: "confirmed" });
    expect(await mobile()).toBe(NEW);
    // LIFE-12: the new number reaches FSM's contact and the CRM lead, and the old one is kept for the fraud rules.
    expect(contactSyncs()).toEqual({
      crm: [{ update_person_id: "p1", request_id: expect.any(String) as string }],
      fsm: [{ update_contact_person_id: "p1", request_id: expect.any(String) as string }],
    });
    const replaced = await env.DB.prepare("SELECT replaced_mobile_e164 FROM number_change_requests").first();
    expect(replaced).toEqual({ replaced_mobile_e164: OLD });
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
    // A change rejected, like one withdrawn, never happened: nothing goes out and no number is kept.
    expect(contactSyncs()).toEqual({ crm: [], fsm: [] });
    const replaced = await env.DB.prepare("SELECT replaced_mobile_e164 FROM number_change_requests").first();
    expect(replaced).toEqual({ replaced_mobile_e164: null });
  });

  // A rejected change vanished from the app, and its reason stayed in ops (OPS-09).
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

describe("a deletion request", () => {
  it("is made once however often it is asked, and waits for ops", async () => {
    expect((await send(client, "POST", "/api/deletion-request")).status).toBe(202);
    expect((await send(client, "POST", "/api/deletion-request")).status).toBe(202);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM deletion_requests").first("n")).toBe(1);
    expect((await profile()).deletion).toEqual({ state: "requested", requested_at: NOW.toISOString() });
    expect(await auditActions()).toEqual(["deletion.request"]);
  });

  it("erases the person when ops delete, audited in the same batch as the erasure", async () => {
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
