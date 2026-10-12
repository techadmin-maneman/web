// A client matched to stock (src/routes/ops/stock-match.ts, src/domain/field/stock-match.ts;
// docs/decisions/0173-matching-a-client-to-stock.md). NOW is Monday 21 September 2026, 12 noon in India.
//
// What these hold: a client's latest profile matches a stock code only when its product, base size, colour, grey and
// density are all the code's; a profile missing any of them says which; with no code made to it, the client's is a
// custom order; and a match says where its pieces are held, the client's city first.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { NOW, markDatabase, request } from "../helpers.ts";
import { IMRAN, working, type Working } from "../job-fixtures.ts";

const CLIENT = "55555555-5555-4555-8555-555555555551";

let job: Working;
let versions = 0;

interface Match {
  kind: string;
  missing: string[];
  code: string | null;
  city: string | null;
  held: { place_id: string; pieces: number; city: string | null }[];
  in_transit: number;
}

const matched = async (): Promise<Match> =>
  (await request(job.ops, `/api/clients/${CLIENT}/stock-match`)).json<Match>();

async function profiled(spec: Record<string, string | number | null>): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO hair_profiles (id, person_id, staff, created_at, product, base_width_in, base_length_in, colour,
       grey_percent, density_percent)
     VALUES (?1, ?2, 'ops@localhost', ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
  )
    .bind(
      crypto.randomUUID(),
      CLIENT,
      new Date(NOW.getTime() + (versions += 1) * 1000).toISOString(),
      spec.product ?? null,
      spec.base_width_in ?? null,
      spec.base_length_in ?? null,
      spec.colour ?? null,
      spec.grey_percent ?? null,
      spec.density_percent ?? null,
    )
    .run();
}

const SPEC = { product: "essential", base_width_in: 8, base_length_in: 10, colour: "1B", grey_percent: 20 };

beforeEach(async () => {
  await markDatabase();
  job = await working();
  await env.DB.batch([
    env.DB.prepare("UPDATE technicians SET city = 'Gurgaon'"),
    env.DB.prepare(
      `INSERT OR IGNORE INTO serviceable_pincodes (pincode, area, city, served, launched_at)
       VALUES ('122018', 'South City II', 'Gurgaon', 1, '2026-09-01T18:30:00.000Z')`,
    ),
    env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810055551', 'A client')",
    ).bind(CLIENT, NOW.toISOString()),
    env.DB.prepare(
      `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode)
       VALUES ('ad-1', ?1, ?2, 'House 1', 'Sector 56', 'Gurgaon', '122018')`,
    ).bind(CLIENT, NOW.toISOString()),
    env.DB.prepare(
      `INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
       VALUES ('first_fit', 'essential', 'Mane Man Essential', 120, 1, 'test', ?1)`,
    ).bind(NOW.toISOString()),
  ]);
});

describe("a client matched to stock", () => {
  it("says what their profile lacks, and that one made to no stock code is a custom order", async () => {
    expect((await matched()).kind).toBe("no_profile");
    await profiled(SPEC);
    expect(await matched()).toMatchObject({ kind: "incomplete", missing: ["density_percent"] });
    await profiled({ ...SPEC, density_percent: 100 });
    expect((await matched()).kind).toBe("custom");
  });

  it("matches only the code made exactly to them, and says where its pieces are, their city first", async () => {
    await job.opsPost("/api/hair-systems", { ...SPEC, density_percent: 120, unit_cost: 1_200_000 });
    const added = await job.opsPost("/api/hair-systems", { ...SPEC, density_percent: 100, unit_cost: 1_200_000 });
    const code = (await added.json<{ code: string }>()).code;
    await profiled({ ...SPEC, density_percent: 100 });
    await job.opsPost("/api/stock/deliveries", { consumable_code: code, quantity: 3 });
    await job.opsPost("/api/stock/transfers", { consumable_code: code, quantity: 1, from: "central", to: IMRAN });

    expect(await matched()).toMatchObject({
      kind: "stocked",
      code,
      city: "Gurgaon",
      held: [
        { place_id: IMRAN, city: "Gurgaon", kind: "kit", pieces: 1 },
        { place_id: "central", kind: "warehouse", pieces: 2 },
      ],
      in_transit: 0,
    });
  });
});
