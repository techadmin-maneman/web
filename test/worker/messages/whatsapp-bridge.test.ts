// The cron's look at the WhatsApp bridge, which every login code goes through.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createCallBudget } from "../../../src/lib/call-budget.ts";
import { createLogger } from "../../../src/log.ts";
import type { Connection } from "../../../src/providers/messaging/index.ts";
import { checkWhatsAppBridge } from "../../../src/scheduled/whatsapp-bridge.ts";
import { captureLogs, fakeDependencies } from "../helpers.ts";

function bridge(connection: Connection) {
  let asked = 0;
  const deps = fakeDependencies();
  const messaging = {
    ...deps.messaging,
    connection: () => {
      asked += 1;
      return Promise.resolve(connection);
    },
  };
  return { deps: { ...deps, messaging }, asked: () => asked };
}

const LOGGED_OUT: Connection = { open: false, fault: "logged_out", detail: "state close" };

const check = (deps: ReturnType<typeof bridge>["deps"], calls = Infinity) =>
  checkWhatsAppBridge(deps, createLogger(), createCallBudget(calls));

beforeEach(() => {
  captureLogs();
});

describe("the WhatsApp bridge", () => {
  it("tells ops once it has been found closed twice in a row", async () => {
    const closed = bridge(LOGGED_OUT);
    await check(closed.deps);
    expect(closed.deps.alerts).toEqual([]);

    await check(closed.deps);
    await check(closed.deps);
    expect(closed.deps.alerts).toEqual([
      "The WhatsApp bridge is not connected (state close): no login code or message can be sent until it is. " +
        'Reconnect it by scanning its QR code with the business phone (runbook, "WhatsApp (Evolution) is down").',
    ]);
  });

  it("names the settings to check, not a QR code, when the bridge has no such instance", async () => {
    const missing = bridge({
      open: false,
      fault: "no_instance",
      detail: 'the bridge has no instance named "mane man": wrong URL or port, or the instance was deleted',
    });
    await check(missing.deps);
    await check(missing.deps);
    expect(missing.deps.alerts).toEqual([
      'The WhatsApp bridge is not connected (the bridge has no instance named "mane man": wrong URL or port, or the ' +
        "instance was deleted): no login code or message can be sent until it is. Check EVOLUTION_API_URL and " +
        "EVOLUTION_INSTANCE_NAME against the bridge's list of instances " +
        '(runbook, "WhatsApp (Evolution) is down").',
    ]);
  });

  it("names the key when the bridge refuses it", async () => {
    const refused = bridge({ open: false, fault: "key_refused", detail: "HTTP 401" });
    await check(refused.deps);
    await check(refused.deps);
    expect(refused.deps.alerts).toEqual([expect.stringContaining("Check EVOLUTION_API_KEY") as string]);
  });

  it("closes the alert once it is open again, so a later drop is told afresh", async () => {
    const closed = bridge(LOGGED_OUT);
    await check(closed.deps);
    await check(closed.deps);

    await check(bridge({ open: true }).deps);
    const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM alerts WHERE resolved_at IS NULL").first();
    expect(open).toEqual({ n: 0 });
  });

  it("is not asked when the cron run has no call left", async () => {
    const closed = bridge(LOGGED_OUT);
    await check(closed.deps, 0);
    expect(closed.asked()).toBe(0);
  });
});
