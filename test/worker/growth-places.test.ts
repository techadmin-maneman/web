// Growth keeps to the caller's cities: once the Staff list is enforced, a grant of one city lists only that city's held
// referrals, referrers and waitlist, attaches invites and launches pincodes only there, and leaves the service area to
// a national grant. NOW is Monday 21 September 2026, 12 noon in India. Every name, number and ID is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/http/context.ts";
import { captureLogs, fakeQueue, markDatabase, NOW, request } from "./helpers.ts";
import { enforce, listStaff, opsAs, person, type GrantCode } from "./staff-fixtures.ts";

interface Client {
  readonly id: string;
  readonly name: string;
  readonly mobile: string;
  /** Where they live; null for a client nothing places in a city. */
  readonly pincode: string | null;
}

const clientNumbered = (digit: number, name: string, pincode: string | null): Client => ({
  id: `11111111-1111-4111-8111-11111111111${String(digit)}`,
  name,
  mobile: `+91981000000${String(digit)}`,
  pincode,
});

const REFERRER_IN_DELHI = clientNumbered(1, "Rohit Malhotra", "110017");
const REFERRER_IN_GURGAON = clientNumbered(2, "Vikram Sethi", "122018");
const FRIEND_IN_DELHI = clientNumbered(3, "Karan Bhatia", "110017");
const FRIEND_IN_GURGAON = clientNumbered(4, "Aman Khanna", "122018");
const FRIEND_NOWHERE = clientNumbered(5, "Zoya Rao", null);
const NEW_IN_DELHI = clientNumbered(6, "Dev Arora", "110017");
const NEW_IN_GURGAON = clientNumbered(7, "Neil Kapoor", "122018");

const DELHI_CODE = "DLH4K7";
const GURGAON_CODE = "GGN4K7";

interface HeldReferral {
  readonly id: string;
  readonly friend: Client;
  readonly code: string;
}

/** Each friend's grant waits for review. The Delhi friend came through the Gurgaon referrer's invite. */
const HELD_IN_DELHI: HeldReferral = {
  id: "22222222-2222-4222-8222-222222222221",
  friend: FRIEND_IN_DELHI,
  code: GURGAON_CODE,
};
const HELD_IN_GURGAON: HeldReferral = {
  id: "22222222-2222-4222-8222-222222222222",
  friend: FRIEND_IN_GURGAON,
  code: DELHI_CODE,
};
const HELD_NOWHERE: HeldReferral = {
  id: "22222222-2222-4222-8222-222222222223",
  friend: FRIEND_NOWHERE,
  code: DELHI_CODE,
};

/** A pincode we do not know, so it is in no city. */
const UNKNOWN_PINCODE = "560001";

const AT = NOW.toISOString();
const ORIGIN = { Origin: "https://maneman.test", "Content-Type": "application/json" };

const bindings = () => ({ MESSAGE_QUEUE: fakeQueue(), CRM_QUEUE: fakeQueue() }) as unknown as Partial<Env>;
const get = (app: App, path: string) => request(app, path, undefined, bindings());
const post = (app: App, path: string, body: unknown = {}) =>
  request(app, path, { method: "POST", headers: ORIGIN, body: JSON.stringify(body) }, bindings());

const errorCode = async (res: Response) => (await res.json<{ error: { code: string } }>()).error.code;

function clientStatements(client: Client): D1PreparedStatement[] {
  const db = env.DB;
  const person = db
    .prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, ?4)")
    .bind(client.id, AT, client.mobile, client.name);
  if (client.pincode === null) return [person];
  const address = db
    .prepare(
      `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode)
       VALUES (?1, ?1, ?2, 'House 7', 'Market Road', 'Delhi NCR', ?3)`,
    )
    .bind(client.id, AT, client.pincode);
  return [person, address];
}

/** The friend's first fit, done, and their grant held for review by the fraud rules. */
function heldStatements(held: HeldReferral): D1PreparedStatement[] {
  const db = env.DB;
  const fit = `fit-${held.id}`;
  return [
    db
      .prepare(
        `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, window_end, service_pincode,
           synced_at)
         VALUES (?1, ?1, ?2, 'first_fit', 'completed', '2026-09-10T04:30:00.000Z', '2026-09-10T07:30:00.000Z', ?3, ?4)`,
      )
      .bind(fit, held.friend.id, held.friend.pincode, AT),
    db
      .prepare("INSERT INTO visits (id, appointment_id, outcome, updated_at) VALUES (?1, ?1, 'done', ?2)")
      .bind(fit, AT),
    db
      .prepare(
        `INSERT INTO referral_attributions (id, code, referred_person_id, first_touch_at, via, pincode,
           first_fit_appointment_id, grant_state, fraud_signals, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'consultation', ?5, ?6, 'held', '["attached_after_fit"]', ?4, ?4)`,
      )
      .bind(held.id, held.code, held.friend.id, AT, held.friend.pincode, fit),
  ];
}

const waitingStatement = (id: string, pincode: string, client: Client): D1PreparedStatement =>
  env.DB.prepare(
    `INSERT INTO waitlist_entries (id, pincode, person_id, contact_consent_at, launch_alert, created_at)
     VALUES (?1, ?2, ?3, ?4, 0, ?4)`,
  ).bind(id, pincode, client.id, AT);

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  const db = env.DB;
  const clients = [
    REFERRER_IN_DELHI,
    REFERRER_IN_GURGAON,
    FRIEND_IN_DELHI,
    FRIEND_IN_GURGAON,
    FRIEND_NOWHERE,
    NEW_IN_DELHI,
    NEW_IN_GURGAON,
  ];
  await db.batch([
    db.prepare(
      `INSERT INTO serviceable_pincodes (pincode, area, city, served) VALUES
         ('110017', 'Saket', 'Delhi', 0), ('122018', 'Sector 65', 'Gurgaon', 0)`,
    ),
    ...clients.flatMap(clientStatements),
    db
      .prepare(
        "INSERT INTO referral_codes (code, person_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?3), (?4, ?5, ?3, ?3)",
      )
      .bind(DELHI_CODE, REFERRER_IN_DELHI.id, AT, GURGAON_CODE, REFERRER_IN_GURGAON.id),
    ...[HELD_IN_DELHI, HELD_IN_GURGAON, HELD_NOWHERE].flatMap(heldStatements),
    waitingStatement("wait-delhi", "110017", NEW_IN_DELHI),
    waitingStatement("wait-gurgaon", "122018", NEW_IN_GURGAON),
    waitingStatement("wait-unknown", UNKNOWN_PINCODE, FRIEND_NOWHERE),
  ]);
});

/** The ops console as a member of staff holding these grants, with the Staff list enforced. */
async function staffWith(...grants: GrantCode[]): Promise<App> {
  await enforce();
  await listStaff("growth@maneman.in", grants);
  return opsAs(person("growth@maneman.in"));
}

const heldIds = async (app: App): Promise<string[]> =>
  (await (await get(app, "/api/referrals/held")).json<{ held: { id: string }[] }>()).held.map((row) => row.id).sort();

const referrerCodes = async (app: App): Promise<string[]> =>
  (await (await get(app, "/api/referrers")).json<{ referrers: { code: string }[] }>()).referrers
    .map((row) => row.code)
    .sort();

const waitingPincodes = async (app: App): Promise<string[]> =>
  (await (await get(app, "/api/waitlist")).json<{ areas: { pincode: string }[] }>()).areas
    .map((row) => row.pincode)
    .sort();

const launch = (app: App, pincode: string, confirm: boolean) =>
  post(app, `/api/pincodes/${pincode}/launch`, { confirm });

const served = async () =>
  (await env.DB.prepare("SELECT pincode, served FROM serviceable_pincodes ORDER BY pincode").all()).results;

const REJECTION = { decision: "reject", reason: "The friend lives with the referrer." };
const ATTACHMENT = { code: DELHI_CODE, reason: "Told us on WhatsApp that Rohit sent him" };

describe("a grant of Growth in one city", () => {
  let delhi: App;

  beforeEach(async () => {
    delhi = await staffWith("growth:manage:city:Delhi");
  });

  it("lists the referrals held where the friend is in its city, whoever sent the invite", async () => {
    expect(await heldIds(delhi)).toEqual([HELD_IN_DELHI.id]);
  });

  it("decides a held referral only in its city", async () => {
    for (const held of [HELD_IN_GURGAON, HELD_NOWHERE]) {
      const elsewhere = await post(delhi, `/api/referrals/${held.id}/decision`, REJECTION);
      expect(elsewhere.status).toBe(404);
      expect(await errorCode(elsewhere)).toBe("not_found");
    }
    expect((await post(delhi, `/api/referrals/${HELD_IN_DELHI.id}/decision`, REJECTION)).status).toBe(200);

    const states = await env.DB.prepare("SELECT id, grant_state FROM referral_attributions ORDER BY id").all();
    expect(states.results).toEqual([
      { id: HELD_IN_DELHI.id, grant_state: "rejected" },
      { id: HELD_IN_GURGAON.id, grant_state: "held" },
      { id: HELD_NOWHERE.id, grant_state: "held" },
    ]);
  });

  it("lists only the referrers in its city, with their friends wherever they are", async () => {
    const answer = await (await get(delhi, "/api/referrers")).json();
    expect(answer).toEqual({
      referrers: [
        {
          code: DELHI_CODE,
          name: REFERRER_IN_DELHI.name,
          opens: 0,
          consultations: 2,
          fits: 2,
          granted: 0,
          redeemed: 0,
        },
      ],
      more: false,
    });
  });

  it("attaches an invite only to a client in its city", async () => {
    const elsewhere = await post(delhi, `/api/clients/${NEW_IN_GURGAON.id}/referral`, ATTACHMENT);
    expect(elsewhere.status).toBe(404);
    expect(await errorCode(elsewhere)).toBe("not_found");
    expect((await post(delhi, `/api/clients/${NEW_IN_DELHI.id}/referral`, ATTACHMENT)).status).toBe(201);

    const attached = await env.DB.prepare(
      "SELECT referred_person_id FROM referral_attributions WHERE attached_by IS NOT NULL",
    ).all();
    expect(attached.results).toEqual([{ referred_person_id: NEW_IN_DELHI.id }]);
  });

  it("lists the waitlist's pincodes in its city, and not one we do not know", async () => {
    expect(await waitingPincodes(delhi)).toEqual(["110017"]);
  });

  it("launches a pincode in its city, and refuses one elsewhere without launching it", async () => {
    for (const confirm of [false, true]) {
      const elsewhere = await launch(delhi, "122018", confirm);
      expect(elsewhere.status).toBe(403);
      expect(await errorCode(elsewhere)).toBe("not_permitted");
    }
    expect((await launch(delhi, UNKNOWN_PINCODE, false)).status).toBe(404);
    expect(await (await launch(delhi, "110017", true)).json()).toMatchObject({ pincode: "110017", launched: true });

    expect(await served()).toEqual([
      { pincode: "110017", served: 1 },
      { pincode: "122018", served: 0 },
    ]);
  });

  it("leaves the service area to a national grant", async () => {
    expect((await get(delhi, "/api/service-area")).status).toBe(403);
    expect((await post(delhi, "/api/service-area", {})).status).toBe(403);
  });
});

describe("Growth's reach", () => {
  it("is each level's own: a national View lists every pincode while a Manage in one city launches only there", async () => {
    const growth = await staffWith("growth:view:national", "growth:manage:city:Delhi");

    expect(await waitingPincodes(growth)).toEqual(["110017", "122018", UNKNOWN_PINCODE]);
    expect((await launch(growth, "122018", true)).status).toBe(403);
    expect((await launch(growth, "110017", true)).status).toBe(200);
  });

  it("is each level's own for referrals: a national View lists them all while an Act in one city decides only there", async () => {
    const growth = await staffWith("growth:view:national", "growth:act:city:Delhi");

    expect(await heldIds(growth)).toHaveLength(3);
    expect((await post(growth, `/api/referrals/${HELD_IN_GURGAON.id}/decision`, REJECTION)).status).toBe(404);
    expect((await post(growth, `/api/referrals/${HELD_IN_DELHI.id}/decision`, REJECTION)).status).toBe(200);
  });

  it("takes in every city of a zone, and what is in no city only nationally", async () => {
    const ncr = await staffWith("growth:view:zone:NCR");

    expect(await heldIds(ncr)).toEqual([HELD_IN_DELHI.id, HELD_IN_GURGAON.id]);
    expect(await referrerCodes(ncr)).toEqual([DELHI_CODE, GURGAON_CODE]);
    expect(await waitingPincodes(ncr)).toEqual(["110017", "122018"]);
  });

  it("is everywhere for a national grant", async () => {
    const national = await staffWith("growth:manage:national");

    expect(await heldIds(national)).toHaveLength(3);
    expect(await waitingPincodes(national)).toEqual(["110017", "122018", UNKNOWN_PINCODE]);
    expect((await get(national, "/api/service-area")).status).toBe(200);
  });

  it("narrows nothing while the Staff list is not enforced", async () => {
    await listStaff("delhi@maneman.in", ["growth:view:city:Delhi"]);
    const delhi = opsAs(person("delhi@maneman.in"));

    expect(await heldIds(delhi)).toHaveLength(3);
    expect(await referrerCodes(delhi)).toEqual([DELHI_CODE, GURGAON_CODE]);
    expect(await waitingPincodes(delhi)).toHaveLength(3);
    expect((await launch(delhi, "122018", false)).status).toBe(200);
  });
});
