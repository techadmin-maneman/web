import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_SYNC_ATTEMPTS,
  QUICK_RETRY_DELAY_SECONDS,
  eraseInCrm,
  handleCrmSyncBatch,
  syncLead,
} from "../../src/queues/crm-sync.ts";
import { createLogger } from "../../src/log.ts";
import type { CrmLead, CrmProvider } from "../../src/providers/crm.ts";
import {
  NOW,
  appFor,
  captureLogs,
  eraseByMobile,
  fakeDependencies,
  fakeQueue,
  markDatabase,
  request,
  stubCrmThatFails,
} from "./helpers.ts";

const log = createLogger();

async function bookLead(city = "Gurgaon", mobile = "9810000001"): Promise<string> {
  const res = await request(
    appFor(),
    "/api/lead",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Arjun Mehta",
        mobile,
        city,
        first_choice_window: "weekday_am",
        loss_extent: "crown",
        consent: true,
        turnstile_token: "token",
      }),
    },
    { CRM_QUEUE: fakeQueue() },
  );
  return (await res.json<{ lead_id: string }>()).lead_id;
}

/** A CRM that remembers what it was asked. */
function recordingCrm(): CrmProvider & {
  calls: { lead: CrmLead; knownId: string | null }[];
  erasures: { personId: string; knownId: string | null }[];
} {
  const calls: { lead: CrmLead; knownId: string | null }[] = [];
  const erasures: { personId: string; knownId: string | null }[] = [];
  return {
    calls,
    erasures,
    syncLead: (lead, knownId) => {
      calls.push({ lead, knownId });
      return Promise.resolve({ crmLeadId: knownId ?? "zoho-1", created: knownId === null });
    },
    erasePerson: (personId, knownId) => {
      erasures.push({ personId, knownId });
      return Promise.resolve({ found: knownId !== null });
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
    const leadId = await bookLead();
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
    const leadId = await bookLead();
    await env.DB.prepare("UPDATE leads SET loss_extent = NULL WHERE id = ?1").bind(leadId).run();
    const crm = recordingCrm();

    expect(await syncLead(env.DB, fakeDependencies({ crm }), log, leadId)).toEqual({ retrySoon: false });

    expect(crm.calls[0]?.lead).toMatchObject({ leadId, lossExtent: null });
    expect(await leadRow(leadId)).toMatchObject({ sync_state: "synced", last_sync_error: null });
  });

  it("posts a new-lead notice once the lead is in the CRM, with no personal data, and never twice", async () => {
    const leadId = await bookLead();
    const deps = fakeDependencies({ crm: recordingCrm() });

    await syncLead(env.DB, deps, log, leadId);
    await syncLead(env.DB, deps, log, leadId); // a duplicate message

    expect(deps.leadNotices).toEqual([
      `New booking: Gurgaon, weekday morning, proposed Wed 23 Sep. Lead ${leadId.slice(0, 8)}.`,
    ]);
    expect(deps.leadNotices.join()).not.toMatch(/Arjun|9810000001/);
  });

  it("posts no notice while the CRM is failing", async () => {
    const leadId = await bookLead();
    const deps = fakeDependencies({ crm: stubCrmThatFails("Zoho 503 down") });
    await syncLead(env.DB, deps, log, leadId);
    expect(deps.leadNotices).toEqual([]);
  });

  it("passes the stored CRM ID for a returning person, so the CRM updates instead of inserting", async () => {
    const first = await bookLead();
    const crm = recordingCrm();
    await syncLead(env.DB, fakeDependencies({ crm }), log, first);
    const second = await bookLead("Mumbai");
    await syncLead(env.DB, fakeDependencies({ crm }), log, second);
    expect(crm.calls[1]?.knownId).toBe("zoho-1");
  });

  it("ignores a duplicate message for a lead already synced", async () => {
    const leadId = await bookLead();
    const crm = recordingCrm();
    await syncLead(env.DB, fakeDependencies({ crm }), log, leadId);
    await syncLead(env.DB, fakeDependencies({ crm }), log, leadId);
    expect(crm.calls).toHaveLength(1);
  });

  it("marks a first failure, keeps a scrubbed error, and asks for a quick retry", async () => {
    const leadId = await bookLead();
    const deps = fakeDependencies({ crm: stubCrmThatFails("Zoho 500 INTERNAL_ERROR: rejected +91 98100 00001") });

    expect(await syncLead(env.DB, deps, log, leadId)).toEqual({ retrySoon: true });

    const row = await leadRow(leadId);
    expect(row).toMatchObject({ sync_state: "failed", sync_attempts: 1, synced_at: null });
    expect(row?.last_sync_error).toBe("Zoho 500 INTERNAL_ERROR: rejected [redacted]");
    expect(deps.alerts).toEqual([]);
  });

  it("leaves later failures to the sweeper", async () => {
    const leadId = await bookLead();
    const deps = fakeDependencies({ crm: stubCrmThatFails("Zoho 0 TIMEOUT: token got no answer within 20 s") });
    await syncLead(env.DB, deps, log, leadId);

    expect(await syncLead(env.DB, deps, log, leadId)).toEqual({ retrySoon: false });
    expect((await leadRow(leadId))?.sync_attempts).toBe(2);
  });

  it(`alerts once the lead has failed ${String(MAX_SYNC_ATTEMPTS)} times`, async () => {
    const leadId = await bookLead();
    await env.DB.prepare("UPDATE leads SET sync_attempts = ? WHERE id = ?")
      .bind(MAX_SYNC_ATTEMPTS - 1, leadId)
      .run();
    const deps = fakeDependencies({
      crm: stubCrmThatFails("Zoho 401 invalid_code: could not refresh the access token"),
    });

    await syncLead(env.DB, deps, log, leadId);

    expect(deps.alerts).toEqual([
      `Lead ${leadId} did not reach the CRM after 10 attempts: Zoho 401 invalid_code: could not refresh the access token`,
    ]);
  });
});

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
    const ok = await bookLead();
    const failing = await bookLead("Delhi", "9810000002");
    let call = 0;
    const crm: CrmProvider = {
      syncLead: () =>
        ++call === 1 ? Promise.resolve({ crmLeadId: "z", created: true }) : Promise.reject(new Error("down")),
      erasePerson: () => Promise.resolve({ found: false }),
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
    const leadId = await bookLead();
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
    await bookLead();
    const summary = await eraseByMobile("+919810000001", NOW);
    const personId = summary?.personId ?? "";
    const crm = recordingCrm();
    const batch = batchOf([{ erase_person_id: personId, request_id: "r1" }]);

    await handleCrmSyncBatch(batch as unknown as MessageBatch, env.DB, fakeDependencies({ crm }), log);

    expect(crm.erasures).toEqual([{ personId, knownId: null }]);
    expect(batch.messages[0]?.ack).toHaveBeenCalledOnce();
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
    const leadId = await bookLead();
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
  });

  it("does nothing for a person who was never erased", async () => {
    await bookLead();
    const person = await env.DB.prepare("SELECT id FROM people").first<{ id: string }>();
    const crm = recordingCrm();

    expect(await eraseInCrm(env.DB, fakeDependencies({ crm }), log, person?.id ?? "")).toEqual({ retrySoon: false });

    expect(crm.erasures).toEqual([]);
    expect(logs.lines()).toContainEqual(expect.objectContaining({ event: "crm_erasure_unknown_person" }));
  });

  it("never sends an erased person's lead to the CRM, and gives it up at once", async () => {
    const leadId = await bookLead();
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
    const leadId = await bookLead();
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
    const leadId = await bookLead();
    const crm = crmErasingDuringSync(() => Promise.reject(new Error("Zoho 503 down")));

    await syncLead(env.DB, fakeDependencies({ crm }), log, leadId);

    const person = await env.DB.prepare("SELECT crm_erased_at, crm_erasure_error FROM people").first();
    expect(person).toEqual({ crm_erased_at: null, crm_erasure_error: "Zoho 503 down" });
    expect((await leadRow(leadId))?.sync_state).toBe("synced");
  });
});
