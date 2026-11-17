// A client's ask for a hair system made to order (docs/decisions/0253-replacement-when-due-and-change-of-hair-system.md,
// decision 6; migration 0215): kept once while open as the app tells them their size is made to order, a task on
// Operations' board until ops close it with what was ordered and booked. NOW is Monday 21 September 2026, 12 noon in
// India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { outstandingTasks } from "../../../src/domain/ops/tasks.ts";
import type { App } from "../../../src/http/context.ts";
import { TASK_SLA_HOURS } from "../../../src/policy/tasks.ts";
import { aPackage } from "../fixtures/index.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import { opsAs, person, post } from "../ops/staff-fixtures.ts";
import { IMRAN, SANA, client, technician, visit, wornPiece } from "./client-booking-fixtures.ts";

let app: App;

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  app = appFor("local", fakeDependencies(), {}, "client");
  await technician(IMRAN, "Imran Qureshi", "IQ");
  await technician(SANA, "Sana Mirza", "SM");
  // Essential's hair systems are made to the clients' spec below; Natural's are ranged an inch wider.
  await aPackage({ code: "essential", name: "Mane Man Essential", firstFit: 3000000 });
  await aPackage({
    code: "natural",
    name: "Mane Man Natural",
    firstFit: 3500000,
    spec: { baseWidthIn: 9, baseLengthIn: 10, colour: "1B", greyPercent: 0, densityPercent: 100 },
  });
});

type Who = { readonly id: string; readonly cookie: string };

/**
 * A fitted client of Essential, made to its hair systems' spec, their hair system due on `dueOn`.
 */
async function fittedOfEssential(dueOn = "2026-09-28"): Promise<Who> {
  const rohit = await client();
  await wornPiece(rohit.id, dueOn);
  await env.DB.prepare(
    `INSERT INTO hair_profiles (id, person_id, staff, created_at, product, base_width_in, base_length_in, colour,
       grey_percent, density_percent)
     VALUES (?1, ?1, 'ops@localhost', ?2, 'essential', 8, 10, '1B', 0, 100)`,
  )
    .bind(rohit.id, NOW.toISOString())
    .run();
  return rohit;
}

const ask = (who: Who, body: object) =>
  request(app, "/api/me/made-to-order", {
    method: "POST",
    headers: { Cookie: who.cookie, "Content-Type": "application/json", Origin: "https://maneman.test" },
    body: JSON.stringify(body),
  });

const asked = async () =>
  (await outstandingTasks(env.DB, NOW, TASK_SLA_HOURS)).tasks.filter((task) => task.group === "made_to_order_ask");

describe("a client's ask for a hair system made to order", () => {
  it("is kept once while open, and waits on Operations' board with the hair system and the visit", async () => {
    const rohit = await fittedOfEssential();

    const first = await ask(rohit, { type: "replacement", tier: "natural" });
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({ requested_at: NOW.toISOString() });
    // The step opened again keeps no second ask.
    expect(await (await ask(rohit, { type: "replacement", tier: "natural" })).json()).toEqual({
      requested_at: NOW.toISOString(),
    });
    expect(await env.DB.prepare("SELECT COUNT(*) AS asks FROM made_to_order_asks").first("asks")).toBe(1);

    expect(await asked()).toEqual([
      expect.objectContaining({
        group: "made_to_order_ask",
        person: expect.objectContaining({ id: rohit.id }) as unknown,
        facts: { group: "made_to_order_ask", kind: "replacement", name: "Mane Man Natural" },
      }),
    ]);
  });

  it("is refused wherever booking would not answer made to order: in stock, no such package, or not theirs to book", async () => {
    const rohit = await fittedOfEssential();
    const refusals = [
      { type: "replacement", tier: "essential" },
      { type: "replacement", tier: "premium" },
      // A fitted client books no first fit.
      { type: "first_fit", tier: "natural" },
    ];
    for (const body of refusals) {
      const refused = await ask(rohit, body);
      expect(refused.status).toBe(422);
      expect(await refused.json()).toMatchObject({ error: { code: "not_made_to_order" } });
    }
    expect((await ask(rohit, { type: "service", tier: "natural" })).status).toBe(400);
    // A replacement not yet due: from 1 December, past the days a visit may be booked on.
    const later = await fittedOfEssential("2026-12-10");
    expect((await ask(later, { type: "replacement", tier: "natural" })).status).toBe(422);
    expect(await asked()).toEqual([]);
  });

  it("is refused where the client's address is one we do not come to, which the days tell first", async () => {
    const rohit = await fittedOfEssential();
    await env.DB.prepare("UPDATE serviceable_pincodes SET served = 0").run();
    const refused = await ask(rohit, { type: "replacement", tier: "natural" });
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ error: { code: "not_made_to_order" } });
    expect(await asked()).toEqual([]);
  });

  it("is settled once a visit of its kind is booked for the client, by ops or by them", async () => {
    const rohit = await fittedOfEssential();
    await ask(rohit, { type: "replacement", tier: "natural" });
    expect(await asked()).toHaveLength(1);
    await visit(rohit.id, "replacement", "scheduled", "2026-10-02T04:30:00.000Z", IMRAN);
    expect(await asked()).toEqual([]);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS open FROM made_to_order_asks WHERE settled_at IS NULL").first("open"),
    ).toBe(0);
  });

  it("keeps the ask when the client is erased, and blanks the words ops closed it with", async () => {
    const rohit = await fittedOfEssential();
    await ask(rohit, { type: "replacement", tier: "natural" });
    const [task] = await asked();
    await post(opsAs(person("ops@maneman.test")), `/api/tasks/made_to_order_ask/${task?.id ?? ""}/close`, {
      reason: "Ordered for Rohit; fitting booked.",
    });
    const { personalDataStatements } = await import("../../../src/domain/privacy/erasure-statements.ts");
    await env.DB.batch(await personalDataStatements(env.DB, rohit.id, NOW.toISOString()));
    expect(
      await env.DB.prepare("SELECT reason FROM task_closures WHERE task_group = 'made_to_order_ask'").first("reason"),
    ).toBeNull();
    expect(await env.DB.prepare("SELECT COUNT(*) AS kept FROM made_to_order_asks").first("kept")).toBe(1);
  });

  it("leaves the board once ops close it with what was ordered, and a later ask opens a new one", async () => {
    const rohit = await fittedOfEssential();
    await ask(rohit, { type: "replacement", tier: "natural" });
    const [task] = await asked();

    const closed = await post(
      opsAs(person("ops@maneman.test")),
      `/api/tasks/made_to_order_ask/${task?.id ?? ""}/close`,
      {
        reason: "Ordered in 9 × 10; paid by link; fitting booked for 2 Oct.",
      },
    );
    expect(closed.status).toBe(204);
    expect(await asked()).toEqual([]);
    expect(
      await env.DB.prepare("SELECT settled_at FROM made_to_order_asks WHERE id = ?1")
        .bind(task?.id)
        .first("settled_at"),
    ).not.toBeNull();

    await ask(rohit, { type: "replacement", tier: "natural" });
    expect((await asked()).map((each) => each.id)).not.toContain(task?.id);
    expect(await asked()).toHaveLength(1);
  });
});
