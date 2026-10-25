// Opening a city from India Post's pincodes (src/routes/ops/pincode-directory.ts, ADR 0220): the states and districts,
// a district's pincodes with what each area would be called and what we hold, and adding them unserved in one of our
// cities, only where the caller's Growth reaches. NOW is Monday 21 September 2026, 12 noon in India. The pincodes are
// real only as numbers; nothing here is a person.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { appFor, fakeDependencies, markDatabase, request } from "../helpers.ts";
import { aTechnicianInEveryCity } from "../clients.ts";
import { POST, auditFor } from "./ops-settings-fixtures.ts";
import { enforce, listStaff, opsAs, person } from "./staff-fixtures.ts";

let ops: App;

const get = (app: App, path: string) => request(app, path);
const add = (app: App, body: unknown) =>
  request(app, "/api/pincodes/from-directory", { method: "POST", headers: POST, body: JSON.stringify(body) });

async function listed(pincode: string, district: string, state: string, offices: string) {
  await env.DB.prepare(
    `INSERT INTO pincode_directory (pincode, district, state, office_names, latitude, longitude, refreshed_on)
     VALUES (?1, ?2, ?3, ?4, 19.06, 72.83, '2025-10-03')`,
  )
    .bind(pincode, district, state, offices)
    .run();
}

beforeEach(async () => {
  await markDatabase();
  await aTechnicianInEveryCity();
  ops = appFor("local", fakeDependencies(), {}, "ops");
  await listed("400050", "MUMBAI", "MAHARASHTRA", "Bandra West SO;Pali Hill BO");
  await listed("400051", "MUMBAI", "MAHARASHTRA", "Bandra East SO;Kherwadi SO");
  await listed("411001", "PUNE", "MAHARASHTRA", "Pune HO");
  await listed("110001", "CENTRAL DELHI", "DELHI", "Connaught Place SO");
  await env.DB.prepare(
    "INSERT INTO serviceable_pincodes (pincode, area, city, served) VALUES ('110001', 'Connaught Place', 'Delhi', 1)",
  ).run();
});

describe("reading the directory", () => {
  it("lists its states, and a state's districts with how many of each we hold", async () => {
    expect(await (await get(ops, "/api/pincode-directory/states")).json()).toEqual({
      states: ["DELHI", "MAHARASHTRA"],
    });
    expect(await (await get(ops, "/api/pincode-directory/districts?state=DELHI")).json()).toEqual({
      districts: [{ state: "DELHI", district: "CENTRAL DELHI", pincodes: 1, held: 1 }],
    });
    const maharashtra = await get(ops, "/api/pincode-directory/districts?state=MAHARASHTRA");
    expect(await maharashtra.json()).toEqual({
      districts: [
        { state: "MAHARASHTRA", district: "MUMBAI", pincodes: 2, held: 0 },
        { state: "MAHARASHTRA", district: "PUNE", pincodes: 1, held: 0 },
      ],
    });
  });

  it("lists the districts' pincodes, each area named from its shortest post office, and where we hold one", async () => {
    const answer = await get(ops, "/api/pincode-directory/pincodes?state=MAHARASHTRA&district=MUMBAI&district=PUNE");
    const { pincodes } = await answer.json<{ pincodes: { pincode: string; area: string; held: unknown }[] }>();
    expect(pincodes.map(({ pincode, area, held }) => ({ pincode, area, held }))).toEqual([
      { pincode: "400050", area: "Bandra West", held: null },
      { pincode: "400051", area: "Kherwadi", held: null },
      { pincode: "411001", area: "Pune", held: null },
    ]);

    const delhi = await get(ops, "/api/pincode-directory/pincodes?state=DELHI&district=CENTRAL%20DELHI");
    expect(await delhi.json()).toMatchObject({
      pincodes: [{ pincode: "110001", held: { city: "Delhi", area: "Connaught Place", served: true } }],
    });
  });

  it("takes up to ten districts", async () => {
    const eleven = Array.from({ length: 11 }, (_, at) => `district=D${String(at)}`).join("&");
    expect((await get(ops, `/api/pincode-directory/pincodes?state=DELHI&${eleven}`)).status).toBe(400);
  });
});

describe("adding from the directory", () => {
  it("adds those not held unserved, named as ops left or gave them, and names back the rest", async () => {
    const answer = await add(ops, {
      city: "Mumbai",
      pincodes: [
        { pincode: "400050" },
        { pincode: "400051", area: "Bandra East" },
        { pincode: "110001" },
        { pincode: "560099" },
      ],
    });
    expect(answer.status).toBe(201);
    expect(await answer.json()).toEqual({
      added: [
        {
          pincode: "400050",
          area: "Bandra West",
          city: "Mumbai",
          served: false,
          launch_on: null,
          waiting: 0,
          to_alert: 0,
        },
        {
          pincode: "400051",
          area: "Bandra East",
          city: "Mumbai",
          served: false,
          launch_on: null,
          waiting: 0,
          to_alert: 0,
        },
      ],
      held: ["110001"],
      unlisted: ["560099"],
    });

    const { results } = await env.DB.prepare(
      "SELECT pincode, area, city, served, area_named_by FROM serviceable_pincodes ORDER BY pincode",
    ).all();
    expect(results).toEqual([
      { pincode: "110001", area: "Connaught Place", city: "Delhi", served: 1, area_named_by: null },
      { pincode: "400050", area: "Bandra West", city: "Mumbai", served: 0, area_named_by: null },
      { pincode: "400051", area: "Bandra East", city: "Mumbai", served: 0, area_named_by: "ops@localhost" },
    ]);
    const detail = JSON.stringify({ city: "Mumbai", from: "directory" });
    expect((await auditFor("pincode.add")).results).toEqual([
      { actor: "ops@localhost", actor_kind: "staff", subject_id: "400050", detail },
      { actor: "ops@localhost", actor_kind: "staff", subject_id: "400051", detail },
    ]);
  });

  it("refuses a city that is not ours, and a name the service area could not hold, adding nothing", async () => {
    const nowhere = await add(ops, { city: "Chennai", pincodes: [{ pincode: "400050" }] });
    expect(nowhere.status).toBe(400);
    expect(await nowhere.json()).toMatchObject({ error: { code: "invalid_request", fields: ["city"] } });

    const formula = await add(ops, { city: "Mumbai", pincodes: [{ pincode: "400050", area: "=HYPERLINK(1)" }] });
    expect(formula.status).toBe(400);
    expect((await auditFor("pincode.add")).results).toHaveLength(0);
  });

  it("adds only in the cities the caller's Growth manages, and lets a viewer read", async () => {
    await enforce();
    await listStaff("growth@maneman.in", ["growth:manage:city:Delhi"]);
    const delhi = opsAs(person("growth@maneman.in"));
    const mumbai = await add(delhi, { city: "Mumbai", pincodes: [{ pincode: "400050" }] });
    expect(mumbai.status).toBe(403);
    expect(await mumbai.json()).toMatchObject({ error: { code: "not_permitted" } });

    await listStaff("viewer@maneman.in", ["growth:view:city:Delhi"]);
    const viewer = opsAs(person("viewer@maneman.in"));
    expect((await get(viewer, "/api/pincode-directory/states")).status).toBe(200);
    expect((await add(viewer, { city: "Delhi", pincodes: [{ pincode: "400050" }] })).status).toBe(403);
  });
});
