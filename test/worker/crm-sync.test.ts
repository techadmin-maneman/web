import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eraseInCrm, handleCrmSyncBatch, syncLead } from "../../src/queues/crm-sync.ts";
import { createLogger } from "../../src/log.ts";
import type { CrmContact, CrmLead, CrmProvider } from "../../src/providers/crm/index.ts";
import {
  NOW,
  captureLogs,
  eraseByMobile,
  fakeDependencies,
  markDatabase,
  phaseOneLead,
  stubCrmThatFails,
} from "./helpers.ts";
import { MAX_SYNC_ATTEMPTS, QUICK_RETRY_DELAY_SECONDS } from "../../src/config/pipeline.ts";

const log = createLogger();

/** A CRM that remembers what it was asked. */
function recordingCrm(): CrmProvider & {
  calls: { lead: CrmLead; knownId: string | null }[];
  erasures: { personId: string; knownId: string | null }[];
  updates: { contact: CrmContact; knownId: string | null }[];
} {
  const calls: { lead: CrmLead; knownId: string | null }[] = [];
  const erasures: { personId: string; knownId: string | null }[] = [];
  const updates: { contact: CrmContact; knownId: string | null }[] = [];
  return {
    calls,
    erasures,
    updates,
    syncLead: (lead, knownId) => {
      calls.push({ lead, knownId });
      return Promise.resolve({ crmLeadId: knownId ?? "zoho-1", created: knownId === null });
    },
    erasePerson: (personId, knownId) => {
      erasures.push({ personId, knownId });
      return Promise.resolve({ found: knownId !== null });
    },
    updateContact: (contact, knownId) => {
      updates.push({ contact, knownId });
      return Promise.resolve({ crmLeadId: knownId ?? "zoho-found" });
    },
  };
}

function leadRow(leadId: string) {
  return env.DB.prepare("SELECT sync_state, sync_attempts, last_sync_error, synced_at FROM leads WHERE id = ?")
    .bind(leadId)
    .first<{ sync_state: string; sync_attempts: number; last_sync_error: string | null; synced_at: string | null }>();
}

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

  // The CRM could not tell an invited friend from an organic booking, nor the window a Phase 2 form booked
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

  it("sends no plan for a lead no Phase 2 booking made", async () => {
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

const openAlertKeys = () =>
  env.DB.prepare("SELECT key FROM alerts WHERE resolved_at IS NULL ORDER BY key")
    .all<{ key: string }>()
    .then((answer) => answer.results.map((row) => row.key));

describe("crm-sync: the queue batch", () => {
  function batchOf(bodies: unknown[]) {
    const messages = bodies.map((body, index) => ({
      id: `m-${String(index)}`,
      body,
      attempts: 1,
      timestamp: new Date(),
      ack: vi.fn(),
      retry: vi.fn(),
    }));
    return { queue: "mm-crm-sync-local", messages, ackAll: vi.fn(), retryAll: vi.fn() };
  }

  it("acknowledges a synced lead and sends a first failure back for a delayed retry", async () => {
    const ok = await phaseOneLead();
    const failing = await phaseOneLead("+919810000002", "Delhi");
    let call = 0;
    const crm: CrmProvider = {
      syncLead: () =>
        ++call === 1 ? Promise.resolve({ crmLeadId: "z", created: true }) : Promise.reject(new Error("down")),
      erasePerson: () => Promise.resolve({ found: false }),
      updateContact: () => Promise.resolve({ crmLeadId: null }),
    };
    const batch = batchOf([
      { lead_id: ok, request_id: "r1" },
      { lead_id: failing, request_id: "r2" },
    ]);

    await handleCrmSyncBatch(batch as unknown as MessageBatch, env.DB, fakeDependencies({ crm }), log);

    expect(batch.messages[0]?.ack).toHaveBeenCalledOnce();
    expect(batch.messages[0]?.retry).not.toHaveBeenCalled();
    expect(batch.messages[1]?.retry).toHaveBeenCalledWith({ delaySeconds: QUICK_RETRY_DELAY_SECONDS });
    expect(batch.messages[1]?.ack).not.toHaveBeenCalled();
    expect((await leadRow(ok))?.sync_state).toBe("synced");
    expect((await leadRow(failing))?.sync_state).toBe("failed");
  });

  it("acknowledges a failure after the first, leaving it to the sweeper", async () => {
    const leadId = await phaseOneLead();
    await env.DB.prepare("UPDATE leads SET sync_attempts = 1 WHERE id = ?").bind(leadId).run();
    const batch = batchOf([{ lead_id: leadId, request_id: "sweeper" }]);

    await handleCrmSyncBatch(
      batch as unknown as MessageBatch,
      env.DB,
      fakeDependencies({ crm: stubCrmThatFails("down") }),
      log,
    );

    expect(batch.messages[0]?.ack).toHaveBeenCalledOnce();
    expect(batch.messages[0]?.retry).not.toHaveBeenCalled();
  });

  it("acknowledges an erasure once the CRM record is blanked", async () => {
    await phaseOneLead();
    const summary = await eraseByMobile("+919810000001", NOW);
    const personId = summary?.personId ?? "";
    const crm = recordingCrm();
    const batch = batchOf([{ erase_person_id: personId, request_id: "r1" }]);

    await handleCrmSyncBatch(batch as unknown as MessageBatch, env.DB, fakeDependencies({ crm }), log);

    expect(crm.erasures).toEqual([{ personId, knownId: null }]);
    expect(batch.messages[0]?.ack).toHaveBeenCalledOnce();
  });

  // A D1 read outside any catch rejected the whole batch, and every message came back at once.
  it("tries again a message D1 failed, and still syncs the rest of the batch", async () => {
    const ok = await phaseOneLead();
    let failed = false;
    const flaky = new Proxy(env.DB, {
      get(target, key) {
        if (key === "prepare" && !failed) {
          failed = true;
          return () => {
            throw new Error("D1_ERROR: Network connection lost.");
          };
        }
        const value: unknown = Reflect.get(target, key);
        return typeof value === "function" ? (value.bind(target) as unknown) : value;
      },
    });
    const batch = batchOf([
      { lead_id: "00000000-0000-4000-8000-000000000000", request_id: "r1" },
      { lead_id: ok, request_id: "r2" },
    ]);

    await handleCrmSyncBatch(batch as unknown as MessageBatch, flaky, fakeDependencies(), log);

    expect(batch.messages[0]?.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(batch.messages[1]?.ack).toHaveBeenCalledOnce();
    expect((await leadRow(ok))?.sync_state).toBe("synced");
  });

  it("drops a malformed message instead of retrying it forever", async () => {
    const batch = batchOf([{ lead: "nope" }]);
    await handleCrmSyncBatch(batch as unknown as MessageBatch, env.DB, fakeDependencies(), log);
    expect(batch.messages[0]?.ack).toHaveBeenCalledOnce();
  });
});

describe("crm-sync: erasing a person", () => {
  /** A person whose lead reached the CRM as zoho-1, then erased. */
  async function erasedPerson(): Promise<string> {
    const leadId = await phaseOneLead();
    await syncLead(env.DB, fakeDependencies({ crm: recordingCrm() }), log, leadId);
    return (await eraseByMobile("+919810000001", NOW))?.personId ?? "";
  }

  function erasure(personId: string) {
    return env.DB.prepare("SELECT crm_erased_at, crm_erasure_attempts, crm_erasure_error FROM people WHERE id = ?")
      .bind(personId)
      .first();
  }

  it("blanks the CRM record it knows, once, however often the message comes", async () => {
    const personId = await erasedPerson();
    const crm = recordingCrm();
    const deps = fakeDependencies({ crm });

    expect(await eraseInCrm(env.DB, deps, log, personId)).toEqual({ retrySoon: false });
    await eraseInCrm(env.DB, deps, log, personId); // a duplicate message

    expect(crm.erasures).toEqual([{ personId, knownId: "zoho-1" }]);
    expect(await erasure(personId)).toEqual({
      crm_erased_at: NOW.toISOString(),
      crm_erasure_attempts: 1,
      crm_erasure_error: null,
    });
  });

  it("keeps a scrubbed error, retries the first failure soon, and alerts at the last attempt", async () => {
    const personId = await erasedPerson();
    const deps = fakeDependencies({ crm: stubCrmThatFails("Zoho 500 INTERNAL_ERROR: rejected +91 98100 00001") });

    expect(await eraseInCrm(env.DB, deps, log, personId)).toEqual({ retrySoon: true });
    expect(await erasure(personId)).toEqual({
      crm_erased_at: null,
      crm_erasure_attempts: 1,
      crm_erasure_error: "Zoho 500 INTERNAL_ERROR: rejected [redacted]",
    });
    expect(await eraseInCrm(env.DB, deps, log, personId)).toEqual({ retrySoon: false });
    expect(deps.alerts).toEqual([]);

    await env.DB.prepare("UPDATE people SET crm_erasure_attempts = ? WHERE id = ?")
      .bind(MAX_SYNC_ATTEMPTS - 1, personId)
      .run();
    await eraseInCrm(env.DB, deps, log, personId);
    expect(deps.alerts).toEqual([
      expect.stringContaining(`Erasing person ${personId} in the CRM failed 10 times`) as string,
    ]);
    expect(await openAlertKeys()).toEqual([`crm_erasure:${personId}`]);

    await eraseInCrm(env.DB, fakeDependencies(), log, personId);
    expect(await openAlertKeys()).toEqual([]);
  });

  it("does nothing for a person who was never erased", async () => {
    await phaseOneLead();
    const person = await env.DB.prepare("SELECT id FROM people").first<{ id: string }>();
    const crm = recordingCrm();

    expect(await eraseInCrm(env.DB, fakeDependencies({ crm }), log, person?.id ?? "")).toEqual({ retrySoon: false });

    expect(crm.erasures).toEqual([]);
    expect(logs.lines()).toContainEqual(expect.objectContaining({ event: "crm_erasure_unknown_person" }));
  });

  it("never sends an erased person's lead to the CRM, and gives it up at once", async () => {
    const leadId = await phaseOneLead();
    await eraseByMobile("+919810000001", NOW);
    const crm = recordingCrm();

    expect(await syncLead(env.DB, fakeDependencies({ crm }), log, leadId)).toEqual({ retrySoon: false });

    expect(crm.calls).toEqual([]);
    expect(await leadRow(leadId)).toMatchObject({
      sync_state: "failed",
      sync_attempts: MAX_SYNC_ATTEMPTS,
      last_sync_error: "person erased",
    });
  });

  /** A CRM that syncs the lead, but the person is erased while it does. */
  function crmErasingDuringSync(erase: CrmProvider["erasePerson"]) {
    const crm = recordingCrm();
    return {
      ...crm,
      syncLead: async (lead: CrmLead, knownId: string | null) => {
        await eraseByMobile("+919810000001", NOW);
        return crm.syncLead(lead, knownId);
      },
      erasePerson: erase,
    };
  }

  it("blanks the record again when the person is erased while their lead is on its way", async () => {
    const leadId = await phaseOneLead();
    const erasures: (string | null)[] = [];
    const crm = crmErasingDuringSync((_personId, knownId) => {
      erasures.push(knownId);
      return Promise.resolve({ found: true });
    });
    const deps = fakeDependencies({ crm });

    expect(await syncLead(env.DB, deps, log, leadId)).toEqual({ retrySoon: false });

    expect(erasures).toEqual(["zoho-1"]);
    expect((await leadRow(leadId))?.sync_state).toBe("synced");
    expect(deps.leadNotices).toEqual([]);
  });

  it("leaves the sweeper to blank it when that second erasure fails", async () => {
    const leadId = await phaseOneLead();
    const crm = crmErasingDuringSync(() => Promise.reject(new Error("Zoho 503 down")));

    await syncLead(env.DB, fakeDependencies({ crm }), log, leadId);

    const person = await env.DB.prepare("SELECT crm_erased_at, crm_erasure_error FROM people").first();
    expect(person).toEqual({ crm_erased_at: null, crm_erasure_error: "Zoho 503 down" });
    expect((await leadRow(leadId))?.sync_state).toBe("synced");
  });
});

// A confirmed change of number stayed in D1, and the CRM lead kept the old one. An invite ops attach is
// sent the same way (docs/decisions/0089-an-invite-is-not-lost.md).
describe("crm-sync: a changed number, address or invite", () => {
  const PERSON = "44444444-4444-4444-8444-444444444444";

  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO people (id, created_at, mobile_e164, name, zoho_lead_id)
         VALUES (?1, ?2, '+919810000003', 'Rohit Malhotra', 'zoho-9')`,
      ).bind(PERSON, NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode)
         VALUES ('address-1', ?1, ?2, 'House 12', 'Sector 65', 'Gurgaon', '122018')`,
      ).bind(PERSON, NOW.toISOString()),
    ]);
  });

  function update(crm: CrmProvider, attempts = 1, more: { invite_attached?: true } = {}) {
    const body = { update_person_id: PERSON, request_id: "r", ...more };
    const message = { id: "m1", body, attempts, ack: vi.fn(), retry: vi.fn() };
    const batch = { queue: "mm-crm-sync-local", messages: [message], ackAll: vi.fn(), retryAll: vi.fn() };
    const deps = fakeDependencies({ crm });
    return { message, deps, done: handleCrmSyncBatch(batch as unknown as MessageBatch, env.DB, deps, log) };
  }

  it("writes the person's number and city, as D1 has them now, onto their record", async () => {
    const crm = recordingCrm();
    const { message, done } = update(crm);
    await done;
    expect(crm.updates).toEqual([
      {
        contact: {
          personId: PERSON,
          mobileE164: "+919810000003",
          city: "Gurgaon",
          inviteCode: null,
          inviteAttached: false,
        },
        knownId: "zoho-9",
      },
    ]);
    expect(message.ack).toHaveBeenCalled();
  });

  it("writes the invite the person now carries, as ops attached it", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO people (id, created_at, mobile_e164, name)
         VALUES ('55555555-5555-4555-8555-555555555555', ?1, '+919810000004', 'Vikram Sethi')`,
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO referral_codes (code, person_id, created_at, updated_at)
         VALUES ('VSAB23', '55555555-5555-4555-8555-555555555555', ?1, ?1)`,
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO referral_attributions (id, code, referred_person_id, first_touch_at, via, attached_by,
           attach_reason, created_at, updated_at)
         VALUES ('attr-1', 'VSAB23', ?1, ?2, 'consultation', 'ops@localhost', 'Named Vikram', ?2, ?2)`,
      ).bind(PERSON, NOW.toISOString()),
    ]);
    const crm = recordingCrm();
    await update(crm, 1, { invite_attached: true }).done;
    expect(crm.updates).toMatchObject([{ contact: { personId: PERSON, inviteCode: "VSAB23", inviteAttached: true } }]);
  });

  it("writes nothing for a person erased since", async () => {
    await env.DB.prepare("UPDATE people SET erased_at = ?2 WHERE id = ?1").bind(PERSON, NOW.toISOString()).run();
    const crm = recordingCrm();
    await update(crm).done;
    expect(crm.updates).toEqual([]);
  });

  it("tries again, and tells ops once the fifth try fails", async () => {
    const failing = update(stubCrmThatFails("Zoho 500 down"));
    await failing.done;
    expect(failing.message.retry).toHaveBeenCalled();

    const last = update(stubCrmThatFails("Zoho 500 down"), 5);
    await last.done;
    expect(last.message.ack).toHaveBeenCalled();
    expect(last.deps.alerts).toEqual([
      expect.stringContaining(`Client ${PERSON}'s new number, city or invite`) as string,
    ]);
  });
});
