import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { ZohoFsmSettings } from "../../src/config/settings.ts";
import { createLogger } from "../../src/log.ts";
import { createBooksProvider, createStubBooks } from "../../src/providers/books.ts";
import { createFsmProvider, createStubFsm } from "../../src/providers/fsm.ts";
import {
  FSM_API,
  ZOHO_TOKEN_URL,
  fsmAppointmentRecord,
  fsmAttachmentRecord,
  fsmContactRecord,
  fsmInvoiceRecord,
  fsmRequestRecord,
  fsmUserRecord,
  fsmWorkOrderRecord,
} from "./fsm-fixtures.ts";
import { NOW, captureLogs, fakeFetch, json } from "./helpers.ts";

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

const BOOKS_API = "https://www.zohoapis.in/books/v3";
const tokenIssued = (token = "fsm-access-1") => json({ access_token: token, expires_in: 3600, token_type: "Bearer" });
const empty = () => new Response(null, { status: 204 });

function fsm(routes: Parameters<typeof fakeFetch>[0]) {
  const http = fakeFetch(routes);
  const deps = { db: env.DB, fetch: http.fetch, now: () => NOW, log: createLogger() };
  return {
    fsm: createFsmProvider("zoho", SETTINGS, deps),
    books: createBooksProvider("zoho", SETTINGS, deps),
    calls: http.calls,
  };
}

let logs: ReturnType<typeof captureLogs>;
beforeEach(async () => {
  logs = captureLogs();
  await env.DB.prepare("DELETE FROM zoho_tokens").run();
});

describe("FSM: appointments", () => {
  it("reads an appointment in our words: its work order, client, times, technicians and services", async () => {
    const { fsm: provider, calls } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${FSM_API}/Service_Appointments/ap-1`]: () => json({ data: [fsmAppointmentRecord()] }),
    });

    expect(await provider.appointment("ap-1")).toEqual({
      id: "ap-1",
      name: "AP-1",
      status: "Scheduled",
      workOrderId: "wo-1",
      contactId: "contact-1",
      scheduledStart: "2026-09-24T10:00:00+05:30",
      scheduledEnd: "2026-09-24T11:30:00+05:30",
      actualStart: null,
      actualEnd: null,
      technicianIds: ["sr-1"],
      serviceIds: ["item-service-visit"],
      serviceCity: "Gurgaon",
      servicePincode: "122018",
      modifiedAt: "2026-09-22T14:27:15+05:30",
    });
    expect(calls[1]?.headers.get("Authorization")).toBe("Zoho-oauthtoken fsm-access-1");
  });

  it("answers null for an appointment FSM does not have, which it answers with 204", async () => {
    const { fsm: provider } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${FSM_API}/Service_Appointments/`]: empty,
    });
    expect(await provider.appointment("gone")).toBeNull();
  });

  it("pages appointments most recently changed first, and says when there are more", async () => {
    const { fsm: provider, calls } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${FSM_API}/Service_Appointments?`]: () =>
        json({ data: [fsmAppointmentRecord(), fsmAppointmentRecord({ id: "ap-2" })], info: { more_records: true } }),
    });
    const page = await provider.appointments(2, 2);
    expect(page.appointments.map((appointment) => appointment.id)).toEqual(["ap-1", "ap-2"]);
    expect(page.more).toBe(true);
    const query = new URL(calls[1]?.url ?? "").searchParams;
    expect(Object.fromEntries(query)).toEqual({
      page: "2",
      per_page: "2",
      sort_by: "Modified_Time",
      sort_order: "desc",
    });
  });

  it("reads an empty list as no appointments", async () => {
    const { fsm: provider } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${FSM_API}/Service_Appointments?`]: empty,
    });
    expect(await provider.appointments(1, 50)).toEqual({ appointments: [], more: false });
  });

  it("fails loudly, without the record, when FSM changes an answer's shape", async () => {
    const { fsm: provider } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${FSM_API}/Service_Appointments/ap-1`]: () => json({ data: [fsmAppointmentRecord({ Status: 42 })] }),
    });
    await expect(provider.appointment("ap-1")).rejects.toThrow(/Status/);
  });
});

describe("FSM: clients, technicians, items and files", () => {
  it("reads a client's name, mobile number and e-mail, and their Books customer once FSM has synced them", async () => {
    const { fsm: provider } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${FSM_API}/Contacts/contact-1`]: () => json({ data: [fsmContactRecord()] }),
      [`${FSM_API}/Contacts/contact-2`]: () =>
        json({ data: [fsmContactRecord({ id: "contact-2", ZBilling_Id: "books-customer-9" })] }),
    });
    expect(await provider.contact("contact-1")).toEqual({
      id: "contact-1",
      name: "Rohit Malhotra",
      mobile: "+919810000001",
      email: "rohit@example.com",
      booksCustomerId: null,
    });
    expect((await provider.contact("contact-2"))?.booksCustomerId).toBe("books-customer-9");
  });

  it("lists technicians as their service resources, active only when both the user and resource are", async () => {
    const { fsm: provider } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${FSM_API}/users`]: () =>
        json({
          users: [
            fsmUserRecord(),
            fsmUserRecord({
              id: "user-2",
              full_name: "Sameer",
              status: "deactive",
              mobile: null,
              Territory: null,
              Service_Resources: { id: "sr-2", isActive: true },
            }),
            fsmUserRecord({ id: "user-3", full_name: "Office only", Service_Resources: null }),
          ],
        }),
    });
    // The number is what the technician logs in with, and the territory is the
    // zone the dispatch board groups him by; both are null where FSM has none.
    expect(await provider.technicians()).toEqual([
      { id: "sr-1", userId: "user-1", name: "Imran Khan", active: true, mobile: "+919810000009", zone: "Gurgaon" },
      { id: "sr-2", userId: "user-2", name: "Sameer", active: false, mobile: null, zone: null },
    ]);
  });

  it("lists the catalogue's services and parts", async () => {
    const { fsm: provider } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${FSM_API}/Service_And_Parts`]: () =>
        json({
          data: [
            { id: "item-1", Name: "Service visit", Type: "Service", Unit_Price: 2000 },
            { id: "item-2", Name: "Standard base", Type: "Part" },
          ],
        }),
    });
    expect(await provider.items()).toEqual([
      { id: "item-1", name: "Service visit", type: "Service" },
      { id: "item-2", name: "Standard base", type: "Part" },
    ]);
  });

  it("lists an appointment's attachments and downloads one as FSM sent it", async () => {
    const photo = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const { fsm: provider, calls } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${FSM_API}/Service_Appointments/ap-1/Attachments`]: () => json({ data: [fsmAttachmentRecord()] }),
      [`${FSM_API}/files?file_id=`]: () =>
        new Response(photo, { headers: { "Content-Type": "image/jpeg;charset=UTF-8" } }),
    });

    expect(await provider.attachments("ap-1")).toEqual([
      {
        id: "attachment-1",
        fileId: "file-abc",
        name: "before-front.jpg",
        size: 22738,
        createdAt: "2026-09-22T14:27:16+05:30",
      },
    ]);
    const file = await provider.download("file-abc");
    expect(file.contentType).toBe("image/jpeg");
    expect(new Uint8Array(await new Response(file.body).arrayBuffer())).toEqual(photo);
    expect(new URL(calls.at(-1)?.url ?? "").searchParams.get("file_id")).toBe("file-abc");
  });

  it("reads no attachments as none", async () => {
    const { fsm: provider } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${FSM_API}/Service_Appointments/ap-1/Attachments`]: empty,
    });
    expect(await provider.attachments("ap-1")).toEqual([]);
  });

  // The upload answers `file_id`, but the Attachments module takes `File_Id`. Sending
  // the lower-case name is refused with 400 INVALID_DATA (staging, 23 September 2026).
  it("attaches an uploaded file by File_Id, the name the module takes", async () => {
    const { fsm: provider, calls } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${FSM_API}/files`]: () => json({ data: { file_id: "file-new" } }, 200),
      [`${FSM_API}/Service_Appointments/ap-1/Attachments`]: () => json({ data: [{ id: "attachment-9" }] }, 201),
    });

    const id = await provider.attachToAppointment("ap-1", {
      name: "before-front.jpg",
      contentType: "image/jpeg",
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
    });

    expect(id).toBe("attachment-9");
    expect(JSON.parse(calls.at(-1)?.body ?? "null")).toEqual({
      data: [{ File_Id: "file-new", File_Name: "before-front.jpg" }],
    });
  });
});

// Booking a visit in two writes, each findable by our reference (docs/decisions/0067-a-paid-hold-is-kept.md).
describe("FSM: booking a visit, once", () => {
  const addresses = () =>
    json({ data: [fsmContactRecord({ Service_Address: { id: "sa-1" }, Billing_Address: { id: "ba-1" } })] });
  const territories = () => json({ data: [{ id: "territory-1", Name: "Mane Man" }] });

  it("makes the work order with our reference at the end of its summary", async () => {
    const { fsm: provider, calls } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${FSM_API}/Contacts/contact-1`]: addresses,
      [`${FSM_API}/Territories`]: territories,
      [`${FSM_API}/Work_Orders`]: () =>
        json({ data: { Work_Orders: [{ id: "wo-9" }], Service_Line_Items: [{ id: "line-9" }] } }, 201),
    });
    const id = await provider.createWorkOrder({
      contactId: "contact-1",
      summary: "Service visit for Rohit Malhotra",
      serviceId: "item-service",
      reference: "hold-1",
    });
    expect(id).toBe("wo-9");
    const posted = calls.find((call) => call.method === "POST" && call.url.endsWith("/Work_Orders"));
    expect(JSON.parse(posted?.body ?? "null")).toMatchObject({
      data: [{ Summary: "Service visit for Rohit Malhotra (booking hold-1)", Contact: "contact-1" }],
    });
  });

  it("puts the work order's own service line on the appointment, with the technician", async () => {
    const { fsm: provider, calls } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${FSM_API}/Work_Orders/wo-9`]: () => json({ data: [fsmWorkOrderRecord({ id: "wo-9" })] }),
      [`${FSM_API}/Territories`]: territories,
      [`${FSM_API}/Service_Appointments`]: () => json({ data: [{ id: "ap-9" }] }, 201),
    });
    const id = await provider.createAppointment("wo-9", {
      summary: "Service visit for Rohit Malhotra",
      technicianId: "sr-1",
      start: "2026-09-24T12:00:00+05:30",
      end: "2026-09-24T13:30:00+05:30",
    });
    expect(id).toBe("ap-9");
    const posted = calls.find((call) => call.method === "POST" && call.url.startsWith(FSM_API));
    expect(JSON.parse(posted?.body ?? "null")).toMatchObject({
      data: [{ $Service_Line_Items: ["line-1"], $Service_Resources: ["sr-1"] }],
    });
  });

  it("finds a work order and its appointment an earlier try made, among the latest", async () => {
    const { fsm: provider, calls } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${FSM_API}/Work_Orders?`]: () =>
        json({
          data: [
            { id: "wo-8", Summary: "Service visit for Karan Bhatia (booking hold-2)" },
            { id: "wo-9", Summary: "Service visit for Rohit Malhotra (booking hold-1)" },
          ],
        }),
      [`${FSM_API}/Service_Appointments?`]: () =>
        json({ data: [fsmAppointmentRecord({ id: "ap-9", Work_Order: { name: "WO9", id: "wo-9" } })] }),
    });
    expect(await provider.findWorkOrder("hold-1")).toBe("wo-9");
    expect(await provider.findWorkOrder("hold-3")).toBeNull();
    expect(await provider.workOrderAppointment("wo-9")).toBe("ap-9");
    expect(await provider.workOrderAppointment("wo-8")).toBeNull();
    expect(calls[1]?.url).toBe(`${FSM_API}/Work_Orders?page=1&per_page=50&sort_by=Modified_Time&sort_order=desc`);
  });

  it("looks for a contact by mobile number, and answers none for FSM's empty 204", async () => {
    const { fsm: provider, calls } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${FSM_API}/Contacts/search`]: (call) =>
        call.url.includes("919810000001") ? json({ data: [fsmContactRecord({ id: "contact-7" })] }) : empty(),
    });
    expect(await provider.findContact("+919810000001")).toBe("contact-7");
    expect(await provider.findContact("+919810000002")).toBeNull();
    expect(calls[1]?.url).toBe(
      `${FSM_API}/Contacts/search?criteria=${encodeURIComponent("(Mobile:equals:+919810000001)")}`,
    );
  });

  it("gives a new contact's service address the pincode the booking gave, and stamps a Request with the lead", async () => {
    const { fsm: provider, calls } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${FSM_API}/Territories`]: territories,
      [`${FSM_API}/Contacts/contact-1`]: addresses,
      [`${FSM_API}/Contacts`]: () => json({ data: { Contacts: [{ id: "contact-9" }] } }, 201),
      [`${FSM_API}/Requests`]: () => json({ data: { Requests: [{ id: "req-9" }] } }, 201),
    });
    await provider.createContact({
      firstName: "Rohit",
      lastName: "Malhotra",
      mobile: "+919810000001",
      email: null,
      city: "Gurgaon",
      pincode: "122018",
      state: "Haryana",
      stateCode: "HR",
    });
    await provider.createRequest({
      contactId: "contact-1",
      summary: "Consultation for Rohit Malhotra",
      serviceId: "item-consult",
      preferredDate: null,
      preferenceNote: "",
      reference: "lead-1",
    });
    const posts = calls
      .filter((call) => call.method === "POST" && call.url.startsWith(FSM_API))
      .map((call) => JSON.parse(call.body) as unknown);
    expect(posts[0]).toMatchObject({ data: [{ Service_Address: { City: "Gurgaon", Zip_Code: "122018" } }] });
    expect(posts[1]).toMatchObject({ data: [{ Summary: "Consultation for Rohit Malhotra (lead lead-1)" }] });
  });
});

describe("FSM: moving and cancelling a visit", () => {
  it("reschedules an appointment through its action, with the new times", async () => {
    const { fsm: provider, calls } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${FSM_API}/Service_Appointments/ap-1/actions/reschedule`]: () =>
        json({ data: [{ code: "SUCCESS", message: "record updated" }] }),
    });
    await provider.rescheduleVisit("ap-1", { start: "2026-09-25T16:00:00+05:30", end: "2026-09-25T17:30:00+05:30" });
    expect(calls[1]?.method).toBe("PUT");
    expect(JSON.parse(calls[1]?.body ?? "null")).toEqual({
      data: [
        {
          Scheduled_Start_Date_Time: "2026-09-25T16:00:00+05:30",
          Scheduled_End_Date_Time: "2026-09-25T17:30:00+05:30",
        },
      ],
    });
  });

  it("cancels a work order through its blueprint's Cancel, with the note FSM requires", async () => {
    const { fsm: provider, calls } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${FSM_API}/Work_Orders/wo-1/actions/blueprint/transitions`]: () =>
        json({
          code: "SUCCESS",
          transitions: [
            { id: "tr-terminate", name: "Terminate" },
            { id: "tr-cancel", name: "Cancel" },
          ],
        }),
      [`${FSM_API}/Work_Orders/wo-1/actions/blueprint`]: () => json({ code: "SUCCESS", message: "record updated" }),
    });
    expect(await provider.cancelVisit("wo-1", "Cancelled by the client in the app.")).toBe(true);
    expect(calls[2]?.method).toBe("PUT");
    expect(JSON.parse(calls[2]?.body ?? "null")).toEqual({
      blueprint: [{ transition_id: "tr-cancel", data: { Notes: "Cancelled by the client in the app." } }],
    });
  });

  it("puts an appointment on another technician, and reads it back to be sure FSM did", async () => {
    const { fsm: provider, calls } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${FSM_API}/Service_Appointments/ap-1`]: (call) =>
        call.method === "PUT"
          ? json({ data: [{ code: "SUCCESS", message: "record updated" }] })
          : json({ data: [fsmAppointmentRecord({ $Service_Resources: [{ id: "sr-2" }] })] }),
    });
    await provider.assignVisit("ap-1", "sr-2");
    expect(JSON.parse(calls[1]?.body ?? "null")).toEqual({ data: [{ $Service_Resources: ["sr-2"] }] });
    expect(calls[2]?.method).toBe("GET");
  });

  // A plain edit of an appointment's times answers "record updated" and changes
  // nothing (docs/decisions/fsm-trial.md, question 7); the technician is a plain
  // edit too, and has never been tried with a second technician.
  it("refuses a reassignment FSM answered but did not make", async () => {
    const { fsm: provider } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${FSM_API}/Service_Appointments/ap-1`]: (call) =>
        call.method === "PUT"
          ? json({ data: [{ code: "SUCCESS", message: "record updated" }] })
          : json({ data: [fsmAppointmentRecord()] }),
    });
    await expect(provider.assignVisit("ap-1", "sr-2")).rejects.toThrow(/kept the appointment's technician/);
  });

  it("starts a job by the appointment's own Start Work, by its ID, with the note FSM requires", async () => {
    const { fsm: provider, calls } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${FSM_API}/Service_Appointments/ap-1/actions/blueprint/transitions`]: () =>
        json({
          code: "SUCCESS",
          transitions: [
            { id: "tr-start", name: "Start Work" },
            { id: "tr-terminate", name: "Terminate" },
          ],
        }),
      [`${FSM_API}/Service_Appointments/ap-1/actions/blueprint`]: () =>
        json({ code: "SUCCESS", message: "record updated" }),
    });
    expect(await provider.transitionAppointment("ap-1", "Start Work", "Job started.")).toBe(true);
    expect(JSON.parse(calls[2]?.body ?? "null")).toEqual({
      blueprint: [{ transition_id: "tr-start", data: { Notes: "Job started." } }],
    });
  });

  it("answers false, and moves nothing, for a transition the appointment does not offer", async () => {
    const { fsm: provider, calls } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${FSM_API}/Service_Appointments/ap-1/actions/blueprint/transitions`]: () =>
        json({ code: "SUCCESS", transitions: [{ id: "tr-dispatch", name: "Dispatch" }] }),
    });
    expect(await provider.transitionAppointment("ap-1", "Complete Work", "Outcome: done.")).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it("answers false when the work order offers no Cancel, as a closed one does", async () => {
    const { fsm: provider, calls } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${FSM_API}/Work_Orders/wo-2/actions/blueprint/transitions`]: () =>
        json({ code: "SUCCESS", transitions: [{ id: "tr-print", name: "Print" }] }),
    });
    expect(await provider.cancelVisit("wo-2", "note")).toBe(false);
    expect(calls).toHaveLength(2);
  });
});

describe("FSM: billing a finished job", () => {
  it("raises the work order's invoice with its line IDs and finance data, and answers Books' ID for it", async () => {
    const { fsm: provider, calls } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${FSM_API}/Work_Orders/wo-1`]: () => json({ data: [fsmWorkOrderRecord()] }),
      [`${FSM_API}/Invoices`]: () =>
        json(
          {
            result: "success",
            data: {
              Invoices: [
                {
                  id: "fsm-invoice-1",
                  finance_data: {
                    code: "2030",
                    Invoice_Id: "books-invoice-1",
                    message: "Invoice Created Successfully",
                  },
                },
              ],
            },
          },
          201,
        ),
    });

    // `created` is what lets the pass send only an invoice it has just raised (ADR 0056).
    expect(await provider.invoiceWorkOrder("wo-1")).toEqual({
      id: "fsm-invoice-1",
      booksInvoiceId: "books-invoice-1",
      created: true,
    });
    expect(calls[2]?.method).toBe("POST");
    // Without the line IDs FSM answers a bare 500, whatever else the body carries.
    expect(JSON.parse(calls[2]?.body ?? "null")).toEqual({
      data: [
        {
          Work_Order: "wo-1",
          $Service_Line_Items: ["line-1"],
          $finance_data: {
            date: "2026-09-21",
            due_date: "2026-09-21",
            payment_terms: 0,
            payment_terms_label: "Due on Receipt",
            discount_preference: { Discount: 0, Adjustment: 0, Discount_Type: "Currency" },
          },
        },
      ],
    });
  });

  it("answers the invoice a work order already carries, as one raised by hand in FSM does", async () => {
    const { fsm: provider, calls } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${FSM_API}/Work_Orders/wo-1`]: () =>
        json({
          data: [
            fsmWorkOrderRecord({
              Billing_Status: "Invoiced",
              Service_Line_Items: [{ id: "line-1", Invoice_Id: "fsm-invoice-1" }],
            }),
          ],
        }),
      [`${FSM_API}/Invoices/fsm-invoice-1`]: () => json({ data: [fsmInvoiceRecord()] }),
    });

    expect(await provider.invoiceWorkOrder("wo-1")).toEqual({
      id: "fsm-invoice-1",
      booksInvoiceId: "books-invoice-1",
      created: false,
    });
    expect(calls.map((call) => call.method)).toEqual(["POST", "GET", "GET"]); // the token, then two reads: nothing raised
  });

  it("bills nothing for a work order with nothing on it, as a free consultation has", async () => {
    const { fsm: provider, calls } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${FSM_API}/Work_Orders/wo-1`]: () => json({ data: [fsmWorkOrderRecord({ Grand_Total: 0, Sub_Total: 0 })] }),
    });

    expect(await provider.invoiceWorkOrder("wo-1")).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it("raises a refusal FSM answers with 200, such as a line someone else has just invoiced", async () => {
    const { fsm: provider } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${FSM_API}/Work_Orders/wo-1`]: () => json({ data: [fsmWorkOrderRecord()] }),
      [`${FSM_API}/Invoices`]: () =>
        json({ code: "2031", message: "One or more line items are already invoiced", status: "error" }),
    });

    await expect(provider.invoiceWorkOrder("wo-1")).rejects.toThrow(
      "Zoho 400 2031: One or more line items are already invoiced",
    );
  });
});

describe("FSM: what the client asked for", () => {
  it("follows the work order's Request to the preference our booking wrote on it", async () => {
    const { fsm: provider, calls } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${FSM_API}/Work_Orders/wo-1`]: () =>
        json({ data: [fsmWorkOrderRecord({ Request: { name: "REQ1", id: "req-1" } })] }),
      [`${FSM_API}/Requests/req-1`]: () => json({ data: [fsmRequestRecord()] }),
    });

    expect(await provider.requestPreference("wo-1")).toEqual({
      requestId: "req-1",
      preferredDate: "2026-09-25",
      preferenceNote: "Morning, 9 am to 12 pm",
    });
    // Two reads and no write: nothing about the visit is changed by asking.
    expect(calls.filter((call) => call.method !== "GET" && !call.url.includes("oauth"))).toEqual([]);
  });

  it("answers nothing for a work order our own booking made, which names no Request", async () => {
    const { fsm: provider, calls } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${FSM_API}/Work_Orders/wo-1`]: () => json({ data: [fsmWorkOrderRecord()] }),
    });

    expect(await provider.requestPreference("wo-1")).toBeNull();
    // The Request is never read, because there is none to read.
    expect(calls.some((call) => call.url.includes("/Requests/"))).toBe(false);
  });

  it("answers the Request with no preference on it as one with nothing asked for", async () => {
    const { fsm: provider } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${FSM_API}/Work_Orders/wo-1`]: () =>
        json({ data: [fsmWorkOrderRecord({ Request: { name: "REQ1", id: "req-1" } })] }),
      [`${FSM_API}/Requests/req-1`]: () => json({ data: [fsmRequestRecord({ Preference: null })] }),
    });

    expect(await provider.requestPreference("wo-1")).toEqual({
      requestId: "req-1",
      preferredDate: null,
      preferenceNote: null,
    });
  });
});

describe("FSM: the access token", () => {
  it("keeps one token in D1 for every call until a minute before it expires", async () => {
    const { fsm: provider, calls } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${FSM_API}/Contacts/`]: () => json({ data: [fsmContactRecord()] }),
    });
    await provider.contact("contact-1");
    await provider.contact("contact-1");
    expect(calls.filter((call) => call.url.startsWith(ZOHO_TOKEN_URL))).toHaveLength(1);
    const row = await env.DB.prepare("SELECT client, expires_at FROM zoho_tokens").first();
    expect(row).toEqual({ client: "fsm", expires_at: new Date(NOW.getTime() + 3600_000).toISOString() });
  });

  it("refreshes once and repeats the call when Zoho rejects the token", async () => {
    let first = true;
    const { fsm: provider, calls } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(first ? "stale" : "fresh"),
      [`${FSM_API}/Contacts/`]: (call) => {
        if (call.headers.get("Authorization") === "Zoho-oauthtoken stale") {
          first = false;
          return json({ code: "INVALID_TOKEN" }, 401);
        }
        return json({ data: [fsmContactRecord()] });
      },
    });
    expect((await provider.contact("contact-1"))?.name).toBe("Rohit Malhotra");
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/oauth/v2/token",
      "/fsm/v1/Contacts/contact-1",
      "/oauth/v2/token",
      "/fsm/v1/Contacts/contact-1",
    ]);
  });

  it("names Zoho's error code when a call fails, and never logs a URL, secret or token", async () => {
    const { fsm: provider } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${FSM_API}/Contacts/`]: () => json({ code: "INVALID_DATA", message: "the id given seems to be invalid" }, 400),
    });
    await expect(provider.contact("contact-1")).rejects.toThrow(
      "Zoho 400 INVALID_DATA: the id given seems to be invalid",
    );
    const lines = JSON.stringify(logs.lines());
    expect(lines).not.toMatch(/https:|fsm-client-secret|1000\.fsm-refresh|fsm-access-1/);
  });
});

describe("Books: invoices", () => {
  it("reads an invoice's number, date, total in paise and status, from the configured organisation", async () => {
    const { books, calls } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/invoices/inv-1`]: () =>
        json({
          invoice: {
            invoice_id: "inv-1",
            invoice_number: "INV-000041",
            date: "2026-09-24",
            total: 2360.5,
            balance: 1000,
            status: "sent",
          },
        }),
    });
    expect(await books.invoice("inv-1")).toEqual({
      id: "inv-1",
      number: "INV-000041",
      date: "2026-09-24",
      total: 236050,
      balance: 100000,
      status: "sent",
    });
    expect(new URL(calls[1]?.url ?? "").searchParams.get("organization_id")).toBe("60088931635");
  });

  it("streams an invoice's PDF, and answers null for one Books does not have", async () => {
    const { books, calls } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/invoices/inv-1`]: () =>
        new Response("%PDF-1.4", { headers: { "Content-Type": "application/pdf" } }),
      [`${BOOKS_API}/invoices/missing`]: () => json({ code: 1002, message: "Invoice does not exist." }, 404),
    });
    const pdf = await books.invoicePdf("inv-1");
    expect(await new Response(pdf?.body).text()).toBe("%PDF-1.4");
    expect(new URL(calls[1]?.url ?? "").searchParams.get("accept")).toBe("pdf");
    expect(await books.invoicePdf("missing")).toBeNull();
  });
});

describe("Books: payments, receipts and refunds", () => {
  const body = (call: { body: string } | undefined) => JSON.parse(call?.body ?? "null") as unknown;

  it("records a payment in rupees, against the client's customer, and returns its ID", async () => {
    const { books, calls } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/customerpayments`]: () => json({ code: 0, payment: { payment_id: "bp-1" } }, 201),
    });
    const id = await books.recordPayment({
      customerId: "books-customer-9",
      amount: 3000050,
      date: "2026-09-21",
      reference: "MM-2026-0841",
      description: "Staging test: Razorpay payment pay_test41",
    });
    expect(id).toBe("bp-1");
    expect(calls[1]?.method).toBe("POST");
    expect(new URL(calls[1]?.url ?? "").searchParams.get("organization_id")).toBe("60088931635");
    expect(body(calls[1])).toEqual({
      customer_id: "books-customer-9",
      payment_mode: "Razorpay",
      amount: 30000.5,
      date: "2026-09-21",
      reference_number: "MM-2026-0841",
      description: "Staging test: Razorpay payment pay_test41",
    });
  });

  it("streams a payment's receipt, and answers null for one Books does not have", async () => {
    const { books, calls } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/customerpayments/bp-1`]: () =>
        new Response("%PDF-1.4", { headers: { "Content-Type": "application/pdf" } }),
      [`${BOOKS_API}/customerpayments/missing`]: () => json({ code: 1002, message: "Payment does not exist." }, 404),
    });
    expect(await new Response((await books.receiptPdf("bp-1"))?.body).text()).toBe("%PDF-1.4");
    expect(new URL(calls[1]?.url ?? "").searchParams.get("accept")).toBe("pdf");
    expect(await books.receiptPdf("missing")).toBeNull();
  });

  it("applies a payment to an invoice, in rupees", async () => {
    const { books, calls } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/invoices/inv-1/credits`]: () => json({ code: 0, message: "Payment applied." }),
    });
    await books.applyToInvoice("bp-1", "inv-1", 3000000);
    expect(calls[1]?.method).toBe("POST");
    expect(body(calls[1])).toEqual({ invoice_payments: [{ payment_id: "bp-1", amount_applied: 30000 }] });
  });

  it("records a refund from the given account, and returns its ID", async () => {
    const { books, calls } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/customerpayments/bp-1/refunds`]: () =>
        json({ code: 0, payment_refund: { payment_refund_id: "br-1" } }, 201),
    });
    const id = await books.recordRefund("bp-1", {
      amount: 100000,
      date: "2026-09-22",
      reference: "rfnd_test7",
      description: "Staging test: Razorpay refund rfnd_test7",
      fromAccountId: "bank-7",
    });
    expect(id).toBe("br-1");
    expect(body(calls[1])).toEqual({
      date: "2026-09-22",
      refund_mode: "Razorpay",
      amount: 1000,
      from_account_id: "bank-7",
      reference_number: "rfnd_test7",
      description: "Staging test: Razorpay refund rfnd_test7",
    });
  });

  it("fails loudly when Books refuses a payment", async () => {
    const { books } = fsm({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/customerpayments`]: () => json({ code: 1002, message: "Customer does not exist." }, 400),
    });
    const payment = { customerId: "x", amount: 100, date: "2026-09-21", reference: "r", description: "d" };
    await expect(books.recordPayment(payment)).rejects.toThrow(/400/);
  });
});

describe("the stand-ins", () => {
  it("the stub FSM answers from the world it is given, pages it by last change, and reaches nothing", async () => {
    const appointment = { ...(await stubAppointment()), id: "ap-2", modifiedAt: "2026-09-23T09:00:00+05:30" };
    const stub = createStubFsm({
      appointments: [await stubAppointment(), appointment],
      contacts: [],
      technicians: [],
      items: [],
      attachments: {},
      files: {},
    });
    expect((await stub.appointments(1, 1)).appointments.map((item) => item.id)).toEqual(["ap-2"]);
    expect(await stub.appointment("nope")).toBeNull();
  });

  it("the stub Books has every stub- invoice as a blank PDF, and a receipt for every payment it records", async () => {
    const books = createStubBooks();
    expect((await books.invoice("stub-41"))?.number).toBe("INV-000041");
    expect(await new Response((await books.invoicePdf("stub-41"))?.body).text()).toMatch(/^%PDF-1\.4/);
    expect(await books.invoicePdf("real-1")).toBeNull();
    const payment = { customerId: "c", amount: 100, date: "2026-09-21", reference: "r", description: "d" };
    const recorded = await books.recordPayment(payment);
    expect(await new Response((await books.receiptPdf(recorded))?.body).text()).toMatch(/^%PDF-1\.4/);
    expect(await books.receiptPdf("real-1")).toBeNull();
    expect(books.made.payments).toEqual([payment]);
  });

  it("none refuses every call plainly", async () => {
    const off = createFsmProvider("none", null, { db: env.DB, fetch, now: () => NOW, log: createLogger() });
    await expect(off.appointment("ap-1")).rejects.toThrow("FSM is not connected here (FSM_PROVIDER is none)");
  });
});

async function stubAppointment() {
  const { fsm: provider } = fsm({
    [ZOHO_TOKEN_URL]: () => tokenIssued(),
    [`${FSM_API}/Service_Appointments/ap-1`]: () => json({ data: [fsmAppointmentRecord()] }),
  });
  const appointment = await provider.appointment("ap-1");
  if (appointment === null) throw new Error("fixture missing");
  return appointment;
}
