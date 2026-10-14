// The long work in Workflows (src/workflows/; docs/decisions/0196-long-work-in-workflows.md): the night's copy a step a
// part, put in at once and told of; the week's backup a step a table, its manifest last; a run that fails told and
// thrown for the Workflow to try again; and the cron starting each, or following the one started. Every name and
// number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { NIGHT_PARTS } from "../../../src/domain/analytics/nightly.ts";
import { createStubWarehouse } from "../../../src/providers/warehouse/stub.ts";
import { STILL_RUNNING } from "../../../src/scheduled/schedule.ts";
import { copyNight } from "../../../src/workflows/analytics-copy.ts";
import { backUp } from "../../../src/workflows/backup.ts";
import { startOrFollow, type Steps } from "../../../src/workflows/steps.ts";
import { client, IMRAN, technician } from "../clients.ts";
import { fakeDependencies, LOCAL_CONFIG, markDatabase, type TestDependencies } from "../helpers.ts";
import { visit } from "../visits.ts";

/** Steps run as they are asked for, their names kept; one named in `breaks` throws instead. */
function steps(breaks?: string): Steps & { readonly ran: string[] } {
  const ran: string[] = [];
  return {
    ran,
    do: (name, _config, run) => {
      ran.push(name);
      return name === breaks ? Promise.reject(new Error(`${name} broke`)) : run();
    },
  };
}

let deps: TestDependencies;

beforeEach(async () => {
  await markDatabase();
  deps = fakeDependencies();
  await technician();
  await client("p-rohit", "+919810000001", "Rohit Malhotra");
  await visit("v-rohit", {
    person: "p-rohit",
    technician: IMRAN,
    start: "2026-09-20T04:30:00.000Z",
    status: "completed",
  });
});

describe("the night's copy", () => {
  const warehouse = createStubWarehouse();
  const run = () => ({ env, config: LOCAL_CONFIG, deps, warehouse: () => warehouse });

  it("stages each part in a step of its own, then puts the night in at once and tells ops", async () => {
    const given = steps();
    await copyNight(given, run(), "2026-09-21");
    expect(given.ran).toEqual(["begin", ...NIGHT_PARTS.map((part) => `stage ${part.name}`), "swap", "tell"]);
    expect(warehouse.tables.get("fact_visit")?.size).toBe(1);
    expect(warehouse.runs).toEqual([expect.objectContaining({ date: "2026-09-21", totalsChecked: true })]);

    // The night is copied once, however often it is started.
    const again = steps();
    await copyNight(again, run(), "2026-09-21");
    expect(again.ran).toEqual(["begin"]);
  });

  it("tells ops of a part that failed for good, and throws for the Workflow to keep", async () => {
    const given = steps("stage visits");
    await expect(copyNight(given, run(), "2026-09-22")).rejects.toThrow("stage visits broke");
    expect(given.ran.at(-1)).toBe("tell of the failure");
    expect(deps.alerts).toEqual([expect.stringContaining("last night's failed (stage visits broke)")]);
  });
});

describe("the week's backup", () => {
  const key = async () => {
    const pair = await crypto.subtle.generateKey(
      { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["wrapKey", "unwrapKey"],
    );
    if (!("publicKey" in pair)) throw new Error("RSA-OAEP makes a key pair");
    const spki = new Uint8Array((await crypto.subtle.exportKey("spki", pair.publicKey)) as ArrayBuffer);
    return btoa(String.fromCharCode(...spki));
  };

  it("writes each table in a step of its own under its own key, the manifest last, and only once", async () => {
    const config = { ...LOCAL_CONFIG, settings: { ...LOCAL_CONFIG.settings, backupPublicKey: await key() } };
    const given = steps();
    await backUp(given, { env, config, deps }, "2026-10-11");
    const tables = given.ran.filter((name) => name.startsWith("table "));
    expect(tables).toContain("table people");
    expect(given.ran.slice(-3)).toEqual(["manifest", "prune", "tell"]);
    const manifest = await (
      await env.BACKUPS.get("2026-10-11/manifest.json")
    )?.json<{
      format: number;
      tables: { name: string; wrapped_key: string }[];
    }>();
    expect(manifest?.format).toBe(2);
    expect(manifest?.tables).toHaveLength(tables.length);
    expect(new Set(manifest?.tables.map((table) => table.wrapped_key)).size).toBe(tables.length);

    const again = steps();
    await backUp(again, { env, config, deps }, "2026-10-11");
    expect(again.ran).toEqual(["schema"]);
  });
});

describe("the cron and a Workflow", () => {
  /** A Workflow binding that knows one instance, in the state given, or none. */
  function workflow(status: string | null) {
    const created: string[] = [];
    let restarted = 0;
    const binding = {
      get: (id: string) =>
        status === null
          ? Promise.reject(new Error(`no instance ${id}`))
          : Promise.resolve({
              id,
              status: () => Promise.resolve({ status }),
              restart: () => {
                restarted += 1;
                return Promise.resolve();
              },
            }),
      create: ({ id }: { id: string }) => {
        created.push(id);
        return Promise.resolve({ id });
      },
    } as unknown as Workflow<{ date: string }>;
    return { binding, created, restarted: () => restarted };
  }

  const asked = { id: "copy-2026-09-21", params: { date: "2026-09-21" } };

  it("starts the run when there is none, and follows it until it is complete", async () => {
    const none = workflow(null);
    expect(await startOrFollow(none.binding, asked)).toBe(STILL_RUNNING);
    expect(none.created).toEqual(["copy-2026-09-21"]);
    expect(await startOrFollow(workflow("running").binding, asked)).toBe(STILL_RUNNING);
    expect(await startOrFollow(workflow("complete").binding, asked)).toBe("complete");
  });

  it("starts again a run that failed for good", async () => {
    const errored = workflow("errored");
    expect(await startOrFollow(errored.binding, asked)).toBe(STILL_RUNNING);
    expect(errored.restarted()).toBe(1);
  });
});
