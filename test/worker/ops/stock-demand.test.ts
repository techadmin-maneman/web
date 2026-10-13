// What the weeks ahead will use (src/domain/field/stock-demand.ts), and opening counts with a lot
// (docs/decisions/0160-demand-and-opening-counts.md). NOW is Monday 21 September 2026, 12 noon in India.
//
// What these hold: the visits booked in the next four weeks expect their services' use, by city, beside what the city
// holds; each fit expects the hair system made to its client's profile, and is at risk where its city holds too few
// or its client has no profile; and a count that finds more than was held can put it in a lot, with its expiry.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { refreshStockRisks } from "../../../src/domain/field/stock-risks.ts";
import { NOW, markDatabase, request } from "../helpers.ts";
import { IMRAN, working, type Working } from "../job-fixtures.ts";
import { STOCK_WATCH } from "../../../src/policy/stock.ts";

let job: Working;

interface Demand {
  demand: { consumable_code: string; city: string | null; expected: number; held: number }[];
  at_risk: { appointment_id: string; city: string | null; consumable_code: string | null }[];
}

const demand = async (): Promise<Demand> => (await request(job.ops, "/api/stock/demand")).json<Demand>();

const SPEC = {
  product: "essential",
  base_width_in: 8,
  base_length_in: 10,
  colour: "1B",
  grey_percent: 20,
  density_percent: 100,
};

/** A first fit booked for `person` three days on, in Gurgaon with Imran. */
async function fitBooked(id: string, person: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, 'A client')",
    ).bind(person, NOW.toISOString(), `+9198100${person.slice(-5)}`),
    env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, person_id, type, tier, status, window_start, window_end, technician_id,
         service_city, service_pincode, synced_at)
       VALUES (?1, ?1, ?2, 'first_fit', 'essential', 'scheduled', '2026-09-24T05:30:00.000Z', '2026-09-24T08:00:00.000Z',
         ?3, 'Gurgaon', '122018', ?4)`,
    ).bind(id, person, IMRAN, NOW.toISOString()),
  ]);
}

beforeEach(async () => {
  await markDatabase();
  job = await working();
  await env.DB.prepare("UPDATE technicians SET city = 'Gurgaon'").run();
  await env.DB.prepare(
    `INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
     VALUES ('first_fit', 'essential', 'Mane Man Essential', 120, 1, 'test', ?1)`,
  )
    .bind(NOW.toISOString())
    .run();
  await job.opsPost("/api/consumables", { name: "Solvent", unit: "ml", unit_cost: 50 });
  await job.opsPost("/api/service-usage", {
    visit_type: "service",
    tier: "standard",
    items: [{ code: "solvent", quantity: 10 }],
  });
});

describe("the weeks ahead", () => {
  it("expects each booked visit's use in its city, beside what the city holds", async () => {
    await job.opsPost("/api/stock/deliveries", { consumable_code: "solvent", quantity: 100 });
    await job.opsPost("/api/stock/transfers", { consumable_code: "solvent", quantity: 4, from: "central", to: IMRAN });
    const { demand: rows } = await demand();
    expect(rows).toContainEqual({ consumable_code: "solvent", city: "Gurgaon", expected: 10, held: 4 });
  });

  it("expects the hair system made to each fit's profile, and marks a fit at risk where its city holds too few", async () => {
    const added = await job.opsPost("/api/hair-systems", { ...SPEC, unit_cost: 1_200_000 });
    expect(added.status).toBe(200);
    const code = (await added.json<{ code: string }>()).code;
    await fitBooked("fit-1", "44444444-4444-4444-8444-444444444441");
    await env.DB.prepare(
      `INSERT INTO hair_profiles (id, person_id, staff, created_at, product, base_width_in, base_length_in, colour,
         grey_percent, density_percent)
       VALUES ('hp-1', ?1, 'ops@localhost', ?2, 'essential', 8, 10, '1B', 20, 100)`,
    )
      .bind("44444444-4444-4444-8444-444444444441", NOW.toISOString())
      .run();
    await fitBooked("fit-2", "44444444-4444-4444-8444-444444444442");

    const ahead = await demand();
    expect(ahead.demand).toContainEqual({ consumable_code: code, city: "Gurgaon", expected: 1, held: 0 });
    expect(ahead.at_risk).toEqual([
      { appointment_id: "fit-1", window_start: "2026-09-24T05:30:00.000Z", city: "Gurgaon", consumable_code: code },
      { appointment_id: "fit-2", window_start: "2026-09-24T05:30:00.000Z", city: "Gurgaon", consumable_code: null },
    ]);

    await job.opsPost("/api/stock/deliveries", { consumable_code: code, quantity: 2 });
    await job.opsPost("/api/stock/transfers", { consumable_code: code, quantity: 1, from: "central", to: IMRAN });
    expect((await demand()).at_risk.map((fit) => fit.appointment_id)).toEqual(["fit-2"]);
  });
});

describe("stock at risk", () => {
  const tasks = async () => {
    const board = await (
      await request(job.ops, "/api/tasks")
    ).json<{
      groups: { group: string; tasks: { id: string; detail: string | null }[] }[];
    }>();
    return board.groups.find((each) => each.group === "stock_at_risk")?.tasks ?? [];
  };

  it("puts each fit with no hair system in its city on the board, once, and takes it off once there is one", async () => {
    const added = await job.opsPost("/api/hair-systems", { ...SPEC, unit_cost: 1_200_000 });
    const code = (await added.json<{ code: string }>()).code;
    await fitBooked("fit-1", "44444444-4444-4444-8444-444444444441");
    await env.DB.prepare(
      `INSERT INTO hair_profiles (id, person_id, staff, created_at, product, base_width_in, base_length_in, colour,
         grey_percent, density_percent)
       VALUES ('hp-1', ?1, 'ops@localhost', ?2, 'essential', 8, 10, '1B', 20, 100)`,
    )
      .bind("44444444-4444-4444-8444-444444444441", NOW.toISOString())
      .run();
    await fitBooked("fit-2", "44444444-4444-4444-8444-444444444442");

    for (let run = 0; run < 2; run += 1) await refreshStockRisks(env.DB, "2026-09-21", NOW, STOCK_WATCH.demand_days);
    expect(await tasks()).toEqual([
      expect.objectContaining({ id: "fit-1", detail: code }),
      expect.objectContaining({ id: "fit-2", detail: "" }),
    ]);

    await job.opsPost("/api/stock/deliveries", { consumable_code: code, quantity: 1 });
    await job.opsPost("/api/stock/transfers", { consumable_code: code, quantity: 1, from: "central", to: IMRAN });
    await refreshStockRisks(env.DB, "2026-09-21", NOW, STOCK_WATCH.demand_days);
    expect((await tasks()).map((task) => task.id)).toEqual(["fit-2"]);
  });
});

describe("an opening count", () => {
  it("puts what it found into the lot named, with its expiry, and what it found unnamed into no lot", async () => {
    await job.opsPost("/api/stock/counts", {
      consumable_code: "solvent",
      place_id: IMRAN,
      counted: 80,
      lot_code: "SV-77",
      expires_on: "2027-02-28",
    });
    await job.opsPost("/api/stock/counts", { consumable_code: "solvent", place_id: IMRAN, counted: 100 });
    const book = await (
      await request(job.ops, "/api/stock")
    ).json<{
      holdings: {
        consumable_code: string;
        place_id: string;
        quantity: number;
        lots: { lot_code: string; quantity: number }[];
      }[];
    }>();
    const kit = book.holdings.find((each) => each.consumable_code === "solvent" && each.place_id === IMRAN);
    expect(kit).toMatchObject({ quantity: 100, lots: [{ lot_code: "SV-77", quantity: 80 }] });
  });
});
