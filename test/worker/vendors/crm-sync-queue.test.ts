import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { eraseInCrm, handleCrmSyncBatch, syncLead } from "../../../src/queues/crm-sync.ts";
import type { CrmLead, CrmProvider } from "../../../src/providers/crm/index.ts";
import {
  NOW,
  captureLogs,
  eraseByMobile,
  fakeDependencies,
  markDatabase,
  phaseOneLead,
  stubCrmThatFails,
} from "../helpers.ts";
import { fakeBatch } from "../batches.ts";
import { MAX_SYNC_ATTEMPTS, QUICK_RETRY_DELAY_SECONDS } from "../../../src/config/pipeline.ts";
import { log, recordingCrm, leadRow, openAlertKeys } from "./crm-sync-fixtures.ts";

let logs: ReturnType<typeof captureLogs>;

beforeEach(async () => {
  await markDatabase();
  logs = captureLogs();
});

describe("crm-sync: the queue batch", () => {
  const batchOf = (bodies: unknown[]) => fakeBatch("mm-crm-sync-local", bodies);

  it("acknowledges a synced lead and sends a first failure back for a delayed retry", async () => {
    const ok = await phaseOneLead();
    const failing = await phaseOneLead("+919810000002", "Delhi");
    let call = 0;
    const crm: CrmProvider = {
      syncLead: () =>
        ++call === 1 ? Promise.resolve({ crmLeadId: "z", created: true }) : Promise.reject(new Error("down")),
      erasePerson: () => Promise.resolve({ found: false }),
      eraseContact: () => Promise.resolve({ found: false }),
      updateContact: () => Promise.resolve({ crmLeadId: null }),
    };
    const batch = batchOf([
      { lead_id: ok, request_id: "r1" },
      { lead_id: failing, request_id: "r2" },
    ]);

    await handleCrmSyncBatch(batch, env.DB, fakeDependencies({ crm }), log);

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

    await handleCrmSyncBatch(batch, env.DB, fakeDependencies({ crm: stubCrmThatFails("down") }), log);

    expect(batch.messages[0]?.ack).toHaveBeenCalledOnce();
    expect(batch.messages[0]?.retry).not.toHaveBeenCalled();
  });

  it("acknowledges an erasure once the CRM record is blanked", async () => {
    await phaseOneLead();
    const summary = await eraseByMobile("+919810000001", NOW);
    const personId = summary?.personId ?? "";
    const crm = recordingCrm();
    const batch = batchOf([{ erase_person_id: personId, request_id: "r1" }]);

    await handleCrmSyncBatch(batch, env.DB, fakeDependencies({ crm }), log);

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

    await handleCrmSyncBatch(batch, flaky, fakeDependencies(), log);

    expect(batch.messages[0]?.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(batch.messages[1]?.ack).toHaveBeenCalledOnce();
    expect((await leadRow(ok))?.sync_state).toBe("synced");
  });

  it("drops a malformed message instead of retrying it forever", async () => {
    const batch = batchOf([{ lead: "nope" }]);
    await handleCrmSyncBatch(batch, env.DB, fakeDependencies(), log);
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
    const batch = fakeBatch("mm-crm-sync-local", [body], { attempts });
    const [message] = batch.messages;
    if (message === undefined) throw new Error("the batch holds no message");
    const deps = fakeDependencies({ crm });
    return { message, deps, done: handleCrmSyncBatch(batch, env.DB, deps, log) };
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
