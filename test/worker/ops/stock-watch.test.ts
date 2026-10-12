// The morning look at the stock (src/domain/field/stock-watch.ts; docs/decisions/0159-stock-views-and-expiry.md). NOW
// is Monday 21 September 2026, 12 noon in India; the look runs in the hour from 9 am.
//
// What these hold: a place holding a lot that expires within 30 days, or has expired, is told of once, naming each lot,
// and a kit by its technician's ID alone; its alert closes once the place holds none of them; a transfer a week on its
// way is told of, and closes once settled; and nothing is told outside the morning hour.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { watchStock } from "../../../src/domain/field/stock-watch.ts";
import { markDatabase } from "../helpers.ts";
import { IMRAN, working, type Working } from "../job-fixtures.ts";

let job: Working;

/** 9.30 am in India, `days` after NOW's day. */
const morning = (days = 0) => new Date(Date.parse("2026-09-21T04:00:00.000Z") + days * 86_400_000);

const look = (at: Date) => watchStock(env.DB, { ...job.deps, now: () => at });

const open = () =>
  env.DB.prepare("SELECT key FROM alerts WHERE resolved_at IS NULL AND key NOT LIKE 'low_stock%' ORDER BY key").all();

beforeEach(async () => {
  await markDatabase();
  job = await working();
  await job.opsPost("/api/consumables", { name: "Solvent", unit: "ml", unit_cost: 50 });
  await job.opsPost("/api/stock/deliveries", {
    consumable_code: "solvent",
    quantity: 300,
    lot_code: "SV-OLD",
    expires_on: "2026-10-10",
  });
  await job.opsPost("/api/stock/deliveries", {
    consumable_code: "solvent",
    quantity: 300,
    lot_code: "SV-NEW",
    expires_on: "2027-06-30",
  });
});

describe("stock that expires soon", () => {
  it("is told of once a place, each lot named, a kit by its technician's ID, and closes once it is gone", async () => {
    await job.opsPost("/api/stock/transfers", {
      consumable_code: "solvent",
      quantity: 100,
      from: "central",
      to: IMRAN,
    });
    await look(morning());
    expect([...job.deps.alerts].sort()).toEqual([
      expect.stringContaining(
        "Stock in National warehouse expires within 30 days: Solvent lot SV-OLD, 200 ml, expires 2026-10-10",
      ),
      expect.stringContaining(`Stock in technician ${IMRAN}'s kit expires within 30 days: Solvent lot SV-OLD, 100 ml`),
    ]);
    expect(job.deps.alerts.join(" ")).not.toContain("SV-NEW");

    await job.opsPost("/api/stock/write-offs", {
      consumable_code: "solvent",
      place_id: IMRAN,
      quantity: 100,
      note: "Past its date",
    });
    await look(morning(1));
    expect((await open()).results).toEqual([{ key: "stock_expiring:central" }]);
  });

  it("is looked at only in the hour from 9 am", async () => {
    await look(new Date("2026-09-21T06:30:00.000Z"));
    expect(job.deps.alerts).toEqual([]);
  });
});

describe("a transfer long on its way", () => {
  it("is told of a week after it was sent, and closes once received", async () => {
    const added = await job.opsPost("/api/stock/places", {
      kind: "stockroom",
      name: "Gurgaon stockroom",
      parent_id: "central",
      city: "Gurgaon",
    });
    const room = (await added.json<{ places: { id: string; name: string }[] }>()).places.find(
      (place) => place.name === "Gurgaon stockroom",
    )?.id;
    const sent = await job.opsPost("/api/stock/transfers", {
      consumable_code: "solvent",
      quantity: 50,
      from: "central",
      to: room,
    });
    const transfer = (await sent.json<{ in_transit: { id: string }[] }>()).in_transit[0]?.id ?? "";

    await look(morning(6));
    expect((await open()).results).not.toContainEqual({ key: `transfer_overdue:${transfer}` });
    await look(morning(8));
    expect(job.deps.alerts.at(-1)).toContain("50 ml of Solvent, sent from National warehouse to Gurgaon stockroom");

    await job.opsPost(`/api/stock/transfers/${transfer}/receive`, {});
    await look(morning(9));
    expect((await open()).results).not.toContainEqual({ key: `transfer_overdue:${transfer}` });
  });
});
