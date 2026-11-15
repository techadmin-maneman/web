// A claim under the fit guarantee (docs/decisions/0256-fit-guarantee-setting.md, docs/decisions/0258-the-issue-log.md):
// a report on the fit about a first fit inside its guarantee opens the Tasks row "Fit guarantee claim", one a fit, until
// Care close it. NOW is Monday 21 September 2026, 12 noon in India. Every name, number and message here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { outstandingTasks } from "../../../src/domain/ops/tasks.ts";
import { TASK_SLA_HOURS } from "../../../src/policy/tasks.ts";
import { asClient, client, fittedInAugust, signedIn } from "../clients.ts";
import { markDatabase, NOW } from "../helpers.ts";

const ROHIT = "p-rohit";
const FIT = "fit-1";

let cookie: string;

beforeEach(async () => {
  await markDatabase();
  await client(ROHIT, "+919810000001");
  cookie = await signedIn(ROHIT);
});

/** The client's first fit, done `daysAgo` days before NOW. */
async function fittedDaysAgo(daysAgo: number) {
  await fittedInAugust(ROHIT, FIT);
  const start = new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE appointments SET window_start = ?2, window_end = ?2 WHERE id = ?1").bind(FIT, start),
    env.DB.prepare(
      `INSERT INTO visit_outcomes (id, appointment_id, started_at, ended_at, duration_minutes, outcome, updated_at)
       VALUES ('vo-1', ?1, ?2, ?2, 180, 'done', ?2)`,
    ).bind(FIT, start),
  ]);
}

const report = (body: object) => asClient(cookie, "/api/me/problems", { method: "POST", body });
const claims = async () =>
  (await outstandingTasks(env.DB, NOW, TASK_SLA_HOURS)).tasks.filter((task) => task.group === "fit_guarantee_claim");

describe("a fit guarantee claim", () => {
  it("opens one Tasks row for a first fit inside its guarantee, from the latest report on it", async () => {
    await fittedDaysAgo(3);
    await report({ about: "fit_guarantee", text: "It does not sit right." });
    await report({ about: "fit_guarantee", visit_id: null, text: "Still not right." });
    expect(await claims()).toEqual([
      expect.objectContaining({
        id: FIT,
        detail: "Still not right.",
        facts: expect.objectContaining({ group: "fit_guarantee_claim", reference: "MM-ISS-0002" }) as unknown,
      }),
    ]);
  });

  it("opens none for a report outside the guarantee's days", async () => {
    await fittedDaysAgo(20);
    await report({ about: "fit_guarantee", text: "It does not sit right." });
    expect(await claims()).toEqual([]);
  });

  it("opens none for a report on anything else, inside the days", async () => {
    await fittedDaysAgo(2);
    await report({ about: "edges_lifting", text: "The front lifts." });
    expect(await claims()).toEqual([]);
  });
});
