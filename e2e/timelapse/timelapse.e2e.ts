// Six months of the business, played in about half an hour (scripts/dev/timelapse.ts starts the stack). One clock
// moves the API, the cron and every browser (./sim.ts); each day runs the waves due on it (./plan.ts); a step that
// fails is written down and the days go on (./steps.ts). What it found is in test-results/timelapse/.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "@playwright/test";
import { Phone, Wire } from "./actors.ts";
import { wavesOn } from "./plan.ts";
import { at, clockCost, LAST_DAY_NUMBER, SimClock } from "./sim.ts";
import { OUT } from "./stack.ts";
import { Steps } from "./steps.ts";
import { hung, readWorkerLog } from "./worker-log.ts";
import { newWorld, type Sim } from "./world.ts";

test("six months of the business, every workflow at several points in time", async ({ browser }) => {
  const lastDay = Number(process.env.TIMELAPSE_DAYS ?? String(LAST_DAY_NUMBER));
  const started = Date.now();
  const clock = new SimClock();
  await clock.set(at(1, "07:00"));
  const steps = new Steps(clock);
  clock.onTick = (tick) => {
    if (tick.status !== 200)
      steps.report({ kind: "cron", app: "worker", message: `the cron run answered ${String(tick.status)}` });
    readWorkerLog(steps);
    return Promise.resolve();
  };
  const desk = await Phone.open(browser, clock, steps, "ops");
  const sim: Sim = {
    browser,
    clock,
    steps,
    world: newWorld(),
    desk,
    ops: new Wire("ops", steps),
    site: new Wire("site", steps),
  };

  for (let day = 1; day <= lastDay; day += 1) {
    await clock.advanceTo(at(day, "07:30"));
    for (const wave of wavesOn(day)) {
      try {
        await wave.run(sim, day);
      } catch (error) {
        // A wave's own steps catch their faults; this is the harness failing, written down so the days go on.
        steps.report({
          kind: "error",
          app: "worker",
          message: `wave ${wave.name} broke off: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      readWorkerLog(steps);
    }
  }
  await clock.advanceTo(at(lastDay, "23:59"));
  readWorkerLog(steps);

  const records = steps.records;
  const summary = {
    days: lastDay,
    wallMs: Date.now() - started,
    steps: records.length,
    passed: records.filter((record) => record.status === "passed").length,
    failed: records.filter((record) => record.status === "failed").length,
    healed: records.filter((record) => record.status === "healed").length,
    ticks: clock.ticks.length,
    tickMs: clock.ticks.reduce((sum, tick) => sum + tick.ms, 0),
    hungCancellations: hung.count,
    clock: clockCost,
    world: {
      cities: [...sim.world.cities.keys()],
      technicians: sim.world.technicians.length,
      clients: sim.world.clients.length,
      visits: sim.world.visits.size,
      ledger: sim.world.ledger,
      notes: sim.world.notes,
    },
  };
  writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
});
