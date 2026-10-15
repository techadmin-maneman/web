// The national daily ceilings (src/domain/platform/ceilings.ts): the figure ops set in Settings · Rules holds from the
// next use, with no release; until then the environment's own; and ops are told at 80%, once, before one is reached.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { withinCeiling } from "../../../src/domain/platform/ceilings.ts";
import { PRODUCTION_CEILINGS } from "../../../src/policy/ops-settings-ceilings.ts";
import { ceilingsIn } from "../../../src/policy/rate-limits.ts";
import { appFor, fakeDependencies, LOCAL_SETTINGS, markDatabase, NOW, request } from "../helpers.ts";

const at = { now: NOW, settings: LOCAL_SETTINGS };

const opsSet = (ceilings: Record<string, number>) =>
  env.DB.prepare(
    "INSERT INTO ops_settings (name, value, set_by, set_at) VALUES ('daily_ceilings', ?1, 'ops@localhost', ?2)",
  )
    .bind(JSON.stringify({ ...PRODUCTION_CEILINGS, ...ceilings }), NOW.toISOString())
    .run();

/** Uses the ceiling `times` times, each answer in turn. */
async function use(ceiling: "render" | "login_code", times: number, alerts: string[]): Promise<boolean[]> {
  const alert = (message: string) => {
    alerts.push(message);
    return Promise.resolve();
  };
  const answers: boolean[] = [];
  for (let n = 0; n < times; n += 1) answers.push(await withinCeiling(env.DB, alert, ceiling, at));
  return answers;
}

beforeEach(async () => {
  await markDatabase();
});

describe("a national daily ceiling", () => {
  // Each needed a release to raise, so a busy day in two cities stopped sign-in in all of them.
  it("is the figure ops set, from the next use, over the environment's own", async () => {
    await opsSet({ render: 2 });
    const alerts: string[] = [];
    expect(await use("render", 3, alerts)).toEqual([true, true, false]);
    expect(alerts).toEqual([expect.stringContaining("The daily render ceiling (2) is reached") as string]);
  });

  it("is the environment's own until ops set one", async () => {
    const alerts: string[] = [];
    const answers = await use("render", LOCAL_SETTINGS.tryon.renderDailyCeiling + 1, alerts);
    expect(answers.filter(Boolean)).toHaveLength(LOCAL_SETTINGS.tryon.renderDailyCeiling);
  });

  it("tells ops once at 80%, before it is reached", async () => {
    await opsSet({ login_code: 10 });
    const alerts: string[] = [];
    await use("login_code", 9, alerts);
    expect(alerts).toEqual([
      expect.stringContaining(
        "The daily login_code ceiling is 80% used (8 of 10); raise it in Settings · Rules",
      ) as string,
    ]);
  });

  it("stops everything at 0", async () => {
    await opsSet({ render: 0 });
    expect(await use("render", 1, [])).toEqual([false]);
  });
});

describe("Settings · Rules, the daily ceilings", () => {
  it("shows this environment's own figures until ops set theirs, then theirs", async () => {
    const ops = appFor("local", fakeDependencies(), {}, "ops");
    const ceilings = async () =>
      (
        await (
          await request(ops, "/api/settings")
        ).json<{ settings: { name: string; value: unknown; default: unknown }[] }>()
      ).settings.find((setting) => setting.name === "daily_ceilings");
    expect(await ceilings()).toMatchObject({ value: ceilingsIn(LOCAL_SETTINGS), default: ceilingsIn(LOCAL_SETTINGS) });
    await opsSet({ render: 60 });
    expect(await ceilings()).toMatchObject({ value: { ...PRODUCTION_CEILINGS, render: 60 } });
  });
});
