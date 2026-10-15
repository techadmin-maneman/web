// A city served with nobody to send, and one booked up: ops hear of each, as the site can only say every day is full.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { tellOfUncoveredCities } from "../../../src/domain/clients/service-area.ts";
import { createAlertOnce, createResolveAlert } from "../../../src/domain/platform/alerts.ts";
import { createLogger } from "../../../src/log.ts";
import { markDatabase, NOW, request } from "../helpers.ts";
import { aTechnician } from "../fixtures/index.ts";
import { pincode, site } from "../site/consultations-fixtures.ts";

const told: string[] = [];
const deps = {
  alertOnce: createAlertOnce({
    db: env.DB,
    alert: (message: string) => {
      told.push(message);
      return Promise.resolve();
    },
    now: () => NOW,
    environment: "local",
    log: createLogger(),
  }),
  resolveAlert: createResolveAlert({ db: env.DB, now: () => NOW }),
};

const openKeys = async () =>
  (
    await env.DB.prepare("SELECT key FROM alerts WHERE resolved_at IS NULL ORDER BY key").all<{ key: string }>()
  ).results.map((row) => row.key);

const technician = (id: string, city: string, active = 1) => aTechnician({ id, city, active });

beforeEach(async () => {
  told.length = 0;
  await markDatabase();
});

describe("a city served with no active technician", () => {
  it("is told to ops once, and closed once a technician works there again", async () => {
    await pincode("110017", "Malviya Nagar", "Delhi", true);
    await pincode("110048", "Greater Kailash", "Delhi", true);
    await pincode("122018", "Sector 65", "Gurgaon", true);
    await technician("t-gurgaon", "Gurgaon");
    await technician("t-gone", "Delhi", 0);

    await tellOfUncoveredCities(env.DB, deps);
    await tellOfUncoveredCities(env.DB, deps);
    expect(await openKeys()).toEqual(["city_uncovered:Delhi"]);
    expect(told).toHaveLength(1);
    expect(told[0]).toContain("Add a technician in Delhi, or stop serving its 2 pincodes in Areas");

    await technician("t-delhi", "Delhi");
    await tellOfUncoveredCities(env.DB, deps);
    expect(await openKeys()).toEqual([]);
  });
});

describe("a city booked up", () => {
  it("is told to ops when the site finds no consultation window open in the fortnight", async () => {
    await pincode("110017", "Malviya Nagar", "Delhi", true);
    const answer = await request(site(), "/api/availability/public?pincode=110017&plan=consultation");
    expect(answer.status).toBe(200);
    expect(await openKeys()).toEqual([expect.stringMatching(/^fully_booked:Delhi:\d{4}-\d{2}-\d{2}$/)]);
  });
});
