// The client's profile and ops' side of it (docs/decisions/0042-client-profile.md),
// against the rules in src/policy/consents.ts and number-change.ts. Every
// number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/http/context.ts";
import { visitAddress } from "../../src/domain/check-ins.ts";
import { openSession } from "../../src/domain/sessions.ts";
import { checkIn } from "../../src/policy/check-in.ts";
import { RULES as NUMBER_CHANGE_RULES } from "../../src/policy/number-change.ts";
import { createLogger } from "../../src/log.ts";
import type { MessagingProvider, OutboundMessage, SendResult } from "../../src/providers/messaging/index.ts";
import { sendMessage } from "../../src/queues/messaging.ts";
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
} from "./helpers.ts";

const log = createLogger();

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
  await servedPincode("122018", "Gurgaon");
  cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: "p1", deviceLabel: null, now: NOW })}`;
});

/** A pincode we hold, served unless `served` is false. */
async function servedPincode(pincode: string, city: string, served = true) {
  await env.DB.prepare(
    "INSERT INTO serviceable_pincodes (pincode, area, city, served, launched_at) VALUES (?1, ?2, ?2, ?3, ?4)",
  )
    .bind(pincode, city, served ? 1 : 0, served ? "2026-09-01T18:30:00.000Z" : null)
    .run();
}

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

describe("PATCH /api/profile/address", () => {
  const address = {
    flat: "4417",
    tower: "Tower C",
    line1: "Palm Grove Society",
    line2: null,
    locality: "Sector 65",
    city: "Gurgaon",
    pincode: "122018",
    access_notes: "Gate code 4417 · park in visitor bay B",
  };

  it("saves the address and its access notes, keeping the old one as replaced", async () => {
    expect((await send(client, "PATCH", "/api/profile/address", address)).status).toBe(200);
    expect((await send(client, "PATCH", "/api/profile/address", { ...address, line1: "Silver Oaks" })).status).toBe(
      200,
    );

    // An address given without the building search saves no building or Place ID, and a part left out as null.
    expect((await profile()).address).toEqual({
      ...address,
      line1: "Silver Oaks",
      building: null,
      floor: null,
      landmark: null,
      place_id: null,
    });
    const rows = await env.DB.prepare(
      "SELECT line1, replaced_at IS NULL AS current FROM addresses ORDER BY created_at, rowid",
    ).all();
    expect(rows.results).toEqual([
      { line1: "Palm Grove Society", current: 0 },
      { line1: "Silver Oaks", current: 1 },
    ]);
  });

  // The owner's ruling of 27 September 2026 (docs/open-points.md, item 45): the job sheet must name the door.
  it("refuses an address without the flat or house number", async () => {
    const { flat: _left, ...withoutFlat } = address;
    for (const body of [withoutFlat, { ...address, flat: null }, { ...address, flat: "  " }]) {
      const answer = await send(client, "PATCH", "/api/profile/address", body);
      expect(answer.status, JSON.stringify(body)).toBe(400);
      expect(await answer.json()).toMatchObject({ error: { code: "invalid_request", fields: ["flat"] } });
    }
    expect((await profile()).address).toBeNull();
    expect(contactSyncs()).toEqual([]);
  });

  it("refuses a pincode that is not six digits", async () => {
    expect((await send(client, "PATCH", "/api/profile/address", { ...address, pincode: "12201" })).status).toBe(400);
    expect(contactSyncs()).toEqual([]);
  });

  // A client changed only the pincode to Mumbai's, and the address was saved and sent on.
  it("refuses a pincode we do not serve, or do not hold, and saves and sends on nothing", async () => {
    await servedPincode("122019", "Gurgaon", false);
    for (const pincode of ["122019", "411001"]) {
      const answer = await send(client, "PATCH", "/api/profile/address", { ...address, pincode });
      expect(answer.status, pincode).toBe(422);
      expect(await answer.json()).toMatchObject({ error: { code: "not_served" } });
    }
    expect((await profile()).address).toBeNull();
    expect(contactSyncs()).toEqual([]);
  });

  describe("while a visit is still to come", () => {
    const inDelhi = { ...address, city: "Delhi", pincode: "110017" };
    const pincodeSaved = async () => ((await profile()).address as { pincode: string }).pincode;

    beforeEach(async () => {
      await servedPincode("110017", "Delhi");
      await servedPincode("122011", "Gurgaon");
      expect((await send(client, "PATCH", "/api/profile/address", address)).status).toBe(200);
    });

    it("keeps the address in the visit's city, and lets it move within that city", async () => {
      await env.DB.prepare(
        `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, window_end, service_city,
           service_pincode, synced_at)
         VALUES ('a1', 'a1', 'p1', 'service', 'scheduled', '2026-09-24T06:30:00.000Z', '2026-09-24T08:30:00.000Z',
           'Gurgaon', '122018', ?1)`,
      )
        .bind(NOW.toISOString())
        .run();

      const elsewhere = await send(client, "PATCH", "/api/profile/address", inDelhi);
      expect(elsewhere.status).toBe(409);
      expect(await elsewhere.json()).toMatchObject({ error: { code: "visit_booked" } });
      expect(await pincodeSaved()).toBe("122018");

      expect((await send(client, "PATCH", "/api/profile/address", { ...address, pincode: "122011" })).status).toBe(200);
      expect(await pincodeSaved()).toBe("122011");

      // Once the visit is cancelled, the address may go wherever we come.
      await env.DB.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = 'a1'").run();
      expect((await send(client, "PATCH", "/api/profile/address", inDelhi)).status).toBe(200);
      expect(await pincodeSaved()).toBe("110017");
    });

    it("counts a visit paid for and still being booked, as the client's booking", async () => {
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 't1', 'Imran Qureshi', 'IQ', 1, ?1)",
        ).bind(NOW.toISOString()),
        env.DB.prepare(
          `INSERT INTO slot_holds (id, person_id, type, date, window_label, technician_id, start_unit, amount,
             amount_ex_gst, gst_percent, state, pincode, expires_at, created_at, updated_at, confirmed_at)
           VALUES ('hold-1', 'p1', 'service', '2026-09-24', 'afternoon', 't1', 2, 200000, 200000, 0, 'held', '122018',
             ?1, ?1, ?1, ?1)`,
        ).bind(NOW.toISOString()),
      ]);
      expect((await send(client, "PATCH", "/api/profile/address", inDelhi)).status).toBe(409);
      expect(await pincodeSaved()).toBe("122018");
    });
  });

  // REQ-S5-03: Books showed "To be confirmed with the client" whatever the client saved.
  it("sends the new address on to the CRM lead, and marks the client's Books customer for the Books pass", async () => {
    await send(client, "PATCH", "/api/profile/address", address);
    expect(contactSyncs()).toEqual([{ update_person_id: "p1", request_id: expect.any(String) as string }]);
    const changedAt = await env.DB.prepare("SELECT books_details_changed_at FROM people WHERE id = 'p1'").first();
    expect(changedAt).toEqual({ books_details_changed_at: NOW.toISOString() });
  });

  it("tells ops when the address cannot be sent on, until a later change is", async () => {
    const openAlert = () =>
      env.DB.prepare("SELECT key FROM alerts WHERE key = 'contact_sync:p1' AND resolved_at IS NULL").first("key");
    queues.CRM_QUEUE.send = () => Promise.reject(new Error("queue unavailable"));
    expect((await send(client, "PATCH", "/api/profile/address", address)).status).toBe(200);
    expect(await openAlert()).toBe("contact_sync:p1");

    // The consumers read the person afresh, so the later change carries the one that was not sent.
    queues.CRM_QUEUE = fakeQueue();
    expect((await send(client, "PATCH", "/api/profile/address", { ...address, line1: "House 12" })).status).toBe(200);
    expect(await openAlert()).toBeNull();
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

  it("tells ops that Google refuses the search, in Google's words, and again a day on while it lasts", async () => {
    const res = await suggest(client, "mm-stub:refused", "s-1");
    expect(res.status).toBe(503);
    await suggest(client, "mm-stub:refused", "s-2");
    const told =
      "Google refused the address search (autocomplete 403: stub: quota). Clients can still type an address, " +
      "but none gets a pin. Check the key, its APIs and its quotas (runbook, section 13).";
    expect(deps.alerts).toEqual([told]);

    const tomorrow = fakeDependencies({ now: () => new Date(NOW.getTime() + 24 * 60 * 60 * 1000) });
    await suggest(appFor("local", tomorrow, {}, "client"), "mm-stub:refused", "s-3");
    expect(tomorrow.alerts).toEqual([`Still open since Mon 21 Sep, 12 pm, 3 times: ${told}`]);
  });

  it("closes the alert of Google's refusal at the next search Google answers", async () => {
    const openAlerts = () =>
      env.DB.prepare("SELECT count(*) AS open FROM alerts WHERE key = 'google_refused' AND resolved_at IS NULL").first(
        "open",
      );
    await suggest(client, "mm-stub:refused", "s-1");
    expect(await openAlerts()).toBe(1);

    expect((await suggest(client, "Sunrise", "s-2")).status).toBe(200);
    expect(await openAlerts()).toBe(0);
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

  // Owner ruling, 30 September 2026 ("logins open, reminders fenced", ADR 0025 item 84; ADR 0097): each side of a
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
    await sendMessage(env.DB, LOCAL_CONFIG, fakeDependencies({ messaging: whatsapp.provider }), log, messageId);
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
