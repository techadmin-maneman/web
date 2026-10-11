// What technicians are paid for each visit, set by Finance in the console (src/routes/ops/technician-pay.ts,
// docs/decisions/0122-technician-pay-per-visit.md). NOW is Monday 21 September 2026, 12 noon in India. Nothing here
// is a real person or number.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import { enforce, listStaff, opsAs, person } from "./staff-fixtures.ts";

let ops: App;

interface Pay {
  today: string;
  grades: { id: string; name: string; technicians: number }[];
  technicians: { id: string; name: string; city: string | null; grade_id: string | null }[];
  rates: { grade_id: string; city: string | null; kind: string; amount: number | null; effective_from: string }[];
}

const send = (app: App, method: string, path: string, body?: unknown) =>
  request(app, path, {
    method,
    headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const pay = async (app: App = ops) => (await request(app, "/api/technician-pay")).json<Pay>();

async function addGrade(name: string): Promise<string> {
  const answer = await send(ops, "POST", "/api/technician-pay/grades", { name });
  expect(answer.status).toBe(200);
  const grade = (await answer.json<Pay>()).grades.find((each) => each.name === name);
  if (grade === undefined) throw new Error(`${name} was not added`);
  return grade.id;
}

const technician = (id: string, city: string | null) =>
  env.DB.prepare(
    "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at, city) VALUES (?1, ?1, ?2, 'TT', 1, ?3, ?4)",
  )
    .bind(id, `Test technician ${id}`, NOW.toISOString(), city)
    .run();

beforeEach(async () => {
  await markDatabase();
  ops = appFor("local", fakeDependencies(), {}, "ops");
});

describe("the grades", () => {
  it("adds, renames and deletes one, and refuses a name another has", async () => {
    const id = await addGrade("Senior");
    expect((await send(ops, "POST", "/api/technician-pay/grades", { name: "senior" })).status).toBe(409);
    expect((await send(ops, "PATCH", `/api/technician-pay/grades/${id}`, { name: "Lead" })).status).toBe(200);
    expect((await pay()).grades).toEqual([{ id, name: "Lead", technicians: 0 }]);
    expect((await send(ops, "POST", `/api/technician-pay/grades/${id}/delete`)).status).toBe(200);
    expect((await pay()).grades).toEqual([]);
  });

  it("keeps a grade a technician holds or a rate has named", async () => {
    const held = await addGrade("Senior");
    await technician("t1", "Delhi");
    await send(ops, "POST", "/api/technician-pay/technicians/t1", { grade_id: held });
    expect((await send(ops, "POST", `/api/technician-pay/grades/${held}/delete`)).status).toBe(409);

    const priced = await addGrade("Trainee");
    await send(ops, "POST", "/api/technician-pay/rates", {
      grade_id: priced,
      city: null,
      kind: "service",
      amount: 30000,
      from: "2026-09-21",
    });
    expect((await send(ops, "POST", `/api/technician-pay/grades/${priced}/delete`)).status).toBe(409);
  });
});

describe("the rates", () => {
  it("lists the rate in force today and one set to start later, never one a later rate replaced", async () => {
    const grade = await addGrade("Senior");
    await env.DB.prepare(
      `INSERT INTO visit_pay_rates (id, grade_id, city, visit_kind, amount, effective_from, set_by, set_at)
       VALUES ('r0', ?1, NULL, 'service', 25000, '2026-08-01', 'finance@maneman.test', ?2)`,
    )
      .bind(grade, NOW.toISOString())
      .run();
    const set = (amount: number | null, from: string, city: string | null = null) =>
      send(ops, "POST", "/api/technician-pay/rates", { grade_id: grade, city, kind: "service", amount, from });
    expect((await set(30000, "2026-09-21")).status).toBe(200);
    expect((await set(35000, "2026-10-01")).status).toBe(200);
    expect((await set(40000, "2026-09-21", "Gurgaon")).status).toBe(200);

    const rates = (await pay()).rates.map(({ city, amount, effective_from }) => ({ city, amount, effective_from }));
    expect(rates).toEqual([
      { city: null, amount: 30000, effective_from: "2026-09-21" },
      { city: null, amount: 35000, effective_from: "2026-10-01" },
      { city: "Gurgaon", amount: 40000, effective_from: "2026-09-21" },
    ]);
  });

  it("starts a rate no earlier than today, in one of our cities, and records who set it", async () => {
    const grade = await addGrade("Senior");
    const body = { grade_id: grade, city: null, kind: "first_fit", amount: 100000, from: "2026-09-20" };
    expect((await send(ops, "POST", "/api/technician-pay/rates", body)).status).toBe(400);
    const elsewhere = { ...body, city: "Atlantis", from: "2026-09-21" };
    expect((await send(ops, "POST", "/api/technician-pay/rates", elsewhere)).status).toBe(400);
    expect((await send(ops, "POST", "/api/technician-pay/rates", { ...body, from: "2026-09-21" })).status).toBe(200);

    const entry = await env.DB.prepare("SELECT subject_id, detail FROM audit_log WHERE action = 'pay_rate.set'").first<{
      subject_id: string;
      detail: string;
    }>();
    expect(entry?.subject_id).toBe(grade);
    expect(JSON.parse(entry?.detail ?? "{}")).toEqual({
      city: null,
      kind: "first_fit",
      amount: 100000,
      from: "2026-09-21",
    });
  });
});

describe("a technician's grade", () => {
  it("is given and taken away, and the grade counts who holds it", async () => {
    const grade = await addGrade("Senior");
    await technician("t1", "Delhi");
    await send(ops, "POST", "/api/technician-pay/technicians/t1", { grade_id: grade });
    const given = await pay();
    expect(given.technicians.find((each) => each.id === "t1")?.grade_id).toBe(grade);
    expect(given.grades[0]?.technicians).toBe(1);

    await send(ops, "POST", "/api/technician-pay/technicians/t1", { grade_id: null });
    expect((await pay()).technicians.find((each) => each.id === "t1")?.grade_id).toBeNull();
  });
});

describe("once the Staff list is enforced", () => {
  it("shows a city's Finance only its technicians and city rates, and keeps every city's rates national", async () => {
    const grade = await addGrade("Senior");
    await technician("t1", "Delhi");
    await technician("t2", "Gurgaon");
    await listStaff("finance.delhi@maneman.test", ["finance:manage:city:Delhi"]);
    await enforce();
    const delhi = opsAs(person("finance.delhi@maneman.test"));

    const seen = await pay(delhi);
    expect(seen.technicians.map((each) => each.id)).toEqual(["t1"]);
    const rate = { grade_id: grade, kind: "service", amount: 30000, from: "2026-09-21" };
    expect((await send(delhi, "POST", "/api/technician-pay/rates", { ...rate, city: null })).status).toBe(403);
    expect((await send(delhi, "POST", "/api/technician-pay/rates", { ...rate, city: "Gurgaon" })).status).toBe(404);
    expect((await send(delhi, "POST", "/api/technician-pay/rates", { ...rate, city: "Delhi" })).status).toBe(200);
    expect((await send(delhi, "POST", "/api/technician-pay/technicians/t2", { grade_id: grade })).status).toBe(404);
    expect((await send(delhi, "POST", "/api/technician-pay/grades", { name: "Lead" })).status).toBe(403);
  });
});
