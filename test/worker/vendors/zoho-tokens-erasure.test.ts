import { beforeEach, describe, expect, it } from "vitest";
import { contactRecordFor } from "../../../src/providers/crm/zoho.ts";
import { crmLead } from "./crm-rules.test.ts";
import { captureLogs, json } from "../helpers.ts";
import { TOKEN_URL, LEADS_URL, SEARCH_URL, updated, noMatch, tokenIssued, zoho, bodyOf } from "./zoho-fixtures.ts";

let logs: ReturnType<typeof captureLogs>;

beforeEach(() => {
  logs = captureLogs();
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
    await expect(crm.syncLead(crmLead(), "z")).rejects.toThrow("Zoho CRM 0 TIMEOUT: token got no answer within 20 s");
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({
        event: "vendor_call",
        vendor: "zoho-crm",
        step: "token",
        status: 0,
        reason: "TimeoutError",
      }),
    );
  });

  it("names the step that could not be reached, as a failure tried again rather than a refusal", async () => {
    const { crm } = zoho({
      [TOKEN_URL]: () => tokenIssued(),
      [LEADS_URL]: () => {
        throw new TypeError("Network connection lost.");
      },
    });
    const failure = crm.syncLead(crmLead(), "z");
    await expect(failure).rejects.toThrow("Zoho CRM 0 UNREACHABLE: update could not be reached (TypeError)");
    await expect(failure).rejects.toMatchObject({ code: "UNREACHABLE", refusal: false });
  });

  // An answer that failed our schema reached ops as a bare zod dump naming neither the step nor the answer.
  it("names where a search answer differs from what is read, and none of its values", async () => {
    const { crm } = zoho({
      [TOKEN_URL]: () => tokenIssued(),
      [SEARCH_URL]: () => json({ data: [{ Last_Name: "Arjun Mehta" }] }),
    });
    await expect(crm.syncLead(crmLead(), null)).rejects.toThrow(
      "Zoho 200 UNEXPECTED_ANSWER: search: data.0.id: Invalid input: expected string, received undefined; " +
        "data.0 has keys Last_Name",
    );
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

describe("Zoho: a person's changed number, address or invite", () => {
  const CONTACT = {
    personId: "person-1",
    mobileE164: "+919810000003",
    city: "Gurgaon",
    inviteCode: null,
    inviteAttached: false,
  };

  it("writes the number and city onto the known record, with workflows off, and adds no note", async () => {
    const { crm, calls } = zoho({ [TOKEN_URL]: () => tokenIssued(), [LEADS_URL]: () => updated("zoho-9") });
    expect(await crm.updateContact(CONTACT, "zoho-9")).toEqual({ crmLeadId: "zoho-9" });
    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      "POST /oauth/v2/token",
      "PUT /crm/v8/Leads/zoho-9",
    ]);
    expect(bodyOf(calls[1])).toEqual({ data: [{ Mobile: "+919810000003", City: "Gurgaon" }], trigger: [] });
  });

  it("writes nothing for a person the CRM never had", async () => {
    const { crm, calls } = zoho({ [TOKEN_URL]: () => tokenIssued(), [SEARCH_URL]: noMatch });
    expect(await crm.updateContact({ ...CONTACT, city: null }, null)).toEqual({ crmLeadId: null });
    expect(calls).toHaveLength(2);
  });

  // A note needs no field of the org's, so an invite ops attach reaches the record while the referral fields do not
  // exist, as a new lead's invite does (noteFor). It names no one, and no code, as every note: an erasure keeps notes.
  it("notes an invite ops just attached, whether or not the org has the referral fields", async () => {
    const { crm, calls } = zoho({ [TOKEN_URL]: () => tokenIssued(), [LEADS_URL]: () => updated("zoho-9") });
    await crm.updateContact({ ...CONTACT, inviteCode: "VSAB23", inviteAttached: true }, "zoho-9");
    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      "POST /oauth/v2/token",
      "PUT /crm/v8/Leads/zoho-9",
      "POST /crm/v8/Leads/zoho-9/Notes",
    ]);
    expect(bodyOf(calls[2]).data).toEqual([
      { Note_Title: "Invite attached", Note_Content: "Came through a friend's invite, which ops attached by hand." },
    ]);
  });

  it("adds no note for a person who carries an invite and changed only their number or address", async () => {
    const { crm, calls } = zoho({ [TOKEN_URL]: () => tokenIssued(), [LEADS_URL]: () => updated("zoho-9") });
    await crm.updateContact({ ...CONTACT, inviteCode: "VSAB23" }, "zoho-9");
    expect(calls.map((call) => call.method)).toEqual(["POST", "PUT"]);
  });

  // An invite ops attached (ADR 0089), in the field the org gains with scripts/ops/setup-crm.ts (src/config/crm.ts).
  it("writes the invite's code once the org has the referral fields, and nothing of it before", () => {
    const invited = { ...CONTACT, inviteCode: "VSAB23" };
    expect(contactRecordFor(invited, { referral: true })).toEqual({
      Mobile: "+919810000003",
      City: "Gurgaon",
      Referral_Code: "VSAB23",
    });
    expect(contactRecordFor(invited, { referral: false })).toEqual({ Mobile: "+919810000003", City: "Gurgaon" });
    expect(contactRecordFor({ ...CONTACT, city: null }, { referral: true })).toEqual({ Mobile: "+919810000003" });
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
      data: [{ Last_Name: "Erased", Mobile: null, Email: null, Contact_Consent: false, Description: null }],
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

describe("Zoho: erasing a client's Contact", () => {
  const CONTACTS_URL = "https://www.zohoapis.in/crm/v8/Contacts";

  it("blanks every field that could say who they were, with workflows off, then deletes it", async () => {
    const { crm, calls } = zoho({ [TOKEN_URL]: () => tokenIssued(), [CONTACTS_URL]: () => updated("contact-9") });

    expect(await crm.eraseContact("contact-9")).toEqual({ found: true });

    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      "POST /oauth/v2/token",
      "PUT /crm/v8/Contacts/contact-9",
      "DELETE /crm/v8/Contacts/contact-9",
    ]);
    const [blank = {}] = bodyOf(calls[1]).data as Record<string, unknown>[];
    expect(bodyOf(calls[1]).trigger).toEqual([]);
    expect(blank).toMatchObject({ First_Name: null, Mobile: null, Email: null, Mailing_Street: null, Other_Zip: null });
    expect(Object.entries(blank).filter(([, value]) => value !== null)).toEqual([
      ["Last_Name", "Erased"],
      ["Email_Opt_Out", true],
    ]);
  });

  it("finds nothing to erase where the CRM no longer has the Contact, and deletes nothing", async () => {
    const gone = () =>
      json({
        data: [{ code: "INVALID_DATA", status: "error", message: "the id given seems to be invalid", details: {} }],
      });
    const { crm, calls } = zoho({ [TOKEN_URL]: () => tokenIssued(), [CONTACTS_URL]: gone });

    expect(await crm.eraseContact("contact-gone")).toEqual({ found: false });
    expect(calls.filter((call) => call.method === "DELETE")).toEqual([]);
  });

  it("passes on a token without the Contacts scopes, so the erasure is tried again and then told", async () => {
    const refused = () =>
      json({ code: "OAUTH_SCOPE_MISMATCH", message: "invalid oauth scope to access this URL", status: "error" }, 401);
    const { crm } = zoho({ [TOKEN_URL]: () => tokenIssued(), [CONTACTS_URL]: refused });

    await expect(crm.eraseContact("contact-9")).rejects.toThrow("OAUTH_SCOPE_MISMATCH");
  });
});
