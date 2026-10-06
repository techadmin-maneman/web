// The client's profile and ops' side of it (docs/decisions/0042-client-profile.md),
// against the rules in src/policy/consents.ts and src/domain/clients/number-change.ts. Every
// number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { visitAddress } from "../../../src/domain/visits/check-ins.ts";
import { openSession } from "../../../src/domain/sign-in/sessions.ts";
import { checkIn } from "../../../src/policy/check-in.ts";
import { appFor, fakeDependencies, fakeQueue, markDatabase, NOW, request, type TestDependencies } from "../helpers.ts";
import { ORIGIN, OLD, servedPincode } from "./client-profile-fixtures.ts";

let deps: TestDependencies;

let client: App;

let cookie: string;

beforeEach(async () => {
  deps = fakeDependencies();
  client = appFor("local", deps, {}, "client");
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

  // The job sheet must name the door.
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
      "but none gets a pin. Check the key, its APIs and its quotas (provisioning, step 13).";
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
