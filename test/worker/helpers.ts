import { env } from "cloudflare:workers";
import { vi, type MockInstance } from "vitest";
import { createApp, type App } from "../../src/app.ts";
import { EXPECTED_DATABASE_NAME, type EnvironmentName } from "../../src/config/environments.ts";
import type { StaticConfig } from "../../src/guard.ts";

export const LOCAL_CONFIG: StaticConfig = {
  environment: "local",
  providers: { IMAGE_PROVIDER: "stub", CRM_PROVIDER: "stub", MESSAGING_PROVIDER: "stub" },
};

export async function markDatabase(databaseName: string = EXPECTED_DATABASE_NAME.local): Promise<void> {
  await env.DB.prepare("INSERT INTO deployment_identity (id, database_name) VALUES (1, ?)").bind(databaseName).run();
}

/** A fresh app (and so a fresh identity cache) per test. */
export function appFor(environment: EnvironmentName = "local"): App {
  return createApp({ ...LOCAL_CONFIG, environment });
}

export function request(app: App, path: string, init?: RequestInit): Promise<Response> {
  return Promise.resolve(app.request(`https://maneman.test${path}`, init, env));
}

/** Captures every JSON log line written through console.*. */
export function captureLogs(): { lines: () => Record<string, unknown>[]; spies: MockInstance[] } {
  const spies = (["debug", "log", "warn", "error"] as const).map((method) => {
    const spy = vi.spyOn(console, method).mockImplementation(() => undefined);
    spy.mockClear(); // spyOn returns an existing spy, calls and all
    return spy;
  });
  return {
    spies,
    lines: () =>
      spies.flatMap((spy) => spy.mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>)),
  };
}
