// Ops attaching an invite to a client on the client's page, for a friend who booked away from the invite's own page
// (src/routes/ops-client-referral.ts; docs/decisions/0089-an-invite-is-not-lost.md). NOW is Monday 21 September
// 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/http/context.ts";
import { appFor, captureLogs, fakeDependencies, fakeQueue, markDatabase, NOW, request } from "./helpers.ts";

const REFERRER = "11111111-1111-4111-8111-111111111111";
const FRIEND = "22222222-2222-4222-8222-222222222222";
const OTHER_REFERRER = "33333333-3333-4333-8333-333333333333";
const REASON = "Told us on WhatsApp that Rohit sent him";
let ops: App;
let crm: ReturnType<typeof fakeQueue>;

const attach = (body: object, personId = FRIEND) =>
  request(
    ops,
    `/api/clients/${personId}/referral`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
      body: JSON.stringify(body),
    },
    { CRM_QUEUE: crm },
  );

async function person(id: string, name: string, mobile: string) {
  await env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, ?4)")
    .bind(id, NOW.toISOString(), mobile, name)
    .run();
}

async function code(personId: string, value: string) {
  await env.DB.prepare("INSERT INTO referral_codes (code, person_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)")
    .bind(value, personId, NOW.toISOString())
    .run();
}

/** The friend asked for a consultation on the site while self-serve booking was off, at their address in 122018. */
async function consultationAsked() {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO consultation_requests (id, person_id, pincode, requested_date, requested_window, created_at)
       VALUES ('request-1', ?1, '122018', '2026-09-23', 'morning', ?2)`,
    ).bind(FRIEND, NOW.toISOString()),
    env.DB.prepare(
      `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode)
       VALUES ('address-1', ?1, ?2, 'Palm Grove Society', 'Sector 65', 'Gurgaon', '122018')`,
    ).bind(FRIEND, NOW.toISOString()),
  ]);
}

const attributions = () =>
  env.DB.prepare(
    "SELECT code, referred_person_id, via, pincode, grant_state, attached_by, attach_reason FROM referral_attributions",
  ).all();
const audits = () =>
  env.DB.prepare(
    "SELECT actor_kind, actor, subject_kind, subject_id, detail FROM audit_log WHERE action = 'referral.attach'",
  ).all();

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  ops = appFor("local", fakeDependencies(), {}, "ops");
  crm = fakeQueue();
  await person(REFERRER, "Rohit Malhotra", "+919810000001");
  await person(FRIEND, "Karan Bhatia", "+919810000002");
  await code(REFERRER, "RM4K7P");
  await env.DB.prepare(
    `INSERT INTO serviceable_pincodes (pincode, area, city, served, launched_at)
     VALUES ('122018', 'Sector 65', 'Gurgaon', 1, '2026-09-01T18:30:00.000Z'),
            ('400050', 'Bandra', 'Mumbai', 0, NULL)`,
  ).run();
});

describe("POST /api/clients/:id/referral", () => {
  it("attaches the invite, keeping who attached it and why, audited in the same write", async () => {
    await consultationAsked();
    const answer = await attach({ code: "rm4k7p", reason: REASON });

    expect(answer.status).toBe(201);
    const invite = {
      code: "RM4K7P",
      referrer: { id: REFERRER, name: "Rohit Malhotra" },
      grant: "pending",
      since: NOW.toISOString(),
      attached: { by: "ops@localhost", reason: REASON },
    };
    expect(await answer.json()).toEqual(invite);
    expect((await attributions()).results).toEqual([
      {
        code: "RM4K7P",
        referred_person_id: FRIEND,
        via: "consultation",
        pincode: "122018",
        grant_state: "pending",
        attached_by: "ops@localhost",
        attach_reason: REASON,
      },
    ]);
    // The reason is ops' words about the client, kept with the attribution, never in the log (ADR 0031).
    expect((await audits()).results).toEqual([
      {
        actor_kind: "staff",
        actor: "ops@localhost",
        subject_kind: "person",
        subject_id: FRIEND,
        detail: JSON.stringify({ code: "RM4K7P" }),
      },
    ]);
    // The client's page reads it back as the answer gave it.
    const record = await (await request(ops, `/api/clients/${FRIEND}`)).json<{ invite: unknown }>();
    expect(record.invite).toEqual(invite);
  });

  it("sends the client to the CRM again, which reads the invite they now carry", async () => {
    await attach({ code: "RM4K7P", reason: REASON });
    expect(crm.sent).toEqual([{ update_person_id: FRIEND, request_id: expect.any(String) as string }]);
  });

  it("keeps the invite when the CRM's queue will not take the client, and tells ops to write it by hand", async () => {
    const deps = fakeDependencies();
    ops = appFor("local", deps, {}, "ops");
    crm = { ...fakeQueue(), send: () => Promise.reject(new Error("queue down")) };
    expect((await attach({ code: "RM4K7P", reason: REASON })).status).toBe(201);
    expect((await attributions()).results).toHaveLength(1);
    expect(deps.alerts).toEqual([expect.stringContaining(`Client ${FRIEND}'s invite could not be sent on to the CRM`)]);
  });

  // The waitlist's lapse rule is for an invite held on a waitlist (src/policy/invites.ts), so a client who is only
  // waiting is held as the landing's waitlist would hold them, and one who asked for a visit is not.
  it("holds the invite as the waitlist would for a client who is only waiting on a list", async () => {
    await env.DB.prepare(
      `INSERT INTO waitlist_entries (id, pincode, person_id, contact_consent_at, launch_alert, created_at)
       VALUES ('entry-1', '400050', ?1, ?2, 0, ?2)`,
    )
      .bind(FRIEND, NOW.toISOString())
      .run();
    expect((await attach({ code: "RM4K7P", reason: REASON })).status).toBe(201);
    expect((await attributions()).results).toMatchObject([{ via: "waitlist", pincode: "400050" }]);
  });

  describe("refuses, in words ops read, writing nothing", () => {
    async function nothingWritten() {
      expect((await audits()).results).toEqual([]);
      expect(crm.sent).toEqual([]);
    }

    it("a code nobody has", async () => {
      const answer = await attach({ code: "ZZ9999", reason: REASON });
      expect(answer.status).toBe(422);
      expect(await answer.json()).toMatchObject({ error: { code: "unknown_invite" } });
      expect((await attributions()).results).toEqual([]);
      await nothingWritten();
    });

    it("the code's own referrer", async () => {
      const answer = await attach({ code: "RM4K7P", reason: REASON }, REFERRER);
      expect(answer.status).toBe(409);
      expect(await answer.json()).toMatchObject({ error: { code: "own_invite" } });
      expect((await attributions()).results).toEqual([]);
      await nothingWritten();
    });

    it("a client who came with an invite already, naming it", async () => {
      await person(OTHER_REFERRER, "Vikram Sethi", "+919810000003");
      await code(OTHER_REFERRER, "VSAB23");
      expect((await attach({ code: "VSAB23", reason: REASON })).status).toBe(201);

      for (const again of ["RM4K7P", "VSAB23"]) {
        const answer = await attach({ code: again, reason: REASON });
        expect(answer.status).toBe(409);
        expect(await answer.json()).toMatchObject({ error: { code: "already_invited" }, invite: { code: "VSAB23" } });
      }
      // Only the first attach is written, audited and sent on.
      expect((await attributions()).results).toMatchObject([{ code: "VSAB23" }]);
      expect((await audits()).results).toHaveLength(1);
      expect(crm.sent).toHaveLength(1);
    });

    // Whether ops may attach one after the first fit is the owner's to rule (docs/open-points.md, item 157).
    it("a client already fitted", async () => {
      await env.DB.prepare(
        `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, fsm_modified_at,
           synced_at)
         VALUES ('fit-1', 'fsm-fit-1', ?1, 'first_fit', 'completed', 'Completed', '2026-09-10T03:30:00.000Z', ?2, ?2)`,
      )
        .bind(FRIEND, NOW.toISOString())
        .run();
      const answer = await attach({ code: "RM4K7P", reason: REASON });
      expect(answer.status).toBe(409);
      expect(await answer.json()).toMatchObject({ error: { code: "already_fitted" } });
      expect((await attributions()).results).toEqual([]);
      await nothingWritten();
    });

    it("an attach without its reason, or with something that is not a code", async () => {
      const unreasoned = await attach({ code: "RM4K7P", reason: "  " });
      expect(unreasoned.status).toBe(400);
      expect(await unreasoned.json()).toMatchObject({ error: { code: "invalid_request", fields: ["reason"] } });
      expect((await attach({ code: "not a code", reason: REASON })).status).toBe(400);
      expect((await attributions()).results).toEqual([]);
      await nothingWritten();
    });

    it("a client we do not have, or one erased", async () => {
      expect((await attach({ code: "RM4K7P", reason: REASON }, "99999999-9999-4999-8999-999999999999")).status).toBe(
        404,
      );
      await env.DB.prepare("UPDATE people SET erased_at = ?2, name = 'Erased' WHERE id = ?1")
        .bind(FRIEND, NOW.toISOString())
        .run();
      expect((await attach({ code: "RM4K7P", reason: REASON })).status).toBe(404);
      await nothingWritten();
    });
  });
});

describe("the client's record", () => {
  it("names no invite for a client who came with none", async () => {
    const record = await (await request(ops, `/api/clients/${FRIEND}`)).json<{ invite: unknown }>();
    expect(record.invite).toBeNull();
  });

  it("names the invite a client came through on the landing, with no one who attached it, and no erased referrer", async () => {
    await env.DB.prepare(
      `INSERT INTO referral_attributions (id, code, referred_person_id, first_touch_at, via, pincode, grant_state,
         created_at, updated_at)
       VALUES ('attr-1', 'RM4K7P', ?1, ?2, 'consultation', '122018', 'granted', ?2, ?2)`,
    )
      .bind(FRIEND, NOW.toISOString())
      .run();
    await env.DB.prepare("UPDATE people SET erased_at = ?2, name = 'Erased' WHERE id = ?1")
      .bind(REFERRER, NOW.toISOString())
      .run();
    const record = await (await request(ops, `/api/clients/${FRIEND}`)).json<{ invite: unknown }>();
    expect(record.invite).toEqual({
      code: "RM4K7P",
      referrer: null,
      grant: "granted",
      since: NOW.toISOString(),
      attached: null,
    });
  });
});
