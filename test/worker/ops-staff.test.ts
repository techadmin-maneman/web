// The Staff page's routes (src/routes/ops/staff.ts): the list narrowed to the viewer's own places, a change only
// within the editor's Admin MANAGE, never a list left without Admin MANAGE nationally, the switch only for those who
// hold it, and every change audited under its maker.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { captureLogs, markDatabase, request } from "./helpers.ts";
import { allowToken, enforce, listStaff, opsAs, person, post, token } from "./staff-fixtures.ts";

const OWNER = "owner@maneman.in";
const NCR_ADMIN = "ncr.admin@maneman.in";

interface Book {
  enforced: { on: boolean; set_by: string | null };
  may_run_access: boolean;
  people: { email: string; active: boolean; grants: { department: string; place: string | null }[] }[];
  service_tokens: { client_id: string }[];
  zones: { name: string; cities: string[] }[];
  cities: string[];
}

const owner = () => opsAs(person(OWNER));
const ncrAdmin = () => opsAs(person(NCR_ADMIN));

const grant = (department: string, level: string, geography: string, place: string | null = null) => ({
  department,
  level,
  geography,
  place,
});

const audited = async (action: string) =>
  (
    await env.DB.prepare("SELECT actor, subject_id, detail FROM audit_log WHERE action = ?1 ORDER BY id")
      .bind(action)
      .all<{ actor: string; subject_id: string | null; detail: string | null }>()
  ).results;

const refusal = async (res: Response) => (await res.json<{ error: { code: string; fields?: string[] } }>()).error;

let logs: ReturnType<typeof captureLogs>;

beforeEach(async () => {
  logs = captureLogs();
  await markDatabase();
  await listStaff(OWNER, ["admin:manage:national", "finance:manage:national"]);
  await listStaff(NCR_ADMIN, ["admin:manage:zone:NCR"]);
  await listStaff("mumbai@maneman.in", ["growth:act:city:Mumbai"]);
  await allowToken("ci-token.access");
});

describe("GET /api/staff", () => {
  it("lists everyone, their grants, the tokens, and the zones with their cities", async () => {
    const book = await (await request(owner(), "/api/staff")).json<Book>();

    expect(book.enforced.on).toBe(false);
    expect(book.may_run_access).toBe(true);
    expect(book.people.map((each) => each.email)).toEqual(["mumbai@maneman.in", NCR_ADMIN, OWNER]);
    expect(book.people[1]?.grants).toEqual([grant("admin", "manage", "zone", "NCR")]);
    expect(book.service_tokens.map((each) => each.client_id)).toEqual(["ci-token.access"]);
    expect(book.zones).toEqual([{ name: "NCR", cities: ["Gurgaon", "Delhi", "Noida", "Faridabad", "Ghaziabad"] }]);
    expect(book.cities).toContain("Mumbai");
  });

  it("shows a zone's admin, once enforced, only the people in their zone and no service token", async () => {
    await enforce();
    const book = await (await request(ncrAdmin(), "/api/staff")).json<Book>();

    expect(book.people.map((each) => each.email)).toEqual([NCR_ADMIN]);
    expect(book.service_tokens).toEqual([]);
    expect(book.may_run_access).toBe(false);
  });
});

describe("POST /api/staff", () => {
  it("adds a member of staff under their e-mail in lower case, audited under the owner", async () => {
    const res = await post(owner(), "/api/staff", {
      email: "New.Lead@ManeMan.in",
      active: true,
      grants: [grant("operations", "act", "city", "Delhi"), grant("customer_care", "view", "zone", "NCR")],
    });

    expect(res.status).toBe(200);
    const added = (await res.json<Book>()).people.find((each) => each.email === "new.lead@maneman.in");
    expect(added?.grants.map((each) => each.place)).toEqual(["Delhi", "NCR"]);
    const [entry] = await audited("staff.set");
    expect(entry).toMatchObject({ actor: OWNER, subject_id: "new.lead@maneman.in" });
    expect(JSON.parse(entry?.detail ?? "{}")).toMatchObject({
      active: true,
      grants: "operations:act:city:Delhi;customer_care:view:zone:NCR",
      was_listed: false,
    });
  });

  it("replaces a member's grants whole", async () => {
    await post(owner(), "/api/staff", {
      email: "mumbai@maneman.in",
      active: true,
      grants: [grant("growth", "manage", "national")],
    });
    const grants = await env.DB.prepare(
      "SELECT department, level, geography, place FROM staff_grants WHERE email = 'mumbai@maneman.in'",
    ).all();
    expect(grants.results).toEqual([{ department: "growth", level: "manage", geography: "national", place: null }]);
  });

  it.each([
    ["a city no grant may name", [grant("finance", "view", "city", "Atlantis")], "grants.0.place"],
    ["a zone that does not exist", [grant("finance", "view", "zone", "South")], "grants.0.place"],
    ["a place on a national grant", [grant("finance", "view", "national", "Delhi")], "grants.0.place"],
    ["no place on a city grant", [grant("finance", "view", "city")], "grants.0.place"],
    [
      "one department's place twice",
      [grant("finance", "view", "city", "Delhi"), grant("finance", "act", "city", "Delhi")],
      "grants.1",
    ],
  ])("refuses %s", async (_label, grants, field) => {
    const res = await post(owner(), "/api/staff", { email: "lead@maneman.in", active: true, grants });
    expect(res.status).toBe(400);
    expect(await refusal(res)).toMatchObject({ code: "invalid_request", fields: [field] });
  });

  describe("once enforced", () => {
    beforeEach(async () => {
      await enforce();
    });

    it("lets a zone's admin grant within the zone", async () => {
      const res = await post(ncrAdmin(), "/api/staff", {
        email: "noida@maneman.in",
        active: true,
        grants: [grant("finance", "act", "city", "Noida")],
      });
      expect(res.status).toBe(200);
    });

    it("refuses a zone's admin a grant beyond the zone, or a switch-off of someone beyond it", async () => {
      const beyond = await post(ncrAdmin(), "/api/staff", {
        email: "noida@maneman.in",
        active: true,
        grants: [grant("finance", "act", "city", "Mumbai")],
      });
      expect(beyond.status).toBe(403);
      const switchOff = await post(ncrAdmin(), "/api/staff", {
        email: "mumbai@maneman.in",
        active: false,
        grants: [grant("growth", "act", "city", "Mumbai")],
      });
      expect(switchOff.status).toBe(403);
      expect(await audited("staff.set")).toEqual([]);
    });
  });

  it("refuses a service token, even before the list is enforced: a grant is given by a person", async () => {
    const res = await post(opsAs(token("ci-token.access")), "/api/staff", {
      email: "planted@maneman.in",
      active: true,
      grants: [grant("admin", "manage", "national")],
    });
    expect(res.status).toBe(403);
    expect((await refusal(res)).code).toBe("not_permitted");
    expect(await audited("staff.set")).toEqual([]);
  });

  it("only logs a change beyond the editor's places while the list is not enforced", async () => {
    const res = await post(ncrAdmin(), "/api/staff", {
      email: "noida@maneman.in",
      active: true,
      grants: [grant("finance", "act", "city", "Mumbai")],
    });
    expect(res.status).toBe(200);
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({ event: "staff_access_would_refuse", asked: "admin:manage:places" }),
    );
  });

  it("never leaves the list without Admin MANAGE nationally", async () => {
    const res = await post(owner(), "/api/staff", {
      email: OWNER,
      active: false,
      grants: [grant("admin", "manage", "national")],
    });
    expect(res.status).toBe(409);
    expect((await refusal(res)).code).toBe("last_admin");
    const kept = await env.DB.prepare("SELECT active FROM staff WHERE email = ?1").bind(OWNER).first();
    expect(kept).toEqual({ active: 1 });
  });
});

describe("POST /api/staff/enforcement", () => {
  it("is switched by a person with Admin MANAGE nationally, and audited", async () => {
    const res = await post(owner(), "/api/staff/enforcement", { on: true });
    expect(res.status).toBe(200);
    expect((await res.json<Book>()).enforced).toMatchObject({ on: true, set_by: OWNER });
    expect(await audited("staff.enforce")).toEqual([
      { actor: OWNER, subject_id: null, detail: JSON.stringify({ enforced: true }) },
    ]);
  });

  it("is refused to anyone else, even before it is on, so nobody can lock themselves out", async () => {
    expect((await post(ncrAdmin(), "/api/staff/enforcement", { on: true })).status).toBe(403);
    expect((await post(opsAs(token("ci-token.access")), "/api/staff/enforcement", { on: true })).status).toBe(403);
    const mode = await env.DB.prepare("SELECT enforced FROM staff_access_mode").first();
    expect(mode).toEqual({ enforced: 0 });
  });
});

describe("service tokens", () => {
  it("are let in and taken off, each audited", async () => {
    const added = await post(owner(), "/api/staff/service-tokens", { client_id: "audit-tool.access", label: "Audit" });
    expect((await added.json<Book>()).service_tokens.map((each) => each.client_id)).toEqual([
      "audit-tool.access",
      "ci-token.access",
    ]);
    const removed = await post(owner(), "/api/staff/service-tokens/remove", { client_id: "ci-token.access" });
    expect((await removed.json<Book>()).service_tokens.map((each) => each.client_id)).toEqual(["audit-tool.access"]);
    expect((await audited("staff.token_add")).map((entry) => entry.subject_id)).toEqual(["audit-tool.access"]);
    expect((await audited("staff.token_remove")).map((entry) => entry.subject_id)).toEqual(["ci-token.access"]);
  });

  it("are changed only by a person with Admin MANAGE nationally, even before the list is enforced", async () => {
    const byToken = await post(opsAs(token("ci-token.access")), "/api/staff/service-tokens", {
      client_id: "second-ci.access",
      label: "Planted",
    });
    expect(byToken.status).toBe(403);
    const byZoneAdmin = await post(ncrAdmin(), "/api/staff/service-tokens/remove", { client_id: "ci-token.access" });
    expect(byZoneAdmin.status).toBe(403);
    const tokens = await env.DB.prepare("SELECT client_id FROM staff_service_tokens").all();
    expect(tokens.results).toEqual([{ client_id: "ci-token.access" }]);
    expect(await audited("staff.token_add")).toEqual([]);
  });

  it("answers 404 for a token not listed", async () => {
    const res = await post(owner(), "/api/staff/service-tokens/remove", { client_id: "nobody.access" });
    expect(res.status).toBe(404);
  });
});
