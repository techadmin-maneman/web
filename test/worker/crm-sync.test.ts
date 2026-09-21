import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_SYNC_ATTEMPTS, handleCrmSyncBatch, syncLead } from "../../src/queues/crm-sync.ts";
import { createLogger } from "../../src/log.ts";
import type { CrmLead, CrmProvider } from "../../src/providers/crm.ts";
import {
  appFor,
  captureLogs,
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
function recordingCrm(): CrmProvider & { calls: { lead: CrmLead; knownId: string | null }[] } {
  const calls: { lead: CrmLead; knownId: string | null }[] = [];
  return {
    calls,
    syncLead: (lead, knownId) => {
      calls.push({ lead, knownId });
      return Promise.resolve({ crmLeadId: knownId ?? "zoho-1", created: knownId === null });
    },
  };
}

function leadRow(leadId: string) {
  return env.DB.prepare("SELECT sync_state, sync_attempts, last_sync_error, synced_at FROM leads WHERE id = ?")
    .bind(leadId)
    .first<{ sync_state: string; sync_attempts: number; last_sync_error: string | null; synced_at: string | null }>();
}

beforeEach(async () => {
  await markDatabase();
  captureLogs();
});

describe("crm-sync: syncing a lead", () => {
  it("sends the CRM what D1 holds, stores the CRM's ID and marks the lead synced", async () => {
    const leadId = await bookLead();
    const crm = recordingCrm();

    await syncLead(env.DB, fakeDependencies({ crm }), log, leadId);

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

  it("marks a failure, keeps a scrubbed error, and leaves the retry to the sweeper", async () => {
    const leadId = await bookLead();
    const deps = fakeDependencies({ crm: stubCrmThatFails("Zoho 500 INTERNAL_ERROR: rejected +91 98100 00001") });

    await syncLead(env.DB, deps, log, leadId);

    const row = await leadRow(leadId);
    expect(row).toMatchObject({ sync_state: "failed", sync_attempts: 1, synced_at: null });
    expect(row?.last_sync_error).toBe("Zoho 500 INTERNAL_ERROR: rejected [redacted]");
    expect(deps.alerts).toEqual([]);
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

  it("syncs each message and acknowledges it, including one that fails", async () => {
    const ok = await bookLead();
    const failing = await bookLead("Delhi", "9810000002");
    let call = 0;
    const crm: CrmProvider = {
      syncLead: () =>
        ++call === 1 ? Promise.resolve({ crmLeadId: "z", created: true }) : Promise.reject(new Error("down")),
    };
    const batch = batchOf([
      { lead_id: ok, request_id: "r1" },
      { lead_id: failing, request_id: "r2" },
    ]);

    await handleCrmSyncBatch(batch as unknown as MessageBatch, env.DB, fakeDependencies({ crm }), log);

    expect(batch.messages.every((message) => message.ack.mock.calls.length === 1)).toBe(true);
    expect((await leadRow(ok))?.sync_state).toBe("synced");
    expect((await leadRow(failing))?.sync_state).toBe("failed");
  });

  it("drops a malformed message instead of retrying it forever", async () => {
    const batch = batchOf([{ lead: "nope" }]);
    await handleCrmSyncBatch(batch as unknown as MessageBatch, env.DB, fakeDependencies(), log);
    expect(batch.messages[0]?.ack).toHaveBeenCalledOnce();
  });
});
