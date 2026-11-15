// A claim under the fit guarantee (docs/decisions/0256-fit-guarantee-setting.md, docs/decisions/0258-the-issue-log.md):
// a report on the fit about a first fit inside its guarantee opens the Tasks row "Fit guarantee claim" from its first
// report, with the fit's sign-off and the photographs sent, until Care close it; a claim after the close opens another.
// NOW is Monday 21 September 2026, 12 noon in India. Every name, number and message here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { outstandingTasks } from "../../../src/domain/ops/tasks.ts";
import { TASK_SLA_HOURS } from "../../../src/policy/tasks.ts";
import { asClient, client, fittedInAugust, signedIn } from "../clients.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";

const ROHIT = "p-rohit";
const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9,
]);
const FIT = "fit-1";

let cookie: string;

beforeEach(async () => {
  await markDatabase();
  await client(ROHIT, "+919810000001");
  cookie = await signedIn(ROHIT);
});

/** `minutes` after NOW. */
const after = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

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

const report = (body: object, minutes = 0) =>
  asClient(cookie, "/api/me/problems", { method: "POST", body }, { now: after(minutes) });
const claims = async (minutes = 0) =>
  (await outstandingTasks(env.DB, after(minutes), TASK_SLA_HOURS)).tasks.filter(
    (task) => task.group === "fit_guarantee_claim",
  );
const close = (id: string) =>
  request(
    appFor("local", fakeDependencies({ now: () => after(60) }), {}, "ops"),
    `/api/tasks/fit_guarantee_claim/${id}/close`,
    {
      method: "POST",
      headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Refit booked for Thursday." }),
    },
  );

describe("a fit guarantee claim", () => {
  it("opens one Tasks row from its first report, with the latest words, the sign-off and the photographs", async () => {
    await fittedDaysAgo(3);
    await env.DB.prepare(
      `INSERT INTO fit_sign_offs (appointment_id, state, asked_at, signed_at, guarantee_days, updated_at)
       VALUES (?1, 'signed', ?2, ?2, 14, ?2)`,
    )
      .bind(FIT, NOW.toISOString())
      .run();
    await report({ about: "fit_guarantee", text: "It does not sit right." });
    await report({ about: "fit_guarantee", visit_id: null, text: "Still not right." }, 30);
    const [claim, ...more] = await claims(40);
    expect(more).toEqual([]);
    expect(claim).toMatchObject({
      detail: "Still not right.",
      // The deadline runs from the first report: writing again moves it no later.
      since: NOW.toISOString(),
      facts: { group: "fit_guarantee_claim", reference: "MM-ISS-0001", sign_off: "signed", photos: 0 },
    });
  });

  it("counts the claim's photographs and names the chat they are read in", async () => {
    await fittedDaysAgo(3);
    await report({ about: "fit_guarantee", text: "It does not sit right." });
    await request(appFor("local", fakeDependencies(), {}, "client"), "/api/me/problems/MM-ISS-0001/photos", {
      method: "POST",
      headers: { Cookie: cookie, Origin: "https://maneman.test", "Content-Type": "image/jpeg" },
      body: JPEG,
    });
    const chat = await env.DB.prepare("SELECT id FROM conversations WHERE person_id = ?1")
      .bind(ROHIT)
      .first<string>("id");
    expect((await claims())[0]?.facts).toMatchObject({ photos: 1, conversation_id: chat });
  });

  it("blanks the words Care closed a claim with when the client is erased", async () => {
    await fittedDaysAgo(3);
    await report({ about: "fit_guarantee", text: "It does not sit right." });
    const [claim] = await claims();
    expect((await close(claim?.id ?? "")).status).toBe(204);
    const { personalDataStatements } = await import("../../../src/domain/privacy/erasure-statements.ts");
    await env.DB.batch(await personalDataStatements(env.DB, ROHIT, NOW.toISOString()));
    expect(
      await env.DB.prepare("SELECT reason FROM task_closures WHERE task_group = 'fit_guarantee_claim'").first("reason"),
    ).toBeNull();
  });

  it("opens another row for a claim after Care closed the first", async () => {
    await fittedDaysAgo(3);
    await report({ about: "fit_guarantee", text: "It does not sit right." });
    const [first] = await claims();
    expect((await close(first?.id ?? "")).status).toBe(204);
    expect(await claims(70)).toEqual([]);

    await report({ about: "fit_guarantee", text: "It lifts again." }, 120);
    expect(await claims(130)).toEqual([
      expect.objectContaining({
        detail: "It lifts again.",
        facts: expect.objectContaining({ reference: "MM-ISS-0002" }) as unknown,
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
