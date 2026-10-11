// The name and number /book asks for first, kept as a lead before the visit is chosen
// (docs/decisions/0116-book-asks-for-the-name-and-number-first.md). NOW is Monday 21 September 2026, noon in India.
// Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeQueue, markDatabase, NOW, request } from "../helpers.ts";
import { post, site } from "./consultations-fixtures.ts";

const LEFT = { name: "Karan Bhatia", mobile: "9810000002", consent: true, turnstile_token: "token" };

const leave = (body: object = LEFT, crm = fakeQueue()) =>
  request(site(), "/api/lead", post(body), { CRM_QUEUE: crm, MESSAGE_QUEUE: fakeQueue() });

const rows = (sql: string) =>
  env.DB.prepare(sql)
    .all()
    .then((all) => all.results);

beforeEach(async () => {
  await markDatabase();
});

describe("POST /api/lead", () => {
  it("keeps a new number's name, its agreement and a lead with no date yet, and sends the lead to the CRM", async () => {
    const crm = fakeQueue();
    const answer = await leave({ ...LEFT, attribution: { utm_source: "google", utm_campaign: "launch" } }, crm);

    expect(answer.status).toBe(201);
    expect(await answer.json()).toEqual({});
    expect(await rows("SELECT name, mobile_e164, contactable FROM people")).toEqual([
      { name: "Karan Bhatia", mobile_e164: "+919810000002", contactable: 1 },
    ]);
    expect(await rows("SELECT purpose, notice_version, source, granted FROM consents")).toEqual([
      { purpose: "whatsapp_visits", notice_version: "site-consultation-v1", source: "site_booking", granted: 1 },
    ]);
    const leads = await rows("SELECT id, source, city, proposed_visit_date, utm_source, utm_campaign FROM leads");
    expect(leads).toEqual([
      {
        id: expect.any(String) as string,
        source: "form",
        city: null,
        proposed_visit_date: null,
        utm_source: "google",
        utm_campaign: "launch",
      },
    ]);
    expect(crm.sent).toEqual([expect.objectContaining({ lead_id: leads[0]?.id })]);
  });

  it("keeps one lead for a number left twice in a day", async () => {
    await leave();
    const again = await leave({ ...LEFT, name: "Karan B" });

    expect(again.status).toBe(201);
    expect(await rows("SELECT COUNT(*) AS n FROM leads")).toEqual([{ n: 1 }]);
    expect(await rows("SELECT name FROM people")).toEqual([{ name: "Karan Bhatia" }]);
  });

  // The form tells nobody whether a number is a client's, and a client is followed up already.
  it("answers a client's number as any other, and writes nothing of them", async () => {
    await env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name, contactable) VALUES ('p1', ?1, '+919810000002', 'Karan Bhatia', 0)",
    )
      .bind(NOW.toISOString())
      .run();
    await env.DB.prepare(
      `INSERT INTO consultation_requests (id, person_id, pincode, requested_date, requested_window, created_at)
       VALUES ('r1', 'p1', '122018', '2026-09-25', 'afternoon', ?1)`,
    )
      .bind(NOW.toISOString())
      .run();

    const answer = await leave({ ...LEFT, name: "Someone Else" });

    expect(answer.status).toBe(201);
    expect(await answer.json()).toEqual({});
    expect(await rows("SELECT name, contactable FROM people")).toEqual([{ name: "Karan Bhatia", contactable: 0 }]);
    expect(await rows("SELECT COUNT(*) AS n FROM leads")).toEqual([{ n: 0 }]);
    expect(await rows("SELECT COUNT(*) AS n FROM consents")).toEqual([{ n: 0 }]);
  });

  it("refuses a number that is not a mobile, and goes nowhere without the agreement", async () => {
    const notMobile = await leave({ ...LEFT, mobile: "5876543210" });
    expect(notMobile.status).toBe(400);
    expect(await notMobile.json()).toMatchObject({ error: { code: "invalid_request", fields: ["mobile"] } });

    const { consent: _consent, ...withoutConsent } = LEFT;
    const unagreed = await leave(withoutConsent);
    expect(unagreed.status).toBe(400);
    expect(await rows("SELECT COUNT(*) AS n FROM people")).toEqual([{ n: 0 }]);
  });
});
