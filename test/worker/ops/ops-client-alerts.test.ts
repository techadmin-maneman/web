// A client's alerts on their page in the console (src/routes/ops/client-alerts.ts): raised and taken off by staff,
// kept all the while, and audited by the alert, never a word of it. Every name here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { appFor, captureLogs, fakeDependencies, markDatabase, request } from "../helpers.ts";
import { anAddress, aPerson } from "../fixtures/index.ts";

interface Alerts {
  alerts: { id: string; body: string; raised_by: { kind: string } }[];
}

const send = (path: string, body?: object) =>
  request(appFor("local", fakeDependencies(), {}, "ops"), path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

let client: string;

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  client = crypto.randomUUID();
  await aPerson({ id: client });
  await anAddress(client);
});

describe("a client's alerts", () => {
  it("raises an alert under the member of staff and takes it off, keeping it, audited without its words", async () => {
    const raised = await send(`/api/clients/${client}/alerts`, { body: "Allergic to latex." });
    expect(raised.status).toBe(201);
    const [alert] = (await raised.json<Alerts>()).alerts;
    expect(alert).toMatchObject({ body: "Allergic to latex.", raised_by: { kind: "staff" } });

    const off = await send(`/api/clients/${client}/alerts/${alert?.id ?? ""}/take-off`, {});
    expect((await off.json<Alerts>()).alerts).toEqual([]);
    expect(await env.DB.prepare("SELECT body, taken_off_at IS NOT NULL AS off FROM client_alerts").all()).toMatchObject(
      { results: [{ body: "Allergic to latex.", off: 1 }] },
    );
    const audit = await env.DB.prepare("SELECT action, detail FROM audit_log WHERE action LIKE 'client_alert.%'").all<{
      action: string;
      detail: string;
    }>();
    expect(audit.results.map((row) => row.action)).toEqual(["client_alert.raise", "client_alert.take_off"]);
    expect(audit.results.some((row) => row.detail.includes("latex"))).toBe(false);
  });

  it("refuses an empty alert, or one past its length", async () => {
    expect((await send(`/api/clients/${client}/alerts`, { body: " " })).status).toBe(400);
    expect((await send(`/api/clients/${client}/alerts`, { body: "x".repeat(201) })).status).toBe(400);
  });

  it("is nothing for a client there is not", async () => {
    expect((await send(`/api/clients/${crypto.randomUUID()}/alerts`)).status).toBe(404);
  });
});
