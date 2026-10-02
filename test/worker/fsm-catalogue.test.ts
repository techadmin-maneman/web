// FSM's catalogue against the services and the price book (docs/decisions/0073-prices-from-the-price-book.md,
// docs/decisions/0085-services-ops-can-edit.md): the hourly check, which reads only and tells ops, and the push, which
// makes a missing item and writes the console's name and the book's price only while the owner has it switched on.
// Staging's FSM is the owner's real org, so nothing here may write to it by itself (INT-03). The push is forced on
// here, in the tests alone: FSM_CATALOGUE_PUSH is off in every environment (test/worker/guard.test.ts).

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createAlertOnce, createResolveAlert } from "../../src/domain/alerts.ts";
import {
  checkCatalogue,
  itemForService,
  PART_WRITES_A_PASS,
  pushCatalogue,
  UNREAD_ALERT,
} from "../../src/domain/fsm-catalogue.ts";
import { createCallBudget } from "../../src/lib/call-budget.ts";
import { createLogger } from "../../src/log.ts";
import type { ZohoFsmSettings } from "../../src/config/settings.ts";
import {
  createFsmProvider,
  createStubFsm,
  EMPTY_FSM,
  type FsmItem,
  type FsmProvider,
} from "../../src/providers/fsm.ts";
import { handleFsmSyncBatch } from "../../src/queues/fsm-sync.ts";
import { FSM_API, ZOHO_TOKEN_URL } from "./fsm-fixtures.ts";
import { appFor, captureLogs, fakeDependencies, fakeFetch, fakeQueue, json, markDatabase, request } from "./helpers.ts";

/** 11:30 in India on 26 September 2026: the cron run on the hour, after the book's rows of the 22nd. */
const ON_THE_HOUR = new Date("2026-09-26T06:00:00Z");
const AN_HOUR_ON = new Date("2026-09-26T07:00:00Z");
const OFF_THE_HOUR = new Date("2026-09-26T06:30:00Z");

/** FSM's catalogue as staging's was on 24 September 2026: the replacement at twice the book's price. */
const CATALOGUE: FsmItem[] = [
  { id: "fsm-item-consultation", name: "Consultation", type: "Service", price: 0 },
  { id: "fsm-item-first-fit", name: "First fit", type: "Service", price: 3_000_000 },
  { id: "fsm-item-service", name: "Service visit", type: "Service", price: 200_000 },
  { id: "fsm-item-replacement", name: "Replacement", type: "Service", price: 3_000_000 },
  { id: "fsm-item-base", name: "Standard base", type: "Part", price: 3_000_000 },
];
/** The same, once FSM's replacement agrees with the book. */
const AGREEING = CATALOGUE.map((item) => (item.name === "Replacement" ? { ...item, price: 1_500_000 } : item));

let alerted: string[];

function check(fsm: FsmProvider, options: { push: boolean; now?: Date; calls?: number }) {
  const now = options.now ?? ON_THE_HOUR;
  const alert = (message: string) => {
    alerted.push(message);
    return Promise.resolve();
  };
  const queue = fakeQueue();
  const done = checkCatalogue(
    env.DB,
    {
      fsm,
      queue,
      alertOnce: createAlertOnce({ db: env.DB, alert, now: () => now, environment: "local", log: createLogger() }),
      resolveAlert: createResolveAlert({ db: env.DB, now: () => now }),
      log: createLogger(),
    },
    { push: options.push, now, budget: createCallBudget(options.calls ?? 40) },
  );
  return { done, queue };
}

const openAlert = (key: string) =>
  env.DB.prepare("SELECT message FROM alerts WHERE key = ?1 AND resolved_at IS NULL")
    .bind(key)
    .first<{ message: string }>();

/** A service ops added in the console, priced from the 22nd. */
async function service(kind: string, tier: string, name: string, paise: number, retiredDate: string | null = null) {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO services (kind, tier, name, minutes, sort, retired_date, updated_by, updated_at)
       VALUES (?1, ?2, ?3, 180, 1, ?4, 'ops@localhost', '2026-09-22T06:30:00.000Z')`,
    ).bind(kind, tier, name, retiredDate),
    env.DB.prepare(
      "INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from) VALUES (?1, ?2, ?3, 0, '2026-09-22')",
    ).bind(kind, tier, paise),
  ]);
}

const itemKept = async (kind: string, tier: string) =>
  (
    await env.DB.prepare("SELECT fsm_item_id FROM services WHERE kind = ?1 AND tier = ?2")
      .bind(kind, tier)
      .first<{ fsm_item_id: string | null }>()
  )?.fsm_item_id;

/** The push's message on the fsm-sync queue, as the check or a price set in the console queues it. */
function syncMessage() {
  const acked: string[] = [];
  const retried: string[] = [];
  const message = {
    id: "message-1",
    attempts: 1,
    body: { catalogue_sync: true, request_id: "request-1" },
    ack: () => acked.push("message-1"),
    retry: () => retried.push("message-1"),
  };
  const batch = { queue: "mm-fsm-sync-local", messages: [message] } as unknown as MessageBatch;
  return { batch, acked, retried };
}

const queueEnv = () => ({ ...env, MESSAGE_QUEUE: fakeQueue(), FSM_QUEUE: fakeQueue() });

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  alerted = [];
});

describe("the hourly catalogue check", () => {
  it("tells ops once which item differs, with its ID and both figures, and writes nothing while the push is off", async () => {
    const fsm = createStubFsm({ ...EMPTY_FSM, items: CATALOGUE });

    const first = check(fsm, { push: false });
    expect(await first.done).toEqual({ differs: ["replacement/standard"], queued: false });
    expect(alerted).toHaveLength(1);
    expect(alerted[0]).toContain('FSM\'s catalogue item fsm-item-replacement ("Replacement") is Rs. 30,000 before GST');
    expect(alerted[0]).toContain("the price book has Rs. 15,000");
    expect(alerted[0]).toContain("FSM_CATALOGUE_PUSH");
    expect(alerted[0]).toContain("/settings/prices");
    expect(first.queue.sent).toEqual([]);
    expect(fsm.made.itemUpdates).toEqual([]);
    expect(fsm.made.itemsMade).toEqual([]);

    await check(fsm, { push: false, now: AN_HOUR_ON }).done;
    expect(alerted).toHaveLength(1);
  });

  it("keeps each item it finds by name on its service, so it is found by its ID from then on", async () => {
    await check(createStubFsm({ ...EMPTY_FSM, items: CATALOGUE }), { push: false }).done;

    expect(await itemKept("first_fit", "standard")).toBe("fsm-item-first-fit");
    expect(await itemKept("replacement", "standard")).toBe("fsm-item-replacement");
  });

  it("closes the alert once FSM and the book agree again, under the key the kind was told under", async () => {
    await check(createStubFsm({ ...EMPTY_FSM, items: CATALOGUE }), { push: false }).done;
    expect(await openAlert("fsm_catalogue:replacement")).not.toBeNull();

    const later = check(createStubFsm({ ...EMPTY_FSM, items: AGREEING }), { push: false, now: AN_HOUR_ON });

    expect(await later.done).toEqual({ differs: [], queued: false });
    expect(await openAlert("fsm_catalogue:replacement")).toBeNull();
  });

  it("follows a price ops set from today", async () => {
    await env.DB.prepare(
      "INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from) VALUES ('service', 'standard', 250000, 0, '2026-09-26')",
    ).run();

    const { done } = check(createStubFsm({ ...EMPTY_FSM, items: CATALOGUE }), { push: false });

    expect(await done).toEqual({ differs: ["service/standard", "replacement/standard"], queued: false });
  });

  it("compares every service ops offer, not only the standard ones, each by its own item", async () => {
    await service("first_fit", "premium", "Premium first fit", 4_000_000);
    const items = [
      ...AGREEING,
      { id: "fsm-item-premium", name: "Premium first fit", type: "Service" as const, price: 3_500_000 },
    ];

    const { done } = check(createStubFsm({ ...EMPTY_FSM, items }), { push: false });

    expect(await done).toEqual({ differs: ["first_fit/premium"], queued: false });
    expect(await itemKept("first_fit", "premium")).toBe("fsm-item-premium");
    const told = await openAlert("fsm_catalogue:first_fit/premium");
    expect(told?.message).toContain('fsm-item-premium ("Premium first fit") is Rs. 35,000 before GST');
    expect(told?.message).toContain("the price book has Rs. 40,000");
  });

  it("tells ops of a service's name that FSM's item does not carry, found by the ID kept on it", async () => {
    await check(createStubFsm({ ...EMPTY_FSM, items: AGREEING }), { push: false }).done;
    await env.DB.prepare("UPDATE services SET name = 'Monthly service' WHERE kind = 'service'").run();

    const { done } = check(createStubFsm({ ...EMPTY_FSM, items: AGREEING }), { push: false, now: AN_HOUR_ON });

    expect(await done).toEqual({ differs: ["service/standard"], queued: false });
    const told = await openAlert("fsm_catalogue:service");
    expect(told?.message).toContain(
      'fsm-item-service is named "Service visit", and the console names it "Monthly service"',
    );
  });

  it("leaves a retired service alone, and closes what it was told of", async () => {
    await service("first_fit", "premium", "Premium first fit", 4_000_000);
    await check(createStubFsm({ ...EMPTY_FSM, items: AGREEING }), { push: false }).done;
    expect(await openAlert("fsm_catalogue:first_fit/premium")).not.toBeNull();

    await env.DB.prepare("UPDATE services SET retired_date = '2026-09-26' WHERE tier = 'premium'").run();
    const later = check(createStubFsm({ ...EMPTY_FSM, items: AGREEING }), { push: false, now: AN_HOUR_ON });

    expect(await later.done).toEqual({ differs: [], queued: false });
    expect(await openAlert("fsm_catalogue:first_fit/premium")).toBeNull();
  });

  it("tells ops at once of a visit FSM has no item for while the push is off", async () => {
    const without = CATALOGUE.filter((item) => item.name !== "First fit");

    await check(createStubFsm({ ...EMPTY_FSM, items: without }), { push: false }).done;

    const told = alerted.find((message) => message.includes('no service item named "First fit"'));
    expect(told).toBeDefined();
  });

  it("with the push on, queues the push to make a missing item, and tells ops only if it is still missing an hour on", async () => {
    const without = CATALOGUE.filter((item) => item.name !== "First fit");
    const fsm = createStubFsm({ ...EMPTY_FSM, items: without });

    const first = check(fsm, { push: true });
    expect(await first.done).toMatchObject({ queued: true });
    expect(alerted.filter((message) => message.includes('"First fit"'))).toEqual([]);

    await check(fsm, { push: true, now: AN_HOUR_ON }).done;
    expect(alerted.find((message) => message.includes('still has no service item named "First fit"'))).toBeDefined();
  });

  // The list is read a page at a time from what the run has left (plan piece C28), so it waits only for a run with
  // no call left at all, where it once waited for one with five.
  it("reads FSM only on the hour, and only while the cron run has a call left", async () => {
    const fsm = createStubFsm({ ...EMPTY_FSM, items: CATALOGUE });
    fsm.failNext("items");

    expect(await check(fsm, { push: false, now: OFF_THE_HOUR }).done).toBeNull();
    expect(await check(fsm, { push: false, calls: 0 }).done).toBeNull();
    expect(alerted).toEqual([]);
  });

  it("with the push on, queues the sync, and tells ops only if FSM still differs an hour on", async () => {
    const fsm = createStubFsm({ ...EMPTY_FSM, items: CATALOGUE });

    const first = check(fsm, { push: true });
    expect(await first.done).toEqual({ differs: ["replacement/standard"], queued: true });
    expect(first.queue.sent).toEqual([{ catalogue_sync: true, request_id: "fsm_catalogue" }]);
    expect(alerted).toEqual([]);

    await check(fsm, { push: true, now: AN_HOUR_ON }).done;
    expect(alerted).toHaveLength(1);
    expect(alerted[0]).toContain("still differs an hour after the push was queued");
  });
});

describe("the push", () => {
  it("writes the book's price over each item that differs, and nothing else, however often it runs", async () => {
    const fsm = createStubFsm({ ...EMPTY_FSM, items: CATALOGUE });

    expect(await pushCatalogue(env.DB, fsm, "2026-09-26")).toEqual({ written: 1, unreached: [] });
    expect(await pushCatalogue(env.DB, fsm, "2026-09-26")).toEqual({ written: 0, unreached: [] });

    expect(fsm.made.itemUpdates).toEqual([{ itemId: "fsm-item-replacement", name: "Replacement", price: 1_500_000 }]);
    expect(fsm.made.itemsMade).toEqual([]);
  });

  it("makes the item a service has none of, keeps its ID, and makes it once", async () => {
    await service("first_fit", "premium", "Premium first fit", 4_000_000);
    const fsm = createStubFsm({ ...EMPTY_FSM, items: AGREEING });

    expect(await pushCatalogue(env.DB, fsm, "2026-09-26")).toEqual({ written: 1, unreached: [] });
    expect(await pushCatalogue(env.DB, fsm, "2026-09-26")).toEqual({ written: 0, unreached: [] });

    expect(fsm.made.itemsMade).toEqual([{ name: "Premium first fit", price: 4_000_000 }]);
    expect(await itemKept("first_fit", "premium")).toMatch(/^stub-item-/);
  });

  it("writes a service's new name over its item, found by the ID kept on it", async () => {
    const fsm = createStubFsm({ ...EMPTY_FSM, items: AGREEING });
    await pushCatalogue(env.DB, fsm, "2026-09-26");
    await env.DB.prepare("UPDATE services SET name = 'Monthly service' WHERE kind = 'service'").run();

    expect(await pushCatalogue(env.DB, fsm, "2026-09-26")).toEqual({ written: 1, unreached: [] });

    expect(fsm.made.itemUpdates).toEqual([{ itemId: "fsm-item-service", name: "Monthly service", price: 200_000 }]);
  });

  it("runs from the fsm-sync queue while the push is on", async () => {
    const fsm = createStubFsm({ ...EMPTY_FSM, items: CATALOGUE });
    const { batch, acked } = syncMessage();

    await handleFsmSyncBatch(batch, queueEnv(), fakeDependencies({ fsm, now: () => ON_THE_HOUR }), createLogger(), {
      labelAsTest: true,
      cataloguePush: true,
    });

    expect(fsm.made.itemUpdates).toEqual([{ itemId: "fsm-item-replacement", name: "Replacement", price: 1_500_000 }]);
    expect(acked).toEqual(["message-1"]);
  });

  it("writes nothing if the push was switched off after the message was queued", async () => {
    const fsm = createStubFsm({ ...EMPTY_FSM, items: CATALOGUE });
    const { batch, acked } = syncMessage();

    await handleFsmSyncBatch(batch, queueEnv(), fakeDependencies({ fsm, now: () => ON_THE_HOUR }), createLogger(), {
      labelAsTest: true,
      cataloguePush: false,
    });

    expect(fsm.made.itemUpdates).toEqual([]);
    expect(fsm.made.itemsMade).toEqual([]);
    expect(acked).toEqual(["message-1"]);
  });

  it("tries once: a refusal is logged, and the next hour's check is its retry", async () => {
    const fsm = createStubFsm({ ...EMPTY_FSM, items: CATALOGUE });
    fsm.refuseNext("updateItem");
    const logs = captureLogs();
    const { batch, acked, retried } = syncMessage();

    await handleFsmSyncBatch(batch, queueEnv(), fakeDependencies({ fsm, now: () => ON_THE_HOUR }), createLogger(), {
      labelAsTest: true,
      cataloguePush: true,
    });

    expect(acked).toEqual(["message-1"]);
    expect(retried).toEqual([]);
    expect(logs.lines().some((line) => line.event === "fsm_catalogue_push_failed")).toBe(true);
  });
});

describe("the item a booking goes on", () => {
  const deps = () => {
    const told: string[] = [];
    const alertOnce = createAlertOnce({
      db: env.DB,
      alert: (message) => {
        told.push(message);
        return Promise.resolve();
      },
      now: () => ON_THE_HOUR,
      environment: "local",
      log: createLogger(),
    });
    return { told, deps: { alertOnce, log: createLogger() } };
  };

  it("is the service's own, by its name the first time and by its ID after, whatever FSM renames it", async () => {
    await service("first_fit", "premium", "Premium first fit", 4_000_000);
    const items = [
      ...AGREEING,
      { id: "fsm-item-premium", name: "Premium first fit", type: "Service" as const, price: 4_000_000 },
    ];
    const { deps: itemDeps } = deps();

    const first = await itemForService(
      env.DB,
      createStubFsm({ ...EMPTY_FSM, items }),
      { kind: "first_fit", tier: "premium" },
      itemDeps,
    );
    expect(first.id).toBe("fsm-item-premium");

    const renamed = items.map((item) => (item.id === "fsm-item-premium" ? { ...item, name: "Thin skin fit" } : item));
    const again = await itemForService(
      env.DB,
      createStubFsm({ ...EMPTY_FSM, items: renamed }),
      { kind: "first_fit", tier: "premium" },
      itemDeps,
    );
    expect(again.id).toBe("fsm-item-premium");
  });

  it("falls back to its kind's standard item where FSM has none, and tells ops once, however often it is booked", async () => {
    await service("first_fit", "premium", "Premium first fit", 4_000_000);
    const logs = captureLogs();
    const { told, deps: itemDeps } = deps();
    const fsm = createStubFsm({ ...EMPTY_FSM, items: AGREEING });

    const item = await itemForService(env.DB, fsm, { kind: "first_fit", tier: "premium" }, itemDeps);
    await itemForService(env.DB, fsm, { kind: "first_fit", tier: "premium" }, itemDeps);

    expect(item.id).toBe("fsm-item-first-fit");
    expect(told).toHaveLength(1);
    expect(told[0]).toContain('no item for the service "Premium first fit"');
    expect(await openAlert("fsm_item_fallback:first_fit/premium")).not.toBeNull();
    expect(logs.lines().filter((line) => line.event === "fsm_item_fallback")).toHaveLength(2);
  });

  it("closes that alert once the hourly check finds the service's own item", async () => {
    await service("first_fit", "premium", "Premium first fit", 4_000_000);
    await itemForService(
      env.DB,
      createStubFsm({ ...EMPTY_FSM, items: AGREEING }),
      { kind: "first_fit", tier: "premium" },
      deps().deps,
    );
    const items = [
      ...AGREEING,
      { id: "fsm-item-premium", name: "Premium first fit", type: "Service" as const, price: 4_000_000 },
    ];

    await check(createStubFsm({ ...EMPTY_FSM, items }), { push: false }).done;

    expect(await openAlert("fsm_item_fallback:first_fit/premium")).toBeNull();
  });

  it("still refuses a kind FSM has no item for at all, as a booking always has", async () => {
    const without = AGREEING.filter((item) => item.name !== "First fit");
    await expect(
      itemForService(
        env.DB,
        createStubFsm({ ...EMPTY_FSM, items: without }),
        { kind: "first_fit", tier: "standard" },
        deps().deps,
      ),
    ).rejects.toThrow("FSM has no First fit item");
  });
});

// Ops' consumables, kept in FSM's catalogue as parts at Rs. 0 (docs/decisions/0087-consumables-and-stock.md). The
// push is forced on here only, as a test's own option: FSM_CATALOGUE_PUSH is off in every environment, and staging's
// FSM is the owner's real org.
describe("the consumables, as parts", () => {
  async function consumable(code: string, name: string, fsm: { id: string; name: string } | null = null) {
    await env.DB.prepare(
      `INSERT INTO consumables (code, name, unit, unit_cost, fsm_item_id, fsm_name, fsm_checked_at, created_at,
         updated_at)
       VALUES (?1, ?2, 'strip', 1200, ?3, ?4, ?5, ?6, ?6)`,
    )
      .bind(code, name, fsm?.id ?? null, fsm?.name ?? null, fsm === null ? null : "2026-09-25T06:00:00.000Z", "x")
      .run();
  }

  const heldFor = (code: string) =>
    env.DB.prepare("SELECT fsm_item_id, fsm_name, fsm_checked_at FROM consumables WHERE code = ?1")
      .bind(code)
      .first<{ fsm_item_id: string | null; fsm_name: string | null; fsm_checked_at: string | null }>();

  const agreeing = CATALOGUE.map((item) => (item.name === "Replacement" ? { ...item, price: 1_500_000 } : item));

  // The review of 27 September 2026: a part past the catalogue's first page must still be found, or with the push on
  // it would be added again every hour. Zoho's catalogue is read a page of 200 at a time, while FSM says there are
  // more (docs/decisions/0085-services-ops-can-edit.md; plan piece C28), and the parts are checked against all of it.
  it("finds a part on the catalogue's second page, and adds no second one with the push on", async () => {
    await consumable("tape_strips", "Tape strips");
    const record = (item: FsmItem) => ({
      id: item.id,
      Name: item.name,
      Type: item.type,
      Unit_Price: item.price === null ? null : item.price / 100,
    });
    const others: FsmItem[] = Array.from({ length: 200 - agreeing.length }, (_, n) => ({
      id: `other-${String(n)}`,
      name: `Other ${String(n)}`,
      type: "Service",
      price: 10_000,
    }));
    const http = fakeFetch({
      [ZOHO_TOKEN_URL]: () => json({ access_token: "fsm-access-1", expires_in: 3600, token_type: "Bearer" }),
      [`${FSM_API}/Service_And_Parts?page=1&`]: () =>
        json({ data: [...agreeing, ...others].map(record), info: { more_records: true } }),
      [`${FSM_API}/Service_And_Parts?page=2&`]: () =>
        json({
          data: [record({ id: "fsm-part-tape", name: "Tape strips", type: "Part", price: 0 })],
          info: { more_records: false },
        }),
    });
    const settings: ZohoFsmSettings = {
      clientId: "1000.FSMCLIENT",
      clientSecret: "fsm-client-secret",
      refreshToken: "1000.fsm-refresh",
      accountsHost: "accounts.zoho.in",
      apiHost: "www.zohoapis.in",
      webhookToken: null,
    };
    const zoho = createFsmProvider("zoho", settings, {
      db: env.DB,
      fetch: http.fetch,
      now: () => ON_THE_HOUR,
      log: createLogger(),
    });

    await check(zoho, { push: true }).done;

    expect(http.calls.filter((call) => call.method !== "GET" && call.url.startsWith(FSM_API))).toEqual([]);
    expect(await heldFor("tape_strips")).toMatchObject({ fsm_item_id: "fsm-part-tape", fsm_name: "Tape strips" });
    expect(alerted).toEqual([]);
  });

  it("links one FSM already holds by its name, and tells ops of one it does not, writing nothing to FSM", async () => {
    const fsm = createStubFsm({
      ...EMPTY_FSM,
      items: [...agreeing, { id: "fsm-part-tape", name: "Tape strips", type: "Part", price: 0 }],
    });
    await consumable("tape_strips", "Tape strips");
    await consumable("solvent", "Solvent");

    await check(fsm, { push: false }).done;

    expect(await heldFor("tape_strips")).toEqual({
      fsm_item_id: "fsm-part-tape",
      fsm_name: "Tape strips",
      fsm_checked_at: ON_THE_HOUR.toISOString(),
    });
    expect(await heldFor("solvent")).toEqual({
      fsm_item_id: null,
      fsm_name: null,
      fsm_checked_at: ON_THE_HOUR.toISOString(),
    });
    expect(alerted).toEqual([expect.stringContaining('"Solvent" is not there')]);
    expect(alerted[0]).toContain("FSM_CATALOGUE_PUSH");
    expect(alerted[0]).toContain("/settings/consumables");
    expect(fsm.made.parts).toEqual([]);
    expect(fsm.made.renamedItems).toEqual([]);
  });

  it("tells ops of a part still under a name ops have since changed, and renames nothing while the push is off", async () => {
    const fsm = createStubFsm({
      ...EMPTY_FSM,
      items: [...agreeing, { id: "fsm-part-tape", name: "Tape strips", type: "Part", price: 0 }],
    });
    await consumable("tape_strips", "Contour tape", { id: "fsm-part-tape", name: "Tape strips" });

    await check(fsm, { push: false }).done;

    expect(alerted).toEqual([expect.stringContaining('part fsm-part-tape is "Tape strips", ours "Contour tape"')]);
    expect(fsm.made.renamedItems).toEqual([]);
  });

  it("with the push on, adds a missing part at Rs. 0 and renames one ops renamed, telling nobody", async () => {
    const fsm = createStubFsm({
      ...EMPTY_FSM,
      items: [...agreeing, { id: "fsm-part-tape", name: "Tape strips", type: "Part", price: 0 }],
    });
    await consumable("tape_strips", "Contour tape", { id: "fsm-part-tape", name: "Tape strips" });
    await consumable("solvent", "Solvent");

    await check(fsm, { push: true }).done;

    expect(fsm.made.renamedItems).toEqual([{ itemId: "fsm-part-tape", name: "Contour tape" }]);
    expect(fsm.made.parts).toEqual(["Solvent"]);
    const solvent = await heldFor("solvent");
    expect(solvent?.fsm_item_id).toMatch(/^stub-part-/);
    expect(solvent?.fsm_name).toBe("Solvent");
    expect((await fsm.items()).find((item) => item.id === solvent?.fsm_item_id)).toMatchObject({
      type: "Part",
      price: 0,
    });
    expect(alerted).toEqual([]);

    // The next hour finds both as ours, and writes nothing more, to FSM or to D1.
    await check(fsm, { push: true, now: AN_HOUR_ON }).done;
    expect(fsm.made.parts).toHaveLength(1);
    expect(fsm.made.renamedItems).toHaveLength(1);
    expect((await heldFor("solvent"))?.fsm_checked_at).toBe(ON_THE_HOUR.toISOString());
  });

  it("with the push on, writes a few a pass from the run's budget, and the rest the next hour", async () => {
    const fsm = createStubFsm({ ...EMPTY_FSM, items: agreeing });
    for (let n = 1; n <= PART_WRITES_A_PASS + 2; n += 1) await consumable(`c${String(n)}`, `Consumable ${String(n)}`);

    await check(fsm, { push: true }).done;
    expect(fsm.made.parts).toHaveLength(PART_WRITES_A_PASS);

    // A run with a call for the list's one page and one more spends the one on the list and the other on a part.
    await check(fsm, { push: true, now: AN_HOUR_ON, calls: 2 }).done;
    expect(fsm.made.parts).toHaveLength(PART_WRITES_A_PASS + 1);
  });

  it("with the push on, tells ops only of a part it still could not add an hour on", async () => {
    const fsm = createStubFsm({ ...EMPTY_FSM, items: agreeing });
    await consumable("solvent", "Solvent");
    const logs = captureLogs();

    fsm.refuseNext("createPart");
    await check(fsm, { push: true }).done;
    expect(alerted).toEqual([]);
    expect(logs.lines().some((line) => line.event === "fsm_part_push_failed")).toBe(true);

    fsm.refuseNext("createPart");
    await check(fsm, { push: true, now: AN_HOUR_ON }).done;
    expect(alerted).toEqual([expect.stringContaining("still so an hour after the push tried")]);
  });

  it("links a part whose answer was lost by its name the next hour, rather than adding a second", async () => {
    const fsm = createStubFsm({ ...EMPTY_FSM, items: agreeing });
    await consumable("solvent", "Solvent");

    fsm.loseAnswer("createPart");
    await check(fsm, { push: true }).done;
    expect((await heldFor("solvent"))?.fsm_item_id).toBeNull();

    await check(fsm, { push: true, now: AN_HOUR_ON }).done;
    expect(fsm.made.parts).toEqual(["Solvent"]);
    expect((await heldFor("solvent"))?.fsm_item_id).toMatch(/^stub-part-/);
  });

  // A consumable renamed, and its old name given to a new one: the new one never takes the renamed one's part, which
  // the two would otherwise rename back and forth every hour.
  it("never gives a new consumable the part of one ops renamed, by the name it had", async () => {
    const fsm = createStubFsm({
      ...EMPTY_FSM,
      items: [...agreeing, { id: "fsm-part-tape", name: "Tape strips", type: "Part", price: 0 }],
    });
    await consumable("tape_strips", "Contour tape", { id: "fsm-part-tape", name: "Tape strips" });
    await consumable("tape_strips_2", "Tape strips");

    await check(fsm, { push: true }).done;
    expect(fsm.made.renamedItems).toEqual([{ itemId: "fsm-part-tape", name: "Contour tape" }]);
    expect(fsm.made.parts).toEqual(["Tape strips"]);
    const added = (await heldFor("tape_strips_2"))?.fsm_item_id;
    expect(added).toMatch(/^stub-part-/);

    // The next hour each has its own part, and nothing is written.
    await check(fsm, { push: true, now: AN_HOUR_ON }).done;
    expect(fsm.made.renamedItems).toHaveLength(1);
    expect(fsm.made.parts).toHaveLength(1);
    expect((await heldFor("tape_strips"))?.fsm_item_id).toBe("fsm-part-tape");
    expect((await heldFor("tape_strips_2"))?.fsm_item_id).toBe(added);
    expect(alerted).toEqual([]);
  });

  it("with the push off, tells ops the new one is missing rather than linking it to the renamed one's part", async () => {
    const fsm = createStubFsm({
      ...EMPTY_FSM,
      items: [...agreeing, { id: "fsm-part-tape", name: "Tape strips", type: "Part", price: 0 }],
    });
    await consumable("tape_strips", "Contour tape", { id: "fsm-part-tape", name: "Tape strips" });
    await consumable("tape_strips_2", "Tape strips");

    await check(fsm, { push: false }).done;
    expect((await heldFor("tape_strips_2"))?.fsm_item_id).toBeNull();
    expect(alerted).toEqual([expect.stringContaining('"Tape strips" is not there')]);
    expect(alerted[0]).toContain('part fsm-part-tape is "Tape strips", ours "Contour tape"');
  });

  it("leaves a retired consumable's part as it is, and closes the alert once each is FSM's", async () => {
    const fsm = createStubFsm({ ...EMPTY_FSM, items: agreeing });
    await consumable("solvent", "Solvent");
    await check(fsm, { push: false }).done;
    expect(await openAlert("fsm_catalogue:consumables")).not.toBeNull();

    await env.DB.prepare("UPDATE consumables SET retired_date = '2026-09-26' WHERE code = 'solvent'").run();
    await check(fsm, { push: true, now: AN_HOUR_ON }).done;
    expect(fsm.made.parts).toEqual([]);
    expect(await openAlert("fsm_catalogue:consumables")).toBeNull();
  });

  it("is never part of the price push, which writes only prices", async () => {
    const fsm = createStubFsm({ ...EMPTY_FSM, items: CATALOGUE });
    await consumable("solvent", "Solvent");

    await pushCatalogue(env.DB, fsm, "2026-09-26");
    expect(fsm.made.parts).toEqual([]);
  });
});

describe("a price set in the console", () => {
  const POST = { "Content-Type": "application/json", Origin: "https://maneman.test" };
  const TODAY = new Date("2026-09-26T06:30:00Z");

  async function setPrice(body: Record<string, unknown>, push: boolean) {
    const queue = fakeQueue();
    const ops = appFor("local", fakeDependencies({ now: () => TODAY }), { fsmCataloguePush: push }, "ops");
    const price = { item: "service", tier: "standard", amount_ex_gst: 250_000, gst_percent: 0, ...body };
    const answer = await request(
      ops,
      "/api/prices",
      { method: "POST", headers: POST, body: JSON.stringify(price) },
      {
        FSM_QUEUE: queue,
      },
    );
    expect(answer.status).toBe(200);
    return queue.sent;
  }

  it("queues FSM's catalogue when the push is on and the price is in force today", async () => {
    expect(await setPrice({ valid_from: "2026-09-26" }, true)).toEqual([
      { catalogue_sync: true, request_id: expect.any(String) as unknown },
    ]);
  });

  // Every service has its own item now, so a price for any of them is one FSM should carry.
  it("queues it for a service ops added, as for a standard one", async () => {
    await service("first_fit", "premium", "Premium first fit", 4_000_000);
    expect(await setPrice({ valid_from: "2026-09-26", item: "first_fit", tier: "premium" }, true)).toHaveLength(1);
  });

  it("queues nothing while the push is off: the hourly check tells ops instead", async () => {
    expect(await setPrice({ valid_from: "2026-09-26" }, false)).toEqual([]);
  });

  it.each([
    ["a price from a later day, which the hourly check pushes on its day", { valid_from: "2026-10-01" }],
    ["a late fee, which is not a catalogue item", { valid_from: "2026-09-26", item: "late_fee_first_fit" }],
  ])("queues nothing for %s", async (_, body) => {
    expect(await setPrice(body, true)).toEqual([]);
  });
});

// Past five pages of 200 the check saw nothing, and with the push on added each part beyond them again every hour.
// It now reads on while FSM says there are more, a call a page from what the cron run has left, and where that ends
// before FSM's last page, what it did not read is neither missing nor added (plan piece C28).
describe("a catalogue past a thousand items", () => {
  /** A thousand and a hundred items of FSM's own, and then ours: the six pages' last. */
  const FILLER: FsmItem[] = Array.from({ length: 1_100 }, (_, n) => ({
    id: `other-${String(n)}`,
    name: `Other ${String(n)}`,
    type: "Part",
    price: 10_000,
  }));
  const TAPE: FsmItem = { id: "fsm-part-tape", name: "Tape strips", type: "Part", price: 0 };
  const LARGE = [...FILLER, ...AGREEING, TAPE];

  async function consumable(code: string, name: string, linkedTo: string | null = null) {
    await env.DB.prepare(
      `INSERT INTO consumables (code, name, unit, unit_cost, fsm_item_id, created_at, updated_at)
       VALUES (?1, ?2, 'strip', 1200, ?3, ?4, ?4)`,
    )
      .bind(code, name, linkedTo, "2026-09-25T06:00:00.000Z")
      .run();
  }

  const linkOf = async (code: string) =>
    (
      await env.DB.prepare("SELECT fsm_item_id FROM consumables WHERE code = ?1")
        .bind(code)
        .first<{ fsm_item_id: string | null }>()
    )?.fsm_item_id;

  it("reads on while FSM says there are more, and finds each service's item and each part on the sixth page", async () => {
    await consumable("tape_strips", "Tape strips");
    const fsm = createStubFsm({ ...EMPTY_FSM, items: LARGE });

    const first = check(fsm, { push: true });

    expect(await first.done).toEqual({ differs: [], queued: false });
    expect(first.queue.sent).toEqual([]);
    expect(fsm.made.parts).toEqual([]);
    expect(await linkOf("tape_strips")).toBe("fsm-part-tape");
    expect(await itemKept("replacement", "standard")).toBe("fsm-item-replacement");
    expect(alerted).toEqual([]);
  });

  it("checks only what it read when the run's calls end first: nothing unseen is told missing, added or unlinked", async () => {
    await consumable("tape_strips", "Tape strips", "fsm-part-tape");
    await consumable("solvent", "Solvent");
    const fsm = createStubFsm({ ...EMPTY_FSM, items: LARGE });
    const logs = captureLogs();

    const partial = check(fsm, { push: true, calls: 3 });

    expect(await partial.done).toEqual({ differs: [], queued: false });
    expect(partial.queue.sent).toEqual([]);
    expect(fsm.made.parts).toEqual([]);
    expect(await linkOf("tape_strips")).toBe("fsm-part-tape");
    expect(await linkOf("solvent")).toBeNull();
    expect(logs.lines()).toContainEqual(expect.objectContaining({ event: "fsm_catalogue_unread", pages: 3 }));
    expect(alerted).toEqual([]);

    // Ops hear once the next hour cannot read it whole either.
    await check(fsm, { push: true, now: AN_HOUR_ON, calls: 3 }).done;
    expect(alerted).toEqual([expect.stringContaining("FSM's catalogue holds more than the 3 pages of 200 items")]);
    expect(await openAlert(UNREAD_ALERT)).not.toBeNull();

    // A run with the calls for it reads it whole, adds what is missing, and closes the alert.
    await check(fsm, { push: true, now: AN_HOUR_ON, calls: 40 }).done;
    expect(fsm.made.parts).toEqual(["Solvent"]);
    expect(await linkOf("tape_strips")).toBe("fsm-part-tape");
    expect(await openAlert(UNREAD_ALERT)).toBeNull();
  });

  it("makes no service item where the push could not read the whole catalogue, and writes over what it found", async () => {
    await service("first_fit", "premium", "Premium first fit", 4_000_000);
    const fsm = createStubFsm({ ...EMPTY_FSM, items: [...FILLER, ...CATALOGUE] });

    const pushed = await pushCatalogue(env.DB, fsm, "2026-09-26");

    expect(pushed).toEqual({
      written: 0,
      unreached: [
        "consultation/standard",
        "first_fit/standard",
        "first_fit/premium",
        "service/standard",
        "replacement/standard",
      ],
    });
    expect(fsm.made.itemsMade).toEqual([]);
    expect(fsm.made.itemUpdates).toEqual([]);

    const found = createStubFsm({ ...EMPTY_FSM, items: [...CATALOGUE, ...FILLER] });
    await pushCatalogue(env.DB, found, "2026-09-26");
    expect(found.made.itemsMade).toEqual([]);
    expect(found.made.itemUpdates).toEqual([{ itemId: "fsm-item-replacement", name: "Replacement", price: 1_500_000 }]);
  });

  // The review of 28 September 2026: an item kept on a service or a part linked to a consumable, on a page a short
  // run did not reach, was matched instead by its name to another on a page it did, and the push queued over it.
  it("keeps a service or a part on the item it holds when a short run reads another of its name, not its own", async () => {
    await consumable("tape_strips", "Tape strips");
    await check(createStubFsm({ ...EMPTY_FSM, items: LARGE }), { push: false }).done;
    expect(await linkOf("tape_strips")).toBe("fsm-part-tape");
    expect(await itemKept("replacement", "standard")).toBe("fsm-item-replacement");
    const duplicates: FsmItem[] = [
      { id: "dup-tape", name: "Tape strips", type: "Part", price: 0 },
      { id: "dup-replacement", name: "Replacement", type: "Service", price: 3_000_000 },
    ];
    const fsm = createStubFsm({ ...EMPTY_FSM, items: [...duplicates, ...LARGE] });

    const partial = check(fsm, { push: true, now: AN_HOUR_ON, calls: 3 });

    expect(await partial.done).toEqual({ differs: [], queued: false });
    expect(partial.queue.sent).toEqual([]);
    expect(await linkOf("tape_strips")).toBe("fsm-part-tape");
    expect(await itemKept("replacement", "standard")).toBe("fsm-item-replacement");
    expect(fsm.made.renamedItems).toEqual([]);
  });

  // The push reads what a read of the whole list at once may take; past that, ops are told to set the item by hand,
  // and the log it names says which services the push did not reach.
  it("logs each service whose item the push did not reach, as the check's alert tells ops to look for", async () => {
    const fsm = createStubFsm({ ...EMPTY_FSM, items: [...FILLER, ...CATALOGUE] });
    const logs = captureLogs();
    const { batch, acked } = syncMessage();

    await handleFsmSyncBatch(batch, queueEnv(), fakeDependencies({ fsm, now: () => ON_THE_HOUR }), createLogger(), {
      labelAsTest: true,
      cataloguePush: true,
    });

    expect(acked).toEqual(["message-1"]);
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({
        event: "fsm_catalogue_push_failed",
        reason: "catalogue_unread",
        services: expect.arrayContaining(["replacement/standard"]) as unknown,
      }),
    );
  });
});
