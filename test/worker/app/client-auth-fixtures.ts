// What the client sign-in tests share (client-auth*.test.ts): the numbers, the clock and the app it runs on, a code
// asked for and checked, and the codes sent.

import type { App } from "../../../src/http/context.ts";
import type { Settings } from "../../../src/config/settings.ts";
import { appFor, fakeDependencies, request, type TestDependencies } from "../helpers.ts";

export const ORIGIN = "https://maneman.test";

// the host helpers.request() uses
export const BOOKED = "+919810000001";

export const UNBOOKED = "+919810000002";

export let clock: Date;

/** Sets the clock the app reads, for the test. */
export const useClock = (at: Date) => {
  clock = at;
};

export let deps: TestDependencies;

export let app: App;

/** Runs the app on these dependencies, for the test. */
export const useDependencies = (dependencies: TestDependencies) => {
  deps = dependencies;
  app = appFor("local", deps, {}, "client");
};

export function build(overrides: Partial<Settings> = {}, smsAvailable = true): void {
  deps = fakeDependencies({ now: () => clock });
  if (!smsAvailable) deps = { ...deps, codes: { ...deps.codes, smsAvailable: false } };
  app = appFor("local", deps, overrides, "client");
}

export const later = (seconds: number) => {
  clock = new Date(clock.getTime() + seconds * 1000);
};

export function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return request(app, path, {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

/** Asks for a code, with the Turnstile token the app's widget gives (fakeDependencies' Turnstile passes it). */
export async function start(mobile: string, headers: Record<string, string> = {}) {
  const res = await post("/api/auth/otp", { mobile, turnstile_token: "token" }, headers);
  return { res, body: await res.json<Record<string, unknown> & { challenge_id: string }>() };
}

export const verify = (challengeId: string, code: string) =>
  post("/api/auth/verify", { challenge_id: challengeId, code });

export const lastCode = () => deps.sentCodes.at(-1)?.code ?? "";

export const wrongCode = (right: string) => (right === "000000" ? "111111" : "000000");
