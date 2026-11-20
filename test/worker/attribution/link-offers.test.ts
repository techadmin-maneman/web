// A campaign link's offer (ADR 0288): the discount code a society activation or an offer link carries, entered on the
// first fit of a client the link brought by itself; a society's only for a visit at an address in its pincode, and no
// longer once the link is retired or the code switched off. A partner's code comes first. NOW is Monday 21 September
// 2026, 12 noon in India. Every name, number and code here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { addCampaignLink, retireCampaignLink, type NewLink } from "../../../src/domain/growth/campaign-links.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import { client, SANA, technician } from "../booking/client-booking-fixtures.ts";
import { make } from "../booking/discount-code-entries-fixtures.ts";
import { aGenericFirstFit } from "../fixtures/index.ts";
import { pincode } from "../referrals/referrals-fixtures.ts";

const CHANGE = { actor: { kind: "staff", id: "growth@maneman.test" }, requestId: "r", now: NOW } as const;

async function codeId(code: string): Promise<string> {
  const row = await env.DB.prepare("SELECT id FROM discount_codes WHERE code = ?1").bind(code).first<{ id: string }>();
  return row?.id ?? "";
}

/** A link made, and a touch of the client's that came through it. */
async function cameThrough(personId: string, link: NewLink): Promise<string> {
  const made = await addCampaignLink(env.DB, { ...CHANGE, link });
  if (typeof made === "string") throw new Error(made);
  await env.DB.prepare(
    `INSERT INTO touches (id, at, via, person_id, link_id, code_kind, channel, campaign_signal)
     VALUES (?1, ?2, 'site', ?3, ?4, ?5, ?6, 1)`,
  )
    .bind(
      crypto.randomUUID(),
      NOW.toISOString(),
      personId,
      made.id,
      link.kind === "society" ? "society" : null,
      link.kind === "society" ? "society" : "meta_ads",
    )
    .run();
  return made.id;
}

const society = async (pin: string): Promise<NewLink> => ({
  kind: "society",
  name: "Green Valley Towers",
  pincode: pin,
  heldDate: "2026-09-19",
  costs: [],
  discountCodeId: await codeId("SOC20"),
});

/** The client's first fit held in the app: the code it carries, or null. */
async function heldCode(cookie: string): Promise<unknown> {
  const held = await request(appFor("local", fakeDependencies(), {}, "client"), "/api/holds", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json", Origin: "https://maneman.test" },
    body: JSON.stringify({ type: "first_fit", tier: "standard", date: "2026-09-24", window: "morning" }),
  });
  expect(held.status).toBe(201);
  const { discount } = await held.json<{ discount: { code: string } | null }>();
  return discount?.code ?? null;
}

beforeEach(async () => {
  await markDatabase();
  await aGenericFirstFit();
  captureLogs();
  await technician(SANA, "Sana Mirza", "SM");
  await pincode("122018", "Gurgaon South City II", true);
  await pincode("122002", "DLF Phase 1", true);
  await make({ code: "SOC20", kind: "percent", value: 20, covers: ["first_fit"] });
  await make({ code: "DIWALI", kind: "amount", value: 300_000, covers: ["first_fit"] });
});

describe("a society activation's offer", () => {
  it("comes off the first fit of a client it brought, held at an address in the society's pincode", async () => {
    const friend = await client(true);
    await cameThrough(friend.id, await society("122018"));

    expect(await heldCode(friend.cookie)).toBe("SOC20");
  });

  it("is not for a visit at an address outside the society's pincode", async () => {
    const friend = await client(true);
    await cameThrough(friend.id, await society("122002"));

    expect(await heldCode(friend.cookie)).toBeNull();
  });

  it("goes once the link is retired", async () => {
    const friend = await client(true);
    const link = await cameThrough(friend.id, await society("122018"));
    await retireCampaignLink(env.DB, { ...CHANGE, id: link });

    expect(await heldCode(friend.cookie)).toBeNull();
  });

  it("goes once Finance switch its code off", async () => {
    const friend = await client(true);
    await cameThrough(friend.id, await society("122018"));
    await env.DB.prepare("UPDATE discount_codes SET switched_off_at = ?1, switched_off_by = 'finance@maneman.test'")
      .bind(NOW.toISOString())
      .run();

    expect(await heldCode(friend.cookie)).toBeNull();
  });
});

describe("an offer link's offer", () => {
  it("comes off the first fit wherever the client lives, the latest link's when they came through two", async () => {
    const friend = await client(true);
    await cameThrough(friend.id, await society("122018"));
    await env.DB.prepare("UPDATE touches SET at = '2026-09-20T06:00:00.000Z'").run();
    await cameThrough(friend.id, {
      kind: "offer",
      name: "Diwali",
      utmSource: "meta",
      utmMedium: "paid_social",
      utmCampaign: "national-diwali",
      city: null,
      discountCodeId: await codeId("DIWALI"),
    });

    expect(await heldCode(friend.cookie)).toBe("DIWALI");
  });
});
