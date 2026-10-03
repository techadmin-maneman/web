// The services clients book, set in the console (src/routes/ops-services.ts,
// docs/decisions/0085-services-ops-can-edit.md), and the prices each carries
// (src/routes/ops-settings.ts). NOW is Monday 21 September 2026, 12 noon in
// India. Nothing here is a person.
//
// What these hold: a kind is code and its services are ops', each added,
// renamed, timed, ordered, retired and restored with its audit entry in the same
// batch; a service keeps its code, and so its prices, whatever it is called; a
// kind with a standard service always keeps something to book, and a first fit
// may be left with no hair system at all; a price is set only for a service that
// is offered on its day; and the price in force and every spent one stay.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/http/context.ts";
import { appFor, fakeDependencies, fakeQueue, markDatabase, request } from "./helpers.ts";

let ops: App;

const POST = { "Content-Type": "application/json", Origin: "https://maneman.test" };

const post = (path: string, body?: unknown, bindings: Partial<Env> = {}) =>
  request(
    ops,
    path,
    { method: "POST", headers: POST, ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
    bindings,
  );

interface Row {
  item: string;
  tier: string;
  amount_ex_gst: number;
  valid_from: string;
  in_force: boolean;
}

interface Service {
  kind: string;
  tier: string;
  name: string;
  minutes: number;
  sort: number;
  retired_date: string | null;
  offered: boolean;
  fsm_item_id: string | null;
  updated_by: string;
  prices: Row[];
}

interface Services {
  today: string;
  kinds: { kind: string; minutes: number }[];
  services: Service[];
  late_fees: { kind: string; item: string; prices: Row[] }[];
  min_minutes: number;
  max_minutes: number;
}

const services = async (): Promise<Services> => (await request(ops, "/api/services")).json<Services>();

const serviceNamed = async (name: string): Promise<Service> => {
  const found = (await services()).services.find((service) => service.name === name);
  if (found === undefined) throw new Error(`${name} is not in the answer`);
  return found;
};

const auditFor = (action: string) =>
  env.DB.prepare("SELECT actor, subject_id, detail FROM audit_log WHERE action = ?1 ORDER BY id")
    .bind(action)
    .all<{ actor: string; subject_id: string; detail: string }>();

const price = (item: string, tier: string, validFrom: string, paise = 4_000_000) =>
  post("/api/prices", { item, tier, amount_ex_gst: paise, gst_percent: 0, valid_from: validFrom });

/** A price in force since `validFrom`, as an earlier day's change leaves one: the console sets none from today. */
const pricedSince = (item: string, tier: string, validFrom: string, paise = 4_000_000) =>
  env.DB.prepare(
    "INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from) VALUES (?1, ?2, ?3, 0, ?4)",
  )
    .bind(item, tier, paise, validFrom)
    .run();

beforeEach(async () => {
  await markDatabase();
  ops = appFor("local", fakeDependencies(), {}, "ops");
});

describe("the services, before anybody changes one", () => {
  it("are the four the console starts with, each kind's standard, named as FSM names them, with its prices", async () => {
    const body = await services();

    expect(body.services.map((service) => [service.kind, service.tier, service.name, service.minutes])).toEqual([
      ["consultation", "standard", "Consultation", 60],
      ["first_fit", "standard", "First fit", 180],
      ["service", "standard", "Service visit", 90],
      ["replacement", "standard", "Replacement", 135],
    ]);
    // Migrations 0016 and 0018: from January, and from the 22nd, which is still to come.
    const serviceVisit = body.services.find((service) => service.kind === "service");
    expect(serviceVisit?.prices.map((row) => [row.valid_from, row.in_force])).toEqual([
      ["2026-09-22", false],
      ["2026-01-01", true],
    ]);
    expect(body.services.every((service) => service.offered && service.retired_date === null)).toBe(true);
  });

  it("gives each kind the length a new service of it starts at, and the late fees beside their kinds", async () => {
    const body = await services();

    expect(body.kinds).toEqual([
      { kind: "consultation", minutes: 60 },
      { kind: "first_fit", minutes: 180 },
      { kind: "service", minutes: 90 },
      { kind: "replacement", minutes: 135 },
    ]);
    expect(body.late_fees.map((fee) => [fee.kind, fee.item, fee.prices.length])).toEqual([
      ["first_fit", "late_fee_first_fit", 2],
      ["replacement", "late_fee_replacement", 2],
    ]);
    // Half an hour, to the eight half-slots of a day (src/policy/visit-length.ts).
    expect([body.min_minutes, body.max_minutes]).toEqual([30, 360]);
  });
});

describe("adding a service", () => {
  it("adds it last in its kind, its code made from its name and its length its kind's, unpriced and so unoffered", async () => {
    const answer = await post("/api/services", { kind: "first_fit", name: "Premium" });

    expect(answer.status).toBe(201);
    const added = await serviceNamed("Premium");
    expect(added).toMatchObject({ kind: "first_fit", tier: "premium", minutes: 180, sort: 1, prices: [] });
    expect(added.updated_by).toBe("ops@localhost");
  });

  it("takes a code and a length of its own", async () => {
    await post("/api/services", { kind: "first_fit", name: "Thin skin", tier: "premium", minutes: 240 });

    expect(await serviceNamed("Thin skin")).toMatchObject({ tier: "premium", minutes: 240 });
  });

  it("records who added it, in its kind and code", async () => {
    await post("/api/services", { kind: "replacement", name: "Lace, front", minutes: 150 });

    const { results } = await auditFor("service.add");
    expect(results[0]).toMatchObject({ actor: "ops@localhost", subject_id: "replacement/lace_front" });
    expect(JSON.parse(results[0]?.detail ?? "{}")).toEqual({ name: "Lace, front", minutes: 150 });
  });

  it.each([
    ["a name that opens as a spreadsheet formula would", { name: "=Premium" }, "name"],
    ["a name of one letter", { name: "P" }, "name"],
    ["a length under half an hour", { name: "Quick", minutes: 20 }, "minutes"],
    ["a length longer than the day holds", { name: "Long", minutes: 400 }, "minutes"],
    ["a name with no letter a code can be made from, and no code", { name: "प्रीमियम" }, "tier"],
  ])("refuses %s, naming the box, and records nothing", async (_, body, field) => {
    const answer = await post("/api/services", { kind: "first_fit", ...body });

    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: { code: "invalid_request", fields: [field] } });
    expect((await auditFor("service.add")).results).toHaveLength(0);
  });

  it("refuses a name another service has, whatever its kind or case, and a code its kind has", async () => {
    const sameName = await post("/api/services", { kind: "replacement", name: "first FIT" });
    expect(sameName.status).toBe(409);
    expect(await sameName.json()).toMatchObject({ error: { code: "service_exists", fields: ["name"] } });

    const sameCode = await post("/api/services", { kind: "first_fit", name: "Another", tier: "standard" });
    expect(sameCode.status).toBe(409);
    expect(await sameCode.json()).toMatchObject({ error: { code: "service_exists", fields: ["tier"] } });
  });

  it("lets two kinds carry the same code, since a price is its kind's and its code's", async () => {
    expect(
      (await post("/api/services", { kind: "first_fit", name: "Premium first fit", tier: "premium" })).status,
    ).toBe(201);
    expect((await post("/api/services", { kind: "service", name: "Premium service", tier: "premium" })).status).toBe(
      201,
    );
  });
});

describe("changing a service", () => {
  it("renames it and keeps its code, and so every price it has", async () => {
    const answer = await post("/api/services/service/standard/name", { name: "Monthly service" });

    expect(answer.status).toBe(200);
    const renamed = await serviceNamed("Monthly service");
    expect(renamed.tier).toBe("standard");
    expect(renamed.prices).toHaveLength(2);
    const { results } = await auditFor("service.rename");
    expect(results[0]?.subject_id).toBe("service/standard");
    expect(JSON.parse(results[0]?.detail ?? "{}")).toEqual({ from: "Service visit", to: "Monthly service" });
  });

  it("refuses a name another service has, and one it cannot have", async () => {
    const taken = await post("/api/services/service/standard/name", { name: "Replacement" });
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({ error: { code: "service_exists", fields: ["name"] } });
    expect((await post("/api/services/service/standard/name", { name: "+1" })).status).toBe(400);
  });

  it("gives it another length, from now on, and records it", async () => {
    const answer = await post("/api/services/replacement/standard/length", { minutes: 150 });

    expect(answer.status).toBe(200);
    expect((await serviceNamed("Replacement")).minutes).toBe(150);
    const { results } = await auditFor("service.length");
    expect(JSON.parse(results[0]?.detail ?? "{}")).toEqual({ from: 135, to: 150 });
  });

  it("puts a kind's services in the order given, every one of them once", async () => {
    await post("/api/services", { kind: "first_fit", name: "Premium" });

    expect((await post("/api/services/first_fit/order", { tiers: ["premium"] })).status).toBe(400);
    expect((await post("/api/services/first_fit/order", { tiers: ["premium", "premium"] })).status).toBe(400);
    const answer = await post("/api/services/first_fit/order", { tiers: ["premium", "standard"] });

    expect(answer.status).toBe(200);
    const kind = (await services()).services.filter((service) => service.kind === "first_fit");
    expect(kind.map((service) => service.tier)).toEqual(["premium", "standard"]);
    const { results } = await auditFor("service.reorder");
    expect(results).toHaveLength(1);
    expect(JSON.parse(results[0]?.detail ?? "{}")).toEqual({ order: "premium,standard" });
  });

  it("answers not_found for a service the console does not hold", async () => {
    expect((await post("/api/services/first_fit/lace/name", { name: "Lace" })).status).toBe(404);
    expect((await post("/api/services/first_fit/lace/retire", { from: "2026-09-21" })).status).toBe(404);
  });
});

describe("retiring a service", () => {
  /** A premium first fit ops added and priced from today. */
  async function premium() {
    await post("/api/services", { kind: "first_fit", name: "Premium" });
    await pricedSince("first_fit", "premium", "2026-09-21");
  }

  it("stops offering it from the day given, and records it", async () => {
    await premium();
    const answer = await post("/api/services/first_fit/standard/retire", { from: "2026-10-01" });

    expect(answer.status).toBe(200);
    expect(await serviceNamed("First fit")).toMatchObject({ retired_date: "2026-10-01", offered: true });
    await post("/api/services", { kind: "service", name: "Premium service" });
    await pricedSince("service", "premium_service", "2026-09-21", 250_000);
    await post("/api/services/service/standard/retire", { from: "2026-09-21" });
    expect(await serviceNamed("Service visit")).toMatchObject({ retired_date: "2026-09-21", offered: false });
    const { results } = await auditFor("service.retire");
    expect(results.map((entry) => entry.subject_id)).toEqual(["first_fit/standard", "service/standard"]);
    expect(JSON.parse(results[0]?.detail ?? "{}")).toEqual({ from: "2026-10-01" });
  });

  it("refuses a day before today: what was offered then was offered", async () => {
    await premium();
    const answer = await post("/api/services/first_fit/premium/retire", { from: "2026-09-20" });
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: { fields: ["retired_date"] } });
  });

  // src/policy/services.ts: a kind with a standard service keeps one never retired and priced, so it stays bookable.
  it("refuses to retire a kind's last service, until another is added and priced", async () => {
    const alone = await post("/api/services/replacement/standard/retire", { from: "2026-10-01" });
    expect(alone.status).toBe(409);
    expect(await alone.json()).toMatchObject({ error: { code: "last_of_kind" } });

    await post("/api/services", { kind: "replacement", name: "Lace" });
    expect((await post("/api/services/replacement/standard/retire", { from: "2026-10-01" })).status).toBe(409);
    await price("replacement", "lace", "2026-10-02");
    expect((await post("/api/services/replacement/standard/retire", { from: "2026-10-01" })).status).toBe(409);
    await price("replacement", "lace", "2026-10-01");
    expect((await post("/api/services/replacement/standard/retire", { from: "2026-10-01" })).status).toBe(200);
    expect((await auditFor("service.retire")).results).toHaveLength(1);
  });

  // The owner's decision of 2 October 2026: only the hair systems ops offer, and no generic first fit in their place.
  it("retires a first fit's last hair system, which leaves first fits with nothing to book", async () => {
    const answer = await post("/api/services/first_fit/standard/retire", { from: "2026-09-21" });

    expect(answer.status).toBe(200);
    expect(await serviceNamed("First fit")).toMatchObject({ retired_date: "2026-09-21", offered: false });
    const site = appFor("local", fakeDependencies());
    const offered = await (await request(site, "/api/published-prices")).json<{ services: { type: string }[] }>();
    expect(offered.services.filter((service) => service.type === "first_fit")).toEqual([]);
  });

  it("offers it again once restored, with the prices it had, and records it", async () => {
    await premium();
    await post("/api/services/first_fit/premium/retire", { from: "2026-09-21" });

    const answer = await post("/api/services/first_fit/premium/restore");

    expect(answer.status).toBe(200);
    expect(await serviceNamed("Premium")).toMatchObject({
      retired_date: null,
      offered: true,
      prices: [expect.anything()],
    });
    const { results } = await auditFor("service.restore");
    expect(JSON.parse(results[0]?.detail ?? "{}")).toEqual({ was: "2026-09-21" });
    expect((await post("/api/services/first_fit/premium/restore")).status).toBe(400);
  });

  it("asks for a service already retired to be restored before it is given another day", async () => {
    await premium();
    await post("/api/services/first_fit/premium/retire", { from: "2026-09-21" });

    expect((await post("/api/services/first_fit/premium/retire", { from: "2026-10-01" })).status).toBe(400);
  });
});

describe("a service's prices", () => {
  it("refuses a price for a service retired by the day it would apply from, and takes one from before", async () => {
    await post("/api/services", { kind: "first_fit", name: "Premium" });
    await pricedSince("first_fit", "premium", "2026-09-21");
    await post("/api/services/first_fit/premium/retire", { from: "2026-10-01" });

    const after = await price("first_fit", "premium", "2026-10-01", 4_500_000);
    expect(after.status).toBe(400);
    expect(await after.json()).toMatchObject({ error: { code: "service_retired", fields: ["valid_from"] } });
    expect((await price("first_fit", "premium", "2026-09-30", 4_500_000)).status).toBe(200);
  });

  it("still refuses a price from today or before: today's may be quoted already, an earlier one invoiced", async () => {
    await post("/api/services", { kind: "first_fit", name: "Premium" });
    for (const validFrom of ["2026-09-20", "2026-09-21"]) {
      const answer = await price("first_fit", "premium", validFrom);
      expect(answer.status, validFrom).toBe(400);
      expect(await answer.json()).toMatchObject({ error: { code: "invalid_request", fields: ["valid_from"] } });
    }
  });
});

describe("correcting a price still to come", () => {
  const OCTOBER = {
    item: "service",
    tier: "standard",
    amount_ex_gst: 250_000,
    gst_percent: 18,
    valid_from: "2026-10-01",
  };
  const correct = (body: Record<string, unknown>) => post("/api/prices/correct", { ...OCTOBER, ...body });
  const serviceRows = async () =>
    (await serviceNamed("Service visit")).prices.map((row) => [row.valid_from, row.amount_ex_gst]);

  it("takes the row back and sets its replacement, from another day, in one go", async () => {
    await post("/api/prices", OCTOBER);

    const answer = await correct({ was_valid_from: "2026-10-01", valid_from: "2026-10-05", amount_ex_gst: 260_000 });

    expect(answer.status).toBe(200);
    expect(await serviceRows()).toEqual([
      ["2026-10-05", 260_000],
      ["2026-09-22", 200_000],
      ["2026-01-01", 200_000],
    ]);
    // Both halves are on the record, as each would be alone.
    expect(JSON.parse((await auditFor("price.withdraw")).results[0]?.detail ?? "{}")).toMatchObject({
      amount_ex_gst: 250_000,
      valid_from: "2026-10-01",
    });
    expect(JSON.parse((await auditFor("price.set")).results.at(-1)?.detail ?? "{}")).toMatchObject({
      to: 260_000,
      valid_from: "2026-10-05",
    });
  });

  it("corrects the figure of the same day", async () => {
    await post("/api/prices", OCTOBER);
    expect((await correct({ was_valid_from: "2026-10-01", amount_ex_gst: 240_000 })).status).toBe(200);
    expect((await serviceRows())[0]).toEqual(["2026-10-01", 240_000]);
  });

  it("refuses to correct the price in force or a spent one, which stay, and changes nothing", async () => {
    await pricedSince("service", "standard", "2026-09-21", 250_000);
    for (const validFrom of ["2026-01-01", "2026-09-21"]) {
      const answer = await correct({ was_valid_from: validFrom, valid_from: "2026-10-05" });
      expect(answer.status, validFrom).toBe(400);
      expect(await answer.json()).toMatchObject({ error: { code: "invalid_request", fields: ["was_valid_from"] } });
    }
    expect((await auditFor("price.withdraw")).results).toHaveLength(0);
    expect((await serviceRows()).map(([from]) => from)).toContain("2026-01-01");
  });

  it("refuses a correction from today or before, and answers not_found for a row the book does not hold", async () => {
    await post("/api/prices", OCTOBER);
    for (const validFrom of ["2026-09-20", "2026-09-21"]) {
      const backDated = await correct({ was_valid_from: "2026-10-01", valid_from: validFrom });
      expect(backDated.status, validFrom).toBe(400);
      expect(await backDated.json()).toMatchObject({ error: { fields: ["valid_from"] } });
    }
    expect((await serviceRows())[0]).toEqual(["2026-10-01", 250_000]);
    expect((await correct({ was_valid_from: "2026-12-01", valid_from: "2026-12-05" })).status).toBe(404);
  });
});

describe("FSM's catalogue, while the owner has the push on", () => {
  it("follows a service renamed or restored, and nothing else a service change does", async () => {
    const queue = fakeQueue();
    ops = appFor("local", fakeDependencies(), { fsmCataloguePush: true }, "ops");

    await post("/api/services/service/standard/name", { name: "Monthly service" }, { FSM_QUEUE: queue });
    await post("/api/services/service/standard/length", { minutes: 100 }, { FSM_QUEUE: queue });
    await post("/api/services", { kind: "service", name: "Premium" }, { FSM_QUEUE: queue });

    expect(queue.sent).toEqual([{ catalogue_sync: true, request_id: expect.any(String) as unknown }]);
  });
});
