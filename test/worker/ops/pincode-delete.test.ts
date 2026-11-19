// A pincode deleted from the service area while we do not go there and nothing names it
// (docs/decisions/0283-changed-and-deleted-while-unused.md). NOW is Monday 21 September 2026, 12 noon in India. Every
// pincode here is real only as a number; nothing is a person, a mobile or an address.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import { POST, auditFor } from "./ops-settings-fixtures.ts";
import { enforce, listStaff, opsAs, person } from "./staff-fixtures.ts";

let ops: App;

const remove = (app: App, pin: string) =>
  request(app, `/api/pincodes/${pin}/delete`, { method: "POST", headers: POST });

const deletable = async () =>
  (await (await request(ops, "/api/service-area")).json<{ pincodes: { pincode: string; deletable: boolean }[] }>())
    .pincodes;

const pincode = (pin: string, city: string, served: number) =>
  env.DB.prepare(
    "INSERT INTO serviceable_pincodes (pincode, area, city, served) VALUES (?1, 'Somewhere', ?2, ?3)",
  ).bind(pin, city, served);

beforeEach(async () => {
  await markDatabase();
  ops = appFor("local", fakeDependencies(), {}, "ops");
  await env.DB.batch([
    pincode("110001", "Delhi", 1),
    pincode("110017", "Delhi", 0),
    pincode("122018", "Gurgaon", 0),
    env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name, contactable) VALUES ('p1', ?1, '+919810000001', 'Someone', 1)",
    ).bind(NOW.toISOString()),
    env.DB.prepare(
      `INSERT INTO waitlist_entries (id, pincode, person_id, contact_consent_at, created_at)
       VALUES ('wl-1', '110017', 'p1', ?1, ?1)`,
    ).bind(NOW.toISOString()),
  ]);
});

describe("a pincode deleted", () => {
  it("is listed as deletable only while we do not go there and nothing names it", async () => {
    expect(await deletable()).toEqual([
      expect.objectContaining({ pincode: "110001", deletable: false }),
      expect.objectContaining({ pincode: "110017", deletable: false }),
      expect.objectContaining({ pincode: "122018", deletable: true }),
    ]);
  });

  it("goes, audited with its city, while nothing names it", async () => {
    expect((await remove(ops, "122018")).status).toBe(204);
    expect(await env.DB.prepare("SELECT 1 FROM serviceable_pincodes WHERE pincode = '122018'").first()).toBeNull();
    expect((await auditFor("pincode.delete")).results).toEqual([
      expect.objectContaining({ subject_id: "122018", detail: JSON.stringify({ city: "Gurgaon" }) }),
    ]);
    expect((await remove(ops, "122018")).status).toBe(404);
  });

  it("stays where we go there, or someone waits there, and nothing is audited", async () => {
    for (const pin of ["110001", "110017"]) {
      const refused = await remove(ops, pin);
      expect(refused.status).toBe(409);
      expect(await refused.json()).toMatchObject({ error: { code: "in_use" } });
    }
    expect((await deletable()).map((each) => each.pincode)).toEqual(["110001", "110017", "122018"]);
    expect((await auditFor("pincode.delete")).results).toEqual([]);
  });

  it("only in the cities the caller's Growth manages", async () => {
    await enforce();
    await listStaff("growth@maneman.in", ["growth:manage:city:Delhi"]);
    const refused = await remove(opsAs(person("growth@maneman.in")), "122018");
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "not_permitted" } });
    expect(await env.DB.prepare("SELECT 1 FROM serviceable_pincodes WHERE pincode = '122018'").first()).not.toBeNull();
  });
});
