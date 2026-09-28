// The Zoho FSM client (src/providers/fsm-zoho.ts) against FSM's own replies,
// recorded in the shapes the org answers: the calls test/worker/fsm.test.ts
// leaves out, the sparse records FSM sends for a field nobody filled, and each
// refusal the client names rather than passes on. Branch coverage here was 51%
// (TCD-03), mostly the pieces' calls and these paths.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { ZohoFsmSettings } from "../../src/config/settings.ts";
import { createLogger } from "../../src/log.ts";
import { createFsmProvider } from "../../src/providers/fsm.ts";
import { FSM_API, ZOHO_TOKEN_URL, fsmUserRecord } from "./fsm-fixtures.ts";
import { NOW, fakeFetch, json } from "./helpers.ts";

const SETTINGS: ZohoFsmSettings = {
  clientId: "1000.FSMCLIENT",
  clientSecret: "fsm-client-secret",
  refreshToken: "1000.fsm-refresh",
  accountsHost: "accounts.zoho.in",
  apiHost: "www.zohoapis.in",
  booksOrgId: "60088931635",
  webhookToken: null,
  booksRefundAccountId: null,
};

const TOKEN = { [ZOHO_TOKEN_URL]: () => json({ access_token: "fsm-access-1", expires_in: 3600 }) };
const empty = () => new Response(null, { status: 204 });
const territories = () => json({ data: [{ id: "territory-1", Name: "Gurgaon" }] });
const addresses = () =>
  json({ data: [{ id: "contact-1", Service_Address: { id: "sa-1" }, Billing_Address: { id: "ba-1" } }] });

function fsm(routes: Parameters<typeof fakeFetch>[0]) {
  const http = fakeFetch({ ...TOKEN, ...routes });
  const deps = { db: env.DB, fetch: http.fetch, now: () => NOW, log: createLogger() };
  return { provider: createFsmProvider("zoho", SETTINGS, deps), calls: http.calls };
}

/** The bodies of the writes that reached FSM, in order. */
const writes = (calls: ReturnType<typeof fsm>["calls"]) =>
  calls
    .filter((call) => call.method !== "GET" && call.url.startsWith(FSM_API))
    .map((call) => JSON.parse(call.body) as unknown);

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM zoho_access_tokens").run();
});

describe("FSM: a client's pieces, as assets", () => {
  it("lists a contact's assets, the latest fitted first, with what FSM left empty as nothing", async () => {
    const { provider, calls } = fsm({
      [`${FSM_API}/Assets`]: () =>
        json({
          data: [
            {
              id: "asset-old",
              Asset_Number: "MM-STD-4417-A",
              Contact: { id: "contact-1" },
              Product: { id: "part-standard", name: "Standard base" },
              Serial_Number: "LOT-1",
              Installation_Date: "2026-03-25",
              Status: "Inactive",
              Modified_Time: "2026-06-01T10:00:00+05:30",
            },
            // An asset made in FSM's own screen, with only a name and nothing else filled.
            { id: "asset-bare", Asset_Name: "Made by hand" },
            {
              id: "asset-new",
              Asset_Number: "MM-STD-4417-B",
              Contact: { id: "contact-1" },
              Product: { id: "part-standard" },
              Installation_Date: "2026-09-21",
              Modified_Time: "2026-09-21T10:00:00+05:30",
            },
          ],
        }),
    });

    const assets = await provider.assets("contact-1");

    expect(assets.map((asset) => asset.id)).toEqual(["asset-new", "asset-old", "asset-bare"]);
    expect(assets[2]).toEqual({
      id: "asset-bare",
      assetNumber: "Made by hand",
      contactId: null,
      productId: null,
      productName: null,
      serialNumber: null,
      installedAt: null,
      status: null,
      modifiedAt: "",
    });
    expect(assets[0]).toMatchObject({ productName: null, serialNumber: null, status: null });
    expect(calls.at(-1)?.url).toBe(`${FSM_API}/Assets?contact=contact-1&per_page=200`);
  });

  it("reads a contact with no assets as none", async () => {
    const { provider } = fsm({ [`${FSM_API}/Assets`]: empty });
    expect(await provider.assets("contact-1")).toEqual([]);
  });

  it("records a piece with its lot as the serial number, and leaves the field out when there is no lot", async () => {
    const { provider, calls } = fsm({
      [`${FSM_API}/Assets`]: () => json({ data: { Assets: [{ id: "asset-9" }] } }, 201),
    });
    const piece = {
      contactId: "contact-1",
      assetNumber: "MM-STD-5520-A",
      productId: "part-standard",
      installedAt: "2026-09-21",
    };

    expect(await provider.createAsset({ ...piece, serialNumber: "LOT-2026-09" })).toBe("asset-9");
    await provider.createAsset({ ...piece, serialNumber: null });

    const [withLot, withoutLot] = writes(calls);
    expect(withLot).toEqual({
      data: [
        {
          Asset_Name: "MM-STD-5520-A",
          Asset_Number: "MM-STD-5520-A",
          Contact: "contact-1",
          Product: "part-standard",
          Serial_Number: "LOT-2026-09",
          Installation_Date: "2026-09-21",
        },
      ],
    });
    expect(withoutLot).not.toHaveProperty("data.0.Serial_Number");
  });

  it("marks a piece inactive, and writes no field it was not given", async () => {
    const { provider, calls } = fsm({ [`${FSM_API}/Assets/asset-old`]: () => json({ data: [{ code: "SUCCESS" }] }) });

    await provider.updateAsset("asset-old", { status: "Inactive" });
    await provider.updateAsset("asset-old", {});

    expect(writes(calls)).toEqual([{ data: [{ Status: "Inactive" }] }, { data: [{}] }]);
    expect(calls.at(-1)?.method).toBe("PUT");
  });
});

describe("FSM: records with fields nobody filled", () => {
  it("reads an appointment with nothing but its name, status and last change", async () => {
    const { provider } = fsm({
      [`${FSM_API}/Service_Appointments/ap-bare`]: () =>
        json({
          data: [{ id: "ap-bare", Name: "AP-9", Status: "Scheduled", Modified_Time: "2026-09-21T10:00:00+05:30" }],
        }),
    });

    expect(await provider.appointment("ap-bare")).toEqual({
      id: "ap-bare",
      name: "AP-9",
      status: "Scheduled",
      workOrderId: null,
      contactId: null,
      scheduledStart: null,
      scheduledEnd: null,
      actualStart: null,
      actualEnd: null,
      technicianIds: [],
      serviceIds: [],
      serviceCity: null,
      servicePincode: null,
      modifiedAt: "2026-09-21T10:00:00+05:30",
    });
  });

  it("reads a client with no full name by their first and last, and a phone where there is no mobile", async () => {
    const { provider } = fsm({
      [`${FSM_API}/Contacts/contact-3`]: () =>
        json({ data: [{ id: "contact-3", First_Name: "Neha", Last_Name: "Kapoor", Phone: "+919810000003" }] }),
      [`${FSM_API}/Contacts/contact-4`]: empty,
    });

    expect(await provider.contact("contact-3")).toEqual({
      id: "contact-3",
      name: "Neha Kapoor",
      mobile: "+919810000003",
      email: null,
      booksCustomerId: null,
    });
    expect(await provider.contact("contact-4")).toBeNull();
  });

  it("names a technician by his resource when his user has no name, and by nothing when neither has", async () => {
    const { provider } = fsm({
      [`${FSM_API}/users`]: () =>
        json({
          users: [
            fsmUserRecord({ full_name: null, Service_Resources: { id: "sr-1", isActive: true, Name: "Imran K" } }),
            fsmUserRecord({ id: "user-2", full_name: null, Service_Resources: { id: "sr-2", isActive: true } }),
          ],
        }),
    });

    expect((await provider.technicians()).map((technician) => technician.name)).toEqual(["Imran K", ""]);
  });

  it("gives a contact made from a booking with no street, state or e-mail only what it has", async () => {
    const { provider, calls } = fsm({
      [`${FSM_API}/Territories`]: territories,
      [`${FSM_API}/Contacts`]: () => json({ data: { Contacts: [{ id: "contact-9" }] } }, 201),
    });

    await provider.createContact({
      firstName: null,
      lastName: "Kapoor",
      mobile: "+919810000003",
      email: "neha@example.com",
      city: "Gurgaon",
      pincode: null,
      street: null,
      state: null,
      stateCode: null,
    });

    const [contact] = writes(calls);
    expect(contact).toEqual({
      data: [
        {
          Last_Name: "Kapoor",
          Mobile: "+919810000003",
          Email: "neha@example.com",
          GST_Treatment: "consumer",
          Service_Address: {
            Address_Name: "Service Address",
            Street_1: "To be confirmed with the client",
            City: "Gurgaon",
            Country: "India",
            Territory: "territory-1",
          },
          Billing_Address: "$SUBLOOKUP_Service_Address",
        },
      ],
    });
  });

  it("writes the day a client asked for on the Request, as its preference and its due date", async () => {
    const { provider, calls } = fsm({
      [`${FSM_API}/Contacts/contact-1`]: addresses,
      [`${FSM_API}/Requests`]: () => json({ data: { Requests: [{ id: "req-9" }] } }, 201),
    });

    await provider.createRequest({
      contactId: "contact-1",
      summary: "Consultation for Neha Kapoor",
      serviceId: "item-consult",
      preferredDate: "2026-09-24",
      preferenceNote: "Afternoon",
      reference: "lead-9",
    });

    expect(writes(calls)[0]).toMatchObject({
      data: [{ Preference: { Preferred_Date_1: "2026-09-24" }, Due_Date: "2026-09-24" }],
    });
  });
});

// A part's create has not been read on the org (docs/decisions/0087-consumables-and-stock.md), so the ID is taken from
// each shape FSM's creates answer in, and an answer with none is a failure rather than a part with no ID.
describe("FSM: a consumable added as a part", () => {
  it.each([
    ["a list of new records", { data: [{ id: "part-7" }] }],
    ["the records under the module's name", { data: { Service_And_Parts: [{ id: "part-7" }] } }],
    ["the records under the items' other name", { data: { Products: [{ id: "part-7" }] } }],
  ])("reads the new ID from %s", async (_, answer) => {
    const { provider } = fsm({ [`${FSM_API}/Service_And_Parts`]: () => json(answer, 201) });
    expect(await provider.createPart("Solvent")).toBe("part-7");
  });

  it("fails a part FSM answered without its ID, so the next hour looks for it by name", async () => {
    const { provider } = fsm({ [`${FSM_API}/Service_And_Parts`]: () => json({ data: [{ code: "SUCCESS" }] }, 201) });
    await expect(provider.createPart("Solvent")).rejects.toThrow(/NO_ID: create_part answered without the new ID/);
  });

  it("names FSM's refusal of a part", async () => {
    const { provider } = fsm({
      [`${FSM_API}/Service_And_Parts`]: () =>
        json({ data: [{ code: "DUPLICATE_DATA", message: "duplicate data", status: "error" }] }, 400),
    });
    await expect(provider.createPart("Solvent")).rejects.toThrow(/400/);
  });
});

describe("FSM: refusals the client names instead of passing on", () => {
  it("fails a create FSM answered without the new record's ID", async () => {
    const { provider } = fsm({ [`${FSM_API}/Assets`]: () => json({ data: { Assets: [] } }, 201) });
    const piece = {
      contactId: "contact-1",
      assetNumber: "MM-STD-5520-A",
      productId: "part-standard",
      serialNumber: null,
      installedAt: "2026-09-21",
    };
    await expect(provider.createAsset(piece)).rejects.toThrow(/NO_ID: create_asset answered without the new ID/);
  });

  it("fails a new contact where the org has no territory, and asks for the territories afresh next time", async () => {
    let asked = 0;
    const { provider } = fsm({
      [`${FSM_API}/Territories`]: () => {
        asked += 1;
        return asked === 1 ? json({ data: [] }) : territories();
      },
      [`${FSM_API}/Contacts`]: () => json({ data: { Contacts: [{ id: "contact-9" }] } }, 201),
    });
    const contact = {
      firstName: "Neha",
      lastName: "Kapoor",
      mobile: "+919810000003",
      email: null,
      city: "Gurgaon",
      pincode: "122018",
      street: null,
      state: "Haryana",
      stateCode: "HR",
    };

    await expect(provider.createContact(contact)).rejects.toThrow(/NO_TERRITORY/);
    expect(await provider.createContact(contact)).toBe("contact-9");
  });

  it("fails a Request, a visit and a change of number for a contact FSM no longer has", async () => {
    const { provider } = fsm({ [`${FSM_API}/Contacts/gone`]: empty });

    await expect(
      provider.createRequest({
        contactId: "gone",
        summary: "Consultation",
        serviceId: "item-consult",
        preferredDate: null,
        preferenceNote: "",
        reference: "lead-1",
      }),
    ).rejects.toThrow(/NO_CONTACT: the Request's contact is not in FSM/);
    await expect(
      provider.createWorkOrder({
        contactId: "gone",
        summary: "Service",
        serviceId: "item-service",
        reference: "hold-1",
      }),
    ).rejects.toThrow(/NO_CONTACT: the visit's contact is not in FSM/);
    await expect(provider.updateContact("gone", { mobile: "+919810000009", address: null })).rejects.toThrow(
      /NO_CONTACT: the contact to update is not in FSM/,
    );
  });

  it("erases nothing for a contact FSM no longer has", async () => {
    const { provider, calls } = fsm({ [`${FSM_API}/Contacts/gone`]: empty });
    await provider.eraseContact("gone");
    expect(writes(calls)).toEqual([]);
  });

  it("fails an appointment on a work order with no service line to put it on", async () => {
    const { provider } = fsm({
      [`${FSM_API}/Work_Orders/wo-empty`]: () => json({ data: [{ Grand_Total: 0, Service_Line_Items: [] }] }),
    });
    await expect(
      provider.createAppointment("wo-empty", {
        summary: "Service",
        technicianId: "sr-1",
        start: "2026-09-24T12:00:00+05:30",
        end: "2026-09-24T13:30:00+05:30",
      }),
    ).rejects.toThrow(/NO_LINE/);
  });

  it("fails an invoice for a work order FSM no longer has, and one it raised but answered without an ID", async () => {
    const { provider } = fsm({
      [`${FSM_API}/Work_Orders/wo-gone`]: empty,
      [`${FSM_API}/Work_Orders/wo-1`]: () =>
        json({ data: [{ Grand_Total: 2000, Service_Line_Items: [{ id: "line-1", Invoice_Id: null }] }] }),
      [`${FSM_API}/Invoices`]: () => json({ data: { Invoices: [] } }, 201),
    });

    await expect(provider.invoiceWorkOrder("wo-gone")).rejects.toThrow(/NO_WORK_ORDER/);
    await expect(provider.invoiceWorkOrder("wo-1")).rejects.toThrow(/NO_ID: the invoice answered without its ID/);
  });

  it("answers no invoice yet for a line invoiced by hand that Books has not been given, nor for a Request gone", async () => {
    const { provider } = fsm({
      [`${FSM_API}/Work_Orders/wo-2`]: () =>
        json({ data: [{ Grand_Total: 2000, Service_Line_Items: [{ id: "line-1", Invoice_Id: "inv-1" }] }] }),
      [`${FSM_API}/Invoices/inv-1`]: () => json({ data: [{ id: "inv-1", ZBilling_InvoiceId: null }] }),
      [`${FSM_API}/Work_Orders/wo-3`]: () => json({ data: [{ Request: { id: "req-gone" } }] }),
      [`${FSM_API}/Requests/req-gone`]: empty,
    });

    expect(await provider.invoiceWorkOrder("wo-2")).toBeNull();
    expect(await provider.requestPreference("wo-3")).toBeNull();
  });

  it("fails a download FSM answered with no file, and takes a file with no type as bytes", async () => {
    const { provider } = fsm({
      [`${FSM_API}/files?file_id=empty`]: () => new Response(null, { status: 200 }),
      [`${FSM_API}/files?file_id=untyped`]: () => new Response(new Uint8Array([1, 2, 3])),
    });

    await expect(provider.download("empty")).rejects.toThrow(/EMPTY_FILE/);
    expect((await provider.download("untyped")).contentType).toBe("application/octet-stream");
  });

  it("reads an appointment offering no transitions, in an empty answer, as offering none", async () => {
    const { provider } = fsm({ [`${FSM_API}/Service_Appointments/ap-closed/actions/blueprint/transitions`]: empty });
    expect(await provider.appointmentTransitions("ap-closed")).toEqual([]);
  });
});
