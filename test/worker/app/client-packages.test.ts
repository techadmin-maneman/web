// The packages a client compares in their app (src/routes/client/packages.ts; docs/decisions/0211-packages.md): each
// sold today, in ops' order, priced from the price book, with how often it is serviced and replaced. NOW is Monday 21
// September 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { asClient, client, signedIn } from "../clients.ts";
import { aPackage } from "../fixtures/index.ts";
import { markDatabase } from "../helpers.ts";

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

describe("the packages a client compares", () => {
  it("lists each sold today in ops' order, with its prices and how often it is serviced and replaced", async () => {
    const packages = (await offered()).filter((each) => each.code === "essential" || each.code === "natural");
    expect(packages).toEqual([
      expect.objectContaining({
        code: "essential",
        name: "Mane Man Essential",
        first_fit: { amount_ex_gst: 3000000, amount: 3000000, gst_percent: 0 },
        replacement: { amount_ex_gst: 1500000, amount: 1500000, gst_percent: 0 },
        service_visit: { amount_ex_gst: 200000, amount: 200000, gst_percent: 0 },
        service_every_days: 30,
        replace_after_months: 6,
      }),
      expect.objectContaining({
        code: "natural",
        first_fit: { amount_ex_gst: 4000000, amount: 4000000, gst_percent: 0 },
        replacement: { amount_ex_gst: 2500000, amount: 2500000, gst_percent: 0 },
        service_every_days: 45,
        replace_after_months: 9,
      }),
    ]);
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
