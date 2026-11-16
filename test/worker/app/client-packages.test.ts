// The packages a client compares in their app (src/routes/client/packages.ts; docs/decisions/0211-packages.md): each
// on sale from tomorrow, in ops' order, priced from the price book in the client's city as a technician's Options price
// them, with how often it is serviced and replaced. NOW is Monday 21 September 2026, 12 noon in India. Every name and
// number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { asClient, client, signedIn } from "../clients.ts";
import { aPackage, anAddress } from "../fixtures/index.ts";
import { markDatabase, NOW } from "../helpers.ts";

const ROHIT = "p-rohit";

let cookie: string;

beforeEach(async () => {
  await markDatabase();
  await client(ROHIT, "+919810000001");
  cookie = await signedIn(ROHIT);
  await aPackage({ code: "essential", name: "Mane Man Essential", firstFit: 3000000, sort: 1 });
  await aPackage({
    code: "natural",
    name: "Mane Man Natural",
    firstFit: 4000000,
    replacement: 2500000,
    sort: 2,
    everyDays: 45,
    afterMonths: 9,
  });
});

type Offered = { packages: { code: string; [field: string]: unknown }[] };

const offered = async () => (await (await asClient(cookie, "/api/packages")).json<Offered>()).packages;
const ofCode = async (code: string) => (await offered()).find((each) => each.code === code);
const rupees = (paise: number) => ({ amount_ex_gst: paise, amount: paise, gst_percent: 0 });

describe("the packages a client compares", () => {
  it("lists each on sale in ops' order, with its prices and how often it is serviced and replaced", async () => {
    const packages = (await offered()).filter((each) => each.code === "essential" || each.code === "natural");
    expect(packages).toEqual([
      expect.objectContaining({
        code: "essential",
        name: "Mane Man Essential",
        first_fit: rupees(3000000),
        service: rupees(200000),
        replacement: rupees(1500000),
        service_every_days: 30,
        replace_after_months: 6,
      }),
      expect.objectContaining({
        code: "natural",
        first_fit: rupees(4000000),
        replacement: rupees(2500000),
        service_every_days: 45,
        replace_after_months: 9,
      }),
    ]);
  });

  it("reads tomorrow's prices, the first day a visit or a price change can be on", async () => {
    await env.DB.prepare(
      `INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from)
       VALUES ('service', 'essential', 250000, 0, '2026-09-22')`,
    ).run();
    expect(await ofCode("essential")).toMatchObject({ service: rupees(250000), first_fit: rupees(3050000) });
  });

  it("reads the client's city's own price before the book's", async () => {
    // Their newest address, in Mumbai, which sets its own service visit price.
    await anAddress(ROHIT, {
      created_at: new Date(NOW.getTime() + 60_000).toISOString(),
      city: "Mumbai",
      locality: "Bandra West",
      pincode: "400050",
    });
    await env.DB.prepare(
      `INSERT INTO city_prices (item, tier, city, amount_ex_gst, gst_percent, valid_from)
       VALUES ('service', 'essential', 'Mumbai', 300000, 0, '2026-01-01')`,
    ).run();
    expect(await ofCode("essential")).toMatchObject({ service: rupees(300000) });
  });

  it("leaves out a package ops have retired", async () => {
    await env.DB.prepare(
      "UPDATE services SET retired_date = '2026-09-01' WHERE tier = 'natural' AND kind = 'first_fit'",
    ).run();
    expect((await offered()).map((each) => each.code)).not.toContain("natural");
  });

  it("is the signed-in client's alone", async () => {
    expect((await asClient("", "/api/packages")).status).toBe(401);
  });
});
