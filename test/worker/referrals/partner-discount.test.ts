// A partner's discount code for the friends it sends (src/domain/referrals/channels.ts,
// src/domain/booking/public-consultation.ts, src/routes/client/booking.ts; docs/decisions/0125-partner-discount-codes.md).
// NOW is Monday 21 September 2026, 12 noon in India. Every name, number and code here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { codeOnHold } from "../../../src/domain/money/discount-code-holds.ts";
import type { App } from "../../../src/http/context.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, NOW, provedNumberCode, request } from "../helpers.ts";
import { client, SANA, technician } from "../booking/client-booking-fixtures.ts";
import { make } from "../booking/discount-code-entries-fixtures.ts";
import { ADDRESS, FRIEND, pincode, post, site } from "./referrals-fixtures.ts";

let ops: App;

const TERMS = { name: "Looks Salon, Sector 29", friend_visits: 0, valid_days: 180, commission: 150000 };

const send = (method: string, path: string, body: unknown) =>
  request(ops, path, {
    method,
    headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/** A partner added with `code` as its friends' discount; its own code, as its link carries it. */
async function partnerWith(code: string | null): Promise<string> {
  const added = await send("POST", "/api/referral-channels", { ...TERMS, discount_code: code });
  expect(added.status).toBe(200);
  const { channels } = await added.json<{ channels: { code: string }[] }>();
  return channels[0]?.code ?? "";
}

/** The friend books from the partner's page: the consultation, or the consultation and fit in one visit. */
const bookFrom = async (partnerCode: string, oneVisit: boolean) =>
  request(
    site(),
    `/api/r/${partnerCode}/consultation`,
    post({
      ...FRIEND,
      pincode: "122018",
      date: "2026-09-23",
      window: "morning",
      consent: true,
      address: ADDRESS,
      one_visit: oneVisit,
      ...(oneVisit ? { number_code_id: await provedNumberCode("+919810000002") } : {}),
    }),
  );

const heldCode = async () => {
  const hold = await env.DB.prepare("SELECT id FROM slot_holds").first<{ id: string }>();
  return hold === null ? null : codeOnHold(env.DB, hold.id);
};

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  ops = appFor("local", fakeDependencies(), {}, "ops");
  await env.DB.prepare(
    `INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at, city, fits_trained)
     VALUES ('t1', 't1', 'Imran Qureshi', 'IQ', 1, ?1, 'Gurgaon', 1)`,
  )
    .bind(NOW.toISOString())
    .run();
  await pincode("122018", "Gurgaon South City II", true);
  await make({ code: "SALON2K", kind: "amount", value: 200_000, covers: ["first_fit"] });
  await make({ code: "SERVICE10", covers: ["service"] });
});

describe("a partner's discount code", () => {
  it("is one of Finance's, switched on, that covers a first fit", async () => {
    for (const code of ["NOSUCH", "SERVICE10"]) {
      const refused = await send("POST", "/api/referral-channels", { ...TERMS, discount_code: code });
      expect(refused.status).toBe(400);
      expect(await refused.json()).toMatchObject({ error: { fields: ["discount_code"] } });
    }
    expect((await send("POST", "/api/referral-channels", { ...TERMS, discount_code: "salon2k" })).status).toBe(200);
  });

  it("stays while a partner gives it: deleting it is refused", async () => {
    await partnerWith("SALON2K");
    const code = await env.DB.prepare("SELECT id FROM discount_codes WHERE code = 'SALON2K'").first<{ id: string }>();
    const deleted = await send("POST", `/api/discount-codes/${code?.id ?? ""}/delete`, {});
    expect(deleted.status).toBe(409);
    expect(await deleted.json()).toMatchObject({ error: { code: "in_use" } });
  });

  it("is offered on the partner's page, by what it takes off", async () => {
    const partner = await partnerWith("SALON2K");
    expect(await (await request(site(), `/api/r/${partner}`)).json()).toMatchObject({
      partner: TERMS.name,
      discount: { kind: "amount", value: 200_000, cap: null },
    });
  });

  it("comes off the consultation and fit in one visit booked from the partner's page, by itself", async () => {
    const partner = await partnerWith("SALON2K");
    const booked = await bookFrom(partner, true);
    expect(booked.status).toBe(201);
    expect(await heldCode()).toMatchObject({ code: "SALON2K" });
  });

  it("never refuses a consultation booked from the partner's page, which costs nothing", async () => {
    const partner = await partnerWith("SALON2K");
    const booked = await bookFrom(partner, false);
    expect(booked.status).toBe(201);
    expect(await heldCode()).toBeNull();
  });

  it("is offered no more once Finance switches it off, and the booking goes ahead without it", async () => {
    const partner = await partnerWith("SALON2K");
    await env.DB.prepare("UPDATE discount_codes SET switched_off_at = ?1, switched_off_by = 'finance@maneman.test'")
      .bind(NOW.toISOString())
      .run();
    expect(await (await request(site(), `/api/r/${partner}`)).json()).toMatchObject({ discount: null });
    expect((await bookFrom(partner, true)).status).toBe(201);
    expect(await heldCode()).toBeNull();
  });
});

describe("a partner's friend's first fit, held in the app", () => {
  it("takes the partner's code by itself", async () => {
    const partner = await partnerWith("SALON2K");
    await technician(SANA, "Sana Mirza", "SM");
    const friend = await client(true);
    await env.DB.prepare(
      `INSERT INTO channel_attributions (id, channel_id, referred_person_id, first_touch_at, via, created_at, updated_at)
       SELECT 'ca1', id, ?1, ?2, 'consultation', ?2, ?2 FROM referral_channels WHERE code = ?3`,
    )
      .bind(friend.id, NOW.toISOString(), partner)
      .run();
    const held = await request(appFor("local", fakeDependencies(), {}, "client"), "/api/holds", {
      method: "POST",
      headers: { Cookie: friend.cookie, "Content-Type": "application/json", Origin: "https://maneman.test" },
      body: JSON.stringify({ type: "first_fit", tier: "standard", date: "2026-09-24", window: "morning" }),
    });
    expect(held.status).toBe(201);
    expect(await held.json()).toMatchObject({ discount: { code: "SALON2K" } });
  });
});
