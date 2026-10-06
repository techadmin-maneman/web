// One client's record on the ops surface (src/routes/ops/clients.ts): the client
// page, its photographs and its consents, Ops Console B1 to B3. NOW is Monday
// 21 September 2026, 12 noon in India. Every name, number and photograph is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { CLIENTS_FOUND } from "../../../src/routes/ops/clients.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import { PERSON, OTHER, MOBILE, person, record, upcomingVisit } from "./ops-clients-fixtures.ts";

let ops: App;

beforeEach(async () => {
  captureLogs();
  ops = appFor("local", fakeDependencies(), {}, "ops");
  await markDatabase();
  await person(PERSON, "Rohit Malhotra", MOBILE);
});

describe("POST /api/clients/search", () => {
  const search = (mobile: string) =>
    request(ops, "/api/clients/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
      body: JSON.stringify({ mobile }),
    });

  it("finds the client from a number typed any of the usual ways, and never puts it in the URL", async () => {
    const answer = await search("98100 00001");
    expect(await answer.json()).toEqual({ id: PERSON, name: "Rohit Malhotra", mobile: MOBILE });
  });

  it("answers 404 for a number we do not have, and 400 for one that is not a mobile number", async () => {
    expect((await search("9810000009")).status).toBe(404);
    const bad = await search("12345");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: "invalid_request", fields: ["mobile"] } });
  });
});

// A client could be found only by typing their whole number exactly.
describe("POST /api/clients/find", () => {
  const find = (text: string) =>
    request(ops, "/api/clients/find", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
      body: JSON.stringify({ text }),
    });
  const found = async (text: string) =>
    (await (await find(text)).json<{ clients: { name: string }[]; more: boolean }>()).clients.map((each) => each.name);

  beforeEach(async () => {
    await person(OTHER, "Vikram Sethi", "+919810000002");
    await person("11111111-1111-4111-8111-111111111113", "Rohini Sethi", "+919820000003");
  });

  it("finds clients by any part of their name, whatever its case", async () => {
    expect(await found("sethi")).toEqual(["Rohini Sethi", "Vikram Sethi"]);
    expect(await found("ROH")).toEqual(["Rohini Sethi", "Rohit Malhotra"]);
    expect(await (await find("vikram")).json()).toEqual({
      clients: [
        { id: OTHER, name: "Vikram Sethi", mobile: "+919810000002", state: "nothing_booked", next_visit: null },
      ],
      more: false,
    });
  });

  // Two clients of one name could be told apart only by their number.
  it("says where each client stands, and when their next visit is", async () => {
    await record();
    await upcomingVisit();
    const [rohit] = (await (await find("rohit")).json<{ clients: unknown[] }>()).clients;
    expect(rohit).toMatchObject({ id: PERSON, state: "fitted", next_visit: "2026-09-25T04:30:00.000Z" });
  });

  it("finds clients by any four or more digits of their number, typed any of the usual ways", async () => {
    expect(await found("98100")).toEqual(["Rohit Malhotra", "Vikram Sethi"]);
    expect(await found("+91 98200-00003")).toEqual(["Rohini Sethi"]);
    expect(await found("098200 00003")).toEqual(["Rohini Sethi"]);
    expect(await found("0091 98200 00003")).toEqual(["Rohini Sethi"]);
  });

  it("treats a percent sign or an underscore as itself, not as a wildcard", async () => {
    expect(await found("%%")).toEqual([]);
    expect(await found("R_hit")).toEqual([]);
  });

  it("leaves out an erased client", async () => {
    await env.DB.prepare("UPDATE people SET erased_at = ?1 WHERE id = ?2").bind(NOW.toISOString(), OTHER).run();
    expect(await found("sethi")).toEqual(["Rohini Sethi"]);
  });

  it("lists a page at most, and says there are more", async () => {
    await env.DB.batch(
      Array.from({ length: CLIENTS_FOUND + 1 }, (_, n) =>
        env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, ?4)").bind(
          `77777777-7777-4777-8777-${String(n).padStart(12, "0")}`,
          NOW.toISOString(),
          `+9197000${String(n).padStart(5, "0")}`,
          `Kumar ${String(n).padStart(2, "0")}`,
        ),
      ),
    );
    const body = await (await find("kumar")).json<{ clients: unknown[]; more: boolean }>();
    expect(body.clients).toHaveLength(CLIENTS_FOUND);
    expect(body.more).toBe(true);
  });

  it("asks for two letters or four digits at least", async () => {
    for (const text of ["r", "981", "  "]) {
      const answer = await find(text);
      expect(answer.status, text).toBe(400);
      expect(await answer.json()).toMatchObject({ error: { code: "invalid_request", fields: ["text"] } });
    }
  });
});
