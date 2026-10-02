// GET /api/published-prices: the figures the public site publishes, from the price book
// (docs/decisions/0073-prices-from-the-price-book.md).

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { ErrorResponseSchema } from "../../src/http/errors.ts";
import { appFor, fakeDependencies, markDatabase, request } from "./helpers.ts";

const priceRow = (item: string, amountExGst: number, gstPercent: number, from: string, tier = "standard") =>
  env.DB.prepare(
    "INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from) VALUES (?1, ?2, ?3, ?4, ?5)",
  )
    .bind(item, tier, amountExGst, gstPercent, from)
    .run();

/** Noon in India on 26 September 2026, after the book's rows of the 22nd (migration 0018). */
const TODAY = new Date("2026-09-26T06:30:00Z");
const today = () => fakeDependencies({ now: () => TODAY });

async function pricesOn(deps = today()): Promise<Record<string, unknown>> {
  return (await request(appFor("local", deps), "/api/published-prices")).json();
}

beforeEach(async () => {
  await markDatabase();
});

describe("GET /api/published-prices", () => {
  // FEO-22: the site typed ₹25,000, ₹1,500 and ₹17,000 while the book held ₹30,000, ₹2,000 and ₹15,000.
  it("answers the standard tier's figures in force today, with and without GST, cacheable for a minute", async () => {
    const response = await request(appFor("local", today()), "/api/published-prices");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60");
    const free = { amount_ex_gst: 0, amount: 0, gst_percent: 0 };
    const firstFit = { amount_ex_gst: 3_000_000, amount: 3_000_000, gst_percent: 0 };
    const service = { amount_ex_gst: 200_000, amount: 200_000, gst_percent: 0 };
    const replacement = { amount_ex_gst: 1_500_000, amount: 1_500_000, gst_percent: 0 };
    expect(await response.json()).toEqual({
      on: "2026-09-26",
      tier: "standard",
      service,
      replacement,
      // Every service offered: the four the console starts with (migration 0050), the first fit's among them.
      services: [
        { type: "consultation", tier: "standard", name: "Consultation", minutes: 60, price: free },
        { type: "first_fit", tier: "standard", name: "First fit", minutes: 180, price: firstFit },
        { type: "service", tier: "standard", name: "Service visit", minutes: 90, price: service },
        { type: "replacement", tier: "standard", name: "Replacement", minutes: 135, price: replacement },
      ],
    });
  });

  it("carries every service offered today, each in its kind, and leaves out one retired or unpriced", async () => {
    const service = (kind: string, tier: string, name: string, sort: number, retired: string | null = null) =>
      env.DB.prepare(
        `INSERT INTO services (kind, tier, name, minutes, sort, retired_date, updated_by, updated_at)
         VALUES (?1, ?2, ?3, 180, ?4, ?5, 'ops@localhost', '2026-09-22T06:30:00.000Z')`,
      )
        .bind(kind, tier, name, sort, retired)
        .run();
    await service("first_fit", "premium", "Premium first fit", 1);
    await priceRow("first_fit", 4_000_000, 0, "2026-09-22", "premium");
    await service("first_fit", "lace", "Lace first fit", 2, "2026-09-26");
    await priceRow("first_fit", 4_500_000, 0, "2026-09-22", "lace");
    await service("replacement", "premium", "Premium replacement", 1);

    const body = (await pricesOn()) as { services: { type: string; tier: string }[] };

    expect(body.services.map((each) => `${each.type}/${each.tier}`)).toEqual([
      "consultation/standard",
      "first_fit/standard",
      "first_fit/premium",
      "service/standard",
      "replacement/standard",
    ]);
  });

  it("answers 503 when a kind's standard service is retired, so the site keeps its own", async () => {
    await env.DB.prepare("UPDATE services SET retired_date = '2026-09-26' WHERE kind = 'service'").run();

    expect((await request(appFor("local", today()), "/api/published-prices")).status).toBe(503);
  });

  // The owner's decision of 2 October 2026: only the hair systems ops offer, and no generic first fit in their place.
  it("prices a first fit only as the hair systems offered, and answers with none while ops offer none", async () => {
    await env.DB.prepare("UPDATE services SET retired_date = '2026-09-26' WHERE kind = 'first_fit'").run();

    const response = await request(appFor("local", today()), "/api/published-prices");

    expect(response.status).toBe(200);
    const body = await response.json<Record<string, unknown> & { services: { type: string }[] }>();
    expect(body).not.toHaveProperty("first_fit");
    expect(body.services.map((each) => each.type)).toEqual(["consultation", "service", "replacement"]);
  });

  it("follows a change from its day, and never shows one still to come or another tier's", async () => {
    await priceRow("service", 250_000, 18, "2026-09-26");
    await priceRow("first_fit", 3_500_000, 0, "2026-09-27");
    await priceRow("replacement", 3_000_000, 0, "2026-09-26", "premium");

    const body = (await pricesOn()) as Record<string, unknown> & {
      services: { type: string; price: { amount_ex_gst: number } }[];
    };

    expect(body.service).toEqual({ amount_ex_gst: 250_000, amount: 295_000, gst_percent: 18 });
    const firstFit = body.services.find((each) => each.type === "first_fit");
    expect(firstFit?.price).toEqual({ amount_ex_gst: 3_000_000, amount: 3_000_000, gst_percent: 0 });
    expect(body.replacement).toEqual({ amount_ex_gst: 1_500_000, amount: 1_500_000, gst_percent: 0 });
  });

  it("reads the day in India", async () => {
    await priceRow("service", 250_000, 0, "2026-09-27");
    // 18:45 UTC on the 26th is a quarter past midnight on the 27th in India.
    const body = await pricesOn(fakeDependencies({ now: () => new Date("2026-09-26T18:45:00Z") }));

    expect(body.on).toBe("2026-09-27");
    expect(body.service).toEqual({ amount_ex_gst: 250_000, amount: 250_000, gst_percent: 0 });
  });

  it("answers 503 when the book lacks a price the site publishes, so the site keeps its own", async () => {
    await env.DB.prepare("DELETE FROM price_book WHERE item = 'replacement'").run();

    const response = await request(appFor("local", today()), "/api/published-prices");

    expect(response.status).toBe(503);
    expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe("unavailable");
  });

  it("is the public host's alone", async () => {
    const onTheApp = await request(appFor("local", today(), {}, "client"), "/api/published-prices");
    expect(onTheApp.status).toBe(404);
  });
});
