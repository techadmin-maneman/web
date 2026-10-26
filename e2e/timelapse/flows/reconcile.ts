// The month's books held to what the run did: every payment the run made, to the paisa, on the Ledger; the refunds
// beside them; each technician's use of consumables beside what their visits were expected to use (the run uses
// exactly that, so nobody may be flagged); and the forecast and its accuracy filling in once a month has passed.

import { dateOf, FIRST_DAY, monthOf } from "../sim.ts";
import { check } from "../steps.ts";
import type { Sim } from "../world.ts";

interface LedgerRead {
  payments: { amount: number; refunded_amount: number; status: string; captured_at: string | null; kind: string }[];
  more: boolean;
}

export async function reconcile(sim: Sim, wave: string, month: string): Promise<void> {
  const from = `${month}-01`;
  const last = dateOf(sim.clock.day) < from ? from : dateOf(sim.clock.day);
  await sim.steps.run(
    {
      wave,
      workflow: "Ledger reconciliation",
      app: "ops",
      screen: "/ledger",
      action: `${month}: payments to the paisa`,
      mode: "api",
    },
    async () => {
      const ledger = await sim.ops.must<LedgerRead>("GET", `/api/payments/ledger?from=${from}&to=${last}`);
      check(
        !ledger.more,
        `the ledger for ${month} says there is more than one page holds; ops cannot see the month whole`,
      );
      const captured = ledger.payments.filter(
        (each) => each.status === "captured" || each.status === "refunded" || each.status === "partially_refunded",
      );
      const paid = captured.reduce((sum, each) => sum + each.amount, 0);
      const ours = sim.world.ledger.byMonth.get(month) ?? { paid: 0, payments: 0 };
      check(
        captured.length === ours.payments,
        `${month}: the ledger lists ${String(captured.length)} payments, the run made ${String(ours.payments)}`,
      );
      check(
        paid === ours.paid,
        `${month}: the ledger totals Rs. ${(paid / 100).toFixed(2)}, the run paid Rs. ${(ours.paid / 100).toFixed(2)}`,
      );
      const refunded = captured.reduce((sum, each) => sum + each.refunded_amount, 0);
      sim.world.notes.push(
        `${month}: ${String(captured.length)} payments, Rs. ${(paid / 100).toFixed(2)} in, Rs. ${(refunded / 100).toFixed(2)} back`,
      );
    },
  );
  await sim.steps.run(
    {
      wave,
      workflow: "Usage vs closed visits",
      app: "ops",
      screen: "/usage",
      action: "each technician's use beside expected",
      mode: "api",
    },
    async () => {
      const usage = await sim.ops.must<{
        technicians: { name: string; visits: number; over_percent: number | null; flagged: boolean }[];
      }>("GET", "/api/stock/usage");
      const flagged = usage.technicians.filter((each) => each.flagged);
      check(
        flagged.length === 0,
        `flagged though they used exactly what was expected: ${flagged.map((each) => `${each.name} ${String(each.over_percent)}%`).join(", ")}`,
      );
      check(
        usage.technicians.some((each) => each.visits > 0),
        "no technician's visits counted in Usage",
      );
    },
  );
  if (monthOf(sim.clock.day) >= 2) {
    await sim.steps.run(
      {
        wave,
        workflow: "Supply plan & forecast",
        app: "ops",
        screen: "/supply-plan",
        action: "forecast, accuracy and the plan fill in from the months behind",
        mode: "api",
      },
      async () => {
        const forecast = await sim.ops.must("GET", "/api/stock/forecast");
        const accuracy = await sim.ops.must(
          "GET",
          `/api/stock/forecast-accuracy?city=${encodeURIComponent([...sim.world.cities.keys()][0] ?? "Gurgaon")}`,
        );
        const plan = await sim.ops.must("GET", "/api/supply-plan");
        const rows = (value: unknown) => (Array.isArray(value) ? value.length : 0);
        const forecastRows = Object.values(forecast).reduce<number>((sum, value) => sum + rows(value), 0);
        const accuracyRows = Object.values(accuracy).reduce<number>((sum, value) => sum + rows(value), 0);
        const planRows = Object.values(plan).reduce<number>((sum, value) => sum + rows(value), 0);
        sim.world.notes.push(
          `${month}: forecast rows ${String(forecastRows)}, accuracy rows ${String(accuracyRows)}, plan rows ${String(planRows)}`,
        );
        check(forecastRows > 0, `after ${String(monthOf(sim.clock.day) - 1)} months of visits the forecast is empty`);
        check(monthOf(sim.clock.day) < 3 || accuracyRows > 0, "two months on, forecast accuracy holds nothing");
      },
    );
  }
}

export const SINCE = FIRST_DAY;
