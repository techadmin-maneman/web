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
//
// Only the fields the mirror uses are read; anything else FSM sends is ignored.

import { z } from "zod";
import type { ZohoFsmSettings } from "../config/settings.ts";
import type { Logger } from "../log.ts";
import type {
  FsmAppointment,
  FsmAttachment,
  FsmContact,
  FsmItem,
  FsmProvider,
  FsmTechnician,
  NewFsmContact,
  NewFsmRequest,
  NewFsmVisit,
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
  Invoice_Id: z.string().nullish(),
  Modified_Time: z.string(),
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

/** A new contact's street, until the client gives their address. */
const ADDRESS_TO_CONFIRM = "To be confirmed with the client";

const Attachment = z.object({
  id: z.string(),
  $file_id: z.string(),
  File_Name: z.string(),
  Size: z.union([z.string(), z.number()]),
  Created_Time: z.string(),
});

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
    invoiceId: record.Invoice_Id ?? null,
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

/**
 * One authorised request to a Zoho API on the FSM client's token. On 401 the
 * token is refreshed once and the call repeated. Shared with Books.
 */
export function createZohoFsmClient(settings: ZohoFsmSettings, deps: Dependencies) {
  const tokens = createTokenCache(settings, fsmTokenStore(deps.db), deps);

  return async function request(
    step: string,
    path: string,
    write?: { method: "POST"; body: unknown },
  ): Promise<Response> {
    for (const forceRefresh of [false, true]) {
      const token = await tokens.get(forceRefresh);
      const response = await zohoSend(deps, step, `https://${settings.apiHost}${path}`, {
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          ...(write === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(write === undefined ? {} : { method: write.method, body: JSON.stringify(write.body) }),
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
    async appointment(id) {
      const [record] = records(await json("appointment", `/Service_Appointments/${id}`), "data", Appointment);
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
          Country: "India",
          Territory: await firstTerritory(),
        },
        Billing_Address: "$SUBLOOKUP_Service_Address",
      });
    },

    // A Request and its line both need the contact's addresses by ID.
    async createRequest(wanted: NewFsmRequest) {
      const [contact] = records(await json("request_contact", `/Contacts/${wanted.contactId}`), "data", Addresses);
      if (contact === undefined) throw new ZohoError(404, "NO_CONTACT", "the Request's contact is not in FSM");
      const serviceAddress = { id: contact.Service_Address.id };
      return create("create_request", "Requests", {
        Summary: wanted.summary,
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

    // The appointment is made on the work order's service line, which the work order's answer names.
    async createVisit(visit: NewFsmVisit) {
      const [contact] = records(await json("visit_contact", `/Contacts/${visit.contactId}`), "data", Addresses);
      if (contact === undefined) throw new ZohoError(404, "NO_CONTACT", "the visit's contact is not in FSM");
      const territory = await firstTerritory();
      const order = await createWith("create_work_order", "Work_Orders", {
        Summary: visit.summary,
        Type: "Service",
        Contact: visit.contactId,
        Territory: territory,
        Service_Address: { id: contact.Service_Address.id },
        Billing_Address: { id: contact.Billing_Address.id },
        Service_Line_Items: [{ Service: visit.serviceId, Quantity: 1, Sequence: 1 }],
      });
      const line = order.Service_Line_Items;
      if (line === undefined) throw new ZohoError(201, "NO_LINE", "the work order answered without its service line");
      const appointmentId = await create("create_appointment", "Service_Appointments", {
        Summary: visit.summary,
        Scheduled_Start_Date_Time: visit.start,
        Scheduled_End_Date_Time: visit.end,
        Territory: territory,
        $Service_Line_Items: [line],
        $Service_Resources: [visit.technicianId],
      });
      return { workOrderId: order.Work_Orders ?? "", appointmentId };
    },
  };
}
