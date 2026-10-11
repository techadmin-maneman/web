// Logging in to the client app (docs/decisions/0029-sessions.md, 0030-one-time-codes.md),
// against the rules in src/policy/one-time-code.ts. Every number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { openSession } from "../../../src/domain/sign-in/sessions.ts";
import { captureLogs, eraseByMobile, markDatabase, NOW, request } from "../helpers.ts";
import {
  BOOKED,
  UNBOOKED,
  clock,
  useClock,
  app,
  build,
  later,
  post,
  start,
  verify,
  lastCode,
} from "./client-auth-fixtures.ts";

beforeEach(async () => {
  useClock(NOW);
  captureLogs();
  build();
  await markDatabase();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name, contactable) VALUES ('p-booked', ?1, ?2, 'Arjun Mehta', 1)",
    ).bind(NOW.toISOString(), BOOKED),
    env.DB.prepare(
      `INSERT INTO leads (id, person_id, created_at, source, city, first_choice_window, loss_extent, proposed_visit_date, request_id)
       VALUES ('l-booked', 'p-booked', ?1, 'form', 'Gurgaon', 'weekday_pm', 'crown', '2026-09-24', 'r')`,
    ).bind(NOW.toISOString()),
    // A try-on claim is a lead, but not a booking.
    env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name, contactable) VALUES ('p-tryon', ?1, ?2, 'Vikram', 1)",
    ).bind(NOW.toISOString(), UNBOOKED),
    env.DB.prepare(
      `INSERT INTO leads (id, person_id, created_at, source, loss_extent, request_id)
       VALUES ('l-tryon', 'p-tryon', ?1, 'tryon', 'crown', 'r')`,
    ).bind(NOW.toISOString()),
  ]);
});

/** Logs in, and returns the mm_app cookie as a Cookie header value. */
async function loggedIn(): Promise<string> {
  const { body } = await start("98100 00001");
  const res = await verify(body.challenge_id, lastCode());
  const cookie = /mm_app=([^;]+)/.exec(res.headers.get("Set-Cookie") ?? "")?.[1];
  if (cookie === undefined) throw new Error("no session cookie");
  return `mm_app=${cookie}`;
}

describe("the session", () => {
  it("opens GET /api/me: a lead with their consultation", async () => {
    const cookie = await loggedIn();
    const res = await request(app, "/api/me", { headers: { Cookie: cookie } });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      state: "lead",
      name: "Arjun Mehta",
      first_name: "Arjun",
      initials: "AM",
      // The site's first form booked nothing: ops confirm the time on WhatsApp.
      consultation: {
        date: "2026-09-24",
        window: "evening",
        window_label: "after four",
        place: "Gurgaon",
        requested: true,
        one_visit: null,
      },
      next_visit: null,
      // No consultation is done yet.
      consulted: null,
      // Nothing paid for or booked in the app is waiting for FSM (docs/decisions/0095-a-booking-fsm-refuses-is-held.md).
      being_booked: null,
      payment_owed: null,
      credits: null,
      // A consultation is booked and no address given: the design's prompt asks for one.
      prompt: { kind: "address" },
      invoice: null,
      // Every service of the kinds open to them, with its length and price (docs/decisions/0085-services-ops-can-edit.md);
      // nothing is offered next while a visit is booked (ADR 0086).
      booking: {
        self_serve: true,
        types: ["consultation"],
        services: [
          {
            type: "consultation",
            tier: "standard",
            name: "Consultation",
            description: null,
            minutes: 60,
            price: { amount_ex_gst: 0, amount: 0, gst_percent: 0 },
          },
        ],
        next: null,
      },
      // What a referral earns, which ops set, for the Refer tab (docs/decisions/0107-referral-rewards-in-the-console.md).
      referral_reward: { referrer_visits: 3, friend_visits: 3, valid_days: 365 },
      pending_invite: null,
    });
  });

  describe("a booking from the site's form, which asks for no rough window", () => {
    /** A person who booked on the site for Friday, with a session in the app. */
    async function bookedOnTheSite(): Promise<string> {
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO people (id, created_at, mobile_e164, name, contactable) VALUES ('p-site', ?1, '+919810000005', 'Kabir Anand', 1)",
        ).bind(NOW.toISOString()),
        env.DB.prepare(
          `INSERT INTO leads (id, person_id, created_at, source, city, loss_extent, proposed_visit_date, request_id)
           VALUES ('l-site', 'p-site', ?1, 'form', 'Gurgaon', 'crown', '2026-09-25', 'r')`,
        ).bind(NOW.toISOString()),
      ]);
      return `mm_app=${await openSession(env.DB, { kind: "client", subjectId: "p-site", deviceLabel: null, now: NOW })}`;
    }

    /** The day and window asked for while self-serve booking is off, which ops confirm on WhatsApp. */
    async function requested(oneVisit = false): Promise<void> {
      await env.DB.prepare(
        `INSERT INTO consultation_requests (id, person_id, pincode, requested_date, requested_window, created_at, one_visit)
         VALUES ('request-1', 'p-site', '122018', '2026-09-25', 'afternoon', ?1, ?2)`,
      )
        .bind(NOW.toISOString(), oneVisit ? 1 : 0)
        .run();
    }

    const home = async (cookie: string) =>
      (await request(app, "/api/me", { headers: { Cookie: cookie } })).json<Record<string, unknown>>();

    it("shows a request made while self-serve booking is off as requested, in the window asked for", async () => {
      const cookie = await bookedOnTheSite();
      await requested();

      const res = await request(app, "/api/me", { headers: { Cookie: cookie } });

      expect(res.status).toBe(200);
      expect((await res.json<{ consultation: unknown }>()).consultation).toEqual({
        date: "2026-09-25",
        window: "afternoon",
        window_label: null,
        place: "Gurgaon",
        requested: true,
        one_visit: null,
      });
    });

    it("says a request for the consultation and fit in one visit is one", async () => {
      const cookie = await bookedOnTheSite();
      await requested(true);

      expect(await home(cookie)).toMatchObject({
        consultation: { requested: true, one_visit: { amount: 3_000_000, from: false, code: null } },
      });
    });

    it("drops a request once its day has passed, so Home offers booking again", async () => {
      const cookie = await bookedOnTheSite();
      await requested();

      useClock(new Date("2026-09-25T18:00:00Z")); // 23:30 on the day asked for, in India
      expect(await home(cookie)).toMatchObject({ consultation: { date: "2026-09-25", requested: true } });

      useClock(new Date("2026-09-25T18:30:00Z")); // midnight in India: the day has passed
      expect(await home(cookie)).toMatchObject({ consultation: null, booking: { types: ["consultation"] } });
    });

    it("shows the slot it held as booked, in its window", async () => {
      const cookie = await bookedOnTheSite();
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 'resource-1', 'Imran Qureshi', 'IQ', 1, ?1)",
        ).bind(NOW.toISOString()),
        env.DB.prepare(
          `INSERT INTO slot_holds (id, person_id, type, date, window_label, technician_id, start_unit, amount,
             amount_ex_gst, gst_percent, state, expires_at, created_at, updated_at)
           VALUES ('hold-1', 'p-site', 'consultation', '2026-09-25', 'evening', 't1', 6, 0, 0, 0, 'booked', ?1, ?1, ?1)`,
        ).bind(NOW.toISOString()),
      ]);

      const res = await request(app, "/api/me", { headers: { Cookie: cookie } });

      expect(res.status).toBe(200);
      expect((await res.json<{ consultation: unknown }>()).consultation).toEqual({
        date: "2026-09-25",
        window: "evening",
        window_label: "after four",
        place: "Gurgaon",
        requested: false,
        one_visit: null,
      });
    });
  });

  it("is required for GET /api/me", async () => {
    const res = await request(app, "/api/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session_required" } });
    expect((await request(app, "/api/me", { headers: { Cookie: "mm_app=made-up" } })).status).toBe(401);
  });

  it("slides: each use moves its 90 days on, at most hourly", async () => {
    const cookie = await loggedIn();
    later(30 * 60);
    expect((await request(app, "/api/me", { headers: { Cookie: cookie } })).headers.get("Set-Cookie")).toBeNull();
    later(31 * 60);
    const res = await request(app, "/api/me", { headers: { Cookie: cookie } });
    expect(res.headers.get("Set-Cookie")).toMatch(/^__Host-mm_app=.*Max-Age=7776000/);
    const row = await env.DB.prepare("SELECT expires_at FROM sessions").first<string>("expires_at");
    expect(row).toBe(new Date(clock.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString());
  });

  // The cookie took the __Host- prefix in October 2026; a phone still holding the old name stays signed in, and its
  // next touch hands it the new one.
  it("is read under its __Host- name, and under its old one until those sessions lapse", async () => {
    const token = (await loggedIn()).replace(/^mm_app=/, "");
    expect((await request(app, "/api/me", { headers: { Cookie: `__Host-mm_app=${token}` } })).status).toBe(200);
    later(61 * 60);
    const old = await request(app, "/api/me", { headers: { Cookie: `mm_app=${token}` } });
    expect(old.status).toBe(200);
    expect(old.headers.get("Set-Cookie")).toMatch(/^__Host-mm_app=/);
  });

  it("ends 90 days after its last use", async () => {
    const cookie = await loggedIn();
    later(90 * 24 * 60 * 60 + 1);
    expect((await request(app, "/api/me", { headers: { Cookie: cookie } })).status).toBe(401);
  });

  it("ends at logout, and the cookie goes with it", async () => {
    const cookie = await loggedIn();
    const res = await post("/api/auth/logout", {}, { Cookie: cookie });

    expect(res.status).toBe(204);
    expect(res.headers.get("Set-Cookie")).toMatch(/^__Host-mm_app=; Max-Age=0; Path=\/; Secure/);
    expect((await request(app, "/api/me", { headers: { Cookie: cookie } })).status).toBe(401);
    expect(await env.DB.prepare("SELECT revoked_at FROM sessions").first("revoked_at")).not.toBeNull();
  });

  it("ends, with every open code, when the person is erased", async () => {
    const cookie = await loggedIn();
    const { body } = await start("98100 00001");
    await eraseByMobile(BOOKED, clock);

    expect((await request(app, "/api/me", { headers: { Cookie: cookie } })).status).toBe(401);
    expect((await verify(body.challenge_id, lastCode())).status).toBe(410);
  });

  it("names the device from its browser, without keeping the full User-Agent", async () => {
    const { body } = await start("98100 00001");
    await verify(body.challenge_id, lastCode());
    const android = await start("98100 00001");
    await post(
      "/api/auth/verify",
      { challenge_id: android.body.challenge_id, code: lastCode() },
      { "User-Agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36" },
    );
    const labels = await env.DB.prepare("SELECT device_label FROM sessions ORDER BY created_at").all();
    expect(labels.results.map((row) => row.device_label)).toContain("Chrome on Android");
  });
});
