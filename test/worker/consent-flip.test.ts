// A person whose CRM record is "delivery only" (a try-on's, made while try-ons
// still reached the CRM) agreed to the one WhatsApp copy of their result and to
// nothing else, so no one chases them. When that person books, they become
// contactable, and their CRM record must turn into a New lead that may be
// contacted (REQ-S2-04). A regression here would leave every such booker
// "delivery only", never called.
// NOW is Monday 21 September 2026, noon in India.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { ZohoSettings } from "../../src/config/settings.ts";
import { createLogger } from "../../src/log.ts";
import { createZohoCrm } from "../../src/providers/zoho-crm.ts";
import { syncLead } from "../../src/queues/crm-sync.ts";
import { NOW, appFor, fakeDependencies, fakeFetch, fakeQueue, json, markDatabase, request } from "./helpers.ts";
import { insertPerson } from "./tryon-fixtures.ts";

const SETTINGS: ZohoSettings = {
  clientId: "1000.CLIENT",
  clientSecret: "client-secret",
  refreshToken: "1000.refresh",
  accountsHost: "accounts.zoho.in",
  apiHost: "www.zohoapis.in",
  larId: "lar-123",
};
const LEADS_URL = "https://www.zohoapis.in/crm/v8/Leads";
const PERSON = "44444444-4444-4444-8444-444444444444";

beforeEach(async () => {
  await markDatabase();
  // Tried on, and the CRM has them as the try-on's delivery-only record.
  await insertPerson(PERSON, "+919810000001");
  await env.DB.batch([
    env.DB.prepare("UPDATE people SET zoho_lead_id = 'zoho-7' WHERE id = ?1").bind(PERSON),
    env.DB.prepare(
      `INSERT INTO serviceable_pincodes (pincode, area, city, served, launched_at)
       VALUES ('122018', 'Gurgaon South City II', 'Gurgaon', 1, ?1)`,
    ).bind(NOW.toISOString()),
    env.DB.prepare(
      `INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at)
       VALUES ('t1', 'resource-1', 'Imran Qureshi', 'IQ', 1, ?1)`,
    ).bind(NOW.toISOString()),
  ]);
});

/** Books a consultation on the site's form for the person's number; the lead it leaves. */
async function book(): Promise<string> {
  const answer = await request(
    appFor(),
    "/api/consultation",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Arjun Mehta",
        mobile: "9810000001",
        pincode: "122018",
        loss_extent: "crown",
        turnstile_token: "token",
        date: "2026-09-23",
        window: "morning",
        address: {
          flat: "House 12",
          floor: null,
          tower: null,
          line1: "Palm Grove Society",
          line2: null,
          landmark: null,
          locality: "Sector 65",
          city: "Gurgaon",
          pincode: "122018",
          access_notes: null,
        },
        consent: true,
      }),
    },
    { CRM_QUEUE: fakeQueue() },
  );
  expect(answer.status).toBe(201);
  const lead = await env.DB.prepare("SELECT id FROM leads WHERE person_id = ?1").bind(PERSON).first<string>("id");
  return lead ?? "";
}

describe("a try-on-only person who books", () => {
  it("becomes contactable, with the consent they gave recorded", async () => {
    await book();

    const person = await env.DB.prepare("SELECT contactable FROM people WHERE id = ?1").bind(PERSON).first();
    expect(person).toEqual({ contactable: 1 });
    const consent = await env.DB.prepare("SELECT purpose, granted FROM consents WHERE person_id = ?1")
      .bind(PERSON)
      .all();
    expect(consent.results).toContainEqual({ purpose: "whatsapp_visits", granted: 1 });
  });

  it("turns their CRM record into a New lead that may be contacted", async () => {
    const leadId = await book();
    const http = fakeFetch({
      "https://accounts.zoho.in/oauth/v2/token": () => json({ access_token: "access-1", expires_in: 3600 }),
      [LEADS_URL]: () => json({ data: [{ code: "SUCCESS", status: "success", details: { id: "zoho-7" } }] }),
    });
    const crm = createZohoCrm(SETTINGS, { db: env.DB, fetch: http.fetch, now: () => NOW, log: createLogger() });

    await syncLead(env.DB, fakeDependencies({ crm }), createLogger(), leadId);

    const write = http.calls.find((call) => call.url.startsWith(LEADS_URL) && call.method !== "GET");
    const [record] = (JSON.parse(write?.body ?? "{}") as { data: Record<string, unknown>[] }).data;
    expect(record).toMatchObject({ Contact_Consent: true, Lead_Status: "New", D1_Person_ID: PERSON });
  });
});
