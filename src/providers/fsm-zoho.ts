// Zoho FSM's REST API, v1, on the India data centre. Only src/providers/fsm.ts
// imports this module. The calls and their answers are the ones tried against
// the real org in docs/decisions/fsm-trial.md:
//
//   GET /fsm/v1/Service_Appointments/{id}              { data: [appointment] }
//   GET /fsm/v1/Service_Appointments?page=&per_page=   { data: [...], info: { more_records } }, or 204 when empty
//   GET /fsm/v1/Contacts/{id}                          { data: [contact] }
//   GET /fsm/v1/users                                  { users: [user with Service_Resources] }
//   GET /fsm/v1/Service_And_Parts?per_page=200         { data: [item] }
//   GET /fsm/v1/Service_Appointments/{id}/Attachments  { data: [attachment] }, or 204
//   GET /fsm/v1/files?file_id=                         the file itself
//   GET /fsm/v1/Territories                            { data: [territory] }
//   POST /fsm/v1/Contacts                              { data: { Contacts: [{ id }] } }
//   POST /fsm/v1/Requests                              { data: { Requests: [{ id }], Service_Line_Items: [...] } }
//   POST /fsm/v1/Work_Orders                           { data: { Work_Orders: [{ id }], Service_Line_Items: [{ id }] } }
//   POST /fsm/v1/Service_Appointments                  { data: [{ id }] }
//   PUT  /fsm/v1/Service_Appointments/{id}/actions/reschedule    new times; a plain edit changes nothing
//   GET  /fsm/v1/Work_Orders/{id}/actions/blueprint/transitions  { transitions: [{ id, name }] }
//   PUT  /fsm/v1/Work_Orders/{id}/actions/blueprint              a transition, with its mandatory note;
//        cancelling a work order cancels its appointments
//   PUT  /fsm/v1/Contacts/{id}                                   fields to change, the service address by its ID
//   GET  /fsm/v1/Assets?contact=                                 { data: [asset] }, or 204: the client's pieces
//   POST /fsm/v1/Assets                                          an asset needs a Product; our label is Asset_Number
//   PUT  /fsm/v1/Assets/{id}                                     the piece's status, when one fails
//   PUT  /fsm/v1/Service_Appointments/{id}                       the technician, read back after; the job's own fields
//   GET  /fsm/v1/Service_Appointments/{id}/actions/blueprint/transitions
//   PUT  /fsm/v1/Service_Appointments/{id}/actions/blueprint     start, close or terminate, with its mandatory note
//   POST /fsm/v1/files                                           multipart; answers { data: { file_id } }
//   POST /fsm/v1/Service_Appointments/{id}/Attachments           attaches an uploaded file
//   GET  /fsm/v1/Work_Orders/{id}                                { data: [work order with its service lines, and the
//        Request it was converted from] }
//   GET  /fsm/v1/Requests/{id}                                   { data: [request with its Preference subform] }
//   POST /fsm/v1/Invoices                                        the work order, the line IDs and $finance_data;
//        answers Books' ID under data.Invoices[0].finance_data.Invoice_Id
//   GET  /fsm/v1/Invoices/{id}                                   { data: [invoice with ZBilling_InvoiceId] }
//
// Three reads have not yet been tried on the org, and nothing waits on them
// (docs/decisions/0068-a-paid-hold-is-kept.md): a contact looked for by mobile
// number before one is added, and the latest Requests and work orders, read as
// the latest appointments are, when a retry looks for one whose answer was
// lost. A look that fails is logged, and the record is made as before.
//
//   GET  /fsm/v1/Contacts/search?criteria=(Mobile:equals:…)      { data: [contact] }, or 204
//   GET  /fsm/v1/Requests?page=1&per_page=&sort_by=Modified_Time&sort_order=desc
//   GET  /fsm/v1/Work_Orders?page=1&per_page=&sort_by=Modified_Time&sort_order=desc
//
// Only the fields the mirror uses are read; anything else FSM sends is ignored.

import { z } from "zod";
import type { ZohoFsmSettings } from "../config/settings.ts";
import { indiaDate } from "../lib/india-time.ts";
import type { Logger } from "../log.ts";
import type {
  FsmAppointment,
  FsmAsset,
  FsmAttachment,
  FsmContact,
  FsmInvoice,
  FsmItem,
  FsmProvider,
  FsmTechnician,
  FsmUpload,
  NewFsmAppointment,
  NewFsmAsset,
  NewFsmContact,
  NewFsmRequest,
  NewFsmWorkOrder,
} from "./fsm.ts";
import { createTokenCache, type TokenStore, ZohoError, zohoErrorFrom, zohoSend } from "./zoho-http.ts";

interface Dependencies {
  readonly db: D1Database;
  readonly fetch: typeof fetch;
  readonly now: () => Date;
  readonly log: Logger;
}

const Reference = z.object({ id: z.string() }).nullish();

const Appointment = z.object({
  id: z.string(),
  Name: z.string(),
  Status: z.string(),
  Work_Order: Reference,
  Contact: Reference,
  Scheduled_Start_Date_Time: z.string().nullish(),
  Scheduled_End_Date_Time: z.string().nullish(),
  Actual_Start_Date_Time: z.string().nullish(),
  Actual_End_Date_Time: z.string().nullish(),
  $Service_Resources: z.array(z.object({ id: z.string() })).nullish(),
  Appointments_X_Services: z
    .array(z.object({ Service_Line_Item: z.object({ Service: z.string().nullish() }).nullish() }))
    .nullish(),
  Service_Address: z.object({ Service_City: z.string().nullish(), Service_Zip_Code: z.string().nullish() }).nullish(),
  Modified_Time: z.string(),
});

/**
 * What billing a work order needs: its total, and each service line with the
 * invoice it is already on. An appointment's own `Invoice_Id` is no use here —
 * FSM leaves it null on a work order invoiced from its own screen.
 */
const WorkOrderBilling = z.object({
  Grand_Total: z.number().nullish(),
  Service_Line_Items: z.array(z.object({ id: z.string(), Invoice_Id: z.string().nullish() })).default([]),
});

/** An invoice as FSM holds it: the link, and Books' ID for the document itself. */
const Invoice = z.object({ id: z.string(), ZBilling_InvoiceId: z.string().nullish() });

/** The Request a work order was converted from; absent on one our own booking made outright. */
const WorkOrderRequest = z.object({ Request: Reference });

/** What the client asked for, as `createRequest` wrote it. */
const RequestPreference = z.object({
  id: z.string(),
  Preference: z.object({ Preferred_Date_1: z.string().nullish(), Preference_Note: z.string().nullish() }).nullish(),
});

/** A raised invoice: FSM's new record, with Books' ID for it under finance_data. */
const Raised = z.object({
  data: z.object({
    Invoices: z.array(z.object({ id: z.string(), finance_data: z.object({ Invoice_Id: z.string() }) })),
  }),
});

const Contact = z.object({
  id: z.string(),
  Full_Name: z.string().nullish(),
  First_Name: z.string().nullish(),
  Last_Name: z.string().nullish(),
  Mobile: z.string().nullish(),
  Phone: z.string().nullish(),
  Email: z.string().nullish(),
  ZBilling_Id: z.string().nullish(),
});

const User = z.object({
  id: z.string(),
  full_name: z.string().nullish(),
  status: z.string().nullish(),
  mobile: z.string().nullish(),
  phone: z.string().nullish(),
  Territory: z.object({ name: z.string().nullish() }).nullish(),
  Service_Resources: z
    .object({ id: z.string(), isActive: z.boolean().nullish(), Name: z.string().nullish() })
    .nullish(),
});

const Item = z.object({ id: z.string(), Name: z.string(), Type: z.enum(["Service", "Part"]) });

const Addresses = z.object({
  Service_Address: z.object({ id: z.string() }),
  Billing_Address: z.object({ id: z.string() }),
});

/** What a create answers: the new records under their modules' names, or, for an appointment, a list. */
const Created = z.object({
  data: z.union([z.array(z.object({ id: z.string() })), z.record(z.string(), z.array(z.object({ id: z.string() })))]),
});

/** A blueprint's next steps from a record's state; a closed record offers none. */
const Transitions = z.object({ transitions: z.array(z.object({ id: z.string(), name: z.string() })).default([]) });

/** A new contact's street, until the client gives their address. */
const ADDRESS_TO_CONFIRM = "To be confirmed with the client";

/** A record's summary as a retry reads it: ours, and the reference that says which booking or lead made it. */
const Summarised = z.object({ id: z.string(), Summary: z.string().nullish() });

/**
 * How many of the latest records a retry reads to find one it made. A retry
 * comes within minutes of the write it repeats, so the record is among the
 * newest, and one page is one call.
 */
const LATEST = 50;

/** The summary FSM keeps, with our reference at its end: "Service visit for Rohit Malhotra (booking 6f1c…)". */
const stamped = (summary: string, kind: "booking" | "lead", reference: string) => `${summary} (${kind} ${reference})`;

const Attachment = z.object({
  id: z.string(),
  $file_id: z.string(),
  File_Name: z.string(),
  Size: z.union([z.string(), z.number()]),
  Created_Time: z.string(),
});

/** A piece in FSM: an asset built on a part item, labelled with our own code. */
const Asset = z.object({
  id: z.string(),
  Asset_Number: z.string().nullish(),
  Asset_Name: z.string().nullish(),
  Contact: Reference,
  Product: z.object({ id: z.string(), name: z.string().nullish() }).nullish(),
  Serial_Number: z.string().nullish(),
  Installation_Date: z.string().nullish(),
  Status: z.string().nullish(),
  Modified_Time: z.string().nullish(),
});

/** An upload answers one object, not a list: { data: { file_id } } (docs/decisions/fsm-trial.md). */
const Uploaded = z.object({ data: z.object({ file_id: z.string() }) });

function assetFrom(record: z.infer<typeof Asset>): FsmAsset {
  return {
    id: record.id,
    assetNumber: record.Asset_Number ?? record.Asset_Name ?? "",
    contactId: record.Contact?.id ?? null,
    productId: record.Product?.id ?? null,
    productName: record.Product?.name ?? null,
    serialNumber: record.Serial_Number ?? null,
    installedAt: record.Installation_Date ?? null,
    status: record.Status ?? null,
    modifiedAt: record.Modified_Time ?? "",
  };
}

function appointmentFrom(record: z.infer<typeof Appointment>): FsmAppointment {
  return {
    id: record.id,
    name: record.Name,
    status: record.Status,
    workOrderId: record.Work_Order?.id ?? null,
    contactId: record.Contact?.id ?? null,
    scheduledStart: record.Scheduled_Start_Date_Time ?? null,
    scheduledEnd: record.Scheduled_End_Date_Time ?? null,
    actualStart: record.Actual_Start_Date_Time ?? null,
    actualEnd: record.Actual_End_Date_Time ?? null,
    technicianIds: (record.$Service_Resources ?? []).map((resource) => resource.id),
    serviceIds: (record.Appointments_X_Services ?? []).flatMap((line) =>
      typeof line.Service_Line_Item?.Service === "string" ? [line.Service_Line_Item.Service] : [],
    ),
    serviceCity: record.Service_Address?.Service_City ?? null,
    servicePincode: record.Service_Address?.Service_Zip_Code ?? null,
    modifiedAt: record.Modified_Time,
  };
}

function contactFrom(record: z.infer<typeof Contact>): FsmContact {
  const name =
    record.Full_Name ?? [record.First_Name, record.Last_Name].filter((part) => typeof part === "string").join(" ");
  return {
    id: record.id,
    name,
    mobile: record.Mobile ?? record.Phone ?? null,
    email: record.Email ?? null,
    booksCustomerId: record.ZBilling_Id ?? null,
  };
}

/** FSM and Books share one access token (migrations/0010_zoho_tokens.sql). */
export function fsmTokenStore(db: D1Database): TokenStore {
  return {
    async read() {
      const row = await db
        .prepare("SELECT access_token, expires_at FROM zoho_tokens WHERE client = 'fsm'")
        .first<{ access_token: string; expires_at: string }>();
      return row === null ? null : { accessToken: row.access_token, expiresAt: row.expires_at };
    },
    async write(accessToken, expiresAt) {
      await db
        .prepare(
          `INSERT INTO zoho_tokens (client, access_token, expires_at) VALUES ('fsm', ?1, ?2)
           ON CONFLICT (client) DO UPDATE SET access_token = excluded.access_token, expires_at = excluded.expires_at`,
        )
        .bind(accessToken, expiresAt)
        .run();
    },
  };
}

/** A write: JSON for every module call, or multipart for a file upload. */
type ZohoWrite = { method: "POST" | "PUT"; body: unknown } | { method: "POST"; form: FormData };

/**
 * One authorised request to a Zoho API on the FSM client's token. On 401 the
 * token is refreshed once and the call repeated. Shared with Books.
 */
export function createZohoFsmClient(settings: ZohoFsmSettings, deps: Dependencies) {
  const tokens = createTokenCache(settings, fsmTokenStore(deps.db), deps);

  return async function request(step: string, path: string, write?: ZohoWrite): Promise<Response> {
    // A multipart upload sets its own Content-Type, with the boundary.
    const body = write === undefined ? undefined : "form" in write ? write.form : JSON.stringify(write.body);
    const json = write !== undefined && "body" in write;
    for (const forceRefresh of [false, true]) {
      const token = await tokens.get(forceRefresh);
      const response = await zohoSend(deps, step, `https://${settings.apiHost}${path}`, {
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          ...(json ? { "Content-Type": "application/json" } : {}),
        },
        ...(write === undefined ? {} : { method: write.method, body }),
      });
      if (response.status === 401 && !forceRefresh) continue;
      if (!response.ok) throw zohoErrorFrom(response.status, await response.json().catch(() => null));
      return response;
    }
    throw new ZohoError(401, "AUTHENTICATION_FAILURE", "rejected a freshly refreshed token");
  };
}

export function createZohoFsm(settings: ZohoFsmSettings, deps: Dependencies): FsmProvider {
  const request = createZohoFsmClient(settings, deps);

  /** A JSON answer, or null for FSM's empty 204. */
  async function json(step: string, path: string): Promise<unknown> {
    const response = await request(step, `/fsm/v1${path}`);
    if (response.status === 204) return null;
    return response.json();
  }

  /** The records under `key` in an answer, parsed; none for a 204. */
  function records<T extends z.ZodType>(answer: unknown, key: string, schema: T): z.infer<T>[] {
    if (answer === null) return [];
    const list = (answer as Record<string, unknown>)[key];
    return z.array(schema).parse(list ?? []);
  }

  /** Adds one record to a module; returns the new IDs by module, the record's own under `module`. */
  async function createWith(
    step: string,
    module: string,
    record: Record<string, unknown>,
  ): Promise<Record<string, string | undefined>> {
    const response = await request(step, `/fsm/v1/${module}`, { method: "POST", body: { data: [record] } });
    const { data } = Created.parse(await response.json());
    const ids = Array.isArray(data)
      ? { [module]: data[0]?.id }
      : Object.fromEntries(Object.entries(data).map(([name, records]) => [name, records[0]?.id]));
    if (ids[module] === undefined) throw new ZohoError(response.status, "NO_ID", `${step} answered without the new ID`);
    return ids;
  }

  async function create(step: string, module: string, record: Record<string, unknown>): Promise<string> {
    return (await createWith(step, module, record))[module] ?? "";
  }

  /** An invoice FSM already holds, with Books' ID for it; null while Books has not been given it. */
  async function invoiceById(id: string): Promise<FsmInvoice | null> {
    const [invoice] = records(await json("invoice", `/Invoices/${id}`), "data", Invoice);
    const booksInvoiceId = invoice?.ZBilling_InvoiceId;
    if (invoice === undefined || booksInvoiceId === null || booksInvoiceId === undefined) return null;
    return { id: invoice.id, booksInvoiceId, created: false };
  }

  /** The latest records of a module, most recently changed first, as the reconciliation reads appointments. */
  async function latest(step: string, module: string): Promise<unknown> {
    const query = new URLSearchParams({
      page: "1",
      per_page: String(LATEST),
      sort_by: "Modified_Time",
      sort_order: "desc",
    });
    return json(step, `/${module}?${query.toString()}`);
  }

  /** The newest record of a module whose summary ends with our reference; null if none of the latest does. */
  async function findStamped(step: string, module: string, ending: string): Promise<string | null> {
    const found = records(await latest(step, module), "data", Summarised).find(
      (record) => record.Summary?.endsWith(ending) === true,
    );
    return found?.id ?? null;
  }

  let territory: Promise<string> | null = null;
  /** The territory a new address goes in: the org's first, until territories follow pincodes (P2-M4). */
  function firstTerritory(): Promise<string> {
    territory ??= json("territories", "/Territories")
      .then((answer) => {
        const [first] = records(answer, "data", z.object({ id: z.string() }));
        if (first === undefined) throw new ZohoError(404, "NO_TERRITORY", "FSM has no territory for the address");
        return first.id;
      })
      .catch((error: unknown) => {
        territory = null;
        throw error;
      });
    return territory;
  }

  return {
    // FSM answers a deleted appointment with a 204, and an ID it cannot parse, such as a
    // staging seed's, with 404 INVALID_URL_PATTERN. Neither is there, and neither is a failure.
    async appointment(id) {
      let answer: unknown;
      try {
        answer = await json("appointment", `/Service_Appointments/${id}`);
      } catch (error) {
        if (error instanceof ZohoError && error.status === 404 && error.code === "INVALID_URL_PATTERN") return null;
        throw error;
      }
      const [record] = records(answer, "data", Appointment);
      return record === undefined ? null : appointmentFrom(record);
    },

    async appointments(page, perPage) {
      const query = new URLSearchParams({
        page: String(page),
        per_page: String(perPage),
        sort_by: "Modified_Time",
        sort_order: "desc",
      });
      const answer = await json("appointments", `/Service_Appointments?${query.toString()}`);
      const more = (answer as { info?: { more_records?: unknown } } | null)?.info?.more_records === true;
      return { appointments: records(answer, "data", Appointment).map(appointmentFrom), more };
    },

    async contact(id) {
      const [record] = records(await json("contact", `/Contacts/${id}`), "data", Contact);
      return record === undefined ? null : contactFrom(record);
    },

    async technicians() {
      const users = records(await json("technicians", "/users"), "users", User);
      return users.flatMap((user): FsmTechnician[] => {
        const resource = user.Service_Resources;
        if (resource === null || resource === undefined) return [];
        return [
          {
            id: resource.id,
            userId: user.id,
            name: user.full_name ?? resource.Name ?? "",
            active: resource.isActive === true && user.status === "active",
            mobile: user.mobile ?? user.phone ?? null,
            zone: user.Territory?.name ?? null,
          },
        ];
      });
    },

    async items() {
      return records(await json("items", "/Service_And_Parts?per_page=200"), "data", Item).map((item): FsmItem => ({
        id: item.id,
        name: item.Name,
        type: item.Type,
      }));
    },

    async attachments(appointmentId) {
      const answer = await json("attachments", `/Service_Appointments/${appointmentId}/Attachments`);
      return records(answer, "data", Attachment).map((file): FsmAttachment => ({
        id: file.id,
        fileId: file.$file_id,
        name: file.File_Name,
        size: Number(file.Size),
        createdAt: file.Created_Time,
      }));
    },

    async download(fileId) {
      const response = await request("download", `/fsm/v1/files?file_id=${encodeURIComponent(fileId)}`);
      if (response.body === null) throw new ZohoError(response.status, "EMPTY_FILE", "the file came back empty");
      return {
        body: response.body as ReadableStream<Uint8Array>,
        contentType: response.headers.get("Content-Type")?.split(";")[0] ?? "application/octet-stream",
      };
    },

    // Search by criteria is how Zoho's own CRM finds a record (ADR 0012); on
    // FSM's Contacts it has not yet been tried against the org
    // (docs/decisions/0068-a-paid-hold-is-kept.md, "Not yet tried on the org").
    async findContact(mobile) {
      const criteria = encodeURIComponent(`(Mobile:equals:${mobile})`);
      const [found] = records(await json("find_contact", `/Contacts/search?criteria=${criteria}`), "data", Contact);
      return found?.id ?? null;
    },

    async createContact(contact: NewFsmContact) {
      return create("create_contact", "Contacts", {
        ...(contact.firstName === null ? {} : { First_Name: contact.firstName }),
        Last_Name: contact.lastName,
        Mobile: contact.mobile,
        ...(contact.email === null ? {} : { Email: contact.email }),
        GST_Treatment: "consumer",
        ...(contact.stateCode === null ? {} : { Place_of_Supply: contact.stateCode }),
        Service_Address: {
          Address_Name: "Service Address",
          Street_1: ADDRESS_TO_CONFIRM,
          City: contact.city,
          ...(contact.state === null ? {} : { State: contact.state }),
          ...(contact.pincode === null ? {} : { Zip_Code: contact.pincode }),
          Country: "India",
          Territory: await firstTerritory(),
        },
        Billing_Address: "$SUBLOOKUP_Service_Address",
      });
    },

    async findRequest(reference) {
      return findStamped("find_request", "Requests", `(lead ${reference})`);
    },

    // A Request and its line both need the contact's addresses by ID.
    async createRequest(wanted: NewFsmRequest) {
      const [contact] = records(await json("request_contact", `/Contacts/${wanted.contactId}`), "data", Addresses);
      if (contact === undefined) throw new ZohoError(404, "NO_CONTACT", "the Request's contact is not in FSM");
      const serviceAddress = { id: contact.Service_Address.id };
      return create("create_request", "Requests", {
        Summary: stamped(wanted.summary, "lead", wanted.reference),
        Contact: wanted.contactId,
        Service_Address: serviceAddress,
        Billing_Address: { id: contact.Billing_Address.id },
        Request_Origin: "Web",
        Preference: {
          ...(wanted.preferredDate === null ? {} : { Preferred_Date_1: wanted.preferredDate }),
          Preference_Note: wanted.preferenceNote,
        },
        ...(wanted.preferredDate === null ? {} : { Due_Date: wanted.preferredDate }),
        Service_Line_Items: [
          {
            Service: wanted.serviceId,
            Quantity: 1,
            Sequence: 1,
            Contact: wanted.contactId,
            Service_Address: serviceAddress,
          },
        ],
      });
    },

    async findWorkOrder(reference) {
      return findStamped("find_work_order", "Work_Orders", `(booking ${reference})`);
    },

    async createWorkOrder(order: NewFsmWorkOrder) {
      const [contact] = records(await json("visit_contact", `/Contacts/${order.contactId}`), "data", Addresses);
      if (contact === undefined) throw new ZohoError(404, "NO_CONTACT", "the visit's contact is not in FSM");
      return create("create_work_order", "Work_Orders", {
        Summary: stamped(order.summary, "booking", order.reference),
        Type: "Service",
        Contact: order.contactId,
        Territory: await firstTerritory(),
        Service_Address: { id: contact.Service_Address.id },
        Billing_Address: { id: contact.Billing_Address.id },
        Service_Line_Items: [{ Service: order.serviceId, Quantity: 1, Sequence: 1 }],
      });
    },

    // The same read as the reconciliation's, of the appointments changed last; ours was made minutes ago.
    async workOrderAppointment(workOrderId) {
      const found = records(await latest("work_order_appointment", "Service_Appointments"), "data", Appointment).find(
        (appointment) => appointment.Work_Order?.id === workOrderId && appointment.Status !== "Cancelled",
      );
      return found?.id ?? null;
    },

    // The appointment is made on the work order's service line, read from the work order itself.
    async createAppointment(workOrderId, appointment: NewFsmAppointment) {
      const [order] = records(
        await json("appointment_work_order", `/Work_Orders/${workOrderId}`),
        "data",
        WorkOrderBilling,
      );
      const line = order?.Service_Line_Items[0]?.id;
      if (line === undefined) throw new ZohoError(404, "NO_LINE", "the work order has no service line to schedule");
      return create("create_appointment", "Service_Appointments", {
        Summary: appointment.summary,
        Scheduled_Start_Date_Time: appointment.start,
        Scheduled_End_Date_Time: appointment.end,
        Territory: await firstTerritory(),
        $Service_Line_Items: [line],
        $Service_Resources: [appointment.technicianId],
      });
    },

    async rescheduleVisit(appointmentId, times) {
      await request("reschedule", `/fsm/v1/Service_Appointments/${appointmentId}/actions/reschedule`, {
        method: "PUT",
        body: { data: [{ Scheduled_Start_Date_Time: times.start, Scheduled_End_Date_Time: times.end }] },
      });
    },

    async assets(contactId) {
      const query = new URLSearchParams({ contact: contactId, per_page: "200" });
      const answer = await json("assets", `/Assets?${query.toString()}`);
      return records(answer, "data", Asset)
        .map(assetFrom)
        .sort((a, b) => (b.installedAt ?? "").localeCompare(a.installedAt ?? ""));
    },

    // "An asset needs a Product (a part item) and keeps our label in Asset_Number" (the trial).
    async createAsset(asset: NewFsmAsset) {
      return create("create_asset", "Assets", {
        Asset_Name: asset.assetNumber,
        Asset_Number: asset.assetNumber,
        Contact: asset.contactId,
        Product: asset.productId,
        ...(asset.serialNumber === null ? {} : { Serial_Number: asset.serialNumber }),
        Installation_Date: asset.installedAt,
      });
    },

    async updateAsset(assetId, fields) {
      await request("update_asset", `/fsm/v1/Assets/${assetId}`, {
        method: "PUT",
        body: { data: [{ ...(fields.status === undefined ? {} : { Status: fields.status }) }] },
      });
    },

    // The times must go through /actions/reschedule, but the resources are a plain field edit.
    // A plain edit of the times answers "record updated" and changes nothing (the trial), and
    // this one has never been tried with a second technician, so it is read back: the mirror
    // takes the first resource as the lead, so that is the one checked.
    async assignVisit(appointmentId, technicianId) {
      const path = `/Service_Appointments/${appointmentId}`;
      await request("assign", `/fsm/v1${path}`, {
        method: "PUT",
        body: { data: [{ $Service_Resources: [technicianId] }] },
      });
      const [record] = records(await json("assign_check", path), "data", Appointment);
      if (record?.$Service_Resources?.[0]?.id !== technicianId) {
        throw new ZohoError(200, "NOT_ASSIGNED", "FSM answered the reassignment and kept the appointment's technician");
      }
    },

    async appointmentTransitions(appointmentId) {
      const answer = await json(
        "appointment_transitions",
        `/Service_Appointments/${appointmentId}/actions/blueprint/transitions`,
      );
      return Transitions.parse(answer ?? { transitions: [] }).transitions.map((transition) => transition.name);
    },

    // The note is mandatory on every transition (the trial, 22 September 2026).
    async transitionAppointment(appointmentId, name, note) {
      const path = `/Service_Appointments/${appointmentId}/actions/blueprint`;
      const { transitions } = Transitions.parse((await json("job_transitions", `${path}/transitions`)) ?? {});
      const wanted = transitions.find((transition) => transition.name === name);
      if (wanted === undefined) return false;
      await request("job_transition", `/fsm/v1${path}`, {
        method: "PUT",
        body: { blueprint: [{ transition_id: wanted.id, data: { Notes: note } }] },
      });
      return true;
    },

    async updateAppointment(appointmentId, fields) {
      await request("update_appointment", `/fsm/v1/Service_Appointments/${appointmentId}`, {
        method: "PUT",
        body: { data: [fields] },
      });
    },

    // Upload to /files, then attach the file ID to the appointment (the trial, question 5).
    async attachToAppointment(appointmentId, file: FsmUpload) {
      const form = new FormData();
      form.append("file", new Blob([file.bytes], { type: file.contentType }), file.name);
      const uploaded = await request("upload_file", "/fsm/v1/files", { method: "POST", form });
      const { data } = Uploaded.parse(await uploaded.json());
      // The upload answers `file_id`, but the Attachments module wants `File_Id`;
      // `file_id` is refused with 400 INVALID_DATA (staging, 23 September 2026).
      return create("attach_file", `Service_Appointments/${appointmentId}/Attachments`, {
        File_Id: data.file_id,
        File_Name: file.name,
      });
    },

    // Cancelling is a transition of the work order's blueprint, offered only while the work order is open.
    async cancelVisit(workOrderId, note) {
      const path = `/Work_Orders/${workOrderId}/actions/blueprint`;
      const { transitions } = Transitions.parse(await json("cancel_transitions", `${path}/transitions`));
      const cancel = transitions.find((transition) => transition.name === "Cancel");
      if (cancel === undefined) return false;
      await request("cancel", `/fsm/v1${path}`, {
        method: "PUT",
        body: { blueprint: [{ transition_id: cancel.id, data: { Notes: note } }] },
      });
      return true;
    },

    /*
     * Billing is FSM's door into Books: the create makes the invoice in Books and
     * keeps a link to it here. The line IDs and `$finance_data` are mandatory, and
     * FSM answers a bare 500 rather than a refusal when the line IDs are missing
     * (ADR 0055), so both always go with the work order.
     */
    async invoiceWorkOrder(workOrderId) {
      const [order] = records(
        await json("invoice_work_order", `/Work_Orders/${workOrderId}`),
        "data",
        WorkOrderBilling,
      );
      if (order === undefined) throw new ZohoError(404, "NO_WORK_ORDER", "the work order to invoice is not in FSM");

      // Already invoiced, here or by hand in FSM's own screen: each line then names it.
      const [existing] = order.Service_Line_Items.flatMap((line) =>
        typeof line.Invoice_Id === "string" ? [line.Invoice_Id] : [],
      );
      if (existing !== undefined) return invoiceById(existing);

      const lines = order.Service_Line_Items.map((line) => line.id);
      if (lines.length === 0 || (order.Grand_Total ?? 0) <= 0) return null;

      // Clients pay before the visit, so nothing is ever owed on terms.
      const date = indiaDate(deps.now());
      const response = await request("create_invoice", "/fsm/v1/Invoices", {
        method: "POST",
        body: {
          data: [
            {
              Work_Order: workOrderId,
              $Service_Line_Items: lines,
              $finance_data: {
                date,
                due_date: date,
                payment_terms: 0,
                payment_terms_label: "Due on Receipt",
                discount_preference: { Discount: 0, Adjustment: 0, Discount_Type: "Currency" },
              },
            },
          ],
        },
      });
      // A refusal FSM expects — a line already invoiced, say — comes back 200 with an error body.
      const answer: unknown = await response.json();
      if ((answer as { status?: unknown }).status === "error") throw zohoErrorFrom(400, answer);
      const raised = Raised.parse(answer).data.Invoices[0];
      if (raised === undefined) throw new ZohoError(response.status, "NO_ID", "the invoice answered without its ID");
      return { id: raised.id, booksInvoiceId: raised.finance_data.Invoice_Id, created: true };
    },

    // Two reads, no write. The work order names the Request it was converted
    // from, and the Request alone keeps the client's preference: FSM drops
    // anything written to the same subform on an appointment (ADR 0063).
    async requestPreference(workOrderId) {
      const [order] = records(
        await json("request_work_order", `/Work_Orders/${workOrderId}`),
        "data",
        WorkOrderRequest,
      );
      const requestId = order?.Request?.id;
      if (requestId === undefined) return null;

      const [asked] = records(await json("request_preference", `/Requests/${requestId}`), "data", RequestPreference);
      if (asked === undefined) return null;
      return {
        requestId,
        preferredDate: asked.Preference?.Preferred_Date_1 ?? null,
        preferenceNote: asked.Preference?.Preference_Note ?? null,
      };
    },

    // Tried on the real org on 22 September 2026: the name, numbers and e-mail clear, and the street can be
    // overwritten through the service address's ID; the city stays.
    async eraseContact(contactId) {
      const [contact] = records(await json("erase_contact_read", `/Contacts/${contactId}`), "data", Addresses);
      if (contact === undefined) return;
      await request("erase_contact", `/fsm/v1/Contacts/${contactId}`, {
        method: "PUT",
        body: {
          data: [
            {
              First_Name: null,
              Last_Name: "Erased",
              Mobile: null,
              Phone: null,
              Email: null,
              Service_Address: { id: contact.Service_Address.id, Street_1: "Erased", Street_2: null },
            },
          ],
        },
      });
    },
  };
}
