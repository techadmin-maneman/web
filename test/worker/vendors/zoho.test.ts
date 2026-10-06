import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "../../../src/log.ts";
import { createZohoLeadFinder, noteFor, recordFor } from "../../../src/providers/crm/zoho.ts";
import { crmLead } from "./crm-rules.test.ts";
import { NOW, captureLogs, fakeFetch, json } from "../helpers.ts";
import {
  SETTINGS,
  TOKEN_URL,
  LEADS_URL,
  SEARCH_URL,
  updated,
  noMatch,
  tokenIssued,
  zoho,
  bodyOf,
} from "./zoho-fixtures.ts";

const created = (id: string) => json({ data: [{ code: "SUCCESS", status: "success", details: { id } }] }, 201);

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

    const lines = logs.lines().filter((line) => line.event === "vendor_call");
    expect(lines.map(({ vendor, step, status, lead_id }) => ({ vendor, step, status, lead_id }))).toEqual([
      { vendor: "zoho-crm", step: "token", status: 200, lead_id: "lead-1" },
      { vendor: "zoho-crm", step: "search", status: 204, lead_id: "lead-1" },
      { vendor: "zoho-crm", step: "insert", status: 201, lead_id: "lead-1" },
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

  // ADR 0050 admits a stored ID the CRM no longer has blocked the person's sync for good.
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

describe("Zoho record and note contents", () => {
  it("never blanks booking details from a try-on", () => {
    const record = recordFor({
      lead: crmLead({ source: "tryon", city: null, firstChoiceWindow: null }),
      status: null,
      isNew: false,
    });
    expect(record).not.toHaveProperty("City");
    expect(record).not.toHaveProperty("Loss_Extent");
    expect(record).not.toHaveProperty("Proposed_Visit_Date");
  });

  // Zoho refuses a pick-list value it does not have, so the fields wait for scripts/ops/setup-crm.ts.
  describe("an invited friend's booking", () => {
    const invited = crmLead({ firstChoiceWindow: null, inviteCode: "RM7K2Q", askedWindow: "afternoon" });

    it("names the source, the invite and the window, once the org has the fields", () => {
      expect(recordFor({ lead: invited, status: "New", isNew: true, fields: { referral: true } })).toMatchObject({
        Lead_Source: "Referral",
        Referral_Code: "RM7K2Q",
        Booked_Window: "Afternoon",
      });
    });

    it("writes none of them while the org has not the fields, rather than have Zoho refuse the lead", () => {
      const record = recordFor({ lead: invited, status: "New", isNew: true, fields: { referral: false } });
      expect(record.Lead_Source).toBe("Booking form");
      expect(record).not.toHaveProperty("Referral_Code");
      expect(record).not.toHaveProperty("Booked_Window");
    });

    it("notes the window and the invite on a record the CRM already has, which needs no field", () => {
      expect(noteFor(invited)).toEqual({
        title: "New booking request",
        content: "Asked for a visit in Gurgaon, afternoon, proposed 2026-09-23. Came through an invite.",
      });
    });
  });

  // While booking is off, the lead carried neither the one visit nor the code given for it.
  describe("a consultation and fit in one visit, with a discount code", () => {
    const oneVisit = crmLead({ firstChoiceWindow: null, plan: "one_visit", discountCode: "TENPC" });

    it("says both in the record's Description", () => {
      expect(recordFor({ lead: oneVisit, status: "New", isNew: true }).Description).toBe(
        "Consultation and fit in one visit. Discount code TENPC.",
      );
      expect(recordFor({ lead: crmLead({ plan: "consultation" }), status: "New", isNew: true }).Description).toBe(
        "Consultation.",
      );
      expect(recordFor({ lead: crmLead(), status: "New", isNew: true })).not.toHaveProperty("Description");
    });

    it("notes the plan on a record the CRM already has, and never the code, which an erasure would keep", () => {
      expect(noteFor(oneVisit).content).toBe(
        "Asked for a visit in Gurgaon, proposed 2026-09-23. Consultation and fit in one visit.",
      );
    });
  });

  it("writes notes without personal data", () => {
    for (const source of ["form", "waitlist", "tryon"] as const) {
      const note = JSON.stringify(noteFor(crmLead({ source })));
      expect(note).not.toMatch(/Arjun|9810000001/);
    }
  });
});

describe("Zoho: the CRM's one read on its own", () => {
  it("finds a person's Lead by their person ID, answers null for one it does not have, and only reads", async () => {
    const http = fakeFetch({
      [TOKEN_URL]: () => tokenIssued(),
      [SEARCH_URL]: (call) =>
        decodeURIComponent(call.url).includes("(D1_Person_ID:equals:person-1)")
          ? json({ data: [{ id: "zoho-existing" }], info: { count: 1 } })
          : noMatch(),
    });
    const deps = { db: env.DB, fetch: http.fetch, now: () => NOW, log: createLogger() };
    const findLead = createZohoLeadFinder(SETTINGS, deps);

    expect(await findLead("person-1")).toBe("zoho-existing");
    expect(await findLead("person-2")).toBeNull();
    expect(http.calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      "POST /oauth/v2/token",
      "GET /crm/v8/Leads/search",
      "GET /crm/v8/Leads/search",
    ]);
  });
});
