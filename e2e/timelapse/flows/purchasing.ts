// Buying and moving stock, once a month and in between: an order drafted from the supplier's list, approved, sent,
// received in two parts (a part shipment, then the rest) with lots and expiry, then sent on to each city's stockroom
// and each technician's kit, which the technician scans in on their phone.

import { expect } from "@playwright/test";
import { purchasing as purchasingCopy } from "../../../apps/ops/src/content/purchasing.ts";
import { catalogue } from "./catalog.ts";
import { dateOf, indiaDateOf } from "../sim.ts";
import { check } from "../steps.ts";
import { sees } from "../ui.ts";
import type { Sim, Technician } from "../world.ts";
import { jobsToday } from "./field.ts";

interface Order {
  id: string;
  number: number;
  state: string;
  total: number;
  needs_second_approval: boolean;
  lines: { id: string; consumable_code: string; quantity: number; received: number }[];
}

interface StockRead {
  places: { id: string; kind: string; city: string | null; name: string }[];
  holdings: { consumable_code: string; place_id: string; quantity: number }[];
  in_transit: { id: string; consumable_code: string; quantity: number; to: string }[];
}

/** The open order the month's receipts work on. */
let open: Order | undefined;

/** What one month buys: each consumable by the case, and hair systems for the fits ahead. */
function linesFor(month: number): { consumable_code: string; quantity: number }[] {
  return [
    ...catalogue.consumables.map(({ code, use }) => ({ consumable_code: code, quantity: use * 60 + month * 10 })),
    // Enough hair systems for every fit the month books, so a Stock at risk task always has a piece to send.
    ...catalogue.hairSystems.map((code) => ({ consumable_code: code, quantity: 150 })),
  ];
}

export async function draftAndSend(sim: Sim, wave: string, month: number): Promise<void> {
  const { desk, ops, steps, clock } = sim;
  open = await steps.run(
    {
      wave,
      workflow: "Purchase order",
      app: "ops",
      screen: "/purchasing",
      action: `month ${String(month)}: draft, approve and send an order`,
      mode: "api",
    },
    async () => {
      check(catalogue.supplier !== undefined, "no supplier to order from");
      const drafted = await ops.must<{ orders: Order[] }>("POST", "/api/purchase-orders", {
        supplier_id: catalogue.supplier,
        lines: linesFor(month),
        expected_on: dateOf(clock.day + 7),
        note: `Month ${String(month)} stock`,
      });
      const order = drafted.orders.find(
        (each) => each.state === "drafted" && each.lines.length === linesFor(month).length,
      );
      check(order !== undefined, "the drafted order is not listed");
      if (order === undefined) return undefined;
      const approved = await ops.must<{ orders: Order[] }>("POST", `/api/purchase-orders/${order.id}/approve`);
      const after = approved.orders.find((each) => each.id === order.id);
      if (after?.state === "drafted" && after.needs_second_approval) {
        // Above the default (Rs. 50,000) an order needs two managers; the same one cannot give both.
        const again = await ops.call("POST", `/api/purchase-orders/${order.id}/approve`);
        check(again.status >= 400, `the same manager gave the second approval too (${String(again.status)})`);
        sim.world.notes.push(`month ${String(month)}: the order needed a second approver; rule raised to Rs. 1 crore`);
        // The approval straight after reads the new rule: Settings' own isolate forgets its copy at once.
        await ops.must("POST", "/api/settings/po_second_approval_above_rupees", { value: 10_000_000 });
        await ops.must("POST", `/api/purchase-orders/${order.id}/cancel`, {
          reason: "Redrafted under the new approval rule",
        });
        const redrafted = await ops.must<{ orders: Order[] }>("POST", "/api/purchase-orders", {
          supplier_id: catalogue.supplier,
          lines: linesFor(month),
          expected_on: dateOf(clock.day + 7),
          note: `Month ${String(month)} stock`,
        });
        const fresh = redrafted.orders.find((each) => each.state === "drafted" && each.id !== order.id);
        if (fresh === undefined) throw new Error("the redrafted order is not listed");
        await ops.must("POST", `/api/purchase-orders/${fresh.id}/approve`);
        await ops.must("POST", `/api/purchase-orders/${fresh.id}/send`);
        return fresh;
      }
      check(after?.state === "approved", `the order reads ${after?.state ?? "gone"} after one approval`);
      await ops.must("POST", `/api/purchase-orders/${order.id}/send`);
      await desk.go("/purchasing");
      await sees(desk.page, purchasingCopy.title);
      await expect(desk.page.getByRole("row").filter({ hasText: "Lumen Hair Supplies" }).first()).toBeVisible();
      return order;
    },
    { pages: [desk.page] },
  );
}

/** What arrived of the open order: `share` of each line still to come, with lots that expire on their shelf life. */
export async function receive(sim: Sim, wave: string, share: number): Promise<void> {
  const { ops, steps, clock } = sim;
  const order = open;
  if (order === undefined) {
    await steps.run(
      {
        wave,
        workflow: "Receiving",
        app: "ops",
        screen: "/purchasing › Receive",
        action: "nothing to receive",
        mode: "api",
      },
      () => Promise.reject(new Error("no order went out this month, so nothing arrives")),
    );
    return;
  }
  await steps.run(
    {
      wave,
      workflow: "Receiving",
      app: "ops",
      screen: "/purchasing › Receive",
      action: share < 1 ? "a part shipment" : "the rest of the order",
      mode: "api",
    },
    async () => {
      const read = await ops.must<{ orders: Order[] }>("GET", "/api/purchase-orders");
      const now = read.orders.find((each) => each.id === order.id);
      check(now !== undefined, "the order is gone");
      if (now === undefined) return;
      const lines = now.lines
        .filter((line) => line.received < line.quantity)
        .map((line) => {
          const left = line.quantity - line.received;
          const consumable = catalogue.consumables.find((each) => each.code === line.consumable_code);
          const shelf = consumable === undefined ? null : shelfLifeOf(consumable.name);
          return {
            po_line_id: line.id,
            received: share < 1 ? Math.max(1, Math.floor(left * share)) : left,
            damaged: 0,
            qc_failed: 0,
            lot_code: `L${String(clock.day).padStart(3, "0")}-${line.consumable_code.slice(0, 6)}`,
            expires_on: shelf === null ? null : dateOf(clock.day + shelf),
          };
        });
      const after = await ops.must<{ orders: Order[] }>("POST", `/api/purchase-orders/${order.id}/receipts`, {
        lines,
        supplier_invoice: `INV-${String(clock.day)}`,
        freight_paise: 50_000,
        duty_paise: 0,
        clearing_paise: 0,
        note: null,
      });
      const state = after.orders.find((each) => each.id === order.id)?.state;
      check(
        state === (share < 1 ? "part_received" : "received"),
        `after the receipt the order reads ${state ?? "gone"}`,
      );
    },
  );
}

function shelfLifeOf(name: string): number | null {
  return { "Bonding glue": 60, Solvent: 120, "Shampoo sachet": 365 }[name] ?? null;
}

/**
 * What the warehouse holds goes on: a share to each city's stockroom, and from it to each technician's kit there,
 * hair systems by their labels. Each technician then scans in what came, as the kit screen does.
 */
export async function distribute(sim: Sim, wave: string): Promise<void> {
  const { ops, steps, world } = sim;
  await steps.run(
    {
      wave,
      workflow: "Stock transfers",
      app: "ops",
      screen: "/stock › Send",
      action: "warehouse → stockrooms → kits",
      mode: "api",
    },
    async () => {
      const stock = await ops.must<StockRead>("GET", "/api/stock");
      const warehouse = catalogue.warehouse;
      if (warehouse === undefined) throw new Error("no warehouse");
      const cities = [...catalogue.stockrooms.entries()];
      const technicians = world.technicians.filter((each) => each.active);
      for (const { code } of catalogue.consumables) {
        const held =
          stock.holdings.find((each) => each.consumable_code === code && each.place_id === warehouse)?.quantity ?? 0;
        if (held <= 0) continue;
        const each = Math.floor(held / (cities.length + 1));
        for (const [city, stockroom] of cities) {
          if (each <= 0) continue;
          const sent = await ops.must<StockRead>("POST", "/api/stock/transfers", {
            consumable_code: code,
            quantity: each,
            from: warehouse,
            to: stockroom,
          });
          // Between places it travels until the stockroom scans it in (Stock › In transit).
          for (const transit of sent.in_transit.filter(
            (one) => (one.to === stockroom || one.to.includes(city)) && one.consumable_code === code,
          )) {
            await ops.must("POST", `/api/stock/transfers/${transit.id}/receive`, {});
          }
          const kits = technicians.filter((technician) => technician.city === city);
          const perKit = Math.floor(each / (kits.length + 1));
          for (const technician of kits) {
            const kit = kitOf(stock, technician);
            if (kit === undefined || perKit <= 0) continue;
            await ops.must("POST", "/api/stock/transfers", {
              consumable_code: code,
              quantity: perKit,
              from: stockroom,
              to: kit,
              wait_for_scan: true,
            });
          }
        }
      }
      // Hair systems: two labelled pieces of each code to every fitter's kit.
      for (const code of catalogue.hairSystems) {
        const units = await ops.must<{ units: { code: string }[] }>(
          "GET",
          `/api/stock/units?consumable_code=${code}&place_id=${warehouse}`,
        );
        const labels = units.units.map((unit) => unit.code);
        for (const technician of technicians.filter((each) => each.fits)) {
          const kit = kitOf(stock, technician);
          const two = labels.splice(0, 3);
          if (kit === undefined || two.length === 0) continue;
          await ops.must("POST", "/api/stock/transfers", {
            consumable_code: code,
            quantity: two.length,
            from: warehouse,
            to: kit,
            units: two,
            wait_for_scan: true,
          });
        }
      }
    },
  );
  for (const technician of world.technicians.filter((each) => each.active && each.wire !== undefined)) {
    await scanIn(sim, wave, technician);
  }
}

const kitOf = (stock: StockRead, technician: Technician): string | undefined =>
  stock.places.find(
    (place) => place.kind === "kit" && (place.id === technician.id || place.name.includes(technician.name)),
  )?.id;

/** The technician scans in everything on its way to their kit (the kit screen's Receive). */
export async function scanIn(sim: Sim, wave: string, technician: Technician): Promise<void> {
  const wire = technician.wire;
  if (wire === undefined) return;
  await sim.steps.run(
    {
      wave,
      workflow: "Kit top-up",
      app: "tech",
      screen: "/kit",
      action: `${technician.name} receives what was sent`,
      mode: "api",
    },
    async () => {
      const kit = await wire.must<{ coming: { id: string; units: string[] }[] }>("GET", "/api/tech/kit");
      for (const coming of kit.coming) {
        await wire.must(
          "POST",
          `/api/tech/kit/transfers/${coming.id}/receive`,
          coming.units.length > 0 ? { units: coming.units } : {},
        );
      }
    },
  );
}

interface RiskTasks {
  groups: { group: string; tasks: { id: string; detail: string | null }[] }[];
}

/**
 * Each morning, the fits booked with no matching piece in their technician's reach (Tasks › Stock at risk): ops send a
 * labelled piece of the stock code from the warehouse to the fitter's kit, and the technician scans it in.
 */
export async function stockAtRisk(sim: Sim, wave: string): Promise<void> {
  const warehouse = catalogue.warehouse;
  if (warehouse === undefined) return;
  const tasks = await sim.ops.must<RiskTasks>("GET", "/api/tasks");
  const risks = tasks.groups.filter((group) => group.group === "stock_at_risk").flatMap((group) => group.tasks);
  for (const risk of risks.slice(0, 8)) {
    const visit = sim.world.visits.get(risk.id);
    const code = risk.detail ?? "";
    if (visit === undefined || code === "") continue;
    await sim.steps.run(
      {
        wave,
        workflow: "Stock at risk → kit top-up",
        app: "ops",
        screen: "/tasks › Stock at risk → /stock › Send",
        action: `a ${code} piece to the fitter of ${visit.client}'s fit`,
        mode: "api",
      },
      async () => {
        const date = indiaDateOf(Date.parse(visit.startsAt));
        let fitter: Technician | undefined;
        for (const technician of sim.world.technicians.filter((each) => each.active && each.fits)) {
          if ((await jobsToday(technician, date)).some((job) => job.id === risk.id)) {
            fitter = technician;
            break;
          }
        }
        check(fitter !== undefined, `no fitter holds ${visit.client}'s fit on ${date}`);
        if (fitter === undefined) return;
        const units = await sim.ops.must<{ units: { code: string }[] }>(
          "GET",
          `/api/stock/units?consumable_code=${code}&place_id=${warehouse}`,
        );
        const unit = units.units[0];
        check(unit !== undefined, `the warehouse holds no ${code} piece to send`);
        if (unit === undefined) return;
        await sim.ops.must("POST", "/api/stock/transfers", {
          consumable_code: code,
          quantity: 1,
          from: warehouse,
          to: fitter.id,
          units: [unit.code],
          wait_for_scan: true,
        });
        await scanIn(sim, wave, fitter);
      },
    );
  }
}
