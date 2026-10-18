// The package a client is on (docs/decisions/0211-packages.md): the one they booked a first fit as, or ops put them
// on; their first fit priced by the hair system made to their profile, and their service visits their package's, at
// its price and on its cadence. NOW is Monday 21 September 2026, 12 noon in India. Every name here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "../../../src/log.ts";
import { createPaymentsProvider } from "../../../src/providers/payments/index.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, request } from "../helpers.ts";
import { aHairSystemOf, aPackage } from "../fixtures/index.ts";
import { IMRAN, ROHIT, bindings, rohit, technician } from "./ops-visits-fixtures.ts";

/** The console where no payment can be taken online, so a paid visit is booked at once. */
const ops = () =>
  appFor(
    "local",
    { ...fakeDependencies(), payments: createPaymentsProvider("none", null, { fetch, log: createLogger() }) },
    {},
    "ops",
  );

const send = (method: string, path: string, body?: object) =>
  request(
    ops(),
    path,
    {
      method,
      headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    bindings(),
  );

/** The spec of Rohit's hair profile (test/worker/fixtures/people.ts). */
const THEIRS = { baseWidthIn: 8, baseLengthIn: 10, colour: "1B", greyPercent: 20, densityPercent: 100 };
const SMALLER = { baseWidthIn: 7, baseLengthIn: 9, colour: "2", greyPercent: 0, densityPercent: 100 };

interface Offered {
  services: { tier: string; name: string; price: { amount_ex_gst: number } }[];
}

const offered = async (kind: string, tier?: string) =>
  (
    await send(
      "GET",
      `/api/visits/availability?client=${ROHIT}&kind=${kind}${tier === undefined ? "" : `&tier=${tier}`}`,
    )
  ).json<Offered>();

const packageOfRohit = () =>
  env.DB.prepare("SELECT package FROM people WHERE id = ?1").bind(ROHIT).first<string | null>("package");

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  await technician(IMRAN, "Imran Qureshi", "IQ");
});

describe("a client's first fit", () => {
  it("is priced by the hair system made to their profile, and puts them on its package once booked", async () => {
    await rohit("consulted");
    await aPackage({ code: "essential", name: "Mane Man Essential", firstFit: 3_200_000, spec: THEIRS });
    await aHairSystemOf({ code: "essential", firstFit: 2_700_000, spec: SMALLER });

    // Sold from the cheaper hair system, Rohit's first fit costs the one made to their profile.
    const site = await (
      await request(appFor("local", fakeDependencies()), "/api/published-prices")
    ).json<{
      services: { type: string; tier: string; price: { amount_ex_gst: number } }[];
    }>();
    expect(site.services.find((each) => each.tier === "essential")?.price.amount_ex_gst).toBe(2_700_000);
    expect((await offered("first_fit", "essential")).services).toEqual([
      expect.objectContaining({
        tier: "essential",
        price: expect.objectContaining({ amount_ex_gst: 3_200_000 }) as unknown,
      }),
    ]);

    expect(await packageOfRohit()).toBeNull();
    const booked = await send("POST", "/api/visits", {
      client: ROHIT,
      kind: "first_fit",
      tier: "essential",
      date: "2026-09-25",
      window: "morning",
    });
    expect(booked.status).toBe(201);
    expect(await packageOfRohit()).toBe("essential");
    const hold = await env.DB.prepare("SELECT tier, amount_ex_gst FROM slot_holds").first();
    expect(hold).toEqual({ tier: "essential", amount_ex_gst: 3_200_000 });
  });
});

describe("a client's package, put on by ops", () => {
  beforeEach(async () => {
    await rohit("fitted");
    await aPackage({
      code: "natural",
      name: "Mane Man Natural",
      firstFit: 4_500_000,
      serviceVisit: 250_000,
      everyDays: 21,
    });
  });

  it("is theirs from then, its service visit offered at its price, due on its cadence, and recorded", async () => {
    expect((await offered("service")).services).toEqual([expect.objectContaining({ tier: "standard" })]);

    const answer = await send("POST", `/api/clients/${ROHIT}/package`, { package: "natural" });

    expect(answer.status).toBe(200);
    expect(await packageOfRohit()).toBe("natural");
    expect((await offered("service")).services).toEqual([
      expect.objectContaining({
        tier: "natural",
        price: expect.objectContaining({ amount_ex_gst: 250_000 }) as unknown,
      }),
    ]);
    const record = await (
      await send("GET", `/api/clients/${ROHIT}`)
    ).json<{
      package: unknown;
      next_visit: { type: string; due_on: string } | null;
    }>();
    expect(record.package).toEqual({ code: "natural", name: "Mane Man Natural", chosen: true });
    // Fitted on 1 August, the next service visit falls due 21 days on.
    expect(record.next_visit).toMatchObject({ type: "service", due_on: "2026-08-22" });
    const audit = await env.DB.prepare(
      "SELECT subject_id, detail FROM audit_log WHERE action = 'client.package'",
    ).all();
    expect(audit.results).toEqual([{ subject_id: ROHIT, detail: JSON.stringify({ package: "natural" }) }]);
  });

  it("refuses a package nobody sells, and changes nothing", async () => {
    expect((await send("POST", `/api/clients/${ROHIT}/package`, { package: "lace" })).status).toBe(404);
    expect(await packageOfRohit()).toBeNull();
  });
});
