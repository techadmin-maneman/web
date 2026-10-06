// Booking from the public site (docs/decisions/0051-booking-from-the-site.md): the same path the
// referral landing takes, without an invite. NOW is Monday 21 September 2026, noon in India.
// Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeQueue, markDatabase, NOW, provedNumberCode, request } from "../helpers.ts";
import { ADDRESS, pincode, VISITOR, post, site } from "./consultations-fixtures.ts";

beforeEach(async () => {
  await markDatabase();
  await env.DB.prepare(
    "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 't1', 'Imran Qureshi', 'IQ', 1, ?1)",
  )
    .bind(NOW.toISOString())
    .run();
});

// The form drew every day and window, so a full one failed only after the whole form was filled.
describe("GET /api/availability/public", () => {
  type Open = { plan: string; days: { date: string; windows: Record<string, boolean> }[] };
  const ALL_OPEN = { morning: true, afternoon: true, evening: true };
  const NONE_OPEN = { morning: false, afternoon: false, evening: false };

  const open = (query: string, settings = {}) => request(site(settings), `/api/availability/public?${query}`);
  const daysOf = async (query: string, settings = {}) => {
    const answer = await open(query, settings);
    expect(answer.status).toBe(200);
    return (await answer.json<Open>()).days;
  };
  const windowsOn = (days: Open["days"], date: string) => days.find((day) => day.date === date)?.windows;
  const book = (body: object) =>
    request(
      site(),
      "/api/consultation",
      post({
        ...VISITOR,
        pincode: "122018",
        date: "2026-09-23",
        window: "morning",
        consent: true,
        address: ADDRESS,
        ...body,
      }),
      { CRM_QUEUE: fakeQueue() },
    );

  beforeEach(async () => {
    await pincode("122018", "Gurgaon South City II", "Gurgaon", true);
  });

  it("answers the fortnight from tomorrow, open where someone is free, for a minute's cache, naming nobody", async () => {
    const answer = await open("pincode=122018&plan=consultation");

    expect(answer.status).toBe(200);
    expect(answer.headers.get("Cache-Control")).toBe("public, max-age=60");
    const text = await answer.text();
    expect(text).not.toContain("Imran");
    const { plan, days } = JSON.parse(text) as Open;
    expect(plan).toBe("consultation");
    expect(days).toHaveLength(14);
    expect(days[0]).toEqual({ date: "2026-09-22", windows: ALL_OPEN });
    expect(days.at(-1)?.date).toBe("2026-10-05");
  });

  it("closes a window once it is full, as booking it would be refused, and a day ops blacked out", async () => {
    expect((await book({ window: "afternoon" })).status).toBe(201);
    await env.DB.prepare("INSERT INTO visit_blackouts (date, reason) VALUES ('2026-09-24', 'Dussehra')").run();

    const days = await daysOf("pincode=122018&plan=consultation");

    expect(windowsOn(days, "2026-09-23")).toEqual({ morning: true, afternoon: false, evening: true });
    expect(windowsOn(days, "2026-09-24")).toEqual(NONE_OPEN);
    const second = await book({ mobile: "9810000003", window: "afternoon" });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: { code: "taken" } });
  });

  it("offers one visit the morning and the afternoon only, where its three hours fit", async () => {
    // The technician's afternoon consultation leaves the morning's first hours, too few for a fit.
    expect((await book({ window: "afternoon" })).status).toBe(201);

    const days = await daysOf("pincode=122018&plan=one_visit");

    expect(days[0]).toEqual({ date: "2026-09-22", windows: { morning: true, afternoon: true, evening: false } });
    expect(windowsOn(days, "2026-09-23")).toEqual(NONE_OPEN);
    const proved = await provedNumberCode("+919810000003");
    const refused = await book({ mobile: "9810000003", one_visit: true, window: "morning", number_code_id: proved });
    expect(refused.status).toBe(409);
  });

  it("closes every window while nobody works, and one visit while ops offer no hair system", async () => {
    await env.DB.prepare("UPDATE technicians SET active = 0").run();
    for (const day of await daysOf("pincode=122018&plan=consultation")) expect(day.windows).toEqual(NONE_OPEN);

    await env.DB.batch([
      env.DB.prepare("UPDATE technicians SET active = 1"),
      env.DB.prepare("UPDATE services SET retired_date = '2026-09-01' WHERE kind = 'first_fit'"),
    ]);
    for (const day of await daysOf("pincode=122018&plan=one_visit")) expect(day.windows).toEqual(NONE_OPEN);
  });

  it("opens every window the plan starts in while self-serve booking is off: the request waits for ops", async () => {
    // A hair system ops offer, which the fortnight's one visits are held as once the generic first fit is retired.
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
         VALUES ('first_fit', 'essential', 'Mane Man Essential', 180, 1, 'ops@localhost', ?1)`,
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from)
         VALUES ('first_fit', 'essential', 3200000, 0, '2026-01-01')`,
      ),
    ]);
    await env.DB.prepare("UPDATE technicians SET active = 0").run();
    const off = { selfServeBooking: false };

    for (const day of await daysOf("pincode=122018&plan=consultation", off)) expect(day.windows).toEqual(ALL_OPEN);
    for (const day of await daysOf("pincode=122018&plan=one_visit", off)) {
      expect(day.windows).toEqual({ morning: true, afternoon: true, evening: false });
    }
  });

  it("opens every window on a day the price book charges for a consultation, which ops are asked for", async () => {
    await env.DB.batch([
      env.DB.prepare("UPDATE technicians SET active = 0"),
      env.DB.prepare(
        "INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from) VALUES ('consultation', 'standard', 50000, 0, '2026-09-23')",
      ),
    ]);

    const days = await daysOf("pincode=122018&plan=consultation");

    expect(windowsOn(days, "2026-09-22")).toEqual(NONE_OPEN);
    expect(windowsOn(days, "2026-09-23")).toEqual(ALL_OPEN);
  });

  it("refuses a pincode we do not serve, or do not know, and a plan or pincode not shaped as one", async () => {
    await pincode("400050", "Bandra", "Mumbai", false);
    for (const pin of ["400050", "110001"]) {
      const answer = await open(`pincode=${pin}&plan=consultation`);
      expect(answer.status).toBe(422);
      expect(await answer.json()).toMatchObject({ error: { code: "not_bookable" } });
    }
    for (const query of ["pincode=122018&plan=fit", "pincode=12201&plan=consultation", "pincode=122018"]) {
      expect((await open(query)).status).toBe(400);
    }
  });
});
