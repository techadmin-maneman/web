// What staging allows its own test records ("Staging test …", src/policy/staging-test-records.ts), so an audit can
// sign them in through the real screens and book many of them from one machine: the known login code, and no limits
// per address. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { EXPECTED_DATABASE_NAME } from "../../src/config/environments.ts";
import type { Settings } from "../../src/config/settings.ts";
import {
  appFor,
  captureLogs,
  fakeDependencies,
  fakeQueue,
  LOCAL_SETTINGS,
  markDatabase,
  NOW,
  request,
} from "./helpers.ts";
import type { TestDependencies } from "./helpers.ts";

const ORIGIN = "https://maneman.test"; // the host helpers.request() uses
const KNOWN = "424242";
const TEST_RECORD = "+919810000060";
const ORDINARY = "+919810000001";

let deps: TestDependencies;

beforeEach(async () => {
  captureLogs();
  await markDatabase(EXPECTED_DATABASE_NAME.staging);
  await env.DB.prepare(
    "INSERT INTO serviceable_pincodes (pincode, area, city, served) VALUES ('400050', 'Bandra', 'Mumbai', 0)",
  ).run();
  for (const [id, mobile, name] of [
    ["p-test", TEST_RECORD, "Staging test Kabir Rao"],
    ["p-ordinary", ORDINARY, "Arjun Mehta"],
  ] as const) {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO people (id, created_at, mobile_e164, name, contactable) VALUES (?1, ?2, ?3, ?4, 1)",
      ).bind(id, NOW.toISOString(), mobile, name),
      env.DB.prepare(
        `INSERT INTO leads (id, person_id, created_at, source, city, first_choice_window, loss_extent, proposed_visit_date, request_id)
         VALUES (?1, ?2, ?3, 'form', 'Gurgaon', 'weekday_pm', 'crown', '2026-09-24', 'r')`,
      ).bind(`l-${id}`, id, NOW.toISOString()),
    ]);
  }
});

function clientApp(login: Partial<Settings["login"]> = {}) {
  deps = fakeDependencies({ now: () => NOW });
  return appFor("staging", deps, { login: { ...LOCAL_SETTINGS.login, testRecordCode: KNOWN, ...login } }, "client");
}

function post(app: ReturnType<typeof appFor>, path: string, body: unknown) {
  return request(app, path, {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7" },
    body: JSON.stringify(body),
  });
}

async function askForCode(app: ReturnType<typeof appFor>, mobile: string) {
  const res = await post(app, "/api/auth/otp", { mobile });
  return { status: res.status, challengeId: (await res.json<{ challenge_id?: string }>()).challenge_id ?? "" };
}

async function verified(app: ReturnType<typeof appFor>, challengeId: string, code: string): Promise<boolean> {
  const res = await post(app, "/api/auth/verify", { challenge_id: challengeId, code });
  return (await res.json<{ verified?: boolean }>()).verified === true;
}

describe("signing in on staging", () => {
  it("takes the known code for a test record, and never for an ordinary person", async () => {
    const app = clientApp();
    const testRecord = await askForCode(app, "98100 00060");
    expect(await verified(app, testRecord.challengeId, KNOWN)).toBe(true);

    const ordinary = await askForCode(app, "98100 00001");
    expect(deps.sentCodes.at(-1)?.code).not.toBe(KNOWN);
    expect(await verified(app, ordinary.challengeId, KNOWN)).toBe(false);
  });

  it("lets a test record past the hourly limit per address, which ordinary numbers still meet", async () => {
    const app = clientApp({ codeIpHourlyLimit: 1 });
    const statuses: number[] = [];
    for (const mobile of ["98100 00060", "98100 00060", "98100 00001", "98100 00009"]) {
      statuses.push((await askForCode(app, mobile)).status);
    }
    expect(statuses).toEqual([202, 202, 202, 429]);
  });
});

describe("the site's forms on staging", () => {
  it("let test records past the day's limit per address, which other names still meet", async () => {
    const app = appFor("staging", fakeDependencies(), { leadIpDailyLimit: 1 });
    const join = (name: string, mobile: string) =>
      request(
        app,
        "/api/waitlist",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7" },
          body: JSON.stringify({
            name,
            mobile,
            pincode: "400050",
            loss_extent: "crown",
            turnstile_token: "token",
            contact_consent: true,
            launch_alert: false,
          }),
        },
        { CRM_QUEUE: fakeQueue(), MESSAGE_QUEUE: fakeQueue() },
      );

    const statuses: number[] = [];
    for (const mobile of ["9810000021", "9810000022"])
      statuses.push((await join("Staging test Arjun Mehta", mobile)).status);
    for (const mobile of ["9810000023", "9810000024"]) statuses.push((await join("Arjun Mehta", mobile)).status);
    expect(statuses).toEqual([201, 201, 201, 429]);
  });
});
