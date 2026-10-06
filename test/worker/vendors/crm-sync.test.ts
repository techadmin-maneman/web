import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { syncLead } from "../../../src/queues/crm-sync.ts";
import { NOW, captureLogs, fakeDependencies, markDatabase, phaseOneLead, stubCrmThatFails } from "../helpers.ts";
import { MAX_SYNC_ATTEMPTS } from "../../../src/config/pipeline.ts";
import { log, recordingCrm, leadRow, openAlertKeys } from "./crm-sync-fixtures.ts";

let logs: ReturnType<typeof captureLogs>;

beforeEach(async () => {
  await markDatabase();
  logs = captureLogs();
});

describe("crm-sync: syncing a lead", () => {
  it("sends the CRM what D1 holds, stores the CRM's ID and marks the lead synced", async () => {
    const leadId = await phaseOneLead();
    const crm = recordingCrm();

    expect(await syncLead(env.DB, fakeDependencies({ crm }), log, leadId)).toEqual({ retrySoon: false });

    expect(logs.lines()).toContainEqual(
      expect.objectContaining({
        event: "crm_synced",
        lead_id: leadId,
        duration_ms: expect.any(Number) as number,
        read_ms: expect.any(Number) as number,
        claim_ms: expect.any(Number) as number,
      }),
    );
    expect(crm.calls).toHaveLength(1);
    expect(crm.calls[0]?.knownId).toBeNull();
    expect(crm.calls[0]?.lead).toMatchObject({
      leadId,
      name: "Arjun Mehta",
      mobileE164: "+919810000001",
      source: "form",
      city: "Gurgaon",
      contactable: true,
      tryOn: false,
      proposedVisitDate: "2026-09-23",
    });
    expect(await leadRow(leadId)).toMatchObject({ sync_state: "synced", sync_attempts: 1, last_sync_error: null });
    const person = await env.DB.prepare("SELECT zoho_lead_id FROM people").first();
    expect(person).toEqual({ zoho_lead_id: "zoho-1" });
  });

  // An invited friend is never asked where the hair loss is, so their lead carries
  // none and the CRM record simply leaves the field empty
  // (docs/decisions/0060-an-invited-friend-reaches-ops-and-the-crm.md).
  it("syncs a lead that names no loss extent", async () => {
    const leadId = await phaseOneLead();
    await env.DB.prepare("UPDATE leads SET loss_extent = NULL WHERE id = ?1").bind(leadId).run();
    const crm = recordingCrm();

    expect(await syncLead(env.DB, fakeDependencies({ crm }), log, leadId)).toEqual({ retrySoon: false });

    expect(crm.calls[0]?.lead).toMatchObject({ leadId, lossExtent: null });
    expect(await leadRow(leadId)).toMatchObject({ sync_state: "synced", last_sync_error: null });
  });

  // The CRM could not tell an invited friend from an organic booking, nor the window a booking held
  // (ADR 0060 says marketing sees "the person, the source, the day and the invite").
  it("sends the invite a friend came with, and the window their booking asked for", async () => {
    const leadId = await phaseOneLead();
    const person = await env.DB.prepare("SELECT id FROM people").first<string>("id");
    await env.DB.batch([
      env.DB.prepare("UPDATE leads SET first_choice_window = NULL, proposed_visit_date = '2026-09-24'"),
      env.DB.prepare(
        `INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('referrer-1', ?1, '+919810000009', 'Rohit Malhotra')`,
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        "INSERT INTO referral_codes (code, person_id, created_at, updated_at) VALUES ('RM7K2Q', 'referrer-1', ?1, ?1)",
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO referral_attributions (id, code, referred_person_id, first_touch_at, via, created_at, updated_at)
         VALUES ('referral-1', 'RM7K2Q', ?1, ?2, 'consultation', ?2, ?2)`,
      ).bind(person, NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO consultation_requests (id, person_id, pincode, requested_date, requested_window, created_at)
         VALUES ('request-1', ?1, '122018', '2026-09-24', 'afternoon', ?2)`,
      ).bind(person, NOW.toISOString()),
    ]);
    const crm = recordingCrm();

    await syncLead(env.DB, fakeDependencies({ crm }), log, leadId);

    expect(crm.calls[0]?.lead).toMatchObject({ inviteCode: "RM7K2Q", askedWindow: "afternoon" });
  });

  // While booking is off, the lead carried neither the one visit nor the code given for it.
  it("sends the plan the request asked for, and the code given for a one visit", async () => {
    const leadId = await phaseOneLead();
    const person = await env.DB.prepare("SELECT id FROM people").first<string>("id");
    await env.DB.prepare(
      `INSERT INTO consultation_requests (id, person_id, pincode, requested_date, requested_window, created_at,
         one_visit, discount_code)
       VALUES ('request-1', ?1, '122018', '2026-09-23', 'morning', ?2, 1, 'TENPC')`,
    )
      .bind(person, NOW.toISOString())
      .run();
    const crm = recordingCrm();

    await syncLead(env.DB, fakeDependencies({ crm }), log, leadId);

    expect(crm.calls[0]?.lead).toMatchObject({ plan: "one_visit", discountCode: "TENPC" });
  });

  it("sends no plan for a lead no booking made", async () => {
    const leadId = await phaseOneLead();
    const crm = recordingCrm();

    await syncLead(env.DB, fakeDependencies({ crm }), log, leadId);

    expect(crm.calls[0]?.lead).toMatchObject({ plan: null, discountCode: null });
  });

  it("posts a new-lead notice once the lead is in the CRM, with no personal data, and never twice", async () => {
    const leadId = await phaseOneLead();
    const deps = fakeDependencies({ crm: recordingCrm() });

    await syncLead(env.DB, deps, log, leadId);
    await syncLead(env.DB, deps, log, leadId); // a duplicate message

    expect(deps.leadNotices).toEqual([
      `New booking: Gurgaon, weekday morning, proposed Wed 23 Sep. Lead ${leadId.slice(0, 8)}.`,
    ]);
    expect(deps.leadNotices.join()).not.toMatch(/Arjun|9810000001/);
  });

  it("posts no notice while the CRM is failing", async () => {
    const leadId = await phaseOneLead();
    const deps = fakeDependencies({ crm: stubCrmThatFails("Zoho 503 down") });
    await syncLead(env.DB, deps, log, leadId);
    expect(deps.leadNotices).toEqual([]);
  });

  it("passes the stored CRM ID for a returning person, so the CRM updates instead of inserting", async () => {
    const first = await phaseOneLead();
    const crm = recordingCrm();
    await syncLead(env.DB, fakeDependencies({ crm }), log, first);
    const second = await phaseOneLead(undefined, "Mumbai");
    await syncLead(env.DB, fakeDependencies({ crm }), log, second);
    expect(crm.calls[1]?.knownId).toBe("zoho-1");
  });

  it("ignores a duplicate message for a lead already synced", async () => {
    const leadId = await phaseOneLead();
    const crm = recordingCrm();
    await syncLead(env.DB, fakeDependencies({ crm }), log, leadId);
    await syncLead(env.DB, fakeDependencies({ crm }), log, leadId);
    expect(crm.calls).toHaveLength(1);
  });

  it("marks a first failure, keeps a scrubbed error, and asks for a quick retry", async () => {
    const leadId = await phaseOneLead();
    const deps = fakeDependencies({ crm: stubCrmThatFails("Zoho 500 INTERNAL_ERROR: rejected +91 98100 00001") });

    expect(await syncLead(env.DB, deps, log, leadId)).toEqual({ retrySoon: true });

    const row = await leadRow(leadId);
    expect(row).toMatchObject({ sync_state: "failed", sync_attempts: 1, synced_at: null });
    expect(row?.last_sync_error).toBe("Zoho 500 INTERNAL_ERROR: rejected [redacted]");
    expect(deps.alerts).toEqual([]);
  });

  it("leaves later failures to the sweeper", async () => {
    const leadId = await phaseOneLead();
    const deps = fakeDependencies({ crm: stubCrmThatFails("Zoho 0 TIMEOUT: token got no answer within 20 s") });
    await syncLead(env.DB, deps, log, leadId);

    expect(await syncLead(env.DB, deps, log, leadId)).toEqual({ retrySoon: false });
    expect((await leadRow(leadId))?.sync_attempts).toBe(2);
  });

  it(`alerts once the lead has failed ${String(MAX_SYNC_ATTEMPTS)} times`, async () => {
    const leadId = await phaseOneLead();
    await env.DB.prepare("UPDATE leads SET sync_attempts = ? WHERE id = ?")
      .bind(MAX_SYNC_ATTEMPTS - 1, leadId)
      .run();
    const deps = fakeDependencies({
      crm: stubCrmThatFails("Zoho 401 invalid_code: could not refresh the access token"),
    });

    await syncLead(env.DB, deps, log, leadId);

    const personId = await env.DB.prepare("SELECT person_id FROM leads WHERE id = ?1").bind(leadId).first("person_id");
    expect(deps.alerts).toEqual([
      `Lead ${leadId} did not reach the CRM after 10 attempts: Zoho 401 invalid_code: could not refresh the access ` +
        `token. Send it again from Tasks once Zoho is back. http://ops.localhost:4323/clients/${String(personId)}`,
    ]);
    expect(await openAlertKeys()).toEqual([`crm_lead:${leadId}`]);
  });

  it("closes the lead's alert once a later try reaches the CRM", async () => {
    const leadId = await phaseOneLead();
    await env.DB.prepare("UPDATE leads SET sync_attempts = ? WHERE id = ?")
      .bind(MAX_SYNC_ATTEMPTS - 1, leadId)
      .run();
    await syncLead(env.DB, fakeDependencies({ crm: stubCrmThatFails("Zoho 503") }), log, leadId);
    await env.DB.prepare("UPDATE leads SET sync_attempts = 0 WHERE id = ?").bind(leadId).run();

    await syncLead(env.DB, fakeDependencies(), log, leadId);

    expect(await openAlertKeys()).toEqual([]);
  });
});

// The try-on's gate promises no marketing, so its leads stay out of the CRM, where sales work.
describe("crm-sync: a try-on", () => {
  /** The lead the gate leaves for this number, the person made if they are new. */
  async function tryOnLead(mobileE164 = "+919810000001"): Promise<string> {
    const leadId = crypto.randomUUID();
    const at = NOW.toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO people (id, created_at, mobile_e164, name, contactable) VALUES (?1, ?2, ?3, 'Arjun Mehta', 0)
         ON CONFLICT (mobile_e164) DO NOTHING`,
      ).bind(crypto.randomUUID(), at, mobileE164),
      env.DB.prepare(
        `INSERT INTO leads (id, person_id, created_at, source, loss_extent, request_id)
         VALUES (?1, (SELECT id FROM people WHERE mobile_e164 = ?2), ?3, 'tryon', 'crown', 'test')`,
      ).bind(leadId, mobileE164, at),
    ]);
    return leadId;
  }

  it("never reaches the CRM: its lead is closed, and the chat is told once that it is not to be chased", async () => {
    const leadId = await tryOnLead();
    const crm = recordingCrm();
    const deps = fakeDependencies({ crm });

    expect(await syncLead(env.DB, deps, log, leadId)).toEqual({ retrySoon: false });
    await syncLead(env.DB, deps, log, leadId); // a duplicate message

    expect(crm.calls).toEqual([]);
    expect(await leadRow(leadId)).toMatchObject({ sync_state: "synced", sync_attempts: 0, last_sync_error: null });
    expect(deps.leadNotices).toEqual([
      `New try-on lead: WhatsApp copy only, not to be chased. Lead ${leadId.slice(0, 8)}.`,
    ]);
  });

  it("keeps a client's try-on out too, leaving their record as their bookings made it", async () => {
    const booking = await phaseOneLead();
    const crm = recordingCrm();
    await syncLead(env.DB, fakeDependencies({ crm }), log, booking);
    const tryOn = await tryOnLead();
    const deps = fakeDependencies({ crm });

    await syncLead(env.DB, deps, log, tryOn);

    expect(crm.calls.map((call) => call.lead.leadId)).toEqual([booking]);
    expect(deps.leadNotices).toEqual([
      `New try-on lead: WhatsApp copy only, not to be chased. Lead ${tryOn.slice(0, 8)}.`,
    ]);
  });

  it("is ticked on the person's first CRM record, which a later booking makes", async () => {
    const tryOn = await tryOnLead();
    const crm = recordingCrm();
    await syncLead(env.DB, fakeDependencies({ crm }), log, tryOn);
    const booking = await phaseOneLead();

    await syncLead(env.DB, fakeDependencies({ crm }), log, booking);

    expect(crm.calls).toHaveLength(1);
    expect(crm.calls[0]?.knownId).toBeNull();
    expect(crm.calls[0]?.lead).toMatchObject({ leadId: booking, source: "form", contactable: true, tryOn: true });
  });
});
