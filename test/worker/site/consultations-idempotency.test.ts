// Booking from the public site (docs/decisions/0051-booking-from-the-site.md): the same path the
// referral landing takes, without an invite. NOW is Monday 21 September 2026, noon in India.
// Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { MINUTE_MS } from "../../../src/lib/durations.ts";
import {
  appFor,
  captureLogs,
  fakeDependencies,
  fakeFetch,
  fakeQueue,
  json,
  markDatabase,
  NOW,
  request,
  TURNSTILE_URL,
} from "../helpers.ts";
import { ADDRESS, pincode, VISITOR, site, BOOKED_MORNING } from "./consultations-fixtures.ts";

beforeEach(async () => {
  await markDatabase();
  await env.DB.prepare(
    "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 't1', 'Imran Qureshi', 'IQ', 1, ?1)",
  )
    .bind(NOW.toISOString())
    .run();
});

// The site sends one Idempotency-Key per submission, so pressing again after the answer was lost on the way gets the
// first answer back rather than a second booking (docs/decisions/0011-lead-api.md).
describe("the Idempotency-Key", () => {
  const keyed = (body: object, key: string) => ({
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body),
  });
  const bindings = () => ({ CRM_QUEUE: fakeQueue(), MESSAGE_QUEUE: fakeQueue() });
  const count = async (sql: string) => (await env.DB.prepare(sql).first<{ n: number }>())?.n;

  it("answers a consultation sent again with its first answer, and books it once", async () => {
    await pincode("122018", "Gurgaon South City II", "Gurgaon", true);
    const body = {
      ...VISITOR,
      pincode: "122018",
      date: "2026-09-23",
      window: "morning",
      consent: true,
      address: ADDRESS,
    };

    const first = await request(site(), "/api/consultation", keyed(body, "key-consult-0001"), bindings());
    const again = await request(site(), "/api/consultation", keyed(body, "key-consult-0001"), bindings());

    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(await again.json()).toEqual(await first.json());
    expect(await count("SELECT COUNT(*) AS n FROM slot_holds")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM leads")).toBe(1);
  });

  it("answers a waitlist entry sent again with its first answer, and records one lead", async () => {
    await pincode("400050", "Bandra", "Mumbai", false);
    const body = { ...VISITOR, pincode: "400050", contact_consent: true, launch_alert: true };

    const first = await request(site(), "/api/waitlist", keyed(body, "key-waitlist-0001"), bindings());
    const again = await request(site(), "/api/waitlist", keyed(body, "key-waitlist-0001"), bindings());

    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(await again.json()).toEqual({ area: "Bandra", credits: false, invite: "unknown" });
    expect(await count("SELECT COUNT(*) AS n FROM leads")).toBe(1);
  });

  it("refuses the key with a different submission, and frees it when the submission is refused", async () => {
    await pincode("122018", "Gurgaon South City II", "Gurgaon", true);
    const body = {
      ...VISITOR,
      pincode: "122018",
      date: "2026-09-23",
      window: "morning",
      consent: true,
      address: ADDRESS,
    };
    await request(site(), "/api/consultation", keyed(body, "key-consult-0002"), bindings());

    const changed = { ...body, window: "evening" };
    const reused = await request(site(), "/api/consultation", keyed(changed, "key-consult-0002"), bindings());
    expect(reused.status).toBe(422);
    expect(await reused.json()).toMatchObject({ error: { code: "idempotency_key_reused" } });

    // A day outside the fortnight is refused, and the same submission is refused for itself again, not replayed.
    const outside = { ...body, date: "2026-10-31" };
    await request(site(), "/api/consultation", keyed(outside, "key-consult-0003"), bindings());
    const again = await request(site(), "/api/consultation", keyed(outside, "key-consult-0003"), bindings());
    expect(again.status).toBe(422);
    expect(await again.json()).toMatchObject({ error: { code: "not_bookable" } });
  });

  const CONSULTATION = {
    ...VISITOR,
    pincode: "122018",
    date: "2026-09-23",
    window: "morning",
    consent: true,
    address: ADDRESS,
  };

  // Each press asks Turnstile for a new token, so the retry after a lost answer carries one the first press did not.
  const turnstileRefuses = () => {
    const fetch = fakeFetch({ [TURNSTILE_URL]: () => json({ success: false }) }).fetch;
    return appFor("local", fakeDependencies({ fetch }), {}, "public");
  };
  const siteAt = (minutesAfterNow: number) => {
    const later = new Date(NOW.getTime() + minutesAfterNow * MINUTE_MS);
    return appFor("local", fakeDependencies({ now: () => later }), {}, "public");
  };

  it("answers a consultation pressed again with a new Turnstile token with its first answer, before checking it", async () => {
    await pincode("122018", "Gurgaon South City II", "Gurgaon", true);
    const firstPress = keyed({ ...CONSULTATION, turnstile_token: "first-press" }, "key-consult-0004");
    const secondPress = keyed({ ...CONSULTATION, turnstile_token: "second-press" }, "key-consult-0004");

    const first = await request(site(), "/api/consultation", firstPress, bindings());
    const again = await request(turnstileRefuses(), "/api/consultation", secondPress, bindings());

    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(await again.json()).toEqual(await first.json());
    expect(await count("SELECT COUNT(*) AS n FROM slot_holds")).toBe(1);
  });

  it("answers a waitlist entry pressed again with a new Turnstile token with its first answer", async () => {
    await pincode("400050", "Bandra", "Mumbai", false);
    const body = { ...VISITOR, pincode: "400050", contact_consent: true, launch_alert: true };
    const firstPress = keyed({ ...body, turnstile_token: "first-press" }, "key-waitlist-0002");
    const secondPress = keyed({ ...body, turnstile_token: "second-press" }, "key-waitlist-0002");

    await request(site(), "/api/waitlist", firstPress, bindings());
    const again = await request(turnstileRefuses(), "/api/waitlist", secondPress, bindings());

    expect(again.status).toBe(201);
    expect(await again.json()).toEqual({ area: "Bandra", credits: false, invite: "unknown" });
    expect(await count("SELECT COUNT(*) AS n FROM leads")).toBe(1);
  });

  /** D1 refuses one kind of write to a table, as in an outage, until the function this returns is called. */
  async function refuseWrites(operation: "INSERT" | "UPDATE" | "DELETE", table: string) {
    const trigger = `refuse_${operation.toLowerCase()}_${table}`;
    await env.DB.prepare(
      `CREATE TRIGGER ${trigger} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT, 'D1 is down'); END`,
    ).run();
    return async () => {
      await env.DB.prepare(`DROP TRIGGER ${trigger}`).run();
    };
  }

  it("answers a booking whose answer could not be kept, and logs it", async () => {
    await pincode("122018", "Gurgaon South City II", "Gurgaon", true);
    const logs = captureLogs();

    const writesBack = await refuseWrites("UPDATE", "idempotency");
    const booked = await request(site(), "/api/consultation", keyed(CONSULTATION, "key-consult-0005"), bindings());
    await writesBack();

    expect(booked.status).toBe(201);
    expect(await booked.json()).toEqual(BOOKED_MORNING);
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({
        level: "error",
        event: "idempotency_key_not_settled",
        route: "POST /api/consultation",
      }),
    );
  });

  it("lets a retry take the key of a request that died unfinished, once two minutes have passed", async () => {
    await pincode("122018", "Gurgaon South City II", "Gurgaon", true);
    captureLogs();

    const holdsBack = await refuseWrites("INSERT", "slot_holds");
    const keysBack = await refuseWrites("DELETE", "idempotency");
    const died = await request(site(), "/api/consultation", keyed(CONSULTATION, "key-consult-0006"), bindings());
    await holdsBack();
    await keysBack();
    expect(died.status).toBe(500);
    expect(await count("SELECT COUNT(*) AS n FROM slot_holds")).toBe(0);

    const soon = await request(siteAt(1), "/api/consultation", keyed(CONSULTATION, "key-consult-0006"), bindings());
    expect(soon.status).toBe(409);
    expect(await soon.json()).toMatchObject({ error: { code: "idempotency_in_progress" } });

    const later = await request(siteAt(3), "/api/consultation", keyed(CONSULTATION, "key-consult-0006"), bindings());
    expect(later.status).toBe(201);
    expect(await later.json()).toEqual(BOOKED_MORNING);
    expect(await count("SELECT COUNT(*) AS n FROM slot_holds")).toBe(1);
  });
});
