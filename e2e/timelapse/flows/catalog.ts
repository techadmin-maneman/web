// The catalogue the business sells and uses, set up on day 1 and changed on later waves: consumables and what each
// service is expected to use, hair systems' stock codes and their prices, a supplier and what it supplies, the
// stockrooms, the job sheet's checklists and the discount codes. Each is read back on the console's own page.

import { expect } from "@playwright/test";
import { check } from "../steps.ts";
import { remember, type Sim } from "../world.ts";
import { dateOf } from "../sim.ts";

/** The package clients are fitted under: a first fit is sold as one of its hair systems (ADR 0211). */
export const PACKAGE = "classic";

/** Four stock codes, so most clients' profiles match one exactly and a few match none (a custom order). */
export const HAIR_SYSTEMS = [
  { colour: "1B", grey_percent: 0, density_percent: 100 },
  { colour: "1B", grey_percent: 10, density_percent: 100 },
  { colour: "2", grey_percent: 0, density_percent: 100 },
  { colour: "2", grey_percent: 10, density_percent: 120 },
] as const;
export const BASE = { base_width_in: 7, base_length_in: 9 } as const;

export const CONSUMABLES = [
  {
    name: "Tape strips",
    unit: "strip",
    unit_cost: 1_200,
    reorder_kit: 20,
    reorder_central: 200,
    shelf_life_days: null,
    use: 4,
  },
  {
    name: "Bonding glue",
    unit: "ml",
    unit_cost: 90,
    reorder_kit: 20,
    reorder_central: 300,
    shelf_life_days: 60,
    use: 3,
  },
  { name: "Solvent", unit: "ml", unit_cost: 50, reorder_kit: 50, reorder_central: 600, shelf_life_days: 120, use: 10 },
  {
    name: "Shampoo sachet",
    unit: "sachet",
    unit_cost: 800,
    reorder_kit: 4,
    reorder_central: 40,
    shelf_life_days: 365,
    use: 1,
  },
] as const;

interface ConsumableRow {
  code: string;
  name: string;
  hair_system: unknown;
}

export interface Catalogue {
  consumables: { code: string; name: string; use: number }[];
  hairSystems: string[];
  supplier?: string;
  warehouse?: string;
  stockrooms: Map<string, string>;
}

export const catalogue: Catalogue = { consumables: [], hairSystems: [], stockrooms: new Map() };

export async function setUpCatalogue(sim: Sim, wave: string): Promise<void> {
  const { desk, ops, steps, world } = sim;
  const day = sim.clock.day;

  await steps.run(
    {
      wave,
      workflow: "Consumables",
      app: "ops",
      screen: "/items",
      action: "add four consumables and what a visit uses",
      mode: "api",
    },
    async () => {
      // The package first: what a service is expected to use is set per package.
      await ops.must("POST", "/api/packages", { name: "Classic", code: PACKAGE });
      for (const item of CONSUMABLES) {
        const { use, ...body } = item;
        await ops.must("POST", "/api/consumables", body);
      }
      const listed = await ops.must<{ consumables: ConsumableRow[] }>("GET", "/api/consumables");
      catalogue.consumables = CONSUMABLES.map((item) => {
        const row = listed.consumables.find((each) => each.name === item.name);
        if (row === undefined) throw new Error(`${item.name} is not listed after it was added`);
        return { code: row.code, name: item.name, use: item.use };
      });
      const items = catalogue.consumables.map(({ code, use }) => ({ code, quantity: use }));
      for (const visit_type of ["first_fit", "service", "replacement"] as const) {
        await ops.must("POST", "/api/service-usage", { visit_type, tier: PACKAGE, items });
      }
      await desk.go("/items");
      await expect(desk.page.getByText("Bonding glue").first()).toBeVisible();
    },
    { pages: [desk.page] },
  );

  await steps.run(
    {
      wave,
      workflow: "Hair systems & prices",
      app: "ops",
      screen: "/settings/packages",
      action: "a package, four stock codes, each priced from tomorrow",
      mode: "api",
    },
    async () => {
      for (const [item, amount] of [
        ["service", 220_000],
        ["replacement", 1_500_000],
      ] as const) {
        await ops.must("POST", "/api/prices", {
          item,
          tier: PACKAGE,
          amount_ex_gst: amount,
          gst_percent: 0,
          valid_from: dateOf(day + 1),
        });
      }
      for (const spec of HAIR_SYSTEMS) {
        const { code } = await ops.must<{ code: string }>("POST", "/api/hair-systems", {
          product: PACKAGE,
          ...BASE,
          ...spec,
          unit_cost: 900_000,
          reorder_kit: 1,
          reorder_central: 4,
        });
        catalogue.hairSystems.push(code);
        await ops.must("POST", "/api/prices", {
          item: "hair_system",
          tier: code,
          amount_ex_gst: 2_800_000,
          gst_percent: 0,
          valid_from: dateOf(day + 1),
        });
      }
      remember(world, "hair_systems", catalogue.hairSystems.join(","));
      await desk.go("/settings/packages");
      await expect(desk.page.getByText("Classic").first()).toBeVisible();
    },
    { pages: [desk.page] },
  );

  await steps.run(
    {
      wave,
      workflow: "Suppliers",
      app: "ops",
      screen: "/suppliers",
      action: "a supplier and what it supplies",
      mode: "api",
    },
    async () => {
      const made = await ops.must<{ suppliers: { id: string; name: string }[] }>("POST", "/api/suppliers", {
        name: "Lumen Hair Supplies",
        gstin: null,
        country: "IN",
        currency: "INR",
        contact_name: "Farah Khan",
        contact_phone: "+919811100001",
        contact_email: "orders@lumen.example",
        payment_terms_days: 30,
        warranty_days: 90,
      });
      const supplier = made.suppliers.find((each) => each.name === "Lumen Hair Supplies");
      check(supplier !== undefined, "the supplier is not listed");
      if (supplier === undefined) return;
      catalogue.supplier = supplier.id;
      for (const { code } of catalogue.consumables) {
        await ops.must("POST", `/api/suppliers/${supplier.id}/items`, {
          consumable_code: code,
          their_code: null,
          unit_price: 2_000,
          pack_size: 1,
          minimum_order: 1,
          lead_time_days: 7,
        });
      }
      for (const code of catalogue.hairSystems) {
        await ops.must("POST", `/api/suppliers/${supplier.id}/items`, {
          consumable_code: code,
          their_code: `LM-${code}`,
          unit_price: 900_000,
          pack_size: 1,
          minimum_order: 1,
          lead_time_days: 21,
        });
      }
      await desk.go("/suppliers");
      await expect(desk.page.getByText("Lumen Hair Supplies").first()).toBeVisible();
    },
    { pages: [desk.page] },
  );

  await steps.run(
    {
      wave,
      workflow: "Stock places",
      app: "ops",
      screen: "/stock › Places",
      action: "a stockroom in each city open",
      mode: "api",
    },
    async () => {
      const stock = await ops.must<{ places: { id: string; kind: string; city: string | null }[] }>(
        "GET",
        "/api/stock",
      );
      const warehouse = stock.places.find((each) => each.kind === "warehouse");
      check(warehouse !== undefined, "no national warehouse");
      if (warehouse === undefined) return;
      catalogue.warehouse = warehouse.id;
      await addStockrooms(sim, [...world.cities.keys()]);
    },
  );

  await steps.run(
    {
      wave,
      workflow: "Job sheet",
      app: "ops",
      screen: "/settings/job-sheet",
      action: "a checklist for each kind of visit",
      mode: "api",
    },
    async () => {
      const lists: Record<string, string[]> = {
        consultation: ["Scalp checked", "Measurements taken", "Options explained"],
        first_fit: ["Scalp cleaned", "Base cut to template", "Fitted and styled"],
        service: ["System removed", "Scalp cleaned", "Re-bonded", "Styled"],
        replacement: ["Old system removed", "New system fitted", "Styled"],
      };
      for (const [visitType, labels] of Object.entries(lists)) {
        await ops.must("POST", `/api/job-sheet/checklists/${visitType}`, {
          items: labels.map((label) => ({ label, client: label })),
        });
      }
      await desk.go("/settings/job-sheet");
      await expect(desk.page.getByText("Re-bonded").first()).toBeVisible();
    },
    { pages: [desk.page] },
  );
}

/** A stockroom in each city named, under the warehouse, where none is yet. */
export async function addStockrooms(sim: Sim, cities: readonly string[]): Promise<void> {
  const stock = await sim.ops.must<{ places: { id: string; kind: string; city: string | null }[] }>(
    "GET",
    "/api/stock",
  );
  for (const city of cities) {
    const held = stock.places.find((each) => each.kind === "stockroom" && each.city === city);
    if (held !== undefined) {
      catalogue.stockrooms.set(city, held.id);
      continue;
    }
    const after = await sim.ops.must<{ places: { id: string; kind: string; city: string | null }[] }>(
      "POST",
      "/api/stock/places",
      {
        kind: "stockroom",
        name: `${city} stockroom`,
        parent_id: catalogue.warehouse,
        city,
      },
    );
    const made = after.places.find((each) => each.kind === "stockroom" && each.city === city);
    if (made !== undefined) catalogue.stockrooms.set(city, made.id);
  }
}
