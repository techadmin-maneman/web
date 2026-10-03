// The Staff list on every ops call (src/http/staff-access.ts): a route asks for a department at a level, nationally
// until it keeps to the caller's own cities; a person not on the list is refused once it is enforced; and before that
// nothing is refused, but what would have been is logged.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { ROUTE_NEEDS } from "../../src/policy/console-routes.ts";
import type { AccessIdentity } from "../../src/providers/cloudflare-access.ts";
import { captureLogs, markDatabase, request } from "./helpers.ts";
import { allowToken, enforce, listStaff, opsAs, person, post, token } from "./staff-fixtures.ts";

const CASE = "6a000000-0000-4000-8000-000000000001";

let logs: ReturnType<typeof captureLogs>;

beforeEach(async () => {
  logs = captureLogs();
  await markDatabase();
});

const errorCode = async (res: Response) => (await res.json<{ error: { code: string } }>()).error.code;

describe("while the Staff list is not enforced", () => {
  it("refuses nobody Access lets in, and logs what it would have refused", async () => {
    const res = await request(opsAs(person("stranger@maneman.in")), "/api/grievances");

    expect(res.status).toBe(200);
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({
        event: "staff_access_would_refuse",
        route: "/api/grievances",
        asked: "customer_care:view",
        caller: "person",
      }),
    );
  });

  it("logs nothing for a call the caller's grants reach", async () => {
    await listStaff("care@maneman.in", ["customer_care:view:national"]);
    expect((await request(opsAs(person("care@maneman.in")), "/api/grievances")).status).toBe(200);
    expect(logs.lines().filter((line) => line.event === "staff_access_would_refuse")).toEqual([]);
  });
});

describe("once the Staff list is enforced", () => {
  beforeEach(async () => {
    await enforce();
  });

  it("refuses a person not on the list, having audited the call", async () => {
    const res = await request(opsAs(person("stranger@maneman.in")), "/api/grievances");

    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("not_permitted");
    const audited = await env.DB.prepare("SELECT actor FROM audit_log WHERE action = 'ops.call'").all();
    expect(audited.results).toEqual([{ actor: "stranger@maneman.in" }]);
    expect(logs.lines()).toContainEqual(expect.objectContaining({ event: "staff_access_refused" }));
  });

  it("refuses a person switched off, whatever they hold", async () => {
    await listStaff("gone@maneman.in", ["customer_care:manage:national"], false);
    expect((await request(opsAs(person("gone@maneman.in")), "/api/grievances")).status).toBe(403);
  });

  it("opens a department's routes at the level granted, and no further", async () => {
    await listStaff("care@maneman.in", ["customer_care:view:national"]);
    const care = opsAs(person("care@maneman.in"));

    expect((await request(care, "/api/grievances")).status).toBe(200);
    const answering = await post(care, `/api/grievances/${CASE}/resolve`, { response: "Sorted on the phone." });
    expect(answering.status).toBe(403);
    expect((await request(care, "/api/dispatch")).status).toBe(403);
  });

  it("opens to a grant of one city or zone only the routes that keep to the caller's cities", async () => {
    await listStaff("delhi@maneman.in", ["customer_care:manage:city:Delhi", "admin:view:zone:NCR"]);
    const delhi = opsAs(person("delhi@maneman.in"));

    expect((await request(delhi, "/api/settings")).status).toBe(403);
    expect((await request(delhi, "/api/staff")).status).toBe(200);
    expect((await request(delhi, "/api/grievances")).status).toBe(200);
  });

  it("lets a listed service token in as before, and refuses one not listed", async () => {
    await allowToken("ci-token.access");
    expect((await request(opsAs(token("ci-token.access")), "/api/settings")).status).toBe(200);
    expect((await request(opsAs(token("other-token.access")), "/api/settings")).status).toBe(403);
  });

  it("answers who is signed in, and the health check, to anyone Access lets in", async () => {
    const stranger = opsAs(person("stranger@maneman.in"));
    expect((await request(stranger, "/api/health")).status).toBe(200);
    const whoami = await request(stranger, "/api/whoami");
    expect(whoami.status).toBe(200);
    expect(await whoami.json()).toMatchObject({ staff: { enforced: true, listed: false, grants: [] } });
  });

  it("answers HEAD as it answers GET, so a probe of the health check is not refused", async () => {
    await listStaff("care@maneman.in", ["customer_care:view:national"]);
    const head = (identity: AccessIdentity, path: string) =>
      opsAs(identity).request(`https://maneman.test${path}`, { method: "HEAD" }, env);

    expect((await head(person("stranger@maneman.in"), "/api/health")).status).toBe(200);
    expect((await head(person("care@maneman.in"), "/api/grievances")).status).toBe(200);
    expect((await head(person("care@maneman.in"), "/api/dispatch")).status).toBe(403);
  });

  it("refuses a path no route answers, as it refuses any route the table does not list", async () => {
    await listStaff("owner@maneman.in", ["admin:manage:national"]);
    expect((await request(opsAs(person("owner@maneman.in")), "/api/nowhere")).status).toBe(403);
  });

  it("asks Finance MANAGE to waive a no-show's charge, where ACT may charge it", async () => {
    await listStaff("money@maneman.in", ["finance:act:national"]);
    const money = opsAs(person("money@maneman.in"));

    const waived = await post(money, `/api/no-shows/${CASE}/decision`, { decision: "waived", reason: "Unwell." });
    expect(waived.status).toBe(403);
    expect(await errorCode(waived)).toBe("not_permitted");
    // Charging is ACT's: past the Staff list, the case itself is not there.
    const charged = await post(money, `/api/no-shows/${CASE}/decision`, { decision: "charged", reason: "No answer." });
    expect(charged.status).toBe(404);
  });

  it("asks Finance MANAGE to refund a disputed charge, where ACT may uphold it", async () => {
    await listStaff("money@maneman.in", ["finance:act:national"]);
    const money = opsAs(person("money@maneman.in"));

    const refunded = await post(money, `/api/no-shows/disputes/${CASE}/ruling`, {
      ruling: "refunded",
      reason: "The technician was late.",
    });
    expect(refunded.status).toBe(403);
    const upheld = await post(money, `/api/no-shows/disputes/${CASE}/ruling`, {
      ruling: "upheld",
      reason: "The check-in shows the wait.",
    });
    expect(upheld.status).toBe(404);
  });
});

describe("GET /api/whoami", () => {
  it("names the caller's grants, and whether the list is enforced", async () => {
    await listStaff("lead@maneman.in", ["operations:act:zone:NCR"]);
    const res = await request(opsAs(person("lead@maneman.in")), "/api/whoami");
    expect(await res.json()).toMatchObject({
      signed_in_as: "lead@maneman.in",
      staff: {
        enforced: false,
        listed: true,
        grants: [{ department: "operations", level: "act", geography: "zone", place: "NCR" }],
      },
    });
  });

  const mayCall = async (identity: AccessIdentity): Promise<string[]> => {
    const res = await request(opsAs(identity), "/api/whoami");
    return (await res.json<{ staff: { may_call: string[] } }>()).staff.may_call;
  };

  it("lets every call go ahead while the list is not enforced, whoever asks", async () => {
    expect(await mayCall(person("stranger@maneman.in"))).toEqual(Object.keys(ROUTE_NEEDS));
  });

  it("names, once enforced, only the routes the caller's grants reach, as the calls themselves find", async () => {
    await enforce();
    await listStaff("money@maneman.in", ["finance:view:national"]);
    const routes = await mayCall(person("money@maneman.in"));

    expect(routes).toEqual(
      expect.arrayContaining(["GET /api/health", "GET /api/whoami", "GET /api/no-shows", "GET /api/services"]),
    );
    expect(routes).not.toContain("POST /api/prices");
    expect(routes).not.toContain("GET /api/dispatch");
    const money = opsAs(person("money@maneman.in"));
    expect((await request(money, "/api/services")).status).toBe(200);
    expect((await request(money, "/api/dispatch")).status).toBe(403);
  });

  it("names the Staff list to a city's Admin, which keeps to their places, and not the national settings", async () => {
    await enforce();
    await listStaff("delhi.admin@maneman.in", ["admin:view:city:Delhi"]);
    const routes = await mayCall(person("delhi.admin@maneman.in"));
    expect(routes).toContain("GET /api/staff");
    expect(routes).not.toContain("GET /api/settings");
  });

  it("names nothing but who is signed in and the health check to a person not on the enforced list", async () => {
    await enforce();
    expect(await mayCall(person("stranger@maneman.in"))).toEqual(["GET /api/health", "GET /api/whoami"]);
  });
});
