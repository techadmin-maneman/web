import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { ZohoSettings } from "../../src/config/settings.ts";
import { createLogger } from "../../src/log.ts";
import { createZohoCrm, noteFor, recordFor } from "../../src/providers/zoho.ts";
import { crmLead } from "./crm-rules.test.ts";
import { NOW, captureLogs, fakeFetch, json, type RecordedCall } from "./helpers.ts";

const SETTINGS: ZohoSettings = {
  clientId: "1000.CLIENT",
  clientSecret: "client-secret",
  refreshToken: "1000.refresh",
  accountsHost: "accounts.zoho.in",
  apiHost: "www.zohoapis.in",
  larId: "lar-123",
};

const TOKEN_URL = "https://accounts.zoho.in/oauth/v2/token";
const LEADS_URL = "https://www.zohoapis.in/crm/v8/Leads";
const SEARCH_URL = "https://www.zohoapis.in/crm/v8/Leads/search";

const created = (id: string) => json({ data: [{ code: "SUCCESS", status: "success", details: { id } }] }, 201);
const updated = (id: string) => json({ data: [{ code: "SUCCESS", status: "success", details: { id } }] });
const noMatch = () => new Response(null, { status: 204 });
const tokenIssued = (token = "access-1") => json({ access_token: token, expires_in: 3600, token_type: "Bearer" });

function zoho(routes: Parameters<typeof fakeFetch>[0]) {
  const http = fakeFetch(routes);
  const crm = createZohoCrm(SETTINGS, { db: env.DB, fetch: http.fetch, now: () => NOW, log: createLogger() });
  return { crm, calls: http.calls };
}

function bodyOf(call: RecordedCall | undefined): Record<string, unknown> {
  return JSON.parse(call?.body ?? "{}") as Record<string, unknown>;
}

let logs: ReturnType<typeof captureLogs>;
beforeEach(() => {
  logs = captureLogs();
});

describe("Zoho: a person the CRM has not seen", () => {
  it("inserts a booking with the assignment rule and workflows, after checking it is not there already", async () => {
    const { crm, calls } = zoho({
      [TOKEN_URL]: () => tokenIssued(),
      [SEARCH_URL]: noMatch,
      [LEADS_URL]: () => created("zoho-1"),
    });

    const result = await crm.syncLead(crmLead(), null);

    expect(result).toEqual({ crmLeadId: "zoho-1", created: true });
    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      "POST /oauth/v2/token",
      "GET /crm/v8/Leads/search",
      "POST /crm/v8/Leads",
    ]);
    expect(decodeURIComponent(calls[1]?.url ?? "")).toContain("criteria=(D1_Person_ID:equals:person-1)");

    const insert = bodyOf(calls[2]);
    expect(insert.lar_id).toBe("lar-123");
    expect(insert.trigger).toEqual(["workflow"]);
    expect(insert.data).toEqual([
      {
        Last_Name: "Arjun Mehta",
        Mobile: "+919810000001",
        Contact_Consent: true,
        D1_Person_ID: "person-1",
        D1_Lead_ID: "lead-1",
        Lead_Status: "New",
        Lead_Source: "Booking form",
        City: "Gurgaon",
        First_Choice_Window: "Weekday morning",
        Loss_Extent: "Crown thinning",
        Proposed_Visit_Date: "2026-09-23",
      },
    ]);
    expect(calls[2]?.headers.get("Authorization")).toBe("Zoho-oauthtoken access-1");
  });

  it("logs each call's step, status and time against the lead, and never a URL or secret", async () => {
    const { crm } = zoho({
      [TOKEN_URL]: () => tokenIssued(),
      [SEARCH_URL]: noMatch,
      [LEADS_URL]: () => created("zoho-1"),
    });
    await crm.syncLead(crmLead(), null);

    const lines = logs.lines().filter((line) => line.event === "zoho_call");
    expect(lines.map(({ step, status, lead_id }) => ({ step, status, lead_id }))).toEqual([
      { step: "token", status: 200, lead_id: "lead-1" },
      { step: "search", status: 204, lead_id: "lead-1" },
      { step: "insert", status: 201, lead_id: "lead-1" },
    ]);
    expect(lines.every((line) => typeof line.duration_ms === "number")).toBe(true);
    expect(JSON.stringify(lines)).not.toMatch(/https:|client-secret|1000\.refresh|access-1/);
  });

  it("inserts a waitlist lead as Waitlist, unassigned", async () => {
    const { crm, calls } = zoho({
      [TOKEN_URL]: () => tokenIssued(),
      [SEARCH_URL]: noMatch,
      [LEADS_URL]: () => created("z"),
    });
    await crm.syncLead(crmLead({ source: "waitlist", city: "Mumbai", proposedVisitDate: null }), null);
    const insert = bodyOf(calls[2]);
    expect(insert.lar_id).toBeUndefined();
    expect((insert.data as Record<string, unknown>[])[0]).toMatchObject({ Lead_Status: "Waitlist", City: "Mumbai" });
  });

  it("inserts a try-on-only person as delivery-only, unassigned, with workflows off", async () => {
    const { crm, calls } = zoho({
      [TOKEN_URL]: () => tokenIssued(),
      [SEARCH_URL]: noMatch,
      [LEADS_URL]: () => created("z"),
    });
    await crm.syncLead(crmLead({ source: "tryon", contactable: false, tryOn: true, city: null }), null);
    const insert = bodyOf(calls[2]);
    expect(insert.lar_id).toBeUndefined();
    expect(insert.trigger).toEqual([]); // [] turns workflows off; leaving it out would run them
    expect((insert.data as Record<string, unknown>[])[0]).toMatchObject({
      Lead_Status: "Try-on — delivery only",
      Contact_Consent: false,
      Try_On: true,
    });
  });

  it("finds a record created by an earlier attempt instead of inserting a duplicate", async () => {
    const { crm, calls } = zoho({
      [TOKEN_URL]: () => tokenIssued(),
      [SEARCH_URL]: () => json({ data: [{ id: "zoho-existing" }], info: { count: 1 } }),
      [LEADS_URL]: () => updated("zoho-existing"),
    });
    const result = await crm.syncLead(crmLead(), null);
    expect(result).toEqual({ crmLeadId: "zoho-existing", created: false });
    expect(calls.some((call) => call.method === "POST" && call.url === LEADS_URL)).toBe(false);
  });
});

describe("Zoho: a person the CRM already has", () => {
  it("updates the record and adds a note, without searching", async () => {
    const { crm, calls } = zoho({ [TOKEN_URL]: () => tokenIssued(), [LEADS_URL]: () => updated("zoho-9") });
    const result = await crm.syncLead(crmLead(), "zoho-9");

    expect(result).toEqual({ crmLeadId: "zoho-9", created: false });
    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      "POST /oauth/v2/token",
      "PUT /crm/v8/Leads/zoho-9",
      "POST /crm/v8/Leads/zoho-9/Notes",
    ]);
    const update = bodyOf(calls[1]);
    expect((update.data as Record<string, unknown>[])[0]).toMatchObject({ Lead_Status: "New" });
    expect((update.data as Record<string, unknown>[])[0]).not.toHaveProperty("Lead_Source");
    expect(bodyOf(calls[2]).data).toEqual([
      {
        Note_Title: "New booking request",
        Note_Content: "Asked for a visit in Gurgaon, weekday morning, proposed 2026-09-23.",
      },
    ]);
  });

  // ADR 0050 admits a stored ID the CRM no longer has blocked the person's sync for good (audit INT-18).
  describe("whose record D1 knows by an ID the CRM no longer has", () => {
    const invalidId = () =>
      json({
        data: [
          {
            code: "INVALID_DATA",
            details: { api_name: "id" },
            message: "the id given seems to be invalid",
            status: "error",
          },
        ],
      });

    /** The CRM, where the stored "zoho-gone" is gone and the person's record, if any, is `current`. */
    function crmWhere(current: string | null) {
      return zoho({
        [TOKEN_URL]: () => tokenIssued(),
        [LEADS_URL]: (call) => {
          if (call.url.startsWith(SEARCH_URL)) return current === null ? noMatch() : json({ data: [{ id: current }] });
          if (call.url.includes("zoho-gone")) return invalidId();
          return call.method === "POST" && call.url === LEADS_URL ? created("zoho-new") : updated(current ?? "");
        },
      });
    }

    it("finds the person's record again by their ID, and writes to that", async () => {
      const { crm, calls } = crmWhere("zoho-merged");
      expect(await crm.syncLead(crmLead(), "zoho-gone")).toEqual({ crmLeadId: "zoho-merged", created: false });
      expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
        "POST /oauth/v2/token",
        "PUT /crm/v8/Leads/zoho-gone",
        "GET /crm/v8/Leads/search",
        "PUT /crm/v8/Leads/zoho-merged",
        "POST /crm/v8/Leads/zoho-merged/Notes",
      ]);
    });

    it("makes a new record when the CRM has none for the person", async () => {
      const { crm } = crmWhere(null);
      expect(await crm.syncLead(crmLead(), "zoho-gone")).toEqual({ crmLeadId: "zoho-new", created: true });
    });

    it("erases the record found again, or finds nothing to erase", async () => {
      expect(await crmWhere("zoho-merged").crm.erasePerson("person-1", "zoho-gone")).toEqual({ found: true });
      expect(await crmWhere(null).crm.erasePerson("person-1", "zoho-gone")).toEqual({ found: false });
    });

    it("passes on any other failure unchanged, without searching", async () => {
      const { crm, calls } = zoho({
        [TOKEN_URL]: () => tokenIssued(),
        [LEADS_URL]: () => json({ code: "INTERNAL_ERROR", message: "Internal Server Error" }, 500),
      });
      await expect(crm.syncLead(crmLead(), "zoho-9")).rejects.toThrow("Zoho 500 INTERNAL_ERROR");
      expect(calls.some((call) => call.url.startsWith(SEARCH_URL))).toBe(false);
    });
  });

  it("leaves the status alone for a waitlist sign-up", async () => {
    const { crm, calls } = zoho({ [TOKEN_URL]: () => tokenIssued(), [LEADS_URL]: () => updated("zoho-9") });
    await crm.syncLead(crmLead({ source: "waitlist" }), "zoho-9");
    expect((bodyOf(calls[1]).data as Record<string, unknown>[])[0]).not.toHaveProperty("Lead_Status");
  });
});

describe("Zoho: access tokens", () => {
  it("reuses a cached token until a minute before it expires", async () => {
    const first = zoho({ [TOKEN_URL]: () => tokenIssued("cached"), [LEADS_URL]: () => updated("z") });
    await first.crm.syncLead(crmLead(), "z");
    const second = zoho({ [TOKEN_URL]: () => tokenIssued("fresh"), [LEADS_URL]: () => updated("z") });
    await second.crm.syncLead(crmLead(), "z");

    expect(second.calls.some((call) => call.url.startsWith(TOKEN_URL))).toBe(false);
    expect(second.calls[0]?.headers.get("Authorization")).toBe("Zoho-oauthtoken cached");
  });

  it("refreshes once and repeats the call when Zoho rejects the token", async () => {
    let tokens = 0;
    let rejected = false;
    const { crm, calls } = zoho({
      [TOKEN_URL]: () => tokenIssued(`token-${String(++tokens)}`),
      [LEADS_URL]: () => {
        if (!rejected) {
          rejected = true;
          return json({ code: "INVALID_TOKEN", message: "invalid oauth token" }, 401);
        }
        return updated("z");
      },
    });
    await crm.syncLead(crmLead(), "z");
    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`).slice(0, 4)).toEqual([
      "POST /oauth/v2/token",
      "PUT /crm/v8/Leads/z", // rejected with 401
      "POST /oauth/v2/token",
      "PUT /crm/v8/Leads/z", // repeated with the new token
    ]);
    expect(calls[3]?.headers.get("Authorization")).toBe("Zoho-oauthtoken token-2");
  });

  it("fails with the refresh error when the refresh token has been revoked", async () => {
    const { crm } = zoho({ [TOKEN_URL]: () => json({ error: "invalid_code" }) });
    await expect(crm.syncLead(crmLead(), "z")).rejects.toThrow(
      "Zoho 200 invalid_code: could not refresh the access token",
    );
  });

  it("names the step that timed out", async () => {
    const { crm } = zoho({
      [TOKEN_URL]: () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      },
    });
    await expect(crm.syncLead(crmLead(), "z")).rejects.toThrow("Zoho 0 TIMEOUT: token got no answer within 20 s");
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({ event: "zoho_call", step: "token", status: 0, reason: "TimeoutError" }),
    );
  });

  it("passes on a network failure unchanged", async () => {
    const { crm } = zoho({
      [TOKEN_URL]: () => tokenIssued(),
      [LEADS_URL]: () => {
        throw new TypeError("Network connection lost.");
      },
    });
    await expect(crm.syncLead(crmLead(), "z")).rejects.toThrow("Network connection lost.");
  });

  it("names Zoho's error code, never the record, when a call fails", async () => {
    const { crm } = zoho({
      [TOKEN_URL]: () => tokenIssued(),
      [SEARCH_URL]: noMatch,
      [LEADS_URL]: () =>
        json(
          {
            data: [{ code: "INVALID_DATA", status: "error", message: "invalid data", details: { api_name: "Mobile" } }],
          },
          400,
        ),
    });
    const failure = crm.syncLead(crmLead(), null);
    await expect(failure).rejects.toThrow("Zoho 400 INVALID_DATA: invalid data");
    await expect(failure).rejects.not.toThrow(/9810000001|Arjun/);
  });
});

describe("Zoho record and note contents", () => {
  it("never blanks booking details from a try-on", () => {
    const record = recordFor(crmLead({ source: "tryon", city: null, firstChoiceWindow: null }), null, false);
    expect(record).not.toHaveProperty("City");
    expect(record).not.toHaveProperty("Loss_Extent");
    expect(record).not.toHaveProperty("Proposed_Visit_Date");
  });

  it("writes notes without personal data", () => {
    for (const source of ["form", "waitlist", "tryon"] as const) {
      const note = JSON.stringify(noteFor(crmLead({ source })));
      expect(note).not.toMatch(/Arjun|9810000001/);
    }
  });
});

describe("Zoho: erasing a person", () => {
  it("blanks the known record with workflows off and notes why, without searching", async () => {
    const { crm, calls } = zoho({ [TOKEN_URL]: () => tokenIssued(), [LEADS_URL]: () => updated("zoho-9") });

    expect(await crm.erasePerson("person-1", "zoho-9")).toEqual({ found: true });

    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      "POST /oauth/v2/token",
      "PUT /crm/v8/Leads/zoho-9",
      "POST /crm/v8/Leads/zoho-9/Notes",
    ]);
    expect(bodyOf(calls[1])).toEqual({
      data: [{ Last_Name: "Erased", Mobile: null, Email: null, Contact_Consent: false }],
      trigger: [],
    });
    expect(bodyOf(calls[2]).data).toEqual([
      { Note_Title: "Personal data erased", Note_Content: "Erased at the person's request." },
    ]);
  });

  it("finds the record by the person's ID when D1 never stored it", async () => {
    const { crm, calls } = zoho({
      [TOKEN_URL]: () => tokenIssued(),
      [SEARCH_URL]: () => json({ data: [{ id: "zoho-existing" }], info: { count: 1 } }),
      [LEADS_URL]: () => updated("zoho-existing"),
    });
    expect(await crm.erasePerson("person-1", null)).toEqual({ found: true });
    expect(decodeURIComponent(calls[1]?.url ?? "")).toContain("criteria=(D1_Person_ID:equals:person-1)");
    expect(calls[2]?.url).toBe(`${LEADS_URL}/zoho-existing`);
  });

  it("changes nothing when the CRM never had the person", async () => {
    const { crm, calls } = zoho({ [TOKEN_URL]: () => tokenIssued(), [SEARCH_URL]: noMatch });
    expect(await crm.erasePerson("person-1", null)).toEqual({ found: false });
    expect(calls).toHaveLength(2);
  });
});
